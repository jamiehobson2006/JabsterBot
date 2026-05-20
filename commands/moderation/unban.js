const {

  PermissionsBitField,

  SlashCommandBuilder,

  EmbedBuilder,

  ChannelType

} = require('discord.js');

const {

  run

} = require('../../database');

const {

  sendLog,

  createLogEmbed

} = require('../../utils/logger');

module.exports = {

  cooldown: 3000,

  data:
    new SlashCommandBuilder()

      .setName('unban')

      .setDescription(
        'Unban a user by ID'
      )

      .addStringOption(option =>

        option

          .setName('user_id')

          .setDescription(
            'The ID of the user to unban'
          )

          .setRequired(true)
      )

      .addStringOption(option =>

        option

          .setName('reason')

          .setDescription(
            'Reason for unbanning'
          )

          .setMaxLength(300)
      ),

  async execute(interaction) {

    try {

      // ========================
      // 🔐 USER PERMISSION
      // ========================
      if (

        !interaction.memberPermissions.has(

          PermissionsBitField.Flags.BanMembers
        )
      ) {

        return interaction.editReply({

          content:

            '❌ You need **Ban Members** permission.'
        });
      }

      // ========================
      // 🤖 BOT MEMBER
      // ========================
      const botMember =
        interaction.guild.members.me;

      // ========================
      // 🤖 BOT PERMISSION
      // ========================
      if (

        !botMember.permissions.has(

          PermissionsBitField.Flags.BanMembers
        )
      ) {

        return interaction.editReply({

          content:

            '❌ I do not have permission to unban members.'
        });
      }

      // ========================
      // 📥 OPTIONS
      // ========================
      const userId =
        interaction.options.getString(

          'user_id',

          true
        );

      const reason =
        interaction.options.getString(
          'reason'
        ) ||

        'No reason provided';

      // ========================
      // 🛡 VALIDATE ID
      // ========================
      if (

        !/^\d{17,20}$/.test(userId)
      ) {

        return interaction.editReply({

          content:
            '❌ Invalid Discord user ID.'
        });
      }

      // ========================
      // 🚫 SELF CHECK
      // ========================
      if (

        userId ===
        interaction.user.id
      ) {

        return interaction.editReply({

          content:
            '❌ You cannot unban yourself.'
        });
      }

      // ========================
      // 🔍 FETCH BAN
      // ========================
      let ban;

      try {

        ban =
          await interaction.guild.bans.fetch(
            userId
          );

      } catch {

        return interaction.editReply({

          content:
            '❌ That user is not banned.'
        });
      }

      // ========================
      // 🔓 UNBAN
      // ========================
      await interaction.guild.members.unban(

        userId,

        `${reason} | By ${interaction.user.tag}`
      );

      // ========================
      // 🔗 CREATE INVITE
      // ========================
      let inviteLink =
        null;

      try {

        // ======================================
        // 📺 CURRENT CHANNEL
        // ======================================
        if (

          interaction.channel &&

          interaction.channel.type ===
          ChannelType.GuildText &&

          interaction.channel.permissionsFor(
            botMember
          )?.has([

            PermissionsBitField.Flags.ViewChannel,

            PermissionsBitField.Flags.CreateInstantInvite
          ])
        ) {

          const invite =
            await interaction.channel.createInvite({

              maxAge:
                86400,

              maxUses:
                1,

              unique:
                true,

              reason:

                `Invite for unbanned user ${userId}`
            });

          inviteLink =
            invite.url;
        }

        // ======================================
        // 📺 FALLBACK CHANNEL
        // ======================================
        if (!inviteLink) {

          const fallback =
            interaction.guild.channels.cache.find(c =>

              c.type ===
              ChannelType.GuildText &&

              c.permissionsFor(
                botMember
              )?.has([

                PermissionsBitField.Flags.ViewChannel,

                PermissionsBitField.Flags.CreateInstantInvite
              ])
            );

          if (fallback) {

            const invite =
              await fallback.createInvite({

                maxAge:
                  86400,

                maxUses:
                  1,

                unique:
                  true,

                reason:

                  `Invite for unbanned user ${userId}`
              });

            inviteLink =
              invite.url;
          }
        }

      } catch (err) {

        console.error(
          'Invite Creation Error:',
          err
        );
      }

      // ========================
      // 📩 DM USER
      // ========================
      try {

        const fetchedUser =
          await interaction.client.users.fetch(
            userId
          );

        const dmEmbed =
          new EmbedBuilder()

            .setColor(
              0x57F287
            )

            .setTitle(
              '🔓 You Were Unbanned'
            )

            .setDescription(

              `You have been unbanned from **${interaction.guild.name}**.`
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
                  interaction.user.tag,

                inline: true
              }
            )

            .setTimestamp();

        // ======================================
        // 🔗 INVITE
        // ======================================
        if (inviteLink) {

          dmEmbed.addFields({

            name:
              '🔗 Rejoin Server',

            value:
              inviteLink
          });
        }

        await fetchedUser.send({

          embeds: [dmEmbed]
        });

      } catch (err) {

        console.error(

          'Failed to DM unbanned user:',

          err
        );
      }

      // ========================
      // 💾 SAVE CASE
      // ========================
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

            userId,

            interaction.user.id,

            'UNBAN',

            reason,

            Date.now()
          ]
        );

      const caseId =
        result?.lastInsertRowid || 'N/A';

      // ========================
      // 📜 AUDIT LOG
      // ========================
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

          'UNBAN',

          userId,

          interaction.user.id,

          JSON.stringify({

            reason,

            caseId,

            inviteCreated:
              !!inviteLink
          }),

          Date.now()
        ]
      );

      // ========================
      // 🎨 RESPONSE
      // ========================
      const embed =
        new EmbedBuilder()

          .setColor(
            0x57F287
          )

          .setTitle(
            '🔓 User Unbanned'
          )

          .setDescription(

            `Successfully unbanned **${ban.user.tag}**`
          )

          .addFields(

            {

              name: '👤 User',

              value:

                `${ban.user.tag}\n\`${userId}\``,

              inline: true
            },

            {

              name: '🛡 Moderator',

              value:
                `${interaction.user.tag}`,

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
              `${interaction.guild.name} Moderation`
          })

          .setTimestamp();

      // ========================
      // 🔗 INVITE STATUS
      // ========================
      if (inviteLink) {

        embed.addFields({

          name:
            '🔗 Invite Created',

          value:
            'A rejoin invite was sent to the user.'
        });
      }

      // ========================
      // ✅ RESPONSE
      // ========================
      await interaction.editReply({

        embeds: [embed]
      });

      // ========================
      // 🗑 AUTO DELETE
      // ========================
      setTimeout(() => {

        if (!interaction.ephemeral) {

          interaction

            .deleteReply()

            .catch(() => {});
        }

      }, 4000);

      // ========================
      // 📜 MOD LOG
      // ========================
      const logEmbed =
        createLogEmbed({

          action:
            'UNBAN',

          user:
            ban.user,

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
        'Unban Error:',
        err
      );

      if (

        interaction.deferred ||

        interaction.replied
      ) {

        return interaction.editReply({

          content:
            '❌ Failed to unban user.'
        });
      }

      return interaction.reply({

        content:
          '❌ Failed to unban user.',

        ephemeral: true
      });
    }
  }
};