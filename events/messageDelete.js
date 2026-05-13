const { Events } = require('discord.js');
const { createAuditEmbed, logAudit } = require('../utils/logger');

module.exports = {
  name: Events.MessageDelete,
  async execute(message) {
    if (!message.guild || message.author?.bot) return;

    await logAudit(message.client, message.guild.id, {
      action: 'MESSAGE_DELETE',
      targetId: message.author?.id,
      metadata: {
        channelId: message.channel.id,
        content: message.content?.slice(0, 500) || null,
      },
      embed: createAuditEmbed({
        action: 'Message Deleted',
        target: message.author ? `${message.author} (${message.author.tag})` : 'Unknown user',
        channel: `${message.channel}`,
        extra: message.content ? message.content.slice(0, 900) : 'No cached content',
        color: 'Orange',
      }),
    });
  },
};
