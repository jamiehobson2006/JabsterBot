const {

  SlashCommandBuilder,

  PermissionsBitField,

  EmbedBuilder

} = require('discord.js');

const {

  get,

  all,

  run

} = require('../../database');

module.exports = {

  cooldown: 5000,

  data:
    new SlashCommandBuilder()

      .setName('gdelete')

      .setDescription(
        'Delete a giveaway completely'
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
      // 📈 ENTRY DATA
      // ==========================================
      const entries =
        all(

          `SELECT *
           FROM giveaway_entries

           WHERE messageId = ?`,

          [messageId]
        );

      const winners =
        all(

          `SELECT *
           FROM giveaway_winners

           WHERE messageId = ?`,

          [messageId]
        );

      // ==========================================
      // 📺 FETCH CHANNEL
      // ==========================================
      const channel =
        await interaction.client.channels

          .fetch(
            giveaway.channelId
          )

          .catch(() => null);

      // ==========================================
      // 💬 DELETE MESSAGE
      // ==========================================
      if (channel) {

        const message =
          await channel.messages

            .fetch(
              giveaway.messageId
            )

            .catch(() => null);

        if (message) {

          await message.delete()

            .catch(() => {});
        }
      }

      // ==========================================
      // 🗑 DELETE DATABASE DATA
      // ==========================================
      run(

        `DELETE FROM giveaways
         WHERE messageId = ?`,

        [messageId]
      );

      run(

        `DELETE FROM giveaway_entries
         WHERE messageId = ?`,

        [messageId]
      );

      run(

        `DELETE FROM giveaway_winners
         WHERE messageId = ?`,

        [messageId]
      );

      // ==========================================
      // 🎨 EMBED
      // ==========================================
      const embed =
        new EmbedBuilder()

          .setColor(0xED4245)

          .setTitle(
            '🗑 Giveaway Deleted'
          )

          .setDescription(

            'The giveaway and all associated data have been permanently removed.'
          )

          .addFields(

            {

              name: '🎁 Prize',

              value:
                giveaway.prize,

              inline: false
            },

            {

              name: '🆔 Message ID',

              value:
                `\`${giveaway.messageId}\``,

              inline: true
            },

            {

              name: '👤 Deleted By',

              value:
                `${interaction.user}`,

              inline: true
            },

            {

              name: '📊 Removed Data',

              value:

                `• ${entries.length} entries\n` +

                `• ${winners.length} winner record(s)`,

              inline: false
            },

            {

              name: '📌 Giveaway Status',

              value:

                giveaway.ended

                  ? 'Ended'

                  : 'Active',

              inline: true
            }
          )

          .setFooter({

            text:
              'Giveaway permanently deleted'
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
        'Giveaway Delete Error:',
        err
      );

      return interaction.editReply({

        content:
          '❌ Failed to delete giveaway.'
      });
    }
  }
};