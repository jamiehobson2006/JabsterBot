const {

  ModalBuilder,

  TextInputBuilder,

  TextInputStyle,

  ActionRowBuilder

} = require('discord.js');

module.exports = {

  name: 'interactionCreate',

  async execute(interaction) {

    try {

      // ==================================================
      // 🎟 TICKET MENU
      // ==================================================
      if (

        !interaction.isStringSelectMenu() ||

        interaction.customId !== 'ticket_create'
      ) {

        return;
      }

      // ==============================================
      // 🎫 TYPE
      // ==============================================
      const type =
        interaction.values[0];

      // ==============================================
      // 📝 MODAL
      // ==============================================
      const modal =
        new ModalBuilder()

          .setCustomId(
            `ticket_modal_${type}`
          )

          .setTitle(
            'Create Ticket'
          );

      // ==============================================
      // 📝 REASON INPUT
      // ==============================================
      const reasonInput =
        new TextInputBuilder()

          .setCustomId(
            'ticket_reason'
          )

          .setLabel(
            'Describe your issue'
          )

          .setStyle(
            TextInputStyle.Paragraph
          )

          .setPlaceholder(

            'Provide as much detail as possible...'
          )

          .setRequired(true)

          .setMaxLength(1000);

      // ==============================================
      // 📦 ROW
      // ==============================================
      const row =
        new ActionRowBuilder()

          .addComponents(reasonInput);

      modal.addComponents(row);

      // ==============================================
      // 📤 SHOW MODAL
      // ==============================================
      return interaction.showModal(modal);

    } catch (err) {

      console.error(
        'Ticket Menu Error:',
        err
      );

      try {

        if (

          interaction.deferred ||

          interaction.replied
        ) {

          await interaction.editReply({

            content:
              '❌ Failed to open ticket menu.'
          });

        } else {

          await interaction.reply({

            content:
              '❌ Failed to open ticket menu.',

            ephemeral: true
          });
        }

      } catch {}
    }
  }
};