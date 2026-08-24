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
  name: 'guildScheduledEventUpdate',

  async execute(oldEvent, newEvent, client) {
    try {
      const changes = [];

      if (oldEvent.name !== newEvent.name) {
        changes.push(`Name: ${oldEvent.name} -> ${newEvent.name}`);
      }

      if (oldEvent.description !== newEvent.description) {
        changes.push('Description changed');
      }

      if (oldEvent.channelId !== newEvent.channelId) {
        changes.push(`Channel: ${oldEvent.channelId || 'External'} -> ${newEvent.channelId || 'External'}`);
      }

      if (oldEvent.scheduledStartTimestamp !== newEvent.scheduledStartTimestamp) {
        changes.push(`Start: ${formatTime(oldEvent.scheduledStartTimestamp)} -> ${formatTime(newEvent.scheduledStartTimestamp)}`);
      }

      if (oldEvent.scheduledEndTimestamp !== newEvent.scheduledEndTimestamp) {
        changes.push(`End: ${formatTime(oldEvent.scheduledEndTimestamp)} -> ${formatTime(newEvent.scheduledEndTimestamp)}`);
      }

      if (oldEvent.status !== newEvent.status) {
        changes.push(`Status: ${oldEvent.status} -> ${newEvent.status}`);
      }

      if (!changes.length) {
        return;
      }

      const audit = await findRecentAuditLog(
        newEvent.guild,
        AuditLogEvent.GuildScheduledEventUpdate,
        newEvent.id
      );

      await logAudit(client, newEvent.guild.id, {
        action: 'SCHEDULED_EVENT_UPDATED',
        targetId: newEvent.id,
        executorId: audit?.executor?.id,
        type: 'SERVER',
        metadata: {
          eventId: newEvent.id,
          changes
        },
        embed: createAuditEmbed({
          action: 'Scheduled Event Updated',
          target: `${newEvent.name}\n${newEvent.id}`,
          executor: formatExecutor(audit),
          reason: audit?.reason || undefined,
          channel: newEvent.channelId
            ? `<#${newEvent.channelId}>`
            : 'External event',
          extra: changes.join('\n'),
          color: 0xFEE75C
        })
      });
    } catch (err) {
      console.error('GuildScheduledEventUpdate Error:', err);
    }
  }
};
