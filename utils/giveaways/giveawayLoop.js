const {
  all,
  run
} = require('../../database');

const {
  endGiveaway
} = require('./endGiveaway');

const LOOP_INTERVAL_MS = 15000;
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;

let giveawayLoop = null;

function recoverGiveawayLocks(now = Date.now()) {
  const staleBefore = now - LOCK_TIMEOUT_MS;

  // A previous process may have saved winners immediately before stopping.
  // Mark only stale locks as ended so active winner selection is never interrupted.
  run(
    `UPDATE giveaways
     SET ended = 1,
         ending = 0,
         endingAt = NULL
     WHERE ended = 0
     AND ending = 1
     AND (endingAt IS NULL OR endingAt <= ?)
     AND EXISTS (
       SELECT 1
       FROM giveaway_winners
       WHERE giveaway_winners.messageId = giveaways.messageId
       AND COALESCE(giveaway_winners.rerolled, 0) = 0
     )`,
    [staleBefore]
  );

  run(
    `UPDATE giveaways
     SET ending = 0,
         endingAt = NULL
     WHERE ended = 0
     AND ending = 1
     AND (endingAt IS NULL OR endingAt <= ?)`,
    [staleBefore]
  );

  // Recover completed legacy/manual giveaways that have winners but no lock.
  run(
    `UPDATE giveaways
     SET ended = 1,
         ending = 0,
         endingAt = NULL
     WHERE ended = 0
     AND ending = 0
     AND endsAt <= ?
     AND EXISTS (
       SELECT 1
       FROM giveaway_winners
       WHERE giveaway_winners.messageId = giveaways.messageId
       AND COALESCE(giveaway_winners.rerolled, 0) = 0
     )`,
    [now]
  );
}

function claimDueGiveaways(now = Date.now()) {
  recoverGiveawayLocks(now);

  const due = all(
    `SELECT *
     FROM giveaways
     WHERE ended = 0
     AND paused = 0
     AND COALESCE(ending, 0) = 0
     AND endsAt <= ?`,
    [now]
  );

  const claimed = [];

  for (const giveaway of due) {
    const lock = run(
      `UPDATE giveaways
       SET ending = 1,
           endingAt = ?
       WHERE messageId = ?
       AND ended = 0
       AND COALESCE(ending, 0) = 0`,
      [now, giveaway.messageId]
    );

    if (lock.changes) {
      claimed.push({
        ...giveaway,
        ending: 1,
        endingAt: now
      });
    }
  }

  return claimed;
}

async function processDueGiveaways(client) {
  const giveaways = claimDueGiveaways();

  if (!giveaways.length) {
    return 0;
  }

  console.log(`Ending ${giveaways.length} giveaway(s)`);

  for (const giveaway of giveaways) {
    try {
      await endGiveaway(client, giveaway);
    } catch (err) {
      console.error(`Failed ending giveaway ${giveaway.messageId}:`, err);
    }
  }

  return giveaways.length;
}

function startGiveawayLoop(client) {
  if (giveawayLoop) {
    console.log('Giveaway loop already running');
    return giveawayLoop;
  }

  console.log('Giveaway loop started');

  giveawayLoop = setInterval(() => {
    processDueGiveaways(client)
      .catch(err => console.error('Giveaway loop error:', err));
  }, LOOP_INTERVAL_MS);

  giveawayLoop.unref?.();
  return giveawayLoop;
}

function stopGiveawayLoop() {
  if (!giveawayLoop) {
    return false;
  }

  clearInterval(giveawayLoop);
  giveawayLoop = null;
  console.log('Giveaway loop stopped');
  return true;
}

function isGiveawayLoopRunning() {
  return Boolean(giveawayLoop);
}

module.exports = {
  LOCK_TIMEOUT_MS,
  claimDueGiveaways,
  isGiveawayLoopRunning,
  processDueGiveaways,
  recoverGiveawayLocks,
  startGiveawayLoop,
  stopGiveawayLoop
};
