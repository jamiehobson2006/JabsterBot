const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Collection, PermissionFlagsBits, PermissionsBitField } = require('discord.js');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'jabster-audit-security-'));
process.env.DATABASE_PATH = path.join(temporary, 'test.db');
const { db, get, run, initDatabase } = require('../database');
initDatabase();
test.after(() => { db.close(); fs.rmSync(temporary, { recursive: true, force: true }); });

test('transcript recovery requires exact ticket identity, attachment, channel and bot author', async () => {
  const { findExistingTranscript } = require('../utils/tickets/transcript');
  const ticket = { id: 1, channelId: 'ticket-one', transcriptMessageId: 'wrong', transcriptArchiveChannelId: 'archive' };
  const message = (id, author, identity, name = 'ticket-ticket-one.html') => ({ id, channelId: 'archive', author: { id: author },
    embeds: [{ fields: [{ name: 'Ticket', value: `Ticket name\nID: ${identity}` }] }],
    attachments: new Collection([['file', { name }]]) });
  const wrong = message('wrong', 'bot', 12);
  const forged = message('forged', 'human', 1);
  const missingAttachment = message('missing-file', 'bot', 1, 'another.html');
  const correct = message('right', 'bot', 1);
  let rows = new Collection([wrong, forged, missingAttachment, correct].map(item => [item.id,item]));
  const channel = { id: 'archive', client: { user: { id: 'bot' } }, messages: { fetch: async value =>
    typeof value === 'string' ? rows.get(value) : rows } };
  assert.equal((await findExistingTranscript(channel, ticket, 'legacy-marker')).id, 'right');
  rows = new Collection([[wrong.id,wrong],[forged.id,forged],[missingAttachment.id,missingAttachment]]);
  assert.equal(await findExistingTranscript(channel, ticket, 'legacy-marker'), null);
});

test('automated roles reject every staff permission and channel overwrite, with transient failures distinguished', () => {
  const { AUTOMATION_BLOCKED_PERMISSIONS, automaticRoleSafetyIssue } = require('../utils/roleSafety');
  const guild = { id: 'guild', members: { me: { permissions: new PermissionsBitField(PermissionFlagsBits.ManageRoles), roles: { highest: { position: 100 } } } },
    channels: { cache: new Collection() } };
  const role = { id: 'reward', managed: false, position: 1, permissions: new PermissionsBitField() };
  assert.equal(automaticRoleSafetyIssue(guild, role), null);
  for (const permission of AUTOMATION_BLOCKED_PERMISSIONS) {
    role.permissions = new PermissionsBitField(permission);
    assert.equal(automaticRoleSafetyIssue(guild, role).retryable, false);
  }
  role.permissions = new PermissionsBitField();
  guild.channels.cache.set('private', { permissionOverwrites: { cache: new Collection([['reward', { allow: new PermissionsBitField(PermissionFlagsBits.ManageMessages) }]]) } });
  assert.match(automaticRoleSafetyIssue(guild, role).message, /channel/);
  guild.channels.cache.clear();
  guild.members.me.permissions = new PermissionsBitField();
  assert.equal(automaticRoleSafetyIssue(guild, role).retryable, true);
  guild.members.me.permissions.add(PermissionFlagsBits.ManageRoles);
  role.position = 101;
  assert.equal(automaticRoleSafetyIssue(guild, role).retryable, true);
});

test('error redaction preserves diagnostics but never Axios credentials or interaction tokens', () => {
  const { AxiosError } = require('axios');
  const { safeLogValue, redactText } = require('../utils/safeLogging');
  const error = new AxiosError('Mock failure at https://api.example.com/request?client_secret=FAKE_SECRET', 'ERR_TEST',
    { params: { client_secret: 'FAKE_SECRET' }, headers: { Authorization: 'Bearer FAKE_TOKEN' } });
  error.response = { status: 401, data: { token: 'FAKE_TOKEN' } };
  const printed = JSON.stringify(safeLogValue(error));
  assert.ok(!printed.includes('FAKE_SECRET') && !printed.includes('FAKE_TOKEN'));
  assert.match(printed, /ERR_TEST/);
  assert.match(printed, /401/);
  assert.ok(!redactText('https://discord.com/api/v10/interactions/123/FAKE_INTERACTION/callback').includes('FAKE_INTERACTION'));
  assert.ok(!JSON.stringify(safeLogValue({ nested: { api_key: 'FAKE_KEY', Authorization: 'Bearer FAKE_TOKEN' } })).includes('FAKE_KEY'));
});

