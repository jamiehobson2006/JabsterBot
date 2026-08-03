const crypto =
  require('node:crypto');

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');

const {
  all,
  get,
  run
} = require('../database');

function cleanText(value, maxLength = 1000) {
  return String(value || '')
    .replace(/@everyone|@here/g, '[mention removed]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function createFeedbackRecord({
  ticket,
  closedBy,
  closeReason
}) {
  const id =
    crypto.randomUUID();

  run(
    `INSERT INTO ticket_feedback (
       id,
       guildId,
       ticketId,
       channelId,
       ticketType,
       userId,
       closedBy,
       closeReason,
       status,
       createdAt
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
    [
      id,
      ticket.guildId,
      ticket.id || null,
      ticket.channelId,
      ticket.type,
      ticket.userId,
      closedBy.id,
      cleanText(closeReason),
      Date.now()
    ]
  );

  return getFeedback(id);
}

function getFeedback(id) {
  return get(
    `SELECT *
     FROM ticket_feedback
     WHERE id = ?`,
    [id]
  );
}

function listFeedback(guildId, limit = 10) {
  return all(
    `SELECT *
     FROM ticket_feedback
     WHERE guildId = ?
     ORDER BY createdAt DESC
     LIMIT ?`,
    [
      guildId,
      Math.min(Math.max(Number(limit) || 10, 1), 25)
    ]
  );
}

function feedbackButtons(feedbackId) {
  return new ActionRowBuilder()
    .addComponents(
      ...[1, 2, 3, 4, 5].map(rating =>
        new ButtonBuilder()
          .setCustomId(`ticket_feedback_rate_${feedbackId}_${rating}`)
          .setLabel(`${rating}/5`)
          .setStyle(
            rating >= 4
              ? ButtonStyle.Success
              : rating <= 2
                ? ButtonStyle.Danger
                : ButtonStyle.Secondary
          )
      )
    );
}

async function sendFeedbackPrompt({
  client,
  feedback,
  transcriptAttachment = null
}) {
  const user =
    await client.users.fetch(feedback.userId)
      .catch(() => null);

  if (!user) {
    return false;
  }

  const payload = {
    content:
      'Your ticket has been closed. Please rate the support you received and optionally leave feedback.',
    components: [feedbackButtons(feedback.id)]
  };

  if (transcriptAttachment) {
    payload.files = [transcriptAttachment];
  }

  try {
    await user.send(payload);

    run(
      `UPDATE ticket_feedback
       SET dmSent = 1
       WHERE id = ?`,
      [feedback.id]
    );

    return true;

  } catch (err) {
    console.warn(
      `Could not DM ticket feedback request to ${feedback.userId}:`,
      err.message
    );

    return false;
  }
}

function submitFeedback({
  id,
  userId,
  rating,
  feedback
}) {
  const record =
    getFeedback(id);

  if (!record || record.userId !== userId) {
    throw new Error('This feedback request is not available.');
  }

  if (record.status === 'SUBMITTED') {
    throw new Error('You have already submitted feedback for this ticket.');
  }

  const numericRating =
    Number(rating);

  if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
    throw new Error('Choose a rating from 1 to 5.');
  }

  run(
    `UPDATE ticket_feedback
     SET rating = ?,
         feedback = ?,
         status = 'SUBMITTED',
         completedAt = ?
     WHERE id = ?`,
    [
      numericRating,
      cleanText(feedback) || null,
      Date.now(),
      id
    ]
  );

  return getFeedback(id);
}

async function publishFeedback(client, record) {
  const settings =
    get(
      `SELECT ticketFeedbackChannelId
       FROM guild_settings
       WHERE guildId = ?`,
      [record.guildId]
    );

  if (!settings?.ticketFeedbackChannelId) {
    return false;
  }

  const channel =
    await client.channels.fetch(settings.ticketFeedbackChannelId)
      .catch(() => null);

  if (!channel?.isTextBased()) {
    return false;
  }

  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(record.rating >= 4 ? 0x57F287 : record.rating <= 2 ? 0xED4245 : 0xFEE75C)
        .setTitle('Ticket Feedback')
        .addFields(
          {
            name: 'User',
            value: `<@${record.userId}>`,
            inline: true
          },
          {
            name: 'Rating',
            value: `${record.rating}/5`,
            inline: true
          },
          {
            name: 'Ticket Type',
            value: record.ticketType,
            inline: true
          },
          {
            name: 'Close Reason',
            value: cleanText(record.closeReason) || 'No reason recorded'
          },
          {
            name: 'Feedback',
            value: cleanText(record.feedback) || 'No written feedback provided.'
          }
        )
        .setTimestamp(record.completedAt || Date.now())
    ],
    allowedMentions: {
      parse: []
    }
  });

  return true;
}

module.exports = {
  cleanText,
  createFeedbackRecord,
  getFeedback,
  listFeedback,
  publishFeedback,
  sendFeedbackPrompt,
  submitFeedback
};
