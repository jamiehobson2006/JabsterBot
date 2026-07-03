const {

  PermissionsBitField,

  EmbedBuilder,

  SlashCommandBuilder

} = require('discord.js');

const {

  run,

  all

} = require('../../database');

const {

  sendLog,

  createLogEmbed

} = require('../../utils/logger');

// ==================================================
// ⏱ PARSE DURATION
// Supports:
// 10s
// 5m
// 1h
// 1d
// 1w
// 1h30m
// 2w3d4h
// ==================================================
function parseDuration(input) {

  if (!input) return null;

  input = input
    .toLowerCase()
    .replace(/\s+/g, '');

  // ================================================
  // 🛡 BASIC LENGTH PROTECTION
  // ================================================
  if (input.length > 20) {

    return null;
  }

  // ================================================
  // ✅ VALIDATION
  // ================================================
  const valid =
    /^(\d+(s|m|h|d|w))+$/;

  if (!valid.test(input)) {

    return null;
  }

  const regex =
    /(\d+)(s|m|h|d|w)/g;

  let match;

  let total =
    0;

  const multipliers = {

    s: 1000,

    m: 60000,

    h: 3600000,

    d: 86400000,

    w: 604800000
  };

  while (

    (match = regex.exec(input)) !== null
  ) {

    const value =
      parseInt(match[1]);

    const unit =
      match[2];

    total +=
      value * multipliers[unit];
  }

  return total || null;
}

// ==================================================
// 🕒 FORMAT DURATION
// ==================================================
function formatDuration(ms) {

  const units = [

    ['w', 604800000],

    ['d', 86400000],

    ['h', 3600000],

    ['m', 60000],

    ['s', 1000]
  ];

  const parts = [];

  for (const [label, value] of units) {

    const amount =
      Math.floor(ms / value);

    if (amount > 0) {

      parts.push(
        `${amount}${label}`
      );

      ms -= amount * value;
    }
  }

  return parts.join(' ');
}

