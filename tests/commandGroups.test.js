const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Sqlite = require('better-sqlite3');
const { Collection, CommandInteractionOptionResolver, PermissionsBitField, PermissionFlagsBits: P } = require('discord.js');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'jabster-command-groups-'));
process.env.DATABASE_PATH = path.join(temporary, 'test.db');
const { db, run, get, all, initDatabase } = require('../database');
initDatabase();
test.after(() => { db.close(); fs.rmSync(temporary, { recursive: true, force: true }); });
const { GROUPS, LEGACY_PATHS } = require('../utils/commandLayout');
const { loadCommandRegistry, commandEntries, commandNode } = require('../utils/commandRegistry');
const registry = loadCommandRegistry();

class Interaction {
  #acknowledgements = 0;
  constructor(root, action, subcommand, values = [], privileges = P.Administrator) {
    this.commandName = root;
    this.client = { user: { id: 'bot' } };
    this.guild = { id: 'dispatch' };
    this.user = { id: 'user' };
    this.member = { permissions: new PermissionsBitField(privileges), roles: { cache: new Collection() } };
    this.memberPermissions = this.member.permissions;
    this.channel = { id: 'general', parentId: 'category' };
    this.channelId = this.channel.id;
    const data = action ? [{ name: action, type: subcommand ? 2 : 1,
      options: subcommand ? [{ name: subcommand, type: 1, options: values }] : values }] : values;
    this.options = new CommandInteractionOptionResolver(this.client, data, { users: new Collection() });
    this.messages = [];
  }
  isChatInputCommand() { return true; }
  async deferReply(payload) { this.#acknowledgements++; this.deferred = true; this.deferredPayload = payload; }
  async editReply(payload) { this.#acknowledgements++; this.replied = true; this.messages.push(payload); }
  async reply(payload) { return this.editReply(payload); }
  async followUp(payload) { return this.editReply(payload); }
  acknowledgements() { return this.#acknowledgements; }
}

test('106 source handlers register exactly once through 61 global roots', () => {
  assert.equal(registry.sources.size, 106);
  assert.equal(registry.commands.size, 61);
  require('../utils/commandValidation').validateGlobalCommands(registry.definitions);
  const covered = [...registry.commands].flatMap(([name, command]) =>
    command.routes ? [...command.routes.values()].map(route => route.sourceName) : [name]);
  assert.equal(covered.length, 106);
  assert.equal(new Set(covered).size, 106);
  assert.deepEqual([...new Set(covered)].sort(), [...registry.sources.keys()].sort());
  for (const [source] of Object.entries(LEGACY_PATHS)) {
    if (!GROUPS.some(group => group.name === source)) assert.equal(registry.commands.has(source), false);
  }
});

test('every grouped action dispatches to its original handler with native typed options', async () => {
  let checked = 0;
  const user = { id: 'target' }, role = { id: 'staff' }, channel = { id: 'destination' };
  const values = [
    { name: 'text', type: 3, value: 'An intact value' },
    { name: 'amount', type: 4, value: 42 },
    { name: 'enabled', type: 5, value: true },
    { name: 'user', type: 6, value: user.id, user },
    { name: 'channel', type: 7, value: channel.id, channel },
    { name: 'role', type: 8, value: role.id, role }
  ];
  for (const [root, command] of registry.commands) {
    if (!command.routes) continue;
    for (const [action, route] of command.routes) {
      const subcommands = route.isGroup ? route.command.data.toJSON().options.map(option => option.name) : [null];
      const original = route.command.execute;
      try {
        for (const subcommand of subcommands) {
          const interaction = new Interaction(root, action, subcommand, values);
          let dispatched = false;
          route.command.execute = async adapted => {
            dispatched = true;
            assert.equal(adapted.commandName, route.sourceName);
            assert.ok(adapted.options instanceof CommandInteractionOptionResolver);
            assert.equal(adapted.options.getSubcommand(false), subcommand);
            assert.equal(adapted.options.getSubcommandGroup(false), null);
            assert.equal(adapted.options.getString('text', true), 'An intact value');
            assert.equal(adapted.options.getInteger('amount', true), 42);
            assert.equal(adapted.options.getBoolean('enabled', true), true);
            assert.equal(adapted.options.getUser('user', true), user);
            assert.equal(adapted.options.getRole('role', true), role);
            assert.equal(adapted.options.getChannel('channel', true), channel);
            assert.equal(adapted.options.resolved, interaction.options.resolved);
            await adapted.deferReply({});
            await adapted.editReply('Complete');
            assert.equal(adapted.deferred, true);
          };
          await command.execute(interaction, interaction.client);
          assert.equal(dispatched, true, `${root} ${action} ${subcommand || ''}`);
          assert.equal(interaction.acknowledgements(), 2);
          assert.equal(interaction.replied, true);
          checked++;
        }
      } finally { route.command.execute = original; }
    }
  }
  assert.ok(checked > 100);
});

test('mixed public/admin groups retain independent permissions before handler execution', async () => {
  const command = registry.commands.get('leveling');
  assert.equal(command.data.toJSON().default_member_permissions, null);
  const admin = new Interaction('leveling', 'admin', 'set-level', [], 0n);
  await command.execute(admin, admin.client);
  assert.match(admin.messages[0].content, /ManageGuild/);
  const rank = command.routes.get('rank');
  const original = rank.command.execute;
  let called = false;
  rank.command.execute = async () => { called = true; };
  try { await command.execute(new Interaction('leveling', 'rank', null, [], 0n)); }
  finally { rank.command.execute = original; }
  assert.equal(called, true);
  assert.equal(registry.commands.get('giveaway').data.toJSON().default_member_permissions, P.ManageGuild.toString());
  assert.equal(registry.commands.get('logging').routes.get('dashboard').permission, null);
  assert.equal(registry.commands.get('logging').routes.get('managers').permission, P.Administrator.toString());
});

test('stale and fabricated nested syntax is rejected without executing a handler', () => {
  const command = registry.commands.get('ticket');
  assert.throws(() => command.resolve(new Interaction('ticket', null, null)), /subcommands/);
  assert.throws(() => command.resolve(new Interaction('ticket', 'manage', null)), /syntax/);
  assert.throws(() => command.resolve(new Interaction('ticket', 'manage', 'invented')), /not available/);
  assert.throws(() => command.resolve(new Interaction('ticket', 'setup', 'invented')), /syntax/);
});

test('command lookup accepts valid paths and removed aliases but not arbitrary option names', () => {
  assert.equal(commandNode(registry.commands, '/GLIST').name, 'giveaway list');
  assert.equal(commandNode(registry.commands, '/ticket manage recovery').route.sourceName, 'ticket');
  assert.equal(commandNode(registry.commands, 'leveling rank').route.sourceName, 'rank');
  assert.equal(commandNode(registry.commands, 'giveaway').name, 'giveaway');
  assert.equal(commandNode(registry.commands, 'giveaway start channel'), null);
  assert.equal(commandNode(registry.commands, 'no-such-command'), null);
});

test('command restrictions apply to every parent scope without permitting leaf bypass escalation', () => {
  const controls = require('../utils/commandControls');
  const interaction = new Interaction('leveling', 'admin', 'set-level');
  interaction.guild.id = 'controls';
  controls.setCommandEnabled({ guildId: 'controls', commandName: 'leveling admin', enabled: false, updatedBy: 'admin' });
  assert.equal(controls.getCommandAvailability(interaction).allowed, false);
  controls.addCommandBypass({ guildId: 'controls', commandName: 'leveling admin', type: 'CHANNEL', valueId: 'general', addedBy: 'admin' });
  assert.equal(controls.getCommandAvailability(interaction).allowed, true);
  controls.setCommandEnabled({ guildId: 'controls', commandName: 'leveling', enabled: false, updatedBy: 'admin' });
  controls.addCommandBypass({ guildId: 'controls', commandName: 'leveling admin set-level', type: 'CHANNEL', valueId: 'general', addedBy: 'admin' });
  assert.equal(controls.getCommandAvailability(interaction).allowed, false);
  controls.setCommandEnabled({ guildId: 'controls', commandName: 'commandcontrol', enabled: false, updatedBy: 'admin' });
  interaction.commandName = 'commandcontrol';
  assert.equal(controls.getCommandAvailability(interaction).allowed, true);
});

function migrationDatabase(filename = ':memory:') {
  const connection = new Sqlite(filename);
  connection.exec(`CREATE TABLE IF NOT EXISTS command_controls(guildId TEXT,commandName TEXT,enabled INTEGER,reason TEXT,updatedBy TEXT,updatedAt INTEGER,PRIMARY KEY(guildId,commandName));
    CREATE TABLE IF NOT EXISTS command_control_bypasses(guildId TEXT,commandName TEXT,type TEXT,valueId TEXT,addedBy TEXT,addedAt INTEGER,PRIMARY KEY(guildId,commandName,type,valueId));
    CREATE TABLE IF NOT EXISTS configuration_plans(id TEXT,appliedAt INTEGER);`);
  const migrate = () => connection.transaction(() => require('../utils/commandGroupMigration').migrateCommandGroups(
    (sql, args = []) => connection.prepare(sql).run(...args),
    (sql, args = []) => connection.prepare(sql).all(...args),
    (sql, args = []) => connection.prepare(sql).get(...args)))();
  return { connection, migrate };
}

test('saved restrictions and role/channel/category bypasses migrate once and survive a database restart', () => {
  const filename = path.join(temporary, 'migration.db');
  let fixture = migrationDatabase(filename);
  fixture.connection.exec(`INSERT INTO command_controls VALUES('guild','giveaway',0,'Paused','owner',123);
    INSERT INTO configuration_plans VALUES('pending',NULL),('applied',100);`);
  for (const type of ['ROLE', 'CHANNEL', 'CATEGORY']) fixture.connection.prepare('INSERT INTO command_control_bypasses VALUES(?,?,?,?,?,?)')
    .run('guild', 'giveaway', type, type.toLowerCase(), 'owner', 123);
  fixture.migrate();
  assert.equal(fixture.connection.prepare("SELECT COUNT(*) n FROM command_controls WHERE commandName='giveaway'").get().n, 0);
  assert.deepEqual(fixture.connection.prepare('SELECT commandName,enabled,reason FROM command_controls').get(),
    { commandName: 'giveaway start', enabled: 0, reason: 'Paused' });
  assert.equal(fixture.connection.prepare("SELECT COUNT(*) n FROM command_control_bypasses WHERE commandName='giveaway start'").get().n, 3);
  assert.deepEqual(fixture.connection.prepare('SELECT id FROM configuration_plans').all(), [{ id: 'applied' }]);
  fixture.connection.exec("INSERT INTO command_controls VALUES('guild','giveaway',0,'New group control','owner',456)");
  fixture.connection.close();
  fixture = migrationDatabase(filename);
  try {
    fixture.migrate();
    assert.equal(fixture.connection.prepare("SELECT reason FROM command_controls WHERE commandName='giveaway'").get().reason, 'New group control');
    assert.equal(fixture.connection.prepare('SELECT COUNT(*) n FROM command_controls').get().n, 2);
  } finally { fixture.connection.close(); }
});

test('colliding migrated restrictions keep the stricter rule and do not merge permissive bypasses', () => {
  const { connection, migrate } = migrationDatabase();
  try {
    connection.exec(`INSERT INTO command_controls VALUES('guild','glist',0,'Legacy restriction','owner',1),('guild','giveaway list',1,NULL,'owner',2);
      INSERT INTO command_control_bypasses VALUES('guild','glist','ROLE','old','owner',1),('guild','giveaway list','ROLE','new','owner',2);`);
    migrate();
    assert.equal(connection.prepare('SELECT enabled FROM command_controls').get().enabled, 0);
    assert.equal(connection.prepare('SELECT COUNT(*) n FROM command_control_bypasses').get().n, 0);
  } finally { connection.close(); }
});

test('configuration imports translate old command keys while version 2 retains new root/group scopes', () => {
  const { planImport, exportConfiguration } = require('../utils/configuration');
  const guild = { id: 'imports', roles: { cache: new Collection() }, channels: { cache: new Collection() } };
  const document = version => ({ version, tables: { command_controls: [
    { guildId: guild.id, commandName: 'giveaway', enabled: 0 }
  ] } });
  const legacy = planImport(document(1), guild, 'owner');
  assert.equal(legacy.operations[0].after.commandName, 'giveaway start');
  const current = planImport(document(2), guild, 'owner');
  assert.equal(current.operations[0].after.commandName, 'giveaway');
  assert.equal(exportConfiguration(guild.id).version, 2);
});

test('help includes every action and valid paginated examples without exceeding embed budgets', () => {
  const help = require('../commands/utility/help');
  const entries = commandEntries(registry.commands);
  assert.ok(entries.length > 300);
  const categories = new Set(entries.map(entry => entry.category));
  const client = { commands: registry.commands };
  for (const category of categories) {
    const pages = help.categoryPages(client, category);
    const combined = pages.join('\n');
    for (const entry of entries.filter(entry => entry.category === category)) assert.ok(combined.includes(`**/${entry.path}**`), entry.path);
    for (let index = 0; index < pages.length; index++) {
      const payload = help.categoryPayload(client, category, index + 1);
      const embed = payload.embeds[0].toJSON();
      assert.ok(embed.description.length <= 3800);
      assert.ok(JSON.stringify(embed).length < 6000);
      payload.components.forEach(row => row.toJSON());
    }
  }
});

test('audit decisions still distinguish readonly and changing actions after grouping', () => {
  const { shouldLogCommand } = require('../utils/commandAudit');
  for (const [root, action, subcommand, expected] of [
    ['giveaway', 'list', null, false], ['giveaway', 'start', null, true],
    ['leveling', 'rank', null, false], ['leveling', 'admin', 'set-level', true],
    ['suggestions', 'duplicates', 'search', false], ['suggestions', 'duplicates', 'link', true],
    ['ticket', 'stats', 'overview', false], ['ticket', 'stats', 'hours', true]
  ]) {
    const resolved = registry.commands.get(root).resolve(new Interaction(root, action, subcommand));
    assert.equal(shouldLogCommand(resolved.command, resolved.interaction), expected, `${root} ${action}`);
  }
});

test('framework retains handler-specific private replies and cooldowns with no live Discord calls', async () => {
  const event = require('../events/interactionCreate');
  const command = registry.commands.get('logging'), route = command.routes.get('dashboard');
  const original = route.command.execute;
  let calls = 0;
  route.command.execute = async interaction => { calls++; await interaction.editReply('Dashboard'); };
  try {
    const interaction = new Interaction('logging', 'dashboard', null);
    await event.execute(interaction, { commands: registry.commands });
    assert.equal(interaction.deferredPayload.flags, 64);
    assert.equal(calls, 1);
    const again = new Interaction('logging', 'dashboard', null);
    await event.execute(again, { commands: registry.commands });
    assert.equal(calls, 1);
    assert.match(again.messages[0].content, /Slow down/);
    assert.ok(get("SELECT 1 FROM cooldowns WHERE command='logging'"));
  } finally { route.command.execute = original; }
});

test('permission diagnostics do not mistake a mixed public group for its old admin-only root', () => {
  const { commandReport } = require('../utils/permissionDiagnostics');
  const member = { permissions: new PermissionsBitField(0n), roles: { cache: new Collection() } };
  const channel = { id: 'general', permissionsFor: () => new PermissionsBitField(P.ViewChannel | P.UseApplicationCommands) };
  const guild = { id: 'diagnostics' };
  const checks = commandReport({ guild, member, channel, command: registry.commands.get('leveling'), name: 'leveling' });
  assert.equal(checks.some(check => check.passed === false), false);
  const node = commandNode(registry.commands, 'leveling admin set-level');
  const leaf = commandReport({ guild, member, channel, command: node.command, name: node.name, route: node.route });
  assert.ok(leaf.some(check => check.passed === false && check.label.includes('ManageGuild')));
});

test('fresh process loads the same global registry without editing ticket or giveaway data', () => {
  run(`INSERT INTO tickets(guildId,channelId,messageId,userId,type,createdAt)
    VALUES('restart','open-ticket','existing-buttons','opener','support',?)`, [Date.now()]);
  run(`INSERT INTO giveaways(messageId,guildId,channelId,hostId,prize,endsAt,createdAt)
    VALUES('active-giveaway','restart','giveaways','host','Original prize',?,?)`, [Date.now() + 86400000, Date.now()]);
  const ticket = get("SELECT * FROM tickets WHERE channelId='open-ticket'");
  const giveaway = get("SELECT * FROM giveaways WHERE messageId='active-giveaway'");
  const child = spawnSync(process.execPath, ['-e', `const d=require('./database');d.initDatabase();
    const r=require('./utils/commandRegistry').loadCommandRegistry();
    if(r.commands.size!==61||r.sources.size!==106)process.exitCode=1;d.db.close();`],
  { cwd: path.join(__dirname, '..'), env: process.env, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(get("SELECT * FROM tickets WHERE channelId='open-ticket'"), ticket);
  assert.deepEqual(get("SELECT * FROM giveaways WHERE messageId='active-giveaway'"), giveaway);
});
