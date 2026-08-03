const assert =
  require('node:assert/strict');

const fs =
  require('node:fs');

const os =
  require('node:os');

const path =
  require('node:path');

const test =
  require('node:test');

const tempDir =
  fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      'jabster-studios-dailyfacts-'
    )
  );

process.env.DATABASE_PATH =
  path.join(
    tempDir,
    'database.db'
  );

const {
  get,
  initDatabase
} = require('../database');

const {
  findDuplicateFact,
  getFactsForCategory,
  saveApprovedFact
} = require('../utils/dailyFacts');

test(
  'approved Daily Facts are saved globally and available to every fact pool',
  () => {
    initDatabase();

    const approved =
      saveApprovedFact({
        submissionId: 1,
        userId: 'user-1',
        reviewerId: 'admin-1',
        fact: 'A day on Venus is longer than a year on Venus.',
        category: 'space',
        approvedAt: 12345
      });

    assert.equal(
      approved.category,
      'space'
    );

    const row =
      get(
        `SELECT *
         FROM dailyfact_facts
         WHERE normalizedFact = ?`,
        [
          'a day on venus is longer than a year on venus'
        ]
      );

    assert.equal(
      row.fact,
      'A day on Venus is longer than a year on Venus.'
    );

    assert.equal(
      row.sourceSubmissionId,
      1
    );

    assert.ok(
      getFactsForCategory('space')
        .some(fact =>
          fact.fact === row.fact &&
          fact.source === 'community'
        )
    );

    assert.ok(
      getFactsForCategory('random')
        .some(fact =>
          fact.fact === row.fact &&
          fact.source === 'community'
        )
    );

    const duplicate =
      findDuplicateFact(
        'A day on Venus is longer than a year on Venus.'
      );

    assert.equal(
      duplicate.source,
      'community'
    );
  }
);