test('generic retries recover matching own messages without a fetched nonce', async () => {
  const { sendQueuedMessage } = require('../utils/deliveryOutbox');
  let sends = 0;
  const payload = { content: 'Feedback payload', embeds: [{ title: 'Review', description: 'Good help' }] };
  const existing = { id: 'existing', author: { id: 'bot' }, createdTimestamp: Date.now(), ...payload };
  const channel = { client: { user: { id: 'bot' } }, messages: { fetch: async () => new Collection([['existing',existing]]) },
    send: async () => { sends += 1; return { id: 'duplicate' }; } };
  assert.equal((await sendQueuedMessage(channel, { deliveryKey: 'generic-recovery', attempts: 2, createdAt: Date.now() }, payload)).id, 'existing');
  assert.equal(sends, 0);
  existing.author.id = 'human';
  await sendQueuedMessage(channel, { deliveryKey: 'not-human', attempts: 2, createdAt: Date.now() }, payload);
  assert.equal(sends, 1);
});

test('lost-response retries freeze the original payload and recover it after a restart-style retry', async () => {
  const outbox = require('../utils/deliveryOutbox');
  const original = { content: 'Original stream alert', embeds: [{ title: 'Stream', timestamp: new Date().toISOString() }] };
  let existing;
  let sends = 0;
  const channel = { client: { user: { id: 'bot' } }, messages: { fetch: async () => new Collection(existing ? [['sent',existing]] : []) },
    send: async payload => { sends += 1; existing = { ...payload, id: 'sent', createdTimestamp: Date.now(), author: { id: 'bot' } }; delete existing.nonce; throw new Error('Connection reset after Discord accepted the message'); } };
  outbox.enqueueDelivery({ deliveryKey: 'lost-send', type: 'SOCIAL', guildId: 'guild', channelId: 'channel', payload: { message: original } });
  await assert.rejects(outbox.deliverOnce('lost-send', row => outbox.sendQueuedMessage(channel, row, original)), /Connection reset/);
  assert.ok(get("SELECT uncertainSince FROM delivery_outbox WHERE deliveryKey='lost-send'").uncertainSince);
  outbox.enqueueDelivery({ deliveryKey: 'lost-send', type: 'SOCIAL', guildId: 'guild', channelId: 'changed-route', payload: { message: { content: 'New timestamp and title' } } });
  run("UPDATE delivery_outbox SET nextAttemptAt=0 WHERE deliveryKey='lost-send'");
  const result = await outbox.deliverOnce('lost-send', row => outbox.sendQueuedMessage(channel, row, { content: 'Changed payload' }));
  assert.equal(result.status, 'SENT');
  assert.equal(result.channelId, 'channel');
  assert.equal(result.messageId, 'sent');
  assert.equal(sends, 1);
});

test('uncertain old deliveries pause for review instead of blindly posting again', async () => {
  const outbox = require('../utils/deliveryOutbox');
  outbox.enqueueDelivery({ deliveryKey: 'uncertain', type: 'SOCIAL', guildId: 'guild', payload: { message: { content: 'Original' } } });
  run("UPDATE delivery_outbox SET status='FAILED',attempts=1,uncertainSince=?,nextAttemptAt=0 WHERE deliveryKey='uncertain'", [Date.now()-600_000]);
  let sends = 0;
  const channel = { client: { user: { id: 'bot' } }, messages: { fetch: async () => new Collection() }, send: async () => { sends += 1; } };
  await assert.rejects(outbox.deliverOnce('uncertain', row => outbox.sendQueuedMessage(channel, row, { content: 'Original' })), /Administrator review/);
  assert.equal(get("SELECT status FROM delivery_outbox WHERE deliveryKey='uncertain'").status, 'UNCERTAIN');
  assert.equal(outbox.pendingDeliveries().some(row => row.deliveryKey === 'uncertain'), false);
  assert.equal(sends, 0);
});

