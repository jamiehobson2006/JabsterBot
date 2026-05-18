const {
  PermissionsBitField,
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

const { run, get } = require('../../database');
const { sendLog, createLogEmbed } = require('../../utils/logger');

// 🧠 Safe trim
function trim(text, max = 300) {

  if (!text) return 'No reason provided';

  return text.length > max
    ? text.slice(0, max) + '...'
    : text;
}

module.exports = {

  cooldown: 3000,

  data: new SlashCommandBuilder()

    .setName('editcase')
    .setDescription('Edit the reason of a moderation case')

    .addIntegerOption(option =>
      option
        .setName('case_id')
        .setDescription('Case ID')
        .setRequired(true)
        .setMinValue(1)
    )

    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('New reason')
        .setRequired(true)
        .setMinLength(2)
        .setMaxLength(500)
    ),

  async execute(interaction) {

    try {

      const caseId =
        interaction.options.getInteger('case_id', true);

      const newReason =
        interaction.options
          .getString('reason', true)
          .trim();

      // 🔐 Permission
      if (!interaction.memberPermissions.has(
        PermissionsBitField.Flags.ManageGuild
      )) {

        return interaction.editReply({
          content:
            '❌ You need **Manage Server** permission.'
        });
      }

      // ❌ Empty
      if (!newReason.length) {

        return interaction.editReply({
          content:
            '❌ Reason cannot be empty.'
        });
      }

      // 🔍 Fetch case
      const caseData = get(
        `SELECT * FROM cases
         WHERE guildId=? AND id=?`,
        [interaction.guild.id, caseId]
      );

      if (!caseData) {

        return interaction.editReply({
          content: '❌ Case not found.'
        });
      }

      const oldReason =
        caseData.reason || 'No reason provided';

      // ❌ Same reason
      if (oldReason === newReason) {

        return interaction.editReply({
          content:
            '⚠️ The new reason is the same as the current one.'
        });
      }

      // 📝 Update DB
      run(
        `UPDATE cases
         SET reason=?
         WHERE guildId=? AND id=?`,
        [
          newReason,
          interaction.guild.id,
          caseId
        ]
      );

      // 📜 Audit DB
      run(
        `INSERT INTO audit_logs
         (guildId, action, targetId, executorId, metadata, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          interaction.guild.id,
          'EDIT_CASE',
          caseData.userId,
          interaction.user.id,

          JSON.stringify({
            caseId,
            oldReason,
            newReason
          }),

          Date.now()
        ]
      );

      // 🎨 Response
      const embed = new EmbedBuilder()

        .setColor(0xF1C40F)

        .setTitle(`📝 Case #${caseId} Updated`)

        .addFields(

          {
            name: '👤 User',
            value: `<@${caseData.userId}>`,
            inline: true
          },

          {
            name: '📌 Action',
            value: `\`${caseData.action}\``,
            inline: true
          },

          {
            name: '🛡 Edited By',
            value: `${interaction.user}`,
            inline: true
          },

          {
            name: 'Previous Reason',
            value: trim(oldReason)
          },

          {
            name: 'New Reason',
            value: trim(newReason)
          }
        )

        .setFooter({
          text:
            `Case ID: ${caseId}`
        })

        .setTimestamp();

      await interaction.editReply({
        embeds: [embed]
      });

      // 📜 Modlogs
      const logEmbed = createLogEmbed({

        action: 'EDIT CASE',

        user: {
          id: caseData.userId,
          tag: `User (${caseData.userId})`
        },

        moderator: interaction.user,

        reason:
          `Old: ${trim(oldReason)}\nNew: ${trim(newReason)}`,

        caseId
      });

      await sendLog(
        interaction.client,
        interaction.guild.id,
        logEmbed
      );

    } catch (err) {

      console.error('EditCase Error:', err);

      if (interaction.deferred || interaction.replied) {

        return interaction.editReply({
          content:
            '❌ Failed to edit case.'
        });
      }

      return interaction.reply({
        content:
          '❌ Failed to edit case.',
        ephemeral: true
      });
    }
  }
};