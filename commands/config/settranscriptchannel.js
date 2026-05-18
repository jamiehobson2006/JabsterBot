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
      // 🛡 BOT PERMISSIONS
      // ==========================================
      const perms =
        channel.permissionsFor(
          interaction.guild.members.me
        );

      if (

        !perms.has([

          PermissionsBitField.Flags.ViewChannel,

          PermissionsBitField.Flags.SendMessages,

          PermissionsBitField.Flags.AttachFiles,

          PermissionsBitField.Flags.EmbedLinks
        ])
      ) {

        return interaction.editReply({

          content:

            '❌ I am missing permissions in that channel.'
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
      // 🎨 EMBED
      // ==========================================
      const embed =
        new EmbedBuilder()

          .setColor(0x57F287)

          .setTitle(
            '📜 Transcript Channel Set'
          )

          .setDescription(

            `Ticket transcripts will now be sent to ${channel}`
          )

          .addFields({

            name: 'Channel ID',

            value:
              `\`${channel.id}\``,

            inline: true
          })

          .setFooter({

            text:
              `Configured by ${interaction.user.tag}`
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