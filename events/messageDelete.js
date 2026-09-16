const {
  AuditLogEvent
} = require('discord.js');

const {
  createAuditEmbed,
  logAudit,
  sendLog
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

const {
  buildDeletedMessageCopy
} = require('../utils/deletedMessageCopy');

const {
  getMessageSnapshot
} = require('../utils/messageSnapshots');

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

      const snapshot = getMessageSnapshot(message.id);
      const loggedMessage = snapshot || message;
      const guild = message.guild || await client.guilds.fetch(loggedMessage.guildId).catch(() => null);

      if (!guild || loggedMessage.author?.bot) {
        return;
      }

      const visualCopy = await buildDeletedMessageCopy(loggedMessage);

      const audit = await findRecentAuditLog(
        guild,
        AuditLogEvent.MessageDelete,
        loggedMessage.author?.id
      );

      await logAudit(
        client,
        guild.id,
        {
          action: 'MESSAGE_DELETED',
          targetId: loggedMessage.author?.id,
          executorId: audit?.executor?.id,
          type: 'MESSAGES',
          metadata: {
            channelId: loggedMessage.channel?.id,
            messageId: message.id,
            content: loggedMessage.content || null,
            embedSummary: describeDeletedMessage(loggedMessage),
            attachments: loggedMessage.attachments?.map(item => item.url) || [],
            deletedBy: audit?.executor?.id || null
          },
          embed: createAuditEmbed({
            action: 'Message Deleted',
            target: `${loggedMessage.author?.tag || 'Unknown'}\n<@${loggedMessage.author?.id || 'unknown'}>`,
            executor: audit
              ? formatExecutor(audit)
              : 'Author or unknown',
            channel: loggedMessage.channel?.id
              ? `<#${loggedMessage.channel.id}>`
              : 'Unknown',
            reason: audit?.reason || undefined,
            extra: `${describeDeletedMessage(loggedMessage)}${visualCopy ? '\n\nA visual copy of the deleted message is posted below.' : ''}`,
            color: 0xED4245
          })
        }
      );

      if (visualCopy) {
        const sent = await sendLog(client, guild.id, 'MESSAGES', visualCopy);

        if (!sent && visualCopy.files?.length) {
          await sendLog(client, guild.id, 'MESSAGES', {
            ...visualCopy,
            files: []
          });
        }
      }
    } catch (err) {
      console.error('MessageDelete Error:', err);
    }
  }
};
