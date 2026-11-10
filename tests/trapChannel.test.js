const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ChannelType, Collection, PermissionFlagsBits: P, PermissionsBitField } = require('discord.js');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'jabster-trap-channel-'));
process.env.DATABASE_PATH = path.join(temporary, 'test.db');
const { db, get, all, run, initDatabase } = require('../database');
initDatabase();
test.after(() => { db.close(); fs.rmSync(temporary, { recursive: true, force: true }); });
test.afterEach(() => run('DELETE FROM trap_channel_incidents'));
const trap = require('../utils/trapChannel');
const command = require('../commands/config/trapchannel');
let counter = 0;

function fixture() {
  const id = `trap-guild-${++counter}`;
  const order = [];
  const bans = new Map();
  const state = { sends: 0, banCalls: 0, unbanCalls: 0, dmFail: false, banFail: false, loseBanResponse: false, fetchError: null, unbanFail: false };
  const user = { id: 'member', bot: false, send: async payload => {
    order.push('dm'); state.sends += 1; state.dm = payload;
    if (state.onDm) await state.onDm();
    if (state.dmFail) throw Object.assign(new Error('DMs are closed'), { code: 50007 });
  } };
  const member = { id: user.id, user, permissions: new PermissionsBitField(), roles: { cache: new Collection() }, bannable: true };
  const bot = { id: 'bot', permissions: new PermissionsBitField(P.Administrator) };
  const channel = { id: 'trap', guildId: id, type: ChannelType.GuildText, permissionsFor: () => bot.permissions,
    send: async payload => { state.warning = payload; return { id: 'warning' }; } };
  const guild = { id, ownerId: 'owner', name: 'Test server',
    channels: { cache: new Collection([['trap',channel]]) },
    members: { me: bot, fetchMe: async () => bot, fetch: async () => member,
      ban: async (userId, options) => {
        order.push('ban'); state.banCalls += 1;
        if (state.banFail) throw Object.assign(new Error('Cannot ban'), { code: 50013 });
        bans.set(userId, { reason: options.reason });
        state.banOptions = options;
        if (state.loseBanResponse) throw new Error('Connection lost after Discord accepted the ban');
      },
      unban: async userId => {
        state.unbanCalls += 1;
        if (state.unbanFail) throw new Error('Temporary unban error');
        bans.delete(userId);
      }
    },
    bans: { fetch: async options => {
      assert.equal(options.force,true);
      if (state.fetchError) throw state.fetchError;
      if (!bans.has(options.user)) throw Object.assign(new Error('Unknown Ban'), { code: 10026 });
      return bans.get(options.user);
    } }
  };
  const client = { user: { id: 'bot' }, guilds: { cache: new Collection([[id,guild]]) },
    channels: { fetch: async () => null },
    fetchInvite: async () => ({ guild: { id }, expiresTimestamp: null }) };
  const message = { id: `message-${counter}`, guild, channelId: 'trap', channel, author: user, member, content: 'Never reflect this content' };
  run(`INSERT INTO trap_channel_settings(guildId,channelId,inviteUrl,durationHours,enabled,updatedBy,updatedAt)
    VALUES(?,'trap','https://discord.gg/safe',6,1,'owner',?)`,[id,Date.now()]);
  const incident = () => get('SELECT * FROM trap_channel_incidents WHERE guildId=? ORDER BY createdAt DESC LIMIT 1',[id]);
  return { id,client,guild,channel,message,member,bot,state,bans,order,incident };
}

function interaction(f, action, values = {}) {
  const result = { replies: [] };
  result.value = { client: f.client, guild: f.guild, user: { id: 'owner' }, inGuild: () => true,
    memberPermissions: new PermissionsBitField(P.Administrator),
    options: { getSubcommand: () => action, getChannel: name => values[name], getString: name => values[name],
      getBoolean: name => values[name], getInteger: name => values[name], getRole: name => values[name], getUser: name => values[name] },
    editReply: async payload => { result.replies.push(payload); return payload; } };
  return result;
}

