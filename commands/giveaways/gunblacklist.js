const {
  SlashCommandBuilder,
  PermissionsBitField,
  EmbedBuilder
} = require('discord.js');

const {
  get,
  run
} = require('../../database');

module.exports = {

  cooldown: 5000,

  data:
    new SlashCommandBuilder()

      .setName('gunblacklist')

      .setDescription(
        'Remove a user from the giveaway blacklist'
      )

      .addUserOption(option =>

        option

          .setName('user')

          .setDescription(
            'User to unblacklist'
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
      // 👤 USER
      // ==========================================
      const user =
        interaction.options.getUser(

          'user',

          true
        );

      // ==========================================
      // 🔍 CHECK BLACKLIST
      // ==========================================
      const existing =
        get(

          `SELECT *
           FROM giveaway_blacklist

           WHERE guildId = ?
           AND userId = ?`,

          [

            interaction.guild.id,

            user.id
          ]
        );

      if (!existing) {

        return interaction.editReply({

          content:
            '❌ User is not blacklisted.'
        });
      }

      // ==========================================
      // 🗑 REMOVE BLACKLIST
      // ==========================================
      run(

        `DELETE FROM giveaway_blacklist

         WHERE guildId = ?
         AND userId = ?`,

        [

          interaction.guild.id,

          user.id
        ]
      );

      const removedAt =
        Math.floor(Date.now() / 1000);

      // ==========================================
      // 📩 DM USER
      // ==========================================
      user.send({

        embeds: [

          new EmbedBuilder()

            .setColor(0x57F287)

            .setTitle(
              '✅ Giveaway Blacklist Removed'
            )

            .setDescription(

              `You have been removed from the giveaway blacklist in **${interaction.guild.name}**.`
            )

            .addFields(

              {

                name: '🛡 Moderator',

                value:
                  interaction.user.tag,

                inline: true
              },

              {

                name: '📅 Removed',

                value:
                  `<t:${removedAt}:F>`,

                inline: true
              }
            )

            .setFooter({

              text:
                'You may now enter giveaways again.'
            })

            .setTimestamp()
        ]

      }).catch(() => {});

      // ==========================================
      // 🎨 EMBED
      // ==========================================
      const embed =
        new EmbedBuilder()

          .setColor(0x57F287)

          .setTitle(
            '✅ Giveaway Unblacklist'
          )

          .setDescription(

            `${user} has been removed from the giveaway blacklist.`
          )

          .addFields(

            {

              name: '👤 User',

              value:

                `${user.tag}\n` +

                `\`${user.id}\``,

              inline: true
            },

            {

              name: '🛡 Moderator',

              value:

                `${interaction.user.tag}\n` +

                `\`${interaction.user.id}\``,

              inline: true
            },

            {

              name: '📅 Originally Blacklisted',

              value:

                existing.addedAt

                  ? `<t:${existing.addedAt}:F>`

                  : 'Unknown',

              inline: false
            },

            {

              name: '📝 Original Reason',

              value:
                existing.reason ||

                'No reason provided',

              inline: false
            },

            {

              name: '📅 Removed',

              value:
                `<t:${removedAt}:F>`,

              inline: false
            }
          )

          .setFooter({

            text:
              'Giveaway blacklist updated'
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
        'Giveaway Unblacklist Error:',
        err
      );

      return interaction.editReply({

        content:
          '❌ Failed to unblacklist user.'
      });
    }
  }
};