test('warning clearing counts all active warnings and old cleared cases cannot remove new warnings', async () => {
  const { performModerationAction } = require('../utils/moderationActions');
  const { clearWarnings, revokeWarningCase } = require('../utils/warnings');
  for (let index = 0; index < 5; index += 1) await performModerationAction({ guildId: 'warnings', userId: 'member', moderatorId: 'staff', action: 'WARN', reason: 'Test' }, async () => {});
  const oldId = get("SELECT id FROM cases WHERE guildId='warnings' ORDER BY id LIMIT 1").id;
  assert.equal(clearWarnings('warnings','member'), 5);
  await performModerationAction({ guildId: 'warnings', userId: 'member', moderatorId: 'staff', action: 'WARN', reason: 'New warning' }, async () => {});
  revokeWarningCase(get('SELECT * FROM cases WHERE id=?', [oldId]));
  assert.equal(get("SELECT count FROM warns WHERE guildId='warnings'").count, 1);
  revokeWarningCase(get("SELECT * FROM cases WHERE guildId='warnings' AND warningActive=1"));
  assert.equal(get("SELECT count FROM warns WHERE guildId='warnings'"), undefined);
});

test('durable work leases prevent overlapping ticket closes and recover expired process leases', async () => {
  const { withWorkLease } = require('../utils/workLeases');
  const { closeTicket } = require('../utils/tickets/closeTicket');
  let release;
  let entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const first = withWorkLease('ticket-close:ticket', async () => { entered(); await gate; });
  await started;
  await assert.rejects(closeTicket({ interaction: { channel: { id: 'ticket' } } }), /already running/);
  release(); await first;
  assert.equal(get("SELECT * FROM work_leases WHERE resourceKey='ticket-close:ticket'"), undefined);
  run("INSERT INTO work_leases VALUES('expired','old-process',?)", [Date.now()-1]);
  assert.equal(await withWorkLease('expired', async assertOwned => { assertOwned(); return 'recovered'; }), 'recovered');
});

test('giveaway and suggestion recovery reject human markers and prefix-matching identifiers', async () => {
  const { findExistingAnnouncement } = require('../utils/giveaways/endGiveaway');
  const { findDecisionCopy } = require('../events/suggestionInteractions');
  const human = { id: 'human', author: { id: 'human' }, content: '-# Giveaway result ID: giveaway' };
  const correct = { id: 'result', author: { id: 'bot' }, content: 'Congratulations!', reference: { messageId: 'giveaway' } };
  const channel = { messages: { fetch: async () => new Collection([['human',human],['result',correct]]) } };
  assert.equal((await findExistingAnnouncement(channel, 'Giveaway result ID: giveaway', 'bot', 'giveaway', 'Congratulations!')).id, 'result');
  const copy = (id, author, number) => ({ id, author: { id: author }, embeds: [{ title: 'Suggestion Accepted', fields: [{ name: 'Suggestion ID', value: `#${number}` }] }] });
  const copies = [copy('wrong','bot',12),copy('fake','human',1),copy('right','bot',1)];
  channel.messages.fetch = async () => new Collection(copies.map(item => [item.id,item]));
  assert.equal((await findDecisionCopy(channel, { id: 1 }, 'ACCEPTED', 'bot')).id, 'right');
});

