const {

  SlashCommandBuilder,

  PermissionsBitField,

  ChannelType,

  EmbedBuilder

} = require('discord.js');

const {
  run
} = require('../../database');

module.exports = {

  cooldown: 5000,

  data:
    new SlashCommandBuilder()

      .setName(
        'settranscriptchannel'
      )

      .setDescription(
        'Set the transcript log channel'
      )

      .addChannelOption(option =>

        option

          .setName('channel')

          .setDescription(
            'Channel for ticket transcripts'
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
          PermissionsBitField.Flags.Administrator
        )
      ) {

        return interaction.editReply({

          content:
            '❌ You need Administrator permission.'
        });
      }

      // ==========================================
      // 📥 CHANNEL
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

          PermissionsBitField.Flags.AttachFiles,

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

        `INSERT INTO guild_settings
         (
           guildId,
           transcriptChannelId
         )

         VALUES (?, ?)

         ON CONFLICT(guildId)

         DO UPDATE SET

           transcriptChannelId =
           excluded.transcriptChannelId`,

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
            '📜 Transcript Channel Configured'
          )

          .setDescription(

            `Ticket transcripts will now be sent to ${channel}`
          )

          .addFields(

            {

              name: 'Enabled Features',

              value:

                '• HTML transcripts\n' +
                '• Ticket close logs\n' +
                '• Staff close tracking\n' +
                '• Ticket analytics\n' +
                '• Transcript storage',

              inline: false
            },

            {

              name: 'Important',

              value:
                'Ensure this channel is only visible to staff members.',

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
                '📜 Transcript Logging Enabled'
              )

              .setDescription(

                'This channel will now receive:\n\n' +

                '• Ticket transcripts\n' +
                '• Ticket close logs\n' +
                '• Staff close tracking\n' +
                '• Ticket analytics\n' +
                '• Transcript files'
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
          'Failed to send transcript setup message:',
          messageError
        );
      }

    } catch (err) {

      console.error(
        'SetTranscriptChannel Error:',
        err
      );

      return interaction.editReply({

        content:
          '❌ Failed to set transcript channel.'
      });
    }
  }
};