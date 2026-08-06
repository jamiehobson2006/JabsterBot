const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
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
  return error?.code === 10062 || error?.code === 40060 || error?.code === 10015;
}

function cleanAnswer(answer) {
  return String(answer || '')
    .replace(/@everyone|@here/g, '[mention removed]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000);
}

function getDraftId(customId, prefix) {
  const id = String(customId || '').slice(prefix.length);
  return /^[a-f0-9-]{36}$/i.test(id) ? id : null;
}

function isDirectMessage(interaction) {
  return !interaction.guild;
}

async function replyPrivate(interaction, content, components = []) {
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply({ content, components });
  }

  const payload = { content, components };
  if (!isDirectMessage(interaction)) {
    payload.flags = MessageFlags.Ephemeral;
  }

  return interaction.reply(payload);
}

function getDraftContext(interaction, draftId) {
  const draft = getDraft(draftId);

  if (!draft || draft.userId !== interaction.user.id) {
    return null;
  }

  if (interaction.guild && draft.guildId !== interaction.guild.id) {
    return null;
  }

  const form = getFormById(draft.guildId, draft.formId);
  if (!form || !form.enabled) return null;

  return {
    draft,
    form,
    questions: getQuestions(form.id)
  };
}

function buildApplicationPreview(form, questions, pageNumber, pageCount) {
  const questionList = questions
    .map(question => [
      `**${question.position}. ${question.question}**`,
      question.required ? 'Required' : 'Optional'
    ].join('\n'))
    .join('\n\n');

  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`Jabster Studios | ${form.name}`)
    .setDescription([
      form.description || 'Please answer each question carefully.',
      '**Application Questions**',
      questionList
    ].join('\n\n'))
    .addFields(
      { name: 'Question', value: `${pageNumber} of ${pageCount}`, inline: true },
      { name: 'Response', value: questions[0].required ? 'Required' : 'Optional', inline: true }
    )
    .setFooter({ text: 'Select Answer question when you are ready.' });
}

function modalQuestionLabel() {
  return 'Your response';
}

async function showApplicationPreview(interaction, draftId) {
  const context = getDraftContext(interaction, draftId);
  if (!context) {
    return replyPrivate(interaction, 'This application session has expired. Please start again from the ticket panel.');
  }

  const { draft, form, questions } = context;
  const start = Number(draft.nextQuestionIndex || 0);
  const pageQuestions = questions.slice(start, start + QUESTIONS_PER_MODAL);

  if (!pageQuestions.length) {
    return replyPrivate(interaction, 'This application has no remaining questions.');
  }

  const pageNumber = Math.floor(start / QUESTIONS_PER_MODAL) + 1;
  const pageCount = Math.ceil(questions.length / QUESTIONS_PER_MODAL);
  const answerButton = new ButtonBuilder()
    .setCustomId(`application_open_${draft.id}`)
    .setLabel(`Answer question ${pageNumber}`)
    .setStyle(ButtonStyle.Primary);

  return interaction.update({
    content: null,
    embeds: [buildApplicationPreview(form, pageQuestions, pageNumber, pageCount)],
    components: [new ActionRowBuilder().addComponents(answerButton)]
  });
}

async function showApplicationModal(interaction, draftId) {
  const context = getDraftContext(interaction, draftId);
  if (!context) {
    return replyPrivate(interaction, 'This application session has expired. Please start again from the ticket panel.');
  }

  const { draft, questions } = context;
  const start = Number(draft.nextQuestionIndex || 0);
  const pageQuestions = questions.slice(start, start + QUESTIONS_PER_MODAL);

  if (!pageQuestions.length) {
    return replyPrivate(interaction, 'This application has no remaining questions.');
  }

  const pageNumber = Math.floor(start / QUESTIONS_PER_MODAL) + 1;
  const pageCount = Math.ceil(questions.length / QUESTIONS_PER_MODAL);
  const modal = new ModalBuilder()
    .setCustomId(`application_page_${draft.id}`)
    .setTitle(`Question ${pageNumber} of ${pageCount}`);

  for (const question of pageQuestions) {
    const input = new TextInputBuilder()
      .setCustomId(`q_${question.id}`)
      .setLabel(modalQuestionLabel())
      .setPlaceholder(question.required ? 'Write your answer here' : 'Optional answer')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(1000)
      .setRequired(Boolean(question.required));

    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }

  return interaction.showModal(modal);
}

async function handleApplicationSelect(interaction) {
  if (!interaction.guild) {
    return replyPrivate(interaction, 'Applications must be started from the server ticket panel.');
  }

  const formId = Number(interaction.values?.[0]);
  const form = getFormById(interaction.guild.id, formId);

  if (!form || !form.enabled) {
    return replyPrivate(interaction, 'That application is not available.');
  }

  const questions = getQuestions(form.id);
  if (!questions.length) {
    return replyPrivate(interaction, 'That application does not have any questions yet.');
  }

  const draft = createDraft({
    guildId: interaction.guild.id,
    formId: form.id,
    userId: interaction.user.id
  });

  const startButton = new ButtonBuilder()
    .setCustomId(`application_start_${draft.id}`)
    .setLabel('View first question')
    .setStyle(ButtonStyle.Primary);

  try {
    await interaction.user.send({
      embeds: [new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`Jabster Studios | ${form.name}`)
        .setDescription(form.description || 'Review each page carefully before submitting your answers.')
        .addFields(
          { name: 'Server', value: interaction.guild.name, inline: true },
          { name: 'Questions', value: String(questions.length), inline: true }
        )
        .setFooter({ text: 'This application expires after 30 minutes of inactivity.' })],
      components: [new ActionRowBuilder().addComponents(startButton)]
    });
  } catch {
    deleteDraft(draft.id);
    return replyPrivate(interaction, 'I could not send you a DM. Please enable direct messages from this server and try again.');
  }

  return replyPrivate(interaction, 'I sent you a DM. Complete the application there; a ticket will be created only after you submit every answer.');
}

