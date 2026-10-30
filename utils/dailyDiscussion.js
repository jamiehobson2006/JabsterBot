const { get, run, transaction } = require('../database');
const { activityFor, activityOpen, gameState, validateGameTurn } = require('./dailyActivities');
const { validateDailyInteractionContent } = require('./dailyInteractionSafety');
const { listCensorTerms } = require('./censor');

function recordDiscussionMessage(message, post) {
  if (!activityOpen(post)) return { valid: false, message: 'This activity has closed.' };
  const terms = listCensorTerms(post.guildId);
  const safety = validateDailyInteractionContent({ answer: message.content, censorTerms: terms, maxLength: 250 });
  if (!safety.valid) return safety;
  return transaction(() => {
    let activity = activityFor(post);
    if (!activity && post.type === 'GAME') {
      activity = require('./dailyActivities').createActivity(post, require('./dailyEngagement').engagementSettings(post.guildId));
      if (activity) { post.activityJson = JSON.stringify(activity); run('UPDATE daily_interaction_posts SET activityJson=COALESCE(activityJson,?) WHERE messageId=?', [post.activityJson, post.messageId]); }
    }
    const game = ['chain', 'story'].includes(activity?.mode);
    if (post.type === 'GAME' && !game) {
      const valid = require('./dailyInteractionSafety').validateDailyInteractionAnswer({ post, answer: safety.answer, censorTerms: terms });
      if (!valid.valid) return valid;
    }
    if (game) {
      const previous = get('SELECT answer FROM daily_game_turns WHERE messageId = ? AND sourceMessageId = ?', [post.messageId, message.id]);
      if (previous) return previous.answer === safety.answer ? { valid: true } : { valid: false, message: 'A submitted game turn cannot be changed.' };
      const validated = validateGameTurn(post, message.author.id, safety.answer, terms);
      if (!validated.valid) return validated;
      run(`INSERT INTO daily_game_turns (messageId,turn,userId,answer,createdAt,sourceMessageId) VALUES (?, ?, ?, ?, ?, ?)`,
        [post.messageId, gameState(post).version + 1, message.author.id, validated.answer, Date.now(), message.id]);
    }
    const previous = get('SELECT 1 FROM daily_interaction_responses WHERE messageId = ? AND userId = ?', [post.messageId, message.author.id]);
    run(`INSERT INTO daily_interaction_responses (messageId,userId,response,submittedAt,threadMessageId)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(messageId,userId) DO UPDATE SET response=excluded.response,
      submittedAt=excluded.submittedAt,threadMessageId=excluded.threadMessageId`,
    [post.messageId, message.author.id, safety.answer, Date.now(), message.id]);
    const joined = run('INSERT OR IGNORE INTO daily_interaction_participants (messageId,userId,joinedAt) VALUES (?, ?, ?)',
      [post.messageId, message.author.id, Date.now()]);
    const service = require('../services/DailyInteractionService');
    const config = service.getDailyInteractionConfig(post.guildId);
    service.recordMemberEngagement({ guildId: post.guildId, userId: message.author.id, messageId: post.messageId,
      dateKey: service.getDateParts(new Date(), config?.timezone).dateKey, joined: Boolean(joined.changes), responded: !previous });
    return { valid: true };
  });
}

module.exports = { recordDiscussionMessage };
