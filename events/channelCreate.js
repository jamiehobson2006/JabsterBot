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

  name: 'channelCreate',

  async execute(channel, client) {

    try {

      if (!channel.guild) {
        return;
      }

      const audit =
        await findRecentAuditLog(
          channel.guild,
          AuditLogEvent.ChannelCreate,
          channel.id
        );

      await logAudit(
        client,
        channel.guild.id,
        {
          action: 'CHANNEL_CREATED',
          targetId: channel.id,
          executorId: audit?.executor?.id,
          type: 'SERVER',
          metadata: {
            channelId: channel.id,
            channelName: channel.name
          },
          embed: createAuditEmbed({
            action: 'Channel Created',
            target: formatChannel(channel),
            executor: formatExecutor(audit),
            reason: audit?.reason || undefined,
            extra: `Type: ${channel.type}`,
            color: 0x57F287
          })
        }
      );

    } catch (err) {

      console.error(
        'ChannelCreate Error:',
        err
      );
    }
  }
};
