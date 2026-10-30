const { Collection } = require('discord.js');
const { all, run, transaction } = require('../../database');

const cache = { invites: new Collection(), tickets: new Collection(), temp: new Collection() };
const states = new Map();
const queues = new Map();
const waiting = new Map();
const VANITY = '__VANITY__';
const GRACE_MS = 30_000;

function serial(guildId, operation) {
  const previous = queues.get(guildId) || Promise.resolve();
  const next = previous.catch(() => null).then(operation);
  queues.set(guildId, next);
  return next.finally(() => { if (queues.get(guildId) === next) queues.delete(guildId); });
}

function inviteData(invite, previous) {
  return { code: invite.code, uses: Number(invite.uses) || 0,
    inviterId: invite.inviter?.id || previous?.inviterId || null,
    inviterTag: invite.inviter?.tag || previous?.inviterTag || 'Unknown',
    maxUses: Number(invite.maxUses) || 0, deletedAt: null,
    createdAt: invite.createdTimestamp || previous?.createdAt || Date.now() };
}

function hydrateGuildInvites(guildId) {
  if (cache.invites.has(guildId)) return cache.invites.get(guildId);
  const result = new Collection();
  for (const row of all('SELECT * FROM invite_cache WHERE guildId = ?', [guildId])) {
    result.set(row.inviteCode, { code: row.inviteCode, uses: row.uses || 0, inviterId: row.inviterId,
      maxUses: row.maxUses || 0, deletedAt: row.deletedAt, vanity: row.inviteCode === VANITY });
  }
  cache.invites.set(guildId, result);
  states.set(guildId, { initialized: false, refreshedAt: 0 });
  return result;
}

function getGuildInvites(guildId) { return cache.invites.get(guildId) || hydrateGuildInvites(guildId); }

async function fetchSnapshot(guild) {
  const invites = await guild.invites.fetch();
  if ([...invites.values()].some(invite => !Number.isFinite(invite.uses))) {
    throw new Error('Invite use counts are unavailable. Grant Manage Server permission to the bot.');
  }
  let vanity = null;
  if (guild.fetchVanityData) {
    try { vanity = await guild.fetchVanityData(); }
    catch (error) { if (guild.vanityURLCode) throw error; }
  }
  return { invites, vanity };
}

function saveSnapshot(guild, snapshot) {
  const previous = getGuildInvites(guild.id);
  const result = new Collection();
  const now = Date.now();
  for (const invite of snapshot.invites.values()) result.set(invite.code, inviteData(invite, previous.get(invite.code)));
  if (snapshot.vanity?.code) result.set(VANITY, { code: snapshot.vanity.code,
    uses: Number(snapshot.vanity.uses) || 0, vanity: true, inviterId: null });
  transaction(() => {
    run('DELETE FROM invite_cache WHERE guildId = ?', [guild.id]);
    for (const [code, invite] of result) {
      run(`INSERT INTO invite_cache (guildId, inviteCode, inviterId, uses, maxUses, deletedAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, NULL, ?)`, [guild.id, code, invite.inviterId, invite.uses, invite.maxUses || 0, now]);
    }
  });
  cache.invites.set(guild.id, result);
  states.set(guild.id, { initialized: true, refreshedAt: now, lastError: null });
  return result;
}

function loadGuildInvites(guild, snapshot) {
  return serial(guild.id, async () => {
    try {
      const result = saveSnapshot(guild, snapshot || await fetchSnapshot(guild));
      run('DELETE FROM invite_use_credits WHERE guildId = ?', [guild.id]);
      return result;
    } catch (error) {
      states.set(guild.id, { ...states.get(guild.id), lastError: error.message });
      console.error(`Invite cache ${guild.id}:`, error.message);
      return null;
    }
  });
}

function unknown(reason, confidence = 'UNKNOWN') {
  return { code: 'Unknown', inviter: null, inviterId: null, uses: 0, confidence, source: 'UNKNOWN', reason };
}

function deltas(previous, snapshot) {
  const changes = [];
  for (const invite of snapshot.invites.values()) {
    const before = previous.get(invite.code);
    const delta = Number(invite.uses) - Number(before?.uses || 0);
    if (delta > 0) changes.push({ code: invite.code, inviterId: invite.inviter?.id || before?.inviterId || null,
      uses: invite.uses, delta, source: 'INVITE', confidence: 'EXACT' });
  }
  const beforeVanity = previous.get(VANITY);
  if (snapshot.vanity?.code) {
    const delta = Number(snapshot.vanity.uses) - Number(beforeVanity?.uses || 0);
    if (delta > 0) changes.push({ code: snapshot.vanity.code, inviterId: null,
      uses: snapshot.vanity.uses, delta, source: 'VANITY', confidence: 'EXACT' });
  }
  return changes;
}

