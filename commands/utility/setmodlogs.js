const {
  PermissionsBitField,
  ChannelType,
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

const { run } = require('../../database');

// ========================
// 🧠 FORMAT PERMISSIONS
// ========================
function formatPerm(perm) {

  return perm

    .replace(/([A-Z])/g, ' $1')

    .trim();
}

module.exports = {

  cooldown: 3000,

  data:
    new SlashCommandBuilder()

      .setName('setmodlogs')

      .setDescription(
        'Set the moderation logs channel'
      )

      .addChannelOption(option =>

        option

          .setName('channel')

          .setDescription(
            'Channel to send moderation logs to'
          )

          .addChannelTypes(

            ChannelType.GuildText,

            ChannelType.GuildAnnouncement
          )

          .setRequired(true)
      ),

  async execute(interaction) {

    try {

      // ========================
      // 🔐 PERMISSION CHECK
      // ========================
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

      // ========================
      // 📥 CHANNEL
      // ========================
      const channel =
        interaction.options.getChannel(
          'channel',
          true
        );

      // ========================
      // 🚫 VALIDATION
      // ========================
      if (
        !channel ||
        !channel.isTextBased()
      ) {

        return interaction.editReply({

          content:
            '❌ Please select a valid text channel.'
        });
      }

      if (
        channel.guildId !==
        interaction.guild.id
      ) {

        return interaction.editReply({

          content:
            '❌ That channel is not in this server.'
        });
      }

      // ========================
      // 🤖 BOT PERMISSIONS
      // ========================
      const perms =
        channel.permissionsFor(
          interaction.guild.members.me
        );

      const requiredPerms = [

        PermissionsBitField.Flags.ViewChannel,

        PermissionsBitField.Flags.SendMessages,

        PermissionsBitField.Flags.EmbedLinks,

        PermissionsBitField.Flags.ReadMessageHistory
      ];

      const missing =
        requiredPerms.filter(

          perm =>
            !perms?.has(perm)
        );

      if (missing.length) {

        return interaction.editReply({

          content:

            '❌ Missing permissions in that channel:\n\n' +

            missing

              .map(

                perm =>

                  `• ${formatPerm(String(perm))}`
              )

              .join('\n')
        });
      }

      // ========================
      // 💾 SAVE
      // ========================
      await run(

        `INSERT INTO guild_settings
        (
          guildId,
          modlogChannelId,
          censorEnabled
        )

        VALUES (?, ?, 1)

        ON CONFLICT(guildId)

        DO UPDATE SET

          modlogChannelId =
          excluded.modlogChannelId,

          censorEnabled = 1`,

        [

          interaction.guild.id,

          channel.id
        ]
      );

      // ========================
      // 🧪 TEST MESSAGE
      // ========================
      try {

        const testEmbed =
          new EmbedBuilder()

            .setColor(0x5865F2)

            .setTitle(
              '📜 Moderation Logs Enabled'
            )

            .setDescription(

              'This channel is now configured ' +

              'to receive moderation logs.'
            )

            .addFields(

              {

                name:
                  'Configured By',

                value:
                  `${interaction.user}`,

                inline: true
              },

              {

                name:
                  'Server',

                value:
                  interaction.guild.name,

                inline: true
              }
            )

            .setFooter({

              text:
                'Logging system active'
            })

            .setTimestamp();

        await channel.send({

          embeds: [testEmbed]
        });

      } catch (err) {

        console.error(
          'Modlog test message failed:',
          err
        );
      }

      // ========================
      // 🎨 RESPONSE
      // ========================
      const embed =
        new EmbedBuilder()

          .setColor(0x57F287)

          .setTitle(
            '📜 Moderation Logs Configured'
          )

          .setDescription(

            `Moderation logs will now be sent to ${channel}`
          )

          .addFields(

            {

              name:
                '📺 Channel',

              value:
                `${channel}`,

              inline: true
            },

            {

              name:
                '🆔 Channel ID',

              value:
                `\`${channel.id}\``,

              inline: true
            },

            {

              name:
                '✅ Status',

              value:
                'Logging Active',

              inline: true
            }
          )

          .setFooter({

            text:
              `Configured by ${interaction.user.tag}`
          })

          .setTimestamp();

      // ========================
      // ✅ RESPONSE
      // ========================
      return interaction.editReply({

        embeds: [embed]
      });

    } catch (err) {

      console.error(
        'SetModLogs Error:',
        err
      );

      if (

        interaction.deferred ||

        interaction.replied
      ) {

        return interaction.editReply({

          content:
            '❌ Failed to set mod logs channel.'
        });
      }

      return interaction.reply({

        content:
          '❌ Failed to set mod logs channel.',

        flags: 64
      });
    }
  }
};
