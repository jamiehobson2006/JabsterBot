const {
  createMessageEditEmbed,
  logAudit
} = require('../utils/logger');

const {
  captureMessageSnapshot,
  getMessageSnapshot
} = require('../utils/messageSnapshots');

const { handleCensor } = require('../utils/censorMessages');

const { handlePhishing } = require('../utils/phishingProtection');

const {
  handleDailyInteractionThreadSafety,
  handleLinkBlock
} = require('./messageCreate');

module.exports = {

  name: 'messageUpdate',

  async execute(oldMessage, newMessage, client) {

    try {

      const storedOldMessage = getMessageSnapshot(newMessage.id);

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
        !newMessage.guild ||
        !newMessage.author
      ) {

        return;
      }

      if (newMessage.author.bot) {
        captureMessageSnapshot(newMessage);
        return;
      }

      if (await handleDailyInteractionThreadSafety(newMessage, client)) return;

      if (await handlePhishing(newMessage, client)) return;

      if (await handleCensor(newMessage, client)) return;

      if (await handleLinkBlock(newMessage, client)) return;

      if (
        (storedOldMessage?.content ?? oldMessage.content) ===
        newMessage.content
      ) {

        return;
      }

      captureMessageSnapshot(newMessage);

      await logAudit(

        client,

        newMessage.guild.id,

        {
          action: 'MESSAGE_EDITED',
          targetId: newMessage.author.id,
          type: 'MESSAGES',
          metadata: {
            channelId: newMessage.channel?.id,
            messageId: newMessage.id,
            before: storedOldMessage?.content || oldMessage.content || null,
            after: newMessage.content || null
          },
          embed: createMessageEditEmbed(
            storedOldMessage || oldMessage,
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
