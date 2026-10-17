const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'jabster-response-times-'));
process.env.DATABASE_PATH = path.join(temp, 'test.db');
const { db, get, run, initDatabase } = require('../database');
initDatabase();
const { recordTicketReply, responseEstimate, resolutionAge, setWaiting } = require('../utils/tickets/responseTimes');
const { checkTicketSlas } = require('../services/TicketSlaService');
test.beforeEach(() => db.exec('DELETE FROM tickets; DELETE FROM ticket_response_samples; DELETE FROM ticket_sla_settings; DELETE FROM ticket_sla_alerts; DELETE FROM ticket_settings; DELETE FROM application_forms; DELETE FROM application_responses;'));
test.after(() => { db.close(); fs.rmSync(temp, { recursive: true, force: true }); });
function ticket(channelId = 'ticket', type = 'support', roleId = 'support-role', guildId = 'guild') {
  run(`INSERT INTO tickets (guildId, channelId, userId, type, createdAt, status, responseRoleId)
    VALUES (?, ?, 'opener', ?, 1000000, 'OPEN', ?)`, [guildId, channelId, type, roleId]);
  return get('SELECT * FROM tickets WHERE channelId = ?', [channelId]);
}

test('response estimates are N/A without measured replies, never zero or a different role estimate', () => {
  ticket();
  assert.equal(responseEstimate('guild', 'support', 'support-role').label, 'N/A');
  assert.equal(responseEstimate('guild', 'support', null).label, 'N/A');
});

test('real ticket creation saves the configured application reviewer role and displays its own estimate', async () => {
  const { ChannelType } = require('discord.js');
  const { createForm } = require('../utils/applications');
  const { createTicket } = require('../utils/tickets/createTicket');
  createForm({ guildId: 'guild', name: 'Developer', reviewerRoleId: 'developers', createdBy: 'admin' });
  const form = get("SELECT * FROM application_forms WHERE guildId='guild'");
  assert.ok(form);
  run(`INSERT INTO ticket_settings (guildId, type, enabled, roleId, categoryId)
    VALUES ('guild', 'application', 1, 'general', 'category')`);
  run(`INSERT INTO ticket_response_samples (guildId, channelId, type, roleId, responseMs, recordedAt)
    VALUES ('guild', 'old-app', 'application', 'developers', 600000, 1)`);
  const messages = [];
  const category = { id: 'category', type: ChannelType.GuildCategory, permissionsFor: () => ({ has: () => true }) };
  const guild = { id: 'guild', members: { me: {} }, roles: { everyone: { id: 'everyone' },
    cache: new Map([['developers', { id: 'developers' }], ['general', { id: 'general' }]]) },
  channels: { cache: new Map([['category', category]]), create: async () => ({ id: 'new-app',
    send: async payload => { messages.push(payload); return { id: 'starter' }; } }) } };
  const interaction = { id: 'request', guild, user: { id: 'applicant', username: 'applicant', tag: 'Applicant', toString: () => '<@applicant>' },
    client: { user: { id: 'bot' } } };
  await createTicket({ interaction, type: 'application', application: { form, answers: [] } });
  assert.equal(get("SELECT responseRoleId FROM tickets WHERE channelId='new-app'").responseRoleId, 'developers');
  const estimate = messages[0].embeds[0].data.fields.find(field => field.name === 'Average First Staff Response');
  assert.equal(estimate.value, '10m');
});

test('averages are isolated by guild, ticket type and application reviewer role', () => {
  for (const [id, type, role, guild, ms] of [
    ['a', 'application', 'mods', 'guild', 60000], ['b', 'application', 'mods', 'guild', 180000],
    ['c', 'application', 'helpers', 'guild', 600000], ['d', 'support', 'mods', 'guild', 900000],
    ['e', 'application', 'mods', 'other', 1200000]]) {
    recordTicketReply(ticket(id, type, role, guild), { userId: 'staff', isStaff: true, roleId: 'changed-role', now: 1000000 + ms });
  }
  assert.deepEqual(responseEstimate('guild', 'application', 'mods'), { count: 2, averageMs: 120000, label: '2m' });
  assert.equal(responseEstimate('guild', 'application', 'helpers').label, '10m');
  assert.equal(responseEstimate('guild', 'support', 'mods').label, '15m');
  assert.equal(responseEstimate('other', 'application', 'mods').label, '20m');
});

