const {
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');

const { homePayload } = require('../../utils/setupWizard');

module.exports = {
  cooldown: 1500,
  ephemeral: true,
  auditLog: false,
  data: new SlashCommandBuilder()
    .setName('setupwizard')
    .setDescription('Open the guided server setup wizard')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    return interaction.editReply(homePayload(interaction.guild.id));
  }
};
