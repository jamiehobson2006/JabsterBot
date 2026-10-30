const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Collection, PermissionFlagsBits, PermissionsBitField } = require('discord.js');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'jabster-audit-services-'));
process.env.DATABASE_PATH = path.join(temporary, 'test.db');
const { db, get, run, initDatabase } = require('../database');
initDatabase();
test.after(() => { db.close(); fs.rmSync(temporary, { recursive: true, force: true }); });

test('level rewards remain pending through temporary permission failures and recover when repaired', async () => {
  const service = require('../utils/LevelingService');
  run("INSERT INTO leveling_rewards(guildId,level,roleId) VALUES('levels',2,'reward')");
  run("INSERT INTO leveling_users(guildId,userId,level) VALUES('levels','member',2)");
  run("INSERT INTO leveling_reward_grants(guildId,userId,roleId,level,status) VALUES('levels','member','reward',2,'PENDING')");
  const role = { id: 'reward', position: 1, permissions: new PermissionsBitField(), managed: false };
  let grants = 0;
  const member = { id: 'member', roles: { cache: new Collection(), add: async () => { grants += 1; } } };
  const guild = { id: 'levels', roles: { cache: new Collection([['reward',role]]) }, members: {
    me: { permissions: new PermissionsBitField(), roles: { highest: { position: 100 } } }, fetch: async () => member } };
  const client = { guilds: { cache: new Collection([['levels',guild]]) } };
  await service.processPending(client, 'levels');
  let grant = get("SELECT * FROM leveling_reward_grants WHERE guildId='levels'");
  assert.equal(grant.status, 'PENDING');
  assert.ok(grant.nextAttemptAt > Date.now());
  guild.members.me.permissions.add(PermissionFlagsBits.ManageRoles);
  run("UPDATE leveling_reward_grants SET nextAttemptAt=0 WHERE guildId='levels'");
  await service.processPending(client, 'levels');
  grant = get("SELECT * FROM leveling_reward_grants WHERE guildId='levels'");
  assert.equal(grant.status, 'GRANTED');
  assert.equal(grants, 1);
});

test('role reward REST failures back off rather than becoming permanently failed after five attempts', async () => {
  const service = require('../utils/LevelingService');
  run("INSERT INTO leveling_rewards(guildId,level,roleId) VALUES('retry-levels',2,'role')");
  run("INSERT INTO leveling_users(guildId,userId,level) VALUES('retry-levels','member',2)");
  run("INSERT INTO leveling_reward_grants(guildId,userId,roleId,level,status,attempts) VALUES('retry-levels','member','role',2,'PENDING',5)");
  const role = { id: 'role', position: 1, permissions: new PermissionsBitField() };
  const guild = { id: 'retry-levels', roles: { cache: new Collection([['role',role]]) }, members: {
    me: { permissions: new PermissionsBitField(PermissionFlagsBits.ManageRoles), roles: { highest: { position: 100 } } },
    fetch: async () => ({ id: 'member', roles: { cache: new Collection(), add: async () => { throw new Error('Temporary role API failure'); } } }) } };
  await service.processPending({ guilds: { cache: new Collection([['retry-levels',guild]]) } }, 'retry-levels');
  const row = get("SELECT * FROM leveling_reward_grants WHERE guildId='retry-levels'");
  assert.equal(row.status, 'PENDING');
  assert.equal(row.attempts, 6);
  assert.ok(row.nextAttemptAt > Date.now());
});

test('retrying old rewards never grants a removed mapping or an unearned level', async () => {
  const service = require('../utils/LevelingService');
  run("INSERT INTO leveling_users(guildId,userId,level) VALUES('stale-rewards','member',1)");
  run("INSERT INTO leveling_rewards(guildId,level,roleId) VALUES('stale-rewards',10,'not-earned')");
  run("INSERT INTO leveling_reward_grants(guildId,userId,roleId,level,status) VALUES('stale-rewards','member','removed',1,'PENDING'),('stale-rewards','member','not-earned',10,'PENDING')");
  let additions = 0;
  const guild = { id: 'stale-rewards', roles: { cache: new Collection() }, members: { fetch: async () => ({ id: 'member', roles: { add: async () => { additions += 1; } } }) } };
  await service.processPending({ guilds: { cache: new Collection([['stale-rewards',guild]]) } }, 'stale-rewards');
  assert.equal(get("SELECT COUNT(*) AS total FROM leveling_reward_grants WHERE guildId='stale-rewards' AND status='CANCELLED'").total, 2);
  assert.equal(additions, 0);
});

test('staff directories and rotas retain all entries in independently valid message pages', () => {
  const directory = require('../services/StaffListService');
  const rota = require('../services/StaffRotaService');
  const guild = { id: 'guild', name: 'Audit guild', iconURL: () => null };
  const members = Array.from({ length: 180 }, (_, index) => ({ id: String(100000000000000000n + BigInt(index)),
    displayName: 'A'.repeat(32), guild, roles: { cache: new Collection([['staff', { id: 'staff', name: 'Staff', position: 1 }]]) } }));
  const pages = directory.buildEmbeds(guild, { name: 'Staff' }, members);
  assert.ok(pages.length > 1);
  assert.ok(pages.every(page => page.length <= 6000 && page.data.fields.length <= 25));
  const text = pages.flatMap(page => page.data.fields).map(field => field.value).join('\n');
  assert.equal(members.filter(member => text.includes(`<@${member.id}>`)).length, 180);
  const shifts = members.map((member, index) => ({ id: index + 1, userId: member.id, dayOfWeek: 0,
    startMinute: 0, endMinute: 1439, timezone: 'Europe/London', escalationOrder: 1 }));
  const schedule = rota.buildRotaEmbeds(guild, shifts, [], new Date('2026-11-01T12:00:00Z'));
  assert.ok(schedule.length > 1);
  assert.ok(schedule.every(page => page.length <= 6000));
  assert.equal(schedule.flatMap(page => page.data.fields).filter(field => field.name.startsWith('Weekly Schedule')).map(field => field.value).join('\n').split('\n').length, 180);
});