async function quietly(work) {
  const original = console.error;
  console.error = () => {};
  try { return await work(); } finally { console.error = original; }
}

test('schema is additive, global command serializes and requires Administrator', () => {
  const json = command.data.toJSON();
  assert.equal(json.name,'trapchannel');
  assert.equal(json.default_member_permissions,P.Administrator.toString());
  assert.equal(json.dm_permission,false);
  assert.equal(json.options.length,7);
  const required = json.options[0].options.filter(option=>option.required).map(option=>option.name);
  assert.deepEqual(required,['channel','invite','confirm']);
  assert.equal(get("SELECT COUNT(*) AS count FROM trap_channel_settings").count,0);
});

test('disabled, unrelated channels, bots, webhooks, system messages and DMs never trigger', async () => {
  const f = fixture();
  for (const changes of [{channelId:'general'},{author:{...f.message.author,bot:true}},{webhookId:'webhook'},{system:true},{guild:null}]) {
    assert.equal(await trap.handleTrapMessage({...f.message,...changes},f.client),false);
  }
  run('UPDATE trap_channel_settings SET enabled=0 WHERE guildId=?',[f.id]);
  assert.equal(await trap.handleTrapMessage(f.message,f.client),false);
  assert.equal(f.state.banCalls,0);
});

test('owner, staff permissions, configured ticket roles and additional exemptions cannot be trap-banned', async () => {
  const f = fixture();
  f.member.id = f.guild.ownerId;
  assert.equal(trap.isExempt(f.member,f.guild),true);
  f.member.id = 'member';
  for (const permission of [P.Administrator,P.ManageGuild,P.BanMembers,P.KickMembers,P.ModerateMembers,P.ManageMessages,P.ManageRoles,P.ManageChannels,P.ManageWebhooks]) {
    f.member.permissions = new PermissionsBitField(permission);
    await trap.handleTrapMessage(f.message,f.client);
    assert.equal(f.state.banCalls,0);
  }
  f.member.permissions = new PermissionsBitField();
  run("INSERT INTO guild_settings(guildId,staffRoleId) VALUES(?,'staff')",[f.id]);
  f.member.roles.cache.set('staff',{});
  assert.equal(trap.isExempt(f.member,f.guild),true);
  f.member.roles.cache.clear();
  run("INSERT INTO ticket_settings(guildId,type,enabled,roleId) VALUES(?,'application',1,'reviewer')",[f.id]);
  f.member.roles.cache.set('reviewer',{});
  assert.equal(trap.isExempt(f.member,f.guild),true);
  f.member.roles.cache.clear();
  const form = require('../utils/applications').createForm({ guildId:f.id,name:'Moderator',description:'Review team',reviewerRoleId:'application-reviewer',createdBy:'owner' });
  assert.ok(form);
  f.member.roles.cache.set('application-reviewer',{});
  assert.equal(trap.isExempt(f.member,f.guild),true);
  f.member.roles.cache.clear();
  run("INSERT INTO trap_channel_exempt_roles(guildId,roleId) VALUES(?,'trusted')",[f.id]);
  f.member.roles.cache.set('trusted',{});
  await trap.handleTrapMessage(f.message,f.client);
  assert.equal(f.state.banCalls,0);
});

test('eligible post sends recovery DM before banning and writes exactly one punishment case', async () => {
  const f = fixture();
  const before = Date.now();
  assert.equal(await trap.handleTrapMessage(f.message,f.client),true);
  assert.deepEqual(f.order,['dm','ban']);
  const row = f.incident();
  assert.equal(row.status,'ACTIVE');
  assert.equal(row.dmSent,1);
  assert.ok(row.expiresAt >= before+6*3_600_000 && row.expiresAt <= Date.now()+6*3_600_000);
  const punishment = get('SELECT * FROM cases WHERE id=?',[row.caseId]);
  assert.equal(punishment.action,'BAN');
  assert.equal(punishment.duration,'6h');
  assert.equal(punishment.expiresAt,row.expiresAt);
  assert.equal(f.state.banOptions.deleteMessageSeconds,0);
  assert.equal(JSON.stringify(f.state.dm).includes(f.message.content),false);
  assert.match(JSON.stringify(f.state.dm),/https:\/\/discord.gg\/safe/);
  assert.match(JSON.stringify(f.state.dm),/not proof/);
});

