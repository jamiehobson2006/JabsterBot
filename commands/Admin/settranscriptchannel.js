const {
  PermissionsBitField,
  ChannelType,
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

const { run } = require('../../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('settranscriptchannel')
    .setDescription('Set where ticket transcripts are sent')
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Transcript channel')
        .addChannelTypes(ChannelType.GuildText) // ✅ force text channel
        .setRequired(true)
    ),

  async execute(interaction) {
    try {
      // ✅ Ensure reply exists
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
      }

      // 🔐 Permission check
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.editReply({
          content: '❌ Admin only.'
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

      // Check bot permissions in that channel
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
        `INSERT INTO guild_settings (guildId, transcriptChannelId)
         VALUES (?, ?)
         ON CONFLICT(guildId)
         DO UPDATE SET transcriptChannelId = excluded.transcriptChannelId`,
        [interaction.guild.id, channel.id]
      );

      // ========================
      // 🎨 RESPONSE
      // ========================

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('Transcript Channel Updated')
        .setDescription(`Ticket transcripts will now be sent to ${channel}.`)
        .setFooter({ text: `Set by ${interaction.user.tag}` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('SetTranscriptChannel Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to set transcript channel.'
        });
      } else {
        return interaction.reply({
          content: '❌ Failed to set transcript channel.',
          ephemeral: true
        });
      }
    }
  }
};