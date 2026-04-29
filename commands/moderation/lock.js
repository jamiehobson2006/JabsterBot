const { 
  PermissionsBitField, 
  EmbedBuilder, 
  SlashCommandBuilder 
} = require('discord.js');

const { sendLog, createLogEmbed } = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Lock the current channel')
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for locking the channel')
        .setRequired(false)
        .setMaxLength(200)
    ),

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
      const reason = interaction.options.getString('reason') || 'No reason provided';

      const overwrite = channel.permissionOverwrites.cache.get(
        interaction.guild.roles.everyone.id
      );

      const alreadyLocked = overwrite?.deny.has(PermissionsBitField.Flags.SendMessages);

      if (alreadyLocked) {
        return interaction.editReply({
          content: '⚠️ This channel is already locked.'
        });
      }

      // 🔒 Lock
      await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
        SendMessages: false
      });

      // 🎨 Embed
      const embed = new EmbedBuilder()
        .setTitle('🔒 Channel Locked')
        .setColor(0xED4245)
        .setDescription(
          `This channel has been locked.\n\n**Reason:** ${reason}`
        )
        .setFooter({ text: `Locked by ${interaction.user.tag}` })
        .setTimestamp();

      const reply = await interaction.editReply({ embeds: [embed] });

      // 🧹 Auto delete after 5 seconds
      setTimeout(() => {
        reply.delete().catch(() => {});
      }, 5000);

      // 📜 Log
      const logEmbed = createLogEmbed({
        action: 'LOCK',
        user: { id: 'CHANNEL', tag: channel.name },
        moderator: interaction.user,
        reason,
        caseId: null
      });

      await sendLog(interaction.client, interaction.guild.id, logEmbed);

    } catch (err) {
      console.error('Lock Command Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to lock channel.'
        });
      } else {
        return interaction.reply({
          content: '❌ Failed to lock channel.',
          ephemeral: true
        });
      }
    }
  }
};