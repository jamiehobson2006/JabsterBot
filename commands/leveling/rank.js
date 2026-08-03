const {
  SlashCommandBuilder,
  EmbedBuilder
} = require('discord.js');

const {
  get,
  all
} = require('../../database');

const {
  getProgressXP,
  createProgressBar
} = require('../../utils/leveling');

module.exports = {

  cooldown: 3000,

  data: new SlashCommandBuilder()

    .setName('rank')

    .setDescription(
      'View your rank'
    )

    .addUserOption(option =>
      option

        .setName('user')

        .setDescription(
          'User to view'
        )

        .setRequired(false)
    ),

  async execute(interaction) {

    const target =

      interaction.options.getUser(
        'user'
      ) ||

      interaction.user;

    const data =
      get(

        `SELECT *
         FROM leveling_users
         WHERE guildId = ?
         AND userId = ?`,

        [

          interaction.guild.id,
          target.id
        ]
      );

    if (!data) {

      return interaction.editReply({

        content:
          '❌ No leveling data found.'
      });
    }

    const progress =
      getProgressXP(
        data.xp
      );

    const leaderboard =
      all(

        `SELECT userId, xp
         FROM leveling_users
         WHERE guildId = ?
         ORDER BY xp DESC`,

        [

          interaction.guild.id
        ]
      );

    const rank =

      leaderboard.findIndex(

        user =>
          user.userId ===
          target.id

      ) + 1;

    const progressBar =
createProgressBar(
  progress.currentXP,
  progress.requiredXP,
  24
);

    const percent =
      Math.floor(

        (
          progress.currentXP /
          progress.requiredXP
        ) * 100
      );

    const embed =
      new EmbedBuilder()

        .setColor(
          0x5865F2
        )

        .setAuthor({

          name:
            `${target.username}'s Rank`,

          iconURL:
            target.displayAvatarURL()
        })

        .setThumbnail(

          target.displayAvatarURL({

            size: 256
          })
        )

        .setDescription(

[
  `🏆 **Rank #${rank}** • 📈 **Level ${data.level}**`,
  '',
  `${progressBar}`,
  `**${progress.currentXP} / ${progress.requiredXP} XP** (${percent}%)`,
  '',
  `💬 **${data.messages.toLocaleString()} Messages**`,
  `✨ **${data.xp.toLocaleString()} Total XP**`
].join('\n')
        )

        .setFooter({

          text:
            'Jabster Studios'
        })

        .setTimestamp();

    await interaction.editReply({

      embeds: [embed]
    });
  }
};
