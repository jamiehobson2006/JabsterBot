const {
  PermissionsBitField,
  ChannelType,
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

const {
  run
} = require('../../database');

module.exports = {

  cooldown: 5000,

  data: new SlashCommandBuilder()

    .setName('setinvitechannel')

    .setDescription(
      'Set the invite tracking log channel'
    )

    .addChannelOption(option =>

      option

        .setName('channel')

        .setDescription(
          'Channel for invite logs'
        )

        .addChannelTypes(
          ChannelType.GuildText
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
            '❌ You need **Manage Server** permission.'
        });
      }

      // ==========================================
      // 📺 CHANNEL
      // ==========================================
      const channel =
        interaction.options.getChannel(
          'channel',
          true
        );

      // ==========================================
      // 🤖 BOT PERMISSIONS
      // ==========================================
      const perms =
        channel.permissionsFor(
          interaction.guild.members.me
        );

      if (

        !perms?.has([

          PermissionsBitField.Flags.ViewChannel,

          PermissionsBitField.Flags.SendMessages,

          PermissionsBitField.Flags.EmbedLinks,

          PermissionsBitField.Flags.ReadMessageHistory
        ])
      ) {

        return interaction.editReply({

          content:

            '❌ I am missing required permissions in that channel.'
        });
      }

      // ==========================================
      // 💾 SAVE
      // ==========================================
      run(

        `INSERT INTO guild_settings (

          guildId,
          inviteChannelId

        )

        VALUES (?, ?)

        ON CONFLICT(guildId)

        DO UPDATE SET

        inviteChannelId =
        excluded.inviteChannelId`,

        [

          interaction.guild.id,

          channel.id
        ]
      );

      // ==========================================
      // 🎨 SUCCESS EMBED
      // ==========================================
      const embed =
        new EmbedBuilder()

          .setColor(0x57F287)

          .setTitle(
            '📨 Invite Logs Configured'
          )

          .setDescription(

            `Invite tracking logs will now be sent to ${channel}`
          )

          .addFields(

            {
              name: 'Enabled Features',

              value:

                '• Invite join tracking\n' +
                '• Invite leave tracking\n' +
                '• Fake invite detection\n' +
                '• Alt detection\n' +
                '• Invite analytics\n' +
                '• Invite leaderboards',

              inline: false
            },

            {
              name: 'Configured By',

              value:
                `${interaction.user}`,

              inline: true
            },

            {
              name: 'Channel',

              value:
                `${channel}`,

              inline: true
            }
          )

          .setFooter({

            text:
              `Guild ID: ${interaction.guild.id}`
          })

          .setTimestamp();

      await interaction.editReply({

        embeds: [embed]
      });

      // ==========================================
      // 🧪 TEST MESSAGE
      // ==========================================
      try {

        await channel.send({

          embeds: [

            new EmbedBuilder()

              .setColor(0x5865F2)

              .setTitle(
                '📨 Invite Tracking Enabled'
              )

              .setDescription(

                'This channel will now receive:\n\n' +

                '• Member joins\n' +
                '• Invite tracking\n' +
                '• Fake invite detection\n' +
                '• Alt/fresh account alerts\n' +
                '• Invite leave tracking\n' +
                '• Invite statistics\n' +
                '• Invite leaderboard updates'
              )

              .setFooter({

                text:
                  `Configured by ${interaction.user.tag}`
              })

              .setTimestamp()
          ]
        });

      } catch (messageError) {

        console.warn(
          'Failed to send invite setup message:',
          messageError
        );
      }

    } catch (err) {

      console.error(
        'SetInviteChannel Error:',
        err
      );

      return interaction.editReply({

        content:
          '❌ Failed to set invite channel.'
      });
    }
  }
};