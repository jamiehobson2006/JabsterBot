const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Collection, ChannelType, PermissionsBitField, PermissionFlagsBits: P } = require('discord.js');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'jabster-ticket-validation-'));
process.env.DATABASE_PATH = path.join(temporary, 'test.db');
const { db, get, run, initDatabase } = require('../database');
initDatabase();
test.after(() => { db.close(); fs.rmSync(temporary, { recursive: true, force: true }); });

let sequence = 0;
function fixture() {
  const guildId = String(200000000000000000n + BigInt(++sequence));
  const categoryId = '300000000000000001';
  const channels = new Collection(), roles = new Collection(), members = new Collection();
  const sent = [], requests = [];
  const guild = { id: guildId, name: 'Ticket tests',
    channels: { cache: new Collection(), fetch: async id => id ? channels.get(id) : channels },
    roles: { everyone: { id: guildId }, cache: new Collection(), fetch: async id => roles.get(id) },
    members: { fetch: async input => members.get(typeof input === 'string' ? input : input.user) } };
  const bot = { id: '400000000000000001', permissions: new PermissionsBitField(P.Administrator), roles: { highest: { position: 100 } } };
  guild.members.me = bot; guild.members.fetchMe = async () => bot;
  const category = { id: categoryId, guildId, type: ChannelType.GuildCategory, permissionsFor: () => bot.permissions,
    toString: () => `<#${categoryId}>` };
  channels.set(categoryId, category);
  const staff = { id: '500000000000000001', name: 'Staff', guild, position: 5, managed: false, toString: () => '<@&500000000000000001>' };
  roles.set(staff.id, staff);
  const user = { id: '600000000000000001', username: 'Member', tag: 'Member', toString: () => '<@600000000000000001>' };
  const client = { user: bot, channels: { fetch: async id => channels.get(id) }, users: { fetch: async () => ({ createDM: async () => panelChannel }) } };
  guild.client = client;
  function textChannel(id) {
    const messages = new Collection();
    return { id, guild, client, type: ChannelType.GuildText, parentId: categoryId, isTextBased: () => true,
      permissionsFor: () => bot.permissions, toString: () => `<#${id}>`, messages: { fetch: async input => typeof input === 'string' ? messages.get(input) : messages },
      send: async payload => { const message = { id: String(700000000000000000n + BigInt(++sequence)), author: bot, ...payload };
        messages.set(message.id, message); sent.push(payload); return message; } };
  }
  const panelChannel = textChannel(String(800000000000000000n + BigInt(++sequence)));
  guild.channels.create = async payload => {
    assert.equal(payload.parent, categoryId);
    requests.push(payload);
    const channel = textChannel(String(900000000000000000n + BigInt(++sequence)));
    channel.topic = payload.topic;
    channels.set(channel.id, channel);
    return channel;
  };
  members.set(user.id, { id: user.id, guild, permissions: new PermissionsBitField(0n), roles: { cache: new Collection() } });
  run('INSERT INTO ticket_limits(guildId,maxPerWindow,windowMinutes,cooldownSeconds) VALUES(?,20,10,0)', [guild.id]);
  const interaction = { guild, client, user, id: `request-${++sequence}`, channel: panelChannel, memberPermissions: bot.permissions, member: members.get(user.id) };
  async function setup(type, options = {}) {
    let reply;
    await require('../commands/config/ticketsetup').execute({ ...interaction,
      options: { getString: name => name === 'type' ? type : name === 'category_id' ? options.categoryId ?? null : null,
        getChannel: () => options.category === false ? null : category,
        getRole: () => options.role === false ? null : staff,
        getBoolean: () => options.enabled ?? null }, editReply: async payload => { reply = payload; } });
    return reply;
  }
  return { guild, category, staff, client, interaction, channels, roles, members, requests, sent, setup };
}

