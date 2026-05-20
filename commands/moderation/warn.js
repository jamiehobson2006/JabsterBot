const {

  PermissionsBitField,

  EmbedBuilder,

  SlashCommandBuilder

} = require('discord.js');

const {

  run,

  get,

  all

} = require('../../database');

const {

  sendLog,

  createLogEmbed

} = require('../../utils/logger');

// ========================
// ⏱ AUTO PUNISHMENTS
// ========================
const punishments = {

  3: {

    type: 'timeout',

    duration:
      10 * 60 * 1000 // 10m
  },

  5: {

    type: 'timeout',

    duration:
      60 * 60 * 1000 // 1h
  }
};

// ========================
// ⏱ FORMAT DURATION
// ========================
function formatDuration(ms) {

  const h =
    Math.floor(ms / 3600000);

  const m =
    Math.floor(
      (ms % 3600000) / 60000
    );

  const parts = [];

  if (h > 0) {

    parts.push(`${h}h`);
  }

  if (m > 0) {

    parts.push(`${m}m`);
  }

  return parts.join(' ') || '0m';
}

module.exports = {

  cooldown: 3000,

  data:
    new SlashCommandBuilder()

      .setName('warn')

      .setDescription(
        'Warn a user'
      )

      .addUserOption(option =>

        option

          .setName('user')

          .setDescription(
            'User to warn'
          )

          .setRequired(true)
      )

      .addStringOption(option =>

        option

          .setName('reason')

          .setDescription(
            'Reason for warning'
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
        interaction.user.id
      ) {

        return interaction.editReply({

          content:
            '❌ You cannot warn yourself.'
        });
      }

      if (

        user.id ===
        interaction.client.user.id
      ) {

        return interaction.editReply({

          content:
            '❌ You cannot warn the bot.'
        });
      }

      if (

        user.id ===
        interaction.guild.ownerId
      ) {

        return interaction.editReply({

          content:
            '❌ You cannot warn the server owner.'
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

            '❌ User not found in this server.'
        });
      }

      // ========================
      // 🔼 USER HIERARCHY
      // ========================
      if (

        !isOwner &&

        member.id !== interaction.user.id &&

        member.roles.highest.position >=

        interaction.member.roles.highest.position
      ) {

        return interaction.editReply({

          content:

            '❌ You cannot warn this user due to role hierarchy.'
        });
      }

      // ========================
      // 🤖 BOT HIERARCHY
      // ========================
      if (

        member.roles.highest.position >=

        botMember.roles.highest.position
      ) {

        return interaction.editReply({

          content:

            '❌ I cannot warn this user due to role hierarchy.'
        });
      }

      // ========================
      // 📊 FETCH PREVIOUS WARNS
      // ========================
      const previousWarns =
        all(

          `SELECT *
           FROM cases

           WHERE guildId = ?
           AND userId = ?
           AND action = 'WARN'`,

          [

            interaction.guild.id,

            user.id
          ]
        );

      // ========================
      // 🔢 UPDATE WARN COUNT
      // ========================
      run(

        `INSERT INTO warns

         (
           guildId,
           userId,
           count
         )

         VALUES (?, ?, 1)

         ON CONFLICT(guildId, userId)

         DO UPDATE SET

         count = count + 1`,

        [

          interaction.guild.id,

          user.id
        ]
      );

      const row =
        get(

          `SELECT count
           FROM warns

           WHERE guildId = ?
           AND userId = ?`,

          [

            interaction.guild.id,

            user.id
          ]
        );

      const warnCount =
        row?.count || 1;

      // ========================
      // 📁 CREATE CASE
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

            'WARN',

            reason,

            Date.now()
          ]
        );

      const caseId =
        result?.lastInsertRowid || 'N/A';

      // ========================
      // 🚨 ESCALATION
      // ========================
      let escalationText =
        null;

      let autoCaseId =
        null;

      const punishment =
        punishments[warnCount];

      if (

        punishment &&

        member.moderatable
      ) {

        try {

          // ====================
          // 🔇 TIMEOUT
          // ====================
          if (

            punishment.type ===
            'timeout'
          ) {

            await member.timeout(

              punishment.duration,

              `Auto punishment (${warnCount} warns)`
            );

            escalationText =

              `🔇 Automatic timeout applied (${formatDuration(punishment.duration)})`;

            // ====================
            // 💾 ACTIVE TIMEOUT
            // ====================
            const expiresAt =
              Date.now() +

              punishment.duration;

            const autoResult =
              run(

                `INSERT INTO cases

                 (
                   guildId,
                   userId,
                   moderatorId,
                   action,
                   reason,
                   duration,
                   expiresAt,
                   createdAt
                 )

                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,

                [

                  interaction.guild.id,

                  user.id,

                  interaction.client.user.id,

                  'AUTO-TIMEOUT',

                  `Reached ${warnCount} warns`,

                  punishment.duration,

                  expiresAt,

                  Date.now()
                ]
              );

            autoCaseId =
              autoResult?.lastInsertRowid || null;

            run(

              `INSERT INTO active_timeouts

               (
                 guildId,
                 userId,
                 caseId,
                 expiresAt
               )

               VALUES (?, ?, ?, ?)`,

              [

                interaction.guild.id,

                user.id,

                autoCaseId,

                expiresAt
              ]
            );
          }

        } catch (err) {

          console.error(

            'Warn Escalation Error:',

            err
          );
        }
      }

      // ========================
      // 📩 DM USER
      // ========================
      try {

        const dmEmbed =
          new EmbedBuilder()

            .setColor(
              0xF1C40F
            )

            .setTitle(
              '⚠️ You Were Warned'
            )

            .setDescription(

              `You were warned in **${interaction.guild.name}**.`
            )

            .addFields(

              {

                name: '📄 Reason',

                value:
                  reason
              },

              {

                name: '⚠️ Total Warnings',

                value:
                  `${warnCount}`,

                inline: true
              },

              {

                name: '📁 Case',

                value:
                  `#${caseId}`,

                inline: true
              }
            );

        // ====================
        // 🚨 AUTO ACTION
        // ====================
        if (escalationText) {

          dmEmbed.addFields({

            name:
              '🚨 Automatic Action',

            value:
              escalationText
          });
        }

        dmEmbed.setTimestamp();

        await user.send({

          embeds: [dmEmbed]
        });

      } catch {}

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

          'WARN',

          user.id,

          interaction.user.id,

          JSON.stringify({

            reason,

            warnCount,

            caseId,

            autoPunishment:
              escalationText || null
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
            0xF1C40F
          )

          .setTitle(
            '⚠️ User Warned'
          )

          .setDescription(

            `${user} has been warned.`
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

              name: '⚠️ Total Warns',

              value:
                `${warnCount}`,

              inline: true
            },

            {

              name: '📁 Case',

              value:
                `#${caseId}`,

              inline: true
            },

            {

              name: '📊 Previous Warns',

              value:
                `${previousWarns.length}`,

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
      // 🚨 ESCALATION DISPLAY
      // ========================
      if (escalationText) {

        embed.addFields({

          name:
            '🚨 Automatic Action',

          value:

            autoCaseId

              ? `${escalationText}\nCase: #${autoCaseId}`

              : escalationText
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
            'WARN',

          user,

          moderator:
            interaction.user,

          reason:

            `${reason}\nTotal Warns: ${warnCount}` +

            (
              escalationText

                ? `\n${escalationText}`

                : ''
            ),

          caseId
        });

      await sendLog(

        interaction.client,

        interaction.guild.id,

        log
      );

    } catch (err) {

      console.error(
        'Warn Error:',
        err
      );

      if (

        interaction.deferred ||

        interaction.replied
      ) {

        return interaction.editReply({

          content:
            '❌ Failed to warn user.'
        });
      }

      return interaction.reply({

        content:
          '❌ Failed to warn user.',

        ephemeral: true
      });
    }
  }
};