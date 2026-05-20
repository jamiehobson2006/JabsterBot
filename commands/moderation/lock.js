const {

  PermissionsBitField,

  EmbedBuilder,

  SlashCommandBuilder,

  ChannelType

} = require('discord.js');

const {

  run

} = require('../../database');

const {

  sendLog,

  createLogEmbed

} = require('../../utils/logger');

module.exports = {

  cooldown: 3000,

  data:
    new SlashCommandBuilder()

      .setName('lock')

      .setDescription(
        'Lock the current channel'
      )

      .addStringOption(option =>

        option

          .setName('reason')

          .setDescription(
            'Reason for locking the channel'
          )

          .setMaxLength(200)
      ),

  async execute(interaction) {

    try {

      // ==========================================
      // 🔐 PERMISSION CHECK
      // ==========================================
      if (

        !interaction.memberPermissions.has(

          PermissionsBitField.Flags.ManageChannels
        )
      ) {

        return interaction.editReply({

          content:

            '❌ You need **Manage Channels** permission.'
        });
      }

      // ==========================================
      // 🤖 BOT PERMISSION CHECK
      // ==========================================
      if (

        !interaction.guild.members.me.permissions.has(

          PermissionsBitField.Flags.ManageChannels
        )
      ) {

        return interaction.editReply({

          content:

            '❌ I do not have Manage Channels permission.'
        });
      }

      // ==========================================
      // 📺 CHANNEL
      // ==========================================
      const channel =
        interaction.channel;

      const reason =
        interaction.options.getString(
          'reason'
        ) ||

        'No reason provided';

      const botMember =
        interaction.guild.members.me;

      // ==========================================
      // 📺 CHANNEL TYPE CHECK
      // ==========================================
      if (

        !channel ||

        ![

          ChannelType.GuildText,

          ChannelType.GuildAnnouncement

        ].includes(channel.type)
      ) {

        return interaction.editReply({

          content:

            '❌ You can only lock text channels.'
        });
      }

      // ==========================================
      // 🤖 CHANNEL PERMISSIONS
      // ==========================================
      const perms =
        channel.permissionsFor(
          botMember
        );

      if (

        !perms?.has([

          PermissionsBitField.Flags.ManageChannels,

          PermissionsBitField.Flags.SendMessages,

          PermissionsBitField.Flags.ViewChannel
        ])
      ) {

        return interaction.editReply({

          content:

            '❌ I am missing permissions in this channel.'
        });
      }

      // ==========================================
      // 👥 EVERYONE ROLE
      // ==========================================
      const everyoneRole =
        interaction.guild.roles.everyone;

      // ==========================================
      // 🔒 ALREADY LOCKED?
      // ==========================================
      const overwrite =
        channel.permissionOverwrites.cache.get(

          everyoneRole.id
        );

      const alreadyLocked =
        overwrite?.deny.has(

          PermissionsBitField.Flags.SendMessages
        );

      if (alreadyLocked) {

        return interaction.editReply({

          content:
            '⚠️ This channel is already locked.'
        });
      }

      // ==========================================
      // 🔒 LOCK CHANNEL
      // ==========================================
      await channel.permissionOverwrites.edit(

        everyoneRole,

        {

          SendMessages: false
        },

        {

          reason:

            `Locked by ${interaction.user.tag} | ${reason}`
        }
      );

      // ==========================================
      // 💾 SAVE CASE
      // ==========================================
      const result =
        run(

          `INSERT INTO cases

           (
             guildId,
             userId,
             moderatorId,
             action,
             reason,
             channelId,
             createdAt
           )

           VALUES (?, ?, ?, ?, ?, ?, ?)`,

          [

            interaction.guild.id,

            interaction.guild.id,

            interaction.user.id,

            'LOCK',

            reason,

            channel.id,

            Date.now()
          ]
        );

      const caseId =
        result?.lastInsertRowid || 'N/A';

      // ==========================================
      // 📢 PUBLIC MESSAGE
      // ==========================================
      const lockEmbed =
        new EmbedBuilder()

          .setColor(0xED4245)

          .setTitle(
            '🔒 Channel Locked'
          )

          .setDescription(

            `This channel has been locked.`
          )

          .addFields(

            {

              name: '📄 Reason',

              value:
                reason
            },

            {

              name: '🛡 Moderator',

              value:
                `${interaction.user}`,

              inline: true
            },

            {

              name: '📁 Case',

              value:
                `#${caseId}`,

              inline: true
            }
          )

          .setFooter({

            text:
              `${interaction.guild.name} Moderation`
          })

          .setTimestamp();

      const lockMessage =
        await channel.send({

          embeds: [lockEmbed]
        });

      // ==========================================
      // 🧹 AUTO DELETE
      // ==========================================
      setTimeout(() => {

        lockMessage

          .delete()

          .catch(() => {});

      }, 5000);

      // ==========================================
      // ✅ RESPONSE
      // ==========================================
      await interaction.editReply({

        embeds: [

          new EmbedBuilder()

            .setColor(0x57F287)

            .setTitle(
              '🔒 Channel Locked'
            )

            .setDescription(

              `${channel} has been locked successfully.`
            )

            .addFields(

              {

                name: '📄 Reason',

                value:
                  reason
              },

              {

                name: '📁 Case',

                value:
                  `#${caseId}`,

                inline: true
              }
            )

            .setFooter({

              text:
                `Moderator: ${interaction.user.tag}`
            })

            .setTimestamp()
        ]
      });

      // ==========================================
      // 📜 AUDIT LOG
      // ==========================================
      run(

        `INSERT INTO audit_logs

         (
           guildId,
           action,
           targetId,
           executorId,
           metadata,
           timestamp
         )

         VALUES (?, ?, ?, ?, ?, ?)`,

        [

          interaction.guild.id,

          'LOCK',

          channel.id,

          interaction.user.id,

          JSON.stringify({

            reason,

            channelId:
              channel.id,

            caseId
          }),

          Date.now()
        ]
      );

      // ==========================================
      // 📜 MOD LOG
      // ==========================================
      const logEmbed =
        createLogEmbed({

          action:
            'LOCK',

          user: {

            id:
              channel.id,

            tag:
              `#${channel.name}`
          },

          moderator:
            interaction.user,

          reason,

          caseId
        });

      await sendLog(

        interaction.client,

        interaction.guild.id,

        logEmbed
      );

    } catch (err) {

      console.error(
        'Lock Command Error:',
        err
      );

      if (

        interaction.deferred ||

        interaction.replied
      ) {

        return interaction.editReply({

          content:
            '❌ Failed to lock channel.'
        });
      }

      return interaction.reply({

        content:
          '❌ Failed to lock channel.',

        ephemeral: true
      });
    }
  }
};