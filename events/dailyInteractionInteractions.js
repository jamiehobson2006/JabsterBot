const {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const {
  get,
  run,
  transaction
} = require('../database');
const { attemptDailyDelivery, newDailyKey, queueDailyDelivery } = require('../utils/dailyDelivery');
const { activityFor, activityOpen, gameState, submitTrivia, validateGameTurn } = require('../utils/dailyActivities');
const { fetchDailyMessage, withDailyDisplayLock } = require('../utils/dailyDisplay');

const {
  getDailyInteractionConfig,
  ANSWER_PERMISSIONS,
  getDateParts,
  getOrCreateDiscussionThread,
  isDailyInteractionOpen,
  recordMemberEngagement
} = require('../services/DailyInteractionService');

const {
  listCensorTerms
} = require('../utils/censor');

const {
  MAX_GAME_RESPONSE_LENGTH,
  MAX_RESPONSE_LENGTH,
  answerInstruction,
  supportsSubmittedAnswer,
  validateDailyInteractionContent,
  validateDailyInteractionAnswer
} = require('../utils/dailyInteractionSafety');

const RESPONSE_MODAL_PREFIX = 'dailyinteraction_answer_';
const responseSubmissionLocks = new Map();

function isDailyInteractionButton(interaction) {
  return interaction.isButton() && [
    'dailyinteraction_join',
    'dailyinteraction_answer',
    'dailyinteraction_discuss'
  ].includes(interaction.customId) || interaction.isButton() && /^dailyinteraction_choice_\d+$/.test(interaction.customId);
}

function isDailyInteractionResponseModal(interaction) {
  return interaction.isModalSubmit() &&
    interaction.customId.startsWith(RESPONSE_MODAL_PREFIX);
}

function getPost(guildId, messageId) {
  if (!messageId) return null;

  return get(
    `SELECT *
     FROM daily_interaction_posts
     WHERE messageId = ?
     AND guildId = ?`,
    [messageId, guildId]
  );
}

function getInteractionDateKey(config) {
  return getDateParts(
    new Date(),
    config?.timezone
  ).dateKey;
}

function hasAnswerButton(message) {
  return message?.components?.some(row =>
    row.components?.some(component => component.customId === 'dailyinteraction_answer')
  );
}

async function updateParticipantCount(message, count) {
  return withDailyDisplayLock(message.id, async () => {
    const latest = message.channel?.messages ? await fetchDailyMessage(message.channel, message.id) : message;
    count = participantCount(message.id);
    const original = latest.embeds?.[0];
    if (!original) return;

    const embed = EmbedBuilder.from(original);
    const fields = (embed.data.fields || []).map(field =>
      field.name === 'Participants'
        ? { ...field, value: String(count) }
        : field
    );

    embed.setFields(fields);
    await latest.edit({ embeds: [embed] });
    run('UPDATE daily_interaction_posts SET displayedParticipantCount = ? WHERE messageId = ?', [count, message.id]);
  });
}

function participantCount(messageId) {
  return get(
    `SELECT COUNT(*) AS count
     FROM daily_interaction_participants
     WHERE messageId = ?`,
    [messageId]
  ).count;
}

function addParticipant(post, userId) {
  return run(
    `INSERT OR IGNORE INTO daily_interaction_participants (
       messageId, userId, joinedAt
     )
     VALUES (?, ?, ?)`,
    [post.messageId, userId, Date.now()]
  );
}

function responseModal(post) {
  const maxLength = String(post?.type || '').toUpperCase() === 'GAME'
    ? MAX_GAME_RESPONSE_LENGTH
    : MAX_RESPONSE_LENGTH;
  const input = new TextInputBuilder()
    .setCustomId('response')
    .setLabel('Your verified answer')
    .setPlaceholder(answerInstruction(post))
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(maxLength)
    .setRequired(true);

  return new ModalBuilder()
    .setCustomId(`${RESPONSE_MODAL_PREFIX}${post.messageId}`)
    .setTitle('Daily Interaction Answer')
    .addComponents(new ActionRowBuilder().addComponents(input));
}

async function fetchPostMessage(interaction, post) {
  const channel = await interaction.guild.channels.fetch(post.channelId).catch(() => null);
  if (!channel?.isTextBased()) return null;
  return fetchDailyMessage(channel, post.messageId).catch(() => null);
}

async function handleJoin(interaction, post) {
  if (!isDailyInteractionOpen(post) || !activityOpen(post)) {
    return interaction.editReply({ content: 'This daily interaction has closed.' });
  }

  const config = getDailyInteractionConfig(interaction.guild.id);
  const joined = transaction(() => {
    const result = addParticipant(post, interaction.user.id);
    if (result.changes) recordMemberEngagement({
      guildId: interaction.guild.id,
      userId: interaction.user.id,
      dateKey: getInteractionDateKey(config),
      joined: true, messageId: post.messageId
    });
    return result;
  });

  if (joined.changes) {

    await updateParticipantCount(interaction.message, participantCount(post.messageId))
      .catch(err => console.error('Daily interaction participant count update error:', err.message));
  }

  return interaction.editReply({
    content: joined.changes
      ? hasAnswerButton(interaction.message)
        ? 'You are in. Use **Submit Answer** to share your response.'
        : activityFor(post)?.mode === 'choice' ? 'You are in. Choose an option on the activity message.'
        : 'You are in. This activity counts participation only.'
      : 'You have already joined this daily interaction.',
  });
}

async function handleDiscussion(interaction, post) {
  return interaction.reply({
    content: 'Daily interaction discussions are read-only. Use Submit Answer for supported activities.',
    flags: MessageFlags.Ephemeral
  });
}

function withResponseSubmissionLock(key, operation) {
  const previous = responseSubmissionLocks.get(key) || Promise.resolve();
  const current = previous
    .catch(() => null)
    .then(operation);

  responseSubmissionLocks.set(key, current);

  return current.finally(() => {
    if (responseSubmissionLocks.get(key) === current) {
      responseSubmissionLocks.delete(key);
    }
  });
}

async function processAnswerModal(interaction, messageId, chosenIndex = null) {
  const post = getPost(interaction.guild.id, messageId);

  if (!post) {
    return interaction.editReply({ content: 'This daily interaction is no longer active.' });
  }

  if (!isDailyInteractionOpen(post) || !activityOpen(post)) {
    return interaction.editReply({ content: 'This daily interaction has closed.' });
  }
  const config = getDailyInteractionConfig(interaction.guild.id);
  if (Number(config?.discussionEnabled) !== 1) {
    return interaction.editReply({ content: 'Answer submission is disabled for this server.' });
  }
  const activity = activityFor(post);
  const multiTurn = ['chain', 'story'].includes(activity?.mode);
  if (multiTurn && get(`SELECT 1 FROM delivery_outbox WHERE type = 'DAILY_INTERACTION_RESPONSE'
      AND status IN ('PENDING', 'FAILED', 'PROCESSING') AND json_extract(payload, '$.daily.postId') = ?`, [post.messageId])) {
    return interaction.editReply({ content: 'The previous turn is still being delivered. Please wait before taking the next turn.' });
  }
  const pending = get(`SELECT deliveryKey FROM delivery_outbox WHERE guildId = ?
    AND type = 'DAILY_INTERACTION_RESPONSE' AND status IN ('PENDING', 'FAILED', 'PROCESSING')
    AND json_extract(payload, '$.daily.postId') = ? AND json_extract(payload, '$.daily.userId') = ?`,
  [interaction.guild.id, post.messageId, interaction.user.id]);
  if (pending) return interaction.editReply({ content: 'Your previous answer is queued for delivery. Please wait before updating it.' });

  if (chosenIndex !== null && (activity?.mode !== 'choice' || !Number.isInteger(chosenIndex) || !activity.choices[chosenIndex])) {
    return interaction.editReply({ content: 'That choice is no longer available.' });
  }
  const submittedAnswer = chosenIndex !== null ? activity.choices[chosenIndex] : interaction.fields.getTextInputValue('response');
  const terms = listCensorTerms(interaction.guild.id);
  const validation = multiTurn ? validateGameTurn(post, interaction.user.id, submittedAnswer, terms)
    : activity?.mode === 'trivia' ? validateDailyInteractionContent({ answer: submittedAnswer, censorTerms: terms })
    : validateDailyInteractionAnswer({
    post,
    answer: submittedAnswer,
    // Responses are posted by the bot, so honor the server's terms even when
    // the normal message censor is disabled or has a channel exemption.
    censorTerms: listCensorTerms(interaction.guild.id)
  });

  if (!validation.valid) {
    return interaction.editReply({ content: validation.message });
  }

  const answer = validation.answer;

  const sourceMessage = await fetchPostMessage(interaction, post);
  if (!sourceMessage) {
    return interaction.editReply({ content: 'I could not find the original daily interaction message.' });
  }
  const botPermissions = sourceMessage.channel?.permissionsFor?.(interaction.guild.members.me);
  if (botPermissions && !botPermissions.has(ANSWER_PERMISSIONS)) {
    return interaction.editReply({ content: 'I need Create Public Threads, Send Messages in Threads, Manage Threads, and Manage Messages to publish and protect answers.' });
  }
  const memberPermissions = sourceMessage.channel?.permissionsFor?.(interaction.member);
  if (memberPermissions && !memberPermissions.has('ViewChannel')) {
    return interaction.editReply({ content: 'You no longer have access to this activity channel.' });
  }
  if (activity?.mode === 'trivia') {
    const result = submitTrivia(post, interaction.user.id, validation.answer, getInteractionDateKey(config));
    await updateParticipantCount(sourceMessage, participantCount(post.messageId)).catch(() => null);
    return interaction.editReply({ content: result.message });
  }

  const thread = await getOrCreateDiscussionThread({
    guild: interaction.guild,
    message: sourceMessage,
    post,
    openedBy: interaction.user.tag
  });
  const previous = get(
    `SELECT *
     FROM daily_interaction_responses
     WHERE messageId = ?
     AND userId = ?`,
    [post.messageId, interaction.user.id]
  );
  const threadContent = multiTurn ? `**Turn ${validation.gameVersion} | ${interaction.user}**\n${answer}`
    : `**${interaction.user}'s answer**\n${answer}`;
  const queued = queueDailyDelivery({ deliveryKey: newDailyKey(`daily-answer:${post.messageId}:${interaction.user.id}`),
    type: 'DAILY_INTERACTION_RESPONSE', guildId: interaction.guild.id, channelId: thread.id,
    message: { content: threadContent, allowedMentions: { parse: [] } },
    metadata: { postId: post.messageId, userId: interaction.user.id, answer,
      engagementDateKey: getInteractionDateKey(config), gameVersion: validation.gameVersion,
      editMessageId: multiTurn ? null : previous?.threadMessageId || null } });
  const delivered = await attemptDailyDelivery(interaction.client, queued).catch(error => {
    console.error('Daily interaction answer queued for retry:', error.message);
    return null;
  });
  if (delivered?.status === 'CANCELLED') return interaction.editReply({
    content: 'Your answer was not published because this activity closed, was locked, or its settings changed.' });
  if (delivered?.status !== 'SENT') return interaction.editReply({ content: 'Your answer is saved and queued for delivery.' });
  await updateParticipantCount(sourceMessage, participantCount(post.messageId))
    .catch(err => console.error('Daily interaction participant count update error:', err.message));
  if (activity) await require('../utils/dailyActivities').maintainActivities(interaction.client, Date.now(), post.messageId)
    .catch(error => console.error('Daily activity display refresh:', error.message));

  return interaction.editReply({
    content: multiTurn ? `Turn ${validation.gameVersion} added in ${thread}.` : previous
      ? `Your answer was updated in ${thread}.`
      : `Your answer was posted in ${thread}.`
  });
}

async function handleAnswerModal(interaction) {
  const messageId = interaction.customId.slice(RESPONSE_MODAL_PREFIX.length);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  return withResponseSubmissionLock(
    `${interaction.guild.id}:${messageId}`,
    () => processAnswerModal(interaction, messageId)
  );
}

module.exports = {
  name: 'interactionCreate',

  async execute(interaction) {
    if (!interaction.inGuild?.()) return;

    const isButton = isDailyInteractionButton(interaction);
    const isResponseModal = isDailyInteractionResponseModal(interaction);
    const isChoiceMenu = interaction.isStringSelectMenu?.() && interaction.customId === 'dailyinteraction_choice';
    if (!isButton && !isResponseModal && !isChoiceMenu) return;

    try {
      if (isResponseModal) {
        return await handleAnswerModal(interaction);
      }

      const post = getPost(interaction.guild.id, interaction.message?.id);
      if (!post) {
        return interaction.reply({
          content: 'This daily interaction is no longer active.',
          flags: MessageFlags.Ephemeral
        });
      }

      if (!isDailyInteractionOpen(post) || !activityOpen(post)) {
        return interaction.reply({
          content: 'This daily interaction has closed.',
          flags: MessageFlags.Ephemeral
        });
      }

      if (isChoiceMenu || /^dailyinteraction_choice_\d+$/.test(interaction.customId)) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const index = Number(isChoiceMenu ? interaction.values[0] : interaction.customId.split('_').at(-1));
        return await withResponseSubmissionLock(`${interaction.guild.id}:${post.messageId}`,
          () => processAnswerModal(interaction, post.messageId, index));
      }

      if (interaction.customId === 'dailyinteraction_join') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        return await withResponseSubmissionLock(`${interaction.guild.id}:${post.messageId}`,
          () => handleJoin(interaction, post));
      }

      if (interaction.customId === 'dailyinteraction_answer') {
        if (Number(getDailyInteractionConfig(interaction.guild.id)?.discussionEnabled) !== 1) {
          return await interaction.reply({ content: 'Answer submission is disabled for this server.', flags: MessageFlags.Ephemeral });
        }
        if (!supportsSubmittedAnswer(post)) {
          return interaction.reply({
            content: 'This activity tracks participation through Join In and does not accept text responses.',
            flags: MessageFlags.Ephemeral
          });
        }

        const activity = activityFor(post);
        if (activity?.mode === 'choice') return await interaction.reply({ content: 'Choose an option on the activity message.', flags: MessageFlags.Ephemeral });
        if (activity?.mode === 'chain') {
          const state = gameState(post);
          post.prompt = `Word chain: reply with a word beginning with the last letter of **${state.lastWord}**.`;
        }
        return await interaction.showModal(responseModal(post));
      }

      return await handleDiscussion(interaction, post);
    } catch (err) {
      console.error('Daily interaction action error:', err);

      const payload = {
        content: 'I could not complete that daily interaction action. Check my thread permissions.',
        flags: MessageFlags.Ephemeral
      };

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply(payload).catch(() => null);
      }

      return interaction.reply(payload).catch(() => null);
    }
  }
};
