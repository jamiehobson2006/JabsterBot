const {

  PermissionsBitField,

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

  cooldown: 3000,

  data:
    new SlashCommandBuilder()

      .setName('unmute')

      .setDescription(
        'Remove timeout (unmute) from a user'
      )

      .addUserOption(option =>

        option

          .setName('user')

          .setDescription(
            'User to unmute'
          )

          .setRequired(true)
      )

      .addStringOption(option =>

        option

          .setName('reason')

          .setDescription(
            'Reason for unmuting'
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

          PermissionsBitField.Flags.ModerateMembers
        )
      ) {

        return interaction.editReply({

          content:

            '❌ You need **Moderate Members** permission.'
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

          PermissionsBitField.Flags.ModerateMembers
        )
      ) {

        return interaction.editReply({

          content:

            '❌ I do not have permission to moderate members.'
        });
      }

      // ========================
      // 📥 OPTIONS
      // ========================
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

      // ========================
      // 🚫 BASIC CHECKS
      // ========================
      if (

        user.id ===
        interaction.client.user.id
      ) {

        return interaction.editReply({

          content:
            '❌ You cannot unmute the bot.'
        });
      }

      if (

        user.id ===
        interaction.guild.ownerId
      ) {

        return interaction.editReply({

          content:
            '❌ You cannot unmute the server owner.'
        });
      }

      // ========================
      // 👑 OWNER BYPASS
      // ========================
      const isOwner =
        interaction.user.id ===
        interaction.guild.ownerId;

      // ========================
      // 👤 FETCH MEMBER
      // ========================
      const member =
        await interaction.guild.members

          .fetch(user.id)

          .catch(() => null);

      if (!member) {

        return interaction.editReply({

          content:
            '❌ User not found.'
        });
      }

      // ========================
      // 🔼 ROLE HIERARCHY
      // ========================
      if (

        !isOwner &&

        member.id !== interaction.user.id &&

        member.roles.highest.position >=

        interaction.member.roles.highest.position
      ) {

        return interaction.editReply({

          content:

            '❌ You cannot unmute this user due to role hierarchy.'
        });
      }

      // ========================
      // 🚫 BOT HIERARCHY
      // ========================
      if (!member.moderatable) {

        return interaction.editReply({

          content:
            '❌ I cannot unmute this user.'
        });
      }

      // ========================
      // 🔍 CHECK TIMEOUT
      // ========================
      if (

        !member.isCommunicationDisabled()
      ) {

        return interaction.editReply({

          content:
            '⚠️ This user is not muted.'
        });
      }

      // ========================
      // 📊 FETCH LAST MUTE
      // ========================
      const lastMute =
        get(

          `SELECT *
           FROM cases

           WHERE guildId = ?
           AND userId = ?
           AND action = 'MUTE'

           ORDER BY id DESC
           LIMIT 1`,

          [

            interaction.guild.id,

            user.id
          ]
        );

      // ========================
      // 🔊 REMOVE TIMEOUT
      // ========================
      await member.timeout(

        null,

        `${reason} | Unmuted by ${interaction.user.tag}`
      );

      // ========================
      // 🧹 REMOVE ACTIVE TIMEOUT
      // ========================
      run(

        `DELETE FROM active_timeouts

         WHERE guildId = ?
         AND userId = ?`,

        [

          interaction.guild.id,

          user.id
        ]
      );

      // ========================
      // 📩 DM USER
      // ========================
      try {

        const dmEmbed =
          new EmbedBuilder()

            .setColor(
              0x57F287
            )

            .setTitle(
              '🔊 You Were Unmuted'
            )

            .setDescription(

              `You were unmuted in **${interaction.guild.name}**.`
            )

            .addFields({

              name: '📄 Reason',

              value:
                reason
            });

        // ====================
        // ⏱ PREVIOUS DURATION
        // ====================
        if (lastMute?.duration) {

          const minutes =
            Math.floor(
              lastMute.duration / 60000
            );

          dmEmbed.addFields({

            name:
              '⏱ Previous Timeout',

            value:
              `${minutes} minute(s)`,

            inline: true
          });
        }

        dmEmbed.setTimestamp();

        await user.send({

          embeds: [dmEmbed]
        });

      } catch {}

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

            user.id,

            interaction.user.id,

            'UNMUTE',

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

          'UNMUTE',

          user.id,

          interaction.user.id,

          JSON.stringify({

            reason,

            caseId,

            previousMuteCase:
              lastMute?.id || null
          }),

          Date.now()
        ]
      );

      // ========================
      // 🎨 RESPONSE EMBED
      // ========================
      const embed =
        new EmbedBuilder()

          .setColor(
            0x57F287
          )

          .setTitle(
            '🔊 User Unmuted'
          )

          .setDescription(

            `Successfully unmuted ${user}`
          )

          .addFields(

            {

              name: '👤 User',

              value:
                `${user.tag}`,

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
      // ⏱ PREVIOUS TIMEOUT
      // ========================
      if (lastMute?.duration) {

        const minutes =
          Math.floor(
            lastMute.duration / 60000
          );

        embed.addFields({

          name:
            '⏱ Previous Timeout',

          value:
            `${minutes} minute(s)`,

          inline: true
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

      }, 3000);

      // ========================
      // 📜 MOD LOG
      // ========================
      const log =
        createLogEmbed({

          action:
            'UNMUTE',

          user,

          moderator:
            interaction.user,

          reason,

          caseId
        });

      await sendLog(

        interaction.client,

        interaction.guild.id,

        log
      );

    } catch (err) {

      console.error(
        'Unmute Error:',
        err
      );

      if (

        interaction.deferred ||

        interaction.replied
      ) {

        return interaction.editReply({

          content:
            '❌ Failed to unmute user.'
        });
      }

      return interaction.reply({

        content:
          '❌ Failed to unmute user.',

        flags: 64
      });
    }
  }
};