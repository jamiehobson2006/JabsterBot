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
        .addChannelTypes(
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement // ✅ upgrade (news channels too)
        )
        .setRequired(true)
    ),

  async execute(interaction) {
    try {
      const botMember = interaction.guild.members.me;

      // ========================
      // 🔐 PERMISSION CHECK
      // ========================
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.editReply({
          content: '❌ You need **Administrator**.'
        });
      }

      const channel = interaction.options.getChannel('channel', true);

      // ========================
      // 🛡 CHANNEL VALIDATION
      // ========================
      if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
        return interaction.editReply({
          content: '❌ Please select a valid **text channel**.'
        });
      }

      // ========================
      // 🤖 BOT PERMISSIONS CHECK
      // ========================
      const perms = channel.permissionsFor(botMember);

      const requiredPerms = [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.EmbedLinks,
        PermissionsBitField.Flags.AttachFiles // 🔥 needed for transcripts
      ];

      const missing = requiredPerms.filter(p => !perms?.has(p));

      if (missing.length) {
        return interaction.editReply({
          content: `❌ Missing permissions in ${channel}:\n• ${missing.map(p => `\`${p}\``).join('\n• ')}`
        });
      }

      // ========================
      // 💾 SAVE
      // ========================
      run(
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
        .setTitle('📄 Transcript Channel Set')
        .setDescription(`Transcripts will now be sent to ${channel}`)
        .addFields({
          name: 'Channel ID',
          value: `\`${channel.id}\``,
          inline: true
        })
        .setFooter({ text: `Configured by ${interaction.user.tag}` })
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
          flags: 64
        });
      }
    }
  }
};