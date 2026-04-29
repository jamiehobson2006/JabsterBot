const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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
      // ✅ Ensure reply exists
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
      }

      let text = interaction.options.getString('text', true);

      // 🔄 Get settings
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

      // 🔐 Bot perms check
      const perms = channel.permissionsFor(interaction.guild.members.me);

      if (!perms.has(['SendMessages', 'EmbedLinks', 'AddReactions'])) {
        return interaction.editReply({
          content: '❌ I am missing permissions in the suggestion channel.'
        });
      }

      // 🎨 Embed
      const embed = new EmbedBuilder()
        .setTitle('💡 New Suggestion')
        .setColor(0x5865F2)
        .setDescription(text)
        .addFields({
          name: 'Author',
          value: `<@${interaction.user.id}>`,
          inline: true
        })
        .setFooter({ text: 'Status: Pending' })
        .setTimestamp();

      // 🔥 Buttons
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

      const msg = await channel.send({
        embeds: [embed],
        components: [row]
      });

      // 👍 Voting
      await msg.react('👍');
      await msg.react('👎');

      // 💾 Save
      await run(
        `INSERT INTO suggestions (guildId, messageId, userId, content, status, timestamp)
         VALUES (?, ?, ?, ?, 'PENDING', ?)`,
        [interaction.guild.id, msg.id, interaction.user.id, text, Date.now()]
      );

      // ✅ Confirmation
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