const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { PermissionFlagsBits, PermissionsBitField } = require('discord.js');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jabster-role-logging-'));
process.env.DATABASE_PATH = path.join(directory, 'test.db');
const { db, initDatabase } = require('../database');
initDatabase();
const logger = require('../utils/logger');
const audit = require('../utils/auditLookup');
test.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });

function handler(t) {
  const logs = [];
  let lookups = 0;
  t.mock.method(logger, 'logAudit', async (...args) => { logs.push(args[2]); });
  t.mock.method(audit, 'findRecentAuditLog', async () => { lookups++; return null; });
  delete require.cache[require.resolve('../events/roleUpdate')];
  return { event: require('../events/roleUpdate'), logs, lookups: () => lookups };
}

function role(id, position) {
  return { id, position, guild: { id: 'guild' }, name: `Role ${id}`, hexColor: '#000000',
    hoist: false, mentionable: false, icon: null, unicodeEmoji: null,
    permissions: new PermissionsBitField(PermissionFlagsBits.ViewChannel) };
}

test('dragging a role past many neighbours creates no position-only logs or audit lookups', async t => {
  const context = handler(t);
  for (let index = 1; index <= 80; index++) {
    const before = role(String(index), index);
    await context.event.execute(before, { ...before, position: index + 1 }, {});
  }
  assert.equal(context.logs.length, 0);
  assert.equal(context.lookups(), 0);
});

test('permission changes still log precisely even if hierarchy positions also change', async t => {
  const context = handler(t);
  const before = role('staff', 5);
  const after = { ...before, position: 8,
    permissions: new PermissionsBitField([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageMessages]) };
  await context.event.execute(before, after, {});
  assert.equal(context.logs.length, 1);
  assert.deepEqual(context.logs[0].metadata.changes, ['Permissions added: Manage Messages']);
  assert.equal(context.logs[0].action, 'ROLE_UPDATED');
});

test('role names and display settings remain logged without collateral position entries', async t => {
  const context = handler(t);
  const before = role('helper', 3);
  await context.event.execute(before, { ...before, position: 10, name: 'Community Helper', hoist: true }, {});
  assert.equal(context.logs.length, 1);
  assert.equal(context.logs[0].metadata.changes.length, 2);
  assert.equal(context.logs[0].metadata.changes.some(change => change.startsWith('Position:')), false);
});
