const {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const {
  getFeedback,
  publishFeedback,
  submitFeedback
} = require('../utils/ticketFeedback');

function parseFeedbackId(customId, prefix) {
  const match =
    String(customId || '').match(
      new RegExp(`^${prefix}([a-f0-9-]{36})_([1-5])$`, 'i')
    );

  return match
    ? {
        id: match[1],
        rating: Number(match[2])
      }
    : null;
}

async function hiddenReply(interaction, content) {
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply({ content });
  }

  return interaction.reply({
    content,
    flags: MessageFlags.Ephemeral
  });
}

async function handleRatingButton(interaction) {
  const data =
    parseFeedbackId(
      interaction.customId,
      'ticket_feedback_rate_'
    );

  if (!data) {
    return;
  }

  const feedback =
    getFeedback(data.id);

  if (
    !feedback ||
    feedback.userId !== interaction.user.id ||
    feedback.status === 'SUBMITTED'
  ) {
    return hiddenReply(
      interaction,
      'This feedback request is no longer available.'
    );
  }

  const modal =
    new ModalBuilder()
      .setCustomId(`ticket_feedback_modal_${data.id}_${data.rating}`)
      .setTitle(`Ticket Feedback (${data.rating}/5)`);

  const input =
    new TextInputBuilder()
      .setCustomId('ticket_feedback_text')
      .setLabel('Anything else you would like to share?')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(1000)
      .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder()
      .addComponents(input)
  );

  return interaction.showModal(modal);
}

async function handleFeedbackModal(interaction) {
  const data =
    parseFeedbackId(
      interaction.customId,
      'ticket_feedback_modal_'
    );

  if (!data) {
    return hiddenReply(interaction, 'This feedback request is invalid.');
  }

  try {
    const record =
      submitFeedback({
        id: data.id,
        userId: interaction.user.id,
        rating: data.rating,
        feedback: interaction.fields.getTextInputValue('ticket_feedback_text')
      });

    let published = false;

    try {
      published = await publishFeedback(interaction.client, record);
    } catch (error) {
      console.error('Ticket feedback publish error:', error);
    }

    return hiddenReply(
      interaction,
      published
        ? 'Thank you for your feedback. It has been shared with the staff team.'
        : 'Thank you for your feedback. It was saved and will be posted to the feedback channel automatically.'
    );

  } catch (err) {
    return hiddenReply(
      interaction,
      err.message || 'Your feedback could not be saved.'
    );
  }
}

module.exports = {
  name: 'interactionCreate',

  async execute(interaction) {
    if (
      interaction.isButton() &&
      interaction.customId.startsWith('ticket_feedback_rate_')
    ) {
      return handleRatingButton(interaction);
    }

    if (
      interaction.isModalSubmit() &&
      interaction.customId.startsWith('ticket_feedback_modal_')
    ) {
      return handleFeedbackModal(interaction);
    }
  }
};
