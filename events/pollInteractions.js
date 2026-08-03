const {
  MessageFlags
} = require('discord.js');

const {
  getPoll,
  recordVote,
  refreshPollMessage
} = require('../utils/polls');

module.exports = {
  name: 'interactionCreate',

  async execute(interaction) {
    if (
      !interaction.isStringSelectMenu() ||
      !interaction.customId.startsWith('poll_vote_')
    ) {
      return;
    }

    const messageId =
      interaction.customId.replace('poll_vote_', '');

    const poll =
      getPoll(messageId);

    if (
      !poll ||
      !poll.active ||
      (poll.endsAt && Number(poll.endsAt) <= Date.now())
    ) {
      return interaction.reply({
        content: 'This poll has ended.',
        flags: MessageFlags.Ephemeral
      });
    }

    const optionIndex =
      Number(interaction.values?.[0]);

    try {
      await interaction.deferUpdate();

      recordVote({
        messageId,
        userId: interaction.user.id,
        optionIndex
      });

      await refreshPollMessage(interaction.client, messageId);

    } catch (err) {
      console.error('Poll vote error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.followUp({
          content: err.message || 'Your vote could not be recorded.',
          flags: MessageFlags.Ephemeral
        }).catch(() => null);
      }

      return interaction.reply({
        content: err.message || 'Your vote could not be recorded.',
        flags: MessageFlags.Ephemeral
      }).catch(() => null);
    }
  }
};
