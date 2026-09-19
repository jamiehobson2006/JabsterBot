const { EmbedBuilder } = require('discord.js');

const {
  db,
  get,
  all,
  run
} = require('../../database');

const { checkRequirements } = require('./checkRequirements');

const activeEndings = new Map();

function parseRequirements(data) {
  try {
    return JSON.parse(data || '{}');
  } catch {
    return {};
  }
}

function getSavedWinners(messageId) {
  return all(
    `SELECT userId
     FROM giveaway_winners
     WHERE messageId = ?
     AND COALESCE(rerolled, 0) = 0
     ORDER BY wonAt, userId`,
    [messageId]
  ).map(row => row.userId);
}

function resultContent(giveaway, winners, outcome = null) {
  if (winners.length) {
    return [
      `Congratulations ${winners.map(id => `<@${id}>`).join(', ')}!`,
      `You won **${giveaway.prize}**`
    ].join('\n\n');
  }

  return [
    outcome || 'Giveaway ended with no valid entries.',
    `Prize: **${giveaway.prize}**`
  ].join('\n\n');
}

async function updateGiveawayMessage(message, winners) {
  if (!message.embeds?.length) {
    await message.edit({ components: [] });
    return;
  }

  const embed = EmbedBuilder.from(message.embeds[0]);
  const fields = (embed.data.fields || [])
    .filter(field => !/winners/i.test(String(field.name || '')));
  const winnerText = winners.length
    ? winners.map(id => `<@${id}>`).join(', ')
    : 'No valid winners';

  embed
    .setFields(fields)
    .setColor(0xED4245)
    .setFooter({ text: 'Giveaway Ended' })
    .addFields({ name: 'Winners', value: winnerText });

  await message.edit({ embeds: [embed], components: [] });
}

async function findExistingAnnouncement(channel, marker) {
  let before;
  for (let page = 0; page < 10; page += 1) {
    const messages = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!messages?.size) break;
    const match = messages.find(item => String(item.content || '').includes(marker));
    if (match) return match;
    before = messages.last()?.id;
    if (!before || messages.size < 100) break;
  }
  return null;
}

async function finishGiveaway({ giveaway, message, winners, outcome = null }) {
  let state = get(
    `SELECT * FROM giveaways WHERE messageId = ?`,
    [giveaway.messageId]
  );

  if (!state || state.ended) return false;

  if (!state.messageUpdatedAt) {
    await updateGiveawayMessage(message, winners);
    run(
      `UPDATE giveaways SET messageUpdatedAt = ? WHERE messageId = ?`,
      [Date.now(), giveaway.messageId]
    );
  }

  state = get(
    `SELECT * FROM giveaways WHERE messageId = ?`,
    [giveaway.messageId]
  );

  if (!state.announcementMessageId) {
    const marker = `Giveaway result ID: ${giveaway.messageId}`;
    const existing = await findExistingAnnouncement(message.channel, marker);
    const announcement = existing || await message.channel.send({
      content: `${resultContent(giveaway, winners, outcome)}\n-# ${marker}`
    });

    run(
      `UPDATE giveaways
       SET announcementMessageId = ?, announcementSentAt = ?
       WHERE messageId = ?`,
      [announcement.id, Date.now(), giveaway.messageId]
    );
  }

  const result = run(
    `UPDATE giveaways
     SET ended = 1,
         ending = 0,
         endingAt = NULL,
         nextEndAttemptAt = NULL,
         lastEndError = NULL
     WHERE messageId = ?
     AND ended = 0
     AND messageUpdatedAt IS NOT NULL
     AND announcementMessageId IS NOT NULL`,
    [giveaway.messageId]
  );

  return Boolean(result?.changes);
}

function saveWinners(giveaway, winners) {
  const save = db.transaction(() => {
    const existing = getSavedWinners(giveaway.messageId);
    if (existing.length) return existing;

    const wonAt = Date.now();
    for (const userId of winners) {
      run(
        `INSERT OR IGNORE INTO giveaway_winners (
           messageId, guildId, userId, wonAt
         ) VALUES (?, ?, ?, ?)`,
        [giveaway.messageId, giveaway.guildId, userId, wonAt]
      );
    }
    return getSavedWinners(giveaway.messageId);
  });

  return save();
}

function pickWeightedWinners(pool, count) {
  const remaining = [...pool];
  const winners = [];

  while (remaining.length && winners.length < count) {
    const selected = remaining[Math.floor(Math.random() * remaining.length)];
    winners.push(selected);
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      if (remaining[index] === selected) remaining.splice(index, 1);
    }
  }

  return winners;
}

