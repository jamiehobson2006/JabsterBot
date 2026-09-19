const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { Collection, PermissionsBitField, PermissionFlagsBits } = require('discord.js');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jabster-anti-racism-'));
process.env.DATABASE_PATH = path.join(tempDir, 'database.db');

const { db, initDatabase, get, run, all } = require('../database');
// An existing installation must migrate without resetting its custom settings.
db.exec(`CREATE TABLE guild_settings (
  guildId TEXT PRIMARY KEY,
  censorEnabled INTEGER DEFAULT 0,
  censorRoleId TEXT
);
INSERT INTO guild_settings VALUES ('legacy', 1, 'manager-role');`);
initDatabase();
test.after(() => db.close());

const {
  addCensorTerm, findCensoredTerm, listCensorTerms,
  getCensorSettings, setAntiRacismEnabled
} = require('../utils/censor');
const { handleCensor } = require('../utils/censorMessages');
const { consumeSuppressedMessageDelete } = require('../utils/messageDeletionTracker');
const messageCreate = require('../events/messageCreate');
const messageUpdate = require('../events/messageUpdate');
const censorCommand = require('../commands/config/censor');

const client = { user: { id: 'bot', tag: 'Bot' }, guilds: { cache: new Collection() } };
let nextId = 0;
function makeMessage(guildId, content = 'igniggerniggernigger') {
  return {
    id: `message-${++nextId}`,
    guild: { id: guildId },
    channel: { id: 'channel', parentId: 'category' },
    member: { roles: { cache: new Collection([['bypass-role', {}]]) } },
    author: { id: 'member', tag: 'Member', bot: false },
    content,
    attachments: new Collection(),
    stickers: new Collection(),
    embeds: [],
    deletedCount: 0,
    async delete() { this.deletedCount += 1; }
  };
}

test('anti-racism migration is opt-in and preserves existing server configuration', () => {
  const settings = getCensorSettings('legacy');
  assert.equal(settings.censorAntiRacismEnabled, 0);
  assert.equal(settings.censorEnabled, 1);
  assert.equal(settings.censorRoleId, 'manager-role');
});

test('anti-racism is guild-scoped and works without logging or custom censor terms', async () => {
  setAntiRacismEnabled('preset', true);
  assert.equal(getCensorSettings('preset').censorEnabled, 0);
  assert.deepEqual(listCensorTerms('preset'), []);

  const message = makeMessage('preset');
  assert.equal(await handleCensor(message, client), true);
  assert.equal(message.deletedCount, 1);
  assert.equal(consumeSuppressedMessageDelete(message.id), true);
  const audit = get('SELECT * FROM audit_logs WHERE guildId = ?', ['preset']);
  assert.equal(audit.action, 'MESSAGE_CENSORED');
  assert.equal(audit.targetId, 'member');
  assert.equal(JSON.parse(audit.metadata).filter, 'ANTI_RACISM');
  assert.equal(get('SELECT COUNT(*) AS total FROM cases').total, 0);

  const otherGuild = makeMessage('not-enabled');
  assert.equal(await handleCensor(otherGuild, client), false);
  assert.equal(otherGuild.deletedCount, 0);
  setAntiRacismEnabled('preset', false);
  assert.equal(await handleCensor(makeMessage('preset'), client), false);
});

test('custom terms retain their exemptions but anti-racism has no custom exemptions', async () => {
  setAntiRacismEnabled('exemptions', true);
  run(`UPDATE guild_settings SET censorEnabled = 1,
    censorBypassRoleIds = ?, censorBypassChannelIds = ?, censorBypassCategoryIds = ?
    WHERE guildId = ?`, ['["bypass-role"]', '["channel"]', '["category"]', 'exemptions']);
  addCensorTerm({ guildId: 'exemptions', word: 'customword', addedBy: 'manager' });
  assert.equal(await handleCensor(makeMessage('exemptions', 'customword'), client), false);
  assert.equal(await handleCensor(makeMessage('exemptions'), client), true);
});

test('existing custom racial terms catch concatenation even with the preset off', async () => {
  setAntiRacismEnabled('custom', false);
  run('UPDATE guild_settings SET censorEnabled = 1 WHERE guildId = ?', ['custom']);
  addCensorTerm({ guildId: 'custom', word: 'nigger', addedBy: 'manager' });
  assert.equal(await handleCensor(makeMessage('custom'), client), true);
  assert.equal(findCensoredTerm('wetback', listCensorTerms('custom')), null);
  assert.equal(findCensoredTerm('assignment', ['ass']), null);
});

