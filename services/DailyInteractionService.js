const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits
} = require('discord.js');

const {
  all,
  get,
  run
} = require('../database');

const {
  createAuditEmbed,
  logAudit
} = require('../utils/logger');

const DAY_MS = 24 * 60 * 60 * 1000;
const DELIVERY_COOLDOWN_MS = 30 * DAY_MS;
const DEFAULT_TIMEZONE = 'Europe/London';

const DAY_NAMES = Object.freeze([
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
]);

const INTERACTION_TYPES = Object.freeze({
  QUESTION: {
    label: 'Question of the Day',
    emoji: '💬',
    prompts: [
      'What is one small thing that made your day better recently?',
      'If you could instantly master one skill, which would you choose?',
      'What game, film, or show would you recommend to everyone here?',
      'What is a goal you would love to complete this month?',
      'What is the best piece of advice you have ever received?'
    ]
  },
  WOULD_YOU_RATHER: {
    label: 'Would You Rather',
    emoji: '⚖️',
    prompts: [
      'Would you rather explore space or the deepest ocean?',
      'Would you rather have unlimited time or unlimited money?',
      'Would you rather always be early or always be lucky?',
      'Would you rather replay your favourite game for the first time or watch your favourite film for the first time?',
      'Would you rather live in a world with no music or no games?'
    ]
  },
  THIS_OR_THAT: {
    label: 'This or That',
    emoji: '🔀',
    prompts: [
      'Early bird or night owl?',
      'Sweet snacks or savoury snacks?',
      'Voice chat or text chat?',
      'Single-player adventures or multiplayer chaos?',
      'Mountains or beaches?'
    ]
  },
  CHALLENGE: {
    label: 'Daily Challenge',
    emoji: '🎯',
    prompts: [
      'Share something you are proud of, however small it seems.',
      'Welcome or encourage someone you do not usually talk to.',
      'Share a screenshot, drawing, build, or project you have worked on.',
      'Teach the community one useful thing in a short message.',
      'Give a genuine shout-out to another community member.'
    ]
  },
  GAME: {
    label: 'Community Game',
    emoji: '🎮',
    prompts: [
      'Word chain: reply with a word beginning with the last letter of **adventure**.',
      'Two truths and a lie: post three statements about yourself and let people guess the lie.',
      'Alphabet challenge: name a game, film, or show beginning with the letter **M**.',
      'Emoji story: describe your day using exactly five emojis.',
      'One-word story: add one word to continue the community story in the thread.'
    ]
  }
});

