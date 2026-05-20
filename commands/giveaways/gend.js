const {

  SlashCommandBuilder,

  PermissionsBitField,

  EmbedBuilder

} = require('discord.js');

const {
  get,
  all
} = require('../../database');

const {
  endGiveaway
} = require('../../utils/giveaways/endGiveaway');

module.exports = {

  cooldown: 5000,

  data:
    new SlashCommandBuilder()

      .setName('gend')

      .setDescription(
        'Force end a giveaway'
      )

      .addStringOption(option =>

        option

          .setName('message_id')

          .setDescription(
            'Giveaway message ID'
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
            '❌ You need Manage Server permission.'
        });
      }

      // ==========================================
      // 📨 MESSAGE ID
      // ==========================================
      const messageId =
        interaction.options.getString(

          'message_id',

          true
        );

      // ==========================================
      // 📊 GIVEAWAY
      // ==========================================
      const giveaway =
        get(

          `SELECT *
           FROM giveaways

           WHERE messageId = ?
           AND guildId = ?`,

          [

            messageId,

            interaction.guild.id
          ]
        );

      if (!giveaway) {

        return interaction.editReply({

          content:
            '❌ Giveaway not found in this server.'
        });
      }

      // ==========================================
      // ⛔ ALREADY ENDED
      // ==========================================
      if (giveaway.ended) {

        return interaction.editReply({

          content:
            '❌ Giveaway already ended.'
        });
      }

      // ==========================================
      // 📈 ENTRY COUNT
      // ==========================================
      const entries =
        all(

          `SELECT *
           FROM giveaway_entries

           WHERE messageId = ?`,

          [messageId]
        );

      // ==========================================
      // 🎉 END GIVEAWAY
      // ==========================================
      await endGiveaway(

        interaction.client,

        giveaway
      );

      // ==========================================
      // 🎨 EMBED
      // ==========================================
      const embed =
        new EmbedBuilder()

          .setColor(0xED4245)

          .setTitle(
            '⏹ Giveaway Ended'
          )

          .setDescription(

            'The giveaway has been force ended successfully.'
          )

          .addFields(

            {

              name: '🎁 Prize',

              value:
                giveaway.prize,

              inline: false
            },

            {

              name: '👥 Entries',

              value:
                `${entries.length}`,

              inline: true
            },

            {

              name: '🏆 Winners',

              value:
                `${giveaway.winnerCount}`,

              inline: true
            },

            {

              name: '👤 Ended By',

              value:
                `${interaction.user}`,

              inline: true
            },

            {

              name: '🆔 Message ID',

              value:
                `\`${messageId}\``,

              inline: false
            }
          )

          .setFooter({

            text:
              'Giveaway force ended'
          })

          .setTimestamp();

      // ==========================================
      // 📤 RESPONSE
      // ==========================================
      return interaction.editReply({

        embeds: [embed]
      });

    } catch (err) {

      console.error(
        'Giveaway End Error:',
        err
      );

      return interaction.editReply({

        content:
          '❌ Failed to end giveaway.'
      });
    }
  }
};