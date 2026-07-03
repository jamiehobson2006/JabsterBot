const {

  ModalBuilder,

  TextInputBuilder,

  TextInputStyle,

  ActionRowBuilder,

  StringSelectMenuBuilder,

  MessageFlags

} = require('discord.js');

const {
  listForms
} = require('../utils/applications');

// ==================================================
// ðŸš« STALE INTERACTIONS
// ==================================================
function isStaleInteractionError(error) {

  return (

    error?.code === 10062 ||

    error?.code === 40060 ||

    error?.code === 10015
  );
}

// ==================================================
// ðŸ’¬ SAFE REPLY
// ==================================================
async function safelyReply(
  interaction,
  payload
) {

  try {

    if (

      interaction.deferred ||

      interaction.replied
    ) {

      try {

        return await interaction.editReply(
          payload
        );

      } catch {

        return await interaction.followUp({

          ...payload,

          flags:
            MessageFlags.Ephemeral
        });
      }
    }

    return await interaction.reply({

      ...payload,

      flags:
        MessageFlags.Ephemeral
    });

  } catch (err) {

    if (
      !isStaleInteractionError(err)
    ) {

      console.error(
        'Ticket Menu Reply Error:',
        err
      );
    }

    return null;
  }
}

module.exports = {

  name: 'interactionCreate',

  async execute(interaction) {

    try {

      // ==================================================
      // ðŸŽŸ TICKET MENU ONLY
      // ==================================================
      if (

        !interaction.isStringSelectMenu() ||

        interaction.customId !==
        'ticket_create'
      ) {

        return;
      }

      // ==============================================
      // ðŸŽ« VALIDATE TYPE
      // ==============================================
      const type =
        interaction.values?.[0];

      if (!type) {

        return safelyReply(
          interaction,
          {

            content:
              'âŒ Invalid ticket type.'
          }
        );
      }

      // ==============================================
      // ðŸ§¹ CLEAN TYPE
      // ==============================================
      const safeType =
        type

          .replace(/[^a-zA-Z0-9_-]/g, '')

          .slice(0, 30);

      if (safeType === 'application') {

        const forms =
          listForms(
            interaction.guild.id,
            {
              enabledOnly: true
            }
          );

        if (!forms.length) {

          return safelyReply(
            interaction,
            {
              content:
                'No applications are available right now.'
            }
          );
        }

        const menu =
          new StringSelectMenuBuilder()
            .setCustomId('application_select')
            .setPlaceholder('Choose an application')
            .addOptions(
              forms.slice(0, 25).map(form => ({
                label:
                  form.name.slice(0, 100),
                description:
                  (form.description || 'Application form')
                    .slice(0, 100),
                value:
                  String(form.id)
              }))
            );

        return safelyReply(
          interaction,
          {
            content:
              'Choose the application you want to submit.',
            components: [
              new ActionRowBuilder()
                .addComponents(menu)
            ]
          }
        );
      }

      // ==============================================
      // ðŸ“ MODAL
      // ==============================================
      const modal =
        new ModalBuilder()

          .setCustomId(
            `ticket_modal_${safeType}`
          )

          .setTitle(
            'Create Ticket'
          );

      // ==============================================
      // ðŸ“ REASON INPUT
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

          .setMinLength(5)

          .setMaxLength(1000);

      // ==============================================
      // ðŸ“¦ ROW
      // ==============================================
      const row =
        new ActionRowBuilder()

          .addComponents(
            reasonInput
          );

      modal.addComponents(row);

      // ==============================================
      // ðŸ“¤ SHOW MODAL
      // ==============================================
      await interaction.showModal(
        modal
      );

    } catch (err) {

      console.error(
        'Ticket Menu Error:',
        err
      );

      if (
        isStaleInteractionError(err)
      ) {

        return;
      }

      return safelyReply(
        interaction,
        {

          content:
            'âŒ Failed to open ticket menu.'
        }
      );
    }
  }
};