async function buildEligiblePool(message, giveaway, entries) {
  const requirements = parseRequirements(giveaway.requirements);
  const processed = new Set();
  const pool = [];

  for (const entry of entries) {
    if (processed.has(entry.userId)) continue;
    processed.add(entry.userId);

    const member = await message.guild.members.fetch({
      user: entry.userId,
      force: true
    }).catch(() => null);
    if (!member) continue;

    const blacklisted = get(
      `SELECT 1 FROM giveaway_blacklist WHERE guildId = ? AND userId = ?`,
      [giveaway.guildId, member.id]
    );
    if (blacklisted) continue;

    const validation = await checkRequirements(member, requirements);
    if (!validation.success) continue;

    const weight = Math.min(1 + Math.max(Number(validation.bonusEntries || 0), 0), 100);
    for (let index = 0; index < weight; index += 1) pool.push(member.id);
  }

  return pool;
}

async function performEndGiveaway(client, giveaway) {
  if (!giveaway?.messageId || giveaway.ended) return false;

  try {
    const channel = await client.channels.fetch(giveaway.channelId);
    if (!channel?.isTextBased()) {
      const error = new Error('Giveaway channel is unavailable.');
      error.code = 'GIVEAWAY_RESOURCE_GONE';
      throw error;
    }

    const message = await channel.messages.fetch(giveaway.messageId);
    if (!message) throw new Error('Giveaway message is unavailable.');

    const savedWinners = getSavedWinners(giveaway.messageId);
    if (savedWinners.length) {
      return finishGiveaway({ giveaway, message, winners: savedWinners });
    }

    const entries = all(
      `SELECT * FROM giveaway_entries WHERE messageId = ?`,
      [giveaway.messageId]
    );
    if (!entries.length) {
      return finishGiveaway({
        giveaway,
        message,
        winners: [],
        outcome: 'Giveaway ended with no entries.'
      });
    }

    const pool = await buildEligiblePool(message, giveaway, entries);
    if (!pool.length) {
      return finishGiveaway({
        giveaway,
        message,
        winners: [],
        outcome: 'Giveaway ended with no valid entries.'
      });
    }

    const selected = pickWeightedWinners(
      pool,
      Math.max(Number(giveaway.winners || 1), 1)
    );
    const winners = saveWinners(giveaway, selected);
    return finishGiveaway({ giveaway, message, winners });
  } catch (error) {
    const terminal = [10003, 10008].includes(Number(error?.code)) ||
      error?.code === 'GIVEAWAY_RESOURCE_GONE';
    if (terminal) {
      run(
        `UPDATE giveaways
         SET ended = 1,
             ending = 0,
             endingAt = NULL,
             nextEndAttemptAt = NULL,
             endAttempts = COALESCE(endAttempts, 0) + 1,
             lastEndError = ?
         WHERE messageId = ? AND ended = 0`,
        [
          `Giveaway could not be announced because its Discord channel or message no longer exists: ${String(error.message || error)}`.slice(0, 1000),
          giveaway.messageId
        ]
      );
      console.error(`Giveaway resource is gone (${giveaway.messageId}); marked complete:`, error);
      return false;
    }

    const attempt = Math.max(Number(giveaway.endAttempts || 0) + 1, 1);
    const retryDelay = Math.min(15000 * (2 ** Math.min(attempt - 1, 10)), 6 * 60 * 60 * 1000);
    run(
      `UPDATE giveaways
       SET ending = 0,
           endingAt = NULL,
           endAttempts = COALESCE(endAttempts, 0) + 1,
           nextEndAttemptAt = ?,
           lastEndError = ?
       WHERE messageId = ? AND ended = 0`,
      [Date.now() + retryDelay, String(error.message || error).slice(0, 1000), giveaway.messageId]
    );
    console.error(`End giveaway error (${giveaway.messageId}):`, error);
    return false;
  }
}

function endGiveaway(client, giveaway) {
  const messageId = giveaway?.messageId;
  if (!messageId) return Promise.resolve(false);
  if (activeEndings.has(messageId)) return activeEndings.get(messageId);

  const ending = performEndGiveaway(client, giveaway)
    .finally(() => activeEndings.delete(messageId));
  activeEndings.set(messageId, ending);
  return ending;
}

module.exports = {
  endGiveaway,
  finishGiveaway,
  getSavedWinners,
  pickWeightedWinners
};
