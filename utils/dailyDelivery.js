const crypto = require('node:crypto');
const { all, get, run, transaction } = require('../database');
const { deliverOnce, deliveryNonce, enqueueDelivery } = require('./deliveryOutbox');
const { fetchDailyMessage, withDailyDisplayLock } = require('./dailyDisplay');
const { cleanDailyFooter, dailyReference } = require('./dailyFooter');

const DAILY_TYPES = ['DAILY_FACT_POST', 'DAILY_INTERACTION_POST', 'DAILY_FACT_REVIEW',
  'DAILY_FACT_DM', 'DAILY_FACT_REVIEW_UPDATE', 'DAILY_INTERACTION_RESPONSE', 'DAILY_ACTIVITY_UPDATE', 'DAILY_REMINDER', 'DAILY_PROMPT_RATING'];

function getDailyDelivery(deliveryKey) {
  return get('SELECT * FROM delivery_outbox WHERE deliveryKey = ?', [deliveryKey]);
}

function newDailyKey(prefix) {
  return `${prefix}:${crypto.randomUUID()}`;
}

function dailyMetadata(row) {
  try { return JSON.parse(row.payload || '{}').daily || null; } catch { return null; }
}

function pendingDailyKeys(guildId, type) {
  return new Set(all(
    `SELECT payload FROM delivery_outbox WHERE guildId = ? AND type = ?
     AND status IN ('PENDING', 'FAILED', 'PROCESSING')`, [guildId, type]
  ).map(row => dailyMetadata(row)?.contentKey).filter(Boolean));
}

