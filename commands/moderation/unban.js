const {
  PermissionsBitField,
  SlashCommandBuilder,
  EmbedBuilder
} = require('discord.js');

const { run } = require('../../database');
const { sendLog, createLogEmbed } = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user by ID')
    .addStringOption(option =>
      option
        .setName('user_id')
        .setDescription('The ID of the user to unban')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for unbanning')
        .setMaxLength(200)
    ),

  async execute(interaction) {
    try {

      // 🔐 Permission check
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.BanMembers)) {
        return interaction.editReply({
          content: '❌ You need **Ban Members** permission.'
        });
      }

      const userId = interaction.options.getString('user_id', true);
      const reason = interaction.options.getString('reason') || 'No reason provided';

      // 🔍 Fetch ban
      let ban;
      try {
        ban = await interaction.guild.bans.fetch(userId);
      } catch {
        return interaction.editReply({
          content: '❌ That user is not banned.'
        });
      }

      // 🔓 Unban
      await interaction.guild.members.unban(userId, reason);

      // 🎨 Response
      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('🔓 User Unbanned')
        .setDescription(`Successfully unbanned **${ban.user.tag}**`)
        .addFields(
          { name: 'User ID', value: `\`${userId}\``, inline: true },
          { name: 'Reason', value: reason, inline: false }
        )
        .setFooter({ text: `Moderator: ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      // ========================
      // 📜 LOG SYSTEM
      // ========================
      const logEmbed = createLogEmbed({
        action: 'UNBAN',
        user: ban.user,
        moderator: interaction.user,
        reason
      });

      await sendLog(interaction.client, interaction.guild.id, logEmbed);

      // ========================
      // 💾 SAVE CASE
      // ========================
      await run(
        `INSERT INTO cases (guildId, userId, moderatorId, action, reason, createdAt)
         VALUES (?, ?, ?, 'UNBAN', ?, ?)`,
        [interaction.guild.id, userId, interaction.user.id, reason, Date.now()]
      );

    } catch (err) {
      console.error('Unban Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to unban user.'
        });
      } else {
        return interaction.reply({
          content: '❌ Failed to unban user.',
          ephemeral: true
        });
      }
    }
  }
};