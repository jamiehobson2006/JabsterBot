const {
  SlashCommandBuilder,
  PermissionsBitField,
  EmbedBuilder
} = require('discord.js');

const {
  get,
  all
} = require('../../database');

module.exports = {

  cooldown: 5000,

  data:
    new SlashCommandBuilder()

      .setName('ginfo')

      .setDescription(
        'View giveaway information'
      )

      .addStringOption(option =>

        option

          .setName('message_id')

          .setDescription(
            'Giveaway message ID'
          )

          .setRequired(true)
      ),

  async execute(interaction) {

    try {

      // ==========================================
      // 🔐 PERMISSIONS
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
      // 📨 MESSAGE ID
      // ==========================================
      const messageId =
        interaction.options.getString(

          'message_id',

          true
        );

      // ==========================================
      // 📊 GIVEAWAY
      // ==========================================
      const giveaway =
        get(

          `SELECT *
           FROM giveaways

           WHERE messageId = ?
           AND guildId = ?`,

          [

            messageId,

            interaction.guild.id
          ]
        );

      if (!giveaway) {

        return interaction.editReply({

          content:
            '❌ Giveaway not found in this server.'
        });
      }

      // ==========================================
      // 🎟 ENTRIES
      // ==========================================
      const entries =
        all(

          `SELECT *
           FROM giveaway_entries

           WHERE messageId = ?`,

          [messageId]
        );

      // ==========================================
      // 🏆 WINNERS
      // ==========================================
      const winners =
        all(

          `SELECT *
           FROM giveaway_winners

           WHERE messageId = ?`,

          [messageId]
        );

      // ==========================================
      // 📜 REQUIREMENTS
      // ==========================================
      let requirements = {};

      try {

        requirements =
          JSON.parse(
            giveaway.requirements || '{}'
          );

      } catch {

        requirements = {};
      }

      // ==========================================
      // 📊 STATUS
      // ==========================================
      const now = Date.now();

      let status =
        giveaway.ended
          ? '🔴 Ended'
          : '🟢 Active';

      if (

        !giveaway.ended &&

        giveaway.endsAt - now <=
        60 * 60 * 1000
      ) {

        status = '🟡 Ending Soon';
      }

      // ==========================================
      // 🏆 WINNER DISPLAY
      // ==========================================
      let winnerDisplay =
        'No winners yet';

      if (winners.length) {

        const displayed =
          winners
            .slice(0, 20)
            .map(w =>
              `<@${w.userId}>`
            )
            .join('\n');

        winnerDisplay =
          displayed;

        if (winners.length > 20) {

          winnerDisplay +=

            `\n+ ${winners.length - 20} more...`;
        }
      }

      // ==========================================
      // 🎨 EMBED
      // ==========================================
      const embed =
        new EmbedBuilder()

          .setColor(0x5865F2)

          .setTitle(
            '🎉 Giveaway Information'
          )

          .addFields(

            {

              name: '🎁 Prize',

              value:
                giveaway.prize,

              inline: false
            },

            {

              name: '👤 Host',

              value:

                `<@${giveaway.hostId}>\n` +

                `\`${giveaway.hostId}\``,

              inline: true
            },

            {

              name: '🏆 Winners',

              value:
                `${giveaway.winners || giveaway.winnerCount || 1}`,

              inline: true
            },

            {

              name: '📊 Entries',

              value:
                `${entries.length}`,

              inline: true
            },

            {

              name: '📺 Channel',

              value:
                `<#${giveaway.channelId}>`,

              inline: true
            },

            {

              name: '📌 Status',

              value:
                status,

              inline: true
            },

            {

              name: '⏳ Remaining',

              value:

                giveaway.ended

                  ? 'Ended'

                  : `<t:${Math.floor(
                      giveaway.endsAt / 1000
                    )}:R>`,

              inline: true
            },

            {

              name: '📅 Created',

              value:

                `<t:${Math.floor(
                  giveaway.createdAt / 1000
                )}:F>`,

              inline: true
            },

            {

              name: '⏰ Ends',

              value:

                `<t:${Math.floor(
                  giveaway.endsAt / 1000
                )}:F>`,

              inline: true
            },

            {

              name: '🏆 Winner History',

              value:
                winnerDisplay,

              inline: false
            },

            {

              name: '🎯 Requirements',

              value:
                formatRequirements(
                  requirements
                )
            }
          )

          .setFooter({

            text:
              `Message ID: ${giveaway.messageId}`
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
        'Giveaway Info Error:',
        err
      );

      return interaction.editReply({

        content:
          '❌ Failed to fetch giveaway info.'
      });
    }
  }
};

// ==================================================
// 🎯 REQUIREMENT FORMATTER
// ==================================================
function formatRequirements(req) {

  const lines = [];

  if (req.minInvites) {

    lines.push(
      `📨 ${req.minInvites}+ invites`
    );
  }

  if (req.weeklyMessages) {

    lines.push(
      `💬 ${req.weeklyMessages}+ weekly messages`
    );
  }

  if (req.monthlyMessages) {

    lines.push(
      `🗓 ${req.monthlyMessages}+ monthly messages`
    );
  }

  if (req.mustBoost) {

    lines.push(
      '🚀 Must boost server'
    );
  }

  if (req.requiredRoles?.length) {

    lines.push(

      `🎭 Required Roles:\n` +

      req.requiredRoles
        .map(id => `<@&${id}>`)
        .join(', ')
    );
  }

  if (req.blacklistedRoles?.length) {

    lines.push(

      `🚫 Blacklisted Roles:\n` +

      req.blacklistedRoles
        .map(id => `<@&${id}>`)
        .join(', ')
    );
  }

  if (!lines.length) {

    return 'None';
  }

  return lines.join('\n');
}