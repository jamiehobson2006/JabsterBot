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
    )
    .addStringOption(option =>
      option.setName('reason').setDescription('Reason').setMaxLength(300)
    ),

  async execute(interaction) {
    try {


      // 🔐 User permission
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return interaction.editReply({
          content: '❌ You need **Moderate Members** permission.'
        });
      }

      const botMember = interaction.guild.members.me;

      // ❌ Bot permission
      if (!botMember.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return interaction.editReply({
          content: '❌ I do not have permission to moderate members.'
        });
      }

      const user = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason') || 'No reason provided';

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
          content: '⚠️ This user is not muted.'
        });
      }

      // 🔊 Remove timeout
      await member.timeout(null, `${reason} | Unmuted by ${interaction.user.tag}`)
        .catch(() => {
          throw new Error('Failed to remove timeout');
        });

      // 📩 DM user (silent fail)
      try {
        await user.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x57F287)
              .setTitle(`You were unmuted in ${interaction.guild.name}`)
              .setDescription(`Reason: ${reason}`)
              .setTimestamp()
          ]
        });
      } catch {}

      // 📁 Case
      const result = await run(
        `INSERT INTO cases (guildId, userId, moderatorId, action, reason, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          interaction.guild.id,
          user.id,
          interaction.user.id,
          'UNMUTE',
          reason,
          Date.now()
        ]
      );

      const caseId = result?.lastInsertRowid ?? 'N/A';

      // 🎨 Embed
      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('User Unmuted')
        .setDescription(`🔊 **${user.tag}** has been unmuted`)
        .addFields(
          { name: 'Reason', value: reason },
          { name: 'Case', value: `#${caseId}`, inline: true }
        )
        .setFooter({ text: `By ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      // 📜 Log
      const log = createLogEmbed({
        action: 'UNMUTE',
        user,
        moderator: interaction.user,
        reason,
        caseId
      });

      await sendLog(interaction.client, interaction.guild.id, log);

    } catch (err) {
      console.error('Unmute Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to unmute. Check my permissions.'
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