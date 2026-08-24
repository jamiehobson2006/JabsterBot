const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), 'jabster-studios-server-controls-')
);

process.env.DATABASE_PATH = path.join(tempDir, 'database.db');

const {
  initDatabase,
  run
} = require('../database');

const {
  addCommandBypass,
  getCommandAvailability,
  resetCommandControl,
  setCommandEnabled
} = require('../utils/commandControls');

const {
  addAntiSpamBypass,
  clearAntiSpamRuntime,
  evaluateAntiSpam
} = require('../utils/antispam');

const {
  getTicketTarget,
  listTicketTargets,
  setTicketTarget
} = require('../utils/ticketTargets');

const {
  VERSION_ONE_CONTENT,
  createChangelogEntry,
  getChangelogEntry,
  setChangelogSettings
} = require('../utils/changelog');

function commandInteraction({ roleIds = [], channelId = 'general', categoryId = null } = {}) {
  return {
    commandName: 'poll',
    guild: { id: 'guild-1' },
    channelId,
    channel: { parentId: categoryId },
    member: { roles: { cache: new Map(roleIds.map(id => [id, {}])) } }
  };
}

function message({ userId = 'user-1', content = 'hello', roleIds = [], mentionCount = 0 } = {}) {
  return {
    content,
    author: { id: userId },
    guild: { id: 'guild-1' },
    member: { roles: { cache: new Map(roleIds.map(id => [id, {}])) } },
    channel: { id: 'general', parentId: null },
    mentions: {
      users: { size: mentionCount },
      roles: { size: 0 }
    }
  };
}

test('command controls persist disabled commands and scoped bypasses', () => {
  initDatabase();

  setCommandEnabled({
    guildId: 'guild-1',
    commandName: '/poll',
    enabled: false,
    reason: 'Polls are being redesigned.',
    updatedBy: 'admin-1'
  });

  assert.deepEqual(getCommandAvailability(commandInteraction()), {
    allowed: false,
    reason: 'Polls are being redesigned.'
  });

  addCommandBypass({
    guildId: 'guild-1',
    commandName: 'poll',
    type: 'ROLE',
    valueId: 'event-team',
    addedBy: 'admin-1'
  });

  assert.deepEqual(
    getCommandAvailability(commandInteraction({ roleIds: ['event-team'] })),
    { allowed: true, reason: null }
  );

  resetCommandControl('guild-1', 'poll');
  assert.deepEqual(getCommandAvailability(commandInteraction()), {
    allowed: true,
    reason: null
  });
});

test('anti-spam detects duplicates and honours a persistent role bypass', () => {
  initDatabase();

  run(
    `INSERT INTO antispam_settings (
       guildId, enabled, maxMessages, intervalSeconds,
       duplicateLimit, duplicateWindowSeconds, mentionLimit,
       timeoutSeconds, updatedAt
     )
     VALUES (?, 1, 10, 60, 2, 60, 10, 0, ?)`,
    ['guild-1', Date.now()]
  );

  clearAntiSpamRuntime('guild-1', 'user-1');
  assert.equal(evaluateAntiSpam(message()), null);
  assert.equal(evaluateAntiSpam(message())?.rule, 'DUPLICATE_MESSAGES');

  addAntiSpamBypass({
    guildId: 'guild-1',
    type: 'ROLE',
    valueId: 'trusted',
    addedBy: 'admin-1'
  });

  clearAntiSpamRuntime('guild-1', 'user-2');
  assert.equal(
    evaluateAntiSpam(message({ userId: 'user-2', roleIds: ['trusted'] })),
    null
  );
});

test('ticket targets and changelog drafts are stored in SQLite', () => {
  initDatabase();

  setTicketTarget({
    guildId: 'guild-1',
    type: 'support',
    responseMinutes: 30,
    resolveMinutes: 1440,
    alertChannelId: 'staff-alerts',
    alertRoleId: 'staff',
    updatedBy: 'admin-1'
  });

  assert.equal(getTicketTarget('guild-1', 'support').responseMinutes, 30);
  assert.equal(listTicketTargets('guild-1').length, 1);

  setChangelogSettings({
    guildId: 'guild-1',
    publishChannelId: 'updates',
    reviewChannelId: 'staff-review',
    reviewerRoleId: 'reviewers',
    updatedBy: 'admin-1'
  });

  const id = createChangelogEntry({
    guildId: 'guild-1',
    version: 'Version 1.0',
    title: 'Everything Added So Far',
    content: VERSION_ONE_CONTENT,
    createdBy: 'admin-1'
  });

  const entry = getChangelogEntry('guild-1', id);
  assert.equal(entry.status, 'DRAFT');
  assert.match(entry.content, /Moderation and safety/);
  assert.match(VERSION_ONE_CONTENT, /temporary voice rooms/i);
});
