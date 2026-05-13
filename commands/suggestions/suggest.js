const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  SlashCommandBuilder
} = require('discord.js');

const { get, run } = require('../../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('suggest')
    .setDescription('Submit a suggestion')
    .addStringOption(option =>
      option
        .setName('text')
        .setDescription('Your suggestion')
        .setRequired(true)
        .setMaxLength(500)
    ),

  async execute(interaction) {
    try {

      const text = interaction.options.getString('text', true);

      // ========================
      // ðŸ”„ GET SETTINGS
      // ========================
      const settings = await get(
        `SELECT suggestionChannelId FROM guild_settings WHERE guildId=?`,
        [interaction.guild.id]
      );

      if (!settings?.suggestionChannelId) {
        return interaction.editReply({
          content: 'âŒ Suggestion channel not set.'
        });
      }

      const channel = interaction.guild.channels.cache.get(settings.suggestionChannelId);

      if (!channel || !channel.isTextBased()) {
        return interaction.editReply({
          content: 'âŒ Suggestion channel is invalid.'
        });
      }

      // ========================
      // ðŸ” PERMISSION CHECK
      // ========================
      const perms = channel.permissionsFor(interaction.guild.members.me);

      if (!perms.has([
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.EmbedLinks,
        PermissionsBitField.Flags.AddReactions
      ])) {
        return interaction.editReply({
          content: 'âŒ I am missing permissions in the suggestion channel.'
        });
      }

      // ========================
      // ðŸŽ¨ EMBED
      // ========================
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('ðŸ’¡ New Suggestion')
        .setDescription(text)
        .addFields({
          name: 'Author',
          value: `${interaction.user}`,
          inline: true
        })
        .setFooter({ text: 'Status: Pending' })
        .setTimestamp();

      // ========================
      // ðŸ”˜ BUTTONS
      // ========================
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`suggest_accept_${interaction.id}`)
          .setLabel('Accept')
          .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
          .setCustomId(`suggest_deny_${interaction.id}`)
          .setLabel('Deny')
          .setStyle(ButtonStyle.Danger)
      );

      // ========================
      // ðŸ“¤ SEND
      // ========================
      const msg = await channel.send({
        embeds: [embed],
        components: [row]
      });

      // ðŸ‘ Voting
      await msg.react('\\u2705');
      await msg.react('\\u274C');

      // ========================
      // ðŸ’¾ SAVE
      // ========================
      await run(
        `INSERT INTO suggestions (guildId, messageId, userId, content, status, timestamp)
         VALUES (?, ?, ?, ?, 'PENDING', ?)`,
        [interaction.guild.id, msg.id, interaction.user.id, text, Date.now()]
      );

      // ========================
      // âœ… RESPONSE
      // ========================
      await interaction.editReply({
        content: `âœ… Suggestion submitted! [Jump to message](${msg.url})`
      });

    } catch (err) {
      console.error('Suggest Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: 'âŒ Failed to send suggestion.'
        });
      } else {
        return interaction.reply({
          content: 'âŒ Failed to send suggestion.',
          ephemeral: true
        });
      }
    }
  }
};
