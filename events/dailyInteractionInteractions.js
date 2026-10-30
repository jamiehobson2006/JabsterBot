const { ActionRowBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { get, run, transaction } = require('../database');
const service = require('../services/DailyInteractionService');
const { activityFor, activityOpen, submitTrivia, maintainActivities } = require('../utils/dailyActivities');
const { fetchDailyMessage } = require('../utils/dailyDisplay');
const { withDailyDisplayLock } = require('../utils/dailyDisplay');
const { listCensorTerms } = require('../utils/censor');
const { validateDailyInteractionContent } = require('../utils/dailyInteractionSafety');
const PREFIX = 'dailyinteraction_answer_';

function getPost(guildId, id) { return get('SELECT * FROM daily_interaction_posts WHERE guildId = ? AND messageId = ?', [guildId, id]); }
function open(post) { return service.isDailyInteractionOpen(post) && activityOpen(post); }

async function source(interaction, post) {
  const channel = await interaction.guild.channels.fetch(post.channelId);
  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!channel?.permissionsFor(member)?.has(['ViewChannel', 'ReadMessageHistory'])) throw new Error('You no longer have access to this activity.');
  const message = await fetchDailyMessage(channel, post.messageId);
  if (message.author?.id !== interaction.client.user.id) throw new Error('The activity message is unavailable.');
  return message;
}

function engagement(post, userId, responded) {
  const config = service.getDailyInteractionConfig(post.guildId);
  const joined = run('INSERT OR IGNORE INTO daily_interaction_participants (messageId,userId,joinedAt) VALUES (?, ?, ?)',
    [post.messageId, userId, Date.now()]);
  service.recordMemberEngagement({ guildId: post.guildId, userId, messageId: post.messageId,
    dateKey: service.getDateParts(new Date(), config?.timezone).dateKey, joined: Boolean(joined.changes), responded });
}

async function refreshParticipants(message, post) {
  return withDailyDisplayLock(post.messageId, async () => {
    const latest = await fetchDailyMessage(message.channel, post.messageId);
    const count = get('SELECT COUNT(*) AS count FROM daily_interaction_participants WHERE messageId = ?', [post.messageId]).count;
    const embed = require('discord.js').EmbedBuilder.from(latest.embeds[0]);
    embed.setFields((embed.data.fields || []).map(field => field.name === 'Participants' ? { ...field, value: String(count) } : field));
    await latest.edit({ embeds: [embed] });
    run('UPDATE daily_interaction_posts SET displayedParticipantCount = ? WHERE messageId = ?', [count, post.messageId]);
  });
}

async function discussion(interaction, post) {
  const config = service.getDailyInteractionConfig(post.guildId);
  if (!config?.discussionEnabled) throw new Error('Discussion threads are disabled for this server.');
  const message = await source(interaction, post);
  if (!message.channel.permissionsFor(interaction.guild.members.me)?.has(service.THREAD_PERMISSIONS)) {
    throw new Error('I need Create Public Threads, Send Messages in Threads, Read Message History, and Manage Messages in this channel.');
  }
  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!message.channel.permissionsFor(member)?.has('SendMessagesInThreads')) throw new Error('You need permission to send messages in this channel\'s threads.');
  const thread = await service.getOrCreateDiscussionThread({ guild: interaction.guild, message, post, openedBy: interaction.user.id });
  if (thread.locked) throw new Error('This discussion has been locked by staff.');
  transaction(() => engagement(post, interaction.user.id, false));
  return interaction.editReply({ content: `Join the discussion in <#${thread.id}>. Your replies are posted as you, not the bot.` });
}

