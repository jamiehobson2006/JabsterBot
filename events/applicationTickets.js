const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const {
  QUESTIONS_PER_MODAL,
  createDraft,
  deleteDraft,
  getDraft,
  getFormById,
  getQuestions,
  saveDraft
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

function getDraftId(customId, prefix) {
  const id =
    String(customId || '').slice(prefix.length);

  return /^[a-f0-9-]{36}$/i.test(id)
    ? id
    : null;
}

async function replyHidden(interaction, content, components = []) {
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply({
      content,
      components
    });
  }

  return interaction.reply({
    content,
    components,
    flags: MessageFlags.Ephemeral
  });
}

function getDraftContext(interaction, draftId) {
  const draft =
    getDraft(draftId);

  if (
    !draft ||
    draft.guildId !== interaction.guild.id ||
    draft.userId !== interaction.user.id
  ) {
    return null;
  }

  const form =
    getFormById(interaction.guild.id, draft.formId);

  if (!form || !form.enabled) {
    return null;
  }

  const questions =
    getQuestions(form.id);

  return {
    draft,
    form,
    questions
  };
}

async function showApplicationPage(interaction, draftId) {
  const context =
    getDraftContext(interaction, draftId);

  if (!context) {
    return replyHidden(
      interaction,
      'This application session has expired. Please start again.'
    );
  }

  const {
    draft,
    form,
    questions
  } = context;

  const start =
    Number(draft.nextQuestionIndex || 0);

  const pageQuestions =
    questions.slice(
      start,
      start + QUESTIONS_PER_MODAL
    );

  if (!pageQuestions.length) {
    return replyHidden(
      interaction,
      'This application has no remaining questions.'
    );
  }

  const pageNumber =
    Math.floor(start / QUESTIONS_PER_MODAL) + 1;

  const pageCount =
    Math.ceil(questions.length / QUESTIONS_PER_MODAL);

  const modal =
    new ModalBuilder()
      .setCustomId(`application_page_${draft.id}`)
      .setTitle(
        `${form.name} (${pageNumber}/${pageCount})`.slice(0, 45)
      );

  for (const question of pageQuestions) {
    const label =
      `${question.position}. ${question.question}`
        .slice(0, 45);

    const input =
      new TextInputBuilder()
        .setCustomId(`q_${question.id}`)
        .setLabel(label || `Question ${question.position}`)
        .setPlaceholder(
          question.required
            ? 'Your answer is required'
            : 'Optional answer'
        )
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(1000)
        .setRequired(Boolean(question.required));

    modal.addComponents(
      new ActionRowBuilder()
        .addComponents(input)
    );
  }

  return interaction.showModal(modal);
}

async function handleApplicationSelect(interaction) {
  const formId =
    Number(interaction.values?.[0]);

  const form =
    getFormById(interaction.guild.id, formId);

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

  const draft =
    createDraft({
      guildId: interaction.guild.id,
      formId: form.id,
      userId: interaction.user.id
    });

  return showApplicationPage(interaction, draft.id);
}

async function handleApplicationPage(interaction) {
  const draftId =
    getDraftId(
      interaction.customId,
      'application_page_'
    );

  if (!draftId) {
    return replyHidden(
      interaction,
      'This application session is invalid.'
    );
  }

  const context =
    getDraftContext(interaction, draftId);

  if (!context) {
    return replyHidden(
      interaction,
      'This application session has expired. Please start again.'
    );
  }

  const {
    draft,
    form,
    questions
  } = context;

  const start =
    Number(draft.nextQuestionIndex || 0);

  const pageQuestions =
    questions.slice(
      start,
      start + QUESTIONS_PER_MODAL
    );

  const pageAnswers =
    pageQuestions.map(question => ({
      questionId: question.id,
      question: question.question,
      required: Boolean(question.required),
      answer: cleanAnswer(
        interaction.fields.getTextInputValue(`q_${question.id}`)
      )
    }));

  const missing =
    pageAnswers.find(answer =>
      answer.required && !answer.answer
    );

  if (missing) {
    return replyHidden(
      interaction,
      'Please answer every required question.'
    );
  }

  const answeredIds =
    new Set(pageAnswers.map(answer => answer.questionId));

  const answers = [
    ...draft.answers.filter(answer =>
      !answeredIds.has(answer.questionId)
    ),
    ...pageAnswers
  ];

  const nextQuestionIndex =
    start + pageQuestions.length;

  saveDraft({
    id: draft.id,
    answers,
    nextQuestionIndex
  });

  if (nextQuestionIndex < questions.length) {
    const button =
      new ButtonBuilder()
        .setCustomId(`application_continue_${draft.id}`)
        .setLabel(
          `Continue (${nextQuestionIndex}/${questions.length})`
        )
        .setStyle(ButtonStyle.Primary);

    return replyHidden(
      interaction,
      'Your answers were saved. Continue when you are ready.',
      [
        new ActionRowBuilder()
          .addComponents(button)
      ]
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

    deleteDraft(draft.id);

    return interaction.editReply({
      content: `Application ticket created: ${result.channel}`
    });

  } catch (err) {
    return interaction.editReply({
      content:
        err.message ||
        'Failed to create application ticket.'
    });
  }
}

async function handleApplicationContinue(interaction) {
  const draftId =
    getDraftId(
      interaction.customId,
      'application_continue_'
    );

  if (!draftId) {
    return replyHidden(
      interaction,
      'This application session is invalid.'
    );
  }

  return showApplicationPage(interaction, draftId);
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
        interaction.isButton() &&
        interaction.customId.startsWith('application_continue_')
      ) {
        return handleApplicationContinue(interaction);
      }

      if (
        interaction.isModalSubmit() &&
        interaction.customId.startsWith('application_page_')
      ) {
        return handleApplicationPage(interaction);
      }

      return null;

    } catch (err) {
      if (!isStaleInteractionError(err)) {
        console.error('Application Ticket Error:', err);
      }

      return replyHidden(
        interaction,
        'Application ticket system error.'
      ).catch(() => null);
    }
  }
};
