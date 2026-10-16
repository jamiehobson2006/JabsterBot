const {
  all,
  get,
  run
} = require('../database');

const {
  parseIdList
} = require('./contentFilterWhitelist');
const { findRacistTerm } = require('./racismFilter');

function normalizeCensorTerm(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const LEET_MAP = Object.freeze({
  '0': 'o',
  '1': 'i',
  '2': 'z',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '6': 'g',
  '7': 't',
  '8': 'b',
  '9': 'g',
  '@': 'a',
  '$': 's'
});

function normalizeObfuscation(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f\u200B-\u200D\u2060\uFEFF]/g, '')
    .toLowerCase()
    .split('')
    .map(character => LEET_MAP[character] || character)
    .join('');
}

function collapseObfuscation(value) {
  return normalizeObfuscation(value).replace(/[^a-z0-9]+/g, '');
}

function flexibleExpression(term) {
  const characters = [...collapseObfuscation(term)];
  if (!characters.length) return null;
  const body = characters.map(escapeRegExp).join('[^a-z0-9]*');
  return new RegExp(`(?:^|[^a-z0-9])(${body})(?=$|[^a-z0-9])`, 'iu');
}

function findCensoredTerm(content, terms, matchMode = 'STRICT') {
  if (!content || !Array.isArray(terms)) return null;

  const normalizedContent = String(content).normalize('NFKC');
  const mode = String(matchMode || 'STRICT').toUpperCase();
  const configuredRacialTerms = new Set(
    terms.map(term => normalizeCensorTerm(term.normalizedWord || term.word || term))
  );
  const racialMatch = findRacistTerm(normalizedContent, configuredRacialTerms);

  if (racialMatch) {
    const configured = terms.find(term =>
      normalizeCensorTerm(term.normalizedWord || term.word || term) === racialMatch
    );
    return configured?.word || racialMatch;
  }

  for (const term of terms) {
    const normalized = normalizeCensorTerm(term.normalizedWord || term.word || term);
    if (!normalized) continue;

    if (mode === 'AGGRESSIVE') {
      const collapsedTerm = collapseObfuscation(normalized);
      if (collapsedTerm && collapseObfuscation(normalizedContent).includes(collapsedTerm)) {
        return term.word || normalized;
      }
      continue;
    }

    if (mode === 'FLEXIBLE') {
      if (flexibleExpression(normalized)?.test(normalizeObfuscation(normalizedContent))) {
        return term.word || normalized;
      }
      continue;
    }

    const phrase = escapeRegExp(normalized).replace(/ /g, '\\s+');
    const expression = new RegExp(
      `(?:^|[^\\p{L}\\p{N}])(${phrase})(?=$|[^\\p{L}\\p{N}])`,
      'iu'
    );

    if (expression.test(normalizedContent)) {
      return term.word || normalized;
    }
  }

  return null;
}

function getCensorSettings(guildId) {
  return get(
    `SELECT censorEnabled,
            censorAntiRacismEnabled,
            censorMatchMode,
            censorAction,
            censorRoleId,
            censorBypassRoleIds,
            censorBypassChannelIds,
            censorBypassCategoryIds
     FROM guild_settings
     WHERE guildId = ?`,
    [guildId]
  );
}

function setAntiRacismEnabled(guildId, enabled) {
  run(
    `INSERT INTO guild_settings (guildId, censorAntiRacismEnabled)
     VALUES (?, ?)
     ON CONFLICT(guildId) DO UPDATE SET censorAntiRacismEnabled = excluded.censorAntiRacismEnabled`,
    [guildId, enabled ? 1 : 0]
  );
}

function setCensorPolicy(guildId, matchMode, action) {
  const safeMode = ['STRICT', 'FLEXIBLE', 'AGGRESSIVE'].includes(String(matchMode).toUpperCase())
    ? String(matchMode).toUpperCase()
    : 'STRICT';
  const safeAction = ['DELETE', 'DELETE_WARN', 'TIMEOUT'].includes(String(action).toUpperCase())
    ? String(action).toUpperCase()
    : 'DELETE';

  run(
    `INSERT INTO guild_settings (guildId, censorMatchMode, censorAction)
     VALUES (?, ?, ?)
     ON CONFLICT(guildId) DO UPDATE SET
       censorMatchMode = excluded.censorMatchMode,
       censorAction = excluded.censorAction`,
    [guildId, safeMode, safeAction]
  );

  return { matchMode: safeMode, action: safeAction };
}

function getCensorBypassRoles(settings) {
  return parseIdList(settings?.censorBypassRoleIds);
}

function getCensorBypassChannels(settings) {
  return parseIdList(settings?.censorBypassChannelIds);
}

function getCensorBypassCategories(settings) {
  return parseIdList(settings?.censorBypassCategoryIds);
}

function listCensorTerms(guildId) {
  return all(
    `SELECT word, normalizedWord, addedBy, addedAt
     FROM censor_words
     WHERE guildId = ?
     ORDER BY word COLLATE NOCASE ASC`,
    [guildId]
  );
}

function addCensorTerm({ guildId, word, addedBy }) {
  const cleaned = String(word || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  const normalizedWord = normalizeCensorTerm(cleaned);

  if (!normalizedWord) {
    throw new Error('Enter a word or phrase to censor.');
  }

  run(
    `INSERT INTO censor_words (
       guildId, normalizedWord, word, addedBy, addedAt
     ) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(guildId, normalizedWord) DO UPDATE SET
       word = excluded.word,
       addedBy = excluded.addedBy,
       addedAt = excluded.addedAt`,
    [guildId, normalizedWord, cleaned, addedBy, Date.now()]
  );

  return cleaned;
}

function removeCensorTerm(guildId, word) {
  return run(
    `DELETE FROM censor_words
     WHERE guildId = ? AND normalizedWord = ?`,
    [guildId, normalizeCensorTerm(word)]
  ).changes;
}

module.exports = {
  addCensorTerm,
  collapseObfuscation,
  findCensoredTerm,
  getCensorBypassCategories,
  getCensorBypassChannels,
  getCensorBypassRoles,
  getCensorSettings,
  listCensorTerms,
  normalizeCensorTerm,
  removeCensorTerm,
  setAntiRacismEnabled,
  setCensorPolicy
};
