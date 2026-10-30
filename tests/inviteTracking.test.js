const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { Collection } = require('discord.js');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'jabster-invites-'));
process.env.DATABASE_PATH = path.join(temp, 'test.db');
const { db, get, all, run, initDatabase } = require('../database');
initDatabase();
const cache = require('../utils/giveaways/cache');
const { trackMemberJoin, trackMemberLeave } = require('../utils/inviteTracking');
test.beforeEach(() => {
  for (const table of ['invites','invite_events','invite_stats','invite_cache','invite_use_credits']) db.exec(`DELETE FROM ${table}`);
  cache.clearGuildCache('guild');
});
test.after(() => { db.close(); fs.rmSync(temp, { recursive: true, force: true }); });
function fixture() {
  const values = new Collection([['abc', { code: 'abc', uses: 0, inviter: { id: 'inviter' } }]]);
  const guild = { id: 'guild', invites: { fetch: async () => new Collection([...values].map(([key, value]) => [key, { ...value }])) },
    fetchVanityData: async () => null };
  const member = (id, joinedTimestamp = Date.now()) => ({ id, guild, joinedTimestamp, user: { bot: false } });
  return { guild, values, member };
}

test('normal invite attribution is captured and join/leave duplicates cannot inflate counters', async () => {
  const f = fixture(); await cache.loadGuildInvites(f.guild);
  f.values.get('abc').uses = 1;
  const member = f.member('one');
  await Promise.all([trackMemberJoin(member), trackMemberJoin(member)]);
  await trackMemberJoin(member);
  assert.equal(get('SELECT invites FROM invite_stats').invites, 1);
  await Promise.all([trackMemberLeave(member), trackMemberLeave(member)]);
  assert.equal(get('SELECT leaves FROM invite_stats').leaves, 1);
  assert.equal(all('SELECT * FROM invite_events').length, 2);
});

test('two concurrent same-code joins both receive credit from one observed counter batch', async () => {
  const f = fixture(); await cache.loadGuildInvites(f.guild);
  f.values.get('abc').uses = 2;
  const result = await Promise.all([trackMemberJoin(f.member('one')), trackMemberJoin(f.member('two'))]);
  assert.ok(result.every(row => row.confidence === 'EXACT' && row.inviterId === 'inviter'));
  assert.equal(get('SELECT invites FROM invite_stats').invites, 2);
});

test('different invite and vanity changes are labelled ambiguous rather than assigned to an arbitrary member', async () => {
  const f = fixture(); let vanityUses = 0;
  f.guild.fetchVanityData = async () => ({ code: 'vanity', uses: vanityUses });
  await cache.loadGuildInvites(f.guild);
  f.values.get('abc').uses = 1; vanityUses = 1;
  const result = await trackMemberJoin(f.member('one'));
  assert.equal(result.confidence, 'AMBIGUOUS');
  assert.equal(result.inviterId, null);
  assert.equal(all('SELECT * FROM invite_stats').length, 0);
});

test('a delayed Discord counter gets retried without losing the original baseline', async () => {
  const f = fixture(); await cache.loadGuildInvites(f.guild);
  let calls = 0;
  f.guild.invites.fetch = async () => new Collection([['abc', { code: 'abc', uses: ++calls > 1 ? 1 : 0, inviter: { id: 'inviter' } }]]);
  const result = await trackMemberJoin(f.member('one'));
  assert.equal(result.confidence, 'EXACT'); assert.equal(calls, 2);
});

test('missing metadata and permission errors remain unknown and do not wipe the last good snapshot', async () => {
  const f = fixture(); await cache.loadGuildInvites(f.guild);
  f.guild.invites.fetch = async () => { throw new Error('Missing Permissions'); };
  const result = await trackMemberJoin(f.member('one'));
  assert.equal(result.confidence, 'UNKNOWN');
  assert.match(result.reason, /Permissions/);
  assert.equal(cache.getGuildInvites('guild').get('abc').uses, 0);
});

