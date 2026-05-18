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

        [interaction.guild.id]
      );

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
            type.name,

          description:
            type.description,

          emoji:
            type.emoji,

          value:
            row.type
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
            'Select a ticket type'
          )

          .addOptions(options);

      const row =
        new ActionRowBuilder()

          .addComponents(menu);

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

            'Need help?\n\n' +

            'Select a ticket type from the menu below.\n\n' +

            'Our staff team will assist you as soon as possible.'
          )

          .addFields({

            name:
              'Available Ticket Types',

            value:

              options.map(option =>

                `${option.emoji} **${option.label}**\n` +

                `${option.description}`

              ).join('\n\n')
          })

          .setFooter({

            text:
              `${interaction.guild.name} Support System`
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
          '✅ Ticket panel created.'
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