test('dashboard page IDs persist, reuse existing messages and remove only obsolete owned pages', async () => {
  const { fieldPages, syncEmbedPages } = require('../utils/embedPages');
  const { EmbedBuilder } = require('discord.js');
  const pages = fieldPages(new EmbedBuilder().setTitle('Dashboard'), Array.from({ length: 12 }, (_, index) => ({ name: `Section ${index}`, value: 'x'.repeat(1000) })));
  const stored = new Collection();
  let sends = 0;
  let ids = [];
  const channel = { messages: { fetch: async id => stored.get(id) }, send: async payload => {
    const id = `page-${++sends}`;
    const message = { id, author: { id: 'bot' }, edit: async () => message, delete: async () => stored.delete(id), payload };
    stored.set(id,message); return message;
  } };
  const sync = embeds => syncEmbedPages({ channel, embeds, ids, botId: 'bot', save: value => { ids = [...value]; } });
  await sync(pages);
  assert.equal(sends, pages.length);
  await sync(pages);
  assert.equal(sends, pages.length);
  await sync(pages.slice(0,1));
  assert.equal(stored.size, 1);
  assert.equal(ids.length, 1);
});

test('a deleted Twitch announcement clears ended state but a temporary fetch failure does not', async t => {
  const twitch = require('../utils/twitch');
  const original = twitch.getStream;
  twitch.getStream = async () => null;
  delete require.cache[require.resolve('../utils/socialMonitor')];
  const monitor = require('../utils/socialMonitor');
  t.after(() => { twitch.getStream = original; delete require.cache[require.resolve('../utils/socialMonitor')]; });
  for (const id of ['deleted','transient']) run(`INSERT INTO social_channels(guildId,platform,creatorId,creatorName,contentType,targetChannelId,lastTwitchStreamId,lastLiveMessageId)
    VALUES('twitch','twitch',?,?,'streams','channel','stream',?)`, [id,id,id]);
  const client = { channels: { fetch: async () => ({ messages: { fetch: async id => {
    if (id === 'deleted') throw Object.assign(new Error('Unknown Message'), { code: 10008 });
    throw new Error('Temporary Discord outage');
  } } }) } };
  await monitor.checkEndedTwitchStreams(client);
  assert.equal(get("SELECT lastTwitchStreamId FROM social_channels WHERE creatorId='deleted'").lastTwitchStreamId, null);
  assert.equal(get("SELECT lastTwitchStreamId FROM social_channels WHERE creatorId='transient'").lastTwitchStreamId, 'stream');
});

test('Steam promotion receipts change only for a later verified period and survive restart', async t => {
  const games = require('../utils/freeGames');
  const axios = require('axios');
  const originalGet = axios.get;
  t.after(() => { axios.get = originalGet; });
  const now = Date.now();
  const offer = { key: 'steam:123', source: 'STEAM', title: 'Game', endsAt: null };
  const initial = games.observeSteamOffer(offer, 'GB', now);
  assert.equal(initial.key, 'steam:123');
  assert.equal(games.observeSteamOffer(offer, 'GB', now + 91 * 86_400_000).key, initial.key);
  axios.get = async () => { throw new Error('Store temporarily unavailable'); };
  await games.verifyMissingSteamOffers([], 'GB', now+1000);
  assert.equal(get("SELECT isFree FROM free_game_observations WHERE offerKey='GB:steam:123'").isFree, 1);
  axios.get = async () => ({ data: { 123: { success: true, data: { price_overview: { final: 1999 } } } } });
  await games.verifyMissingSteamOffers([], 'GB', now+2000);
  const next = games.observeSteamOffer(offer, 'GB', now+3000);
  assert.notEqual(next.key, initial.key);
  const child = spawnSync(process.execPath, ['-e', "const d=require('./database');d.initDatabase();const g=require('./utils/freeGames');console.log(g.observeSteamOffer({key:'steam:123',source:'STEAM'},'GB').key);d.db.close();"],
    { cwd: path.resolve(__dirname,'..'), env: { ...process.env }, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout.trim().split(/\r?\n/).at(-1), next.key);
});

test('Steam offers with explicit windows can announce a later promotion without a 90-day wait', () => {
  const games = require('../utils/freeGames');
  const now = Date.now();
  const old = games.observeSteamOffer({ key: 'steam:456', source: 'STEAM', endsAt: now+1000 }, 'GB', now);
  const later = games.observeSteamOffer({ key: 'steam:456', source: 'STEAM', endsAt: now+10000 }, 'GB', now+2000);
  assert.notEqual(later.key, old.key);
  assert.equal(games.observeSteamOffer({ key: 'steam:456', source: 'STEAM', endsAt: now+10000 }, 'GB', now+3000).key, later.key);
});
