const {

  EmbedBuilder,

  PermissionsBitField,

  SlashCommandBuilder

} = require('discord.js');

const {
  get
} = require('../../database');

module.exports = {

  cooldown: 5000,

  data:
    new SlashCommandBuilder()

      .setName('inviteinfo')

      .setDescription(
        'View detailed invite information for a user'
      )

      .addUserOption(option =>

        option

          .setName('user')

          .setDescription(
            'User to check'
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

          PermissionsBitField.Flags.ModerateMembers
        )
      ) {

        return interaction.editReply({

          content:

            '❌ You need **Moderate Members** permission.'
        });
      }

      // ==========================================
      // 👤 TARGET
      // ==========================================
      const user =
        interaction.options.getUser(

          'user',

          true
        );

      // ==========================================
      // 📊 FETCH INVITE DATA
      // ==========================================
      const data =
        get(

          `SELECT *
           FROM invites

           WHERE guildId = ?
           AND userId = ?`,

          [

            interaction.guild.id,

            user.id
          ]
        );

      // ==========================================
      // ❌ NO DATA
      // ==========================================
      if (!data) {

        return interaction.editReply({

          content:

            '❌ No invite data found for that user.'
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
      // 🧠 ACCOUNT AGE
      // ==========================================
      const accountAge =
        Date.now() -
        user.createdTimestamp;

      const ageDays =
        Math.floor(

          accountAge /

          (1000 * 60 * 60 * 24)
        );

      // ==========================================
      // 🏠 SERVER TIME
      // ==========================================
      const serverDays =
        member?.joinedTimestamp

          ? Math.floor(

              (Date.now() -

                member.joinedTimestamp)

              / 86400000
            )

          : 0;

      // ==========================================
      // 🚨 RISK SYSTEM
      // ==========================================
      let risk =
        'Low';

      let riskColor =
        0x57F287;

      const indicators = [];

      if (ageDays < 30) {

        risk =
          'Medium';

        riskColor =
          0xF1C40F;

        indicators.push(
          'New account'
        );
      }

      if (

        ageDays < 7 ||

        data.fake ||

        data.leftAt
      ) {

        risk =
          'High';

        riskColor =
          0xED4245;
      }

      if (data.fake) {

        indicators.push(
          'Flagged as suspicious'
        );
      }

      if (data.leftAt) {

        indicators.push(
          'Previously left server'
        );
      }

      if (

        user.avatar === null
      ) {

        indicators.push(
          'Default avatar'
        );
      }

      // ==========================================
      // 👤 INVITER
      // ==========================================
      let inviter =
        null;

      if (data.inviterId) {

        inviter =
          await interaction.client.users

            .fetch(
              data.inviterId
            )

            .catch(() => null);
      }

      // ==========================================
      // 📊 INVITER STATS
      // ==========================================
      let stats =
        null;

      if (data.inviterId) {

        stats =
          get(

            `SELECT *
             FROM invite_stats

             WHERE guildId = ?
             AND userId = ?`,

            [

              interaction.guild.id,

              data.inviterId
            ]
          );
      }

      // ==========================================
      // 📈 REGULAR INVITES
      // ==========================================
      const regular =
        stats

          ? Math.max(

              stats.invites -

              stats.fake -

              stats.leaves,

              0
            )

          : 0;

      // ==========================================
      // 🏆 INVITER RANK
      // ==========================================
      let rank =
        null;

      if (stats) {

        rank =
          get(

            `SELECT COUNT(*) + 1 as rank

             FROM invite_stats

             WHERE guildId = ?
             AND invites > ?`,

            [

              interaction.guild.id,

              stats.invites
            ]
          );
      }

      // ==========================================
      // 👥 JOIN POSITION
      // ==========================================
      const joinPosition =
        interaction.guild.memberCount;

      // ==========================================
      // 🎨 EMBED
      // ==========================================
      const embed =
        new EmbedBuilder()

          .setColor(
            riskColor
          )

          .setAuthor({

            name:
              `${user.tag}`,

            iconURL:

              user.displayAvatarURL({

                dynamic: true
              })
          })

          .setThumbnail(

            user.displayAvatarURL({

              dynamic: true,

              size: 256
            })
          )

          .setTitle(
            '📨 Invite Information'
          )

          .addFields(

            {

              name: '👤 User',

              value:

                `${user}\n` +

                `\`${user.id}\``,

              inline: true
            },

            {

              name: '📨 Invited By',

              value:

                inviter

                  ? `${inviter.tag}\n<@${inviter.id}>`

                  : 'Unknown',

              inline: true
            },

            {

              name: '🔗 Invite Code',

              value:

                `\`${data.inviteCode || 'Unknown'}\``,

              inline: true
            },

            {

              name: '📅 Joined Server',

              value:

                `<t:${Math.floor(

                  data.joinedAt / 1000

                )}:F>`,

              inline: true
            },

            {

              name: '📅 Account Created',

              value:

                `<t:${Math.floor(

                  user.createdTimestamp / 1000

                )}:F>`,

              inline: true
            },

            {

              name: '⏱ Account Age',

              value:
                `${ageDays} day(s)`,

              inline: true
            },

            {

              name: '🏠 Time In Server',

              value:
                `${serverDays} day(s)`,

              inline: true
            },

            {

              name: '👥 Join Position',

              value:
                `#${joinPosition}`,

              inline: true
            },

            {

              name: '🚨 Risk Level',

              value:
                risk,

              inline: true
            },

            {

              name: '⚠️ Fake / Alt',

              value:

                data.fake

                  ? 'Yes'

                  : 'No',

              inline: true
            },

            {

              name: '📤 Left Server Before',

              value:

                data.leftAt

                  ? 'Yes'

                  : 'No',

              inline: true
            },

            {

              name: '📊 Inviter Stats',

              value:

                stats

                  ? `📈 Total: ${stats.invites}\n` +

                    `✅ Regular: ${regular}\n` +

                    `⚠️ Fake: ${stats.fake}\n` +

                    `📤 Leaves: ${stats.leaves}`

                  : 'No stats',

              inline: true
            },

            {

              name: '🏆 Inviter Rank',

              value:

                rank

                  ? `#${rank.rank}`

                  : 'N/A',

              inline: true
            }
          )

          .setFooter({

            text:
              'Invite Tracking System'
          })

          .setTimestamp();

      // ==========================================
      // 🚨 INDICATORS
      // ==========================================
      if (indicators.length) {

        embed.addFields({

          name: '🚨 Suspicious Indicators',

          value:

            indicators

              .map(i => `• ${i}`)

              .join('\n')
        });
      }

      // ==========================================
      // ⚠️ WARNING DESCRIPTION
      // ==========================================
      if (

        risk === 'High'
      ) {

        embed.setDescription(

          '⚠️ This user may be suspicious and should be reviewed carefully.'
        );
      }

      // ==========================================
      // 📤 RESPONSE
      // ==========================================
      await interaction.editReply({

        embeds: [embed]
      });

    } catch (err) {

      console.error(
        'InviteInfo Error:',
        err
      );

      return interaction.editReply({

        content:
          '❌ Failed to fetch invite information.'
      });
    }
  }
};