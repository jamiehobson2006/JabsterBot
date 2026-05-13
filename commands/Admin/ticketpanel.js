const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  SlashCommandBuilder
} = require('discord.js');

const { get } = require('../../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticketpanel')
    .setDescription('Send the ticket panel to the current channel'),

  async execute(interaction) {
    try {
      // ========================
      // 🔐 PERMISSION CHECK
      // ========================
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.editReply({
          content: '❌ You need **Administrator** to use this command.'
        });
      }

      // ========================
      // ⚙️ CONFIG CHECK (IMPORTANT)
      // ========================
      const settings = get(
        `SELECT * FROM guild_settings WHERE guildId=?`,
        [interaction.guild.id]
      );

      if (!settings?.ticketCategoryId) {
        return interaction.editReply({
          content: '❌ Ticket system is not configured.\nUse `/setticketchannel` first.'
        });
      }

      // ========================
      // 🎨 EMBED (UPGRADED)
      // ========================
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🎟️ Support Center')
        .setDescription(
          '**Open a ticket below depending on your needs**\n\n' +
          '📩 **Support**\nGet help from our staff team\n\n' +
          '📝 **Application**\nApply for staff or special roles\n\n' +
          '🎉 **Giveaway Claim**\nClaim your giveaway rewards'
        )
        .addFields({
          name: '⏱ Response Time',
          value: 'We usually respond within a few minutes.',
          inline: false
        })
        .setFooter({ text: `Server: ${interaction.guild.name}` })
        .setTimestamp();

      // ========================
      // 🎛 BUTTONS (CLEAN + FUTURE SAFE)
      // ========================
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

      // ========================
      // 📤 SEND PANEL
      // ========================
      await interaction.channel.send({
        embeds: [embed],
        components: [row]
      });

      return interaction.editReply({
        content: '✅ Ticket panel sent successfully.'
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
          flags: 64
        });
      }
    }
  }
};