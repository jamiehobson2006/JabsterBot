const {
  createMessageEditEmbed,
  logAudit
} = require('../utils/logger');

module.exports = {

  name: 'messageUpdate',

  async execute(oldMessage, newMessage, client) {

    try {

      if (oldMessage.partial) {

        oldMessage =
          await oldMessage.fetch()
            .catch(() => oldMessage);
      }

      if (newMessage.partial) {

        newMessage =
          await newMessage.fetch()
            .catch(() => newMessage);
      }

      if (
        !oldMessage.guild ||
        oldMessage.author?.bot
      ) {

        return;
      }

      if (
        oldMessage.content ===
        newMessage.content
      ) {

        return;
      }

      await logAudit(

        client,

        oldMessage.guild.id,

        {
          action: 'MESSAGE_EDITED',
          targetId: oldMessage.author?.id,
          type: 'MESSAGES',
          metadata: {
            channelId: oldMessage.channel?.id,
            messageId: oldMessage.id,
            before: oldMessage.content || null,
            after: newMessage.content || null
          },
          embed: createMessageEditEmbed(
            oldMessage,
            newMessage
          )
        }
      );

    } catch (err) {

      console.error(
        'MessageUpdate Error:',
        err
      );
    }
  }
};
