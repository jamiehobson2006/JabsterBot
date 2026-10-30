const crypto = require('node:crypto');
const { get, run } = require('../database');
const active = new Set();

async function withWorkLease(resourceKey, work, { leaseMs = 120_000 } = {}) {
  if (active.has(resourceKey)) throw new Error('This operation is already running. Please wait.');
  const token = crypto.randomUUID();
  const duration = Math.max(15_000, leaseMs);
  const claim = run(`INSERT INTO work_leases(resourceKey,token,expiresAt) VALUES(?,?,?)
    ON CONFLICT(resourceKey) DO UPDATE SET token=excluded.token,expiresAt=excluded.expiresAt
    WHERE work_leases.expiresAt <= ?`, [resourceKey,token,Date.now()+duration,Date.now()]);
  if (!claim.changes) throw new Error('This operation is already running or recovering. Please try again shortly.');
  active.add(resourceKey);
  let lost = false;
  const assertOwned = () => {
    const row = get('SELECT token,expiresAt FROM work_leases WHERE resourceKey=?', [resourceKey]);
    if (lost || row?.token !== token || row.expiresAt <= Date.now()) throw new Error('The operation lease expired. Please retry.');
  };
  const heartbeat = setInterval(() => {
    try {
      const result = run('UPDATE work_leases SET expiresAt=? WHERE resourceKey=? AND token=? AND expiresAt>?',
        [Date.now()+duration,resourceKey,token,Date.now()]);
      if (!result.changes) lost = true;
    } catch { lost = true; }
  }, Math.floor(duration / 3));
  heartbeat.unref?.();
  try { return await work(assertOwned); }
  finally {
    clearInterval(heartbeat);
    active.delete(resourceKey);
    run('DELETE FROM work_leases WHERE resourceKey=? AND token=?', [resourceKey,token]);
  }
}

module.exports = { withWorkLease };
