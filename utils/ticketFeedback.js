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

const { sendTranscriptMessage } = require('./tickets/transcriptDelivery');

const PUBLISH_RETRY_MS =
  15 * 60 * 1000;

let publisherInterval = null;

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
  const existing = get(
    `SELECT * FROM ticket_feedback WHERE channelId = ?`,
    [ticket.channelId]
  );

  if (existing) return existing;

  const id =
    crypto.randomUUID();

  run(
    `INSERT OR IGNORE INTO ticket_feedback (
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

  return get(
    `SELECT * FROM ticket_feedback WHERE channelId = ?`,
    [ticket.channelId]
  );
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
      'Your ticket has been closed. Please rate the help you received and optionally leave feedback.',
    components: [feedbackButtons(feedback.id)]
  };

  if (transcriptAttachment) {
    payload.files = [transcriptAttachment];
  }

  try {
    await sendTranscriptMessage(user, payload);

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

function buildFeedbackEmbed(record) {
  const ticketType = cleanText(record.ticketType, 80) || 'ticket';

  return new EmbedBuilder()
    .setColor(record.rating >= 4 ? 0x57F287 : record.rating <= 2 ? 0xED4245 : 0xFEE75C)
    .setTitle(`Ticket Feedback | ${ticketType}`)
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
        name: 'Closed By',
        value: record.closedBy ? `<@${record.closedBy}>` : 'Unknown',
        inline: true
      },
      {
        name: 'Ticket Type',
        value: ticketType,
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
    .setFooter({ text: `Feedback ID: ${record.id}` })
    .setTimestamp(record.completedAt || Date.now());
}

function recordPublishFailure(record, error) {
  run(
    `UPDATE ticket_feedback
     SET publishAttempts = COALESCE(publishAttempts, 0) + 1,
         lastPublishAttemptAt = ?,
         lastPublishError = ?
     WHERE id = ?
     AND publishedMessageId IS NULL`,
    [
      Date.now(),
      cleanText(error?.message || error || 'Unknown publish error', 500),
      record.id
    ]
  );
}

async function publishFeedback(client, record) {
  const current =
    getFeedback(record?.id) || record;

  if (
    !current ||
    current.status !== 'SUBMITTED'
  ) {
    return false;
  }

  if (current.publishedMessageId) {
    return true;
  }

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

  try {
    const message = await channel.send({
      embeds: [buildFeedbackEmbed(current)],
      allowedMentions: {
        parse: []
      }
    });

    const result = run(
      `UPDATE ticket_feedback
       SET publishedAt = ?,
           publishedMessageId = ?,
           lastPublishAttemptAt = ?,
           lastPublishError = NULL
       WHERE id = ?
       AND publishedMessageId IS NULL`,
      [Date.now(), message.id, Date.now(), current.id]
    );

    return Boolean(result.changes || getFeedback(current.id)?.publishedMessageId);
  } catch (error) {
    recordPublishFailure(current, error);
    throw error;
  }
}

async function publishPendingFeedback(client, limit = 25) {
  const retryBefore = Date.now() - PUBLISH_RETRY_MS;
  const records = all(
    `SELECT *
     FROM ticket_feedback
     WHERE status = 'SUBMITTED'
     AND publishedMessageId IS NULL
     AND (
       lastPublishAttemptAt IS NULL
       OR lastPublishAttemptAt <= ?
     )
     ORDER BY completedAt ASC, createdAt ASC
     LIMIT ?`,
    [retryBefore, Math.min(Math.max(Number(limit) || 25, 1), 100)]
  );

  let published = 0;

  for (const record of records) {
    try {
      if (await publishFeedback(client, record)) {
        published += 1;
      }
    } catch (error) {
      console.error(`Ticket feedback publish retry failed for ${record.id}:`, error.message);
    }
  }

  return {
    queued: records.length,
    published
  };
}

function startFeedbackPublisher(client) {
  if (publisherInterval) {
    return publisherInterval;
  }

  publishPendingFeedback(client)
    .catch(error => console.error('Ticket feedback startup publish error:', error));

  publisherInterval = setInterval(() => {
    publishPendingFeedback(client)
      .catch(error => console.error('Ticket feedback publish error:', error));
  }, PUBLISH_RETRY_MS);

  publisherInterval.unref?.();
  return publisherInterval;
}

module.exports = {
  cleanText,
  buildFeedbackEmbed,
  createFeedbackRecord,
  getFeedback,
  listFeedback,
  publishFeedback,
  publishPendingFeedback,
  sendFeedbackPrompt,
  startFeedbackPublisher,
  submitFeedback
};
