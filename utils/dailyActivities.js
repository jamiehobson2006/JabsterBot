const { choicesFromPrompt, triviaAnswersForPrompt, normalizeAnswer, validateDailyInteractionContent,
  validateDailyInteractionAnswer } = require('./dailyInteractionSafety');
const { all, get, run, transaction } = require('../database');
const crypto = require('node:crypto');
const { fetchDailyMessage } = require('./dailyDisplay');

const TRIVIA_EXPLANATIONS = {
  jupiter: 'Jupiter is the largest planet in the solar system.',
  pacific: 'The Pacific is the largest ocean on Earth.',
  six: 'A hexagon is a polygon with six sides.',
  green: 'Mixing blue and yellow paint produces green.',
  zebra: 'Zebras are known for their black-and-white striped coats.',
  tokyo: 'Tokyo is the capital of Japan.',
  autumn: 'In the UK, autumn follows summer.',
  sixty: 'One hour contains sixty minutes.',
  giraffe: 'The giraffe is the tallest living land animal.',
  mars: 'Mars is called the Red Planet because iron minerals on its surface oxidise.'
};

function activityFor(post) {
  try { return JSON.parse(post.activityJson || 'null'); } catch { return null; }
}

function createActivity(picked, settings) {
  const prompt = picked.prompt.replace(/\*/g, '');
  const chain = picked.type === 'GAME' && prompt.match(/^Word chain: reply with a word beginning with the last letter of\s+([a-z]+)\.?$/i);
  if (chain) return { mode: 'chain', seed: chain[1].toLowerCase() };
  if (picked.type === 'GAME' && /^One-word story:/.test(prompt)) return { mode: 'story' };
  if (picked.type === 'TRIVIA') {
    const answers = triviaAnswersForPrompt(picked);
    if (answers.length) return { mode: 'trivia', answers, minutes: settings.triviaMinutes,
      explanation: TRIVIA_EXPLANATIONS[answers[0]] || `The accepted answer is ${answers[0]}.` };
  }
  const choices = choicesFromPrompt(picked);
  if (choices.length > 1 && choices.length <= 25 && choices.every(choice => choice.length <= 100)) {
    return { mode: 'choice', choices };
  }
  return null;
}

function activityOpen(post, now = Date.now()) {
  const activity = activityFor(post);
  const duration = activity?.mode === 'trivia' ? activity.minutes * 60_000 : 86_400_000;
  return Number(post.sentAt) <= now && now < Number(post.sentAt) + duration;
}

function gameState(post) {
  const turns = all('SELECT * FROM daily_game_turns WHERE messageId = ? ORDER BY turn', [post.messageId]);
  const activity = activityFor(post);
  return { turns, version: turns.length, lastUser: turns.at(-1)?.userId,
    lastWord: turns.at(-1)?.answer || activity?.seed, story: turns.map(turn => turn.answer).join(' ') };
}

function choiceResults(post) {
  const choices = activityFor(post)?.choices || [];
  const responses = all('SELECT userId, response FROM daily_interaction_responses WHERE messageId = ? ORDER BY userId', [post.messageId]);
  return { hash: crypto.createHash('sha256').update(JSON.stringify(responses)).digest('hex'),
    text: choices.map(choice => `**${choice}**: ${responses.filter(row => normalizeAnswer(row.response) === normalizeAnswer(choice)).length}`).join('\n') };
}

function validateGameTurn(post, userId, answer, censorTerms) {
  const activity = activityFor(post);
  const state = gameState(post);
  if (state.lastUser === userId) return { valid: false, message: 'Let another member take the next turn.' };
  if (state.version >= 200 || state.story.length > 3400) return { valid: false, message: 'This game is complete. Join the next daily round.' };
  const current = activity.mode === 'chain' ? { ...post,
    prompt: `Word chain: reply with a word beginning with the last letter of **${state.lastWord}**.` } : post;
  const validated = validateDailyInteractionAnswer({ post: current, answer, censorTerms });
  if (!validated.valid) return validated;
  if (activity.mode === 'chain' && [activity.seed, ...state.turns.map(turn => turn.answer)]
    .some(word => normalizeAnswer(word) === normalizeAnswer(validated.answer))) {
    return { valid: false, message: 'That word has already been used in this chain.' };
  }
  if (activity.mode === 'story' && !validateDailyInteractionContent({
    answer: `${state.story} ${validated.answer}`.trim(), censorTerms, maxLength: 3600 }).valid) {
    return { valid: false, message: 'That would make the combined story unsuitable. Choose a different word.' };
  }
  return { ...validated, gameVersion: state.version + 1 };
}

function finalizeGameTurn(metadata, sentAt) {
  if (!metadata.gameVersion) return;
  run(`INSERT OR IGNORE INTO daily_game_turns (messageId, turn, userId, answer, createdAt)
       VALUES (?, ?, ?, ?, ?)`, [metadata.postId, metadata.gameVersion, metadata.userId, metadata.answer, sentAt]);
}

