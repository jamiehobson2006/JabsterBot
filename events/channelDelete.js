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

  name: 'channelDelete',

  async execute(channel, client) {

    try {

      if (!channel.guild) {
        return;
      }

      const audit =
        await findRecentAuditLog(
          channel.guild,
          AuditLogEvent.ChannelDelete,
          channel.id
        );

      await logAudit(
        client,
        channel.guild.id,
        {
          action: 'CHANNEL_DELETED',
          targetId: channel.id,
          executorId: audit?.executor?.id,
          type: 'SERVER',
          metadata: {
            channelId: channel.id,
            channelName: channel.name
          },
          embed: createAuditEmbed({
            action: 'Channel Deleted',
            target: formatChannel(channel),
            executor: formatExecutor(audit),
            reason: audit?.reason || undefined,
            color: 0xED4245
          })
        }
      );

    } catch (err) {

      console.error(
        'ChannelDelete Error:',
        err
      );
    }
  }
};
