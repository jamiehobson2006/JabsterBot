const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ChannelType, Collection, PermissionFlagsBits: P, PermissionsBitField } = require('discord.js');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'jabster-ticket-dashboard-'));
process.env.DATABASE_PATH = path.join(temporary, 'test.db');
const { db, get, run, initDatabase } = require('../database');
initDatabase();
test.after(() => { db.close(); fs.rmSync(temporary, { recursive: true, force: true }); });
const dashboard = require('../utils/tickets/dashboard'), panels = require('../utils/tickets/panels');
const event = require('../events/ticketDashboardInteractions');
let serial = 0;

function fixture() {
  const id = String(200000000000000000n + BigInt(++serial)), user = { id: 'admin' };
  const channels = new Collection(), roles = new Collection(), messages = new Collection(), sent = [], replies = [];
  const guild = { id, name: 'Dashboard tests', channels: { cache: channels, fetch: async key => key ? channels.get(key) : channels },
    roles: { cache: roles, everyone: { id }, fetch: async key => roles.get(key) }, members: {} };
  const member = { id: user.id, guild, permissions: new PermissionsBitField(P.Administrator), roles: { cache: new Collection() } };
  guild.members.fetch = async () => member;
  guild.members.me = { id: 'bot', permissions: member.permissions };
  guild.members.fetchMe = async () => guild.members.me;
  const client = { user: { id: 'bot' }, guilds: { cache: new Collection([[id, guild]]) }, channels: { fetch: async key => channels.get(key) } };
  guild.client = client;
  const category = { id: 'category', type: ChannelType.GuildCategory, guildId: id, permissionsFor: () => new PermissionsBitField(P.Administrator) };
  channels.set(category.id, category);
  const channel = { id: 'destination', type: ChannelType.GuildText, guild, client,
    permissionsFor: () => new PermissionsBitField(P.Administrator), isTextBased: () => true,
    messages: { fetch: async options => typeof options === 'string' ? messages.get(options) : messages },
    send: async payload => { const result = { id: String(++serial), ...payload, author: client.user, createdTimestamp: Date.now() };
      sent.push(result); messages.set(result.id, result); return result; } };
  channels.set(channel.id, channel);
  const role = { id: 'staff', guild, managed: false }; roles.set(role.id, role);
  const f = { guild, user, client, member, category, role, channel, channels, roles, messages, sent, replies };
  f.row = dashboard.createSession(guild.id, user.id);
  f.act = async (action, options = {}) => {
    const current = f.row;
    const interaction = { guild, user, client, memberPermissions: new PermissionsBitField(P.Administrator),
      customId: options.customId || `td:${current.id}:${current.revision}:${action}`, values: options.values || [],
      isButton: () => !options.values && !options.fields, isModalSubmit: () => Boolean(options.fields),
      fields: { getTextInputValue: key => options.fields?.[key] ?? '' },
      async deferUpdate() { this.deferred = true; },
      showModal: async value => { f.modal = value.toJSON(); },
      editReply: async value => { f.output = value; },
      reply: async value => replies.push(value), followUp: async value => replies.push(value), ...options.interaction };
    await event.execute(interaction);
    f.row = dashboard.session(current.id);
    return interaction;
  };
  f.addPanel = async (name = 'help') => {
    const panel = panels.create(guild.id, user.id, { name });
    await panels.setRoute(guild, name, 'support', { categoryId: category.id, roleId: role.id });
    return panel;
  };
  return f;
}

function validate(payload) {
  assert.ok(payload.components.length <= 5);
  for (const row of payload.components) { const json = row.toJSON(); assert.ok(json.components.length <= 5); }
  for (const embed of payload.embeds || []) { embed.toJSON(); assert.ok(embed.length <= 6000); }
}

test('dashboard is grouped under ticket, private and administrator-only without adding a root command', async () => {
  const registry = require('../utils/commandRegistry').loadCommandRegistry();
  assert.equal(registry.commands.size, 61);
  assert.ok(registry.commands.get('ticket').routes.has('dashboard'));
  const command = require('../commands/config/ticketdashboard'), f = fixture();
  assert.equal(command.ephemeral, true);
  f.member.permissions = new PermissionsBitField(0n);
  await assert.rejects(command.execute({ guild: f.guild, user: f.user }), /Administrator/);
  f.member.permissions = new PermissionsBitField(P.Administrator);
  let rendered;
  await command.execute({ guild: f.guild, user: f.user, editReply: async value => { rendered = value; } });
  validate(rendered);
});

test('all dashboard views and forms serialize within Discord component and embed limits', async () => {
  const f = fixture(), panel = await f.addPanel();
  for (const state of [{ view: 'home' }, { view: 'panel', panelId: panel.id }, { view: 'settings' },
    { view: 'route', panelId: panel.id, type: 'support', categoryId: 'category', roleId: 'staff', routeEnabled: true },
    { view: 'remove', panelId: panel.id, type: 'support' }, { view: 'publish', panelId: panel.id, postChannelId: 'destination' }]) {
    validate(dashboard.payload({ ...f.row, state }));
  }
  for (const action of ['new', 'edit', 'limits']) {
    const row = { ...f.row, state: { view: 'panel', panelId: panel.id } };
    assert.ok(dashboard.modal(row, action).toJSON().components.length <= 5);
  }
});

