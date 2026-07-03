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

// ==================================================
// ✂ SAFE TRIM
// ==================================================
function trim(
  text,
  max = 300
) {

  if (!text) {

    return 'No reason provided';
  }

  return text.length > max

    ? text.slice(0, max) + '...'

    : text;
}

module.exports = {

  cooldown: 3000,

  data:
    new SlashCommandBuilder()

      .setName('editcase')

      .setDescription(
        'Edit the reason of a moderation case'
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
            'New reason'
          )

          .setRequired(true)

          .setMinLength(2)

          .setMaxLength(500)
      ),

  async execute(interaction) {

    try {

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

      const newReason =
        interaction.options

          .getString(
            'reason',
            true
          )

          .trim();

      // ==========================================
      // ❌ EMPTY CHECK
      // ==========================================
      if (!newReason.length) {

        return interaction.editReply({

          content:
            '❌ Reason cannot be empty.'
        });
      }

      // ==========================================
      // 📄 FETCH CASE
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

      const oldReason =
        caseData.reason ||

        'No reason provided';

      // ==========================================
      // ⚠ SAME REASON
      // ==========================================
      if (oldReason === newReason) {

        return interaction.editReply({

          content:

            '⚠️ The new reason is the same as the current one.'
        });
      }

      // ==========================================
      // 📝 UPDATE CASE
      // ==========================================
      run(

        `UPDATE cases

         SET reason = ?

         WHERE guildId = ?
         AND id = ?`,

        [

          newReason,

          interaction.guild.id,

          caseId
        ]
      );

      // ==========================================
      // 📜 AUDIT LOG DB
      // ==========================================
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

          'EDIT_CASE',

          caseData.userId,

          interaction.user.id,

          JSON.stringify({

            caseId,

            oldReason,

            newReason
          }),

          Date.now()
        ]
      );

      // ==========================================
      // 🎨 RESPONSE EMBED
      // ==========================================
      const embed =
        new EmbedBuilder()

          .setColor(0xF1C40F)

          .setTitle(
            `📝 Case #${caseId} Updated`
          )

          .setDescription(

            'The moderation case reason has been successfully updated.'
          )

          .addFields(

            {

              name: '👤 User',

              value:
                `<@${caseData.userId}>`,

              inline: true
            },

            {

              name: '📌 Action',

              value:
                `\`${caseData.action}\``,

              inline: true
            },

            {

              name: '🛡 Edited By',

              value:
                `${interaction.user}`,

              inline: true
            },

            {

              name: '📄 Previous Reason',

              value:
                trim(oldReason)
            },

            {

              name: '📝 New Reason',

              value:
                trim(newReason)
            },

            {

              name: '🕒 Original Case Date',

              value:

                `<t:${Math.floor(

                  (caseData.createdAt || Date.now()) / 1000

                )}:F>`
            }
          )

          .setFooter({

            text:
              `Case ID: ${caseId}`
          })

          .setTimestamp();

      // ==========================================
      // 📤 RESPONSE
      // ==========================================
      await interaction.editReply({

        embeds: [embed]
      });

      // ==========================================
      // 📜 MOD LOG
      // ==========================================
      const logEmbed =
        createLogEmbed({

          action:
            'EDIT CASE',

          user: {

            id:
              caseData.userId,

            tag:
              `User (${caseData.userId})`
          },

          moderator:
            interaction.user,

          reason:

            `Old: ${trim(oldReason)}\n\n` +

            `New: ${trim(newReason)}`,

          caseId
        });

      await sendLog(

        interaction.client,

        interaction.guild.id,

        logEmbed
      );

    } catch (err) {

      console.error(
        'EditCase Error:',
        err
      );

      if (

        interaction.deferred ||

        interaction.replied
      ) {

        return interaction.editReply({

          content:
            '❌ Failed to edit case.'
        });
      }

      return interaction.reply({

        content:
          '❌ Failed to edit case.',

        flags: 64
      });
    }
  }
};