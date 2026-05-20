const {

  ModalBuilder,

  TextInputBuilder,

  TextInputStyle,

  ActionRowBuilder,

  MessageFlags

} = require('discord.js');

// ==================================================
// 🚫 STALE INTERACTIONS
// ==================================================
function isStaleInteractionError(error) {

  return (

    error?.code === 10062 ||

    error?.code === 40060 ||

    error?.code === 10015
  );
}

// ==================================================
// 💬 SAFE REPLY
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
      // 🎟 TICKET MENU ONLY
      // ==================================================
      if (

        !interaction.isStringSelectMenu() ||

        interaction.customId !==
        'ticket_create'
      ) {

        return;
      }

      // ==============================================
      // 🎫 VALIDATE TYPE
      // ==============================================
      const type =
        interaction.values?.[0];

      if (!type) {

        return safelyReply(
          interaction,
          {

            content:
              '❌ Invalid ticket type.'
          }
        );
      }

      // ==============================================
      // 🧹 CLEAN TYPE
      // ==============================================
      const safeType =
        type

          .replace(/[^a-zA-Z0-9_-]/g, '')

          .slice(0, 30);

      // ==============================================
      // 📝 MODAL
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

          .setMinLength(5)

          .setMaxLength(1000);

      // ==============================================
      // 📦 ROW
      // ==============================================
      const row =
        new ActionRowBuilder()

          .addComponents(
            reasonInput
          );

      modal.addComponents(row);

      // ==============================================
      // 📤 SHOW MODAL
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
            '❌ Failed to open ticket menu.'
        }
      );
    }
  }
};