const {
  SlashCommandBuilder
} = require('discord.js');

const {
  buildLoggingDashboard,
  canConfigureLogging
} = require('../../utils/loggingPanel');

module.exports = {
  cooldown: 1500,
  ephemeral: true,
  auditLog: false,

  data: new SlashCommandBuilder()
    .setName('logging')
    .setDescription('Open the logging configuration dashboard'),

  async execute(interaction) {
    if (!canConfigureLogging(interaction)) {
      return interaction.editReply({
        content: 'You need Administrator permission or a logging manager role to configure logging.'
      });
    }

    return interaction.editReply(
      buildLoggingDashboard(interaction.guild.id)
    );
  }
};
