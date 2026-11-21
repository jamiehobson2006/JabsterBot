const { SlashCommandBuilder, PermissionFlagsBits: P, ChannelType } = require('discord.js');
const panels = require('../../utils/tickets/panels');

module.exports = {
  cooldown: 5000,
  data: new SlashCommandBuilder().setName('ticketpanel').setDescription('Send a ticket panel')
    .addStringOption(option => option.setName('panel').setDescription('Named panel; omit for server-wide ticket types').setMaxLength(32).setAutocomplete(true))
    .addChannelOption(option => option.setName('channel').setDescription('Where to post this panel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
  async execute(interaction) {
    if (!interaction.memberPermissions?.has(P.Administrator)) return interaction.editReply('Administrator permission is required.');
    try {
      const name = interaction.options?.getString('panel');
      const panel = name ? panels.byName(interaction.guild.id, name) : null;
      if (name && !panel) throw new Error('Named panel not found. Create it with /ticket panels create first.');
      const destination = interaction.options?.getChannel('channel') || interaction.channel;
      const result = await require('../../utils/tickets/panelPresentation').publishPanel({ guild: interaction.guild, destination, panelId: panel?.id || null });
      return interaction.editReply({ content: 'Ticket panel created successfully.' +
        (result.invalidTypes.length ? ` Skipped invalid configurations: ${result.invalidTypes.join(', ')}.` : ''), allowedMentions: { parse: [] } });
    } catch (error) {
      console.error('TicketPanel Error:', error);
      return interaction.editReply({ content: `Failed to create ticket panel: ${error.message}`, allowedMentions: { parse: [] } });
    }
  }
};
