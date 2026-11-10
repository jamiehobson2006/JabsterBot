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
const {
  deliverOnce,
  enqueueDelivery,
  sendQueuedMessage
} = require('./deliveryOutbox');

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
  feedback=getFeedback(feedback.id) || feedback;
  if(feedback.dmSent) return true;
  const deliveryKey=`ticket-feedback-dm:${feedback.id}`;
  enqueueDelivery({deliveryKey,type:'TICKET_FEEDBACK_DM',guildId:feedback.guildId,payload:{feedbackId:feedback.id}});

  const payload = {
    content:
      'Your ticket has been closed. Please rate the help you received and optionally leave feedback.',
    components: [feedbackButtons(feedback.id)]
  };

  if (transcriptAttachment) {
    payload.files = [transcriptAttachment];
  }

  try {
    const delivery=await deliverOnce(deliveryKey,async claimed=>{
      const user=await client.users.fetch(feedback.userId);
      const destination=user.createDM ? await user.createDM():user;
      const ticket=get('SELECT * FROM tickets WHERE channelId=?',[feedback.channelId]);
      if(!transcriptAttachment && ticket?.transcriptMessageId && ticket.transcriptArchiveChannelId) {
        const archive=await client.channels.fetch(ticket.transcriptArchiveChannelId);
        const message=await archive.messages.fetch({message:ticket.transcriptMessageId,force:true});
        const attachment=[...(message.attachments?.values?.() || [])].find(file=>file.name===`ticket-${feedback.channelId}.html`);
        if(!attachment || !require('./tickets/transcriptDocument').isDiscordAsset(attachment.url)) throw new Error('The transcript copy is unavailable; feedback DM retained for retry.');
        payload.files=[{attachment:attachment.url,name:attachment.name}];
      }
      if(!payload.files?.length) throw new Error('Waiting for a durable transcript before sending feedback.');
      // Keep file URLs fresh rather than persisting expiring Discord CDN signatures.
      claimed.parsedPayload={message:payload};
      run('UPDATE ticket_feedback SET dmAttempts=dmAttempts+1 WHERE id=?',[feedback.id]);
      return sendTranscriptMessage({send:options=>sendQueuedMessage(destination,claimed,options)},payload);
    });
    if(delivery?.status!=='SENT') return false;

    run(
      `UPDATE ticket_feedback
       SET dmSent = 1,dmMessageId=?,dmLastError=NULL,dmNextAttemptAt=0
       WHERE id = ?`,
      [delivery.messageId,feedback.id]
    );

    return true;

  } catch (err) {
    const delivery=get('SELECT nextAttemptAt FROM delivery_outbox WHERE deliveryKey=?',[deliveryKey]);
    run('UPDATE ticket_feedback SET dmLastError=?,dmNextAttemptAt=? WHERE id=?',[String(err.message).slice(0,1000),delivery?.nextAttemptAt || Date.now()+60000,feedback.id]);
    console.warn(
      `Could not DM ticket feedback request to ${feedback.userId}:`,
      err.message
    );

    return false;
  }
}

async function retryFeedbackPrompts(client,limit=25) {
  const records=all(`SELECT f.* FROM ticket_feedback f JOIN tickets t ON t.channelId=f.channelId
    WHERE f.dmSent=0 AND f.dmNextAttemptAt<=? AND t.transcriptMessageId IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM delivery_outbox d WHERE d.deliveryKey='ticket-feedback-dm:'||f.id AND
      (d.status IN ('UNCERTAIN','CANCELLED') OR d.nextAttemptAt>? OR COALESCE(d.leaseUntil,0)>?))
    AND UPPER(t.status) IN ('CLOSING','CLOSED','DELETED') ORDER BY f.dmNextAttemptAt,f.createdAt LIMIT ?`,[Date.now(),Date.now(),Date.now(),limit]);
  let sent=0;
  for(const feedback of records) if(await sendFeedbackPrompt({client,feedback})) sent++;
  return sent;
}

function resetFeedbackPrompt(id,guildId) {
  const feedback=getFeedback(id);
  if(!feedback || feedback.guildId!==guildId) throw new Error('Feedback request not found.');
  const delivery=get('SELECT * FROM delivery_outbox WHERE deliveryKey=?',[`ticket-feedback-dm:${id}`]);
  if(delivery?.status==='PROCESSING' && delivery.leaseUntil>Date.now()) throw new Error('Delivery is currently running; try again later.');
  run('DELETE FROM delivery_outbox WHERE deliveryKey=?',[`ticket-feedback-dm:${id}`]);
  run('UPDATE ticket_feedback SET dmSent=0,dmNextAttemptAt=0,dmLastError=NULL WHERE id=?',[id]);
  return getFeedback(id);
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
    recordPublishFailure(current, 'The configured feedback channel is unavailable.');
    return false;
  }

  try {
    const deliveryKey = `ticket-feedback:${current.id}`;
    const payload = {
      embeds: [buildFeedbackEmbed(current)],
      allowedMentions: { parse: [] }
    };
    enqueueDelivery({
      deliveryKey,
      type: 'TICKET_FEEDBACK',
      guildId: current.guildId,
      channelId: settings.ticketFeedbackChannelId,
      payload: { feedbackId: current.id, message: payload }
    });

    const delivery = await deliverOnce(deliveryKey,
      claimed => sendQueuedMessage(channel, claimed, payload));
    if (delivery?.status !== 'SENT') return false;
    const messageId = delivery?.messageId;
    if (!messageId) {
      throw new Error('Feedback delivery completed without a Discord message ID.');
    }

    const result = run(
      `UPDATE ticket_feedback
       SET publishedAt = ?,
           publishedMessageId = ?,
           lastPublishAttemptAt = ?,
           lastPublishError = NULL
       WHERE id = ?
       AND publishedMessageId IS NULL`,
      [Date.now(), messageId, Date.now(), current.id]
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
    `SELECT feedback.*
     FROM ticket_feedback AS feedback
     INNER JOIN guild_settings AS settings ON settings.guildId=feedback.guildId
     WHERE feedback.status = 'SUBMITTED'
     AND feedback.publishedMessageId IS NULL
     AND NULLIF(settings.ticketFeedbackChannelId,'') IS NOT NULL
     AND (
       feedback.lastPublishAttemptAt IS NULL
       OR feedback.lastPublishAttemptAt <= ?
     )
     ORDER BY COALESCE(feedback.lastPublishAttemptAt,0) ASC, feedback.completedAt ASC, feedback.createdAt ASC
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
  retryFeedbackPrompts(client).catch(error=>console.error('Feedback DM retry:',error.message));

  publisherInterval = setInterval(() => {
    retryFeedbackPrompts(client).catch(error=>console.error('Feedback DM retry:',error.message));
    publishPendingFeedback(client)
      .catch(error => console.error('Ticket feedback publish error:', error));
  }, 60000);

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
  resetFeedbackPrompt,
  retryFeedbackPrompts,
  startFeedbackPublisher,
  submitFeedback
};
