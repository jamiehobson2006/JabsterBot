const {

  SlashCommandBuilder,

  PermissionsBitField,

  EmbedBuilder

} = require('discord.js');

const {

  all,

  get

} = require('../../database');

module.exports = {

  cooldown: 5000,

  data:
    new SlashCommandBuilder()

      .setName('glist')

      .setDescription(
        'View active giveaways'
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
      // 📊 FETCH GIVEAWAYS
      // ==========================================
      const giveaways =
        all(

          `SELECT *
           FROM giveaways

           WHERE guildId = ?
           AND ended = 0

           ORDER BY endsAt ASC

           LIMIT 15`,

          [

            interaction.guild.id
          ]
        );

      // ==========================================
      // ❌ NONE FOUND
      // ==========================================
      if (!giveaways.length) {

        return interaction.editReply({

          content:
            '❌ No active giveaways found.'
        });
      }

      // ==========================================
      // 🧠 BUILD LIST
      // ==========================================
      const lines = [];

      for (const giveaway of giveaways) {

        // ========================================
        // 👥 ENTRY COUNT
        // ========================================
        const entryData =
          get(

            `SELECT COUNT(*) as count
             FROM giveaway_entries

             WHERE messageId = ?`,

            [

              giveaway.messageId
            ]
          );

        const entryCount =
          entryData?.count || 0;

        // ========================================
        // 📌 STATUS
        // ========================================
        const endsSoon =

          giveaway.endsAt - Date.now()

          < 3600000;

        // ========================================
        // 🧠 LINE
        // ========================================
        lines.push(

          `🎁 **${giveaway.prize}**\n` +

          `┗ 🆔 \`${giveaway.messageId}\`\n` +

          `┗ 👤 Host: <@${giveaway.hostId}>\n` +

          `┗ 👥 Entries: **${entryCount}**\n` +

          `┗ 🏆 Winners: **${giveaway.winners}**\n` +

          `┗ 📺 <#${giveaway.channelId}>\n` +

          `┗ ${

            endsSoon

              ? '⚠️ Ending Soon'

              : '⏰ Ends'

          }: <t:${Math.floor(

            giveaway.endsAt / 1000

          )}:R>`
        );
      }

      // ==========================================
      // 📈 TOTAL ENTRIES
      // ==========================================
      const totalEntries =
        giveaways.reduce(

          (acc, giveaway) => {

            const count =
              get(

                `SELECT COUNT(*) as count
                 FROM giveaway_entries

                 WHERE messageId = ?`,

                [

                  giveaway.messageId
                ]
              );

            return acc + (count?.count || 0);

          },

          0
        );

      // ==========================================
      // 🎨 EMBED
      // ==========================================
      const embed =
        new EmbedBuilder()

          .setColor(0x5865F2)

          .setTitle(
            '🎉 Active Giveaways'
          )

          .setDescription(

            lines.join('\n\n')
          )

          .addFields({

            name: '📊 Giveaway Statistics',

            value:

              `• ${giveaways.length} active giveaway(s)\n` +

              `• ${totalEntries} total entries\n` +

              `• Sorted by ending time`
          })

          .setFooter({

            text:
              `${interaction.guild.name} Giveaway System`
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
        'Giveaway List Error:',
        err
      );

      return interaction.editReply({

        content:
          '❌ Failed to fetch giveaways.'
      });
    }
  }
};