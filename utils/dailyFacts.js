const {
  all,
  get,
  run
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
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function cleanFact(fact) {

  return String(fact || '')
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
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
        factKey: `fact:${normalizeFact(cleaned)}`,
        legacyFactKeys: [`coded:${normalizeFact(cleaned)}`],
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

function approvedFactRows() {

  return all(

    `SELECT id, fact, category, sourceSubmissionId, submittedBy, approvedBy, approvedAt,
       sourceUrl, verifiedAt, verifiedBy, verificationNote
     FROM dailyfact_facts`
  ).map(row => ({
    ...row,
    fact: cleanFact(row.fact),
    category: row.category || 'random',
    source: 'community',
    factKey: `fact:${normalizeFact(row.fact)}`,
    legacyFactKeys: [`community:${row.id}`, `coded:${normalizeFact(row.fact)}`]
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

  const approvedDuplicate =
    approvedFactRows().find(row =>
      row.sourceSubmissionId !== excludeSubmissionId &&
      normalizeFact(row.fact) === normalized
    );

  if (approvedDuplicate) {

    return approvedDuplicate;
  }

  return submittedFactRows().find(row =>
    row.id !== excludeSubmissionId &&
    normalizeFact(row.fact) === normalized
  ) || null;
}

function saveApprovedFact({
  submissionId = null,
  userId = null,
  reviewerId = null,
  fact,
  category = 'random',
  approvedAt = Date.now(), sourceUrl = null, verifiedAt = null, verifiedBy = null, verificationNote = null
}) {

  const cleaned =
    cleanFact(fact);

  const normalized =
    normalizeFact(cleaned);
  const validatedSource = require('./factSources').validateSourceUrl(sourceUrl);

  if (!normalized || cleaned.length < 20 || cleaned.length > 500) {

    throw new Error(
      'Daily Facts must contain between 20 and 500 characters.'
    );
  }

  run(

    `INSERT INTO dailyfact_facts (
       fact,
       normalizedFact,
       category,
       sourceSubmissionId,
       submittedBy,
       approvedBy,
       approvedAt
     )
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(normalizedFact)
     DO UPDATE SET
       fact = excluded.fact,
       category = excluded.category,
       sourceSubmissionId = COALESCE(
         excluded.sourceSubmissionId,
         dailyfact_facts.sourceSubmissionId
       ),
       submittedBy = COALESCE(
         excluded.submittedBy,
         dailyfact_facts.submittedBy
       ),
       approvedBy = excluded.approvedBy,
       approvedAt = excluded.approvedAt`,
    [
      cleaned,
      normalized,
      category || 'random',
      submissionId,
      userId,
      reviewerId,
      approvedAt
    ]
  );

  run(`UPDATE dailyfact_facts SET sourceUrl = ?, verifiedAt = ?, verifiedBy = ?, verificationNote = ?
       WHERE normalizedFact = ?`, [validatedSource, validatedSource ? verifiedAt : null,
    verifiedBy, verificationNote, normalized]);

  return get(

    `SELECT *
     FROM dailyfact_facts
     WHERE normalizedFact = ?`,
    [normalized]
  );
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
        sourceUrl: row.sourceUrl, verifiedAt: row.verifiedAt, id: row.id,
        fact: row.fact,
        category: isRealCategory(row.category)
          ? row.category
          : 'random',
        source: row.source,
        factKey: row.factKey || `fact:${normalized}`,
        legacyFactKeys: row.legacyFactKeys || []
      });
    }

    if (
      isRealCategory(row.category) &&
      !seenByCategory[row.category].has(normalized)
    ) {

      seenByCategory[row.category].add(normalized);

      byCategory[row.category].push({
        sourceUrl: row.sourceUrl, verifiedAt: row.verifiedAt, id: row.id,
        fact: row.fact,
        category: row.category,
        source: row.source,
        factKey: row.factKey || `fact:${normalized}`,
        legacyFactKeys: row.legacyFactKeys || []
      });
    }
  };

  for (
    const row of
    approvedFactRows()
  ) {
    addToPool(row);
  }
  for (const row of codedFactRows()) {
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
  saveApprovedFact,
  approvedFactRows,
  buildDailyFactPools,
  getFactsForCategory
};
