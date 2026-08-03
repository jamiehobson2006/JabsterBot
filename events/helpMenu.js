const {
  MessageFlags
} = require('discord.js');

const {
  categoryEmbeds
} = require('../commands/utility/help');

module.exports = {
  name: 'interactionCreate',

  async execute(interaction, client) {
    if (
      !interaction.isStringSelectMenu() ||
      interaction.customId !== 'help_category'
    ) {
      return;
    }

    const category =
      interaction.values?.[0];

    return interaction.reply({
      embeds: categoryEmbeds(client, category),
      flags: MessageFlags.Ephemeral
    });
  }
};
