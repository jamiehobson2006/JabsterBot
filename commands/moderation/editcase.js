const {
  PermissionsBitField,
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

const { run, get } = require('../../database');
const { sendLog, createLogEmbed } = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('editcase')
    .setDescription('Edit the reason of a moderation case')
    .addIntegerOption(option =>
      option.setName('case_id').setDescription('Case ID').setRequired(true).setMinValue(1)
    )
    .addStringOption(option =>
      option.setName('reason').setDescription('New reason').setRequired(true).setMinLength(2).setMaxLength(500)
    ),

  async execute(interaction) {
    try {
      // ✅ Ensure reply exists
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
      }

      // 🔐 Permission
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.editReply({
          content: '❌ You need **Manage Server** permission.'
        });
      }

      const caseId = interaction.options.getInteger('case_id', true);
      const newReason = interaction.options.getString('reason', true).trim();

      // 🔍 Fetch case (AWAITED)
      const caseData = await get(
        `SELECT * FROM cases WHERE guildId=? AND id=?`,
        [interaction.guild.id, caseId]
      );

      if (!caseData) {
        return interaction.editReply({
          content: '❌ Case not found.'
        });
      }

      const oldReasonFull = caseData.reason || 'No reason provided';

      // ✂️ Trim ONLY for display
      const displayOld =
        oldReasonFull.length > 300 ? oldReasonFull.slice(0, 300) + '...' : oldReasonFull;

      const displayNew =
        newReason.length > 300 ? newReason.slice(0, 300) + '...' : newReason;

      // 📝 Update DB (FULL reason stored)
      await run(
        `UPDATE cases SET reason=? WHERE guildId=? AND id=?`,
        [newReason, interaction.guild.id, caseId]
      );

      // ✅ Response
      const embed = new EmbedBuilder()
        .setColor(0xF1C40F)
        .setTitle(`Case #${caseId} Updated`)
        .addFields(
          { name: 'Old Reason', value: displayOld },
          { name: 'New Reason', value: displayNew }
        )
        .setFooter({ text: `Edited by ${interaction.user.tag}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      // 📜 Log
      const logEmbed = createLogEmbed({
        action: 'EDIT CASE',
        user: { id: caseData.userId },
        moderator: interaction.user,
        reason: `Old: ${displayOld}\nNew: ${displayNew}`,
        caseId
      });

      await sendLog(interaction.client, interaction.guild.id, logEmbed);

    } catch (err) {
      console.error('EditCase Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to edit case.'
        });
      } else {
        return interaction.reply({
          content: '❌ Failed to edit case.',
          ephemeral: true
        });
      }
    }
  }
};