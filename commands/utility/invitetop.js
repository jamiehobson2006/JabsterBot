const {

  EmbedBuilder,

  SlashCommandBuilder

} = require('discord.js');

const {

  all

} = require('../../database');

// ========================
// 🏆 MEDALS
// ========================
const medals = [

  '🥇',
  '🥈',
  '🥉'
];

// ========================
// 🎖 RANK STYLE
// ========================
function getRank(total) {

  if (total >= 100) {

    return '🌟 Legendary';
  }

  if (total >= 50) {

    return '🔥 Elite';
  }

  if (total >= 20) {

    return '🚀 Active';
  }

  if (total >= 5) {

    return '📈 Growing';
  }

  return '🌱 Beginner';
}

// ========================
// 📊 CALCULATE TOTAL
// ========================
function calculateTotal(entry) {

  const invites =
    entry.invites || 0;

  const fake =
    entry.fake || 0;

  const leaves =
    entry.leaves || 0;

  const bonus =
    entry.bonus || 0;

  const regular =
    Math.max(

      invites -
      fake -
      leaves,

      0
    );

  const total =
    regular + bonus;

  return {

    invites,
    fake,
    leaves,
    bonus,
    regular,
    total
  };
}

module.exports = {

  cooldown: 5000,

  data:
    new SlashCommandBuilder()

      .setName('invitetop')

      .setDescription(
        'View the server invite leaderboard'
      ),

  async execute(interaction) {

    try {

      // ========================
      // 📊 FETCH RAW DATA
      // ========================
      const raw =
        all(

          `SELECT *

           FROM invite_stats

           WHERE guildId = ?`,

          [

            interaction.guild.id
          ]
        );

      // ========================
      // ❌ NO DATA
      // ========================
      if (!raw.length) {

        return interaction.editReply({

          content:
            '❌ No invite data found yet.'
        });
      }

      // ========================
      // 🧠 PROCESS DATA
      // ========================
      const processed =
        raw.map(entry => {

          const data =
            calculateTotal(entry);

          return {

            ...entry,

            ...data
          };
        });

      // ========================
      // 🏆 SORT LEADERBOARD
      // ========================
      const leaderboard =
        processed

          .sort((a, b) =>
            b.total - a.total
          )

          .slice(0, 10);

      // ========================
      // 🏆 BUILD LINES
      // ========================
      const lines = [];

      for (
        let i = 0;
        i < leaderboard.length;
        i++
      ) {

        const entry =
          leaderboard[i];

        const user =
          await interaction.client.users

            .fetch(entry.userId)

            .catch(() => null);

        const place =

          medals[i] ||

          `\`${i + 1}.\``;

        const rank =
          getRank(entry.total);

        lines.push(

          `${place} **${user ? user.tag : 'Unknown User'}**\n` +

          `┗ 🏆 ${entry.total} total invites\n` +

          `┗ ✅ ${entry.regular} regular • 🎁 ${entry.bonus} bonus\n` +

          `┗ ⚠️ ${entry.fake} fake • 📤 ${entry.leaves} leaves\n` +

          `┗ ${rank}`
        );
      }

      // ========================
      // 👑 TOP USER
      // ========================
      const top =
        leaderboard[0];

      // ========================
      // 📊 SERVER TOTALS
      // ========================
      const totalInvites =
        processed.reduce(

          (acc, cur) =>

            acc + cur.total,

          0
        );

      const totalFake =
        processed.reduce(

          (acc, cur) =>

            acc + cur.fake,

          0
        );

      const totalLeaves =
        processed.reduce(

          (acc, cur) =>

            acc + cur.leaves,

          0
        );

      // ========================
      // 🎨 EMBED
      // ========================
      const embed =
        new EmbedBuilder()

          .setColor(
            0x5865F2
          )

          .setTitle(
            '🏆 Invite Leaderboard'
          )

          .setDescription(

            lines.join('\n\n')
          )

          .addFields(

            {

              name:
                '👑 Current Leader',

              value:

                top

                  ? `<@${top.userId}> • \`${top.total}\` invites`

                  : 'Unknown',

              inline: true
            },

            {

              name:
                '📊 Total Invites',

              value:
                `\`${totalInvites}\``,

              inline: true
            },

            {

              name:
                '👥 Ranked Users',

              value:
                `\`${processed.length}\``,

              inline: true
            },

            {

              name:
                '⚠️ Fake Invites',

              value:
                `\`${totalFake}\``,

              inline: true
            },

            {

              name:
                '📤 Leaves',

              value:
                `\`${totalLeaves}\``,

              inline: true
            }
          )

          .setThumbnail(

            interaction.guild.iconURL({

              dynamic: true
            })
          )

          .setFooter({

            text:
              `${interaction.guild.name} • Invite Tracking`
          })

          .setTimestamp();

      // ========================
      // 🌟 SPECIAL LEADER
      // ========================
      if (

        top?.total >= 100
      ) {

        embed.setDescription(

          '🌟 **Legendary inviters detected**\n\n' +

          lines.join('\n\n')
        );
      }

      // ========================
      // ✅ RESPONSE
      // ========================
      await interaction.editReply({

        embeds: [embed]
      });

    } catch (err) {

      console.error(
        'InviteTop Error:',
        err
      );

      return interaction.editReply({

        content:
          '❌ Failed to fetch leaderboard.'
      });
    }
  }
};