const {

  PermissionsBitField,

  ActionRowBuilder,

  ButtonBuilder,

  ButtonStyle,

  EmbedBuilder,

  SlashCommandBuilder

} = require('discord.js');

const {

  run,

  get

} = require('../../database');

const {

  sendLog,

  createLogEmbed

} = require('../../utils/logger');

module.exports = {

  cooldown: 5000,

  data:
    new SlashCommandBuilder()

      .setName('modlogremove')

      .setDescription(
        'Delete a moderation case'
      )

      .addIntegerOption(option =>

        option

          .setName('case_id')

          .setDescription(
            'Case ID'
          )

          .setRequired(true)

          .setMinValue(1)
      )

      .addStringOption(option =>

        option

          .setName('reason')

          .setDescription(
            'Reason for deleting this case'
          )

          .setRequired(true)

          .setMinLength(3)

          .setMaxLength(300)
      ),

  async execute(interaction) {

    try {

      // ==========================================
      // 🔐 SAFE DEFER
      // ==========================================
      if (

        !interaction.deferred &&

        !interaction.replied
      ) {

        await interaction.deferReply({

          ephemeral: true
        });
      }

      // ==========================================
      // 🔐 PERMISSION CHECK
      // ==========================================
      if (

        !interaction.memberPermissions.has(

          PermissionsBitField.Flags.ManageGuild
        )
      ) {

        return interaction.editReply({

          content:

            '❌ You need **Manage Server** permission.'
        });
      }

      // ==========================================
      // 🆔 OPTIONS
      // ==========================================
      const caseId =
        interaction.options.getInteger(

          'case_id',

          true
        );

      const deleteReason =
        interaction.options.getString(

          'reason',

          true
        );

      // ==========================================
      // 🔍 FETCH CASE
      // ==========================================
      const caseData =
        get(

          `SELECT *
           FROM cases

           WHERE guildId = ?
           AND id = ?`,

          [

            interaction.guild.id,

            caseId
          ]
        );

      // ==========================================
      // ❌ NOT FOUND
      // ==========================================
      if (!caseData) {

        return interaction.editReply({

          content:
            '❌ Case not found.'
        });
      }

      // ==========================================
      // 🔒 PROTECTED CASES
      // ==========================================
      const protectedActions = [

        'BAN',

        'UNBAN',

        'KICK'
      ];

      if (

        protectedActions.includes(

          caseData.action?.toUpperCase()
        ) &&

        !interaction.memberPermissions.has(

          PermissionsBitField.Flags.Administrator
        )
      ) {

        return interaction.editReply({

          content:

            '❌ Only administrators can delete serious moderation cases.'
        });
      }

      // ==========================================
      // 🧠 CLEAN REASON
      // ==========================================
      let reason =
        caseData.reason ||

        'No reason provided';

      if (reason.length > 200) {

        reason =
          reason.slice(0, 200) + '...';
      }

      // ==========================================
      // 🎯 UNIQUE BUTTON IDS
      // ==========================================
      const confirmId =
        `confirm_delete_${interaction.id}`;

      const cancelId =
        `cancel_delete_${interaction.id}`;

      // ==========================================
      // 🔘 BUTTONS
      // ==========================================
      const row =
        new ActionRowBuilder()

          .addComponents(

            new ButtonBuilder()

              .setCustomId(confirmId)

              .setLabel(
                'Confirm Delete'
              )

              .setStyle(
                ButtonStyle.Danger
              ),

            new ButtonBuilder()

              .setCustomId(cancelId)

              .setLabel(
                'Cancel'
              )

              .setStyle(
                ButtonStyle.Secondary
              )
          );

      // ==========================================
      // 📤 CONFIRM MESSAGE
      // ==========================================
      const msg =
        await interaction.editReply({

          embeds: [

            new EmbedBuilder()

              .setColor(0xED4245)

              .setTitle(
                '⚠️ Confirm Case Deletion'
              )

              .setDescription(

                `Delete case **#${caseId} (${caseData.action})** for <@${caseData.userId}>?`
              )

              .addFields(

                {

                  name: '📄 Original Reason',

                  value:
                    reason
                },

                {

                  name: '🗑 Delete Reason',

                  value:
                    deleteReason
                }
              )

              .setFooter({

                text:

                  `Requested by ${interaction.user.tag}`
              })

              .setTimestamp()
          ],

          components: [row]
        });

      let handled =
        false;

      // ==========================================
      // 📦 COLLECTOR
      // ==========================================
      const collector =
        msg.createMessageComponentCollector({

          time: 15000,

          filter: i =>

            i.user.id === interaction.user.id &&

            [

              confirmId,

              cancelId

            ].includes(i.customId)
        });

      // ==========================================
      // 🔘 BUTTON CLICK
      // ==========================================
      collector.on(

        'collect',

        async i => {

          if (handled) return;

          handled = true;

          try {

            // ====================================
            // ✅ ACKNOWLEDGE
            // ====================================
            await i.deferUpdate();

            // ====================================
            // 🔒 DISABLE BUTTONS
            // ====================================
            const disabledRow =
              new ActionRowBuilder()

                .addComponents(

                  ButtonBuilder.from(

                    row.components[0]

                  ).setDisabled(true),

                  ButtonBuilder.from(

                    row.components[1]

                  ).setDisabled(true)
                );

            await interaction.editReply({

              components: [disabledRow]
            });

            // ====================================
            // ❌ CANCEL
            // ====================================
            if (

              i.customId === cancelId
            ) {

              return interaction.editReply({

                content:
                  '❌ Deletion cancelled.',

                embeds: [],

                components: []
              });
            }

            // ====================================
            // 💾 BACKUP CASE
            // ====================================
            run(

              `INSERT INTO deleted_cases

               (
                 guildId,
                 originalCaseId,
                 deletedBy,
                 deletedAt,
                 deleteReason,
                 caseData
               )

               VALUES (?, ?, ?, ?, ?, ?)`,

              [

                interaction.guild.id,

                caseId,

                interaction.user.id,

                Date.now(),

                deleteReason,

                JSON.stringify(caseData)
              ]
            );

            // ====================================
            // 🗑 DELETE CASE
            // ====================================
            run(

              `DELETE FROM cases

               WHERE guildId = ?
               AND id = ?`,

              [

                interaction.guild.id,

                caseId
              ]
            );

            // ====================================
            // ⚠️ REMOVE WARN ENTRY
            // ====================================
            if (

              caseData.action?.toUpperCase() ===

              'WARN'
            ) {

              run(

                `DELETE FROM warns

                 WHERE id = (

                   SELECT id
                   FROM warns

                   WHERE guildId = ?
                   AND userId = ?

                   ORDER BY id DESC

                   LIMIT 1
                 )`,

                [

                  interaction.guild.id,

                  caseData.userId
                ]
              );
            }

            // ====================================
            // 📜 AUDIT LOG
            // ====================================
            run(

              `INSERT INTO audit_logs

               (
                 guildId,
                 action,
                 targetId,
                 executorId,
                 metadata,
                 timestamp
               )

               VALUES (?, ?, ?, ?, ?, ?)`,

              [

                interaction.guild.id,

                'DELETE_CASE',

                caseData.userId,

                interaction.user.id,

                JSON.stringify({

                  caseId,

                  originalAction:
                    caseData.action,

                  deleteReason
                }),

                Date.now()
              ]
            );

            // ====================================
            // ✅ SUCCESS
            // ====================================
            await interaction.editReply({

              embeds: [

                new EmbedBuilder()

                  .setColor(0x57F287)

                  .setTitle(
                    '🗑️ Case Deleted'
                  )

                  .setDescription(

                    `Successfully removed case **#${caseId} (${caseData.action})**`
                  )

                  .addFields(

                    {

                      name: '👤 User',

                      value:
                        `<@${caseData.userId}>`,

                      inline: true
                    },

                    {

                      name: '🛡 Moderator',

                      value:
                        `${interaction.user}`,

                      inline: true
                    },

                    {

                      name: '📄 Delete Reason',

                      value:
                        deleteReason
                    }
                  )

                  .setTimestamp()
              ],

              components: []
            });

            // ====================================
            // 📜 MOD LOG
            // ====================================
            const logEmbed =
              createLogEmbed({

                action:
                  'DELETE CASE',

                user: {

                  id:
                    caseData.userId,

                  tag:
                    `User (${caseData.userId})`
                },

                moderator:
                  interaction.user,

                reason:

                  `Deleted case #${caseId} (${caseData.action})\n\n` +

                  `Reason: ${deleteReason}`,

                caseId
              });

            await sendLog(

              interaction.client,

              interaction.guild.id,

              logEmbed
            );

          } catch (err) {

            console.error(
              'Delete Collector Error:',
              err
            );

            return interaction.editReply({

              content:
                '❌ Failed to process deletion.',

              embeds: [],

              components: []
            });
          }
        }
      );

      // ==========================================
      // ⌛ TIMEOUT
      // ==========================================
      collector.on(

        'end',

        async () => {

          if (!handled) {

            try {

              const disabledRow =
                new ActionRowBuilder()

                  .addComponents(

                    ButtonBuilder.from(

                      row.components[0]

                    ).setDisabled(true),

                    ButtonBuilder.from(

                      row.components[1]

                    ).setDisabled(true)
                  );

              await interaction.editReply({

                content:
                  '⌛ Deletion timed out.',

                components: [disabledRow]
              });

            } catch {}
          }
        }
      );

    } catch (err) {

      console.error(
        'ModlogRemove Error:',
        err
      );

      if (

        interaction.deferred ||

        interaction.replied
      ) {

        return interaction.editReply({

          content:
            '❌ Failed to remove case.'
        });
      }

      return interaction.reply({

        content:
          '❌ Failed to remove case.',

        ephemeral: true
      });
    }
  }
};