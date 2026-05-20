const {

  PermissionsBitField,

  EmbedBuilder,

  SlashCommandBuilder,

} = require('discord.js');

const {

  run,

  get

} = require('../../database');

const {

  createAuditEmbed,

  logAudit

} = require('../../utils/logger');

module.exports = {

  cooldown: 3000,

  data:
    new SlashCommandBuilder()

      .setName('clearwarns')

      .setDescription(
        'Clear all warnings for a user'
      )

      .addUserOption(option =>

        option

          .setName('user')

          .setDescription(
            'User'
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
      // 👤 USER
      // ==========================================
      const user =
        interaction.options.getUser(

          'user',

          true
        );

      // ==========================================
      // 🚫 SELF CHECK
      // ==========================================
      if (user.id === interaction.user.id) {

        return interaction.editReply({

          content:

            '❌ You cannot clear your own warnings.'
        });
      }

      // ==========================================
      // 🤖 BOT CHECK
      // ==========================================
      if (user.id === interaction.client.user.id) {

        return interaction.editReply({

          content:

            "❌ You cannot clear the bot's warnings."
        });
      }

      // ==========================================
      // 👑 OWNER CHECK
      // ==========================================
      if (user.id === interaction.guild.ownerId) {

        return interaction.editReply({

          content:

            '❌ You cannot clear warnings for the server owner.'
        });
      }

      // ==========================================
      // 👤 FETCH MEMBER
      // ==========================================
      const member =
        await interaction.guild.members

          .fetch(user.id)

          .catch(() => null);

      // ==========================================
      // 🛡 HIERARCHY
      // ==========================================
      if (

        member &&

        member.roles.highest.position >=

        interaction.member.roles.highest.position &&

        interaction.user.id !== interaction.guild.ownerId
      ) {

        return interaction.editReply({

          content:

            '❌ You cannot clear warnings for this user due to role hierarchy.'
        });
      }

      // ==========================================
      // 👑 ADMIN CHECK
      // ==========================================
      if (

        member?.permissions.has(

          PermissionsBitField.Flags.Administrator
        ) &&

        interaction.user.id !== interaction.guild.ownerId
      ) {

        return interaction.editReply({

          content:
            '❌ You cannot clear warnings for administrators.'
        });
      }

      // ==========================================
      // 📄 COUNT WARNS
      // ==========================================
      const warns =
        get(

          `SELECT COUNT(*) as total

           FROM warns

           WHERE guildId = ?
           AND userId = ?`,

          [

            interaction.guild.id,

            user.id
          ]
        );

      const warnCount =
        warns?.total || 0;

      // ==========================================
      // ❌ NONE FOUND
      // ==========================================
      if (warnCount === 0) {

        return interaction.editReply({

          content:

            `❌ ${user.tag} has no warnings to clear.`
        });
      }

      // ==========================================
      // 🗑 DELETE WARNS
      // ==========================================
      run(

        `DELETE FROM warns

         WHERE guildId = ?
         AND userId = ?`,

        [

          interaction.guild.id,

          user.id
        ]
      );

      // ==========================================
      // 📜 SAVE CASE
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
             createdAt
           )

           VALUES (?, ?, ?, ?, ?, ?)`,

          [

            interaction.guild.id,

            user.id,

            interaction.user.id,

            'CLEARWARNS',

            `Cleared ${warnCount} warning(s)`,

            Date.now()
          ]
        );

      const caseId =
        result?.lastInsertRowid || 'N/A';

      // ==========================================
      // 📩 DM USER
      // ==========================================
      try {

        await user.send({

          embeds: [

            new EmbedBuilder()

              .setColor(0xE67E22)

              .setTitle(
                '🧹 Warnings Cleared'
              )

              .setDescription(

                `Your warnings in **${interaction.guild.name}** were cleared.\n\n` +

                `🧹 Removed warnings: **${warnCount}**`
              )

              .addFields({

                name: '🛡 Moderator',

                value:
                  interaction.user.tag
              })

              .setTimestamp()
          ]
        });

      } catch {}

      // ==========================================
      // 🎨 RESPONSE EMBED
      // ==========================================
      const embed =
        new EmbedBuilder()

          .setColor(0x57F287)

          .setTitle(
            '🧹 Warnings Cleared'
          )

          .setDescription(

            `Removed **${warnCount} warning(s)** from ${user}`
          )

          .addFields(

            {

              name: '👤 User ID',

              value:
                `\`${user.id}\``,

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
              `Moderator: ${interaction.user.tag}`
          })

          .setTimestamp();

      // ==========================================
      // 📤 RESPONSE
      // ==========================================
      await interaction.editReply({

        embeds: [embed]
      });

      // ==========================================
      // 📜 AUDIT LOG
      // ==========================================
      await logAudit(

        interaction.client,

        interaction.guild.id,

        {

          action:
            'CLEAR_WARNINGS',

          targetId:
            user.id,

          executorId:
            interaction.user.id,

          metadata: {

            warningsCleared:
              warnCount
          },

          embed:
            createAuditEmbed({

              action:
                'Warnings Cleared',

              target:

                `<@${user.id}> (${user.tag})`,

              executor:

                `<@${interaction.user.id}>`,

              extra:

                `${warnCount} warning(s) cleared`,

              color:
                'Green',
            }),
        }
      );

    } catch (err) {

      console.error(
        'ClearWarns Error:',
        err
      );

      return interaction.editReply({

        content:
          '❌ Failed to clear warnings.'
      });
    }
  },
};