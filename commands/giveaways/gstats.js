const {

  SlashCommandBuilder,

  PermissionsBitField,

  EmbedBuilder

} = require('discord.js');

const {

  get,

  all

} = require('../../database');

module.exports = {

  cooldown: 5000,

  data:
    new SlashCommandBuilder()

      .setName('gstats')

      .setDescription(
        'View giveaway statistics'
      ),

  async execute(interaction) {

    try {

      // ==========================================
      // 🔐 PERMISSIONS
      // ==========================================
      if (

        !interaction.memberPermissions.has(

          PermissionsBitField.Flags.ManageGuild
        )
      ) {

        return interaction.editReply({

          content:
            '❌ You need Manage Server permission.'
        });
      }

      // ==========================================
      // 📊 TOTAL GIVEAWAYS
      // ==========================================
      const totalGiveaways =
        get(

          `SELECT COUNT(*) as count
           FROM giveaways

           WHERE guildId = ?`,

          [

            interaction.guild.id
          ]
        )?.count || 0;

      // ==========================================
      // 🟢 ACTIVE GIVEAWAYS
      // ==========================================
      const activeGiveaways =
        get(

          `SELECT COUNT(*) as count
           FROM giveaways

           WHERE guildId = ?
           AND ended = 0`,

          [

            interaction.guild.id
          ]
        )?.count || 0;

      // ==========================================
      // 🔴 ENDED GIVEAWAYS
      // ==========================================
      const endedGiveaways =
        get(

          `SELECT COUNT(*) as count
           FROM giveaways

           WHERE guildId = ?
           AND ended = 1`,

          [

            interaction.guild.id
          ]
        )?.count || 0;

      // ==========================================
      // 👥 TOTAL ENTRIES
      // ==========================================
      const totalEntries =
        get(

          `SELECT COUNT(*) as count
           FROM giveaway_entries

           WHERE guildId = ?`,

          [

            interaction.guild.id
          ]
        )?.count || 0;

      // ==========================================
      // 🏆 TOTAL WINNERS
      // ==========================================
      const totalWinners =
        get(

          `SELECT COUNT(*) as count
           FROM giveaway_winners

           WHERE guildId = ?`,

          [

            interaction.guild.id
          ]
        )?.count || 0;

      // ==========================================
      // 🔄 REROLLED WINNERS
      // ==========================================
      const rerolls =
        get(

          `SELECT COUNT(*) as count
           FROM giveaway_winners

           WHERE guildId = ?
           AND rerolled = 1`,

          [

            interaction.guild.id
          ]
        )?.count || 0;

      // ==========================================
      // 👑 TOP HOSTS
      // ==========================================
      const topHosts =
        all(

          `SELECT

            hostId,
            COUNT(*) as total

           FROM giveaways

           WHERE guildId = ?

           GROUP BY hostId

           ORDER BY total DESC

           LIMIT 5`,

          [

            interaction.guild.id
          ]
        );

      // ==========================================
      // 🧠 HOST FORMAT
      // ==========================================
      const hostText =

        topHosts.length

          ? topHosts.map((host, index) =>

              `\`${index + 1}.\` <@${host.hostId}> — ${host.total}`
            ).join('\n')

          : 'No data';

      // ==========================================
      // 🔥 BIGGEST GIVEAWAY
      // ==========================================
      const biggestGiveaway =
        get(

          `SELECT

            giveaways.prize,
            giveaways.messageId,

            COUNT(giveaway_entries.userId)
            as entryCount

           FROM giveaways

           LEFT JOIN giveaway_entries

           ON giveaways.messageId =
           giveaway_entries.messageId

           WHERE giveaways.guildId = ?

           GROUP BY giveaways.messageId

           ORDER BY entryCount DESC

           LIMIT 1`,

          [

            interaction.guild.id
          ]
        );

      // ==========================================
      // 📈 AVERAGE ENTRIES
      // ==========================================
      const averageEntries =

        totalGiveaways

          ? Math.floor(

              totalEntries /

              totalGiveaways
            )

          : 0;

      // ==========================================
      // 🎨 EMBED
      // ==========================================
      const embed =
        new EmbedBuilder()

          .setColor(0x5865F2)

          .setTitle(
            '🎉 Giveaway Statistics'
          )

          .addFields(

            {

              name: '📊 Total Giveaways',

              value:
                `\`${totalGiveaways}\``,

              inline: true
            },

            {

              name: '🟢 Active',

              value:
                `\`${activeGiveaways}\``,

              inline: true
            },

            {

              name: '🔴 Ended',

              value:
                `\`${endedGiveaways}\``,

              inline: true
            },

            {

              name: '👥 Total Entries',

              value:
                `\`${totalEntries}\``,

              inline: true
            },

            {

              name: '🏆 Total Winners',

              value:
                `\`${totalWinners}\``,

              inline: true
            },

            {

              name: '🔄 Rerolls',

              value:
                `\`${rerolls}\``,

              inline: true
            },

            {

              name: '📈 Average Entries',

              value:
                `\`${averageEntries}\``,

              inline: true
            },

            {

              name: '👑 Top Giveaway Hosts',

              value:
                hostText,

              inline: false
            },

            {

              name: '🔥 Biggest Giveaway',

              value:

                biggestGiveaway

                  ? `🎁 **${biggestGiveaway.prize}**\n` +

                    `👥 ${biggestGiveaway.entryCount} entries`

                  : 'No giveaways yet',

              inline: false
            }
          )

          .setFooter({

            text:
              `${interaction.guild.name} Giveaway Analytics`
          })

          .setTimestamp();

      // ==========================================
      // 📤 RESPONSE
      // ==========================================
      await interaction.editReply({

        embeds: [embed]
      });

    } catch (err) {

      console.error(
        'Giveaway Stats Error:',
        err
      );

      return interaction.editReply({

        content:
          '❌ Failed to fetch giveaway stats.'
      });
    }
  }
};