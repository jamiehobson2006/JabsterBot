const { validateDailyInteractionContent, normalizeAnswer } = require('./dailyInteractionSafety');
const { listCensorTerms } = require('./censor');

function validateTrivia({ answer, aliases = '', explanation, guildId }) {
  const answers = [answer, ...(Array.isArray(aliases) ? aliases : String(aliases || '').split('|'))]
    .filter(value => typeof value === 'string' && value.trim()).map(value => value.trim());
  if (!answer || answers.length > 11 || !explanation?.trim()) {
    throw new Error('Trivia needs an answer and explanation, with at most 10 aliases separated by |.');
  }
  const censorTerms = listCensorTerms(guildId);
  if (answers.some(value => !validateDailyInteractionContent({ answer: value, censorTerms, maxLength: 100 }).valid) ||
      !validateDailyInteractionContent({ answer: explanation, censorTerms, maxLength: 600 }).valid) {
    throw new Error('Trivia answers and explanation must be safe text (answer up to 100, explanation up to 600 characters).');
  }
  const seen = new Set();
  return { answers: answers.filter(value => { const key = normalizeAnswer(value);
    if (!key || seen.has(key)) return false; seen.add(key); return true; }), explanation: explanation.trim() };
}

function readTrivia(json, guildId) {
  if (!json) return null;
  try { const value = JSON.parse(json); return validateTrivia({ guildId, answer: value.answers[0], aliases: value.answers.slice(1), explanation: value.explanation }); }
  catch { return null; }
}

module.exports = { validateTrivia, readTrivia };