async function resolveInvite(member) {
  const guild = member.guild;
  const wasInMemory = cache.invites.has(guild.id);
  const old = new Collection([...getGuildInvites(guild.id)].map(([code, value]) => [code, { ...value }]));
  const initialized = states.get(guild.id)?.initialized ?? wasInMemory;
  const now = Date.now();
  run('DELETE FROM invite_use_credits WHERE expiresAt < ?', [now]);
  try {
    let snapshot = await fetchSnapshot(guild);
    let changes = deltas(old, snapshot);
    const credits = all('SELECT * FROM invite_use_credits WHERE guildId = ? AND remaining > 0 AND expiresAt >= ?', [guild.id, now])
      .filter(row => { try { return JSON.parse(row.membersJson).includes(member.id); } catch { return false; } });
    // The member event may arrive shortly before Discord updates its use counter.
    for (let attempt = 0; initialized && !changes.length && !credits.length && attempt < 2; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 200));
      snapshot = await fetchSnapshot(guild);
      changes = deltas(old, snapshot);
    }
    const pendingCount = waiting.get(guild.id)?.size || 1;
    const candidates = [...credits.map(row => ({ ...row, code: row.inviteCode, delta: row.remaining })), ...changes];
    const unique = new Set(candidates.map(row => `${row.source}:${row.code}`));
    let result = unknown('No invite counter change could be observed.');
    if (!initialized) result = unknown('A fresh baseline was required after startup; offline uses are not guessed.');
    else if (unique.size === 1 && candidates.length) {
      const candidate = candidates[0];
      const count = candidates.reduce((total, row) => total + row.delta, 0);
      const newUses = candidates.at(-1).uses;
      // Only allocate a same-code batch when every observed use has a queued join.
      if (count <= pendingCount && count <= 100) {
        result = { ...candidate, uses: newUses, vanity: candidate.source === 'VANITY' };
        run('DELETE FROM invite_use_credits WHERE guildId = ?', [guild.id]);
        if (count > 1) {
          const members = [...new Set(waiting.get(guild.id)?.values() || [])].filter(id => id !== member.id).slice(0, count - 1);
          run(`INSERT INTO invite_use_credits
            (guildId, inviteCode, inviterId, remaining, uses, source, confidence, observedAt, expiresAt, membersJson)
            VALUES (?, ?, ?, ?, ?, ?, 'EXACT', ?, ?, ?)`,
          [guild.id, candidate.code, candidate.inviterId, count - 1, newUses, candidate.source, now, now + GRACE_MS, JSON.stringify(members)]);
        }
      } else result = unknown('Invite uses exceeded the observed joining members.', 'AMBIGUOUS');
    } else if (unique.size > 1) {
      run('DELETE FROM invite_use_credits WHERE guildId = ?', [guild.id]);
      result = unknown('Several invite or vanity counters changed together.', 'AMBIGUOUS');
    }
    saveSnapshot(guild, snapshot);
    return result;
  } catch (error) {
    states.set(guild.id, { ...states.get(guild.id), lastError: error.message });
    return unknown(`Invite lookup failed: ${error.message}`);
  }
}

function findUsedInvite(member) {
  const guildId = member?.guild?.id;
  if (!guildId) return Promise.resolve(unknown('No server was provided.'));
  const key = Symbol(member.id);
  if (!waiting.has(guildId)) waiting.set(guildId, new Map());
  waiting.get(guildId).set(key, member.id);
  return serial(guildId, () => resolveInvite(member)).finally(() => {
    waiting.get(guildId)?.delete(key);
    if (!waiting.get(guildId)?.size) waiting.delete(guildId);
  });
}

function addInvite(guildId, invite) {
  return serial(guildId, () => {
    const invites = getGuildInvites(guildId);
    const data = inviteData(invite, invites.get(invite.code));
    invites.set(invite.code, data);
    run(`INSERT INTO invite_cache (guildId, inviteCode, inviterId, uses, maxUses, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(guildId, inviteCode) DO UPDATE SET
      inviterId = excluded.inviterId, uses = excluded.uses, maxUses = excluded.maxUses,
      deletedAt = NULL, updatedAt = excluded.updatedAt`,
    [guildId, invite.code, data.inviterId, data.uses, data.maxUses, Date.now()]);
  });
}

function removeInvite(guildId, inviteCode) {
  return serial(guildId, () => {
    const invite = getGuildInvites(guildId).get(inviteCode);
    if (invite) invite.deletedAt = Date.now();
    // Disappearance alone cannot distinguish a final use from expiry/deletion.
    run('UPDATE invite_cache SET deletedAt = ?, updatedAt = ? WHERE guildId = ? AND inviteCode = ?',
      [Date.now(), Date.now(), guildId, inviteCode]);
  });
}

function updateInviteUses(guildId, code, uses) {
  const invite = getGuildInvites(guildId).get(code);
  if (invite) invite.uses = uses;
  run('UPDATE invite_cache SET uses = ?, updatedAt = ? WHERE guildId = ? AND inviteCode = ?', [uses, Date.now(), guildId, code]);
}

const sweep = setInterval(() => {
  for (const [key, value] of cache.temp) if (!value || Date.now() - (value.createdAt || 0) > 1800000) cache.temp.delete(key);
}, 300000);
sweep.unref?.();

module.exports = { cache, loadGuildInvites, hydrateGuildInvites, getGuildInvites, findUsedInvite,
  addInvite, removeInvite, updateInviteUses,
  setTemp: (key, value) => cache.temp.set(key, { ...value, createdAt: Date.now() }),
  getTemp: key => cache.temp.get(key), deleteTemp: key => cache.temp.delete(key),
  clearGuildCache: guildId => { cache.invites.delete(guildId); cache.tickets.delete(guildId); states.delete(guildId); } };