test('closed DMs do not prevent the temporary ban', async () => {
  const f = fixture(); f.state.dmFail = true;
  await trap.handleTrapMessage(f.message,f.client);
  assert.equal(f.incident().dmSent,0);
  assert.equal(f.incident().status,'ACTIVE');
  assert.equal(f.state.banCalls,1);
});

test('simultaneous posts do not cause duplicate DMs, bans or cases', async () => {
  const f = fixture();
  await Promise.all([trap.handleTrapMessage(f.message,f.client),trap.handleTrapMessage({...f.message,id:'second'},f.client)]);
  assert.equal(f.state.sends,1);
  assert.equal(f.state.banCalls,1);
  assert.equal(get('SELECT COUNT(*) AS count FROM cases WHERE guildId=?',[f.id]).count,1);
});

test('permission, hierarchy and temporary member-fetch failures never produce speculative bans', async () => {
  const f = fixture(); f.member.bannable = false;
  await quietly(()=>trap.handleTrapMessage(f.message,f.client));
  f.member.bannable = true; f.bot.permissions = new PermissionsBitField();
  await quietly(()=>trap.handleTrapMessage(f.message,f.client));
  f.bot.permissions = new PermissionsBitField(P.Administrator);
  f.guild.members.fetch = async () => { throw new Error('Discord unavailable'); };
  await quietly(()=>trap.handleTrapMessage(f.message,f.client));
  assert.equal(f.state.banCalls,0);
  assert.equal(f.incident(),undefined);
});

test('disabling protection or adding a staff permission during DM delivery cancels the pending ban', async () => {
  for (const change of ['disable','promote']) {
    const f = fixture();
    f.state.onDm = () => change === 'disable'
      ? run('UPDATE trap_channel_settings SET enabled=0 WHERE guildId=?',[f.id])
      : f.member.permissions.add(P.ManageGuild);
    await trap.handleTrapMessage(f.message,f.client);
    assert.equal(f.state.banCalls,0);
    assert.equal(f.incident().status,'CANCELLED');
    assert.equal(get('SELECT COUNT(*) AS count FROM cases WHERE guildId=?',[f.id]).count,0);
  }
});

test('uncertain accepted ban is recovered without sending another DM or applying another ban', async () => {
  const f = fixture(); f.state.loseBanResponse = true;
  await quietly(()=>trap.handleTrapMessage(f.message,f.client));
  assert.equal(f.incident().status,'BANNING');
  await trap.reconcileIncident(f.client,f.incident().id);
  assert.equal(f.incident().status,'ACTIVE');
  assert.ok(f.incident().caseId);
  assert.equal(f.state.sends,1);
  assert.equal(f.state.banCalls,1);
});

test('recovery never retries an unapplied ban and never invents a case for it', async () => {
  const f = fixture(); f.state.banFail = true;
  await quietly(()=>trap.handleTrapMessage(f.message,f.client));
  assert.equal(f.incident().status,'BANNING');
  await trap.reconcileIncident(f.client,f.incident().id);
  assert.equal(f.incident().status,'CANCELLED');
  assert.equal(f.incident().caseId,null);
  assert.equal(f.state.banCalls,1);
});

