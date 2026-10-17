const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { Collection, EmbedBuilder, ChannelType } = require('discord.js');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'jabster-log-bursts-'));
process.env.DATABASE_PATH = path.join(temp, 'test.db');
const { db, get, all, run, initDatabase } = require('../database');
initDatabase();
const { queueLogBurst, deliverLogBurst } = require('../utils/logBursts');
const { retryChannelDeliveries } = require('../utils/deliveryOutbox');
test.beforeEach(() => {
  db.exec('DELETE FROM delivery_outbox; DELETE FROM guild_settings;');
  run("INSERT INTO guild_settings (guildId, serverLogChannelId, memberLogChannelId) VALUES ('guild', 'log', 'log')");
});
test.after(() => { db.close(); fs.rmSync(temp, { recursive: true, force: true }); });

function entry(overrides = {}) {
  return { guildId: 'guild', action: 'ROLE_UPDATED', type: 'SERVER', executorId: 'admin', targetId: 'role',
    metadata: { changes: ['Send Messages: allow -> deny', 'Long detail '.repeat(200)] },
    embed: new EmbedBuilder().setTitle('Role Updated'), ...overrides };
}
function clientFixture() {
  const messages = new Collection();
  const payloads = [];
  const channel = { type: ChannelType.GuildText, guild: { members: { me: {} } },
    permissionsFor: () => ({ has: () => true }), messages: { fetch: async () => messages },
    send: async payload => { payloads.push(payload);
      const msg = { id: `log-${payloads.length}`, author: { id: 'bot' }, embeds: payload.embeds };
      messages.set(msg.id, msg); return msg; } };
  return { client: { user: { id: 'bot' }, channels: { fetch: async () => channel } }, channel, payloads };
}

test('similar actor/action events are bundled; different guild, actor and action remain separate', () => {
  const first = queueLogBurst(entry());
  const second = queueLogBurst(entry({ targetId: 'role2' }));
  assert.equal(first.deliveryKey, second.deliveryKey);
  assert.equal(JSON.parse(second.payload).entries.length, 2);
  assert.notEqual(queueLogBurst(entry({ executorId: 'another' })).deliveryKey, first.deliveryKey);
  assert.notEqual(queueLogBurst(entry({ action: 'CHANNEL_UPDATED' })).deliveryKey, first.deliveryKey);
  assert.equal(queueLogBurst(entry({ action: 'BAN' })), null);
  assert.equal(queueLogBurst(entry({ executorId: null })), null);
  assert.equal(queueLogBurst(entry({ guildId: 'unconfigured' })), null);
});

test('batched logs keep every original metadata detail in an attachment and suppress mentions', async () => {
  const fixture = clientFixture();
  const row = queueLogBurst(entry());
  queueLogBurst(entry({ targetId: 'another-role' }));
  run('UPDATE delivery_outbox SET nextAttemptAt = 0');
  await retryChannelDeliveries(fixture.client);
  await retryChannelDeliveries(fixture.client);
  assert.equal(fixture.payloads.length, 1);
  const payload = fixture.payloads[0];
  assert.deepEqual(payload.allowedMentions, { parse: [] });
  assert.match(payload.embeds[0].data.title, /2 role updated events/);
  const details = JSON.parse(payload.files[0].attachment.toString());
  assert.equal(details.events.length, 2);
  assert.equal(details.events[0].metadata.changes[1], 'Long detail '.repeat(200));
  assert.equal(get('SELECT status FROM delivery_outbox WHERE deliveryKey = ?', [row.deliveryKey]).status, 'SENT');
});

test('claimed or retried batches are immutable and cannot absorb later events', () => {
  const first = queueLogBurst(entry());
  run("UPDATE delivery_outbox SET status = 'PROCESSING', attempts = 1 WHERE deliveryKey = ?", [first.deliveryKey]);
  const next = queueLogBurst(entry());
  assert.notEqual(next.deliveryKey, first.deliveryKey);
  assert.equal(JSON.parse(get('SELECT payload FROM delivery_outbox WHERE deliveryKey = ?', [first.deliveryKey]).payload).entries.length, 1);
});

test('queued batches survive a fresh process and recover a lost send response using their reference', async () => {
  const row = queueLogBurst(entry());
  const child = spawnSync(process.execPath, ['-e', `const {get,db}=require('./database');
    if(JSON.parse(get("SELECT payload FROM delivery_outbox WHERE type='LOG_BURST'").payload).entries.length!==1)process.exit(2);db.close();`],
  { cwd: path.resolve(__dirname, '..'), env: { ...process.env }, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const fixture = clientFixture();
  run('UPDATE delivery_outbox SET nextAttemptAt = 0');
  const send = fixture.channel.send;
  fixture.channel.send = async payload => { await send(payload); throw new Error('Lost response'); };
  await assert.rejects(deliverLogBurst(fixture.client, row), /Lost response/);
  run('UPDATE delivery_outbox SET nextAttemptAt = 0');
  fixture.channel.send = send;
  await deliverLogBurst(fixture.client, row);
  assert.equal(fixture.payloads.length, 1);
});

test('missing attachment permission retries instead of silently dropping full details', async () => {
  const row = queueLogBurst(entry());
  queueLogBurst(entry());
  run('UPDATE delivery_outbox SET nextAttemptAt = 0');
  const fixture = clientFixture();
  fixture.channel.permissionsFor = () => ({ has: permission => permission !== 'AttachFiles' });
  await assert.rejects(deliverLogBurst(fixture.client, row), /Attach Files/);
  assert.equal(fixture.payloads.length, 0);
  assert.equal(all("SELECT * FROM delivery_outbox WHERE status = 'FAILED'").length, 1);
});
