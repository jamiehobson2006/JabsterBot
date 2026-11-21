const { SlashCommandBuilder, PermissionFlagsBits: P } = require('discord.js');
const dashboard = require('../../utils/tickets/dashboard');
module.exports = {
  ephemeral: true,
  auditLog: false,
  data: new SlashCommandBuilder().setName('ticketdashboard').setDescription('Open the interactive ticket panel and settings dashboard.')
    .setDefaultMemberPermissions(P.Administrator).setDMPermission(false),
  async execute(interaction) {
    const member = await interaction.guild.members.fetch({ user: interaction.user.id, force: true });
    if (!member.permissions.has(P.Administrator)) throw new Error('Administrator permission is required.');
    return interaction.editReply(dashboard.payload(dashboard.createSession(interaction.guild.id, interaction.user.id)));
  }
};
