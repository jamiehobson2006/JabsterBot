const {
  PermissionsBitField,
  EmbedBuilder,
  SlashCommandBuilder,
  ChannelType
} = require('discord.js');

const { sendLog, createLogEmbed } = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Unlock the current channel'),

  async execute(interaction) {
    try {

      // 🔐 User permission
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ManageChannels)) {
        return interaction.editReply({
          content: '❌ You need **Manage Channels** permission.'
        });
      }

      const channel = interaction.channel;
      const botMember = interaction.guild.members.me;

      // ❌ Bot permission
      if (!botMember.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
        return interaction.editReply({
          content: '❌ I do not have permission to manage channels.'
        });
      }

      // 🚫 Only allow normal text channels
      if (!channel || channel.type !== ChannelType.GuildText) {
        return interaction.editReply({
          content: '❌ This command can only be used in standard text channels.'
        });
      }

      const everyone = interaction.guild.roles.everyone;

      const overwrite = channel.permissionOverwrites.cache.get(everyone.id);

      // 🧠 Check if actually locked
      const isLocked = overwrite?.deny?.has(PermissionsBitField.Flags.SendMessages);

      if (!isLocked) {
        return interaction.editReply({
          content: '⚠️ This channel is already unlocked.'
        });
      }

      // 🔓 Remove deny
      await channel.permissionOverwrites.edit(everyone, {
        SendMessages: null
      }).catch(() => {
        throw new Error('Failed to unlock channel');
      });

      // 🎨 Embed
      const embed = new EmbedBuilder()
        .setTitle('🔓 Channel Unlocked')
        .setColor(0x57F287)
        .setDescription('Members can now send messages again.')
        .setFooter({ text: `Unlocked by ${interaction.user.tag}` })
        .setTimestamp();

      const reply = await interaction.editReply({ embeds: [embed] });

      // 🧹 Auto delete after 5s
      setTimeout(() => {
        reply.delete().catch(() => {});
      }, 5000);

      // 📜 Log
      const log = createLogEmbed({
        action: 'UNLOCK',
        user: { id: 'CHANNEL', tag: channel.name },
        moderator: interaction.user,
        reason: `Unlocked #${channel.name}`
      });

      await sendLog(interaction.client, interaction.guild.id, log);

    } catch (err) {
      console.error('Unlock Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to unlock channel. Check my permissions.'
        });
      } else {
        return interaction.reply({
          content: '❌ Failed to unlock channel.',
          ephemeral: true
        });
      }
    }
  }
};