test('owner, server, expiry and stale-version checks prevent another user from changing a dashboard', async () => {
  const f = fixture();
  for (const change of [{ user: { id: 'stranger' } }, { guild: { id: 'other' } }]) {
    await f.act('shared', { interaction: change });
    assert.match(f.replies.at(-1).content, /belongs/);
  }
  await f.act('shared');
  await f.act('home', { customId: `td:${f.row.id}:0:home` });
  assert.match(f.replies.at(-1).content, /out of date/);
  run('UPDATE ticket_dashboard_sessions SET expiresAt=0 WHERE id=?', [f.row.id]);
  await f.act('home'); assert.match(f.replies.at(-1).content, /expired/);
});

test('create and edit panel forms save their text without requiring slash-command options', async () => {
  const f = fixture();
  await f.act('new'); assert.equal(f.modal.title, 'Create Ticket Panel');
  await f.act('new-save', { fields: { name: 'general-help', title: 'General Help', description: 'Choose the team you need.' } });
  const panel = panels.byName(f.guild.id, 'general-help');
  assert.equal(f.row.state.panelId, panel.id);
  await f.act('edit');
  await f.act('edit-save', { fields: { title: 'Updated Help', description: 'Updated panel text.' } });
  assert.equal(panels.byId(f.guild.id, panel.id).title, 'Updated Help');
  await f.act('toggle-panel'); assert.equal(panels.byId(f.guild.id, panel.id).enabled, 0);
});

test('route selectors stay as drafts until Save, and removal requires confirmation', async () => {
  const f = fixture(), panel = panels.create(f.guild.id, f.user.id, { name: 'reports' });
  await f.act('panel', { values: [panel.id] }); await f.act('type', { values: ['bug'] });
  await f.act('category', { values: [f.category.id] }); await f.act('role', { values: [f.role.id] });
  assert.equal(panels.routes(f.guild.id, panel.id).length, 0);
  await f.act('save-route');
  assert.equal(panels.routes(f.guild.id, panel.id)[0].categoryId, f.category.id);
  await f.act('type', { values: ['bug'] }); await f.act('remove');
  assert.equal(panels.routes(f.guild.id, panel.id).length, 1);
  await f.act('confirm-remove'); assert.equal(panels.routes(f.guild.id, panel.id).length, 0);
});

test('preview does not publish and posting sends the selected panel once to its chosen channel', async () => {
  const f = fixture(), panel = await f.addPanel();
  await f.act('panel', { values: [panel.id] }); await f.act('publish'); await f.act('preview');
  assert.equal(f.sent.length, 0); assert.equal(f.replies.at(-1).components.length, 0);
  await f.act('post-channel', { values: [f.channel.id] });
  const customId = `td:${f.row.id}:${f.row.revision}:post`;
  await f.act('post'); assert.equal(f.sent.length, 1); assert.equal(f.row.state.posted, true);
  const saved = panels.byId(f.guild.id, panel.id);
  assert.equal(saved.postChannelId, f.channel.id); assert.equal(saved.postMessageId, f.sent[0].id);
  await f.act('post', { customId }); assert.equal(f.sent.length, 1);
});

test('a lost send response recovers the same publication receipt instead of sending another panel', async () => {
  const f = fixture(), panel = await f.addPanel(), send = f.channel.send;
  await f.act('panel', { values: [panel.id] }); await f.act('publish'); await f.act('post-channel', { values: [f.channel.id] });
  f.channel.send = async payload => { await send(payload); throw Object.assign(new Error('Lost response'), { status: 503 }); };
  await f.act('post'); assert.equal(f.sent.length, 1); assert.equal(f.row.state.posted, false);
  const key = `ticket-panel-dashboard:${f.row.id}:${f.row.state.publicationToken}`;
  run('UPDATE delivery_outbox SET nextAttemptAt=0 WHERE deliveryKey=?', [key]);
  f.channel.send = send;
  await f.act('post');
  assert.equal(f.sent.length, 1); assert.equal(f.row.state.posted, true);
});

test('shared transcript and feedback channel dropdowns validate destinations and preserve other settings', async () => {
  const f = fixture(); run('INSERT INTO guild_settings(guildId,staffRoleId) VALUES(?,?)', [f.guild.id, 'existing-staff']);
  await f.act('shared'); await f.act('transcripts', { values: [f.channel.id] });
  await f.act('feedback', { values: [f.channel.id] });
  let settings = get('SELECT * FROM guild_settings WHERE guildId=?', [f.guild.id]);
  assert.equal(settings.staffRoleId, 'existing-staff'); assert.equal(settings.ticketFeedbackChannelId, f.channel.id);
  await f.act('feedback', { values: [f.category.id] });
  assert.equal(get('SELECT ticketFeedbackChannelId FROM guild_settings WHERE guildId=?', [f.guild.id]).ticketFeedbackChannelId, f.channel.id);
  await f.act('feedback', { values: [] });
  settings = get('SELECT * FROM guild_settings WHERE guildId=?', [f.guild.id]);
  assert.equal(settings.ticketFeedbackChannelId, null); assert.equal(settings.transcriptChannelId, f.channel.id);
});