test('only first staff reply is sampled; opener with staff permissions does not sample their own reply', () => {
  const saved = ticket();
  recordTicketReply(saved, { userId: 'opener', isStaff: true, now: 1100000 });
  assert.equal(get('SELECT firstStaffResponseAt FROM tickets').firstStaffResponseAt, null);
  recordTicketReply(saved, { userId: 'staff', isStaff: true, now: 1120000 });
  recordTicketReply(saved, { userId: 'staff2', isStaff: true, now: 1300000 });
  assert.equal(responseEstimate('guild', 'support', 'support-role').count, 1);
  assert.equal(responseEstimate('guild', 'support', 'support-role').averageMs, 120000);
});

test('waiting states pause only resolution SLA and resume automatically on member replies', () => {
  const saved = ticket();
  assert.throws(() => setWaiting(saved.channelId, 'MEMBER', 1100000), /Reply/);
  recordTicketReply(saved, { userId: 'staff', isStaff: true, now: 1120000 });
  const paused = get('SELECT * FROM tickets');
  assert.equal(paused.waitingOn, 'MEMBER');
  assert.equal(resolutionAge(paused, 1500000), 120000);
  recordTicketReply(saved, { userId: 'opener', isStaff: false, now: 1500000 });
  const resumed = get('SELECT * FROM tickets');
  assert.equal(resumed.waitingOn, 'STAFF');
  assert.equal(resumed.memberWaitMs, 380000);
  assert.equal(resolutionAge(resumed, 1560000), 180000);
  setWaiting(saved.channelId, 'STAFF', 1590000);
  assert.equal(get('SELECT memberWaitMs FROM tickets').memberWaitMs, 380000);
});

test('waiting states and response samples survive a fresh process and ticket retention cleanup', () => {
  const saved = ticket();
  recordTicketReply(saved, { userId: 'staff', isStaff: true, now: 1120000 });
  const child = spawnSync(process.execPath, ['-e', `const {initDatabase,get,db}=require('./database');initDatabase();
    if(get('SELECT waitingOn FROM tickets').waitingOn !== 'MEMBER')process.exit(2);
    if(require('./utils/tickets/responseTimes').responseEstimate('guild','support','support-role').averageMs!==120000)process.exit(3);db.close();`],
  { cwd: path.resolve(__dirname, '..'), env: { ...process.env }, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  run('DELETE FROM tickets');
  assert.equal(responseEstimate('guild', 'support', 'support-role').label, '2m');
});

test('SLA alerting respects member-wait pauses but still catches unanswered tickets', async () => {
  const saved = ticket();
  run(`INSERT INTO ticket_sla_settings (guildId, enabled, firstResponseMinutes, resolutionMinutes) VALUES ('guild', 1, 1, 2)`);
  recordTicketReply(saved, { userId: 'staff', isStaff: true, now: 1060000 });
  const sent = [];
  const client = { channels: { fetch: async () => ({ isTextBased: () => true, send: async payload => { sent.push(payload); } }) } };
  await checkTicketSlas(client, 2000000);
  assert.equal(sent.length, 0);
  recordTicketReply(saved, { userId: 'opener', isStaff: false, now: 2000000 });
  await checkTicketSlas(client, 2061000);
  assert.equal(sent.length, 1);
  assert.match(sent[0].embeds[0].data.title, /Resolution/);
  ticket('unanswered');
  await checkTicketSlas(client, 2120000);
  assert.equal(sent.length, 3);
});