test('expiry persists to disk and is processed after a fresh-process restart even when protection was disabled', async () => {
  const f = fixture(); await trap.handleTrapMessage(f.message,f.client);
  run('UPDATE trap_channel_incidents SET expiresAt=? WHERE id=?',[Date.now()-1000,f.incident().id]);
  run('UPDATE trap_channel_settings SET enabled=0 WHERE guildId=?',[f.id]);
  const script = `const d=require('./database');d.initDatabase();
    const row=d.get('SELECT * FROM trap_channel_incidents WHERE id=?',[process.env.INCIDENT_ID]);
    let removed=0;const guild={bans:{fetch:async()=>({reason:row.banReason})},members:{unban:async()=>{removed++;}}};
    const client={user:{id:'bot'},guilds:{cache:new Map([[row.guildId,guild]])},channels:{fetch:async()=>null}};
    require('./utils/trapChannel').processTrapBans(client).then(()=>{
      if(removed!==1||d.get('SELECT status FROM trap_channel_incidents WHERE id=?',[row.id]).status!=='RELEASED')process.exitCode=1;
      d.db.close();}).catch(e=>{console.error(e);process.exitCode=1;d.db.close();});`;
  const child = spawnSync(process.execPath,['-e',script],{cwd:path.resolve(__dirname,'..'),
    env:{...process.env,INCIDENT_ID:f.incident().id},encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);
  assert.equal(f.incident().status,'RELEASED');
  assert.equal(get('SELECT COUNT(*) AS count FROM cases WHERE guildId=?',[f.id]).count,1);
});

test('expiry leaves newer/manual bans untouched and does not unban early', async () => {
  const f = fixture(); await trap.handleTrapMessage(f.message,f.client);
  await trap.reconcileIncident(f.client,f.incident().id);
  assert.equal(f.state.unbanCalls,0);
  f.bans.set('member',{reason:'Permanent ban by staff'});
  await trap.reconcileIncident(f.client,f.incident().id,f.incident().expiresAt+1);
  assert.equal(f.incident().status,'SUPERSEDED');
  assert.equal(f.state.unbanCalls,0);
});

test('manual unban and rejoin do not exempt the user from future trap incidents', async () => {
  const f = fixture(); await trap.handleTrapMessage(f.message,f.client);
  const firstId = f.incident().id;
  f.bans.clear();
  await trap.handleTrapMessage({...f.message,id:'after-rejoin'},f.client);
  assert.equal(f.state.banCalls,2);
  assert.equal(get('SELECT status FROM trap_channel_incidents WHERE id=?',[firstId]).status,'RELEASED');
  assert.equal(get("SELECT COUNT(*) AS count FROM trap_channel_incidents WHERE guildId=? AND status='ACTIVE'",[f.id]).count,1);
});

test('temporary lookup and unban failures retain the job for retry, then finish once', async () => {
  const f = fixture(); await trap.handleTrapMessage(f.message,f.client);
  const due = f.incident().expiresAt+1;
  f.state.fetchError = new Error('Temporary lookup failure');
  await quietly(()=>trap.processTrapBans(f.client,due));
  assert.equal(f.incident().status,'ACTIVE');
  assert.equal(f.state.unbanCalls,0);
  f.state.fetchError = null; f.state.unbanFail = true;
  await quietly(()=>trap.processTrapBans(f.client,due+60_001));
  assert.equal(f.incident().status,'RELEASING');
  f.state.unbanFail = false;
  await trap.processTrapBans(f.client,due+120_002);
  assert.equal(f.incident().status,'RELEASED');
  const unbanCount = f.state.unbanCalls;
  await trap.processTrapBans(f.client,due+180_003);
  assert.equal(f.state.unbanCalls,unbanCount);
});

test('missing ban after a crash during release completes without banning or unbanning again', async () => {
  const f = fixture(); await trap.handleTrapMessage(f.message,f.client);
  run("UPDATE trap_channel_incidents SET status='RELEASING',expiresAt=? WHERE id=?",[Date.now()-1,f.incident().id]);
  f.bans.clear();
  await trap.reconcileIncident(f.client,f.incident().id);
  assert.equal(f.incident().status,'RELEASED');
  assert.equal(f.state.unbanCalls,0);
  assert.equal(f.state.banCalls,1);
});

test('admin hold cancels automatic expiry while preserving the original case', async () => {
  const f = fixture(); await trap.handleTrapMessage(f.message,f.client);
  const caseId = f.incident().caseId;
  await trap.holdTrapBan(f.client,f.id,'member');
  assert.equal(f.incident().status,'HELD');
  assert.equal(get('SELECT expiresAt FROM cases WHERE id=?',[caseId]).expiresAt,null);
  await trap.processTrapBans(f.client,f.incident().expiresAt+1);
  assert.equal(f.state.unbanCalls,0);
  assert.equal(get('SELECT COUNT(*) AS count FROM cases WHERE guildId=?',[f.id]).count,1);
});

test('command enforces admin checks at runtime even if integration defaults are overridden', async () => {
  const f = fixture();
  const request = interaction(f,'disable');
  request.value.memberPermissions = new PermissionsBitField(P.ManageGuild);
  await command.execute(request.value);
  assert.match(request.replies[0].content,/Only server administrators/);
  assert.equal(trap.settingsFor(f.id).enabled,1);
});

test('setup requires confirmation, correct server invite and sufficient invite lifetime', async () => {
  const f = fixture();
  const options = { channel:f.channel,invite:'https://discord.gg/safe',confirm:false };
  await command.execute(interaction(f,'set',options).value);
  assert.equal(f.state.warning,undefined);
  options.confirm = true;
  f.client.fetchInvite = async () => ({guild:{id:'different-server'}});
  let request = interaction(f,'set',options);
  await command.execute(request.value);
  assert.match(request.replies[0].content,/back to this server/);
  f.client.fetchInvite = async () => ({guild:{id:f.id},expiresTimestamp:Date.now()+3_600_000});
  request = interaction(f,'set',options);
  await command.execute(request.value);
  assert.match(request.replies[0].content,/permanent invite/);
  f.client.fetchInvite = async () => ({guild:{id:f.id},expiresTimestamp:null});
  request = interaction(f,'set',options);
  await command.execute(request.value);
  assert.match(request.replies[0].content,/enabled/);
  assert.match(JSON.stringify(f.state.warning),/Do not post/);
  assert.equal(trap.settingsFor(f.id).durationHours,6);
});

test('invite parser rejects non-Discord destinations, injected paths and query strings', () => {
  assert.equal(command.parseInvite('https://discord.com/invite/rejoin'),'https://discord.gg/rejoin');
  for (const input of ['http://discord.gg/rejoin','https://discord.gg.evil.test/code','https://evil.test/rejoin',
    'https://discord.gg/code?next=evil','https://discord.gg/code/extra']) assert.throws(()=>command.parseInvite(input));
});

test('exemptions persist across process restart and configuration changes do not reset existing expiry', async () => {
  const f = fixture(); await trap.handleTrapMessage(f.message,f.client);
  const deadline = f.incident().expiresAt;
  const role = {id:'trusted',managed:false,toString:()=>'<@&trusted>'};
  await command.execute(interaction(f,'exempt-add',{role}).value);
  const child = spawnSync(process.execPath,['-e',`const d=require('./database');d.initDatabase();
    if(!d.get('SELECT 1 FROM trap_channel_exempt_roles WHERE guildId=? AND roleId=?',[process.env.GUILD,'trusted']))process.exitCode=1;d.db.close();`],
  {cwd:path.resolve(__dirname,'..'),env:{...process.env,GUILD:f.id},encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);
  run('UPDATE trap_channel_settings SET durationHours=24 WHERE guildId=?',[f.id]);
  assert.equal(f.incident().expiresAt,deadline);
  assert.equal(all('SELECT * FROM trap_channel_exempt_roles WHERE guildId=?',[f.id]).length,1);
});
