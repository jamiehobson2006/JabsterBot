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

const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), 'jabster-studios-censor-')
);

process.env.DATABASE_PATH = path.join(tempDir, 'database.db');

const {
  initDatabase
} = require('../database');

const {
  addCensorTerm,
  findCensoredTerm,
  listCensorTerms,
  removeCensorTerm
} = require('../utils/censor');

test('censor terms match words and phrases without matching inside other words', () => {
  initDatabase();

  addCensorTerm({
    guildId: 'guild-1',
    word: 'bad word',
    addedBy: 'staff-1'
  });

  const terms = listCensorTerms('guild-1');

  assert.equal(findCensoredTerm('That BAD   WORD should be deleted.', terms), 'bad word');
  assert.equal(findCensoredTerm('bad wording is allowed.', terms), null);
  assert.equal(removeCensorTerm('guild-1', 'BAD WORD'), 1);
  assert.equal(listCensorTerms('guild-1').length, 0);
});
