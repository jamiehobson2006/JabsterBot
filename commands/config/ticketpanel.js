const {

  SlashCommandBuilder,

  PermissionsBitField,

  EmbedBuilder,

  ActionRowBuilder,

  StringSelectMenuBuilder

} = require('discord.js');

const {
  all
} = require('../../database');

const ticketTypes =
  require('../../utils/tickets/ticketTypes');

module.exports = {

  cooldown: 5000,

  data:
    new SlashCommandBuilder()

      .setName('ticketpanel')

      .setDescription(
        'Send the ticket panel'
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
      // 📥 FETCH ENABLED TYPES
      // ==========================================
      const rows = all(

        `SELECT *
         FROM ticket_settings

         WHERE guildId = ?
         AND enabled = 1`,

        [

          interaction.guild.id
        ]
      );

      // ==========================================
      // ❌ NO TYPES
      // ==========================================
      if (!rows.length) {

        return interaction.editReply({

          content:
            '❌ No ticket types are configured.'
        });
      }

      // ==========================================
      // 🎟 BUILD OPTIONS
      // ==========================================
      const options = [];

      for (const row of rows) {

        const type =
          ticketTypes[row.type];

        if (!type) continue;

        options.push({

          label:
            type.name.slice(0, 100),

          description:
            type.description.slice(0, 100),

          emoji:
            type.emoji,

          value:
            row.type
        });
      }

      // ==========================================
      // 🚫 NO VALID TYPES
      // ==========================================
      if (!options.length) {

        return interaction.editReply({

          content:
            '❌ No valid ticket types found.'
        });
      }

      // ==========================================
      // 🚫 DISCORD LIMIT
      // ==========================================
      if (options.length > 25) {

        return interaction.editReply({

          content:

            '❌ Discord only allows 25 ticket types per panel.'
        });
      }

      // ==========================================
      // 🎛 MENU
      // ==========================================
      const menu =
        new StringSelectMenuBuilder()

          .setCustomId(
            'ticket_create'
          )

          .setPlaceholder(
            '🎫 Select a ticket type'
          )

          .addOptions(options);

      const row =
        new ActionRowBuilder()

          .addComponents(menu);

      // ==========================================
      // 📊 TYPE DISPLAY
      // ==========================================
      const ticketDisplay =
        options.map(option =>

          `${option.emoji} **${option.label}**\n` +

          `${option.description}`
        ).join('\n\n');

      // ==========================================
      // 🎨 EMBED
      // ==========================================
      const embed =
        new EmbedBuilder()

          .setColor(0x5865F2)

          .setTitle(
            '🎫 Support Center'
          )

          .setDescription(

            'Need assistance?\n\n' +

            'Select a ticket type from the menu below and our staff team will assist you as soon as possible.'
          )

          .addFields(

            {

              name:
                'Available Ticket Types',

              value:
                ticketDisplay
            },

            {

              name:
                '📊 Panel Statistics',

              value:

                `• ${options.length} ticket type(s)\n` +

                `• Interactive support menu\n` +

                `• Fast staff response system`
            }
          )

          .setFooter({

            text:

              `${interaction.guild.name} • Advanced Ticket System`
          })

          .setTimestamp();

      // ==========================================
      // 📤 SEND PANEL
      // ==========================================
      await interaction.channel.send({

        embeds: [embed],

        components: [row]
      });

      // ==========================================
      // ✅ RESPONSE
      // ==========================================
      return interaction.editReply({

        content:
          '✅ Ticket panel created successfully.'
      });

    } catch (err) {

      console.error(
        'TicketPanel Error:',
        err
      );

      return interaction.editReply({

        content:
          '❌ Failed to create ticket panel.'
      });
    }
  }
};