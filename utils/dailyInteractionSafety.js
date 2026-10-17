const {
  findCensoredTerm
} = require('./censor');

const { findRacistTerm } = require('./racismFilter');
const { hasLink } = require('./linkDetection');

const MAX_RESPONSE_LENGTH = 250;
const MAX_GAME_RESPONSE_LENGTH = 250;
const MAX_PROMPT_LENGTH = 600;
const MAX_TITLE_LENGTH = 120;

const SUBMITTABLE_INTERACTION_TYPES = Object.freeze([
  'WOULD_YOU_RATHER',
  'THIS_OR_THAT',
  'COMMUNITY_PICK',
  'TRIVIA',
  'GAME'
]);

const TRIVIA_ANSWERS = Object.freeze({
  'what is the largest planet in our solar system': ['jupiter'],
  'which ocean is the largest on earth': ['pacific', 'pacific ocean'],
  'how many sides does a hexagon have': ['six', '6'],
  'what colour do blue and yellow make when mixed': ['green'],
  'which animal is famous for black and white stripes': ['zebra', 'a zebra'],
  'what is the capital city of japan': ['tokyo'],
  'which season comes after summer in the uk': ['autumn', 'fall'],
  'how many minutes are in one hour': ['sixty', '60'],
  'what is the tallest type of land animal': ['giraffe', 'a giraffe'],
  'which planet is known as the red planet': ['mars']
});

