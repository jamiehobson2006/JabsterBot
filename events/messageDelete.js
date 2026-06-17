const {
  createMessageDeleteEmbed,
  logAudit
} = require('../utils/logger');

module.exports = {

  name: 'messageDelete',

  async execute(message, client) {

    try {

      if (message.partial) {

        message =
          await message.fetch()
            .catch(() => message);
      }

      if (
        !message.guild ||
        message.author?.bot
      ) {

        return;
      }

      await logAudit(

        client,

        message.guild.id,

        {
          action: 'MESSAGE_DELETED',
          targetId: message.author?.id,
          type: 'MESSAGES',
          metadata: {
            channelId: message.channel?.id,
            messageId: message.id,
            content: message.content || null
          },
          embed: createMessageDeleteEmbed(
            message
          )
        }
      );

    } catch (err) {

      console.error(
        'MessageDelete Error:',
        err
      );
    }
  }
};
