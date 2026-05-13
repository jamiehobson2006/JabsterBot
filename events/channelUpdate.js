const { Events } = require('discord.js');
const { createAuditEmbed, logAudit } = require('../utils/logger');

module.exports = {
  name: Events.ChannelUpdate,
  async execute(oldChannel, newChannel) {
    if (!newChannel.guild) return;

    const changes = [];
    if (oldChannel.name !== newChannel.name) changes.push(`Name: ${oldChannel.name} -> ${newChannel.name}`);
    if (oldChannel.topic !== newChannel.topic) changes.push(`Topic changed`);
    if (oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
      changes.push(`Slowmode: ${oldChannel.rateLimitPerUser || 0}s -> ${newChannel.rateLimitPerUser || 0}s`);
    }
    if (!changes.length) return;

    await logAudit(newChannel.client, newChannel.guild.id, {
      action: 'CHANNEL_UPDATE',
      targetId: newChannel.id,
      metadata: { changes },
      embed: createAuditEmbed({
        action: 'Channel Updated',
        target: `${newChannel} (${newChannel.name})`,
        extra: changes.join('\n'),
        color: 'Blue',
      }),
    });
  },
};
