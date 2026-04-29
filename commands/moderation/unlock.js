const {
  PermissionsBitField,
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

const { sendLog, createLogEmbed } = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Unlock the current channel'),

  async execute(interaction) {
    try {
      // ✅ Ensure reply exists
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply();
      }

      // 🔐 Permission
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ManageChannels)) {
        return interaction.editReply({
          content: '❌ You need **Manage Channels** permission.'
        });
      }

      const channel = interaction.channel;

      // 🚫 Safety
      if (!channel || !channel.isTextBased()) {
        return interaction.editReply({
          content: '❌ This command can only be used in text channels.'
        });
      }

      const everyone = interaction.guild.roles.everyone;

      const overwrite = channel.permissionOverwrites.cache.get(everyone.id);

      // 🧠 Check state
      if (!overwrite || overwrite.allow.has(PermissionsBitField.Flags.SendMessages)) {
        return interaction.editReply({
          content: '❌ This channel is already unlocked.'
        });
      }

      // 🔓 Remove deny
      await channel.permissionOverwrites.edit(everyone, {
        SendMessages: null
      });

      // 🎨 Embed
      const embed = new EmbedBuilder()
        .setTitle('🔓 Channel Unlocked')
        .setColor(0x57F287)
        .setDescription('Members can now send messages again.')
        .setFooter({ text: `Unlocked by ${interaction.user.tag}` })
        .setTimestamp();

      const reply = await interaction.editReply({ embeds: [embed] });

      // 🧹 Auto delete after 5 seconds
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
          content: '❌ Failed to unlock channel.'
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