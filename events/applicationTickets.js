const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextDisplayBuilder,
  LabelBuilder,
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
  saveDraft,
  setDraftMessage
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
    .slice(0, 250);
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
    questions: draft.questions
  };
}

function submitButton(draftId) {
  return new ActionRowBuilder().addComponents(new ButtonBuilder()
    .setCustomId(`application_submit_${draftId}`).setLabel('Submit application').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`application_back_${draftId}`).setLabel('Review / edit previous answer').setStyle(ButtonStyle.Secondary));
}

async function submitApplication(interaction, draftId) {
  if (!isDirectMessage(interaction)) return replyPrivate(interaction, 'Please submit this application in my DMs.');
  if (!interaction.deferred && !interaction.replied) await interaction.deferReply();
  return require('../utils/workLeases').withWorkLease(`application-submit:${draftId}`, async () => {
    const context = getDraftContext(interaction, draftId);
    if (!context) return replyPrivate(interaction, 'This application session has expired. Please start again.');
    const { draft, form, questions } = context;
    if (draft.submissionStatus === 'SUBMITTED') return replyPrivate(interaction, `Your application was already submitted: <#${draft.submissionChannelId}>`);
    const answersById = new Map(draft.answers.map(answer => [answer.questionId, answer]));
    if (!questions.length || questions.some(question => !answersById.has(question.id) ||
        question.required && !answersById.get(question.id)?.answer?.trim())) {
      return replyPrivate(interaction, 'Please complete every required question before submitting.');
    }
    const { run } = require('../database');
    run("UPDATE application_drafts SET submissionStatus='SUBMITTING' WHERE id=?", [draft.id]);
    try {
      const guild = await interaction.client.guilds.fetch(draft.guildId);
      const member = await guild.members.fetch(interaction.user.id);
      if (!member) throw new Error('You are no longer a member of that server.');
      const answers = questions.map(question => ({ ...answersById.get(question.id), question: question.question, required: Boolean(question.required) }));
      const result = await createTicket({ interaction: { client: interaction.client, guild, user: interaction.user },
        type: 'application', reason: form.name, application: { form, answers, draftId: draft.id } });
      run("UPDATE application_drafts SET submissionStatus='SUBMITTED',submissionChannelId=?,updatedAt=? WHERE id=?", [result.channel.id,Date.now(),draft.id]);
      return replyPrivate(interaction, `Your application has been submitted: ${result.channel}`);
    } catch (error) {
      run("UPDATE application_drafts SET submissionStatus='READY',updatedAt=? WHERE id=?", [Date.now(),draft.id]);
      return replyPrivate(interaction, `${error.message || 'I could not create the ticket.'} Your answers are saved. You can retry below.`, [submitButton(draft.id)]);
    }
  });
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
  if (['SUBMITTED','SUBMITTING'].includes(draft.submissionStatus)) return replyPrivate(interaction,'This application has already been submitted or is being submitted.');
  const start = Number(draft.nextQuestionIndex || 0);
  const pageQuestions = questions.slice(start, start + QUESTIONS_PER_MODAL);

  if (!pageQuestions.length) {
    return replyPrivate(interaction, draft.submissionStatus === 'SUBMITTED'
      ? `Your application was already submitted: <#${draft.submissionChannelId}>`
      : 'Your answers are saved and ready to submit.', draft.submissionStatus === 'SUBMITTED' ? [] : [submitButton(draft.id)]);
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
    components: [new ActionRowBuilder().addComponents(answerButton,...(start>0 ? [new ButtonBuilder()
      .setCustomId(`application_back_${draft.id}`).setLabel('Previous question').setStyle(ButtonStyle.Secondary)] : []))]
  });
}

