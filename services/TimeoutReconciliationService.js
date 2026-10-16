const { all, run } = require('../database');
const { startManagedLoop } = require('../utils/serviceRunner');

const INTERVAL_MS = 5 * 60 * 1000;

async function reconcileTimeouts(client) {
  const rows = all(
    'SELECT guildId, userId, caseId, expiresAt FROM active_timeouts ORDER BY expiresAt ASC'
  );
  const now = Date.now();
  let removed = 0;
  let checked = 0;

  for (const row of rows) {
    const guild = client.guilds.cache.get(row.guildId);
    if (!guild) continue;

    let member;
    try {
      member = await guild.members.fetch(row.userId);
    } catch (error) {
      if (Number(error.code) !== 10007) continue;
      member = null;
    }
    checked += 1;
    const discordExpiry = Number(member?.communicationDisabledUntilTimestamp) || 0;
    const discordInactive = !member || discordExpiry <= now;

    if (discordInactive) {
      run(
        'DELETE FROM active_timeouts WHERE guildId = ? AND userId = ?',
        [row.guildId, row.userId]
      );
      removed += 1;
      continue;
    }

    if (Math.abs(discordExpiry - Number(row.expiresAt)) > 5_000) {
      run(
        'UPDATE active_timeouts SET expiresAt = ? WHERE guildId = ? AND userId = ?',
        [discordExpiry, row.guildId, row.userId]
      );
    }
  }

  return { checked, removed };
}

function start(client) {
  return startManagedLoop(
    'timeout-reconciliation',
    () => reconcileTimeouts(client),
    INTERVAL_MS,
    { timeoutMs: 60_000, failureThreshold: 3 }
  );
}

module.exports = {
  reconcileTimeouts,
  start
};
