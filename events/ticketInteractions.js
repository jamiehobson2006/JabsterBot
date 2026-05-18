const {

  PermissionsBitField

} = require('discord.js');

const {
  claimTicket
} = require('../utils/tickets/claimTicket');

const {
  closeTicket
} = require('../utils/tickets/closeTicket');

module.exports = {

  name: 'interactionCreate',

  async execute(interaction) {

    try {

      // ==================================================
      // 🎟 TICKET DROPDOWN
      // ==================================================
      if (

        interaction.isStringSelectMenu() &&

        interaction.customId === 'ticket_create'
      ) {

        // handled in ticketMenus.js
        return;
      }

      // ==================================================
      // 📝 TICKET MODALS
      // ==================================================
      if (

        interaction.isModalSubmit() &&

        interaction.customId.startsWith(
          'ticket_modal_'
        )
      ) {

        // handled in ticketModals.js
        return;
      }

      // ==================================================
      // 🔘 BUTTON INTERACTIONS
      // ==================================================
      if (!interaction.isButton()) {
        return;
      }

      // ==================================================
      // 👮 CLAIM BUTTON
      // ==================================================
      if (

        interaction.customId ===
        'ticket_claim'
      ) {

        await interaction.deferReply({

          ephemeral: true
        });

        try {

          await claimTicket({

            interaction
          });

          return interaction.editReply({

            content:
              '✅ Ticket claimed.'
          });

        } catch (err) {

          return interaction.editReply({

            content:
              `❌ ${err.message}`
          });
        }
      }

      // ==================================================
      // 🔒 CLOSE BUTTON
      // ==================================================
      if (

        interaction.customId ===
        'ticket_close'
      ) {

        await interaction.deferReply({

          ephemeral: true
        });

        try {

          await closeTicket({

            interaction
          });

          return interaction.editReply({

            content:
              '✅ Ticket closed.'
          });

        } catch (err) {

          return interaction.editReply({

            content:
              `❌ ${err.message}`
          });
        }
      }

      // ==================================================
      // 🚫 UNKNOWN BUTTONS
      // ==================================================
      return;

    } catch (err) {

      console.error(
        'Ticket Interaction Error:',
        err
      );

      try {

        if (

          interaction.deferred ||

          interaction.replied
        ) {

          await interaction.editReply({

            content:
              '❌ Ticket system error.'
          });

        } else {

          await interaction.reply({

            content:
              '❌ Ticket system error.',

            ephemeral: true
          });
        }

      } catch {}
    }
  }
};