test('new messages use the shared preset and stop processing once deleted', async () => {
  setAntiRacismEnabled('new-message', true);
  const message = makeMessage('new-message');
  await messageCreate.execute(message, client);
  assert.equal(message.deletedCount, 1);
  assert.equal(all('SELECT * FROM audit_logs WHERE guildId = ?', ['new-message']).length, 1);
});

test('editing a previously safe message is rechecked even without the old message cached', async () => {
  setAntiRacismEnabled('edits', true);
  const message = makeMessage('edits');
  message.editedTimestamp = Date.now();
  const old = { partial: true, async fetch() { throw new Error('Not cached'); } };
  await messageUpdate.execute(old, message, client);
  assert.equal(message.deletedCount, 1);
  const audit = get('SELECT * FROM audit_logs WHERE guildId = ?', ['edits']);
  assert.equal(JSON.parse(audit.metadata).edited, true);

  const hydrated = makeMessage('edits');
  hydrated.editedTimestamp = Date.now();
  await messageUpdate.execute(old, { partial: true, async fetch() { return hydrated; } }, client);
  assert.equal(hydrated.deletedCount, 1);
});

test('deletion failures do not claim success or suppress a later deletion log', async t => {
  setAntiRacismEnabled('delete-failure', true);
  const message = makeMessage('delete-failure');
  message.delete = async () => { throw new Error('Missing Manage Messages'); };
  const errors = t.mock.method(console, 'error', () => {});
  assert.equal(await handleCensor(message, client), false);
  assert.equal(consumeSuppressedMessageDelete(message.id), false);
  assert.equal(all('SELECT * FROM audit_logs WHERE guildId = ?', ['delete-failure']).length, 0);
  assert.equal(errors.mock.callCount(), 1);
});

test('safe messages, direct messages, and other bots are not deleted', async () => {
  setAntiRacismEnabled('safe', true);
  assert.equal(await handleCensor(makeMessage('safe', 'Our class is in Pakistan.'), client), false);
  const dm = makeMessage('safe');
  dm.guild = null;
  assert.equal(await handleCensor(dm, client), false);
  const bot = makeMessage('safe');
  bot.author.bot = true;
  assert.equal(await handleCensor(bot, client), false);
});

function makeInteraction(guildId, permissions = [], roles = []) {
  return {
    guild: { id: guildId },
    memberPermissions: new PermissionsBitField(permissions),
    member: { roles: { cache: new Collection(roles.map(id => [id, {}])) } },
    options: { getSubcommand: () => 'antiracism', getBoolean: () => true },
    async editReply(payload) { this.response = payload; }
  };
}

test('only Manage Server or the configured censor manager can toggle the preset', async () => {
  const schema = censorCommand.data.toJSON();
  const option = schema.options.find(sub => sub.name === 'antiracism').options[0];
  assert.equal(option.name, 'enabled');
  assert.equal(option.required, true);
  assert.equal(option.type, 5);

  const denied = makeInteraction('access');
  await censorCommand.execute(denied);
  assert.match(denied.response.content, /need Manage Server/);
  assert.equal(getCensorSettings('access'), undefined);

  const manager = makeInteraction('access', [PermissionFlagsBits.ManageGuild]);
  await censorCommand.execute(manager);
  assert.equal(getCensorSettings('access').censorAntiRacismEnabled, 1);
  manager.options.getBoolean = () => false;
  await censorCommand.execute(manager);
  assert.equal(getCensorSettings('access').censorAntiRacismEnabled, 0);

  run('UPDATE guild_settings SET censorRoleId = ? WHERE guildId = ?', ['role', 'access']);
  await censorCommand.execute(makeInteraction('access', [], ['role']));
  assert.equal(getCensorSettings('access').censorAntiRacismEnabled, 1);

  const status = makeInteraction('access', [], ['role']);
  status.options.getSubcommand = () => 'status';
  await censorCommand.execute(status);
  assert.match(status.response.embeds[0].toJSON().fields.find(field => field.name === 'Anti-Racism').value, /Active/);
});

test('enabled and disabled settings persist through a fresh process and database initialization', () => {
  setAntiRacismEnabled('restart-enabled', true);
  setAntiRacismEnabled('restart-disabled', false);
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const { initDatabase, db } = require('./database');
    initDatabase();
    const { getCensorSettings } = require('./utils/censor');
    assert.equal(getCensorSettings('restart-enabled').censorAntiRacismEnabled, 1);
    assert.equal(getCensorSettings('restart-disabled').censorAntiRacismEnabled, 0);
    assert.equal(getCensorSettings('legacy').censorRoleId, 'manager-role');
    db.close();
  `], { cwd: path.join(__dirname, '..'), env: process.env, encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);
});
