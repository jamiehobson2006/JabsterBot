const crypto = require('node:crypto');
const {
  all,
  get,
  run,
  transaction
} = require('../database');

const DEFAULT_LEASE_MS = 60_000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;
const running = new Set();

function cleanError(error) {
  return require('./safeLogging').redactText(error?.message || error || 'Unknown delivery error').slice(0, 1500);
}

function enqueueDelivery({
  deliveryKey,
  type,
  guildId = null,
  channelId = null,
  payload = null,
  nextAttemptAt = 0
}) {
  if (!deliveryKey || !type) throw new TypeError('deliveryKey and type are required.');

  const now = Date.now();
  run(
    `INSERT INTO delivery_outbox (
       deliveryKey, type, guildId, channelId, payload, status,
       nextAttemptAt, createdAt, updatedAt
     ) VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)
     ON CONFLICT(deliveryKey) DO UPDATE SET
       payload = CASE
         WHEN delivery_outbox.status IN ('SENT','PROCESSING','UNCERTAIN') OR delivery_outbox.uncertainSince IS NOT NULL THEN delivery_outbox.payload
         ELSE excluded.payload
       END,
       channelId = CASE
         WHEN delivery_outbox.status IN ('SENT','PROCESSING','UNCERTAIN') OR delivery_outbox.uncertainSince IS NOT NULL THEN delivery_outbox.channelId
         ELSE excluded.channelId
       END,
       updatedAt = CASE
         WHEN delivery_outbox.status = 'SENT' THEN delivery_outbox.updatedAt
         ELSE excluded.updatedAt
       END`,
    [
      String(deliveryKey),
      String(type),
      guildId,
      channelId,
      payload == null ? null : JSON.stringify(payload),
      Math.max(0, Number(nextAttemptAt) || 0),
      now,
      now
    ]
  );

  return get('SELECT * FROM delivery_outbox WHERE deliveryKey = ?', [String(deliveryKey)]);
}

function claimDelivery(deliveryKey, leaseMs = DEFAULT_LEASE_MS) {
  return transaction(() => {
    const now = Date.now();
    const row = get(
      `SELECT * FROM delivery_outbox
       WHERE deliveryKey = ?
          AND status IN ('PENDING', 'FAILED', 'PROCESSING')
         AND nextAttemptAt <= ?
         AND (leaseUntil IS NULL OR leaseUntil < ?)`,
      [String(deliveryKey), now, now]
    );
    if (!row) return null;

    run(
      `UPDATE delivery_outbox
       SET uncertainSince = CASE WHEN status='PROCESSING' THEN COALESCE(uncertainSince,updatedAt) ELSE uncertainSince END,
           status = 'PROCESSING', leaseUntil = ?, attempts = attempts + 1, updatedAt = ?
       WHERE deliveryKey = ?`,
      [now + Math.max(5_000, Number(leaseMs) || DEFAULT_LEASE_MS), now, row.deliveryKey]
    );

    return get('SELECT * FROM delivery_outbox WHERE deliveryKey = ?', [row.deliveryKey]);
  });
}

function markDeliverySent(deliveryKey, messageId = null) {
  const now = Date.now();
  run(
    `UPDATE delivery_outbox
     SET status = 'SENT', messageId = ?, sentAt = ?, updatedAt = ?,
         leaseUntil = NULL, lastError = NULL
     WHERE deliveryKey = ?`,
    [messageId, now, now, String(deliveryKey)]
  );
}

function markDeliveryFailed(deliveryKey, error) {
  const row = get(
    'SELECT attempts FROM delivery_outbox WHERE deliveryKey = ?',
    [String(deliveryKey)]
  );
  const attempts = Math.max(1, Number(row?.attempts) || 1);
  const backoff = Math.min(MAX_BACKOFF_MS, 5_000 * (2 ** Math.min(attempts - 1, 8)));
  const now = Date.now();
  const uncertain = error?.deliveryMayHaveBeenSent === true;

  run(
    `UPDATE delivery_outbox
     SET status = ?, leaseUntil = NULL, nextAttemptAt = ?,
         lastError = ?, updatedAt = ?, uncertainSince = CASE WHEN ? THEN COALESCE(uncertainSince,?) ELSE uncertainSince END
     WHERE deliveryKey = ?`,
    [error?.code === 'DELIVERY_UNCERTAIN' ? 'UNCERTAIN' : 'FAILED', now + backoff, cleanError(error), now, uncertain ? 1 : 0, now, String(deliveryKey)]
  );
}

function pendingDeliveries(type = null, limit = 50) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 250);
  const now = Date.now();

  if (type) {
    return all(
      `SELECT * FROM delivery_outbox
       WHERE type = ? AND status IN ('PENDING', 'FAILED', 'PROCESSING') AND nextAttemptAt <= ?
         AND (leaseUntil IS NULL OR leaseUntil < ?)
       ORDER BY createdAt ASC LIMIT ?`,
      [String(type), now, now, safeLimit]
    );
  }

  return all(
    `SELECT * FROM delivery_outbox
     WHERE status IN ('PENDING', 'FAILED', 'PROCESSING') AND nextAttemptAt <= ?
       AND (leaseUntil IS NULL OR leaseUntil < ?)
     ORDER BY createdAt ASC LIMIT ?`,
    [now, now, safeLimit]
  );
}

