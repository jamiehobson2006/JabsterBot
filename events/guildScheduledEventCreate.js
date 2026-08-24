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

function formatTime(timestamp) {
  return timestamp
    ? `<t:${Math.floor(timestamp / 1000)}:F>`
    : 'Not set';
}

module.exports = {
  name: 'guildScheduledEventCreate',

  async execute(event, client) {
    try {
      const audit = await findRecentAuditLog(
        event.guild,
        AuditLogEvent.GuildScheduledEventCreate,
        event.id
      );

      await logAudit(client, event.guild.id, {
        action: 'SCHEDULED_EVENT_CREATED',
        targetId: event.id,
        executorId: audit?.executor?.id,
        type: 'SERVER',
        metadata: {
          eventId: event.id,
          channelId: event.channelId || null,
          name: event.name,
          scheduledStartTimestamp: event.scheduledStartTimestamp,
          scheduledEndTimestamp: event.scheduledEndTimestamp || null
        },
        embed: createAuditEmbed({
          action: 'Scheduled Event Created',
          target: `${event.name}\n${event.id}`,
          executor: formatExecutor(audit),
          reason: audit?.reason || undefined,
          channel: event.channelId
            ? `<#${event.channelId}>`
            : 'External event',
          extra:
            `Starts: ${formatTime(event.scheduledStartTimestamp)}\n` +
            `Ends: ${formatTime(event.scheduledEndTimestamp)}`,
          color: 0x57F287
        })
      });
    } catch (err) {
      console.error('GuildScheduledEventCreate Error:', err);
    }
  }
};
