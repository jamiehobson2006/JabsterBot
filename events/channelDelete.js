const { Events } = require('discord.js');
const { createAuditEmbed, logAudit } = require('../utils/logger');

module.exports = {
  name: Events.ChannelDelete,
  async execute(channel) {
    if (!channel.guild) return;

    await logAudit(channel.client, channel.guild.id, {
      action: 'CHANNEL_DELETE',
      targetId: channel.id,
      metadata: { channelName: channel.name, type: channel.type },
      embed: createAuditEmbed({
        action: 'Channel Deleted',
        target: channel.name,
        extra: `Type: ${channel.type}`,
        color: 'Red',
      }),
    });
  },
};
