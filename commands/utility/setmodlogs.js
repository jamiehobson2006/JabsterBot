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
      // ❌ NO DEFER HERE (handled globally)

      // 🔐 Permission check
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.editReply({
          content: '❌ You need **Manage Server** permission.'
        });
      }

      const channel = interaction.options.getChannel('channel', true);

      // 🚫 Safety checks
      if (!channel || channel.type !== ChannelType.GuildText) {
        return interaction.editReply({
          content: '❌ Please select a valid text channel.'
        });
      }

      if (channel.guildId !== interaction.guild.id) {
        return interaction.editReply({
          content: '❌ That channel is not in this server.'
        });
      }

      // 🛡 Bot permission check
      const perms = channel.permissionsFor(interaction.guild.members.me);

      const requiredPerms = [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.EmbedLinks,
        PermissionsBitField.Flags.ReadMessageHistory
      ];

      if (!perms || !perms.has(requiredPerms)) {
        return interaction.editReply({
          content:
            '❌ Missing permissions in that channel:\n' +
            '• View Channel\n• Send Messages\n• Embed Links\n• Read Message History'
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

      // 🧪 Send test log
      try {
        await channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5865F2)
              .setTitle('📜 Mod Logs Enabled')
              .setDescription('This channel is now set for moderation logs.')
              .setFooter({ text: `Configured by ${interaction.user.tag}` })
              .setTimestamp()
          ]
        });
      } catch {}

      // 🎨 Response
      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('Mod Logs Updated')
        .setDescription(`Logs will now be sent to ${channel}`)
        .addFields({
          name: 'Channel ID',
          value: `\`${channel.id}\``,
          inline: true
        })
        .setFooter({ text: `Configured by ${interaction.user.tag}` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });

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