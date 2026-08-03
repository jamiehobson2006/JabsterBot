const {
  all,
  get,
  run
} = require('../database');

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

function findCensoredTerm(content, terms) {
  if (!content || !Array.isArray(terms)) {
    return null;
  }

  for (const term of terms) {
    const normalized = normalizeCensorTerm(term.normalizedWord || term.word || term);
    if (!normalized) continue;

    const phrase = escapeRegExp(normalized).replace(/ /g, '\\s+');
    const expression = new RegExp(
      `(?:^|[^\\p{L}\\p{N}])(${phrase})(?=$|[^\\p{L}\\p{N}])`,
      'iu'
    );

    if (expression.test(content.normalize('NFKC'))) {
      return term.word || normalized;
    }
  }

  return null;
}

function getCensorSettings(guildId) {
  return get(
    `SELECT censorEnabled, censorRoleId
     FROM guild_settings
     WHERE guildId = ?`,
    [guildId]
  );
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
       guildId,
       normalizedWord,
       word,
       addedBy,
       addedAt
     )
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(guildId, normalizedWord)
     DO UPDATE SET word = excluded.word,
                   addedBy = excluded.addedBy,
                   addedAt = excluded.addedAt`,
    [guildId, normalizedWord, cleaned, addedBy, Date.now()]
  );

  return cleaned;
}

function removeCensorTerm(guildId, word) {
  return run(
    `DELETE FROM censor_words
     WHERE guildId = ?
     AND normalizedWord = ?`,
    [guildId, normalizeCensorTerm(word)]
  ).changes;
}

module.exports = {
  addCensorTerm,
  findCensoredTerm,
  getCensorSettings,
  listCensorTerms,
  normalizeCensorTerm,
  removeCensorTerm
};
