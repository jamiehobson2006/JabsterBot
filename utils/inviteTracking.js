const { all,get, run, transaction } = require('../database');
const { findUsedInvite } = require('./giveaways/cache');
const joins = new Map();

function credited(row) { return Boolean(row?.inviterId && row.confidence === 'EXACT' && row.source === 'INVITE' && !row.fake); }

function saveLeave(row, now, metadata = {}) {
  const changed = run('UPDATE invites SET leftAt = ? WHERE guildId = ? AND userId = ? AND leftAt IS NULL', [now, row.guildId, row.userId]);
  if (!changed.changes) return false;
  if (credited(row)) run(`INSERT INTO invite_stats (guildId, userId, leaves) VALUES (?, ?, 1)
    ON CONFLICT(guildId,userId) DO UPDATE SET leaves = COALESCE(leaves,0) + 1`, [row.guildId, row.inviterId]);
  run(`INSERT INTO invite_events (guildId, memberId, inviterId, inviteCode, eventType, confidence, source, fake, timestamp, metadata)
    VALUES (?, ?, ?, ?, 'LEAVE', ?, ?, ?, ?, ?)`, [row.guildId, row.userId, row.inviterId,
    row.inviteCode, row.confidence || 'UNKNOWN', row.source || 'UNKNOWN', row.fake || 0, now, JSON.stringify(metadata)]);
  return true;
}

async function trackMemberJoin(member) {
  const key = `${member.guild.id}:${member.id}`;
  if (joins.has(key)) return joins.get(key).then(row => ({ ...row, duplicate: true }));
  const operation = (async () => {
    const before = get('SELECT * FROM invites WHERE guildId = ? AND userId = ?', [member.guild.id, member.id]);
    const joinedAt = Number(member.joinedTimestamp) || Date.now();
    if (before && !before.leftAt && (!member.joinedTimestamp || joinedAt <= before.joinedAt)) return { ...before, duplicate: true };
    const attribution = member.user.bot ? { code: 'OAuth/Bot', confidence: 'UNKNOWN', source: 'BOT' }
      : await findUsedInvite(member);
    return transaction(() => {
      const current = get('SELECT * FROM invites WHERE guildId = ? AND userId = ?', [member.guild.id, member.id]);
      if (current && !current.leftAt && joinedAt <= current.joinedAt) return { ...current, duplicate: true };
      if (current && !current.leftAt) saveLeave(current, joinedAt, { reconciled: true, reason: 'A newer membership join timestamp was observed.' });
      run(`INSERT INTO invites (guildId,userId,inviterId,inviteCode,uses,joinedAt,fake,confidence,source,rejoinCount)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 0) ON CONFLICT(guildId,userId) DO UPDATE SET
        inviterId=excluded.inviterId,inviteCode=excluded.inviteCode,uses=excluded.uses,joinedAt=excluded.joinedAt,
        leftAt=NULL,fake=0,confidence=excluded.confidence,source=excluded.source,rejoinCount=COALESCE(invites.rejoinCount,0)+1`,
      [member.guild.id, member.id, attribution.inviterId || null, attribution.code, attribution.uses || 0,
        joinedAt, attribution.confidence, attribution.source]);
      const row = get('SELECT * FROM invites WHERE guildId = ? AND userId = ?', [member.guild.id, member.id]);
      if (credited(row)) run(`INSERT INTO invite_stats (guildId,userId,invites,fake) VALUES (?, ?, 1, 0)
        ON CONFLICT(guildId,userId) DO UPDATE SET invites = COALESCE(invites,0) + 1`, [member.guild.id, row.inviterId]);
      run(`INSERT INTO invite_events (guildId,memberId,inviterId,inviteCode,eventType,confidence,source,fake,timestamp,metadata)
        VALUES (?, ?, ?, ?, 'JOIN', ?, ?, 0, ?, ?)`, [member.guild.id, member.id, row.inviterId,
        row.inviteCode, row.confidence, row.source, joinedAt, JSON.stringify({ uses: row.uses, reason: attribution.reason || null })]);
      return { ...row, reason: attribution.reason };
    });
  })();
  joins.set(key, operation);
  try { return await operation; } finally { if (joins.get(key) === operation) joins.delete(key); }
}

async function trackMemberLeave(member, now = Date.now()) {
  const pending = joins.get(`${member.guild.id}:${member.id}`);
  if (pending) await pending;
  return transaction(() => {
    const row = get('SELECT * FROM invites WHERE guildId = ? AND userId = ?', [member.guild.id, member.id]);
    if (!row || row.leftAt) return null;
    if (member.joinedTimestamp && Number(member.joinedTimestamp) < Number(row.joinedAt)) return null;
    return saveLeave(row, now) ? { ...row, leftAt: now } : null;
  });
}

