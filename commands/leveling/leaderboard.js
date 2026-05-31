const {
  SlashCommandBuilder,
  EmbedBuilder
} = require('discord.js');

const {
  all
} = require('../../database');

module.exports = {

  cooldown: 5000,

  data: new SlashCommandBuilder()

    .setName('leaderboard')

    .setDescription(
      'View the server leveling leaderboard'
    ),

  async execute(interaction) {

    const leaderboard =
      all(

        `SELECT *
         FROM leveling_users
         WHERE guildId = ?
         ORDER BY xp DESC`,

        [
          interaction.guild.id
        ]
      );

    if (
      !leaderboard ||
      leaderboard.length === 0
    ) {

      return interaction.editReply({

        content:
          '❌ No leveling data found.'
      });
    }

    const topTen =
      leaderboard.slice(0, 10);

    const userRank =
      leaderboard.findIndex(

        entry =>
          entry.userId ===
          interaction.user.id

      ) + 1;

    const top3 = [];
    const rest = [];

    for (
      let i = 0;
      i < topTen.length;
      i++
    ) {

      const entry =
        topTen[i];

      const user =
        await interaction.client.users
          .fetch(
            entry.userId
          )
          .catch(() => null);

      const username =
        user
          ? user.username
          : 'Unknown User';

      if (i === 0) {

        top3.push(

          `🥇 **${username}**\n` +
          `└ Level ${entry.level} • ${entry.xp.toLocaleString()} XP`
        );

      } else if (i === 1) {

        top3.push(

          `🥈 **${username}**\n` +
          `└ Level ${entry.level} • ${entry.xp.toLocaleString()} XP`
        );

      } else if (i === 2) {

        top3.push(

          `🥉 **${username}**\n` +
          `└ Level ${entry.level} • ${entry.xp.toLocaleString()} XP`
        );

      } else {

        rest.push(

          `**#${i + 1}** • ${username} • Lv ${entry.level} • ${entry.xp.toLocaleString()} XP`
        );
      }
    }

    const yourData =
      leaderboard[userRank - 1];

    const embed =
      new EmbedBuilder()

        .setColor(
          0x5865F2
        )

        .setTitle(
          '🏆 JabsterStudios Leaderboard'
        )

        .setDescription(

          [
            top3.join('\n\n'),

            '\n━━━━━━━━━━━━━━━━━━\n',

            rest.join('\n'),

            '\n━━━━━━━━━━━━━━━━━━\n',

            yourData
              ? `⭐ **Your Position**\n#${userRank} • Level ${yourData.level} • ${yourData.xp.toLocaleString()} XP`
              : '⭐ Your Position\nNot Ranked'
          ].join('')
        )

        .setFooter({

          text:
            'JabsterStudios Leveling'
        })

        .setTimestamp();

    await interaction.editReply({

      embeds: [embed]
    });
  }
};