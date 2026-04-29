const {
  PermissionsBitField,
  ChannelType,
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

const { run } = require('../../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setmodlogs')
    .setDescription('Set the mod logs channel')
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel to send mod logs to')
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

      // 🚫 Ensure same guild
      if (channel.guildId !== interaction.guild.id) {
        return interaction.editReply({
          content: '❌ That channel is not in this server.'
        });
      }

      // 🛡 Bot permissions
      const perms = channel.permissionsFor(interaction.guild.members.me);

      if (!perms?.has([
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.EmbedLinks,
        PermissionsBitField.Flags.ReadMessageHistory
      ])) {
        return interaction.editReply({
          content: '❌ I need **View Channel, Send Messages, Embed Links, and Read Message History** permissions in that channel.'
        });
      }

      // 💾 Save to DB
      await run(
        `INSERT INTO guild_settings (guildId, modlogChannelId)
         VALUES (?, ?)
         ON CONFLICT(guildId)
         DO UPDATE SET modlogChannelId = excluded.modlogChannelId`,
        [interaction.guild.id, channel.id]
      );

      // 🎨 Response embed
      const embed = new EmbedBuilder()
        .setTitle('📜 Mod Logs Configured')
        .setColor(0x57F287)
        .setDescription(`Mod logs will now be sent to ${channel}`)
        .addFields({
          name: 'Channel ID',
          value: `\`${channel.id}\``
        })
        .setFooter({ text: `Configured by ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('SetModLogs Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to set mod logs channel.'
        });
      } else {
        return interaction.reply({
          content: '❌ Failed to set mod logs channel.',
          ephemeral: true
        });
      }
    }
  }
};