const MENTION_PATTERN = /(?:@everyone|@here|<@!?\d+>|<@&\d+>|<#\d+>)/u;
const INVISIBLE_OR_DIRECTIONAL_PATTERN = /[\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/u;
const WORD_GAME_DICTIONARY = new Set(require('an-array-of-english-words'));

const LIGHT_RHYMES = new Set([
  'bright', 'flight', 'fright', 'height', 'kite', 'might', 'night', 'right',
  'sight', 'tight', 'white'
]);

const MEDIA_TITLES = new Set([
  'minecraft', 'mario', 'mario kart', 'moana', 'monopoly', 'mulan',
  'sonic', 'star wars', 'stardew valley', 'super mario', 'spider man',
  'scooby doo', 'shrek', 'splatoon', 'subnautica'
]);

// Daily interactions are intended to be family-friendly. The server's custom
// censor list remains the extensible layer for community-specific terms.
const BUILT_IN_UNSAFE_TERMS = Object.freeze([
  'ass',
  'asshole',
  'arsehole',
  'bastard',
  'bitch',
  'bollocks',
  'bullshit',
  'cock',
  'crap',
  'cunt',
  'damn',
  'dick',
  'douche',
  'douchebag',
  'fag',
  'faggot',
  'fuck',
  'fucker',
  'fucking',
  'jerkoff',
  'kys',
  'kill yourself',
  'motherfucker',
  'nigga',
  'nigger',
  'piss',
  'porn',
  'prick',
  'pussy',
  'rape',
  'rapist',
  'retard',
  'shit',
  'slut',
  'suicide',
  'twat',
  'wanker',
  'whore'
]);

// Catch common attempts to remove or replace a letter with punctuation, such
// as f@ck, f*ck, or sh*t. The regular word list above handles normal spelling.
const BUILT_IN_UNSAFE_VARIANTS = Object.freeze([
  /(?:^|[^a-z])f(?:[^a-z]*[uav])*[^a-z]*c+[^a-z]*k+(?:[^a-z]*ing|[^a-z]*er|[^a-z]*ed)?(?=$|[^a-z])/u,
  /(?:^|[^a-z])s+[^a-z]*h+[^a-z]*i*[^a-z]*t+(?:[^a-z]*ty)?(?=$|[^a-z])/u
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const UNSAFE_RULES = BUILT_IN_UNSAFE_TERMS.map(term => {
  const body = term.split('').map(character => character === ' ' ? '\\s+'
    : `${escapeRegExp(character)}+`).join('[^a-z]*');
  return new RegExp(`(?:^|[^a-z])(?:${body})+(?:s|es|ed|ing|er|ers)?(?=$|[^a-z])`, 'u');
});

const EMOJI_GRAPHEME = /^(?:\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|\uFE0F|\u200D\p{Extended_Pictographic})*|\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3)$/u;
function countEmojis(value) {
  const segments = [...new Intl.Segmenter('en', { granularity: 'grapheme' })
    .segment(String(value).replace(/\s+/gu, ''))].map(item => item.segment);
  return segments.length && segments.every(segment => EMOJI_GRAPHEME.test(segment)) ? segments.length : null;
}

function normaliseForSafety(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[@4]/g, 'a')
    .replace(/[3]/g, 'e')
    .replace(/[1!|]/g, 'i')
    .replace(/[0]/g, 'o')
    .replace(/[$5]/g, 's')
    .replace(/[7]/g, 't')
    // Common cross-script lookalikes are normalized before checking terms.
    .replace(/[\u0430\u03B1]/g, 'a')
    .replace(/[\u0441]/g, 'c')
    .replace(/[\u0435]/g, 'e')
    .replace(/[\u04BB]/g, 'h')
    .replace(/[\u0456\u0457\u0131]/g, 'i')
    .replace(/[\u043A]/g, 'k')
    .replace(/[\u043D]/g, 'n')
    .replace(/[\u043E\u03BF]/g, 'o')
    .replace(/[\u0440]/g, 'p')
    .replace(/[\u0455]/g, 's')
    .replace(/[\u0442]/g, 't');
}

function containsBuiltInUnsafeLanguage(value) {
  if (findRacistTerm(value)) return true;
  // Check punctuation both as separators and possible letter substitutions.
  // A trailing exclamation mark must not erase a blocked word's boundary.
  const variants = [normaliseForSafety(String(value).replace(/[!|@$]/g, ' ')), normaliseForSafety(value)];
  return variants.some(normalized => {
    return UNSAFE_RULES.some(pattern => pattern.test(normalized)) ||
      BUILT_IN_UNSAFE_VARIANTS.some(pattern => pattern.test(normalized));
  });
}

function hasUnsupportedAlphabet(value) {
  const decomposed = String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '');

  return [...decomposed].some(character =>
    /\p{L}/u.test(character) && !/^[A-Za-z]$/.test(character)
  );
}

function promptText(post) {
  return String(post?.prompt || '')
    .normalize('NFKC')
    .replace(/\*/g, '');
}

function normalizeAnswer(value) {
  return String(value || '')
    .normalize('NFKD').replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function cleanChoice(value) {
  return String(value || '')
    .replace(/\?$/u, '')
    .replace(/^\s*(?:and|or)\s+/iu, '')
    .trim();
}

function choicesFromPrompt(post) {
  const prompt = promptText(post);
  const type = String(post?.type || '').toUpperCase();

  if (type === 'WOULD_YOU_RATHER') {
    const match = prompt.match(/^Would you rather\s+(.+?)\s+or\s+(.+?)\?$/iu);
    return match ? [cleanChoice(match[1]), cleanChoice(match[2])] : [];
  }

  if (type === 'THIS_OR_THAT') {
    const match = prompt.match(/^(.+?)\s+or\s+(.+?)\?$/iu);
    return match ? [cleanChoice(match[1]), cleanChoice(match[2])] : [];
  }

  if (type === 'COMMUNITY_PICK' || /^Co-op pick:/iu.test(prompt)) {
    const choicesText = prompt.split(':').at(-1);
    const trimmedChoices = choicesText
      ?.replace(/^\s*choose\s+/iu, '');

    return trimmedChoices
      ? choicesText
        .replace(/\.$/u, '')
        .replace(/^\s*choose\s+/iu, '')
        .split(/,|\s+or\s+/iu)
        .map(cleanChoice)
        .filter(Boolean)
      : [];
  }

  return [];
}

function choiceMatchesAnswer(answer, choice) {
  const normalizedAnswer = normalizeAnswer(answer);
  const normalizedChoice = normalizeAnswer(choice);
  if (normalizedAnswer === normalizedChoice) return true;

  const words = normalizedChoice.split(' ').filter(Boolean);
  const shortChoice = words.at(-1);
  return words.length > 1 && normalizedAnswer === shortChoice;
}

function triviaAnswersForPrompt(post) {
  let activity;
  try { activity = JSON.parse(post?.activityJson || 'null'); } catch { /* Legacy prompt. */ }
  const answers = post?.trivia?.answers || (activity?.mode === 'trivia' && activity.answers);
  if (Array.isArray(answers) && answers.length > 0 && answers.length <= 11 &&
      answers.every(answer => typeof answer === 'string' && answer.trim().length > 0 && answer.length <= 100)) return answers;
  const question = normalizeAnswer(promptText(post)).replace(/^trivia\s+/, '');
  return Object.hasOwn(TRIVIA_ANSWERS, question) ? TRIVIA_ANSWERS[question] : [];
}

function hasSupportedGameRule(post) {
  const prompt = promptText(post);

  return /^Word chain: reply with a word beginning with the last letter of\s+\p{L}+\.?$/iu.test(prompt) ||
    /^Two truths and a lie: post three statements about yourself and let people guess the lie\.?$/iu.test(prompt) ||
    /^Alphabet challenge: name a game, film, or show beginning with the letter\s+[A-Za-z]\.?$/iu.test(prompt) ||
    /^Emoji story: describe your day using exactly five emojis\.?$/iu.test(prompt) ||
    /^One-word story: add one word to continue the community story in the thread\.?$/iu.test(prompt) ||
    /^Rhyme round: name one word that rhymes with light\.?$/iu.test(prompt) ||
    /^Five-letter round: share one ordinary word with exactly five letters\.?$/iu.test(prompt) ||
    choicesFromPrompt(post).length > 1;
}

function supportsSubmittedAnswer(post) {
  const type = String(post?.type || '').toUpperCase();
  if (!SUBMITTABLE_INTERACTION_TYPES.includes(type)) return false;
  if (type === 'GAME') return hasSupportedGameRule(post);
  if (type === 'TRIVIA') return triviaAnswersForPrompt(post).length > 0;
  return choicesFromPrompt(post).length > 0;
}

function answerInstruction(post) {
  const choices = choicesFromPrompt(post);
  if (choices.length) {
    return `Choose exactly one: ${choices.join(' / ')}`.slice(0, 100);
  }

  if (String(post?.type || '').toUpperCase() === 'TRIVIA') {
    return 'Enter the trivia answer only.';
  }
  const chain = promptText(post).match(/last letter of\s+([a-z]+)/i);
  if (chain) return `One unused English word beginning with ${chain[1].at(-1).toUpperCase()}.`;
  if (/^One-word story:/i.test(promptText(post))) return 'One English word to continue the story. Let another player go between your turns.';

  return 'Follow the game instructions exactly.';
}

function firstLetter(value) {
  return [...String(value || '').matchAll(/\p{L}/gu)][0]?.[0]?.toLocaleLowerCase('en-GB') || null;
}

function lastLetter(value) {
  const letters = [...String(value || '').matchAll(/\p{L}/gu)];
  return letters.at(-1)?.[0]?.toLocaleLowerCase('en-GB') || null;
}

function validateGameAnswer(post, answer) {
  const prompt = promptText(post);
  const normalizedAnswer = normalizeAnswer(answer);

  const wordChain = prompt.match(/last letter of\s+([\p{L}]+)/iu);
  if (wordChain) {
    if (!/^\p{L}{2,32}$/u.test(answer)) {
      return 'This word chain only accepts one normal word.';
    }

    if (firstLetter(answer) !== lastLetter(wordChain[1])) {
      return `Your word must begin with the letter ${lastLetter(wordChain[1]).toUpperCase()}.`;
    }

    if (!WORD_GAME_DICTIONARY.has(normalizedAnswer)) {
      return 'Use a recognised English word for the word chain.';
    }
  }

  const alphabetChallenge = prompt.match(/beginning with the letter\s+([\p{L}])/iu);
  if (alphabetChallenge) {
    if (!/^[\p{L}\p{N}][\p{L}\p{N}\s'’-]{1,100}$/u.test(answer)) {
      return 'Use a normal game, film, or show title without links or special formatting.';
    }

    if (firstLetter(answer) !== firstLetter(alphabetChallenge[1])) {
      return `Your answer must begin with the letter ${firstLetter(alphabetChallenge[1]).toUpperCase()}.`;
    }

    if (!MEDIA_TITLES.has(normalizedAnswer)) {
      const titles = [...MEDIA_TITLES].filter(title => firstLetter(title) === firstLetter(alphabetChallenge[1]));
      return `This round uses verified titles. Choose one: ${titles.join(', ')}.`;
    }
  }

  if (/^One-word story:/iu.test(prompt)) {
    if (!/^\p{L}{2,32}$/u.test(answer)) {
      return 'This game only accepts one normal word.';
    }
    if (!WORD_GAME_DICTIONARY.has(normalizedAnswer)) {
      return 'Use a recognised English word for the story.';
    }
  }

  if (/^Two truths and a lie:/iu.test(prompt)) {
    const statements = answer
      .split(/\n+|(?<=[.!?])\s+/u)
      .map(statement => statement.trim())
      .filter(Boolean);

    if (statements.length !== 3 || statements.some(statement => statement.length < 4)) {
      return 'Submit exactly three short statements, one per line.';
    }
  }

  if (/^Emoji story:/iu.test(prompt)) {
    if (countEmojis(answer) !== 5) {
      return 'This game only accepts exactly five emojis.';
    }
  }

  if (/^Rhyme round:/iu.test(prompt) && !LIGHT_RHYMES.has(normalizedAnswer)) {
    return 'Reply with one recognised word that rhymes with light.';
  }

  if (
    /^Five-letter round:/iu.test(prompt) &&
    (!/^[A-Za-z]{5}$/u.test(answer) || !WORD_GAME_DICTIONARY.has(normalizedAnswer))
  ) {
    return 'Reply with one recognised five-letter word.';
  }

  const choices = choicesFromPrompt(post);
  if (choices.length && !choices.some(choice => choiceMatchesAnswer(answer, choice))) {
    return `Choose one of the listed options: ${choices.join(', ')}.`;
  }

  return null;
}

function validateDailyInteractionContent({ answer, censorTerms = [], maxLength = MAX_RESPONSE_LENGTH }) {
  const cleaned = String(answer || '').normalize('NFKC').trim();

  if (!cleaned) {
    return { valid: false, message: 'Your answer cannot be empty.' };
  }

  if (cleaned.length > maxLength) {
    return { valid: false, message: `Keep this answer to ${maxLength} characters or fewer.` };
  }

  const checkedHidden = countEmojis(cleaned) ? cleaned.replace(/\u200D/g, '') : cleaned;
  if (INVISIBLE_OR_DIRECTIONAL_PATTERN.test(checkedHidden)) {
    return { valid: false, message: 'Your answer contains unsupported hidden characters.' };
  }

  if (hasUnsupportedAlphabet(cleaned)) {
    return { valid: false, message: 'Use standard English letters in daily interaction answers.' };
  }

  if (hasLink(cleaned)) {
    return { valid: false, message: 'Links are not allowed in daily interaction answers.' };
  }

  if (MENTION_PATTERN.test(cleaned)) {
    return { valid: false, message: 'Mentions are not allowed in daily interaction answers.' };
  }

  const matchedCustomTerm = findCensoredTerm(cleaned, censorTerms, 'AGGRESSIVE');

  if (matchedCustomTerm || containsBuiltInUnsafeLanguage(cleaned)) {
    return { valid: false, message: 'Keep daily interaction answers family-friendly and respectful.' };
  }

  return { valid: true, answer: cleaned };
}

function validateDailyInteractionPrompt({ prompt, title = null, censorTerms = [] }) {
  const promptValidation = validateDailyInteractionContent({
    answer: prompt,
    censorTerms,
    maxLength: MAX_PROMPT_LENGTH
  });

  if (!promptValidation.valid) {
    return { valid: false, message: `Prompt rejected: ${promptValidation.message}` };
  }

  if (!title?.trim()) {
    return { valid: true, prompt: promptValidation.answer, title: null };
  }

  const titleValidation = validateDailyInteractionContent({
    answer: title,
    censorTerms,
    maxLength: MAX_TITLE_LENGTH
  });

  if (!titleValidation.valid) {
    return { valid: false, message: `Title rejected: ${titleValidation.message}` };
  }

  return {
    valid: true,
    prompt: promptValidation.answer,
    title: titleValidation.answer
  };
}

function validateDailyInteractionAnswer({ post, answer, censorTerms = [] }) {
  if (!supportsSubmittedAnswer(post)) {
    return {
      valid: false,
      message: 'This activity tracks participation through Join In and does not accept text responses.'
    };
  }

  const maxLength = String(post?.type || '').toUpperCase() === 'GAME'
    ? MAX_GAME_RESPONSE_LENGTH
    : MAX_RESPONSE_LENGTH;
  const contentValidation = validateDailyInteractionContent({
    answer,
    censorTerms,
    maxLength
  });

  if (!contentValidation.valid) return contentValidation;

  const type = String(post?.type || '').toUpperCase();
  const choices = choicesFromPrompt(post);
  if (choices.length && !choices.some(choice => choiceMatchesAnswer(contentValidation.answer, choice))) {
    return {
      valid: false,
      message: `Choose exactly one listed option: ${choices.join(', ')}.`
    };
  }

  if (type === 'TRIVIA') {
    const answers = triviaAnswersForPrompt(post);
    if (!answers.length || !answers.some(expected => normalizeAnswer(expected) === normalizeAnswer(contentValidation.answer))) {
      return { valid: false, message: 'That is not the expected trivia answer. Try again.' };
    }
  }

  if (type === 'GAME') {
    const gameError = validateGameAnswer(post, contentValidation.answer);
    if (gameError) return { valid: false, message: gameError };
  }

  return contentValidation;
}

module.exports = {
  BUILT_IN_UNSAFE_TERMS,
  BUILT_IN_UNSAFE_VARIANTS,
  MAX_GAME_RESPONSE_LENGTH,
  MAX_PROMPT_LENGTH,
  MAX_RESPONSE_LENGTH,
  MAX_TITLE_LENGTH,
  SUBMITTABLE_INTERACTION_TYPES,
  answerInstruction,
  choicesFromPrompt,
  normalizeAnswer,
  triviaAnswersForPrompt,
  containsBuiltInUnsafeLanguage,
  hasUnsupportedAlphabet,
  hasSupportedGameRule,
  validateDailyInteractionContent,
  validateDailyInteractionAnswer,
  validateDailyInteractionPrompt,
  validateGameAnswer,
  supportsSubmittedAnswer
};
