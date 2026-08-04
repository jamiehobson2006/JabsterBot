const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), 'jabster-studios-config-')
);

process.env.DATABASE_PATH = path.join(tempDir, 'database.db');

const {
  getLinkWhitelist,
  serializeLinkWhitelist
} = require('../utils/linkWhitelist');

const {
  parseIdList,
  stringifyIdList
} = require('../utils/levelingConfig');

test('link whitelist supports legacy and multi-role settings without duplicates', () => {
  const roles = getLinkWhitelist({
    linkBypassRoleId: 'role-1',
    linkBypassRoleIds: '["role-1", "role-2"]'
  });

  assert.deepEqual(roles, ['role-1', 'role-2']);
  assert.deepEqual(JSON.parse(serializeLinkWhitelist(['role-2', 'role-2', 'role-3'])), ['role-2', 'role-3']);
});

test('leveling ID lists read legacy data and save a stable list format', () => {
  assert.deepEqual(parseIdList('channel-1, channel-2, channel-1'), ['channel-1', 'channel-2']);
  assert.deepEqual(parseIdList('["channel-2", "channel-3"]'), ['channel-2', 'channel-3']);
  assert.deepEqual(JSON.parse(stringifyIdList(['channel-3', 'channel-3', 'channel-4'])), ['channel-3', 'channel-4']);
});
