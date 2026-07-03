const {

  EmbedBuilder,

  SlashCommandBuilder,

  PermissionsBitField

} = require('discord.js');

const {

  run,

  get

} = require('../../database');

module.exports = {

  cooldown: 3000,

  data:
    new SlashCommandBuilder()

      .setName('afk')

      .setDescription(
        'Set your AFK status'
      )

      .addStringOption(option =>

        option

          .setName('reason')

          .setDescription(
            'Reason for being AFK'
          )

          .setMaxLength(200)
      ),

  async execute(interaction) {

    try {

      // ========================
      // 📝 GET REASON
      // ========================
      let reason =
        interaction.options.getString(
          'reason'
        ) ||

        'AFK';

      // ========================
      // 🧹 CLEAN REASON
      // ========================
      reason = reason

        .replace(
          /@everyone|@here/g,

          '[mention removed]'
        )

        .replace(
          /[`*_~|>#]/g,

          ''
        )

        .replace(
          /\s+/g,

          ' '
        )

        .trim();

      // ========================
      // 🚫 EMPTY CHECK
      // ========================
      if (!reason.length) {

        reason = 'AFK';
      }

      // ========================
      // 🔍 EXISTING AFK
      // ========================
      const existing =
        get(

          `SELECT *

           FROM afk

           WHERE guildId = ?
           AND userId = ?`,

          [

            interaction.guild.id,

            interaction.user.id
          ]
        );

      const now =
        Date.now();

      // ========================
      // ⏱ AFK COUNT
      // ========================
      const stats =
        get(

          `SELECT COUNT(*) as total

           FROM afk_history

           WHERE guildId = ?
           AND userId = ?`,

          [

            interaction.guild.id,

            interaction.user.id
          ]
        );

      const afkCount =
        (stats?.total || 0) + 1;

      // ========================
      // 💾 SAVE AFK
      // ========================
      run(

        `INSERT INTO afk

         (
           guildId,
           userId,
           reason,
           timestamp
         )

         VALUES (?, ?, ?, ?)

         ON CONFLICT(guildId, userId)

         DO UPDATE SET

         reason = excluded.reason,
         timestamp = excluded.timestamp`,

        [

          interaction.guild.id,

          interaction.user.id,

          reason,

          now
        ]
      );

      // ========================
      // 📜 HISTORY LOG
      // ========================
      run(

        `INSERT INTO afk_history

         (
           guildId,
           userId,
           reason,
           timestamp
         )

         VALUES (?, ?, ?, ?)`,

        [

          interaction.guild.id,

          interaction.user.id,

          reason,

          now
        ]
      );

      // ========================
      // 👤 MEMBER
      // ========================
      const member =
        interaction.member;

      let nicknameUpdated =
        false;

      // ========================
      // 🏷 AFK NICKNAME
      // ========================
      try {

        if (

          member &&

          member.manageable &&

          interaction.guild.members.me.permissions.has(

            PermissionsBitField.Flags.ManageNicknames
          )
        ) {

          const currentName =

            member.nickname ||

            member.user.username;

          // ====================
          // 🚫 ALREADY AFK
          // ====================
          if (

            !currentName.startsWith(
              '[AFK] '
            )
          ) {

            const newName =

              `[AFK] ${currentName}`

                .slice(0, 32);

            await member.setNickname(

              newName,

              'AFK status enabled'
            );

            nicknameUpdated =
              true;
          }
        }

      } catch (err) {

        console.error(
          'AFK Nickname Error:',
          err
        );
      }

      // ========================
      // 🎨 EMBED
      // ========================
      const embed =
        new EmbedBuilder()

          .setColor(
            0x5865F2
          )

          .setTitle(
            '🌙 AFK Status Set'
          )

          .setThumbnail(

            interaction.user.displayAvatarURL({

              dynamic: true
            })
          )

          .setDescription(

            existing

              ? 'Your AFK status has been updated.'

              : 'You are now marked as AFK.'
          )

          .addFields(

            {

              name: '📄 Reason',

              value:
                reason
            },

            {

              name: '🕒 Since',

              value:

                `<t:${Math.floor(now / 1000)}:R>`,

              inline: true
            },

            {

              name: '📊 AFK Count',

              value:
                `${afkCount}`,

              inline: true
            },

            {

              name: '🏷 Nickname Updated',

              value:

                nicknameUpdated

                  ? '✅ Yes'

                  : '❌ No',

              inline: true
            }
          )

          .setFooter({

            text:
              `User: ${interaction.user.tag}`
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

    } catch (err) {

      console.error(
        'AFK Error:',
        err
      );

      if (

        interaction.deferred ||

        interaction.replied
      ) {

        return interaction.editReply({

          content:
            '❌ Failed to set AFK.'
        });
      }

      return interaction.reply({

        content:
          '❌ Failed to set AFK.',

        flags: 64
      });
    }
  }
};