test('Support and Bug Report configure and create tickets in the same category with empty resource caches', async () => {
  const f = fixture();
  assert.ok((await f.setup('support')).embeds);
  assert.ok((await f.setup('bug')).embeds);
  assert.equal(get('SELECT categoryId FROM ticket_settings WHERE guildId=? AND type=?', [f.guild.id, 'support']).categoryId, f.category.id);
  assert.equal(get('SELECT categoryId FROM ticket_settings WHERE guildId=? AND type=?', [f.guild.id, 'bug']).categoryId, f.category.id);
  const { createTicket } = require('../utils/tickets/createTicket');
  const support = await createTicket({ interaction: f.interaction, type: 'support', reason: 'Help with my account' });
  const bug = await createTicket({ interaction: f.interaction, type: 'bug', reason: 'The settings button is broken' });
  assert.notEqual(support.channel.id, bug.channel.id);
  assert.equal(f.requests.length, 2);
  assert.equal(get('SELECT type FROM tickets WHERE channelId=?', [bug.channel.id]).type, 'bug');
  assert.ok(f.requests.every(request => request.permissionOverwrites.some(row => row.id === f.staff.id)));
});

test('the numeric category fallback validates ownership and preserves disabled settings on partial updates', async () => {
  const f = fixture();
  assert.ok((await f.setup('bug', { category: false, categoryId: f.category.id })).embeds);
  await f.setup('bug', { enabled: false });
  await f.setup('bug', { category: false, role: false });
  assert.equal(get('SELECT enabled FROM ticket_settings WHERE guildId=? AND type=?', [f.guild.id, 'bug']).enabled, 0);
  const result = await f.setup('support', { category: false, categoryId: '999999999999999999' });
  assert.match(result.content, /does not identify/);
  assert.equal(get('SELECT * FROM ticket_settings WHERE guildId=? AND type=?', [f.guild.id, 'support']), undefined);
});

test('deleted or foreign categories never reach channel creation even if a stale category remains cached', async () => {
  const f = fixture(); await f.setup('bug');
  f.guild.channels.cache.set(f.category.id, f.category); f.channels.delete(f.category.id);
  await assert.rejects(require('../utils/tickets/createTicket').createTicket({ interaction: f.interaction, type: 'bug', reason: 'A distinct issue' }), /deleted|category/);
  f.category.guildId = 'another-server'; f.channels.set(f.category.id, f.category);
  await assert.rejects(require('../utils/tickets/configuration').resolveConfiguration(f.guild, { categoryId: f.category.id, roleId: f.staff.id }), /another server/);
  assert.equal(f.requests.length, 0);
});

test('a full category gives an actionable error and a definitively unsent request can be retried', async () => {
  const f = fixture(); await f.setup('bug');
  for (let index = 0; index < 50; index++) f.channels.set(`child-${index}`, { id: `child-${index}`, parentId: f.category.id });
  const options = { interaction: f.interaction, type: 'bug', reason: 'Cannot save my configuration' };
  await assert.rejects(require('../utils/tickets/createTicket').createTicket(options), /full \(50 channels\)/);
  assert.equal(f.requests.length, 0);
  assert.equal(get('SELECT status FROM ticket_creation_intents WHERE guildId=?', [f.guild.id]).status, 'FAILED');
  f.channels.delete('child-0');
  assert.ok((await require('../utils/tickets/createTicket').createTicket(options)).success);
  assert.equal(f.requests.length, 1);
});

test('disabled panel entries cannot open forms and fabricated application modals cannot bypass questions', async () => {
  const f = fixture(); await f.setup('bug', { enabled: false });
  let reply, shown = false;
  await require('../events/ticketMenus').execute({ ...f.interaction, isStringSelectMenu: () => true, customId: 'ticket_create', values: ['bug'],
    showModal: async () => { shown = true; }, reply: async payload => { reply = payload; } });
  assert.equal(shown, false); assert.match(reply.content, /no longer available/);
  await assert.rejects(require('../utils/tickets/createTicket').createTicket({ interaction: f.interaction, type: 'application', reason: 'Bypass questions' }), /complete its questions/);
});

