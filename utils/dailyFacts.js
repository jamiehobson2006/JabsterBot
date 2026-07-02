const {
  all
} = require('../database');

const codedFacts =
  require('../data/dailyFacts.json');

const FACT_CATEGORIES = [
  {
    name: 'Animals',
    value: 'animals'
  },
  {
    name: 'Science',
    value: 'science'
  },
  {
    name: 'Space',
    value: 'space'
  },
  {
    name: 'History',
    value: 'history'
  },
  {
    name: 'Technology',
    value: 'technology'
  },
  {
    name: 'Geography',
    value: 'geography'
  },
  {
    name: 'Nature',
    value: 'nature'
  },
  {
    name: 'Human Body',
    value: 'humanbody'
  },
  {
    name: 'Ocean',
    value: 'ocean'
  }
];

function normalizeFact(fact) {

  return String(fact || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function cleanFact(fact) {

  return String(fact || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function categoryName(category) {

  if (category === 'random') {

    return 'Random';
  }

  return FACT_CATEGORIES.find(item =>
    item.value === category
  )?.name || category || 'Unknown';
}

function isRealCategory(category) {

  return FACT_CATEGORIES.some(item =>
    item.value === category
  );
}

function codedFactRows() {

  const rows = [];

  for (
    const [category, facts] of
    Object.entries(codedFacts)
  ) {

    if (!Array.isArray(facts)) {
      continue;
    }

    for (const fact of facts) {

      const cleaned =
        cleanFact(fact);

      if (!cleaned) {
        continue;
      }

      rows.push({
        fact: cleaned,
        category,
        source: 'coded',
        status: 'APPROVED'
      });
    }
  }

  return rows;
}

function submittedFactRows() {

  return all(

    `SELECT id, guildId, userId, fact, category, status
     FROM dailyfact_submissions`
  ).map(row => ({
    ...row,
    fact: cleanFact(row.fact),
    category: row.category || 'random',
    source: 'submission'
  }));
}

function findDuplicateFact(
  fact,
  {
    excludeSubmissionId = null
  } = {}
) {

  const normalized =
    normalizeFact(fact);

  if (!normalized) {

    return null;
  }

  const codedDuplicate =
    codedFactRows().find(row =>
      normalizeFact(row.fact) === normalized
    );

  if (codedDuplicate) {

    return codedDuplicate;
  }

  return submittedFactRows().find(row =>
    row.id !== excludeSubmissionId &&
    normalizeFact(row.fact) === normalized
  ) || null;
}

function buildDailyFactPools() {

  const byCategory = {};
  const allFacts = [];
  const seenByCategory = {};
  const seenAll = new Set();

  for (const category of FACT_CATEGORIES) {

    byCategory[category.value] = [];
    seenByCategory[category.value] = new Set();
  }

  const addToPool = row => {

    const normalized =
      normalizeFact(row.fact);

    if (!normalized) {
      return;
    }

    if (!seenAll.has(normalized)) {

      seenAll.add(normalized);

      allFacts.push({
        fact: row.fact,
        category: isRealCategory(row.category)
          ? row.category
          : 'random',
        source: row.source
      });
    }

    if (
      isRealCategory(row.category) &&
      !seenByCategory[row.category].has(normalized)
    ) {

      seenByCategory[row.category].add(normalized);

      byCategory[row.category].push({
        fact: row.fact,
        category: row.category,
        source: row.source
      });
    }
  };

  for (const row of codedFactRows()) {
    addToPool(row);
  }

  for (
    const row of
    submittedFactRows().filter(item =>
      item.status === 'APPROVED'
    )
  ) {
    addToPool(row);
  }

  return {
    all: allFacts,
    byCategory
  };
}

function getFactsForCategory(category) {

  const pools =
    buildDailyFactPools();

  if (
    category === 'random' ||
    !isRealCategory(category)
  ) {

    return pools.all;
  }

  return pools.byCategory[category] || [];
}

module.exports = {
  FACT_CATEGORIES,
  normalizeFact,
  cleanFact,
  categoryName,
  isRealCategory,
  findDuplicateFact,
  buildDailyFactPools,
  getFactsForCategory
};
