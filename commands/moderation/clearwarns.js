const {
  PermissionsBitField,
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

const { run, get } = require('../../database');
const { sendLog, createLogEmbed } = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clearwarns')
    .setDescription('Clear all warnings for a user')
    .addUserOption(option =>
      option.setName('user').setDescription('User').setRequired(true)
    ),

  async execute(interaction) {
    try {
      const user = interaction.options.getUser('user', true);

      // 🔐 Permission
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.editReply({
          content: '❌ You need **Manage Server** permission.'
        });
      }

      // 🚫 Basic checks
      if (user.id === interaction.user.id) {
        return interaction.editReply({ content: '❌ You cannot clear your own warnings.' });
      }

      if (user.id === interaction.client.user.id) {
        return interaction.editReply({ content: '❌ You cannot clear the bot’s warnings.' });
      }

      if (user.id === interaction.guild.ownerId) {
        return interaction.editReply({ content: '❌ You cannot clear warnings for the server owner.' });
      }

      // 🔄 Member check (hierarchy)
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);

      if (member) {
        if (member.roles.highest.position >= interaction.member.roles.highest.position) {
          return interaction.editReply({
            content: '❌ You cannot clear warnings for this user (role hierarchy).'
          });
        }
      }

      // 🔢 Get warn count (SYNC)
      const row = get(
        `SELECT count FROM warns WHERE guildId=? AND userId=?`,
        [interaction.guild.id, user.id]
      );

      const warnCount = row?.count || 0;

      if (warnCount === 0) {
        return interaction.editReply({
          content: `ℹ️ ${user.tag} has no warnings to clear.`
        });
      }

      // 🧹 Delete warns
      run(
        `DELETE FROM warns WHERE guildId=? AND userId=?`,
        [interaction.guild.id, user.id]
      );

      // 📁 Case log
      const result = run(
        `INSERT INTO cases (guildId, userId, moderatorId, action, reason, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          interaction.guild.id,
          user.id,
          interaction.user.id,
          'CLEAR',
          `Cleared ${warnCount} warnings`,
          Date.now()
        ]
      );

      const caseId = result?.lastInsertRowid ?? 'N/A';

      // 📩 DM user (silent fail)
      try {
        await user.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0xE67E22)
              .setTitle('Your warnings were cleared')
              .setDescription(
                `Your warnings in **${interaction.guild.name}** have been cleared.\n\n` +
                `Amount removed: **${warnCount}**`
              )
              .setTimestamp()
          ]
        });
      } catch {}

      // ✅ Response
      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('Warnings Cleared')
        .setDescription(`🧹 Cleared **${warnCount} warnings** for <@${user.id}>`)
        .addFields({
          name: 'Case',
          value: `#${caseId}`,
          inline: true
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      // 📜 Mod log
      const logEmbed = createLogEmbed({
        action: 'CLEAR WARNINGS',
        user,
        moderator: interaction.user,
        reason: `Cleared ${warnCount} warnings`,
        caseId
      });

      await sendLog(interaction.client, interaction.guild.id, logEmbed);

    } catch (err) {
      console.error('ClearWarns Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to clear warnings.'
        });
      } else {
        return interaction.reply({
          content: '❌ Failed to clear warnings.',
          flags: 64
        });
      }
    }
  }
};