test('a panel shows both valid shared-category types and skips deleted destinations', async () => {
  const f = fixture(); await f.setup('support'); await f.setup('bug');
  await require('../commands/config/ticketpanel').execute({ ...f.interaction, editReply: async () => {} });
  const options = f.sent[0].components[0].toJSON().components[0].options;
  assert.deepEqual(options.map(option => option.value).sort(), ['bug', 'support']);
  run('UPDATE ticket_settings SET categoryId=? WHERE guildId=? AND type=?', ['deleted', f.guild.id, 'bug']);
  await require('../commands/config/ticketpanel').execute({ ...f.interaction, editReply: async () => {} });
  assert.deepEqual(f.sent[1].components[0].toJSON().components[0].options.map(option => option.value), ['support']);
});

test('existing tickets keep their recorded staff role and reject cross-server access', () => {
  const f = fixture();
  run("INSERT INTO ticket_settings(guildId,type,roleId,enabled) VALUES(?,'application','new-reviewers',1)", [f.guild.id]);
  run("INSERT INTO tickets(guildId,channelId,userId,type,responseRoleId,createdAt) VALUES(?,?,'opener','application','original-reviewers',?)", [f.guild.id, 'role-snapshot', Date.now()]);
  const permissions = require('../utils/tickets/permissions');
  const member = { id: 'reviewer', guild: f.guild, permissions: new PermissionsBitField(0n), roles: { cache: new Collection([['original-reviewers', {}]]) } };
  assert.equal(permissions.hasTicketAccess({ member, guildId: f.guild.id, channelId: 'role-snapshot', type: 'application' }), true);
  assert.equal(permissions.hasTicketAccess({ member, guildId: 'different', channelId: 'role-snapshot', type: 'application' }), false);
});

test('claim and close refuse a removed staff role even if the interaction member cache still includes it', async () => {
  const f = fixture();
  run("INSERT INTO tickets(guildId,channelId,userId,type,responseRoleId,createdAt) VALUES(?,?,'opener','support',?,?)", [f.guild.id, f.interaction.channel.id, f.staff.id, Date.now()]);
  f.interaction.member.roles.cache.set(f.staff.id, f.staff);
  f.members.set(f.interaction.user.id, { id: f.interaction.user.id, guild: f.guild, permissions: new PermissionsBitField(0n), roles: { cache: new Collection() } });
  await assert.rejects(require('../utils/tickets/claimTicket').claimTicket({ interaction: f.interaction }), /cannot claim/);
  await assert.rejects(require('../utils/tickets/closeTicket').closeTicket({ interaction: f.interaction, reason: 'Finished helping' }), /cannot close/);
  assert.equal(get('SELECT status FROM tickets WHERE channelId=?', [f.interaction.channel.id]).status, 'OPEN');
});

test('restart recovery understands both legacy and current ticket topic formats', () => {
  const parse = require('../utils/tickets/recoverTicket').getTicketTopicMetadata;
  const fingerprint = 'a'.repeat(64);
  assert.deepEqual(parse(`Jabster Studios ticket | type:bug | owner:123456789012345678 | request:${fingerprint}`),
    { type: 'bug', userId: '123456789012345678', applicationFormId: null });
  assert.equal(parse(`Jabster Studios ticket | type:application | owner:123456789012345678 | request:${fingerprint} | form:42`).applicationFormId, 42);
  assert.equal(parse('Jabster Studios ticket | type:support | owner:123456789012345678').type, 'support');
});

