const {

  EmbedBuilder,

  SlashCommandBuilder

} = require('discord.js');

const {

  get,

  all

} = require('../../database');

// ========================
// 🏆 RANK CALCULATOR
// ========================
function getRank(score) {

  if (score >= 100) {

    return {
      name: '🌟 Legendary Inviter',
      color: 0xF1C40F
    };
  }

  if (score >= 50) {

    return {
      name: '🔥 Elite Inviter',
      color: 0xE67E22
    };
  }

  if (score >= 20) {

    return {
      name: '🚀 Active Inviter',
      color: 0x57F287
    };
  }

  if (score >= 5) {

    return {
      name: '📈 Growing Inviter',
      color: 0x5865F2
    };
  }

  return {
    name: '🌱 Beginner',
    color: 0x95A5A6
  };
}

module.exports = {

  cooldown: 5000,

  data:
    new SlashCommandBuilder()

      .setName('invites')

      .setDescription(
        'View invite statistics'
      )

      .addUserOption(option =>

        option

          .setName('user')

          .setDescription(
            'User to check'
          )
      ),

  async execute(interaction) {

    try {

      // ========================
      // 👤 TARGET
      // ========================
      const user =
        interaction.options.getUser(
          'user'
        ) ||

        interaction.user;

      // ========================
      // 📊 FETCH STATS
      // ========================
      const stats =
        get(

          `SELECT *

           FROM invite_stats

           WHERE guildId = ?
           AND userId = ?`,

          [

            interaction.guild.id,

            user.id
          ]
        );

      // ========================
      // 📊 VALUES
      // ========================
      const invites =
        stats?.invites || 0;

      const fake =
        stats?.fake || 0;

      const leaves =
        stats?.leaves || 0;

      const bonus =
        stats?.bonus || 0;

      // ========================
      // 🧠 REAL INVITES
      // ========================
      const regular =
        Math.max(

          invites -
          fake -
          leaves,

          0
        );

      const total =
        regular + bonus;

      // ========================
      // 🏆 SERVER RANK
      // ========================
      const leaderboard =
        all(

          `SELECT *

           FROM invite_stats

           WHERE guildId = ?`,

          [

            interaction.guild.id
          ]
        );

      const ranked =
        leaderboard

          .map(row => {

            const real =
              Math.max(

                (row.invites || 0) -
                (row.fake || 0) -
                (row.leaves || 0),

                0
              );

            return {

              userId:
                row.userId,

              total:
                real +
                (row.bonus || 0)
            };
          })

          .sort((a, b) =>
            b.total - a.total
          );

      let rank =
        ranked.findIndex(r =>

          r.userId === user.id
        ) + 1;

      if (rank <= 0) {

        rank = 'Unranked';
      }

      // ========================
      // 🎖 RANK STYLE
      // ========================
      const rankData =
        getRank(total);

      // ========================
      // 📊 INVITE RATE
      // ========================
      const fakeRate =
        invites > 0

          ? (
              (fake / invites) * 100
            ).toFixed(1)

          : '0';

      // ========================
      // 🎨 EMBED
      // ========================
      const embed =
        new EmbedBuilder()

          .setColor(
            rankData.color
          )

          .setAuthor({

            name:
              `${user.tag}'s Invite Stats`,

            iconURL:
              user.displayAvatarURL({

                dynamic: true
              })
          })

          .setThumbnail(

            user.displayAvatarURL({

              dynamic: true,

              size: 256
            })
          )

          .setDescription(
            `${rankData.name}`
          )

          .addFields(

            {

              name:
                '🏆 Final Score',

              value:
                `\`${total}\``,

              inline: true
            },

            {

              name:
                '📊 Server Rank',

              value:
                `#${rank}`,

              inline: true
            },

            {

              name:
                '📨 Total Invites',

              value:
                `\`${invites}\``,

              inline: true
            },

            {

              name:
                '✅ Regular',

              value:
                `\`${regular}\``,

              inline: true
            },

            {

              name:
                '⚠️ Fake',

              value:
                `\`${fake}\``,

              inline: true
            },

            {

              name:
                '📤 Leaves',

              value:
                `\`${leaves}\``,

              inline: true
            },

            {

              name:
                '🎁 Bonus',

              value:
                `\`${bonus}\``,

              inline: true
            },

            {

              name:
                '📉 Fake Rate',

              value:
                `${fakeRate}%`,

              inline: true
            }
          )

          .setFooter({

            text:
              'Invite Tracking System'
          })

          .setTimestamp();

      // ========================
      // 🔥 SPECIAL BADGES
      // ========================
      if (rank === 1) {

        embed.addFields({

          name:
            '👑 Status',

          value:
            'Top inviter in this server!'
        });
      }

      // ========================
      // ❌ NO INVITES
      // ========================
      if (

        invites === 0 &&

        bonus === 0
      ) {

        embed.setDescription(

          '🌱 No invite activity yet.'
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
        'Invites Command Error:',
        err
      );

      return interaction.editReply({

        content:
          '❌ Failed to fetch invite stats.'
      });
    }
  }
};