function correctAttribution({guildId,memberId,inviterId,actorId,reason}) {
  if(!String(reason || '').trim()) throw new Error('A correction reason is required.');
  if(memberId===inviterId) throw new Error('Members cannot invite themselves.');
  return transaction(()=>{
    const before=get('SELECT * FROM invites WHERE guildId=? AND userId=?',[guildId,memberId]);
    if(!before) throw new Error('This member has no recorded membership to correct.');
    if(credited(before)) {
      run('UPDATE invite_stats SET invites=MAX(0,COALESCE(invites,0)-1),leaves=MAX(0,COALESCE(leaves,0)-?) WHERE guildId=? AND userId=?',
        [before.leftAt?1:0,guildId,before.inviterId]);
    }
    run("UPDATE invites SET inviterId=?,confidence=?,source='INVITE',fake=0 WHERE guildId=? AND userId=?",[inviterId || null,inviterId?'EXACT':'UNKNOWN',guildId,memberId]);
    if(inviterId) run(`INSERT INTO invite_stats(guildId,userId,invites,leaves) VALUES(?,?,1,?) ON CONFLICT(guildId,userId)
      DO UPDATE SET invites=COALESCE(invites,0)+1,leaves=COALESCE(leaves,0)+excluded.leaves`,[guildId,inviterId,before.leftAt?1:0]);
    const after=get('SELECT * FROM invites WHERE guildId=? AND userId=?',[guildId,memberId]);
    run('INSERT INTO invite_corrections(guildId,memberId,actorId,beforeJson,afterJson,reason,createdAt) VALUES(?,?,?,?,?,?,?)',
      [guildId,memberId,actorId,JSON.stringify(before),JSON.stringify(after),String(reason).slice(0,300),Date.now()]);
    run(`INSERT INTO invite_events(guildId,memberId,inviterId,inviteCode,eventType,confidence,source,fake,timestamp,metadata)
      VALUES(?,?,?,?,'CORRECTION',?,'ADMIN',0,?,?)`,[guildId,memberId,inviterId || null,after.inviteCode,after.confidence,Date.now(),JSON.stringify({actorId,reason,previousInviterId:before.inviterId})]);
    return after;
  });
}
async function reconcileMembership(guild,now=Date.now()) {
  return require('./workLeases').withWorkLease(`invite-membership:${guild.id}`,async assertOwned=>{
    const members=await guild.members.fetch();
    if(!members || members.size<Number(guild.memberCount)) throw new Error('A complete member list was not obtained; no membership records were changed.');
    assertOwned();
    return transaction(()=>{
      let left=0,observed=0;
      for(const row of all('SELECT * FROM invites WHERE guildId=? AND leftAt IS NULL',[guild.id])) {
        if(!members.has(row.userId) && saveLeave(row,now,{reconciled:true,reason:'Not present in a complete membership snapshot; exact departure time unknown.'})) left++;
      }
      for(const member of members.values()) {
        if(member.user.bot) continue;
        const before=get('SELECT * FROM invites WHERE guildId=? AND userId=?',[guild.id,member.id]);
        const joinedAt=Number(member.joinedTimestamp) || now;
        if(before && !before.leftAt && joinedAt<=before.joinedAt) continue;
        if(before && !before.leftAt) saveLeave(before,joinedAt,{reconciled:true,reason:'Newer membership observed.'});
        // Offline joins never consume live invite-use credits or invent an inviter.
        run(`INSERT INTO invites(guildId,userId,inviterId,inviteCode,uses,joinedAt,fake,confidence,source,rejoinCount)
          VALUES(?,?,NULL,'Unknown',0,?,0,'UNKNOWN','RECONCILED',0) ON CONFLICT(guildId,userId) DO UPDATE SET
          inviterId=NULL,inviteCode='Unknown',uses=0,joinedAt=excluded.joinedAt,leftAt=NULL,fake=0,confidence='UNKNOWN',source='RECONCILED',rejoinCount=rejoinCount+1`,[guild.id,member.id,joinedAt]);
        run(`INSERT INTO invite_events(guildId,memberId,eventType,confidence,source,fake,timestamp,metadata)
          VALUES(?,?,'RECONCILED','UNKNOWN','RECONCILED',0,?,?)`,[guild.id,member.id,now,JSON.stringify({reason:'Membership observed without reliable invite evidence.'})]);
        observed++;
      }
      return {left,observed};
    });
  });
}
module.exports = { credited, correctAttribution,reconcileMembership,trackMemberJoin, trackMemberLeave };