test('rejoins maintain net credit and a delayed leave cannot close the newer membership', async () => {
  const f = fixture(); await cache.loadGuildInvites(f.guild);
  f.values.get('abc').uses = 1;
  const first = f.member('one', Date.now() - 10000); await trackMemberJoin(first);
  await trackMemberLeave(first);
  f.values.get('abc').uses = 2;
  const second = f.member('one', Date.now()); await trackMemberJoin(second);
  await trackMemberLeave(first);
  const stats = get('SELECT * FROM invite_stats');
  assert.equal(stats.invites - stats.leaves, 1);
  assert.equal(get('SELECT leftAt FROM invites').leftAt, null);
});

test('fast leave waits for an in-flight attribution lookup before applying the leave', async () => {
  const f = fixture(); await cache.loadGuildInvites(f.guild);
  f.values.get('abc').uses = 1;
  const member = f.member('one');
  await Promise.all([trackMemberJoin(member), trackMemberLeave(member)]);
  const stats = get('SELECT * FROM invite_stats');
  assert.equal(stats.invites, 1); assert.equal(stats.leaves, 1);
});

test('persisted offline use increases are not awarded to the first unrelated member after restart', async () => {
  const f = fixture(); await cache.loadGuildInvites(f.guild);
  const child = spawnSync(process.execPath, ['-e', `const {initDatabase,db}=require('./database');initDatabase();
    const c=require('./utils/giveaways/cache');const {Collection}=require('discord.js');
    c.findUsedInvite({id:'late',guild:{id:'guild',invites:{fetch:async()=>new Collection([['abc',{code:'abc',uses:5,inviter:{id:'inviter'}}]])},fetchVanityData:async()=>null}})
    .then(result=>{if(result.confidence!=='UNKNOWN')process.exitCode=2;db.close();});`],
  { cwd: path.resolve(__dirname, '..'), env: { ...process.env }, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
});

test('vanity joins are recorded separately and do not credit a person', async () => {
  const f = fixture(); let uses = 0;
  f.guild.fetchVanityData = async () => ({ code: 'vanity', uses });
  await cache.loadGuildInvites(f.guild); uses = 1;
  const result = await trackMemberJoin(f.member('one'));
  assert.equal(result.source, 'VANITY'); assert.equal(result.inviterId, null);
});

test('startup preserves legacy totals even when the newer invite event history is incomplete', () => {
  run(`INSERT INTO invite_stats (guildId,userId,invites,leaves,fake,bonus) VALUES ('guild','inviter',10,2,1,5)`);
  run(`INSERT INTO invite_events (guildId,memberId,inviterId,eventType,confidence,source,timestamp)
    VALUES ('guild','recent-member','inviter','JOIN','EXACT','INVITE',?)`, [Date.now()]);
  for (let restart = 0; restart < 2; restart += 1) {
    const child = spawnSync(process.execPath, ['-e', `const {initDatabase,db}=require('./database');initDatabase();db.close();`],
      { cwd: path.resolve(__dirname, '..'), env: { ...process.env }, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(get('SELECT invites,leaves,fake,bonus FROM invite_stats'), { invites: 10, leaves: 2, fake: 1, bonus: 5 });
  }
});

test('a reserved batch use cannot be stolen by a later unrelated joining member', async () => {
  const f = fixture(); await cache.loadGuildInvites(f.guild);
  run(`INSERT INTO invite_use_credits (guildId,inviteCode,inviterId,remaining,uses,source,confidence,observedAt,expiresAt,membersJson)
    VALUES ('guild','abc','inviter',1,1,'INVITE','EXACT',?,?,?)`, [Date.now(), Date.now()+30000, JSON.stringify(['assigned-member'])]);
  const unrelated = await trackMemberJoin(f.member('unrelated'));
  assert.equal(unrelated.inviterId, null);
  assert.equal(all('SELECT * FROM invite_stats').length, 0);
});
