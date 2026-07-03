const {
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

const { run } = require('../../database');

const {
  sendLog,
  createLogEmbed
} = require('../../utils/logger');

module.exports = {

  cooldown: 3000,

  data:
    new SlashCommandBuilder()

      .setName('ban')

      .setDescription(
        'Ban a user from the server'
      )

      .addUserOption(option =>

        option

          .setName('user')

          .setDescription(
            'User to ban'
          )

          .setRequired(true)
      )

      .addStringOption(option =>

        option

          .setName('reason')

          .setDescription(
            'Reason'
          )

          .setMaxLength(200)
      )

      .addIntegerOption(option =>

        option

          .setName('delete_messages')

          .setDescription(
            'Delete message history (0-7 days)'
          )

          .setMinValue(0)

          .setMaxValue(7)
      ),

  async execute(interaction) {

    try {

      // ========================================
      // 🔐 MODERATOR PERMISSION
      // ========================================
      if (

        !interaction.memberPermissions.has(

          PermissionsBitField.Flags.BanMembers
        )
      ) {

        return interaction.editReply({

          content:
            '❌ You lack permission to ban members.'
        });
      }

      // ========================================
      // 🤖 BOT PERMISSION
      // ========================================
      if (

        !interaction.guild.members.me.permissions.has(

          PermissionsBitField.Flags.BanMembers
        )
      ) {

        return interaction.editReply({

          content:
            '❌ I do not have Ban Members permission.'
        });
      }

      // ========================================
      // 👤 OPTIONS
      // ========================================
      const user =
        interaction.options.getUser(
          'user',
          true
        );

      const reason =
        interaction.options.getString(
          'reason'
        ) ||

        'No reason provided';

      const deleteDays =
        interaction.options.getInteger(
          'delete_messages'
        ) || 0;

      // ========================================
      // ❌ BASIC CHECKS
      // ========================================
      if (user.id === interaction.user.id) {

        return interaction.editReply({

          content:
            '❌ You cannot ban yourself.'
        });
      }

      if (user.id === interaction.client.user.id) {

        return interaction.editReply({

          content:
            '❌ You cannot ban the bot.'
        });
      }

      if (user.id === interaction.guild.ownerId) {

        return interaction.editReply({

          content:
            '❌ You cannot ban the server owner.'
        });
      }

      // ========================================
      // 🔍 EXISTING BAN CHECK
      // ========================================
      const existingBan =
        await interaction.guild.bans

          .fetch(user.id)

          .catch(() => null);

      if (existingBan) {

        return interaction.editReply({

          content:
            '❌ This user is already banned.'
        });
      }

      // ========================================
      // 👤 FETCH MEMBER
      // ========================================
      let member =
        await interaction.guild.members

          .fetch(user.id)

          .catch(() => null);

      if (member) {

        // ======================================
        // 🔒 MODERATOR HIERARCHY
        // ======================================
        if (

          interaction.member.id !==
          interaction.guild.ownerId &&

          member.roles.highest.position >=

          interaction.member.roles.highest.position
        ) {

          return interaction.editReply({

            content:

              '❌ You cannot ban this user due to role hierarchy.'
          });
        }

        // ======================================
        // 👑 ADMIN CHECK
        // ======================================
        if (

          member.permissions.has(

            PermissionsBitField.Flags.Administrator
          ) &&

          interaction.user.id !==
          interaction.guild.ownerId
        ) {

          return interaction.editReply({

            content:
              '❌ You cannot ban administrators.'
          });
        }

        // ======================================
        // 🤖 BOT HIERARCHY
        // ======================================
        if (!member.bannable) {

          return interaction.editReply({

            content:
              '❌ I cannot ban this user.'
          });
        }
      }

      // ========================================
      // 🎯 BUTTON IDS
      // ========================================
      const confirmId =
        `confirm_ban_${interaction.id}`;

      const cancelId =
        `cancel_ban_${interaction.id}`;

      // ========================================
      // 🎛 BUTTONS
      // ========================================
      const row =
        new ActionRowBuilder()

          .addComponents(

            new ButtonBuilder()

              .setCustomId(confirmId)

              .setLabel(
                'Confirm Ban'
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

      // ========================================
      // 🎨 CONFIRM EMBED
      // ========================================
      const confirmEmbed =
        new EmbedBuilder()

          .setColor(0xED4245)

          .setTitle(
            '🔨 Confirm Ban'
          )

          .setDescription(

            `Are you sure you want to ban **${user.tag}**?\n\n` +

            `📄 Reason: ${reason}\n` +

            `🗑 Delete Messages: ${deleteDays} day(s)`
          )

          .setFooter({

            text:
              `Moderator: ${interaction.user.tag}`
          })

          .setTimestamp();

      const msg =
        await interaction.editReply({

          embeds: [confirmEmbed],

          components: [row]
        });

      let handled = false;

      // ========================================
      // 🎛 COLLECTOR
      // ========================================
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

      // ========================================
      // 📥 BUTTON CLICK
      // ========================================
      collector.on('collect', async i => {

        if (handled) return;

        handled = true;

        try {

          await i.update({

            components: []
          });

          // ====================================
          // ❌ CANCEL
          // ====================================
          if (i.customId === cancelId) {

            return interaction.editReply({

              content:
                '❌ Ban cancelled.',

              embeds: [],

              components: []
            });
          }

          // ====================================
          // 🔄 REFETCH MEMBER
          // ====================================
          member =
            await interaction.guild.members

              .fetch(user.id)

              .catch(() => null);

          if (

            member &&

            !member.bannable
          ) {

            return interaction.editReply({

              content:
                '❌ I can no longer ban this user.',

              embeds: [],

              components: []
            });
          }

          // ====================================
          // 📩 DM USER
          // ====================================
          try {

            await user.send({

              embeds: [

                new EmbedBuilder()

                  .setColor(0xED4245)

                  .setTitle(
                    '🔨 You Were Banned'
                  )

                  .setDescription(

                    `You were banned from **${interaction.guild.name}**`
                  )

                  .addFields(

                    {

                      name: '📄 Reason',

                      value:
                        reason
                    },

                    {

                      name: '🛡 Moderator',

                      value:
                        interaction.user.tag
                    }
                  )

                  .setTimestamp()
              ]
            });

          } catch {}

          // ====================================
          // 🔨 BAN USER
          // ====================================
          await interaction.guild.members.ban(
            user.id,
            {

              deleteMessageSeconds:
                deleteDays * 86400,

              reason:

                `${reason} | Banned by ${interaction.user.tag}`
            }
          );

          // ====================================
          // 💾 SAVE CASE
          // ====================================
          const result =
            await run(

              `INSERT INTO cases

              (
                guildId,
                userId,
                moderatorId,
                action,
                reason,
                createdAt
              )

              VALUES (?, ?, ?, ?, ?, ?)`,

              [

                interaction.guild.id,

                user.id,

                interaction.user.id,

                'BAN',

                reason,

                Date.now()
              ]
            );

          const caseId =
            result?.lastInsertRowid || 'N/A';

          // ====================================
          // 🎨 SUCCESS EMBED
          // ====================================
          const embed =
            new EmbedBuilder()

              .setColor(0xED4245)

              .setTitle(
                '🔨 User Banned'
              )

              .setDescription(

                `Successfully banned **${user.tag}**`
              )

              .addFields(

                {

                  name: '📄 Reason',

                  value:
                    reason
                },

                {

                  name: '🗑 Deleted Messages',

                  value:
                    `${deleteDays} day(s)`,

                  inline: true
                },

                {

                  name: '📁 Case',

                  value:
                    `#${caseId}`,

                  inline: true
                }
              )

              .setFooter({

                text:
                  `Moderator: ${interaction.user.tag}`
              })

              .setTimestamp();

          // ====================================
          // 📤 RESPONSE
          // ====================================
          await interaction.editReply({

            content: '',

            embeds: [embed],

            components: []
          });

          // ====================================
          // 📜 LOG
          // ====================================
          const logEmbed =
            createLogEmbed({

              action: 'BAN',

              user,

              moderator:
                interaction.user,

              reason,

              caseId
            });

          await sendLog(

            interaction.client,

            interaction.guild.id,

            logEmbed
          );

        } catch (err) {

          console.error(
            'Ban Collector Error:',
            err
          );

          return interaction.editReply({

            content:
              '❌ Failed to ban user.',

            embeds: [],

            components: []
          });
        }
      });

      // ========================================
      // ⌛ TIMEOUT
      // ========================================
      collector.on('end', async () => {

        if (!handled) {

          try {

            await interaction.editReply({

              content:
                '⌛ Ban timed out.',

              embeds: [],

              components: []
            });

          } catch {}
        }
      });

    } catch (err) {

      console.error(
        'Ban Command Error:',
        err
      );

      if (

        interaction.deferred ||

        interaction.replied
      ) {

        return interaction.editReply({

          content:
            '❌ Error executing ban command.'
        });
      }

      return interaction.reply({

        content:
          '❌ Error executing ban command.',

        flags: 64
      });
    }
  }
};