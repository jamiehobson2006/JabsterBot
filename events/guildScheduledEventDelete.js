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
  name: 'guildScheduledEventDelete',

  async execute(event, client) {
    try {
      const audit = await findRecentAuditLog(
        event.guild,
        AuditLogEvent.GuildScheduledEventDelete,
        event.id
      );

      await logAudit(client, event.guild.id, {
        action: 'SCHEDULED_EVENT_DELETED',
        targetId: event.id,
        executorId: audit?.executor?.id,
        type: 'SERVER',
        metadata: {
          eventId: event.id,
          channelId: event.channelId || null,
          name: event.name
        },
        embed: createAuditEmbed({
          action: 'Scheduled Event Deleted',
          target: `${event.name}\n${event.id}`,
          executor: formatExecutor(audit),
          reason: audit?.reason || undefined,
          channel: event.channelId
            ? `<#${event.channelId}>`
            : 'External event',
          color: 0xED4245
        })
      });
    } catch (err) {
      console.error('GuildScheduledEventDelete Error:', err);
    }
  }
};
