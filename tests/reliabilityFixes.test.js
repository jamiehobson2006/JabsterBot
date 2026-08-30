const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jabster-studios-reliability-'));
process.env.DATABASE_PATH = path.join(tempDir, 'database.db');

const {
  get,
  initDatabase,
  run
} = require('../database');

const {
  getCurrentMessageCounts
} = require('../utils/giveaways/checkRequirements');

const {
  createPoll,
  processExpiredPolls
} = require('../utils/polls');

const {
  checkTicketSlas
} = require('../services/TicketSlaService');

const {
  cache,
  addInvite,
  updateInviteUses
} = require('../utils/giveaways/cache');

test('giveaway message requirements discard expired daily, weekly, and monthly counters', () => {
  const counts = getCurrentMessageCounts({
    totalMessages: 120,
    dailyMessages: 8,
    weeklyMessages: 30,
    monthlyMessages: 70,
    lastDailyReset: Date.UTC(2026, 0, 1),
    lastWeeklyReset: Date.UTC(2026, 0, 1),
    lastMonthlyReset: Date.UTC(2025, 11, 1)
  }, Date.UTC(2026, 1, 1));

  assert.deepEqual(counts, { total: 120, daily: 0, weekly: 0, monthly: 0 });
});

test('ended polls retry their final state after a temporary Discord edit failure', async () => {
  initDatabase();
  createPoll({
    messageId: 'retry-poll', guildId: 'guild-1', channelId: 'channel-1',
    creatorId: 'creator-1', creatorTag: 'Creator', question: 'Retry?',
    options: ['Yes', 'No'], endsAt: Date.now() - 1000
  });

  const message = { edit: async () => { throw new Error('temporary Discord failure'); } };
  const client = {
    channels: {
      fetch: async () => ({
        isTextBased: () => true,
        messages: { fetch: async () => message }
      })
    }
  };

  await processExpiredPolls(client);
  assert.equal(get('SELECT active FROM polls WHERE messageId = ?', ['retry-poll']).active, 0);
  assert.equal(get('SELECT endedMessageUpdatedAt FROM polls WHERE messageId = ?', ['retry-poll']).endedMessageUpdatedAt, null);

  message.edit = async () => {};
  await processExpiredPolls(client);
  assert.ok(get('SELECT endedMessageUpdatedAt FROM polls WHERE messageId = ?', ['retry-poll']).endedMessageUpdatedAt);
});

test('ticket SLA alerts are persisted and not duplicated after a successful send', async () => {
  initDatabase();
  const createdAt = Date.now() - (10 * 60 * 1000);
  run(
    `INSERT INTO tickets (guildId, channelId, userId, type, status, createdAt)
     VALUES ('guild-sla', 'ticket-channel', 'owner', 'support', 'OPEN', ?)`,
    [createdAt]
  );
  run(
    `INSERT INTO ticket_sla_settings (
       guildId, enabled, firstResponseMinutes, resolutionMinutes, alertChannelId
     ) VALUES ('guild-sla', 1, 5, 60, 'alert-channel')`
  );

  let sent = 0;
  const client = {
    channels: {
      fetch: async () => ({ isTextBased: () => true, send: async () => { sent += 1; } })
    }
  };

  await checkTicketSlas(client);
  await checkTicketSlas(client);
  assert.equal(sent, 1);
  assert.equal(get('SELECT COUNT(*) AS count FROM ticket_sla_alerts WHERE guildId = ?', ['guild-sla']).count, 1);
});

test('invite attribution schema records confidence and event history', () => {
  initDatabase();
  run(
    `INSERT INTO invites (
       guildId, userId, inviteCode, joinedAt, confidence, source, rejoinCount
     ) VALUES ('guild-invites', 'member-1', 'ABC', ?, 'EXACT', 'INVITE', 0)`,
    [Date.now()]
  );
  run(
    `INSERT INTO invite_events (
       guildId, memberId, inviteCode, eventType, confidence, source, timestamp
     ) VALUES ('guild-invites', 'member-1', 'ABC', 'JOIN', 'EXACT', 'INVITE', ?)`,
    [Date.now()]
  );

  assert.equal(get('SELECT confidence FROM invites WHERE userId = ?', ['member-1']).confidence, 'EXACT');
  assert.equal(get('SELECT COUNT(*) AS count FROM invite_events WHERE guildId = ?', ['guild-invites']).count, 1);
});

test('invite cache usage updates persist with their refresh timestamp', () => {
  initDatabase();
  cache.invites.clear();

  addInvite('guild-cache', {
    code: 'CACHE1',
    uses: 0,
    inviter: { id: 'inviter-cache', tag: 'Inviter' }
  });
  updateInviteUses('guild-cache', 'CACHE1', 3);

  const row = get(
    'SELECT uses, updatedAt FROM invite_cache WHERE guildId = ? AND inviteCode = ?',
    ['guild-cache', 'CACHE1']
  );

  assert.equal(row.uses, 3);
  assert.ok(row.updatedAt);
});
