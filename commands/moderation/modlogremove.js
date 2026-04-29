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
      option.setName('case_id').setDescription('Case ID').setRequired(true).setMinValue(1)
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

      const caseData = await get(
        `SELECT * FROM cases WHERE guildId=? AND id=?`,
        [interaction.guild.id, caseId]
      );

      if (!caseData) {
        return interaction.editReply({
          content: '❌ Case not found.'
        });
      }

      let reason = caseData.reason || 'No reason';
      if (reason.length > 200) reason = reason.slice(0, 200) + '...';

      // 🎯 Confirmation UI
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`confirm_delete_${interaction.id}`)
          .setLabel('Confirm Delete')
          .setStyle(ButtonStyle.Danger),

        new ButtonBuilder()
          .setCustomId(`cancel_delete_${interaction.id}`)
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
              `📄 ${reason}`
            )
        ],
        components: [row]
      });

      // 🔒 Filtered collector
      const collector = msg.createMessageComponentCollector({
        time: 15000,
        filter: i => i.user.id === interaction.user.id
      });

      collector.on('collect', async (i) => {
        await i.update({ components: [] });

        if (i.customId === `cancel_delete_${interaction.id}`) {
          return interaction.editReply({
            content: '❌ Deletion cancelled.'
          });
        }

        if (i.customId === `confirm_delete_${interaction.id}`) {
          try {
            // 🗑 Delete case
            await run(
              `DELETE FROM cases WHERE guildId=? AND id=?`,
              [interaction.guild.id, caseId]
            );

            // ⚠️ Fix warn count
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

            const embed = new EmbedBuilder()
              .setColor(0xED4245)
              .setTitle('Case Deleted')
              .setDescription(
                `🗑️ Removed case **#${caseId} (${caseData.action})** for <@${caseData.userId}>`
              );

            await interaction.editReply({ embeds: [embed] });

            // 📜 Log
            const logEmbed = createLogEmbed({
              action: 'DELETE CASE',
              user: { id: caseData.userId },
              moderator: interaction.user,
              reason: `Deleted case #${caseId} (${caseData.action})`,
              caseId
            });

            await sendLog(interaction.client, interaction.guild.id, logEmbed);

          } catch (err) {
            console.error(err);
            return interaction.editReply({
              content: '❌ Failed to delete case.'
            });
          }
        }
      });

      collector.on('end', async (collected) => {
        if (!collected.size) {
          try {
            await interaction.editReply({
              content: '⌛ Deletion timed out.',
              components: []
            });
          } catch {}
        }
      });

    } catch (err) {
      console.error('ModlogRemove Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to remove case.'
        });
      } else {
        return interaction.reply({
          content: '❌ Failed to remove case.',
          ephemeral: true
        });
      }
    }
  }
};