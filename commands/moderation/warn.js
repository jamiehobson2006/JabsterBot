const {
  PermissionsBitField,
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

const { run, get } = require('../../database');
const { sendLog, createLogEmbed } = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a user')
    .addUserOption(option =>
      option.setName('user').setDescription('User').setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason').setDescription('Reason').setMaxLength(300)
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
      const reason = interaction.options.getString('reason') || 'No reason provided';

      // 🚫 Checks
      if (user.id === interaction.user.id) {
        return interaction.editReply({ content: '❌ You cannot warn yourself.' });
      }

      if (user.id === interaction.client.user.id) {
        return interaction.editReply({ content: '❌ You cannot warn the bot.' });
      }

      if (user.id === interaction.guild.ownerId) {
        return interaction.editReply({ content: '❌ You cannot warn the server owner.' });
      }

      const member = await interaction.guild.members.fetch(user.id).catch(() => null);

      if (!member) {
        return interaction.editReply({
          content: '❌ User not found in this server.'
        });
      }

      // 🔼 Hierarchy
      if (member.roles.highest.position >= interaction.member.roles.highest.position) {
        return interaction.editReply({
          content: '❌ You cannot warn this user (role hierarchy).'
        });
      }

      // ========================
      // 🔢 UPDATE WARN COUNT
      // ========================
      await run(
        `INSERT INTO warns (guildId, userId, count)
         VALUES (?, ?, 1)
         ON CONFLICT(guildId, userId)
         DO UPDATE SET count = count + 1`,
        [interaction.guild.id, user.id]
      );

      const row = await get(
        `SELECT count FROM warns WHERE guildId=? AND userId=?`,
        [interaction.guild.id, user.id]
      );

      const warnCount = row?.count || 1;

      // ========================
      // 📄 CREATE CASE
      // ========================
      const result = await run(
        `INSERT INTO cases (guildId, userId, moderatorId, action, reason, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          interaction.guild.id,
          user.id,
          interaction.user.id,
          'WARN',
          reason,
          Date.now()
        ]
      );

      const caseId = result?.lastInsertRowid ?? 'N/A';

      // ========================
      // ⚠️ ESCALATION
      // ========================
      let escalation = '';

      if (warnCount === 3) {
        escalation = '🚨 User has reached **3 warnings**.';
      } else if (warnCount === 5) {
        escalation = '⛔ User has reached **5 warnings**.';
      }

      // ========================
      // 📩 DM USER (optional but good)
      // ========================
      try {
        await user.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0xF1C40F)
              .setTitle(`You were warned in ${interaction.guild.name}`)
              .setDescription(`Reason: ${reason}`)
          ]
        });
      } catch {}

      // ========================
      // 🎨 RESPONSE
      // ========================
      const embed = new EmbedBuilder()
        .setColor(0xF1C40F)
        .setTitle('User Warned')
        .setDescription(`⚠️ **${user.tag}** has been warned`)
        .addFields(
          { name: 'Reason', value: reason },
          { name: 'Total Warns', value: `${warnCount}`, inline: true },
          { name: 'Case', value: `#${caseId}`, inline: true }
        )
        .setFooter({ text: `By ${interaction.user.tag}` })
        .setTimestamp();

      if (escalation) {
        embed.addFields({
          name: 'Escalation',
          value: escalation
        });
      }

      await interaction.editReply({ embeds: [embed] });

      // ========================
      // 📜 LOG
      // ========================
      const log = createLogEmbed({
        action: 'WARN',
        user,
        moderator: interaction.user,
        reason: `${reason}\nTotal Warns: ${warnCount}`,
        caseId
      });

      await sendLog(interaction.client, interaction.guild.id, log);

    } catch (err) {
      console.error('Warn Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to execute warn command.'
        });
      } else {
        return interaction.reply({
          content: '❌ Failed to execute warn command.',
          ephemeral: true
        });
      }
    }
  }
};