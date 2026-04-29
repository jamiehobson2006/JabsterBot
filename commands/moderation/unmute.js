const {
  PermissionsBitField,
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

const { run } = require('../../database');
const { sendLog, createLogEmbed } = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Remove timeout (unmute) from a user')
    .addUserOption(option =>
      option.setName('user').setDescription('User').setRequired(true)
    ),

  async execute(interaction) {
    try {
      // ✅ Ensure reply exists
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
      }

      // 🔐 Permission
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return interaction.editReply({
          content: '❌ You need **Moderate Members** permission.'
        });
      }

      const user = interaction.options.getUser('user', true);

      // 🚫 Checks
      if (user.id === interaction.user.id) {
        return interaction.editReply({ content: '❌ You cannot unmute yourself.' });
      }

      if (user.id === interaction.client.user.id) {
        return interaction.editReply({ content: '❌ You cannot unmute the bot.' });
      }

      if (user.id === interaction.guild.ownerId) {
        return interaction.editReply({ content: '❌ You cannot unmute the server owner.' });
      }

      const member = await interaction.guild.members.fetch(user.id).catch(() => null);

      if (!member) {
        return interaction.editReply({ content: '❌ User not found.' });
      }

      // 🔼 Hierarchy
      if (member.roles.highest.position >= interaction.member.roles.highest.position) {
        return interaction.editReply({
          content: '❌ You cannot unmute this user (role hierarchy).'
        });
      }

      if (!member.moderatable) {
        return interaction.editReply({
          content: '❌ I cannot unmute this user.'
        });
      }

      // 🔍 Check if actually muted
      if (!member.isCommunicationDisabled()) {
        return interaction.editReply({
          content: '❌ This user is not muted.'
        });
      }

      // 🔊 Remove timeout
      await member.timeout(null, `Unmuted by ${interaction.user.tag}`);

      // 📁 Case
      const result = await run(
        `INSERT INTO cases (guildId, userId, moderatorId, action, reason, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          interaction.guild.id,
          user.id,
          interaction.user.id,
          'UNMUTE',
          'Manual unmute',
          Date.now()
        ]
      );

      const caseId = result?.lastInsertRowid ?? 'N/A';

      // 🎨 Embed
      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('User Unmuted')
        .setDescription(`🔊 **${user.tag}** has been unmuted`)
        .addFields({ name: 'Case', value: `#${caseId}`, inline: true })
        .setFooter({ text: `By ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      // 📜 Log
      const log = createLogEmbed({
        action: 'UNMUTE',
        user,
        moderator: interaction.user,
        reason: 'Manual unmute',
        caseId
      });

      await sendLog(interaction.client, interaction.guild.id, log);

    } catch (err) {
      console.error('Unmute Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to unmute.'
        });
      } else {
        return interaction.reply({
          content: '❌ Failed to unmute.',
          ephemeral: true
        });
      }
    }
  }
};