const {
  AttachmentBuilder,
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

function formatDeletedMessage(message) {
  const author = message.author
    ? `${message.author.tag} (${message.author.id})`
    : 'Unknown author';
  const content = message.content || '*No text content*';
  const attachments = message.attachments?.size
    ? ` | Attachments: ${message.attachments.size}`
    : '';

  return `[${message.id}] ${author}\n${content}${attachments}`;
}

module.exports = {
  name: 'messageDeleteBulk',

  async execute(messages, channel, client) {
    try {
      if (!channel?.guild || !messages?.size) {
        return;
      }

      const deletedMessages = [...messages.values()]
        .filter(message => !message.author?.bot);

      if (!deletedMessages.length) {
        return;
      }

      const audit = await findRecentAuditLog(
        channel.guild,
        AuditLogEvent.MessageBulkDelete
      );

      const report = [
        `Deleted ${deletedMessages.length} message(s) from #${channel.name}`,
        '',
        ...deletedMessages.map(formatDeletedMessage)
      ].join('\n\n');

      const preview = deletedMessages
        .slice(0, 5)
        .map(message => `- ${message.author?.tag || 'Unknown'}: ${message.content || '*No text content*'}`)
        .join('\n');

      await logAudit(
        client,
        channel.guild.id,
        {
          action: 'MESSAGES_BULK_DELETED',
          executorId: audit?.executor?.id,
          type: 'MESSAGES',
          metadata: {
            channelId: channel.id,
            count: deletedMessages.length,
            messageIds: deletedMessages.map(message => message.id),
            deletedBy: audit?.executor?.id || null
          },
          files: [
            new AttachmentBuilder(Buffer.from(report, 'utf8'), {
              name: `deleted-messages-${channel.id}-${Date.now()}.txt`
            })
          ],
          embed: createAuditEmbed({
            action: 'Messages Bulk Deleted',
            target: `${deletedMessages.length} message(s)`,
            executor: audit
              ? formatExecutor(audit)
              : 'Unknown',
            channel: `<#${channel.id}>`,
            reason: audit?.reason || undefined,
            extra:
              `${preview || '*No text content*'}\n\n` +
              'A complete deleted-message report is attached.',
            color: 0xED4245
          })
        }
      );
    } catch (err) {
      console.error('MessageDeleteBulk Error:', err);
    }
  }
};
