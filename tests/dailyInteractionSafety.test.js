const assert = require('node:assert/strict');
const test = require('node:test');

const {
  validateDailyInteractionContent,
  validateDailyInteractionAnswer,
  validateDailyInteractionPrompt,
  supportsSubmittedAnswer
} = require('../utils/dailyInteractionSafety');

test('daily interaction answers reject links, mentions, hidden text, and configured censor terms', () => {
  const post = { type: 'QUESTION', prompt: 'Share a positive moment.' };

  assert.equal(validateDailyInteractionContent({ answer: 'Visit https://example.com' }).valid, false);
  assert.equal(validateDailyInteractionContent({ answer: 'Hello @everyone' }).valid, false);
  assert.equal(validateDailyInteractionContent({ answer: 'he\u200Bllo' }).valid, false);
  assert.equal(validateDailyInteractionContent({ answer: 'he\u2066llo' }).valid, false);
  assert.equal(validateDailyInteractionContent({
    answer: 'A forbidden answer',
    censorTerms: [{ word: 'forbidden' }]
  }).valid, false);
  assert.equal(validateDailyInteractionContent({
    answer: 'An ass is another name for a donkey.',
    censorTerms: [{ word: 'ass' }]
  }).valid, false);
  assert.equal(validateDailyInteractionContent({
    answer: 'A class project went well today.'
  }).valid, true);
});

test('daily interaction answers reject punctuation, symbol, and spacing bypasses before anything is posted', () => {
  const post = { type: 'QUESTION', prompt: 'Share a positive moment.' };
  for (const answer of ['.fuck', '/shit', 'f.u.c.k', 'f@ck', 'f*ck', 'fuuuck', 's h i t', 'sh*t', 'shiiit']) {
    assert.equal(validateDailyInteractionContent({ answer }).valid, false, answer);
  }
  assert.equal(validateDailyInteractionContent({ answer: 'That was a great day.' }).valid, true);
});

test('daily interaction safety checks every word in the submitted response', () => {
  assert.equal(validateDailyInteractionContent({
    answer: 'This starts as a normal answer but has fuck at the end.'
  }).valid, false);
  assert.equal(validateDailyInteractionContent({
    answer: 'This starts normally but has ass at the end.'
  }).valid, false);
  assert.equal(validateDailyInteractionContent({
    answer: 'This starts normally and includes a blocked phrase later.',
    censorTerms: [{ word: 'blocked phrase' }]
  }).valid, false);
});

test('daily interaction responses must follow the prompt format', () => {
  const wouldYouRather = {
    type: 'WOULD_YOU_RATHER',
    prompt: 'Would you rather always be early or always be lucky?'
  };
  const trivia = {
    type: 'TRIVIA',
    prompt: 'Trivia: What is the largest planet in our solar system?'
  };
  const openQuestion = {
    type: 'QUESTION',
    prompt: 'What is one small thing that made your day better recently?'
  };

  assert.equal(supportsSubmittedAnswer(wouldYouRather), true);
  assert.equal(validateDailyInteractionAnswer({ post: wouldYouRather, answer: 'early' }).valid, true);
  assert.equal(validateDailyInteractionAnswer({ post: wouldYouRather, answer: 'A completely unrelated answer' }).valid, false);
  assert.equal(validateDailyInteractionAnswer({ post: trivia, answer: 'Jupiter' }).valid, true);
  assert.equal(validateDailyInteractionAnswer({ post: trivia, answer: 'Saturn' }).valid, false);
  assert.equal(supportsSubmittedAnswer(openQuestion), false);
  assert.equal(validateDailyInteractionAnswer({ post: openQuestion, answer: 'A completely unrelated answer' }).valid, false);
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
