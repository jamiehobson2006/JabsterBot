const {
  PermissionsBitField,
  ChannelType,
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

const { run } = require('../../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('suggestchannel')
    .setDescription('Set the suggestion channel for this server')
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('The channel where suggestions will be sent')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    ),

  async execute(interaction) {
    try {
      // ✅ Ensure reply exists
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
      }

      // 🔐 Permission check
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.editReply({
          content: '❌ You need **Manage Server** permission.'
        });
      }

      const channel = interaction.options.getChannel('channel', true);
      const botMember = interaction.guild.members.me;

      // ========================
      // 🛡 CHANNEL VALIDATION
      // ========================

      if (channel.type !== ChannelType.GuildText) {
        return interaction.editReply({
          content: '❌ You must select a **text channel**.'
        });
      }

      // Check bot permissions (IMPORTANT for suggestions)
      const perms = channel.permissionsFor(botMember);

      if (!perms.has([
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.EmbedLinks
      ])) {
        return interaction.editReply({
          content: '❌ I don’t have permission to send messages in that channel.'
        });
      }

      // ========================
      // 💾 SAVE (AWAITED)
      // ========================

      await run(
        `INSERT INTO guild_settings (guildId, suggestionChannelId)
         VALUES (?, ?)
         ON CONFLICT(guildId)
         DO UPDATE SET suggestionChannelId = excluded.suggestionChannelId`,
        [interaction.guild.id, channel.id]
      );

      // ========================
      // 🎨 RESPONSE
      // ========================

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('Suggestion Channel Updated')
        .setDescription(`Suggestions will now be sent in ${channel}.`)
        .setFooter({ text: `Set by ${interaction.user.tag}` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('SuggestChannel Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to set suggestion channel.'
        });
      } else {
        return interaction.reply({
          content: '❌ Failed to set suggestion channel.',
          ephemeral: true
        });
      }
    }
  }
};