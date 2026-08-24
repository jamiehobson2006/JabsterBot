const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), 'jabster-studios-logging-config-')
);

process.env.DATABASE_PATH = path.join(tempDir, 'database.db');

const {
  initDatabase,
  run
} = require('../database');

const {
  addLoggingManagerRole,
  disableLogCategory,
  getLogDestination,
  getLogCategoryStates,
  listLoggingManagerRoles,
  memberCanManageLogging,
  removeLoggingManagerRole,
  setLogDestination
} = require('../utils/loggingConfig');

const {
  splitFieldText
} = require('../utils/logger');

test('long audit details are split into readable embed fields', () => {
  const details = [
    'First permission change',
    'Second permission change',
    'Third permission change'
  ].join('\n').repeat(90);

  const fields = splitFieldText(details);

  assert.ok(fields.length > 1);
  assert.ok(fields.every(field => field.length <= 1024));
  assert.match(fields.join('\n'), /First permission change/);
});

test('logging categories route independently and remain disabled after restart', () => {
  initDatabase();

  run(
    `INSERT INTO guild_settings (
       guildId,
       modlogChannelId,
       messageLogChannelId
     )
     VALUES (?, ?, ?)`,
    ['guild-1', 'moderation-log', 'legacy-message-log']
  );

  assert.deepEqual(
    getLogDestination('guild-1', 'MODERATION'),
    {
      enabled: true,
      channelId: 'moderation-log',
      source: 'legacy'
    }
  );

  run(
    `INSERT INTO audit_logs (
       guildId,
       action,
       type,
       timestamp
     )
     VALUES (?, ?, ?, ?)`,
    ['guild-1', 'MESSAGE_DELETED', 'MESSAGES', 1_000]
  );

  assert.equal(
    getLogCategoryStates('guild-1')
      .find(category => category.type === 'MESSAGES')
      .lastLoggedAt,
    1_000
  );

  assert.deepEqual(
    getLogDestination('guild-1', 'MESSAGES'),
    {
      enabled: true,
      channelId: 'legacy-message-log',
      source: 'legacy'
    }
  );

  setLogDestination({
    guildId: 'guild-1',
    type: 'MESSAGES',
    channelId: 'message-log'
  });

  assert.equal(
    getLogDestination('guild-1', 'MESSAGES').channelId,
    'message-log'
  );

  disableLogCategory({
    guildId: 'guild-1',
    type: 'MESSAGES'
  });

  initDatabase();

  assert.deepEqual(
    getLogDestination('guild-1', 'MESSAGES'),
    {
      enabled: false,
      channelId: null,
      source: 'configured'
    }
  );
});

test('logging manager roles persist and grant dashboard access', () => {
  initDatabase();

  assert.equal(
    addLoggingManagerRole({
      guildId: 'guild-2',
      roleId: 'log-manager',
      addedBy: 'admin-1'
    }).changes,
    1
  );

  initDatabase();

  assert.deepEqual(
    listLoggingManagerRoles('guild-2')
      .map(role => role.roleId),
    ['log-manager']
  );

  assert.equal(
    memberCanManageLogging(
      {
        roles: {
          cache: new Map([['log-manager', {}]])
        }
      },
      'guild-2'
    ),
    true
  );

  assert.equal(
    removeLoggingManagerRole({
      guildId: 'guild-2',
      roleId: 'log-manager'
    }).changes,
    1
  );
});
