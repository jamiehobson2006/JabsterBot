const {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const {
  claimTicket
} = require('../utils/tickets/claimTicket');

const {
  closeTicket
} = require('../utils/tickets/closeTicket');

function isStaleInteractionError(error) {
  return (
    error?.code === 10062 ||
    error?.code === 40060 ||
    error?.code === 10015
  );
}

async function safelyDefer(interaction) {
  if (interaction.deferred || interaction.replied) {
    return true;
  }

  try {
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral
    });

    return true;

  } catch (err) {
    if (!isStaleInteractionError(err)) {
      console.error('Ticket defer error:', err);
    }

    return false;
  }
}

async function safelyReply(interaction, content) {
  try {
    if (interaction.deferred || interaction.replied) {
      return interaction.editReply({ content });
    }

    return interaction.reply({
      content,
      flags: MessageFlags.Ephemeral
    });

  } catch (err) {
    if (!isStaleInteractionError(err)) {
      console.error('Ticket reply error:', err);
    }

    return null;
  }
}

async function handleCloseModal(interaction) {
  const deferred =
    await safelyDefer(interaction);

  if (!deferred) {
    return;
  }

  try {
    const result =
      await closeTicket({
        interaction,
        reason: interaction.fields.getTextInputValue('ticket_close_reason')
      });

    return safelyReply(
      interaction,
      result.channelDeleted
        ? 'Ticket closed.'
        : 'Ticket closed, but the channel was kept because the transcript failed.'
    );

  } catch (err) {
    console.error('Close Ticket Error:', err);
    return safelyReply(
      interaction,
      err.message || 'Failed to close ticket.'
    );
  }
}

function buildCloseModal() {
  const modal =
    new ModalBuilder()
      .setCustomId('ticket_close_modal')
      .setTitle('Close Ticket');

  const reason =
    new TextInputBuilder()
      .setCustomId('ticket_close_reason')
      .setLabel('Why is this ticket being closed?')
      .setStyle(TextInputStyle.Paragraph)
      .setMinLength(3)
      .setMaxLength(1000)
      .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder()
      .addComponents(reason)
  );

  return modal;
}

module.exports = {
  name: 'interactionCreate',

  async execute(interaction) {
    try {
      if (
        interaction.isStringSelectMenu() &&
        interaction.customId === 'ticket_create'
      ) {
        return;
      }

      if (
        interaction.isModalSubmit() &&
        interaction.customId.startsWith('ticket_modal_')
      ) {
        return;
      }

      if (
        interaction.isModalSubmit() &&
        interaction.customId === 'ticket_close_modal'
      ) {
        return handleCloseModal(interaction);
      }

      if (!interaction.isButton()) {
        return;
      }

      if (interaction.customId === 'ticket_claim') {
        const deferred =
          await safelyDefer(interaction);

        if (!deferred) {
          return;
        }

        try {
          await claimTicket({ interaction });
          return safelyReply(interaction, 'Ticket claimed.');

        } catch (err) {
          console.error('Claim Ticket Error:', err);
          return safelyReply(
            interaction,
            err.message || 'Failed to claim ticket.'
          );
        }
      }

      if (interaction.customId === 'ticket_close') {
        return interaction.showModal(buildCloseModal());
      }

    } catch (err) {
      if (!isStaleInteractionError(err)) {
        console.error('Ticket interaction error:', err);
      }

      return safelyReply(
        interaction,
        'Ticket system error.'
      );
    }
  }
};
