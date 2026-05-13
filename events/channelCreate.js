const { Events } = require('discord.js');
const { createAuditEmbed, logAudit } = require('../utils/logger');

module.exports = {
  name: Events.ChannelCreate,
  async execute(channel) {
    if (!channel.guild) return;

    await logAudit(channel.client, channel.guild.id, {
      action: 'CHANNEL_CREATE',
      targetId: channel.id,
      metadata: { channelName: channel.name, type: channel.type },
      embed: createAuditEmbed({
        action: 'Channel Created',
        target: `${channel} (${channel.name})`,
        extra: `Type: ${channel.type}`,
        color: 'Green',
      }),
    });
  },
};