async function deliverOnce(deliveryKey, sender, options = {}) {
  if (running.has(deliveryKey)) return null;
  const claimed = claimDelivery(deliveryKey, options.leaseMs);
  if (!claimed) {
    return get('SELECT * FROM delivery_outbox WHERE deliveryKey = ?', [String(deliveryKey)]);
  }

  running.add(deliveryKey);
  try {
    const result = await sender({
      ...claimed,
      parsedPayload: claimed.payload ? JSON.parse(claimed.payload) : null
    });
    const messageId = result?.id || result?.messageId || null;
    markDeliverySent(deliveryKey, messageId);
    return get('SELECT * FROM delivery_outbox WHERE deliveryKey = ?', [String(deliveryKey)]);
  } catch (error) {
    markDeliveryFailed(deliveryKey, error);
    throw error;
  } finally {
    running.delete(deliveryKey);
  }
}

function deliveryNonce(deliveryKey) {
  return crypto.createHash('sha256').update(String(deliveryKey)).digest('hex').slice(0, 24);
}

async function sendQueuedMessage(channel, delivery, payload, { beforeSend = null } = {}) {
  if (delivery.attempts > 1) payload = delivery.parsedPayload?.message || payload;
  const nonce = deliveryNonce(delivery.deliveryKey);
  const botId = channel.client?.user?.id || channel.guild?.members?.me?.id;
  if (delivery.attempts > 1 && channel.messages?.fetch) {
    let before;
    const { sameMessage, isRecentDelivery } = require('./messageRecovery');
    for (let page = 0; page < 10; page += 1) {
      const recent = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
      const existing = recent.find(message => botId && message.author?.id === botId &&
        (String(message.nonce) === nonce || isRecentDelivery(message, delivery) && sameMessage(message, payload)));
      if (existing) return existing;
      if (recent.size < 100 || recent.some(message => !isRecentDelivery(message, delivery))) break;
      before = recent.last()?.id;
      if (!before) break;
    }
  }
  // A lost HTTP response is not proof of a failed send. After the short nonce
  // window, pause uncertain work instead of posting a duplicate blindly.
  if (delivery.uncertainSince && Date.now() - Number(delivery.uncertainSince) > 120_000) {
    throw Object.assign(new Error('Delivery outcome could not be verified. Administrator review is required before resending.'), { code: 'DELIVERY_UNCERTAIN' });
  }
  try {
    if (beforeSend) await beforeSend();
    return await channel.send({ ...payload, nonce, enforceNonce: true });
  }
  catch (error) {
    const status = Number(error.status || error.response?.status);
    error.deliveryMayHaveBeenSent = !status || status >= 500;
    throw error;
  }
}

async function retryChannelDeliveries(client) {
  await require('./publicMessageCleanup').cleanupPublicReferences(client).catch(error => console.error('Public display cleanup:', error.message));
  let sent = 0;
  for (const row of pendingDeliveries()) {
    if (row.type === 'LOG_BURST') {
      try {
        const result = await require('./logBursts').deliverLogBurst(client, row);
        if (result?.status === 'SENT') sent += 1;
      } catch (error) { console.error('Queued log burst:', error.message); }
      continue;
    }
    let payload;
    try {
      payload = JSON.parse(row.payload || 'null');
    } catch {
      continue;
    }
    if (payload?.daily) {
      try {
        const result = await require('./dailyDelivery').attemptDailyDelivery(client, row);
        if (result?.status === 'SENT') sent += 1;
      } catch (error) {
        console.error(`Daily delivery ${row.deliveryKey} failed:`, error.message);
      }
      continue;
    }
    if (!payload?.message || !row.channelId) continue;
    try {
      const delivery = await deliverOnce(row.deliveryKey, async claimed => {
        const channel = await client.channels.fetch(row.channelId);
        if (!channel?.isTextBased()) throw new Error('Delivery channel is unavailable.');
        return sendQueuedMessage(channel, claimed, payload.message);
      });
      if (delivery?.status === 'SENT') sent += 1;
    } catch (error) {
      console.error(`Queued delivery ${row.deliveryKey} failed:`, error.message);
    }
  }
  return sent;
}

function startDeliveryWorker(client) {
  const { startManagedLoop } = require('./serviceRunner');
  return startManagedLoop('delivery-outbox', () => retryChannelDeliveries(client), 30_000,
    { timeoutMs: 60_000 });
}

module.exports = {
  claimDelivery,
  deliverOnce,
  enqueueDelivery,
  markDeliveryFailed,
  markDeliverySent,
  pendingDeliveries,
  deliveryNonce,
  retryChannelDeliveries,
  sendQueuedMessage,
  startDeliveryWorker
};