function validTimezone(timezone) {
  try {
    Intl.DateTimeFormat('en-GB', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function getDateParts(date, timezone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: validTimezone(timezone) ? timezone : DEFAULT_TIMEZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
    .formatToParts(date)
    .reduce((result, part) => {
      if (part.type !== 'literal') result[part.type] = part.value;
      return result;
    }, {});

  return {
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    dayOfWeek: Math.max(0, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      .indexOf(parts.weekday))
  };
}

function interactionType(type) {
  return INTERACTION_TYPES[String(type || '').toUpperCase()] || null;
}

function listInteractionTypes() {
  return Object.entries(INTERACTION_TYPES).map(([value, data]) => ({
    value,
    ...data
  }));
}

function ensureDailyInteractionConfig(guildId) {
  run(
    `INSERT OR IGNORE INTO daily_interaction_config (guildId)
     VALUES (?)`,
    [guildId]
  );

  for (const type of Object.keys(INTERACTION_TYPES)) {
    run(
      `INSERT OR IGNORE INTO daily_interaction_types (guildId, type)
       VALUES (?, ?)`,
      [guildId, type]
    );
  }

  return getDailyInteractionConfig(guildId);
}

function getDailyInteractionConfig(guildId) {
  return get(
    `SELECT *
     FROM daily_interaction_config
     WHERE guildId = ?`,
    [guildId]
  );
}

function getInteractionTypes(guildId) {
  ensureDailyInteractionConfig(guildId);

  return all(
    `SELECT *
     FROM daily_interaction_types
     WHERE guildId = ?
     ORDER BY type ASC`,
    [guildId]
  );
}

function setDayTheme({ guildId, dayOfWeek, type }) {
  const normalizedType = String(type || '').toUpperCase();
  const day = Number(dayOfWeek);

  if (!Number.isInteger(day) || day < 0 || day > 6) {
    throw new Error('Choose a day from Sunday through Saturday.');
  }

  if (!interactionType(normalizedType)) {
    throw new Error('Invalid daily interaction type.');
  }

  ensureDailyInteractionConfig(guildId);
  return run(
    `INSERT INTO daily_interaction_day_themes (guildId, dayOfWeek, type)
     VALUES (?, ?, ?)
     ON CONFLICT(guildId, dayOfWeek)
     DO UPDATE SET type = excluded.type`,
    [guildId, day, normalizedType]
  );
}

function clearDayTheme(guildId, dayOfWeek) {
  return run(
    `DELETE FROM daily_interaction_day_themes
     WHERE guildId = ?
     AND dayOfWeek = ?`,
    [guildId, Number(dayOfWeek)]
  );
}

function listDayThemes(guildId) {
  return all(
    `SELECT *
     FROM daily_interaction_day_themes
     WHERE guildId = ?
     ORDER BY dayOfWeek ASC`,
    [guildId]
  );
}

function getDayTheme(guildId, dayOfWeek) {
  return get(
    `SELECT *
     FROM daily_interaction_day_themes
     WHERE guildId = ?
     AND dayOfWeek = ?`,
    [guildId, Number(dayOfWeek)]
  );
}

function updateDailyInteractionConfig(guildId, fields) {
  const allowed = new Set([
    'enabled',
    'channelId',
    'pingRoleId',
    'hour',
    'minute',
    'timezone',
    'titlePrefix',
    'color',
    'discussionEnabled',
    'lastDateKey',
    'updatedBy'
  ]);

  const entries = Object.entries(fields)
    .filter(([key]) => allowed.has(key));

  if (!entries.length) return { changes: 0 };

  ensureDailyInteractionConfig(guildId);

  const assignments = entries.map(([key]) => `${key} = ?`);
  const values = entries.map(([, value]) => value);

  assignments.push('updatedAt = ?');
  values.push(Date.now(), guildId);

  return run(
    `UPDATE daily_interaction_config
     SET ${assignments.join(', ')}
     WHERE guildId = ?`,
    values
  );
}

function updateInteractionType({ guildId, type, enabled, weight }) {
  const normalizedType = String(type || '').toUpperCase();
  if (!interactionType(normalizedType)) {
    throw new Error('Invalid daily interaction type.');
  }

  ensureDailyInteractionConfig(guildId);
  const assignments = [];
  const values = [];

  if (enabled !== undefined) {
    assignments.push('enabled = ?');
    values.push(enabled ? 1 : 0);
  }

  if (weight !== undefined) {
    assignments.push('weight = ?');
    values.push(Math.max(1, Math.min(10, Number(weight) || 1)));
  }

  if (!assignments.length) return { changes: 0 };

  values.push(guildId, normalizedType);

  return run(
    `UPDATE daily_interaction_types
     SET ${assignments.join(', ')}
     WHERE guildId = ?
     AND type = ?`,
    values
  );
}

function addCustomPrompt({ guildId, type, prompt, title, createdBy }) {
  const normalizedType = String(type || '').toUpperCase();
  if (!interactionType(normalizedType)) {
    throw new Error('Invalid daily interaction type.');
  }

  return run(
    `INSERT INTO daily_interaction_prompts (
       guildId, type, prompt, title, createdBy, createdAt
     )
     VALUES (?, ?, ?, ?, ?, ?)`,
    [guildId, normalizedType, prompt.trim(), title?.trim() || null, createdBy, Date.now()]
  ).lastInsertRowid;
}

function listCustomPrompts(guildId, type = null) {
  const normalizedType = type ? String(type).toUpperCase() : null;

  return normalizedType
    ? all(
      `SELECT *
       FROM daily_interaction_prompts
       WHERE guildId = ?
       AND type = ?
       ORDER BY id ASC`,
      [guildId, normalizedType]
    )
    : all(
      `SELECT *
       FROM daily_interaction_prompts
       WHERE guildId = ?
       ORDER BY type ASC, id ASC`,
      [guildId]
    );
}

function removeCustomPrompt(guildId, id) {
  return run(
    `DELETE FROM daily_interaction_prompts
     WHERE guildId = ?
     AND id = ?`,
    [guildId, id]
  );
}

function setCustomPromptEnabled({ guildId, id, enabled }) {
  return run(
    `UPDATE daily_interaction_prompts
     SET enabled = ?
     WHERE guildId = ?
     AND id = ?`,
    [enabled ? 1 : 0, guildId, id]
  );
}

function promptsForType(guildId, type) {
  const normalizedType = String(type).toUpperCase();
  const preset = interactionType(normalizedType);

  if (!preset) return [];

  const builtIn = preset.prompts.map((prompt, index) => ({
    key: `builtin:${normalizedType}:${index}`,
    type: normalizedType,
    prompt,
    title: null,
    source: 'built-in'
  }));

  const custom = listCustomPrompts(guildId, normalizedType)
    .filter(row => Number(row.enabled) === 1)
    .map(row => ({
      key: `custom:${row.id}`,
      type: normalizedType,
      prompt: row.prompt,
      title: row.title,
      source: 'custom'
    }));

  return [...builtIn, ...custom];
}

function chooseWeightedType(types, random = Math.random) {
  const usable = types.filter(type => Number(type.enabled) === 1 && interactionType(type.type));
  const total = usable.reduce((sum, type) => sum + Math.max(1, Number(type.weight) || 1), 0);

  if (!total) return null;

  let selected = random() * total;
  for (const type of usable) {
    selected -= Math.max(1, Number(type.weight) || 1);
    if (selected < 0) return type.type;
  }

  return usable[usable.length - 1].type;
}

function choosePrompt({ guildId, type, now = Date.now(), random = Math.random }) {
  const prompts = promptsForType(guildId, type);
  if (!prompts.length) return null;

  const cutoff = now - DELIVERY_COOLDOWN_MS;
  run(
    `DELETE FROM daily_interaction_history
     WHERE guildId = ?
     AND deliveredAt < ?`,
    [guildId, cutoff]
  );

  const history = new Map(
    all(
      `SELECT promptKey, deliveredAt
       FROM daily_interaction_history
       WHERE guildId = ?`,
      [guildId]
    ).map(row => [row.promptKey, row.deliveredAt])
  );

  const eligible = prompts.filter(prompt => !history.has(prompt.key));
  if (eligible.length) {
    return eligible[Math.floor(random() * eligible.length)];
  }

  const oldest = [...prompts]
    .sort((left, right) => (history.get(left.key) || 0) - (history.get(right.key) || 0));

  return oldest[0] || null;
}

function chooseInteraction({ guildId, type = 'RANDOM', now = Date.now(), random = Math.random }) {
  const selectedType = String(type || 'RANDOM').toUpperCase() === 'RANDOM'
    ? chooseWeightedType(getInteractionTypes(guildId), random)
    : String(type).toUpperCase();

  if (!interactionType(selectedType)) return null;

  const prompt = choosePrompt({ guildId, type: selectedType, now, random });
  return prompt ? { ...prompt, type: selectedType } : null;
}

function savePromptDelivery(guildId, promptKey, deliveredAt) {
  return run(
    `INSERT INTO daily_interaction_history (guildId, promptKey, deliveredAt)
     VALUES (?, ?, ?)
     ON CONFLICT(guildId, promptKey)
     DO UPDATE SET deliveredAt = excluded.deliveredAt`,
    [guildId, promptKey, deliveredAt]
  );
}

function restorePromptDelivery(guildId, promptKey, previous) {
  if (previous?.deliveredAt) {
    return run(
      `UPDATE daily_interaction_history
       SET deliveredAt = ?
       WHERE guildId = ?
       AND promptKey = ?`,
      [previous.deliveredAt, guildId, promptKey]
    );
  }

  return run(
    `DELETE FROM daily_interaction_history
     WHERE guildId = ?
     AND promptKey = ?`,
    [guildId, promptKey]
  );
}

function buildInteractionEmbed(config, interaction, participants = 0) {
  const type = interactionType(interaction.type);
  const embed = new EmbedBuilder()
    .setColor(Number(config.color) || 0x5865F2)
    .setTitle(`${type.emoji} ${interaction.title || `${config.titlePrefix} | ${type.label}`}`.slice(0, 256))
    .setDescription(interaction.prompt.slice(0, 4096))
    .addFields(
      { name: 'Type', value: type.label, inline: true },
      { name: 'Participants', value: String(participants), inline: true },
      { name: 'How to Join', value: 'Click **Join In** to count, then use **Submit Answer** to share your response.' }
    )
    .setFooter({ text: `Jabster Studios Daily Interactions | ${interaction.source === 'custom' ? 'Community custom prompt' : 'Built-in prompt'}` })
    .setTimestamp();

  return embed;
}

function buildInteractionComponents({ discussionEnabled }) {
  const buttons = [
    new ButtonBuilder()
      .setCustomId('dailyinteraction_join')
      .setLabel('Join In')
      .setStyle(ButtonStyle.Success)
  ];

  if (discussionEnabled) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId('dailyinteraction_answer')
        .setLabel('Submit Answer')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('dailyinteraction_discuss')
        .setLabel('Open Discussion')
        .setStyle(ButtonStyle.Primary)
    );
  }

  return [new ActionRowBuilder().addComponents(buttons)];
}

async function getOrCreateDiscussionThread({ guild, message, post, openedBy }) {
  if (post.threadId) {
    const existingThread = await guild.channels.fetch(post.threadId).catch(() => null);
    if (existingThread) return existingThread;
  }

  const thread = await message.startThread({
    name: `Discuss ${post.type.replace(/_/g, ' ').toLowerCase()}`.slice(0, 100),
    autoArchiveDuration: 1440,
    reason: `Daily interaction discussion opened by ${openedBy || 'a community member'}`
  });

  run(
    `UPDATE daily_interaction_posts
     SET threadId = ?
     WHERE messageId = ?`,
    [thread.id, post.messageId]
  );

  return thread;
}

function dayDifference(previousDateKey, currentDateKey) {
  if (!previousDateKey || !currentDateKey) return null;

  const previous = Date.parse(`${previousDateKey}T00:00:00.000Z`);
  const current = Date.parse(`${currentDateKey}T00:00:00.000Z`);
  if (!Number.isFinite(previous) || !Number.isFinite(current)) return null;
  return Math.round((current - previous) / DAY_MS);
}

function recordMemberEngagement({
  guildId,
  userId,
  dateKey,
  joined = false,
  responded = false,
  now = Date.now()
}) {
  if (!joined && !responded) return getMemberEngagementStats(guildId, userId);

  const current = getMemberEngagementStats(guildId, userId);
  if (!current) {
    const firstStreak = dateKey ? 1 : 0;
    run(
      `INSERT INTO daily_interaction_member_stats (
         guildId, userId, totalJoins, totalResponses, currentStreak,
         longestStreak, lastDateKey, lastParticipatedAt
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        guildId,
        userId,
        joined ? 1 : 0,
        responded ? 1 : 0,
        firstStreak,
        firstStreak,
        dateKey || null,
        now
      ]
    );
    return getMemberEngagementStats(guildId, userId);
  }

  let currentStreak = Number(current.currentStreak) || 0;
  let longestStreak = Number(current.longestStreak) || 0;
  let lastDateKey = current.lastDateKey;

  if (dateKey && lastDateKey !== dateKey) {
    currentStreak = dayDifference(lastDateKey, dateKey) === 1
      ? currentStreak + 1
      : 1;
    longestStreak = Math.max(longestStreak, currentStreak);
    lastDateKey = dateKey;
  }

  run(
    `UPDATE daily_interaction_member_stats
     SET totalJoins = totalJoins + ?,
         totalResponses = totalResponses + ?,
         currentStreak = ?,
         longestStreak = ?,
         lastDateKey = ?,
         lastParticipatedAt = ?
     WHERE guildId = ?
     AND userId = ?`,
    [
      joined ? 1 : 0,
      responded ? 1 : 0,
      currentStreak,
      longestStreak,
      lastDateKey,
      now,
      guildId,
      userId
    ]
  );

  return getMemberEngagementStats(guildId, userId);
}

function getMemberEngagementStats(guildId, userId) {
  return get(
    `SELECT *
     FROM daily_interaction_member_stats
     WHERE guildId = ?
     AND userId = ?`,
    [guildId, userId]
  );
}

function getEngagementLeaderboard(guildId, limit = 10) {
  return all(
    `SELECT *, (totalJoins + (totalResponses * 2)) AS score
     FROM daily_interaction_member_stats
     WHERE guildId = ?
     ORDER BY score DESC, longestStreak DESC, lastParticipatedAt DESC
     LIMIT ?`,
    [guildId, Math.max(1, Math.min(20, Number(limit) || 10))]
  );
}

function getDailyInteractionAnalytics(guildId, now = Date.now()) {
  const since = now - (30 * DAY_MS);
  const posts = get(
    `SELECT COUNT(*) AS count
     FROM daily_interaction_posts
     WHERE guildId = ?
     AND sentAt >= ?`,
    [guildId, since]
  ).count;
  const participants = get(
    `SELECT COUNT(DISTINCT participant.userId) AS count
     FROM daily_interaction_participants AS participant
     INNER JOIN daily_interaction_posts AS post
       ON post.messageId = participant.messageId
     WHERE post.guildId = ?
     AND post.sentAt >= ?`,
    [guildId, since]
  ).count;
  const responses = get(
    `SELECT COUNT(*) AS count
     FROM daily_interaction_responses AS response
     INNER JOIN daily_interaction_posts AS post
       ON post.messageId = response.messageId
     WHERE post.guildId = ?
     AND post.sentAt >= ?`,
    [guildId, since]
  ).count;
  const types = all(
    `SELECT type, COUNT(*) AS count
     FROM daily_interaction_posts
     WHERE guildId = ?
     AND sentAt >= ?
     GROUP BY type
     ORDER BY count DESC, type ASC`,
    [guildId, since]
  );

  return { posts, participants, responses, types, since };
}

async function sendDailyInteraction({
  client,
  config,
  type = 'RANDOM',
  now = Date.now(),
  random = Math.random,
  trackHistory = true
}) {
  if (!config?.channelId) return { status: 'missing-channel' };

  const channel = await client.channels.fetch(config.channelId).catch(() => null);
  if (!channel?.isTextBased()) return { status: 'missing-channel' };

  const permissions = channel.permissionsFor(channel.guild.members.me);
  if (!permissions?.has([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks
  ])) {
    return { status: 'missing-permissions' };
  }

  const picked = chooseInteraction({ guildId: config.guildId, type, now, random });
  if (!picked) return { status: 'no-prompts' };

  const previous = trackHistory
    ? get(
      `SELECT deliveredAt
       FROM daily_interaction_history
       WHERE guildId = ?
       AND promptKey = ?`,
      [config.guildId, picked.key]
    )
    : null;

  if (trackHistory) {
    savePromptDelivery(config.guildId, picked.key, now);
  }

  const discussionEnabled = Number(config.discussionEnabled) === 1 &&
    permissions.has([
      PermissionFlagsBits.CreatePublicThreads,
      PermissionFlagsBits.SendMessagesInThreads
    ]);

  try {
    const message = await channel.send({
      content: config.pingRoleId ? `<@&${config.pingRoleId}>` : undefined,
      embeds: [buildInteractionEmbed(config, picked)],
      components: buildInteractionComponents({ discussionEnabled }),
      allowedMentions: config.pingRoleId
        ? { roles: [config.pingRoleId], parse: [] }
        : { parse: [] }
    });

    run(
      `INSERT OR REPLACE INTO daily_interaction_posts (
         messageId, guildId, channelId, type, promptKey, prompt, title, sentAt
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        message.id,
        config.guildId,
        channel.id,
        picked.type,
        picked.key,
        picked.prompt,
        picked.title || null,
        now
      ]
    );

    await logAudit(client, config.guildId, {
      action: 'DAILY_INTERACTION_POSTED',
      executorId: client.user?.id,
      type: 'COMMANDS',
      metadata: {
        messageId: message.id,
        channelId: channel.id,
        interactionType: picked.type,
        promptKey: picked.key,
        scheduled: trackHistory
      },
      embed: createAuditEmbed({
        action: 'Daily Interaction Posted',
        executor: client.user ? `${client.user.tag}\n<@${client.user.id}>` : 'Bot',
        channel: `<#${channel.id}>`,
        extra: `${interactionType(picked.type).label}: ${picked.prompt}`,
        color: Number(config.color) || 0x5865F2
      })
    });

    return { status: 'sent', message, interaction: picked };
  } catch (err) {
    if (trackHistory) {
      restorePromptDelivery(config.guildId, picked.key, previous);
    }
    throw err;
  }
}

class DailyInteractionService {
  static interval = null;

  static start(client) {
    if (DailyInteractionService.interval) return DailyInteractionService.interval;

    DailyInteractionService.tick(client)
      .catch(err => console.error('Daily interaction service error:', err));

    DailyInteractionService.interval = setInterval(() => {
      DailyInteractionService.tick(client)
        .catch(err => console.error('Daily interaction service error:', err));
    }, 60 * 1000);

    DailyInteractionService.interval.unref?.();
    return DailyInteractionService.interval;
  }

  static async sendNow(client, guildId, type = 'RANDOM') {
    const config = ensureDailyInteractionConfig(guildId);
    return sendDailyInteraction({ client, config, type });
  }

  static async test(client, guildId, type = 'RANDOM') {
    const config = ensureDailyInteractionConfig(guildId);
    return sendDailyInteraction({ client, config, type, trackHistory: false });
  }

  static async tick(client) {
    const configs = all(
      `SELECT *
       FROM daily_interaction_config
       WHERE enabled = 1
       AND channelId IS NOT NULL
       AND channelId <> ''`
    );

    const now = new Date();

    for (const config of configs) {
      const local = getDateParts(now, config.timezone);
      const scheduleReached = local.hour > Number(config.hour) ||
        (local.hour === Number(config.hour) && local.minute >= Number(config.minute));

      if (!scheduleReached || config.lastDateKey === local.dateKey) {
        continue;
      }

      const claim = run(
        `UPDATE daily_interaction_config
         SET lastDateKey = ?
         WHERE guildId = ?
         AND enabled = 1
         AND (lastDateKey IS NULL OR lastDateKey <> ?)`,
        [local.dateKey, config.guildId, local.dateKey]
      );

      if (!claim.changes) continue;

      try {
        const theme = getDayTheme(config.guildId, local.dayOfWeek);
        const themedTypeEnabled = theme && getInteractionTypes(config.guildId)
          .some(type => type.type === theme.type && Number(type.enabled) === 1);
        const result = await sendDailyInteraction({
          client,
          config,
          type: themedTypeEnabled ? theme.type : 'RANDOM',
          now: now.getTime()
        });

        if (result.status !== 'sent') {
          run(
            `UPDATE daily_interaction_config
             SET lastDateKey = NULL
             WHERE guildId = ?
             AND lastDateKey = ?`,
            [config.guildId, local.dateKey]
          );
        }
      } catch (err) {
        run(
          `UPDATE daily_interaction_config
           SET lastDateKey = NULL
           WHERE guildId = ?
           AND lastDateKey = ?`,
          [config.guildId, local.dateKey]
        );
        console.error(`Daily interaction send failed for ${config.guildId}:`, err);
      }
    }
  }
}

module.exports = {
  DAILY_INTERACTION_TYPES: INTERACTION_TYPES,
  DAY_NAMES,
  DEFAULT_TIMEZONE,
  DailyInteractionService,
  addCustomPrompt,
  buildInteractionEmbed,
  chooseInteraction,
  clearDayTheme,
  getDailyInteractionAnalytics,
  getDailyInteractionConfig,
  getDateParts,
  getDayTheme,
  getEngagementLeaderboard,
  getMemberEngagementStats,
  getInteractionTypes,
  getOrCreateDiscussionThread,
  interactionType,
  listCustomPrompts,
  listInteractionTypes,
  removeCustomPrompt,
  recordMemberEngagement,
  sendDailyInteraction,
  setDayTheme,
  setCustomPromptEnabled,
  listDayThemes,
  updateDailyInteractionConfig,
  updateInteractionType,
  validTimezone
};
