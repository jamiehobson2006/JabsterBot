const {
  EmbedBuilder,
  PermissionsBitField,
  SlashCommandBuilder
} = require('discord.js');

const {
  get,
  all
} = require('../../database');

// ========================
// 🎨 WARNING STATUS
// ========================
function getWarningStatus(count) {

  if (count >= 5) {

    return {

      color: 0xED4245,

      status: '⛔ High Risk',

      emoji: '🔴'
    };
  }

  if (count >= 3) {

    return {

      color: 0xFEE75C,

      status: '⚠️ At Risk',

      emoji: '🟡'
    };
  }

  if (count >= 1) {

    return {

      color: 0xFAA61A,

      status: '⚠️ Minor Warnings',

      emoji: '🟠'
    };
  }

  return {

    color: 0x57F287,

    status: '✅ Clean Record',

    emoji: '🟢'
  };
}

// ========================
// ✂️ TRIM TEXT
// ========================
function trim(text, max = 120) {

  if (!text) {

    return 'No reason provided';
  }

  return text.length > max

    ? text.slice(0, max) + '...'

    : text;
}

// ========================
// 📊 WARNING BAR
// ========================
function createBar(count) {

  const max =
    Math.max(
      Math.min(count, 10),
      0
    );

  const empty =
    10 - max;

  return (
    '🟥'.repeat(max) +
    '⬛'.repeat(empty)
  );
}

module.exports = {

  cooldown: 3000,

  data:
    new SlashCommandBuilder()

      .setName('warnings')

      .setDescription(
        'View warnings for a user'
      )

      .addUserOption(option =>

        option

          .setName('user')

          .setDescription(
            'User to check warnings for'
          )
      ),

  async execute(interaction) {

    try {

      // ========================
      // 👤 TARGET
      // ========================
      const target =
        interaction.options.getUser('user') ||

        interaction.user;

      const guildId =
        interaction.guild.id;

      // ========================
      // 🔐 PERMISSIONS
      // ========================
      const hasPerms =
        interaction.memberPermissions.has(
          PermissionsBitField.Flags.ModerateMembers
        );

      if (

        target.id !== interaction.user.id &&

        !hasPerms
      ) {

        return interaction.editReply({

          content:
            '❌ You can only view your own warnings.'
        });
      }

      // ========================
      // 🔢 TOTAL WARNS
      // ========================
      const row =
        await get(

          `SELECT count
          FROM warns

          WHERE guildId = ?
          AND userId = ?`,

          [

            guildId,

            target.id
          ]
        );

      const warns =
        row?.count || 0;

      // ========================
      // 📜 WARNING HISTORY
      // ========================
      const recent =
        await all(

          `SELECT *
          FROM cases

          WHERE guildId = ?
          AND userId = ?
          AND action = 'WARN'

          ORDER BY id DESC
          LIMIT 10`,

          [

            guildId,

            target.id
          ]
        );

      // ========================
      // 🎨 STATUS
      // ========================
      const warningData =
        getWarningStatus(warns);

      // ========================
      // 📊 BAR
      // ========================
      const progressBar =
        createBar(warns);

      // ========================
      // 📜 HISTORY
      // ========================
      let history =
        'No warnings found.';

      if (recent.length > 0) {

        const lines = [];

        let totalLength = 0;

        for (const c of recent) {

          // ====================
          // 🕒 SAFE TIMESTAMP
          // ====================
          const time =
            c.createdAt ||

            c.timestamp ||

            Date.now();

          const entry = (

            `**#${c.id}** • ` +

            `<t:${Math.floor(time / 1000)}:R>\n` +

            `👮 Moderator: ` +

            `${
              c.moderatorId

                ? `<@${c.moderatorId}>`

                : '`Unknown`'
            }\n` +

            `📄 ${trim(c.reason)}`
          );

          // ====================
          // 🛡 EMBED LIMIT
          // ====================
          if (
            totalLength + entry.length > 900
          ) {

            lines.push(
              `\n+ ${recent.length - lines.length} more warning(s)...`
            );

            break;
          }

          lines.push(entry);

          totalLength +=
            entry.length;
        }

        history =
          lines.join('\n\n');
      }

      // ========================
      // 👤 MEMBER
      // ========================
      const member =
        await interaction.guild.members

          .fetch(target.id)

          .catch(() => null);

      // ========================
      // 🎨 EMBED
      // ========================
      const embed =
        new EmbedBuilder()

          .setTitle(
            '⚠️ Warning History'
          )

          .setColor(
            warningData.color
          )

          .setThumbnail(

            target.displayAvatarURL({

              dynamic: true,

              size: 512
            })
          )

          .setDescription(

            `${target} currently has ` +

            `**${warns} warning(s)**.\n\n` +

            `${progressBar}\n` +

            `${warningData.emoji} ${warningData.status}`
          )

          .addFields(

            {

              name:
                '👤 User',

              value:
                `${target.tag}`,

              inline: true
            },

            {

              name:
                '🆔 User ID',

              value:
                `\`${target.id}\``,

              inline: true
            },

            {

              name:
                '📊 Total Warnings',

              value:
                `\`${warns}\``,

              inline: true
            },

            {

              name:
                '📅 Joined Server',

              value:

                member?.joinedTimestamp

                  ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`

                  : 'Unknown',

              inline: true
            },

            {

              name:
                '🤖 Bot',

              value:
                target.bot ? 'Yes' : 'No',

              inline: true
            },

            {

              name:
                '🛡 Moderation Status',

              value:
                warningData.status,

              inline: true
            },

            {

              name:
                '📜 Recent Warnings',

              value:
                history,

              inline: false
            }
          )

          .setFooter({

            text:
              `Requested by ${interaction.user.tag}`
          })

          .setTimestamp();

      // ========================
      // ✅ RESPONSE
      // ========================
      return interaction.editReply({

        embeds: [embed]
      });

    } catch (err) {

      console.error(
        'Warnings Error:',
        err
      );

      if (

        interaction.deferred ||

        interaction.replied
      ) {

        return interaction.editReply({

          content:
            '❌ Failed to fetch warnings.'
        });
      }

      return interaction.reply({

        content:
          '❌ Failed to fetch warnings.',

        ephemeral: true
      });
    }
  }
};