test('creation limits reject malformed inputs and save bounded integer settings', async () => {
  const f = fixture(); await f.act('shared'); await f.act('limits');
  await f.act('limits-save', { fields: { maximum: '3.5', window: '10', cooldown: '15' } });
  assert.equal(get('SELECT * FROM ticket_limits WHERE guildId=?', [f.guild.id]), undefined);
  await f.act('limits-save', { fields: { maximum: '4', window: '20', cooldown: '10' } });
  assert.equal(get('SELECT maxPerWindow FROM ticket_limits WHERE guildId=?', [f.guild.id]).maxPerWindow, 4);
});

test('fresh permission checks reject a revoked administrator even when cached interaction permissions remain', async () => {
  const f = fixture(); f.member.permissions = new PermissionsBitField(0n);
  await f.act('new-save', { fields: { name: 'forbidden', title: 'Forbidden', description: '' } });
  assert.match(f.replies.at(-1).content, /Administrator/);
  assert.equal(panels.list(f.guild.id).length, 0);
});

test('large panel lists paginate without exceeding 25 choices', async () => {
  const f = fixture();
  for (let index = 0; index < 45; index++) panels.create(f.guild.id, f.user.id, { name: `panel-${index}` });
  validate(dashboard.payload(f.row));
  assert.equal(dashboard.payload(f.row).components[0].toJSON().components[0].options.length, 21);
  await f.act('next'); assert.equal(f.row.state.page, 1);
  await f.act('next'); assert.equal(dashboard.payload(f.row).components[0].toJSON().components[0].options.length, 6);
});

test('dashboard selections and saved posting channels survive a fresh process restart', async () => {
  const f = fixture(), panel = await f.addPanel();
  await f.act('panel', { values: [panel.id] }); await f.act('publish'); await f.act('post-channel', { values: [f.channel.id] }); await f.act('post');
  const script = `const d=require('./database');d.initDatabase();const s=require('./utils/tickets/dashboard').session('${f.row.id}');const p=require('./utils/tickets/panels').byId('${f.guild.id}','${panel.id}');if(s.state.panelId!==p.id||p.postChannelId!=='${f.channel.id}'||!s.state.posted)throw new Error('Dashboard state lost');d.db.close();`;
  const child = spawnSync(process.execPath, ['-e', script], { cwd: path.join(__dirname, '..'), env: process.env, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
});

test('blocked interactive panel posts cannot occupy every slot in the automatic delivery queue', () => {
  const outbox = require('../utils/deliveryOutbox');
  for (let index = 0; index < 60; index++) outbox.enqueueDelivery({ deliveryKey: `dashboard-pending-${index}`, type: 'TICKET_PANEL_POST' });
  outbox.enqueueDelivery({ deliveryKey: 'ordinary-channel-notice', type: 'TEST_CHANNEL_NOTICE', channelId: 'destination', payload: { message: { content: 'A normal queued message' } } });
  const jobs = outbox.pendingDeliveries(null, 50, ['TICKET_PANEL_POST']);
  assert.equal(jobs.some(row => row.deliveryKey === 'ordinary-channel-notice'), true);
  assert.equal(jobs.some(row => row.type === 'TICKET_PANEL_POST'), false);
});

test('foreign and deleted posting channels are rejected before any panel is sent', async () => {
  const f = fixture(), panel = await f.addPanel();
  await f.act('panel', { values: [panel.id] }); await f.act('publish');
  f.channels.set('foreign', { ...f.channel, id: 'foreign', guild: { id: 'other-server' } });
  await f.act('post-channel', { values: ['foreign'] });
  assert.match(f.replies.at(-1).content, /this server/);
  await f.act('post-channel', { values: [f.channel.id] });
  f.channels.delete(f.channel.id);
  await f.act('post');
  assert.match(f.replies.at(-1).content, /this server/);
  assert.equal(f.sent.length, 0);
});

test('the default panel can be configured in the dashboard without creating a named panel', async () => {
  const f = fixture(); await f.act('panel', { values: ['default'] }); await f.act('type', { values: ['support'] });
  await f.act('category', { values: [f.category.id] }); await f.act('role', { values: [f.role.id] }); await f.act('save-route');
  assert.equal(get("SELECT categoryId FROM ticket_settings WHERE guildId=? AND type='support'", [f.guild.id]).categoryId, f.category.id);
  assert.equal(panels.list(f.guild.id).length, 0);
  await f.act('publish'); await f.act('post-channel', { values: [f.channel.id] }); await f.act('post');
  assert.equal(f.sent[0].components[0].toJSON().components[0].custom_id, 'ticket_create');
});
