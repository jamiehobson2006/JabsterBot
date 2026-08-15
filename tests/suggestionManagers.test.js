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
      'jabster-studios-suggestion-managers-'
    )
  );

process.env.DATABASE_PATH =
  path.join(tempDir, 'database.db');

const {
  initDatabase
} = require('../database');

const {
  addSuggestionManagerRole,
  listSuggestionManagerRoles,
  memberCanManageSuggestions,
  removeSuggestionManagerRole
} = require('../utils/suggestions/managers');

test(
  'suggestion manager roles persist and grant suggestion review access',
  () => {
    initDatabase();

    const added =
      addSuggestionManagerRole({
        guildId: 'guild-1',
        roleId: 'role-1',
        addedBy: 'admin-1'
      });

    assert.equal(added.changes, 1);
    assert.equal(
      addSuggestionManagerRole({
        guildId: 'guild-1',
        roleId: 'role-1',
        addedBy: 'admin-1'
      }).changes,
      0
    );

    initDatabase();

    assert.deepEqual(
      listSuggestionManagerRoles('guild-1')
        .map(manager => manager.roleId),
      ['role-1']
    );

    assert.equal(
      memberCanManageSuggestions(
        {
          roles: {
            cache: new Map([['role-1', {}]])
          }
        },
        'guild-1'
      ),
      true
    );

    assert.equal(
      memberCanManageSuggestions(
        {
          roles: {
            cache: new Map()
          }
        },
        'guild-1'
      ),
      false
    );

    assert.equal(
      removeSuggestionManagerRole({
        guildId: 'guild-1',
        roleId: 'role-1'
      }).changes,
      1
    );

    assert.equal(
      listSuggestionManagerRoles('guild-1').length,
      0
    );
  }
);
