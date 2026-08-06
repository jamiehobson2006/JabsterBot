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

const tempDir =
  fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      'jabster-studios-dailyfact-service-'
    )
  );

process.env.DATABASE_PATH =
  path.join(tempDir, 'database.db');

const {
  get,
  initDatabase,
  run
} = require('../database');

const {
  saveApprovedFact
} = require('../utils/dailyFacts');

const DailyFactService =
  require('../services/DailyFactService');

const sent = [];

const client = {
  channels: {
    fetch: async () => ({
      isTextBased: () => true,
      send: async payload => {
        sent.push(payload);
      }
    })
  }
};

test(
  'Daily Facts rotate approved submissions for 30 days and persist their history',
  async () => {
    initDatabase();

    saveApprovedFact({
      submissionId: 1,
      userId: 'user-1',
      reviewerId: 'admin-1',
      fact: 'Octopuses have three hearts.',
      category: 'ocean',
      approvedAt: 100
    });

    saveApprovedFact({
      submissionId: 2,
      userId: 'user-2',
      reviewerId: 'admin-1',
      fact: 'Honey never spoils when stored correctly.',
      category: 'nature',
      approvedAt: 200
    });

    run(
      `INSERT INTO dailyfact_config (
         guildId,
         enabled,
         channelId,
         category,
         hour,
         minute,
         timezone
       )
       VALUES (?, 1, ?, 'random', 0, 0, 'UTC')`,
      ['guild-1', 'channel-1']
    );

    const config =
      get(
        `SELECT *
         FROM dailyfact_config
         WHERE guildId = ?`,
        ['guild-1']
      );

    const first =
      await DailyFactService.sendFact({
        client,
        config,
        onlyCommunity: true,
        now: 1_000,
        random: () => 0
      });

    const second =
      await DailyFactService.sendFact({
        client,
        config,
        onlyCommunity: true,
        now: 2_000,
        random: () => 0
      });

    const third =
      await DailyFactService.sendFact({
        client,
        config,
        onlyCommunity: true,
        now: 3_000,
        random: () => 0
      });

    assert.equal(first.status, 'sent');
    assert.equal(second.status, 'sent');
    assert.notEqual(first.fact.factKey, second.fact.factKey);
    assert.equal(third.status, 'no-eligible-facts');
    assert.equal(sent.length, 2);

    const history =
      get(
        `SELECT COUNT(*) AS total
         FROM dailyfact_delivery_history
         WHERE guildId = ?`,
        ['guild-1']
      );

    assert.equal(history.total, 2);
  }
);

test(
  'Daily Facts give approved community facts a modest preference',
  () => {
    const chosen =
      DailyFactService.pickFact(
        [
          {
            fact: 'Coded fact',
            source: 'coded'
          },
          {
            fact: 'Approved fact',
            source: 'community'
          }
        ],
        () => 0.5
      );

    assert.equal(chosen.source, 'community');
  }
);

test(
  'Daily Fact time uses the configured timezone consistently',
  () => {
    const parts =
      DailyFactService.getDateParts(
        new Date('2026-08-06T12:34:00.000Z'),
        'UTC'
      );

    assert.deepEqual(
      parts,
      {
        hour: 12,
        minute: 34,
        dateKey: '2026-08-06'
      }
    );
  }
);