function finalizeDailyDelivery(row) {
  if (row?.status !== 'SENT' || row.finalizedAt || !row.messageId) return row;
  const metadata = dailyMetadata(row);
  if (!metadata) return row;

  transaction(() => {
    const current = getDailyDelivery(row.deliveryKey);
    if (current.finalizedAt) return;
    const sentAt = Number(row.sentAt) || Date.now();

    if (row.type === 'DAILY_FACT_POST') {
      run(`INSERT INTO dailyfact_delivery_history (guildId, factKey, deliveredAt)
           VALUES (?, ?, ?) ON CONFLICT(guildId, factKey)
           DO UPDATE SET deliveredAt = MAX(deliveredAt, excluded.deliveredAt)`,
      [row.guildId, metadata.contentKey, sentAt]);
      if (metadata.dateKey) {
        run(`UPDATE dailyfact_config SET lastSent = MAX(COALESCE(lastSent, ''), ?), nextAttemptAt = NULL,
             lastDeliveryError = NULL WHERE guildId = ?`, [metadata.dateKey, row.guildId]);
      }
    }

    if (row.type === 'DAILY_INTERACTION_POST' && !metadata.preview) {
      const picked = metadata.selection;
      run(`INSERT OR IGNORE INTO daily_interaction_posts
           (messageId, guildId, channelId, type, promptKey, prompt, title, sentAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.messageId, row.guildId, row.channelId, picked.type, picked.key,
        picked.prompt, picked.title || null, sentAt]);
      run('UPDATE daily_interaction_posts SET footerNormalizedAt = ? WHERE messageId = ?', [sentAt, row.messageId]);
      run('UPDATE daily_interaction_posts SET activityJson = ? WHERE messageId = ? AND activityJson IS NULL',
        [metadata.activity ? JSON.stringify(metadata.activity) : null, row.messageId]);
      if (metadata.trackHistory) {
        run(`INSERT INTO daily_interaction_history (guildId, promptKey, deliveredAt)
             VALUES (?, ?, ?) ON CONFLICT(guildId, promptKey)
             DO UPDATE SET deliveredAt = MAX(deliveredAt, excluded.deliveredAt)`,
        [row.guildId, picked.key, sentAt]);
      }
      if (metadata.dateKey) {
        run(`UPDATE daily_interaction_config SET lastDateKey = MAX(COALESCE(lastDateKey, ''), ?), nextAttemptAt = NULL,
             lastDeliveryError = NULL WHERE guildId = ?`, [metadata.dateKey, row.guildId]);
      }
    }

    if (row.type === 'DAILY_FACT_REVIEW') {
      run(`UPDATE dailyfact_submissions SET reviewMessageId = ? WHERE id = ?`,
        [row.messageId, metadata.submissionId]);
    }
    if (row.type === 'DAILY_INTERACTION_RESPONSE') {
      require('./dailyActivities').finalizeGameTurn(metadata, sentAt);
      const previous = get(`SELECT 1 FROM daily_interaction_responses WHERE messageId = ? AND userId = ?`,
        [metadata.postId, metadata.userId]);
      run(`INSERT INTO daily_interaction_responses (messageId, userId, response, submittedAt, threadMessageId)
           VALUES (?, ?, ?, ?, ?) ON CONFLICT(messageId, userId) DO UPDATE SET response = excluded.response,
           submittedAt = excluded.submittedAt, threadMessageId = excluded.threadMessageId`,
      [metadata.postId, metadata.userId, metadata.answer, sentAt, row.messageId]);
      const joined = run(`INSERT OR IGNORE INTO daily_interaction_participants (messageId, userId, joinedAt)
           VALUES (?, ?, ?)`, [metadata.postId, metadata.userId, sentAt]);
      require('../services/DailyInteractionService').recordMemberEngagement({ guildId: row.guildId,
        userId: metadata.userId, dateKey: metadata.engagementDateKey, joined: Boolean(joined.changes),
        responded: !previous, now: sentAt, messageId: metadata.postId });
    }
    if (row.type === 'DAILY_ACTIVITY_UPDATE') {
      if (metadata.reveal) run('UPDATE daily_interaction_posts SET triviaRevealedAt = ?, buttonsClosedAt = ? WHERE messageId = ?',
        [sentAt, sentAt, metadata.postId]);
      if (metadata.gameVersion != null) run(`UPDATE daily_interaction_posts SET displayedGameVersion = MAX(displayedGameVersion, ?) WHERE messageId = ?`,
        [metadata.gameVersion, metadata.postId]);
      if (metadata.choiceHash) run('UPDATE daily_interaction_posts SET displayedChoiceHash = ? WHERE messageId = ?', [metadata.choiceHash, metadata.postId]);
    }

    run('UPDATE delivery_outbox SET finalizedAt = ? WHERE deliveryKey = ?',
      [Date.now(), row.deliveryKey]);
  });
  return getDailyDelivery(row.deliveryKey);
}

function cancelDailyDelivery(row) {
  run(`UPDATE delivery_outbox SET status = 'CANCELLED', finalizedAt = ?, leaseUntil = NULL
       WHERE deliveryKey = ? AND status != 'SENT'`, [Date.now(), row.deliveryKey]);
  return getDailyDelivery(row.deliveryKey);
}

async function attemptDailyDelivery(client, row) {
  if (row.status === 'SENT') return finalizeDailyDelivery(row);
  const metadata = dailyMetadata(row);
  if (!metadata || row.status === 'CANCELLED') return row;
  if (row.type === 'DAILY_FACT_POST' && metadata.selection?.source === 'coded') {
    const selection = metadata.selection;
    const review = require('../data/dailyFactReview.json').entries.find(item => item.category === selection.category &&
      selection.fact.startsWith(item.startsWith));
    if (review?.status === 'RETIRED' || review?.replacement && selection.fact !== review.replacement) return cancelDailyDelivery(row);
  }
  if (row.type === 'DAILY_ACTIVITY_UPDATE' && !metadata.reveal) {
    const post = get('SELECT * FROM daily_interaction_posts WHERE messageId = ?', [metadata.postId]);
    if (!post || (metadata.gameVersion != null && require('./dailyActivities').gameState(post).version > metadata.gameVersion) ||
        (metadata.choiceHash && require('./dailyActivities').choiceResults(post).hash !== metadata.choiceHash)) return cancelDailyDelivery(row);
  }
  if (row.type === 'DAILY_REMINDER') {
    const post = get('SELECT * FROM daily_interaction_posts WHERE messageId = ? AND guildId = ?', [metadata.postId, row.guildId]);
    const preference = get('SELECT reminders FROM daily_member_preferences WHERE guildId = ? AND userId = ?', [row.guildId, metadata.userId]);
    const config = get('SELECT enabled, timezone FROM daily_interaction_config WHERE guildId = ?', [row.guildId]);
    const currentDate = require('../services/DailyInteractionService').getDateParts(new Date(), config?.timezone).dateKey;
    if (!post || !require('./dailyActivities').activityOpen(post) || !config?.enabled || !preference?.reminders ||
        !require('./dailyEngagement').engagementSettings(row.guildId).remindersEnabled ||
        (metadata.reminderDateKey && metadata.reminderDateKey !== currentDate) ||
        require('./dailyEngagement').isQuietDay(row.guildId) ||
        get('SELECT 1 FROM daily_interaction_participants WHERE messageId = ? AND userId = ?', [post.messageId, metadata.userId])) {
      return cancelDailyDelivery(row);
    }
  }
  if (row.type === 'DAILY_INTERACTION_RESPONSE') {
    const post = get('SELECT * FROM daily_interaction_posts WHERE messageId = ? AND guildId = ?',
      [metadata.postId, row.guildId]);
    const service = require('../services/DailyInteractionService');
    const config = service.getDailyInteractionConfig(row.guildId);
    const terms = require('./censor').listCensorTerms(row.guildId);
    const safe = metadata.gameVersion && post
      ? require('./dailyActivities').validateGameTurn(post, metadata.userId, metadata.answer, terms)
      : require('./dailyInteractionSafety').validateDailyInteractionAnswer({ post, answer: metadata.answer, censorTerms: terms });
    if (!service.isDailyInteractionOpen(post) || !Number(config?.discussionEnabled) || !safe.valid) {
      return cancelDailyDelivery(row);
    }
  }
  if (metadata.dateKey) {
    const table = row.type === 'DAILY_FACT_POST' ? 'dailyfact_config' : 'daily_interaction_config';
    const config = get(`SELECT * FROM ${table} WHERE guildId = ?`, [row.guildId]);
    if (!config?.enabled) return cancelDailyDelivery(row);
    let timezone = config.timezone || 'Europe/London';
    try { new Intl.DateTimeFormat('en-GB', { timeZone: timezone }); }
    catch { timezone = 'Europe/London'; }
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date()).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
    const today = `${parts.year}-${parts.month}-${parts.day}`;
    if (config.channelId !== row.channelId || metadata.dateKey !== today) return cancelDailyDelivery(row);
    if (row.type === 'DAILY_INTERACTION_POST' && require('./dailyEngagement').isQuietDay(row.guildId)) return cancelDailyDelivery(row);
    if (Number(parts.hour) * 60 + Number(parts.minute) < Number(config.hour) * 60 + Number(config.minute)) return row;
  }

  try {
    const delivered = await deliverOnce(row.deliveryKey, async claimed => {
      const payload = claimed.parsedPayload;
      if (payload.message.embeds?.[0]) {
        payload.message.embeds[0].footer = cleanDailyFooter(payload.message.embeds[0].footer, metadata.marker);
      }
      let target;
      if (row.type === 'DAILY_FACT_DM' || row.type === 'DAILY_REMINDER') {
        if (row.type === 'DAILY_REMINDER') {
          const post = get('SELECT channelId FROM daily_interaction_posts WHERE messageId = ?', [metadata.postId]);
          const channel = await client.channels.fetch(post.channelId);
          const member = await channel.guild.members.fetch(metadata.userId).catch(error => {
            if (Number(error.code) === 10007) return null;
            throw error;
          });
          if (!member || !channel.permissionsFor(member)?.has(['ViewChannel', 'ReadMessageHistory'])) {
            throw Object.assign(new Error('Reminder recipient cannot access the activity.'), { code: 'DAILY_REMINDER_ACCESS' });
          }
        }
        const user = await client.users.fetch(metadata.userId);
        target = await user.createDM();
      } else {
        target = await client.channels.fetch(row.channelId);
      }
      if (!target?.isTextBased()) throw new Error('Daily content channel is unavailable.');
      if (row.type === 'DAILY_INTERACTION_RESPONSE' && target.locked) {
        throw Object.assign(new Error('This discussion was locked by staff.'), { code: 'DAILY_THREAD_LOCKED' });
      }
      const send = async () => {
        if (row.type === 'DAILY_REMINDER') {
          const preference = get('SELECT reminders FROM daily_member_preferences WHERE guildId = ? AND userId = ?', [row.guildId, metadata.userId]);
          if (!preference?.reminders || !require('./dailyEngagement').engagementSettings(row.guildId).remindersEnabled ||
              get('SELECT 1 FROM daily_interaction_participants WHERE messageId = ? AND userId = ?', [metadata.postId, metadata.userId])) {
            throw Object.assign(new Error('Reminder is no longer wanted.'), { code: 'DAILY_REMINDER_ACCESS' });
          }
        }
        if ((claimed.attempts > 1 || metadata.recoverExisting) && target.messages?.fetch) {
          const history = await target.messages.fetch({ limit: 100 });
          const existing = history.find(item => item.author?.id === client.user?.id &&
            item.embeds?.some(embed => (embed.footer?.text || embed.data?.footer?.text || '').includes(metadata.marker) ||
              (row.type === 'DAILY_FACT_REVIEW' && (embed.fields || embed.data?.fields || [])
                .some(field => field.name === 'Submission ID' && field.value === `#${metadata.submissionId}`))));
          if (existing) return existing;
        }
        return target.send({ ...payload.message, nonce: deliveryNonce(row.deliveryKey), enforceNonce: true });
      };
      let message;
      if (metadata.editMessageId) {
        const edit = async () => {
          const existing = await fetchDailyMessage(target, metadata.editMessageId).catch(error => {
            if (row.type === 'DAILY_INTERACTION_RESPONSE' && Number(error.code) === 10008) return null;
            throw error;
          });
          let update = payload.message;
          if (existing && row.type === 'DAILY_ACTIVITY_UPDATE') {
            const { EmbedBuilder } = require('discord.js');
            const fresh = EmbedBuilder.from(existing.embeds[0]);
            const names = metadata.reveal ? ['Trivia Result', 'Status'] : metadata.choiceHash ? ['Choice Results'] : ['Current Game'];
            const additions = payload.message.embeds[0].fields.filter(field => names.includes(field.name));
            fresh.setFields([...(fresh.data.fields || []).filter(field => !names.includes(field.name)), ...additions]);
            fresh.setFooter(payload.message.embeds[0].footer);
            update = { ...update, embeds: [fresh] };
          }
          return existing ? existing.edit(update) : send();
        };
        message = row.type === 'DAILY_ACTIVITY_UPDATE'
          ? await withDailyDisplayLock(metadata.postId, edit) : await edit();
      } else {
        message = await send();
      }
      if (!message?.id) throw new Error('Discord did not return a message ID for daily content.');
      return message;
    });
    return finalizeDailyDelivery(delivered);
  } catch (error) {
    if (Number(error.code) === 50007 || error.code === 'DAILY_THREAD_LOCKED' || error.code === 'DAILY_REMINDER_ACCESS' ||
        (metadata.editMessageId && Number(error.code) === 10008)) {
      return cancelDailyDelivery(row);
    }
    throw error;
  }
}

