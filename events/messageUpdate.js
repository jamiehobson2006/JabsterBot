const { Events } = require('discord.js');
const { createAuditEmbed, logAudit } = require('../utils/logger');

module.exports = {
  name: Events.MessageUpdate,
  async execute(oldMessage, newMessage) {
    if (!newMessage.guild || newMessage.author?.bot) return;
    if (!oldMessage.content || oldMessage.content === newMessage.content) return;

    await logAudit(newMessage.client, newMessage.guild.id, {
      action: 'MESSAGE_UPDATE',
      targetId: newMessage.author?.id,
      metadata: {
        channelId: newMessage.channel.id,
        before: oldMessage.content.slice(0, 500),
        after: newMessage.content.slice(0, 500),
      },
      embed: createAuditEmbed({
        action: 'Message Edited',
        target: `${newMessage.author} (${newMessage.author.tag})`,
        channel: `${newMessage.channel}`,
        messageLink: newMessage.url,
        extra: `Before: ${oldMessage.content.slice(0, 450)}\nAfter: ${newMessage.content.slice(0, 450)}`,
        color: 'Blue',
      }),
    });
  },
};
