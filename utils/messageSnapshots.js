const {
  get,
  run,
  transaction
} = require('../database');

const {
  getLogDestination
} = require('./loggingConfig');

const {
  serialiseDeletedMessage,
  snapshotMessage
} = require('./deletedMessageCopy');

const pendingSnapshots = new Map();

function writeSnapshots(rows) {
  transaction(() => {
    for (const row of rows) {
      run(
        `INSERT INTO message_snapshots (
           messageId, guildId, channelId, authorId, authorTag,
           content, embeds, attachments, stickers, createdAt, updatedAt
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(messageId) DO UPDATE SET
           channelId = excluded.channelId,
           authorId = excluded.authorId,
           authorTag = excluded.authorTag,
           content = excluded.content,
           embeds = excluded.embeds,
           attachments = excluded.attachments,
           stickers = excluded.stickers,
           updatedAt = excluded.updatedAt`,
        [
          row.messageId,
          row.guildId,
          row.channelId,
          row.authorId,
          row.authorTag,
          row.content,
          JSON.stringify(row.embeds),
          JSON.stringify(row.attachments),
          JSON.stringify(row.stickers),
          row.createdAt,
          row.updatedAt
        ]
      );
    }
  });
}

function flushMessageSnapshots() {
  if (!pendingSnapshots.size) return 0;
  const rows = [...pendingSnapshots.values()];
  pendingSnapshots.clear();

  try {
    writeSnapshots(rows);
  } catch (error) {
    for (const row of rows) {
      if (!pendingSnapshots.has(row.messageId)) {
        pendingSnapshots.set(row.messageId, row);
      }
    }
    throw error;
  }

  return rows.length;
}

function captureMessageSnapshot(message) {
  if (!message?.guild || !message?.id || !message.author?.id) return;
  if (!getLogDestination(message.guild.id, 'MESSAGES').enabled) return;

  const snapshot = serialiseDeletedMessage(message);
  const existing = pendingSnapshots.get(snapshot.messageId);
  const now = Date.now();

  pendingSnapshots.set(snapshot.messageId, {
    ...snapshot,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  });
}

function readJson(value, fallback) {
  try {
    const parsed = JSON.parse(value || '');
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function getMessageSnapshot(messageId) {
  const pending = pendingSnapshots.get(messageId);
  if (pending) return snapshotMessage(pending);

  const row = get(
    `SELECT *
     FROM message_snapshots
     WHERE messageId = ?`,
    [messageId]
  );

  if (!row) return null;

  return snapshotMessage({
    ...row,
    embeds: readJson(row.embeds, []),
    attachments: readJson(row.attachments, []),
    stickers: readJson(row.stickers, [])
  });
}

const flushInterval = setInterval(() => {
  try {
    flushMessageSnapshots();
  } catch (error) {
    console.error('Message snapshot batch flush failed:', error);
  }
}, 500);
flushInterval.unref?.();

module.exports = {
  captureMessageSnapshot,
  flushMessageSnapshots,
  getMessageSnapshot
};