function queueDailyDelivery({ deliveryKey, type, guildId, channelId = null, message, metadata }) {
  const existing = getDailyDelivery(deliveryKey);
  if (existing && existing.status !== 'CANCELLED') return existing;
  const payload = JSON.parse(JSON.stringify(message));
  payload.embeds ||= [{ footer: { text: 'Jabster Studios Daily Interactions' } }];
  const marker = (metadata.editMessageId && dailyReference(payload.embeds[0].footer?.text))
    || `Ref: ${deliveryNonce(deliveryKey)}`;
  payload.embeds[0].footer = cleanDailyFooter(payload.embeds[0].footer, marker);
  const row = enqueueDelivery({ deliveryKey, type, guildId, channelId,
    payload: { message: payload, daily: { ...metadata, marker } } });
  if (existing?.status === 'CANCELLED') {
    run(`UPDATE delivery_outbox SET status = 'PENDING', finalizedAt = NULL,
         nextAttemptAt = 0, attempts = 0, createdAt = ? WHERE deliveryKey = ?`,
    [Date.now(), deliveryKey]);
  }
  return existing ? getDailyDelivery(deliveryKey) : row;
}

async function recoverDailyDeliveries(client, types = DAILY_TYPES) {
  const rows = all(`SELECT * FROM delivery_outbox WHERE type IN (${types.map(() => '?').join(',')})
    AND ((status = 'SENT' AND finalizedAt IS NULL) OR
      (status IN ('PENDING', 'FAILED', 'PROCESSING') AND nextAttemptAt <= ?))
    ORDER BY createdAt ASC LIMIT 100`, [...types, Date.now()]);
  for (const row of rows) {
    try { await attemptDailyDelivery(client, row); }
    catch (error) { console.error(`Daily content recovery ${row.deliveryKey}:`, error.message); }
  }
}

module.exports = { attemptDailyDelivery, dailyMetadata, finalizeDailyDelivery, getDailyDelivery,
  newDailyKey, pendingDailyKeys, queueDailyDelivery, recoverDailyDeliveries };
