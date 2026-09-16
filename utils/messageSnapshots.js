const {
  get,
  run
} = require('../database');

const {
  getLogDestination
} = require('./loggingConfig');

const {
  serialiseDeletedMessage,
  snapshotMessage
} = require('./deletedMessageCopy');

function captureMessageSnapshot(message) {
  if (!message?.guild || !message?.id || !message.author?.id) return;
  if (!getLogDestination(message.guild.id, 'MESSAGES').enabled) return;

  const snapshot = serialiseDeletedMessage(message);
  const now = Date.now();

  run(
    `INSERT INTO message_snapshots (
       messageId, guildId, channelId, authorId, authorTag,
       content, embeds, attachments, stickers, createdAt, updatedAt
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(messageId)
     DO UPDATE SET channelId = excluded.channelId,
                   authorId = excluded.authorId,
                   authorTag = excluded.authorTag,
                   content = excluded.content,
                   embeds = excluded.embeds,
                   attachments = excluded.attachments,
                   stickers = excluded.stickers,
                   updatedAt = excluded.updatedAt`,
    [
      snapshot.messageId,
      snapshot.guildId,
      snapshot.channelId,
      snapshot.authorId,
      snapshot.authorTag,
      snapshot.content,
      JSON.stringify(snapshot.embeds),
      JSON.stringify(snapshot.attachments),
      JSON.stringify(snapshot.stickers),
      now,
      now
    ]
  );
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

module.exports = {
  captureMessageSnapshot,
  getMessageSnapshot
};
