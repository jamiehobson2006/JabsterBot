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
      // 🔄 GET SETTINGS
      // ========================
      const settings = await get(
        `SELECT suggestionChannelId FROM guild_settings WHERE guildId=?`,
        [interaction.guild.id]
      );

      if (!settings?.suggestionChannelId) {
        return interaction.editReply({
          content: '❌ Suggestion channel not set.'
        });
      }

      const channel = interaction.guild.channels.cache.get(settings.suggestionChannelId);

      if (!channel || !channel.isTextBased()) {
        return interaction.editReply({
          content: '❌ Suggestion channel is invalid.'
        });
      }

      // ========================
      // 🔐 PERMISSION CHECK
      // ========================
      const perms = channel.permissionsFor(interaction.guild.members.me);

      if (!perms.has([
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.EmbedLinks,
        PermissionsBitField.Flags.AddReactions
      ])) {
        return interaction.editReply({
          content: '❌ I am missing permissions in the suggestion channel.'
        });
      }

      // ========================
      // 🎨 EMBED
      // ========================
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('💡 New Suggestion')
        .setDescription(text)
        .addFields({
          name: 'Author',
          value: `${interaction.user}`,
          inline: true
        })
        .setFooter({ text: 'Status: Pending' })
        .setTimestamp();

      // ========================
      // 🔘 BUTTONS
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
      // 📤 SEND
      // ========================
      const msg = await channel.send({
        embeds: [embed],
        components: [row]
      });

      // 👍 Voting
      await msg.react('👍');
      await msg.react('👎');

      // ========================
      // 💾 SAVE
      // ========================
      await run(
        `INSERT INTO suggestions (guildId, messageId, userId, content, status, timestamp)
         VALUES (?, ?, ?, ?, 'PENDING', ?)`,
        [interaction.guild.id, msg.id, interaction.user.id, text, Date.now()]
      );

      // ========================
      // ✅ RESPONSE
      // ========================
      await interaction.editReply({
        content: `✅ Suggestion submitted! [Jump to message](${msg.url})`
      });

    } catch (err) {
      console.error('Suggest Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to send suggestion.'
        });
      } else {
        return interaction.reply({
          content: '❌ Failed to send suggestion.',
          ephemeral: true
        });
      }
    }
  }
};