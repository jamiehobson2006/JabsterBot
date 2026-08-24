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
  name: 'emojiCreate',

  async execute(emoji, client) {
    try {
      const audit = await findRecentAuditLog(
        emoji.guild,
        AuditLogEvent.EmojiCreate,
        emoji.id
      );

      await logAudit(client, emoji.guild.id, {
        action: 'EMOJI_CREATED',
        targetId: emoji.id,
        executorId: audit?.executor?.id,
        type: 'SERVER',
        metadata: {
          emojiId: emoji.id,
          emojiName: emoji.name,
          animated: emoji.animated
        },
        embed: createAuditEmbed({
          action: 'Emoji Created',
          target: `${emoji} ${emoji.name}\n${emoji.id}`,
          executor: formatExecutor(audit),
          reason: audit?.reason || undefined,
          extra: `Animated: ${Boolean(emoji.animated)}`,
          color: 0x57F287
        })
      });
    } catch (err) {
      console.error('EmojiCreate Error:', err);
    }
  }
};