function submitTrivia(post, userId, answer, dateKey, now = Date.now()) {
  const activity = activityFor(post);
  if (!activityOpen(post, now)) return { message: 'This trivia round has closed.' };
  return transaction(() => {
    const correct = activity.answers.some(expected => normalizeAnswer(expected) === normalizeAnswer(answer));
    const inserted = run(`INSERT OR IGNORE INTO daily_trivia_attempts
      (messageId, userId, answer, correct, submittedAt) VALUES (?, ?, ?, ?, ?)`,
    [post.messageId, userId, answer, correct ? 1 : 0, now]);
    if (!inserted.changes) return { message: 'You have already submitted your first attempt. Answers are revealed when the round closes.' };
    const joined = run(`INSERT OR IGNORE INTO daily_interaction_participants (messageId, userId, joinedAt) VALUES (?, ?, ?)`,
      [post.messageId, userId, now]);
    require('../services/DailyInteractionService').recordMemberEngagement({ guildId: post.guildId,
      userId, dateKey, joined: Boolean(joined.changes), responded: true, now, messageId: post.messageId });
    return { message: 'Your answer is saved privately. The answer and explanation will be revealed when this round closes.' };
  });
}

async function maintainActivities(client, now = Date.now(), onlyPostId = null) {
  const { attemptDailyDelivery, newDailyKey, queueDailyDelivery } = require('./dailyDelivery');
  const posts = all(`SELECT * FROM daily_interaction_posts WHERE activityJson IS NOT NULL
    AND (sentAt > ? OR (type = 'TRIVIA' AND triviaRevealedAt IS NULL))
    ${onlyPostId ? 'AND messageId = ?' : ''} ORDER BY sentAt DESC LIMIT 100`,
    [now - 86_400_000, ...(onlyPostId ? [onlyPostId] : [])]);
  for (const post of posts) {
    const activity = activityFor(post);
    const state = ['chain', 'story'].includes(activity?.mode) ? gameState(post) : null;
    const votes = activity?.mode === 'choice' ? choiceResults(post) : null;
    const reveal = activity?.mode === 'trivia' && !activityOpen(post, now) && !post.triviaRevealedAt;
    if (!reveal && (!state || state.version === post.displayedGameVersion) && (!votes || votes.hash === post.displayedChoiceHash)) continue;
    try {
      const channel = await client.channels.fetch(post.channelId);
      const message = await fetchDailyMessage(channel, post.messageId);
      const { EmbedBuilder } = require('discord.js');
      const embed = EmbedBuilder.from(message.embeds[0]);
      const fields = (embed.data.fields || []).filter(field => !['Current Game', 'Trivia Result', 'Status'].includes(field.name) && !field.name.startsWith('Choice Results'));
      if (reveal) {
        const totals = get('SELECT COUNT(*) AS total, COALESCE(SUM(correct), 0) AS correct FROM daily_trivia_attempts WHERE messageId = ?', [post.messageId]);
        fields.push({ name: 'Trivia Result', value: `**${activity.answers[0]}**\n${activity.explanation}\n${totals.correct} correct out of ${totals.total} first attempts.` },
          { name: 'Status', value: 'Closed' });
      } else if (votes) {
        const lines = votes.text.split('\n');
        let chunk = '';
        for (const line of lines) {
          if (chunk.length + line.length > 950) { fields.push({ name: 'Choice Results', value: chunk }); chunk = ''; }
          chunk += `${line}\n`;
        }
        if (chunk) fields.push({ name: 'Choice Results', value: chunk });
      } else {
        fields.push({ name: 'Current Game', value: activity.mode === 'chain'
          ? `Turn ${state.version} | Latest word: **${state.lastWord}**\nNext word starts with **${state.lastWord.at(-1).toUpperCase()}**.`
          : `Turn ${state.version}\n${state.story.slice(-900) || 'Add the opening word.'}` });
      }
      embed.setFields(fields);
      const pendingChoice = votes && get(`SELECT deliveryKey FROM delivery_outbox WHERE type = 'DAILY_ACTIVITY_UPDATE'
        AND status IN ('PENDING', 'FAILED', 'PROCESSING') AND json_extract(payload, '$.daily.postId') = ?
        AND json_extract(payload, '$.daily.choiceHash') = ? LIMIT 1`, [post.messageId, votes.hash]);
      const row = queueDailyDelivery({ deliveryKey: reveal ? `daily-trivia-reveal:${post.messageId}`
        : votes ? pendingChoice?.deliveryKey || newDailyKey(`daily-choice-display:${post.messageId}`)
        : `daily-game-display:${post.messageId}:${state.version}`, type: 'DAILY_ACTIVITY_UPDATE',
      guildId: post.guildId, channelId: post.channelId, message: { embeds: [embed], ...(reveal ? { components: [] } : {}), allowedMentions: { parse: [] } },
      metadata: { postId: post.messageId, editMessageId: post.messageId, reveal, gameVersion: state?.version, choiceHash: votes?.hash } });
      await attemptDailyDelivery(client, row);
    } catch (error) {
      if ([10003, 10008].includes(Number(error.code)) && reveal) {
        run('UPDATE daily_interaction_posts SET triviaRevealedAt = ? WHERE messageId = ?', [now, post.messageId]);
      } else console.error('Daily activity maintenance:', error.message);
    }
  }
}

module.exports = { activityFor, activityOpen, choiceResults, createActivity, finalizeGameTurn, gameState,
  maintainActivities, submitTrivia, validateGameTurn };