module.exports = {

  cooldown: 5000,

  data:
    new SlashCommandBuilder()

      .setName('mute')

      .setDescription(
        'Timeout (mute) a user'
      )

      .addUserOption(option =>

        option

          .setName('user')

          .setDescription(
            'User to mute'
          )

          .setRequired(true)
      )

      .addStringOption(option =>

        option

          .setName('duration')

          .setDescription(
            'Examples: 10m, 1h, 1d, 1w, 1h30m'
          )

          .setRequired(true)

          .setMaxLength(50)
      )

      .addStringOption(option =>

        option

          .setName('reason')

          .setDescription(
            'Reason for muting'
          )

          .setMaxLength(300)
      ),

  async execute(interaction) {

    try {

      // ==========================================
      // 🔐 USER PERMISSION
      // ==========================================
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

      // ==========================================
      // 🤖 BOT PERMISSION
      // ==========================================
      const botMember =
        interaction.guild.members.me;

      if (

        !botMember.permissions.has(

          PermissionsBitField.Flags.ModerateMembers
        )
      ) {

        return interaction.editReply({

          content:

            '❌ I do not have permission to timeout members.'
        });
      }

      // ==========================================
      // 📥 OPTIONS
      // ==========================================
      const user =
        interaction.options.getUser(

          'user',

          true
        );

      const durationInput =
        interaction.options.getString(

          'duration',

          true
        );

      const reason =
        interaction.options.getString(
          'reason'
        ) ||

        'No reason provided';

      // ==========================================
      // ⏱ PARSE DURATION
      // ==========================================
      const duration =
        parseDuration(
          durationInput
        );

      if (!duration) {

        return interaction.editReply({

          content:

            '❌ Invalid duration.\nExamples: `10m`, `1h`, `1w`, `1h30m`'
        });
      }

      // ==========================================
      // ⛔ MINIMUM
      // ==========================================
      if (duration < 5000) {

        return interaction.editReply({

          content:

            '❌ Minimum timeout duration is **5 seconds**.'
        });
      }

      // ==========================================
      // ⛔ MAXIMUM
      // ==========================================
      const max =
        28 * 24 * 60 * 60 * 1000;

      if (duration > max) {

        return interaction.editReply({

          content:

            '❌ Maximum timeout duration is **28 days**.'
        });
      }

      // ==========================================
      // 🚫 BASIC CHECKS
      // ==========================================
      if (user.id === interaction.user.id) {

        return interaction.editReply({

          content:
            '❌ You cannot mute yourself.'
        });
      }

      if (user.id === interaction.client.user.id) {

        return interaction.editReply({

          content:
            '❌ You cannot mute the bot.'
        });
      }

      if (user.id === interaction.guild.ownerId) {

        return interaction.editReply({

          content:
            '❌ You cannot mute the server owner.'
        });
      }

      // ==========================================
      // 👤 FETCH MEMBER
      // ==========================================
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

      // ==========================================
      // 🤖 BOT CHECK
      // ==========================================
      if (member.user.bot) {

        return interaction.editReply({

          content:
            '❌ You cannot mute bots.'
        });
      }

      // ==========================================
      // 🚫 ADMIN CHECK
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
            '❌ You cannot mute administrators.'
        });
      }

      // ==========================================
      // 🔼 HIERARCHY
      // ==========================================
      if (

        member.roles.highest.position >=

        interaction.member.roles.highest.position &&

        interaction.user.id !==
        interaction.guild.ownerId
      ) {

        return interaction.editReply({

          content:

            '❌ You cannot mute this user due to role hierarchy.'
        });
      }

      // ==========================================
      // 🤖 BOT HIERARCHY
      // ==========================================
      if (!member.moderatable) {

        return interaction.editReply({

          content:
            '❌ I cannot mute this user.'
        });
      }

      // ==========================================
      // ⚠️ ALREADY MUTED
      // ==========================================
      if (

        member.communicationDisabledUntilTimestamp >

        Date.now()
      ) {

        const remaining =
          member.communicationDisabledUntilTimestamp -

          Date.now();

        return interaction.editReply({

          content:

            `⚠️ This user is already muted.\nRemaining: **${formatDuration(remaining)}**`
        });
      }

      // ==========================================
      // 📊 PREVIOUS MUTES
      // ==========================================
      const previousMutes =
        all(

          `SELECT *
           FROM cases

           WHERE guildId = ?
           AND userId = ?
           AND action = 'MUTE'`,

          [

            interaction.guild.id,

            user.id
          ]
        );

      // ==========================================
      // ⏱ TIME INFO
      // ==========================================
      const pretty =
        formatDuration(duration);

      const expiresAt =
        Date.now() + duration;

      // ==========================================
      // 🔇 APPLY TIMEOUT
      // ==========================================
      await member.timeout(

        duration,

        `${reason} | By ${interaction.user.tag}`
      );

      // ==========================================
      // 📩 DM USER
      // ==========================================
      try {

        await user.send({

          embeds: [

            new EmbedBuilder()

              .setColor(0xED4245)

              .setTitle(

                `🔇 You Were Muted`
              )

              .setDescription(

                `You were muted in **${interaction.guild.name}**`
              )

              .addFields(

                {

                  name: '📄 Reason',

                  value:
                    reason
                },

                {

                  name: '⏱ Duration',

                  value:
                    pretty,

                  inline: true
                },

                {

                  name: '🕒 Expires',

                  value:

                    `<t:${Math.floor(

                      expiresAt / 1000

                    )}:F>`,

                  inline: true
                }
              )

              .setTimestamp()
          ]
        });

      } catch {}

      // ==========================================
      // 💾 SAVE CASE
      // ==========================================
      const result =
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

            interaction.user.id,

            'MUTE',

            reason,

            duration,

            expiresAt,

            Date.now()
          ]
        );

      const caseId =
        result?.lastInsertRowid || 'N/A';

      // ==========================================
      // 💾 ACTIVE TIMEOUT TRACKING
      // ==========================================
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

          caseId,

          expiresAt
        ]
      );

      // ==========================================
      // ✅ RESPONSE
      // ==========================================
      await interaction.editReply({

        embeds: [

          new EmbedBuilder()

            .setColor(0xED4245)

            .setTitle(
              '🔇 User Muted'
            )

            .setDescription(

              `Successfully muted ${user}`
            )

            .addFields(

              {

                name: '⏱ Duration',

                value:
                  pretty,

                inline: true
              },

              {

                name: '🕒 Expires',

                value:

                  `<t:${Math.floor(

                    expiresAt / 1000

                  )}:F>`,

                inline: true
              },

              {

                name: '📄 Case',

                value:
                  `#${caseId}`,

                inline: true
              },

              {

                name: '📊 Previous Mutes',

                value:
                  `${previousMutes.length}`,

                inline: true
              },

              {

                name: '📝 Reason',

                value:
                  reason
              }
            )

            .setFooter({

              text:
                `Muted by ${interaction.user.tag}`
            })

            .setTimestamp()
        ]
      });

      // ==========================================
      // 📜 LOG
      // ==========================================
      const logEmbed =
        createLogEmbed({

          action:
            'MUTE',

          user,

          moderator:
            interaction.user,

          reason:

            `${reason}\nDuration: ${pretty}`,

          caseId
        });

      await sendLog(

        interaction.client,

        interaction.guild.id,

        logEmbed
      );

    } catch (err) {

      console.error(
        'Mute Error:',
        err
      );

      if (

        interaction.deferred ||

        interaction.replied
      ) {

        return interaction.editReply({

          content:
            '❌ Failed to execute mute.'
        });
      }

      return interaction.reply({

        content:
          '❌ Failed to execute mute.',

        flags: 64
      });
    }
  }
};