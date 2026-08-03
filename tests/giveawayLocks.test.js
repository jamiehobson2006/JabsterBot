const assert =
  require('node:assert/strict');

const fs =
  require('node:fs');

const os =
  require('node:os');

const path =
  require('node:path');

const test =
  require('node:test');

const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), 'jabster-studios-giveaway-locks-')
);

process.env.DATABASE_PATH = path.join(tempDir, 'database.db');

const {
  get,
  initDatabase,
  run
} = require('../database');

const {
  LOCK_TIMEOUT_MS,
  claimDueGiveaways
} = require('../utils/giveaways/giveawayLoop');

function addGiveaway({ messageId, now, ending = 0, endingAt = null }) {
  run(
    `INSERT INTO giveaways (
       messageId, guildId, channelId, hostId, prize,
       endsAt, ended, paused, ending, endingAt, createdAt
     )
     VALUES (?, 'guild-1', 'channel-1', 'host-1', 'Prize', ?, 0, 0, ?, ?, ?)`,
    [messageId, now - 1, ending, endingAt, now - 1000]
  );
}

test('giveaway locks are not released while ending is still in progress', () => {
  initDatabase();

  const now = 1_000_000;
  addGiveaway({
    messageId: 'fresh-lock',
    now,
    ending: 1,
    endingAt: now - 1000
  });

  assert.deepEqual(claimDueGiveaways(now), []);

  const fresh = get(
    'SELECT ended, ending, endingAt FROM giveaways WHERE messageId = ?',
    ['fresh-lock']
  );

  assert.equal(fresh.ended, 0);
  assert.equal(fresh.ending, 1);
  assert.equal(fresh.endingAt, now - 1000);

  addGiveaway({
    messageId: 'stale-lock',
    now,
    ending: 1,
    endingAt: now - LOCK_TIMEOUT_MS - 1
  });

  const claimed = claimDueGiveaways(now);

  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].messageId, 'stale-lock');

  const stale = get(
    'SELECT ended, ending, endingAt FROM giveaways WHERE messageId = ?',
    ['stale-lock']
  );

  assert.equal(stale.ended, 0);
  assert.equal(stale.ending, 1);
  assert.equal(stale.endingAt, now);
});

test('a stale lock with saved winners is marked complete without another announcement', () => {
  initDatabase();

  const now = 1_010_000;
  addGiveaway({
    messageId: 'winner-lock',
    now,
    ending: 1,
    endingAt: now - LOCK_TIMEOUT_MS - 1
  });

  run(
    `INSERT INTO giveaway_winners (messageId, guildId, userId, wonAt)
     VALUES ('winner-lock', 'guild-1', 'winner-1', ?)`,
    [now - 100]
  );

  assert.deepEqual(claimDueGiveaways(now), []);

  const giveaway = get(
    'SELECT ended, ending, endingAt FROM giveaways WHERE messageId = ?',
    ['winner-lock']
  );

  assert.equal(giveaway.ended, 1);
  assert.equal(giveaway.ending, 0);
  assert.equal(giveaway.endingAt, null);
});
