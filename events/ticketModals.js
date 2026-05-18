const {
  createTicket
} = require('../utils/tickets/createTicket');

module.exports = {

  name: 'interactionCreate',

  async execute(interaction) {

    try {

      // ==================================================
      // 📝 TICKET MODAL
      // ==================================================
      if (

        !interaction.isModalSubmit() ||

        !interaction.customId.startsWith(
          'ticket_modal_'
        )
      ) {

        return;
      }

      await interaction.deferReply({

        ephemeral: true
      });

      // ==============================================
      // 🎫 TYPE
      // ==============================================
      const type =
        interaction.customId.replace(
          'ticket_modal_',
          ''
        );

      // ==============================================
      // 📝 REASON
      // ==============================================
      const reason =
        interaction.fields.getTextInputValue(
          'ticket_reason'
        );

      // ==============================================
      // 🎟 CREATE TICKET
      // ==============================================
      try {

        const result =
          await createTicket({

            interaction,

            type,

            reason
          });

        return interaction.editReply({

          content:

            `✅ Ticket created: ${result.channel}`
        });

      } catch (err) {

        return interaction.editReply({

          content:
            `❌ ${err.message}`
        });
      }

    } catch (err) {

      console.error(
        'Ticket Modal Error:',
        err
      );

      try {

        if (

          interaction.deferred ||

          interaction.replied
        ) {

          await interaction.editReply({

            content:
              '❌ Failed to create ticket.'
          });

        } else {

          await interaction.reply({

            content:
              '❌ Failed to create ticket.',

            ephemeral: true
          });
        }

      } catch {}
    }
  }
};