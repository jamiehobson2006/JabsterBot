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

function formatChannel(channel) {

  return `${channel.name || 'Unknown'}\n${channel.id}`;
}

module.exports = {

  name: 'channelUpdate',

  async execute(oldChannel, newChannel, client) {

    try {

      if (!newChannel.guild) {
        return;
      }

      const changes = [];

      if (oldChannel.name !== newChannel.name) {
        changes.push(`Name: ${oldChannel.name} -> ${newChannel.name}`);
      }

      if (oldChannel.parentId !== newChannel.parentId) {
        changes.push(`Category: ${oldChannel.parentId || 'None'} -> ${newChannel.parentId || 'None'}`);
      }

      if (oldChannel.topic !== newChannel.topic) {
        changes.push('Topic changed');
      }

      if (oldChannel.nsfw !== newChannel.nsfw) {
        changes.push(`NSFW: ${oldChannel.nsfw} -> ${newChannel.nsfw}`);
      }

      if (
        oldChannel.rateLimitPerUser !==
        newChannel.rateLimitPerUser
      ) {
        changes.push(`Slowmode: ${oldChannel.rateLimitPerUser || 0}s -> ${newChannel.rateLimitPerUser || 0}s`);
      }

      if (!changes.length) {
        changes.push('Permissions or channel settings changed');
      }

      const audit =
        await findRecentAuditLog(
          newChannel.guild,
          AuditLogEvent.ChannelUpdate,
          newChannel.id
        );

      await logAudit(
        client,
        newChannel.guild.id,
        {
          action: 'CHANNEL_UPDATED',
          targetId: newChannel.id,
          executorId: audit?.executor?.id,
          type: 'SERVER',
          metadata: {
            channelId: newChannel.id,
            changes
          },
          embed: createAuditEmbed({
            action: 'Channel Updated',
            target: formatChannel(newChannel),
            executor: formatExecutor(audit),
            reason: audit?.reason || undefined,
            extra: changes.join('\n'),
            color: 0xFEE75C
          })
        }
      );

    } catch (err) {

      console.error(
        'ChannelUpdate Error:',
        err
      );
    }
  }
};
