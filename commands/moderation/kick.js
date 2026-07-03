const {

  PermissionsBitField,

  ActionRowBuilder,

  ButtonBuilder,

  ButtonStyle,

  EmbedBuilder,

  SlashCommandBuilder

} = require('discord.js');

const {
  run
} = require('../../database');

const {

  sendLog,

  createLogEmbed

} = require('../../utils/logger');

module.exports = {

  cooldown: 5000,

  data:
    new SlashCommandBuilder()

      .setName('kick')

      .setDescription(
        'Kick a user from the server'
      )

      .addUserOption(option =>

        option

          .setName('user')

          .setDescription(
            'User to kick'
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
      ),

  async execute(interaction) {

    try {

      // ==========================================
      // 🔐 MODERATOR PERMISSION
      // ==========================================
      if (

        !interaction.memberPermissions.has(

          PermissionsBitField.Flags.KickMembers
        )
      ) {

        return interaction.editReply({

          content:

            '❌ You lack permission to kick members.'
        });
      }

      // ==========================================
      // 🤖 BOT PERMISSION
      // ==========================================
      if (

        !interaction.guild.members.me.permissions.has(

          PermissionsBitField.Flags.KickMembers
        )
      ) {

        return interaction.editReply({

          content:

            '❌ I do not have Kick Members permission.'
        });
      }

      // ==========================================
      // 👤 OPTIONS
      // ==========================================
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

      // ==========================================
      // 🚫 SELF CHECK
      // ==========================================
      if (user.id === interaction.user.id) {

        return interaction.editReply({

          content:
            '❌ You cannot kick yourself.'
        });
      }

      // ==========================================
      // 🤖 BOT CHECK
      // ==========================================
      if (user.id === interaction.client.user.id) {

        return interaction.editReply({

          content:
            '❌ You cannot kick the bot.'
        });
      }

      // ==========================================
      // 👑 OWNER CHECK
      // ==========================================
      if (user.id === interaction.guild.ownerId) {

        return interaction.editReply({

          content:
            '❌ You cannot kick the server owner.'
        });
      }

      // ==========================================
      // 🔍 FETCH MEMBER
      // ==========================================
      let member =
        await interaction.guild.members

          .fetch(user.id)

          .catch(() => null);

      if (!member) {

        return interaction.editReply({

          content:
            '❌ User is not in this server.'
        });
      }

      // ==========================================
      // 🛡 USER HIERARCHY
      // ==========================================
      if (

        member.roles.highest.position >=

        interaction.member.roles.highest.position &&

        interaction.user.id !==
        interaction.guild.ownerId
      ) {

        return interaction.editReply({

          content:

            '❌ You cannot kick this user due to role hierarchy.'
        });
      }

      // ==========================================
      // 👑 ADMIN CHECK
      // ==========================================
      if (

        member.permissions.has(

          PermissionsBitField.Flags.Administrator
        ) &&

        interaction.user.id !==
        interaction.guild.ownerId
      ) {

        return interaction.editReply({

          content:
            '❌ You cannot kick administrators.'
        });
      }

      // ==========================================
      // 🤖 BOT HIERARCHY
      // ==========================================
      if (

        member.roles.highest.position >=

        interaction.guild.members.me.roles.highest.position
      ) {

        return interaction.editReply({

          content:

            '❌ My role is not high enough to kick this user.'
        });
      }

      // ==========================================
      // 🚫 KICKABLE CHECK
      // ==========================================
      if (!member.kickable) {

        return interaction.editReply({

          content:
            '❌ I cannot kick this user.'
        });
      }

      // ==========================================
      // 🎯 BUTTON IDS
      // ==========================================
      const confirmId =
        `confirm_kick_${interaction.id}`;

      const cancelId =
        `cancel_kick_${interaction.id}`;

      // ==========================================
      // 🎛 BUTTONS
      // ==========================================
      const row =
        new ActionRowBuilder()

          .addComponents(

            new ButtonBuilder()

              .setCustomId(confirmId)

              .setLabel(
                'Confirm Kick'
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
      // 🎨 CONFIRM EMBED
      // ==========================================
      const confirmEmbed =
        new EmbedBuilder()

          .setColor(0xED4245)

          .setTitle(
            '⚠️ Confirm Kick'
          )

          .setDescription(

            `Are you sure you want to kick ${user}?`
          )

          .addFields({

            name: '📄 Reason',

            value:
              reason
          })

          .setFooter({

            text:
              `Moderator: ${interaction.user.tag}`
          })

          .setTimestamp();

      // ==========================================
      // 📤 SEND CONFIRMATION
      // ==========================================
      const msg =
        await interaction.editReply({

          embeds: [confirmEmbed],

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
      collector.on('collect', async i => {

        try {

          if (handled) return;

          handled = true;

          await i.deferUpdate();

          // ======================================
          // 🔒 DISABLE BUTTONS
          // ======================================
          await interaction.editReply({

            components: []
          });

          // ======================================
          // ❌ CANCEL
          // ======================================
          if (i.customId === cancelId) {

            return interaction.editReply({

              content:
                '❌ Kick cancelled.',

              embeds: []
            });
          }

          // ======================================
          // 🔄 REFETCH MEMBER
          // ======================================
          member =
            await interaction.guild.members

              .fetch(user.id)

              .catch(() => null);

          if (!member) {

            return interaction.editReply({

              content:

                '❌ User is no longer in the server.',

              embeds: []
            });
          }

          // ======================================
          // 🔒 RECHECK HIERARCHY
          // ======================================
          if (

            member.roles.highest.position >=

            interaction.guild.members.me.roles.highest.position
          ) {

            return interaction.editReply({

              content:

                '❌ I can no longer kick this user.',

              embeds: []
            });
          }

          // ======================================
          // 📩 DM USER
          // ======================================
          try {

            await user.send({

              embeds: [

                new EmbedBuilder()

                  .setColor(0xED4245)

                  .setTitle(

                    `👢 You Were Kicked`
                  )

                  .setDescription(

                    `You were kicked from **${interaction.guild.name}**`
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

          // ======================================
          // 👢 KICK MEMBER
          // ======================================
          await member.kick(

            `${reason} | Kicked by ${interaction.user.tag}`
          );

          // ======================================
          // 💾 SAVE CASE
          // ======================================
          const result =
            run(

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

                'KICK',

                reason,

                Date.now()
              ]
            );

          const caseId =
            result?.lastInsertRowid || 'N/A';

          // ======================================
          // 📜 AUDIT LOG
          // ======================================
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

              'KICK',

              user.id,

              interaction.user.id,

              JSON.stringify({

                reason,

                caseId
              }),

              Date.now()
            ]
          );

          // ======================================
          // 🎨 SUCCESS EMBED
          // ======================================
          const successEmbed =
            new EmbedBuilder()

              .setColor(0x57F287)

              .setTitle(
                '👢 User Kicked'
              )

              .setDescription(

                `${user.tag} has been kicked successfully.`
              )

              .addFields(

                {

                  name: '👤 User ID',

                  value:
                    `\`${user.id}\``,

                  inline: true
                },

                {

                  name: '📁 Case',

                  value:
                    `#${caseId}`,

                  inline: true
                },

                {

                  name: '📄 Reason',

                  value:
                    reason
                }
              )

              .setFooter({

                text:
                  `Moderator: ${interaction.user.tag}`
              })

              .setTimestamp();

          // ======================================
          // 📤 RESPONSE
          // ======================================
          await interaction.editReply({

            embeds: [successEmbed]
          });

          // ======================================
          // 📜 MOD LOG
          // ======================================
          const logEmbed =
            createLogEmbed({

              action:
                'KICK',

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
            'Kick Collector Error:',
            err
          );

          return interaction.editReply({

            content:
              '❌ Failed to process kick.',

            embeds: [],

            components: []
          });
        }
      });

      // ==========================================
      // ⌛ TIMEOUT
      // ==========================================
      collector.on('end', async () => {

        if (!handled) {

          try {

            await interaction.editReply({

              content:
                '⌛ Kick timed out.',

              embeds: [],

              components: []
            });

          } catch {}
        }
      });

    } catch (err) {

      console.error(
        'Kick Command Error:',
        err
      );

      if (

        interaction.deferred ||

        interaction.replied
      ) {

        return interaction.editReply({

          content:
            '❌ Error executing kick command.'
        });
      }

      return interaction.reply({

        content:
          '❌ Error executing kick command.',

        flags: 64
      });
    }
  }
};