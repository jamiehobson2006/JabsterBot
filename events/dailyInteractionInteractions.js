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
  run
} = require('../database');

const {
  getDailyInteractionConfig,
  getDateParts,
  getOrCreateDiscussionThread,
  recordMemberEngagement
} = require('../services/DailyInteractionService');

const RESPONSE_MODAL_PREFIX = 'dailyinteraction_answer_';

function isDailyInteractionButton(interaction) {
  return interaction.isButton() && [
    'dailyinteraction_join',
    'dailyinteraction_answer',
    'dailyinteraction_discuss'
  ].includes(interaction.customId);
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

async function updateParticipantCount(message, count) {
  const original = message.embeds?.[0];
  if (!original) return;

  const embed = EmbedBuilder.from(original);
  const fields = (embed.data.fields || []).map(field =>
    field.name === 'Participants'
      ? { ...field, value: String(count) }
      : field
  );

  embed.setFields(fields);
  await message.edit({ embeds: [embed] });
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

function responseModal(messageId) {
  const input = new TextInputBuilder()
    .setCustomId('response')
    .setLabel('Your answer')
    .setPlaceholder('Share your answer with the community...')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(1800)
    .setRequired(true);

  return new ModalBuilder()
    .setCustomId(`${RESPONSE_MODAL_PREFIX}${messageId}`)
    .setTitle('Daily Interaction Answer')
    .addComponents(new ActionRowBuilder().addComponents(input));
}

async function fetchPostMessage(interaction, post) {
  const channel = await interaction.guild.channels.fetch(post.channelId).catch(() => null);
  if (!channel?.isTextBased()) return null;
  return channel.messages.fetch(post.messageId).catch(() => null);
}

async function handleJoin(interaction, post) {
  const joined = addParticipant(post, interaction.user.id);
  const config = getDailyInteractionConfig(interaction.guild.id);

  if (joined.changes) {
    recordMemberEngagement({
      guildId: interaction.guild.id,
      userId: interaction.user.id,
      dateKey: getInteractionDateKey(config),
      joined: true
    });

    await updateParticipantCount(interaction.message, participantCount(post.messageId))
      .catch(err => console.error('Daily interaction participant count update error:', err.message));
  }

  return interaction.reply({
    content: joined.changes
      ? 'You are in. Use **Submit Answer** to share your response.'
      : 'You have already joined this daily interaction.',
    flags: MessageFlags.Ephemeral
  });
}

async function handleDiscussion(interaction, post) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const thread = await getOrCreateDiscussionThread({
    guild: interaction.guild,
    message: interaction.message,
    post,
    openedBy: interaction.user.tag
  });

  return interaction.editReply({ content: `Discussion: ${thread}` });
}

async function handleAnswerModal(interaction) {
  const messageId = interaction.customId.slice(RESPONSE_MODAL_PREFIX.length);
  const post = getPost(interaction.guild.id, messageId);

  if (!post) {
    return interaction.reply({
      content: 'This daily interaction is no longer active.',
      flags: MessageFlags.Ephemeral
    });
  }

  const answer = interaction.fields.getTextInputValue('response').trim();
  if (!answer) {
    return interaction.reply({
      content: 'Your answer cannot be empty.',
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const sourceMessage = await fetchPostMessage(interaction, post);
  if (!sourceMessage) {
    return interaction.editReply({ content: 'I could not find the original daily interaction message.' });
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
  const threadContent = `**${interaction.user}'s answer**\n${answer}`;
  let threadMessageId = previous?.threadMessageId || null;

  if (threadMessageId) {
    const previousMessage = await thread.messages.fetch(threadMessageId).catch(() => null);
    if (previousMessage) {
      await previousMessage.edit({
        content: threadContent,
        allowedMentions: { parse: [] }
      });
    } else {
      threadMessageId = null;
    }
  }

  if (!threadMessageId) {
    const responseMessage = await thread.send({
      content: threadContent,
      allowedMentions: { parse: [] }
    });
    threadMessageId = responseMessage.id;
  }

  run(
    `INSERT INTO daily_interaction_responses (
       messageId, userId, response, submittedAt, threadMessageId
     )
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(messageId, userId)
     DO UPDATE SET response = excluded.response,
                   submittedAt = excluded.submittedAt,
                   threadMessageId = excluded.threadMessageId`,
    [post.messageId, interaction.user.id, answer, Date.now(), threadMessageId]
  );

  const joined = addParticipant(post, interaction.user.id);
  const config = getDailyInteractionConfig(interaction.guild.id);
  recordMemberEngagement({
    guildId: interaction.guild.id,
    userId: interaction.user.id,
    dateKey: getInteractionDateKey(config),
    joined: Boolean(joined.changes),
    responded: !previous
  });

  if (joined.changes) {
    await updateParticipantCount(sourceMessage, participantCount(post.messageId))
      .catch(err => console.error('Daily interaction participant count update error:', err.message));
  }

  return interaction.editReply({
    content: previous
      ? `Your answer was updated in ${thread}.`
      : `Your answer was posted in ${thread}.`
  });
}

module.exports = {
  name: 'interactionCreate',

  async execute(interaction) {
    if (!interaction.inGuild?.()) return;

    const isButton = isDailyInteractionButton(interaction);
    const isResponseModal = isDailyInteractionResponseModal(interaction);
    if (!isButton && !isResponseModal) return;

    try {
      if (isResponseModal) {
        return handleAnswerModal(interaction);
      }

      const post = getPost(interaction.guild.id, interaction.message?.id);
      if (!post) {
        return interaction.reply({
          content: 'This daily interaction is no longer active.',
          flags: MessageFlags.Ephemeral
        });
      }

      if (interaction.customId === 'dailyinteraction_join') {
        return handleJoin(interaction, post);
      }

      if (interaction.customId === 'dailyinteraction_answer') {
        return interaction.showModal(responseModal(post.messageId));
      }

      return handleDiscussion(interaction, post);
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
