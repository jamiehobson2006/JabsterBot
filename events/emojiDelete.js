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
  name: 'emojiDelete',

  async execute(emoji, client) {
    try {
      const audit = await findRecentAuditLog(
        emoji.guild,
        AuditLogEvent.EmojiDelete,
        emoji.id
      );

      await logAudit(client, emoji.guild.id, {
        action: 'EMOJI_DELETED',
        targetId: emoji.id,
        executorId: audit?.executor?.id,
        type: 'SERVER',
        metadata: {
          emojiId: emoji.id,
          emojiName: emoji.name,
          animated: emoji.animated
        },
        embed: createAuditEmbed({
          action: 'Emoji Deleted',
          target: `${emoji.name || 'Unknown emoji'}\n${emoji.id}`,
          executor: formatExecutor(audit),
          reason: audit?.reason || undefined,
          extra: `Animated: ${Boolean(emoji.animated)}`,
          color: 0xED4245
        })
      });
    } catch (err) {
      console.error('EmojiDelete Error:', err);
    }
  }
};
