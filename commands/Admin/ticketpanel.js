const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  SlashCommandBuilder
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticketpanel')
    .setDescription('Send the ticket panel to the current channel'),

  async execute(interaction) {
    try {
      // ✅ Ensure reply exists
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
      }

      // 🔐 Permission
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.editReply({
          content: '❌ You need **Administrator** to use this command.'
        });
      }

      // 🎨 Embed
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('Support Center')
        .setDescription(
          'Welcome! Choose a ticket type below:\n\n' +
          '📩 **Support** — Get help (you’ll fill out a form)\n' +
          '📝 **Application** — Apply for roles/staff\n' +
          '🎉 **Giveaway Claim** — Claim your prize'
        )
        .setFooter({ text: `Server: ${interaction.guild.name}` })
        .setTimestamp();

      // 🎛 Buttons
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('ticket_support')
          .setLabel('Support')
          .setEmoji('📩')
          .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
          .setCustomId('ticket_application')
          .setLabel('Application')
          .setEmoji('📝')
          .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
          .setCustomId('ticket_giveaway')
          .setLabel('Giveaway')
          .setEmoji('🎉')
          .setStyle(ButtonStyle.Secondary)
      );

      // 📤 Send panel
      await interaction.channel.send({
        embeds: [embed],
        components: [row]
      });

      return interaction.editReply({
        content: '✅ Ticket panel sent.'
      });

    } catch (err) {
      console.error('TicketPanel Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to send ticket panel.'
        });
      } else {
        return interaction.reply({
          content: '❌ Failed to send ticket panel.',
          ephemeral: true
        });
      }
    }
  }
};