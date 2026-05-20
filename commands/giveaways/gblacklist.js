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

      .setName('gblacklist')

      .setDescription(
        'Blacklist a user from giveaways'
      )

      .addUserOption(option =>

        option

          .setName('user')

          .setDescription(
            'User to blacklist'
          )

          .setRequired(true)
      )

      .addStringOption(option =>

        option

          .setName('reason')

          .setDescription(
            'Reason for blacklist'
          )

          .setRequired(false)
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
      // 👤 USER
      // ==========================================
      const user =
        interaction.options.getUser(

          'user',

          true
        );

      const reason =
        interaction.options.getString(

          'reason'
        ) ||

        'No reason provided';

      // ==========================================
      // 🚫 SELF CHECK
      // ==========================================
      if (user.id === interaction.user.id) {

        return interaction.editReply({

          content:
            '❌ You cannot blacklist yourself.'
        });
      }

      // ==========================================
      // 🤖 BOT CHECK
      // ==========================================
      if (user.bot) {

        return interaction.editReply({

          content:
            '❌ Bots cannot enter giveaways.'
        });
      }

      // ==========================================
      // 👑 STAFF CHECK
      // ==========================================
      const member =
        await interaction.guild.members

          .fetch(user.id)

          .catch(() => null);

      if (

        member?.permissions.has(

          PermissionsBitField.Flags.ManageGuild
        )
      ) {

        return interaction.editReply({

          content:

            '❌ You cannot blacklist server staff.'
        });
      }

      // ==========================================
      // 🚫 ALREADY BLACKLISTED
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

      if (existing) {

        return interaction.editReply({

          content:
            '❌ User is already blacklisted.'
        });
      }

      // ==========================================
      // 💾 SAVE
      // ==========================================
      run(

        `INSERT INTO giveaway_blacklist (

          guildId,
          userId,
          reason,
          addedBy,
          addedAt

        )

        VALUES (?, ?, ?, ?, ?)`,

        [

          interaction.guild.id,

          user.id,

          reason,

          interaction.user.id,

          Date.now()
        ]
      );

      // ==========================================
      // 📩 DM USER
      // ==========================================
      user.send({

        embeds: [

          new EmbedBuilder()

            .setColor(0xED4245)

            .setTitle(
              '🚫 Giveaway Blacklisted'
            )

            .setDescription(

              `You have been blacklisted from giveaways in **${interaction.guild.name}**.`
            )

            .addFields({

              name: 'Reason',

              value:
                reason
            })

            .setTimestamp()
        ]

      }).catch(() => {});

      // ==========================================
      // 🎨 EMBED
      // ==========================================
      const embed =
        new EmbedBuilder()

          .setColor(0xED4245)

          .setTitle(
            '🚫 Giveaway Blacklist'
          )

          .setDescription(

            `${user} has been blacklisted from giveaways.`
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
                `${interaction.user.tag}`,

              inline: true
            },

            {

              name: '📝 Reason',

              value:
                reason
            }
          )

          .setFooter({

            text:
              `Blacklist issued`
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
        'Giveaway Blacklist Error:',
        err
      );

      return interaction.editReply({

        content:
          '❌ Failed to blacklist user.'
      });
    }
  }
};