async function handleApplicationStart(interaction) {
  if (!isDirectMessage(interaction)) {
    return replyPrivate(interaction, 'Please complete this application in my DMs.');
  }

  const draftId = getDraftId(interaction.customId, 'application_start_');
  if (!draftId) return replyPrivate(interaction, 'This application session is invalid.');

  return showApplicationPreview(interaction, draftId);
}

async function handleApplicationOpen(interaction) {
  if (!isDirectMessage(interaction)) {
    return replyPrivate(interaction, 'Please complete this application in my DMs.');
  }

  const draftId = getDraftId(interaction.customId, 'application_open_');
  if (!draftId) return replyPrivate(interaction, 'This application session is invalid.');

  return showApplicationModal(interaction, draftId);
}

async function handleApplicationPage(interaction) {
  if (!isDirectMessage(interaction)) {
    return replyPrivate(interaction, 'Please complete this application in my DMs.');
  }

  const draftId = getDraftId(interaction.customId, 'application_page_');
  if (!draftId) return replyPrivate(interaction, 'This application session is invalid.');

  const context = getDraftContext(interaction, draftId);
  if (!context) {
    return replyPrivate(interaction, 'This application session has expired. Please start again from the ticket panel.');
  }

  const { draft, form, questions } = context;
  const start = Number(draft.nextQuestionIndex || 0);
  const pageQuestions = questions.slice(start, start + QUESTIONS_PER_MODAL);
  const pageAnswers = pageQuestions.map(question => ({
    questionId: question.id,
    question: question.question,
    required: Boolean(question.required),
    answer: cleanAnswer(interaction.fields.getTextInputValue(`q_${question.id}`))
  }));

  const missing = pageAnswers.find(answer => answer.required && !answer.answer);
  if (missing) return replyPrivate(interaction, 'Please answer every required question.');

  const answeredIds = new Set(pageAnswers.map(answer => answer.questionId));
  const answers = [
    ...draft.answers.filter(answer => !answeredIds.has(answer.questionId)),
    ...pageAnswers
  ];
  const nextQuestionIndex = start + pageQuestions.length;

  saveDraft({ id: draft.id, answers, nextQuestionIndex });

  if (nextQuestionIndex < questions.length) {
    const button = new ButtonBuilder()
      .setCustomId(`application_continue_${draft.id}`)
      .setLabel(`View question ${nextQuestionIndex + 1} of ${questions.length}`)
      .setStyle(ButtonStyle.Primary);

    return replyPrivate(
      interaction,
      'Your answers were saved. Continue when you are ready.',
      [new ActionRowBuilder().addComponents(button)]
    );
  }

  await interaction.deferReply();

  try {
    const guild = await interaction.client.guilds.fetch(draft.guildId).catch(() => null);
    if (!guild) throw new Error('That server is no longer available.');

    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) throw new Error('You are no longer a member of that server.');

    const result = await createTicket({
      interaction: {
        client: interaction.client,
        guild,
        user: interaction.user
      },
      type: 'application',
      reason: form.name,
      application: { form, answers }
    });

    deleteDraft(draft.id);
    return interaction.editReply({ content: `Your application has been submitted: ${result.channel}` });
  } catch (err) {
    return interaction.editReply({
      content: err.message || 'Failed to create your application ticket. Your answers are saved; please start the application again from the ticket panel.'
    });
  }
}

async function handleApplicationContinue(interaction) {
  if (!isDirectMessage(interaction)) {
    return replyPrivate(interaction, 'Please complete this application in my DMs.');
  }

  const draftId = getDraftId(interaction.customId, 'application_continue_');
  if (!draftId) return replyPrivate(interaction, 'This application session is invalid.');

  return showApplicationPreview(interaction, draftId);
}

module.exports = {
  name: 'interactionCreate',

  buildApplicationPreview,
  modalQuestionLabel,

  async execute(interaction) {
    try {
      if (interaction.isStringSelectMenu() && interaction.customId === 'application_select') {
        return handleApplicationSelect(interaction);
      }

      if (interaction.isButton() && interaction.customId.startsWith('application_start_')) {
        return handleApplicationStart(interaction);
      }

      if (interaction.isButton() && interaction.customId.startsWith('application_open_')) {
        return handleApplicationOpen(interaction);
      }

      if (interaction.isButton() && interaction.customId.startsWith('application_continue_')) {
        return handleApplicationContinue(interaction);
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith('application_page_')) {
        return handleApplicationPage(interaction);
      }

      return null;
    } catch (err) {
      if (!isStaleInteractionError(err)) {
        console.error('Application Ticket Error:', err);
      }

      return replyPrivate(interaction, 'Application ticket system error.').catch(() => null);
    }
  }
};