async function showApplicationModal(interaction, draftId) {
  const context = getDraftContext(interaction, draftId);
  if (!context) {
    return replyPrivate(interaction, 'This application session has expired. Please start again from the ticket panel.');
  }

  const { draft, questions } = context;
  if (['SUBMITTED','SUBMITTING'].includes(draft.submissionStatus)) return replyPrivate(interaction,'This application is no longer editable.');
  const start = Number(draft.nextQuestionIndex || 0);
  const pageQuestions = questions.slice(start, start + QUESTIONS_PER_MODAL);

  if (!pageQuestions.length) {
    return replyPrivate(interaction, 'Your answers are ready to submit.', [submitButton(draft.id)]);
  }

  const pageNumber = Math.floor(start / QUESTIONS_PER_MODAL) + 1;
  const pageCount = Math.ceil(questions.length / QUESTIONS_PER_MODAL);
  const modal = new ModalBuilder()
    .setCustomId(`application_page_${draft.id}_${start}_${draft.questionVersion}`)
    .setTitle(`Question ${pageNumber} of ${pageCount}`);

  for (const question of pageQuestions) {
    const input = new TextInputBuilder()
      .setCustomId(`q_${question.id}`)
      .setPlaceholder(question.required ? 'Write your answer here' : 'Optional answer')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(250)
      .setRequired(Boolean(question.required));

    const saved = draft.answers.find(answer => answer.questionId === question.id)?.answer;
    if (saved) input.setValue(saved);
    let instructions = '';
    if (question.answerType === 'YES_NO') instructions = '\nAnswer Yes or No.';
    if (question.answerType === 'NUMBER') instructions = '\nEnter a number.';
    if (question.answerType === 'CHOICE') instructions = `\nChoose one: ${JSON.parse(question.choicesJson || '[]').join(' / ')}`;
    modal.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${question.question}**${instructions}`));
    modal.addLabelComponents(new LabelBuilder().setLabel(modalQuestionLabel()).setTextInputComponent(input));
  }

  return interaction.showModal(modal);
}

async function handleApplicationSelect(interaction) {
  if (!interaction.guild) {
    return replyPrivate(interaction, 'Applications must be started from the server ticket panel.');
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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
    .setLabel(draft.nextQuestionIndex > 0 ? 'Resume application' : 'View first question')
    .setStyle(ButtonStyle.Primary);

  try {
    const dmMessage = await interaction.user.send({
      embeds: [new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`Jabster Studios | ${form.name}`)
        .setDescription(
          (form.description || 'Review each page carefully before submitting your answers.') +
          (draft.nextQuestionIndex > 0
            ? `\n\nYour saved application is ready to resume from question ${draft.nextQuestionIndex + 1}.`
            : '')
        )
        .addFields(
          { name: 'Server', value: interaction.guild.name, inline: true },
          { name: 'Questions', value: String(questions.length), inline: true }
        )
        .setFooter({ text: 'This application expires after 30 minutes of inactivity.' })],
      components: [new ActionRowBuilder().addComponents(startButton)]
    });
    setDraftMessage(draft.id, dmMessage.id);
  } catch {
    if (!draft.resumed) deleteDraft(draft.id);
    return replyPrivate(interaction, 'I could not send you a DM. Please enable direct messages from this server and try again.');
  }

  return replyPrivate(
    interaction,
    draft.nextQuestionIndex > 0
      ? 'I sent you a DM with a button to resume your saved application.'
      : 'I sent you a DM. Complete the application there; a ticket will be created only after you submit every answer.'
  );
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

  const modalParts = interaction.customId.slice('application_page_'.length).split('_');
  const draftId = getDraftId(modalParts[0], '');
  if (!draftId) return replyPrivate(interaction, 'This application session is invalid.');

  const context = getDraftContext(interaction, draftId);
  if (!context) {
    return replyPrivate(interaction, 'This application session has expired. Please start again from the ticket panel.');
  }

  const { draft, form, questions } = context;
  const start = Number(draft.nextQuestionIndex || 0);
  if (['SUBMITTED','SUBMITTING'].includes(draft.submissionStatus) || modalParts.length !== 3 ||
      Number(modalParts[1]) !== start || Number(modalParts[2]) !== draft.questionVersion) {
    return replyPrivate(interaction,'This answer form is out of date. Use the latest application message to resume.');
  }
  const pageQuestions = questions.slice(start, start + QUESTIONS_PER_MODAL);
  const pageAnswers = pageQuestions.map(question => ({
    questionId: question.id,
    question: question.question,
    required: Boolean(question.required),
    answer: cleanAnswer(interaction.fields.getTextInputValue(`q_${question.id}`))
  }));

  const missing = pageAnswers.find(answer => answer.required && !answer.answer);
  if (missing) return replyPrivate(interaction, 'Please answer every required question.');
  for (const question of pageQuestions) {
    const answer = pageAnswers.find(value => value.questionId === question.id).answer;
    if (!answer && !question.required) continue;
    if (question.answerType === 'YES_NO' && !/^(yes|no)$/i.test(answer)) return replyPrivate(interaction,'Please answer Yes or No. Your previous answers are saved.');
    if (question.answerType === 'NUMBER' && (!/^-?\d+(\.\d+)?$/.test(answer) || !Number.isFinite(Number(answer)))) return replyPrivate(interaction,'Please enter a valid number.');
    if (question.answerType === 'CHOICE' && !JSON.parse(question.choicesJson || '[]').some(value => value.toLowerCase() === answer.toLowerCase())) return replyPrivate(interaction,'Please use one of the listed choices.');
  }

  const answeredIds = new Set(pageAnswers.map(answer => answer.questionId));
  const answers = [
    ...draft.answers.filter(answer => !answeredIds.has(answer.questionId)),
    ...pageAnswers
  ];
  const nextQuestionIndex = start + pageQuestions.length;

  saveDraft({ id: draft.id, answers, nextQuestionIndex, expectedVersion:draft.questionVersion });

  if (nextQuestionIndex < questions.length) {
    const button = new ButtonBuilder()
      .setCustomId(`application_continue_${draft.id}`)
      .setLabel(`View question ${nextQuestionIndex + 1} of ${questions.length}`)
      .setStyle(ButtonStyle.Primary);

    return replyPrivate(
      interaction,
      'Your answers were saved. Continue when you are ready.',
      [new ActionRowBuilder().addComponents(button,new ButtonBuilder().setCustomId(`application_back_${draft.id}`).setLabel('Edit previous answer').setStyle(ButtonStyle.Secondary))]
    );
  }

  require('../database').run("UPDATE application_drafts SET submissionStatus='READY' WHERE id=?", [draft.id]);
  return replyPrivate(interaction,'Every answer is saved. You can submit now or review and edit your answers.',[submitButton(draft.id)]);
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
  cleanAnswer,
  modalQuestionLabel,
  submitApplication,

  async execute(interaction) {
    try {
      if (interaction.isButton() && interaction.customId.startsWith('application_back_')) {
        if (!isDirectMessage(interaction)) return replyPrivate(interaction,'Please edit this application in my DMs.');
        const draftId=getDraftId(interaction.customId,'application_back_');
        const context=getDraftContext(interaction,draftId);
        if (!context || ['SUBMITTED','SUBMITTING'].includes(context.draft.submissionStatus)) return replyPrivate(interaction,'This application is no longer editable.');
        saveDraft({id:draftId,answers:context.draft.answers,nextQuestionIndex:Math.max(0,context.draft.nextQuestionIndex-1),expectedVersion:context.draft.questionVersion});
        return await showApplicationPreview(interaction,draftId);
      }
      if (interaction.isButton() && interaction.customId.startsWith('application_submit_')) {
        const draftId = getDraftId(interaction.customId, 'application_submit_');
        if (!draftId) return replyPrivate(interaction, 'This application session is invalid.');
        return await submitApplication(interaction, draftId);
      }
      if (interaction.isStringSelectMenu() && interaction.customId === 'application_select') {
        return await handleApplicationSelect(interaction);
      }

      if (interaction.isButton() && interaction.customId.startsWith('application_start_')) {
        return await handleApplicationStart(interaction);
      }

      if (interaction.isButton() && interaction.customId.startsWith('application_open_')) {
        return await handleApplicationOpen(interaction);
      }

      if (interaction.isButton() && interaction.customId.startsWith('application_continue_')) {
        return await handleApplicationContinue(interaction);
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith('application_page_')) {
        return await handleApplicationPage(interaction);
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
