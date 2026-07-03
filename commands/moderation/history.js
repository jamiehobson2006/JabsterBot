const {

  EmbedBuilder,

  PermissionsBitField,

  SlashCommandBuilder

} = require('discord.js');

const {
  all
} = require('../../database');

// ==================================================
// ✂ CLEAN REASON
// ==================================================
function trim(
  text,
  max = 150
) {

  if (!text) {

    return 'No reason provided';
  }

  return text.length > max

    ? text.slice(0, max) + '...'

    : text;
}

// ==================================================
// 🎨 FORMAT ACTION
// ==================================================
function formatAction(action) {

  if (!action) {

    return 'Unknown';
  }

  const map = {

    BAN:
      '🔨 Ban',

    UNBAN:
      '🔓 Unban',

    KICK:
      '👢 Kick',

    MUTE:
      '🔇 Mute',

    UNMUTE:
      '🔊 Unmute',

    WARN:
      '⚠️ Warn',

    CLEARWARNS:
      '🧹 Clear Warns',

    LOCK:
      '🔒 Lock',

    UNLOCK:
      '🔓 Unlock',

    ROLE_ADD:
      '➕ Role Added',

    ROLE_REMOVE:
      '➖ Role Removed',

    EDIT_CASE:
      '✏️ Edit Case'
  };

  return map[
    action.toUpperCase()
  ] || action;
}

module.exports = {

  cooldown: 3000,

  data:
    new SlashCommandBuilder()

      .setName('history')

      .setDescription(
        'View moderation history for a user'
      )

      .addUserOption(option =>

        option

          .setName('user')

          .setDescription(
            'User to view history for'
          )

          .setRequired(true)
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
      // 👤 USER
      // ==========================================
      const user =
        interaction.options.getUser(

          'user',

          true
        );

      // ==========================================
      // 📄 FETCH CASES
      // ==========================================
      const cases =
        all(

          `SELECT *
           FROM cases

           WHERE guildId = ?
           AND userId = ?

           ORDER BY id DESC

           LIMIT 20`,

          [

            interaction.guild.id,

            user.id
          ]
        );

      // ==========================================
      // ❌ NO HISTORY
      // ==========================================
      if (!cases.length) {

        return interaction.editReply({

          content:

            `ℹ️ No history found for ${user.tag}.`
        });
      }

      // ==========================================
      // 📊 STATS
      // ==========================================
      const stats = {};

      for (const c of cases) {

        const key =

          c.action?.toUpperCase()

          || 'UNKNOWN';

        stats[key] =

          (stats[key] || 0) + 1;
      }

      // ==========================================
      // 📈 SUMMARY
      // ==========================================
      const summary =
        Object.entries(stats)

          .map(

            ([k, v]) =>

              `**${k}**: ${v}`
          )

          .join(' • ')

          || 'No data';

      // ==========================================
      // 🎨 EMBED
      // ==========================================
      const embed =
        new EmbedBuilder()

          .setTitle(

            `📜 History for ${user.tag}`
          )

          .setColor(
            0x5865F2
          )

          .setThumbnail(

            user.displayAvatarURL({

              dynamic: true
            })
          )

          .setDescription(

            `## Recent Activity\n` +

            `${summary}`
          )

          .addFields({

            name: '📊 Total Cases',

            value:
              `\`${cases.length}\``,

            inline: true
          })

          .setFooter({

            text:

              `Showing latest ${Math.min(

                10,

                cases.length

              )} cases`
          })

          .setTimestamp();

      // ==========================================
      // 📜 CASE ENTRIES
      // ==========================================
      for (const c of cases.slice(0, 10)) {

        embed.addFields({

          name:

            `#${c.id} • ${formatAction(

              c.action
            )}`,

          value:

            `👮 Moderator: ${

              c.moderatorId

                ? `<@${c.moderatorId}>`

                : '`Unknown`'
            }\n` +

            `🕒 Time: ${

              c.createdAt

                ? `<t:${Math.floor(

                    c.createdAt / 1000

                  )}:R>`

                : '`Unknown`'
            }\n` +

            `📄 Reason: ${trim(

              c.reason
            )}`,

          inline: false
        });
      }

      // ==========================================
      // ➕ MORE CASES
      // ==========================================
      if (cases.length > 10) {

        embed.addFields({

          name: '➕ More Cases',

          value:

            `+ ${

              cases.length - 10

            } more case(s)`
        });
      }

      // ==========================================
      // 📤 RESPONSE
      // ==========================================
      return interaction.editReply({

        embeds: [embed]
      });

    } catch (err) {

      console.error(
        'History Command Error:',
        err
      );

      if (

        interaction.deferred ||

        interaction.replied
      ) {

        return interaction.editReply({

          content:
            '❌ Failed to fetch history.'
        });
      }

      return interaction.reply({

        content:
          '❌ Failed to fetch history.',

        flags: 64
      });
    }
  }
};