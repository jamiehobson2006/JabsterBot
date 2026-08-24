const {
  AuditLogEvent
} = require('discord.js');

const {
  createAuditEmbed,
  logAudit
} = require('../utils/logger');

const {
  findRecentAuditLog,
  formatExecutor
} = require('../utils/auditLookup');

module.exports = {
  name: 'emojiUpdate',

  async execute(oldEmoji, newEmoji, client) {
    try {
      if (oldEmoji.name === newEmoji.name) {
        return;
      }

      const audit = await findRecentAuditLog(
        newEmoji.guild,
        AuditLogEvent.EmojiUpdate,
        newEmoji.id
      );

      await logAudit(client, newEmoji.guild.id, {
        action: 'EMOJI_UPDATED',
        targetId: newEmoji.id,
        executorId: audit?.executor?.id,
        type: 'SERVER',
        metadata: {
          emojiId: newEmoji.id,
          before: oldEmoji.name,
          after: newEmoji.name
        },
        embed: createAuditEmbed({
          action: 'Emoji Updated',
          target: `${newEmoji}\n${newEmoji.id}`,
          executor: formatExecutor(audit),
          reason: audit?.reason || undefined,
          extra: `Name: ${oldEmoji.name} -> ${newEmoji.name}`,
          color: 0xFEE75C
        })
      });
    } catch (err) {
      console.error('EmojiUpdate Error:', err);
    }
  }
};
