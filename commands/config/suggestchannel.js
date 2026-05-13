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
        .addChannelTypes(
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement // ✅ upgrade (news channels too)
        )
        .setRequired(true)
    ),

  async execute(interaction) {
    try {
      const channel = interaction.options.getChannel('channel', true);
      const botMember = interaction.guild.members.me;

      // ========================
      // 🔐 PERMISSION CHECK
      // ========================
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.editReply({
          content: '❌ You need **Manage Server** permission.'
        });
      }

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
        PermissionsBitField.Flags.AddReactions // 🔥 needed for voting
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
        .setTitle('💡 Suggestion Channel Set')
        .setDescription(`Suggestions will now be sent in ${channel}`)
        .addFields({
          name: 'Channel ID',
          value: `\`${channel.id}\``,
          inline: true
        })
        .setFooter({ text: `Configured by ${interaction.user.tag}` })
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
          flags: 64
        });
      }
    }
  }
};