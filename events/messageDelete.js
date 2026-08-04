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

const {
  consumeSuppressedMessageDelete
} = require('../utils/messageDeletionTracker');

const {
  describeDeletedMessage
} = require('../utils/deletedMessageSummary');

module.exports = {
  name: 'messageDelete',

  async execute(message, client) {
    try {
      if (consumeSuppressedMessageDelete(message.id)) {
        return;
      }

      if (message.partial) {
        message = await message.fetch().catch(() => message);
      }

      if (!message.guild || message.author?.bot) {
        return;
      }

      const audit = await findRecentAuditLog(
        message.guild,
        AuditLogEvent.MessageDelete,
        message.author?.id
      );

      await logAudit(
        client,
        message.guild.id,
        {
          action: 'MESSAGE_DELETED',
          targetId: message.author?.id,
          executorId: audit?.executor?.id,
          type: 'MESSAGES',
          metadata: {
            channelId: message.channel?.id,
            messageId: message.id,
            content: message.content || null,
            embedSummary: describeDeletedMessage(message),
            attachments: message.attachments?.map(item => item.url) || [],
            deletedBy: audit?.executor?.id || null
          },
          embed: createAuditEmbed({
            action: 'Message Deleted',
            target: `${message.author?.tag || 'Unknown'}\n<@${message.author?.id || 'unknown'}>`,
            executor: audit
              ? formatExecutor(audit)
              : 'Author or unknown',
            channel: message.channel?.id
              ? `<#${message.channel.id}>`
              : 'Unknown',
            reason: audit?.reason || undefined,
            extra: describeDeletedMessage(message),
            color: 0xED4245
          })
        }
      );
    } catch (err) {
      console.error('MessageDelete Error:', err);
    }
  }
};