async function submit(interaction, post, choiceIndex = null) {
  if (!open(post)) throw new Error('This daily interaction has closed.');
  if (!service.getDailyInteractionConfig(post.guildId)?.discussionEnabled) throw new Error('Answer submission is disabled for this server.');
  const activity = activityFor(post);
  if (!['choice', 'trivia'].includes(activity?.mode)) return discussion(interaction, post);
  await source(interaction, post);
  if (activity.mode === 'trivia') {
    const validated = validateDailyInteractionContent({ answer: interaction.fields.getTextInputValue('response'), censorTerms: listCensorTerms(post.guildId) });
    if (!validated.valid) throw new Error(validated.message);
    const config = service.getDailyInteractionConfig(post.guildId);
    const result = submitTrivia(post, interaction.user.id, validated.answer, service.getDateParts(new Date(), config?.timezone).dateKey);
    return interaction.editReply({ content: result.message });
  }
  const answer = activity.choices[choiceIndex];
  if (!Number.isInteger(choiceIndex) || typeof answer !== 'string') throw new Error('That choice is no longer available. Choose an option on the activity message.');
  const validated = validateDailyInteractionContent({ answer, censorTerms: listCensorTerms(post.guildId) });
  if (!validated.valid) throw new Error('That option is no longer available under the current safety settings.');
  transaction(() => {
    const previous = get('SELECT 1 FROM daily_interaction_responses WHERE messageId = ? AND userId = ?', [post.messageId, interaction.user.id]);
    run(`INSERT INTO daily_interaction_responses (messageId,userId,response,submittedAt) VALUES (?, ?, ?, ?)
      ON CONFLICT(messageId,userId) DO UPDATE SET response=excluded.response, submittedAt=excluded.submittedAt`,
    [post.messageId, interaction.user.id, answer, Date.now()]);
    engagement(post, interaction.user.id, !previous);
  });
  await maintainActivities(interaction.client, Date.now(), post.messageId).catch(error => console.error('Choice display:', error.message));
  return interaction.editReply({ content: 'Your vote has been saved.' });
}

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    if (!interaction.inGuild?.()) return;
    const id = interaction.customId || '';
    const modal = interaction.isModalSubmit?.() && id.startsWith(PREFIX);
    const button = interaction.isButton?.() && (['dailyinteraction_join', 'dailyinteraction_answer', 'dailyinteraction_discuss'].includes(id) || /^dailyinteraction_choice_\d+$/.test(id));
    const menu = interaction.isStringSelectMenu?.() && ['dailyinteraction_choice', 'dailyinteraction_rate'].includes(id);
    if (!modal && !button && !menu) return;
    try {
      const post = getPost(interaction.guild.id, modal ? id.slice(PREFIX.length) : interaction.message?.id);
      if (!post) throw new Error('This activity is unavailable.');
      if (!modal && (interaction.channelId !== post.channelId || interaction.message?.author?.id !== interaction.client.user.id)) {
        throw new Error('Use the controls on the original activity message.');
      }
      if (id === 'dailyinteraction_rate') return await require('../utils/dailyPromptRatings').handlePromptRating(interaction, post);
      if (!open(post)) throw new Error('This daily interaction has closed.');
      if (id === 'dailyinteraction_answer' && activityFor(post)?.mode === 'trivia') {
        if (!service.getDailyInteractionConfig(post.guildId)?.discussionEnabled) throw new Error('Answer submission is disabled for this server.');
        return await interaction.showModal(new ModalBuilder().setCustomId(`${PREFIX}${post.messageId}`).setTitle('Private Trivia Answer')
          .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('response')
            .setLabel('Your answer').setStyle(TextInputStyle.Short).setMaxLength(250).setRequired(true))));
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (modal) return await submit(interaction, post);
      if (id === 'dailyinteraction_join') {
        const message = await source(interaction, post);
        transaction(() => engagement(post, interaction.user.id, false));
        await refreshParticipants(message, post).catch(error => console.error('Participant display:', error.message));
        return await interaction.editReply({ content: 'You have joined this activity.' });
      }
      if (id.startsWith('dailyinteraction_choice')) return await submit(interaction, post,
        Number(menu ? interaction.values[0] : id.split('_').at(-1)));
      return await discussion(interaction, post);
    } catch (error) {
      const payload = { content: error.message?.slice(0, 1500) || 'This action could not be completed.', allowedMentions: { parse: [] } };
      if (interaction.deferred || interaction.replied) return interaction.editReply(payload).catch(() => null);
      return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => null);
    }
  }
};