test('sealed interrupted closes recover permissions without racing an active close lease', async () => {
  const f = fixture(), channel = f.interaction.channel;
  let restores = 0;
  channel.permissionOverwrites = { set: async rows => { restores++; assert.equal(rows[0].id, f.guild.id); } };
  run("INSERT INTO tickets(guildId,channelId,userId,type,status,createdAt,closedAt,closePermissionsJson) VALUES(?,?,'opener','support','CLOSING',1,1,?)",
    [f.guild.id, channel.id, JSON.stringify([{ id: f.guild.id, type: 0, allow: '0', deny: '1024' }])]);
  f.channels.set(channel.id, channel);
  run('INSERT INTO work_leases VALUES(?,?,?)', [`ticket-close:${channel.id}`, 'active-close', Date.now() + 60000]);
  const cleanup = require('../utils/tickets/closedTicketCleanup');
  assert.equal(await cleanup.recoverSealedClosingTickets(f.client), 0); assert.equal(restores, 0);
  run('DELETE FROM work_leases WHERE resourceKey=?', [`ticket-close:${channel.id}`]);
  assert.equal(await cleanup.recoverSealedClosingTickets(f.client), 1); assert.equal(restores, 1);
  const recovered = get('SELECT * FROM tickets WHERE channelId=?', [channel.id]);
  assert.equal(recovered.status, 'OPEN'); assert.equal(recovered.closePermissionsJson, null);
});

for (const code of [50007, 50278]) test(`feedback DM rejection ${code} stops retry spam but retains the record and supports manual reset`, async () => {
  const f = fixture(), service = require('../utils/ticketFeedback');
  const userId = String(BigInt(f.guild.id) + 100000000000000000n);
  run("INSERT INTO tickets(guildId,channelId,userId,type,status,createdAt,transcriptMessageId) VALUES(?,?,?,'bug','CLOSED',1,'archive')", [f.guild.id, f.interaction.channel.id, userId]);
  const ticket = get('SELECT * FROM tickets WHERE channelId=?', [f.interaction.channel.id]);
  const feedback = service.createFeedbackRecord({ ticket, closedBy: { id: 'staff' }, closeReason: 'Resolved' });
  let attempts = 0;
  f.client.users.fetch = async id => { if (id === feedback.userId) attempts++; throw Object.assign(new Error('Cannot send messages to this user'), { code, status: 403 }); };
  assert.equal(await service.sendFeedbackPrompt({ client: f.client, feedback }), false);
  assert.equal(get('SELECT status FROM delivery_outbox WHERE deliveryKey=?', [`ticket-feedback-dm:${feedback.id}`]).status, 'CANCELLED');
  assert.equal(await service.retryFeedbackPrompts(f.client), 0); assert.equal(attempts, 1);
  assert.match(service.getFeedback(feedback.id).dmLastError, /Automatic retries stopped/);
  service.resetFeedbackPrompt(feedback.id, f.guild.id);
  assert.equal(get('SELECT * FROM delivery_outbox WHERE deliveryKey=?', [`ticket-feedback-dm:${feedback.id}`]), undefined);
  assert.equal(service.getFeedback(feedback.id).status, 'PENDING');
});

test('unknown-outcome creation failures keep a recovery hold while category errors stay actionable', async () => {
  const f = fixture(); await f.setup('bug');
  f.guild.channels.create = async () => { throw Object.assign(new Error('A specified channel ID is invalid'), { code: 50035, status: 400, rawError: { errors: { parent_id: {} } } }); };
  await assert.rejects(require('../utils/tickets/createTicket').createTicket({ interaction: f.interaction, type: 'bug', reason: 'Something is broken' }), /Discord rejected the ticket category/);
  assert.equal(get('SELECT status FROM ticket_creation_intents WHERE guildId=?', [f.guild.id]).status, 'FAILED');
  let attempts = 0;
  f.guild.channels.create = async () => { attempts++; throw Object.assign(new Error('Discord response lost'), { status: 503 }); };
  const options = { interaction: f.interaction, type: 'bug', reason: 'A different issue with a lost response' };
  await assert.rejects(require('../utils/tickets/createTicket').createTicket(options), /response lost/);
  await assert.rejects(require('../utils/tickets/createTicket').createTicket(options), /administrator review/);
  assert.equal(attempts, 1);
});
