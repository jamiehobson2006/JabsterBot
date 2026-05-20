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

      .setName('unlock')

      .setDescription(
        'Unlock the current channel'
      )

      .addStringOption(option =>

        option

          .setName('reason')

          .setDescription(
            'Reason for unlocking the channel'
          )

          .setMaxLength(200)
      ),

  async execute(interaction) {

    try {

      // ========================
      // 🔐 USER PERMISSION
      // ========================
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

      // ========================
      // 📺 CHANNEL
      // ========================
      const channel =
        interaction.channel;

      // ========================
      // 🤖 BOT MEMBER
      // ========================
      const botMember =
        interaction.guild.members.me;

      // ========================
      // 🤖 BOT PERMISSION
      // ========================
      if (

        !botMember.permissions.has(

          PermissionsBitField.Flags.ManageChannels
        )
      ) {

        return interaction.editReply({

          content:

            '❌ I do not have permission to manage channels.'
        });
      }

      // ========================
      // 🚫 CHANNEL CHECK
      // ========================
      if (

        ![

          ChannelType.GuildText,

          ChannelType.GuildAnnouncement

        ].includes(channel.type)
      ) {

        return interaction.editReply({

          content:

            '❌ This command can only be used in text channels.'
        });
      }

      // ========================
      // 📄 REASON
      // ========================
      const reason =
        interaction.options.getString(
          'reason'
        ) ||

        'No reason provided';

      // ========================
      // 👥 EVERYONE ROLE
      // ========================
      const everyone =
        interaction.guild.roles.everyone;

      const overwrite =
        channel.permissionOverwrites.cache.get(

          everyone.id
        );

      // ========================
      // 🧠 ALREADY UNLOCKED
      // ========================
      const isLocked =
        overwrite?.deny?.has(

          PermissionsBitField.Flags.SendMessages
        );

      if (!isLocked) {

        return interaction.editReply({

          content:

            '⚠️ This channel is already unlocked.'
        });
      }

      // ========================
      // 🔓 UNLOCK CHANNEL
      // ========================
      await channel.permissionOverwrites.edit(

        everyone,

        {

          SendMessages: null
        },

        {

          reason:

            `Unlocked by ${interaction.user.tag} | ${reason}`
        }
      );

      // ========================
      // 💾 SAVE CASE
      // ========================
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

            'UNLOCK',

            reason,

            channel.id,

            Date.now()
          ]
        );

      const caseId =
        result?.lastInsertRowid || 'N/A';

      // ========================
      // 🎨 EMBED
      // ========================
      const embed =
        new EmbedBuilder()

          .setTitle(
            '🔓 Channel Unlocked'
          )

          .setColor(
            0x57F287
          )

          .setDescription(

            'Members can now send messages again.'
          )

          .addFields(

            {

              name: '📺 Channel',

              value:
                `${channel}`,

              inline: true
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
            },

            {

              name: '📄 Reason',

              value:
                reason
            }
          )

          .setFooter({

            text:
              `${interaction.guild.name} Moderation`
          })

          .setTimestamp();

      // ========================
      // ✅ RESPONSE
      // ========================
      await interaction.editReply({

        embeds: [embed]
      });

      // ========================
      // 🗑 AUTO DELETE
      // ========================
      setTimeout(() => {

        if (!interaction.ephemeral) {

          interaction

            .deleteReply()

            .catch(() => {});
        }

      }, 3000);

      // ========================
      // 📜 AUDIT LOG
      // ========================
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

          'UNLOCK',

          channel.id,

          interaction.user.id,

          JSON.stringify({

            channelId:
              channel.id,

            reason,

            caseId
          }),

          Date.now()
        ]
      );

      // ========================
      // 📜 MOD LOG
      // ========================
      const log =
        createLogEmbed({

          action:
            'UNLOCK',

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

        log
      );

    } catch (err) {

      console.error(
        'Unlock Error:',
        err
      );

      if (

        interaction.deferred ||

        interaction.replied
      ) {

        return interaction.editReply({

          content:

            '❌ Failed to unlock channel. Check my permissions.'
        });
      }

      return interaction.reply({

        content:
          '❌ Failed to unlock channel.',

        ephemeral: true
      });
    }
  }
};