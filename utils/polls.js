const {
  ActionRowBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder
} = require('discord.js');

const {
  all,
  get,
  run
} = require('../database');

let pollInterval =
  null;

function cleanText(value, maxLength) {
  return String(value || '')
    .replace(/@everyone|@here/g, '[mention removed]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function parseOptions(value) {
  try {
    const options =
      JSON.parse(value || '[]');

    return Array.isArray(options)
      ? options.map(option => cleanText(option, 100))
      : [];

  } catch {
    return [];
  }
}

function getPoll(messageId) {
  return get(
    `SELECT *
     FROM polls
     WHERE messageId = ?`,
    [messageId]
  );
}

function getVoteCounts(messageId, optionCount) {
  const counts =
    new Array(optionCount).fill(0);

  const rows =
    all(
      `SELECT optionIndex, COUNT(*) AS count
       FROM poll_votes
       WHERE messageId = ?
       GROUP BY optionIndex`,
      [messageId]
    );

  for (const row of rows) {
    const index =
      Number(row.optionIndex);

    if (Number.isInteger(index) && index >= 0 && index < counts.length) {
      counts[index] =
        Number(row.count) || 0;
    }
  }

  return counts;
}

function getResultsText(options, counts) {
  const total =
    counts.reduce((sum, count) => sum + count, 0);

  return options.map((option, index) => {
    const votes =
      counts[index] || 0;

    const percentage =
      total
        ? Math.round((votes / total) * 100)
        : 0;

    return `**${index + 1}. ${option}**\n${votes} vote${votes === 1 ? '' : 's'} (${percentage}%)`;
  }).join('\n\n');
}

function getOutcome(options, counts) {
  const total =
    counts.reduce((sum, count) => sum + count, 0);

  if (!total) {
    return 'No votes were cast.';
  }

  const highest =
    Math.max(...counts);

  const winners =
    options.filter((_, index) => counts[index] === highest);

  return winners.length === 1
    ? `Winner: **${winners[0]}**`
    : `Tie: **${winners.join('**, **')}**`;
}

function buildPollEmbed(poll, options, counts, ended = false) {
  const endsAt =
    Number(poll.endsAt) || null;

  const totalVotes =
    counts.reduce((sum, count) => sum + count, 0);

  const embed =
    new EmbedBuilder()
      .setColor(ended ? 0x57F287 : 0x5865F2)
      .setTitle(ended ? 'Community Poll Ended' : 'Community Poll')
      .setDescription(
        `**${cleanText(poll.question, 300)}**\n\n${getResultsText(options, counts)}`
      )
      .addFields({
        name: ended ? 'Outcome' : 'Voting',
        value: ended
          ? getOutcome(options, counts)
          : endsAt
            ? `Ends <t:${Math.floor(endsAt / 1000)}:R>`
            : 'No end time set',
        inline: true
      }, {
        name: 'Votes',
        value: String(totalVotes),
        inline: true
      })
      .setFooter({
        text: `Poll by ${poll.creatorTag || poll.creatorId}`
      })
      .setTimestamp(Number(poll.createdAt) || Date.now());

  if (ended) {
    embed.setFooter({
      text: `Ended <t:${Math.floor((poll.endedAt || Date.now()) / 1000)}:R>`
    });
  }

  return embed;
}

function buildPollComponents(messageId, options) {
  return [
    new ActionRowBuilder()
      .addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`poll_vote_${messageId}`)
          .setPlaceholder('Choose an option')
          .addOptions(
            options.map((option, index) => ({
              label: option.slice(0, 100),
              value: String(index)
            }))
          )
      )
  ];
}

function createPoll({
  messageId,
  guildId,
  channelId,
  creatorId,
  creatorTag,
  question,
  options,
  endsAt = null
}) {
  const createdAt =
    Date.now();

  return run(
    `INSERT INTO polls (
       messageId,
       guildId,
       channelId,
       creatorId,
       creatorTag,
       question,
       options,
       endsAt,
       active,
       createdAt
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [
      messageId,
      guildId,
      channelId,
      creatorId,
      creatorTag,
      cleanText(question, 300),
      JSON.stringify(options.map(option => cleanText(option, 100))),
      endsAt,
      createdAt
    ]
  );
}

function recordVote({
  messageId,
  userId,
  optionIndex
}) {
  const poll =
    getPoll(messageId);

  if (!poll || !poll.active) {
    throw new Error('This poll has ended.');
  }

  if (
    poll.endsAt &&
    Number(poll.endsAt) <= Date.now()
  ) {
    throw new Error('This poll has ended.');
  }

  const options =
    parseOptions(poll.options);

  if (
    !Number.isInteger(optionIndex) ||
    optionIndex < 0 ||
    optionIndex >= options.length
  ) {
    throw new Error('That poll option is invalid.');
  }

  run(
    `INSERT INTO poll_votes (
       messageId,
       userId,
       optionIndex
     )
     VALUES (?, ?, ?)
     ON CONFLICT(messageId, userId)
     DO UPDATE SET optionIndex = excluded.optionIndex`,
    [
      messageId,
      userId,
      optionIndex
    ]
  );

  return getVoteCounts(messageId, options.length);
}

async function getPollMessage(client, poll) {
  const channel =
    await client.channels.fetch(poll.channelId)
      .catch(() => null);

  if (!channel?.isTextBased()) {
    return null;
  }

  return channel.messages.fetch(poll.messageId)
    .catch(() => null);
}

async function refreshPollMessage(client, messageId, ended = false) {
  const poll =
    getPoll(messageId);

  if (!poll) {
    return null;
  }

  const options =
    parseOptions(poll.options);

  if (options.length < 2) {
    return null;
  }

  const message =
    await getPollMessage(client, poll);

  if (!message) {
    return null;
  }

  const counts =
    getVoteCounts(poll.messageId, options.length);

  await message.edit({
    embeds: [
      buildPollEmbed(
        poll,
        options,
        counts,
        ended || !poll.active
      )
    ],
    components:
      ended || !poll.active
        ? []
        : buildPollComponents(poll.messageId, options)
  });

  return {
    poll,
    options,
    counts,
    message
  };
}

async function endPoll(client, messageId) {
  const poll =
    getPoll(messageId);

  if (!poll || !poll.active) {
    return false;
  }

  const endedAt =
    Date.now();

  const result =
    run(
      `UPDATE polls
       SET active = 0,
           endedAt = ?
       WHERE messageId = ?
       AND active = 1`,
      [
        endedAt,
        messageId
      ]
    );

  if (!result.changes) {
    return false;
  }

  await refreshPollMessage(client, messageId, true)
    .catch(err => {
      console.error('Failed to update ended poll:', err);
    });

  return true;
}

async function processExpiredPolls(client) {
  const expired =
    all(
      `SELECT messageId
       FROM polls
       WHERE active = 1
       AND endsAt IS NOT NULL
       AND endsAt <= ?`,
      [Date.now()]
    );

  for (const poll of expired) {
    await endPoll(client, poll.messageId);
  }

  return expired.length;
}

function startPollService(client) {
  if (pollInterval) {
    return pollInterval;
  }

  processExpiredPolls(client)
    .catch(err => console.error('Poll service error:', err));

  pollInterval =
    setInterval(() => {
      processExpiredPolls(client)
        .catch(err => console.error('Poll service error:', err));
    }, 15000);

  pollInterval.unref?.();

  return pollInterval;
}

module.exports = {
  buildPollComponents,
  buildPollEmbed,
  createPoll,
  endPoll,
  getPoll,
  getVoteCounts,
  parseOptions,
  processExpiredPolls,
  recordVote,
  refreshPollMessage,
  startPollService
};
