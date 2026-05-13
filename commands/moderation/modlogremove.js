const {
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

const { run, get } = require('../../database');
const { sendLog, createLogEmbed } = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('modlogremove')
    .setDescription('Delete a moderation case')
    .addIntegerOption(option =>
      option
        .setName('case_id')
        .setDescription('Case ID')
        .setRequired(true)
        .setMinValue(1)
    ),

  async execute(interaction) {
    try {

      // âœ… SAFE DEFER (CRITICAL FIX)
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
      }

      // ðŸ” Permission
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.editReply({
          content: 'âŒ You need **Manage Server** permission.'
        });
      }

      const caseId = interaction.options.getInteger('case_id', true);

      const caseData = await get(
        `SELECT * FROM cases WHERE guildId=? AND id=?`,
        [interaction.guild.id, caseId]
      );

      if (!caseData) {
        return interaction.editReply({
          content: 'âŒ Case not found.'
        });
      }

      let reason = caseData.reason || 'No reason';
      if (reason.length > 200) reason = reason.slice(0, 200) + '...';

      // ðŸŽ¯ Unique button IDs
      const confirmId = `confirm_delete_${interaction.id}`;
      const cancelId = `cancel_delete_${interaction.id}`;

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(confirmId)
          .setLabel('Confirm Delete')
          .setStyle(ButtonStyle.Danger),

        new ButtonBuilder()
          .setCustomId(cancelId)
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
      );

      const msg = await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xED4245)
            .setTitle('Confirm Case Deletion')
            .setDescription(
              `Delete case **#${caseId} (${caseData.action})** for <@${caseData.userId}>?\n\n` +
              `ðŸ“„ ${reason}`
            )
        ],
        components: [row]
      });

      let handled = false;

      const collector = msg.createMessageComponentCollector({
        time: 15000,
        filter: i =>
          i.user.id === interaction.user.id &&
          [confirmId, cancelId].includes(i.customId)
      });

      collector.on('collect', async (i) => {
        if (handled) return;
        handled = true;

        try {
          // âœ… SAFE ACK (FIXES 10062)
          await i.update({ components: [] }).catch(() => {});

          if (i.customId === cancelId) {
            return interaction.editReply({
              content: 'âŒ Deletion cancelled.'
            });
          }

          if (i.customId === confirmId) {

            // ðŸ—‘ Delete case
            await run(
              `DELETE FROM cases WHERE guildId=? AND id=?`,
              [interaction.guild.id, caseId]
            );

            // âš ï¸ Fix warn count
            if (caseData.action === 'WARN') {
              const warnRow = await get(
                `SELECT count FROM warns WHERE guildId=? AND userId=?`,
                [interaction.guild.id, caseData.userId]
              );

              if (warnRow) {
                const newCount = Math.max((warnRow.count || 0) - 1, 0);

                if (newCount === 0) {
                  await run(
                    `DELETE FROM warns WHERE guildId=? AND userId=?`,
                    [interaction.guild.id, caseData.userId]
                  );
                } else {
                  await run(
                    `UPDATE warns SET count=? WHERE guildId=? AND userId=?`,
                    [newCount, interaction.guild.id, caseData.userId]
                  );
                }
              }
            }

            await interaction.editReply({
              embeds: [
                new EmbedBuilder()
                  .setColor(0x57F287)
                  .setTitle('Case Deleted')
                  .setDescription(
                    `ðŸ—‘ï¸ Removed case **#${caseId} (${caseData.action})** for <@${caseData.userId}>`
                  )
              ]
            });

            // ðŸ“œ Log
            const logEmbed = createLogEmbed({
              action: 'DELETE CASE',
              user: { id: caseData.userId },
              moderator: interaction.user,
              reason: `Deleted case #${caseId} (${caseData.action})`,

            });

            await sendLog(interaction.client, interaction.guild.id, logEmbed);
          }

        } catch (err) {
          console.error('Delete Collector Error:', err);

          return interaction.editReply({
            content: 'âŒ Failed to process deletion.'
          });
        }
      });

      collector.on('end', async () => {
        if (!handled) {
          try {
            await interaction.editReply({
              content: 'âŒ› Deletion timed out.',
              components: []
            });
          } catch {}
        }
      });

    } catch (err) {
      console.error('ModlogRemove Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: 'âŒ Failed to remove case.'
        });
      } else {
        return interaction.reply({
          content: 'âŒ Failed to remove case.',
          ephemeral: true
        });
      }
    }
  }
};