test('legacy technical recovery lines are removed without changing user-facing identifiers or controls', async () => {
  const { cleanOwnMessage } = require('../utils/publicMessageCleanup');
  let edited;
  const message = { id: 'post', author: { id: 'bot' }, content: 'Suggestion #15\n-# suggestion-decision:guild:15:ACCEPTED', embeds: [],
    edit: async payload => { edited = payload; } };
  const client = { user: { id: 'bot' }, channels: { fetch: async () => ({ messages: { fetch: async () => message } }) } };
  await cleanOwnMessage(client, 'channel', 'post');
  assert.equal(edited.content, 'Suggestion #15');
  assert.equal(Object.hasOwn(edited, 'components'), false);
  assert.equal(Object.hasOwn(edited, 'attachments'), false);
});

test('delivery recovery is administrator-only and uncertain resends require explicit confirmation', async () => {
  const command = require('../commands/config/delivery');
  run("INSERT INTO delivery_outbox(deliveryKey,type,guildId,status,uncertainSince,createdAt,updatedAt) VALUES('review-me','SOCIAL','review-guild','UNCERTAIN',?,?,?)", [Date.now(),Date.now(),Date.now()]);
  const replies = [];
  let confirm = false;
  const interaction = { guild: { id: 'review-guild' }, memberPermissions: new PermissionsBitField(),
    options: { getSubcommand: () => 'retry', getString: () => 'review-me', getBoolean: () => confirm },
    editReply: async payload => { replies.push(payload); } };
  await command.execute(interaction);
  assert.match(replies.at(-1), /Administrator permission/);
  interaction.memberPermissions.add(PermissionFlagsBits.Administrator);
  await command.execute(interaction);
  assert.match(replies.at(-1), /Check the destination/);
  assert.equal(get("SELECT status FROM delivery_outbox WHERE deliveryKey='review-me'").status, 'UNCERTAIN');
  confirm = true;
  await command.execute(interaction);
  assert.equal(get("SELECT status FROM delivery_outbox WHERE deliveryKey='review-me'").status, 'PENDING');
  assert.equal(get("SELECT uncertainSince FROM delivery_outbox WHERE deliveryKey='review-me'").uncertainSince, null);
});

test('warning command displays use active counters and label cleared history separately', async () => {
  run("INSERT INTO cases(guildId,userId,moderatorId,action,reason,timestamp,createdAt,warningActive) VALUES('warning-ui','member','moderator','WARN','Old cleared warning',?,?,0)", [Date.now(),Date.now()]);
  const responses = [];
  const user = { id: 'member', tag: 'Member', bot: false, send: async () => {}, displayAvatarURL: () => 'https://example.com/avatar.png' };
  const member = { id: 'member', user, roles: { highest: { position: 1 } }, permissions: new PermissionsBitField(), joinedTimestamp: Date.now() };
  const guild = { id: 'warning-ui', name: 'Warning test', ownerId: 'moderator', members: {
    me: { permissions: new PermissionsBitField(PermissionFlagsBits.Administrator), roles: { highest: { position: 100 } } }, fetch: async () => member } };
  const interaction = { user: { id: 'moderator', tag: 'Moderator' }, guild,
    memberPermissions: new PermissionsBitField(PermissionFlagsBits.Administrator),
    client: { user: { id: 'bot', tag: 'Bot' } }, options: { getUser: () => user, getString: () => 'New warning' },
    member: { roles: { highest: { position: 50 } } }, deferred: true, ephemeral: true,
    editReply: async payload => { responses.push(payload); } };
  await require('../commands/moderation/warn').execute(interaction);
  const warned = responses.find(payload => payload.embeds?.[0]?.data.fields?.some(field => field.name.includes('Previous Warns')));
  assert.equal(warned.embeds[0].data.fields.find(field => field.name.includes('Previous Warns')).value, '0');
  await require('../commands/utility/warnings').execute(interaction);
  const history = responses.at(-1).embeds[0].data.fields.find(field => field.name.includes('Recent Warnings')).value;
  assert.match(history, /Active/);
  assert.match(history, /Cleared/);
});
