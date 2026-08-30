const assert = require('node:assert/strict');
const test = require('node:test');

const {
  validateDailyInteractionContent,
  validateDailyInteractionAnswer,
  validateDailyInteractionPrompt
} = require('../utils/dailyInteractionSafety');

test('daily interaction answers reject links, mentions, hidden text, and configured censor terms', () => {
  const post = { type: 'QUESTION', prompt: 'Share a positive moment.' };

  assert.equal(validateDailyInteractionAnswer({ post, answer: 'Visit https://example.com' }).valid, false);
  assert.equal(validateDailyInteractionAnswer({ post, answer: 'Hello @everyone' }).valid, false);
  assert.equal(validateDailyInteractionAnswer({ post, answer: 'he\u200Bllo' }).valid, false);
  assert.equal(validateDailyInteractionAnswer({ post, answer: 'he\u2066llo' }).valid, false);
  assert.equal(validateDailyInteractionAnswer({
    post,
    answer: 'A forbidden answer',
    censorTerms: [{ word: 'forbidden' }]
  }).valid, false);
});

test('daily interaction answers reject punctuation, symbol, and spacing bypasses before anything is posted', () => {
  const post = { type: 'QUESTION', prompt: 'Share a positive moment.' };
  for (const answer of ['.fuck', '/shit', 'f.u.c.k', 'f@ck', 'f*ck', 'fuuuck', 's h i t', 'sh*t', 'shiiit']) {
    assert.equal(validateDailyInteractionAnswer({ post, answer }).valid, false, answer);
  }
  assert.equal(validateDailyInteractionAnswer({ post, answer: 'That was a great day.' }).valid, true);
});

test('word-chain answers must be one word beginning with the required letter', () => {
  const post = {
    type: 'GAME',
    prompt: 'Word chain: reply with a word beginning with the last letter of **adventure**.'
  };

  assert.equal(validateDailyInteractionAnswer({ post, answer: 'eagle' }).valid, true);
  assert.equal(validateDailyInteractionAnswer({ post, answer: 'apple' }).valid, false);
  assert.equal(validateDailyInteractionAnswer({ post, answer: 'eagle flight' }).valid, false);
});

test('daily interaction discussion content has the same safety checks without game-format rules', () => {
  assert.equal(validateDailyInteractionContent({ answer: 'I agree with eagle.' }).valid, true);
  assert.equal(validateDailyInteractionContent({ answer: 'Join discord.gg/example' }).valid, false);
});

test('daily interaction safety rejects lookalike alphabets and validates admin-created prompts', () => {
  assert.equal(validateDailyInteractionContent({ answer: 'f\u0441ck' }).valid, false);
  assert.equal(validateDailyInteractionContent({ answer: 'Safe \u03b1nswer' }).valid, false);
  assert.equal(validateDailyInteractionPrompt({
    prompt: 'Visit https://example.com for a prize.'
  }).valid, false);
  assert.equal(validateDailyInteractionPrompt({
    prompt: 'What game would make a fun community event?',
    title: 'Community Pick'
  }).valid, true);
});
