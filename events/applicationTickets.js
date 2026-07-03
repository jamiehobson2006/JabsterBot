const {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const {
  getFormById,
  getQuestions
} = require('../utils/applications');

const {
  createTicket
} = require('../utils/tickets/createTicket');

function isStaleInteractionError(error) {
  return (
    error?.code === 10062 ||
    error?.code === 40060 ||
    error?.code === 10015
  );
}

function cleanAnswer(answer) {
  return String(answer || '')
    .replace(/@everyone|@here/g, '[mention removed]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000);
}

async function replyHidden(
  interaction,
  content
) {
  if (
    interaction.deferred ||
    interaction.replied
  ) {
    return interaction.editReply({
      content
    });
  }

  return interaction.reply({
    content,
    flags: MessageFlags.Ephemeral
  });
}

async function handleApplicationSelect(
  interaction
) {
  const formId =
    Number(interaction.values?.[0]);

  const form =
    getFormById(
      interaction.guild.id,
      formId
    );

  if (!form || !form.enabled) {
    return replyHidden(
      interaction,
      'That application is not available.'
    );
  }

  const questions =
    getQuestions(form.id);

  if (!questions.length) {
    return replyHidden(
      interaction,
      'That application does not have any questions yet.'
    );
  }

  const modal =
    new ModalBuilder()
      .setCustomId(`application_modal_${form.id}`)
      .setTitle(form.name.slice(0, 45));

  for (const question of questions) {
    const input =
      new TextInputBuilder()
        .setCustomId(`q_${question.id}`)
        .setLabel(`Question ${question.position}`)
        .setPlaceholder(question.question.slice(0, 100))
        .setStyle(TextInputStyle.Paragraph)
        .setMinLength(question.required ? 1 : 0)
        .setMaxLength(1000)
        .setRequired(Boolean(question.required));

    modal.addComponents(
      new ActionRowBuilder()
        .addComponents(input)
    );
  }

  return interaction.showModal(modal);
}

async function handleApplicationModal(
  interaction
) {
  const formId =
    Number(
      interaction.customId.replace(
        'application_modal_',
        ''
      )
    );

  const form =
    getFormById(
      interaction.guild.id,
      formId
    );

  if (!form || !form.enabled) {
    return replyHidden(
      interaction,
      'That application is not available.'
    );
  }

  const questions =
    getQuestions(form.id);

  if (!questions.length) {
    return replyHidden(
      interaction,
      'That application does not have any questions yet.'
    );
  }

  const answers =
    questions.map(question => {
      const answer =
        cleanAnswer(
          interaction.fields.getTextInputValue(
            `q_${question.id}`
          )
        );

      return {
        questionId: question.id,
        question: question.question,
        required: Boolean(question.required),
        answer
      };
    });

  const missing =
    answers.find(item =>
      item.required &&
      !item.answer
    );

  if (missing) {
    return replyHidden(
      interaction,
      'Please answer every required question.'
    );
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral
  });

  try {
    const result =
      await createTicket({
        interaction,
        type: 'application',
        reason: form.name,
        application: {
          form,
          answers
        }
      });

    return interaction.editReply({
      content:
        `Application ticket created: ${result.channel}`
    });

  } catch (err) {
    return interaction.editReply({
      content:
        err.message ||
        'Failed to create application ticket.'
    });
  }
}

module.exports = {
  name: 'interactionCreate',

  async execute(interaction) {
    try {
      if (
        interaction.isStringSelectMenu() &&
        interaction.customId === 'application_select'
      ) {
        return handleApplicationSelect(interaction);
      }

      if (
        interaction.isModalSubmit() &&
        interaction.customId.startsWith('application_modal_')
      ) {
        return handleApplicationModal(interaction);
      }

      return null;

    } catch (err) {
      if (!isStaleInteractionError(err)) {
        console.error(
          'Application Ticket Error:',
          err
        );
      }

      return replyHidden(
        interaction,
        'Application ticket system error.'
      ).catch(() => null);
    }
  }
};
