const { get, run, transaction } = require('../database');
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

module.exports = { credited, trackMemberJoin, trackMemberLeave };
