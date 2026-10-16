const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jabster-foundation-'));
process.env.DATABASE_PATH = path.join(temporaryDirectory, 'database.db');
const { all, db, get, initDatabase, run, transaction } = require('../database');
initDatabase();
test.after(() => {
  db.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

const actions = require('../utils/moderationActions');
const outbox = require('../utils/deliveryOutbox');
const { extractLinks, domainMatches, hasLink } = require('../utils/linkDetection');
const { findCensoredTerm } = require('../utils/censor');
const { runServiceCycle, serviceState, startServiceSafe } = require('../utils/serviceRunner');
const { reconcileTimeouts } = require('../services/TimeoutReconciliationService');
const applications = require('../utils/applications');
const { ticketFingerprint } = require('../utils/ticketFingerprint');
const { useCooldown } = require('../utils/cooldowns');
const { queueMessageStat, flushMessageStats } = require('../utils/messageStatsBuffer');

test('moderation recovery creates one case and one warning across repeated recovery', () => {
  const record = actions.beginModerationAction({
    guildId: 'moderation', userId: 'member', moderatorId: 'staff', action: 'WARN', reason: 'Test'
  });
  actions.markDiscordApplied(record.recordId);
  assert.equal(actions.recoverAppliedModerationActions(), 1);
  assert.equal(actions.recoverAppliedModerationActions(), 0);
  const completed = actions.completeModerationAction(record.recordId);
  assert.ok(completed.caseId);
  assert.equal(get('SELECT count FROM warns WHERE guildId = ?', ['moderation']).count, 1);
  assert.equal(get('SELECT COUNT(*) AS count FROM cases WHERE actionRecordId = ?', [record.recordId]).count, 1);
});

test('failed Discord moderation creates no punishment case', async () => {
  await assert.rejects(actions.performModerationAction({
    guildId: 'failed-action', userId: 'member', moderatorId: 'staff', action: 'BAN'
  }, async () => { throw new Error('Missing permissions'); }), /Missing permissions/);
  assert.equal(get('SELECT COUNT(*) AS count FROM cases WHERE guildId = ?', ['failed-action']).count, 0);
  assert.equal(get('SELECT status FROM moderation_actions WHERE guildId = ?', ['failed-action']).status, 'FAILED');
});

test('database transactions roll back all related writes on failure', () => {
  assert.throws(() => transaction(() => {
    run('INSERT INTO warns (guildId, userId, count) VALUES (?, ?, ?)', ['rollback', 'member', 9]);
    throw new Error('Interrupted');
  }), /Interrupted/);
  assert.equal(get('SELECT * FROM warns WHERE guildId = ?', ['rollback']), undefined);
});

test('delivery failures back off, retry, and never resend a completed item', async () => {
  outbox.enqueueDelivery({ deliveryKey: 'retry', type: 'TEST' });
  let sends = 0;
  await assert.rejects(outbox.deliverOnce('retry', async () => {
    sends += 1;
    throw new Error('Offline');
  }), /Offline/);
  const delayed = await outbox.deliverOnce('retry', async () => { sends += 1; });
  assert.equal(delayed.status, 'FAILED');
  assert.equal(sends, 1);
  run('UPDATE delivery_outbox SET nextAttemptAt = 0 WHERE deliveryKey = ?', ['retry']);
  await outbox.deliverOnce('retry', async () => { sends += 1; return { id: 'sent' }; });
  await outbox.deliverOnce('retry', async () => { sends += 1; });
  assert.equal(sends, 2);
  assert.equal(get('SELECT messageId FROM delivery_outbox WHERE deliveryKey = ?', ['retry']).messageId, 'sent');
});

test('delivery lock prevents overlapping sends even if a lease expires', async () => {
  outbox.enqueueDelivery({ deliveryKey: 'concurrent', type: 'TEST' });
  let finish;
  const first = outbox.deliverOnce('concurrent', () => new Promise(resolve => { finish = resolve; }));
  run('UPDATE delivery_outbox SET leaseUntil = 0 WHERE deliveryKey = ?', ['concurrent']);
  let extraSends = 0;
  await outbox.deliverOnce('concurrent', async () => { extraSends += 1; });
  assert.equal(extraSends, 0);
  finish({ id: 'first' });
  await first;
});

test('saved channel payloads are delivered by the worker after a fresh process starts', () => {
  outbox.enqueueDelivery({ deliveryKey: 'restart', type: 'SOCIAL_YOUTUBE', channelId: 'sandbox',
    payload: { message: { content: 'Saved announcement', allowedMentions: { parse: [] } } } });
  const script = `
    const assert = require('node:assert/strict');
    const { db, initDatabase } = require('./database');
    initDatabase();
    const { retryChannelDeliveries } = require('./utils/deliveryOutbox');
    retryChannelDeliveries({ channels: { fetch: async () => ({
      isTextBased: () => true,
      send: async payload => {
        assert.equal(payload.content, 'Saved announcement');
        assert.equal(payload.enforceNonce, true);
        return { id: 'recovered-message' };
      }
    }) } }).then(count => { assert.equal(count, 1); db.close(); }).catch(error => {
      console.error(error); process.exitCode = 1;
    });
  `;
  const child = spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'), env: process.env, encoding: 'utf8', timeout: 15000
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  assert.equal(get('SELECT messageId FROM delivery_outbox WHERE deliveryKey = ?', ['restart']).messageId, 'recovered-message');
});

test('a retry recovers a Discord message by nonce instead of posting again', async () => {
  let sends = 0;
  const deliveryKey = 'sent-before-crash';
  const nonce = outbox.deliveryNonce(deliveryKey);
  const result = await outbox.sendQueuedMessage({
    messages: { fetch: async () => [{ id: 'existing', nonce }] },
    send: async () => { sends += 1; }
  }, { deliveryKey, attempts: 2 }, { content: 'Message' });
  assert.equal(result.id, 'existing');
  assert.equal(sends, 0);
});

test('links normalize obfuscated domains and allow only true domain descendants', () => {
  for (const input of ['example.com', 'hxxps://example[dot]com/path', 'www.example.com', 'example\u200b.com', 'http://localhost']) {
    assert.equal(hasLink(input), true, input);
  }
  assert.equal(hasLink('This is a normal sentence.'), false);
  assert.equal(extractLinks('https://trusted.com@evil.com')[0].hostname, 'evil.com');
  assert.equal(domainMatches('sub.example.com', 'example.com'), true);
  assert.equal(domainMatches('sub.example.com', 'https://example.com/path'), true);
  assert.equal(domainMatches('badexample.com', 'example.com'), false);
  assert.equal(domainMatches('example.com.evil.com', 'example.com'), false);
});

test('censor policies preserve boundaries and support stronger obfuscation matching', () => {
  assert.equal(findCensoredTerm('assignment', ['ass'], 'STRICT'), null);
  assert.equal(findCensoredTerm('.ass', ['ass'], 'STRICT'), 'ass');
  assert.equal(findCensoredTerm('b.a.d.w.o.r.d', ['badword'], 'FLEXIBLE'), 'badword');
  assert.equal(findCensoredTerm('b4d.w0rd', ['badword'], 'FLEXIBLE'), 'badword');
  assert.equal(findCensoredTerm('prefixb4dwordsuffix', ['badword'], 'AGGRESSIVE'), 'badword');
});

test('service locks prevent overlap and circuit state survives module reload', async () => {
  let finish;
  const first = runServiceCycle('locked', () => new Promise(resolve => { finish = resolve; }));
  await Promise.resolve();
  assert.equal((await runServiceCycle('locked', async () => {})).reason, 'already-running');
  finish('done');
  assert.equal((await first).status, 'SUCCESS');
  await assert.rejects(runServiceCycle('circuit', async () => { throw new Error('Offline'); },
    { failureThreshold: 1 }), /Offline/);
  assert.equal(serviceState('circuit').status, 'CIRCUIT_OPEN');
  delete require.cache[require.resolve('../utils/serviceRunner')];
  const reloaded = require('../utils/serviceRunner');
  assert.equal((await reloaded.runServiceCycle('circuit', async () => {})).reason, 'circuit-open');
});

test('timed-out services retain their lock until the original work settles', async () => {
  let finish;
  const keepAlive = setTimeout(() => {}, 2000);
  try {
    await assert.rejects(runServiceCycle('slow', () => new Promise(resolve => { finish = resolve; }),
      { timeoutMs: 1000 }), /timed out/);
    assert.equal((await runServiceCycle('slow', async () => {})).reason, 'already-running');
    finish();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal((await runServiceCycle('slow', async () => {})).status, 'SUCCESS');
  } finally {
    clearTimeout(keepAlive);
  }
});

test('startup failures are isolated so later services still start', async t => {
  t.mock.method(console, 'error', () => {});
  const failed = await startServiceSafe('bad', async () => { throw new Error('Unavailable'); });
  const good = await startServiceSafe('good', async () => 42);
  assert.equal(failed.ok, false);
  assert.equal(good.result, 42);
});

test('timeout reconciliation preserves records on transport failures and follows Discord extensions', async () => {
  const now = Date.now();
  for (const userId of ['offline', 'removed', 'extended']) {
    run('INSERT INTO active_timeouts (guildId, userId, expiresAt) VALUES (?, ?, ?)', ['timeouts', userId, now - 1000]);
  }
  const guild = { members: { fetch: async userId => {
    if (userId === 'offline') throw new Error('Connection reset');
    if (userId === 'removed') throw Object.assign(new Error('Unknown member'), { code: 10007 });
    return { communicationDisabledUntilTimestamp: now + 60000 };
  } } };
  await reconcileTimeouts({ guilds: { cache: new Map([['timeouts', guild]]) } });
  assert.ok(get('SELECT * FROM active_timeouts WHERE userId = ?', ['offline']));
  assert.equal(get('SELECT * FROM active_timeouts WHERE userId = ?', ['removed']), undefined);
  assert.equal(get('SELECT expiresAt FROM active_timeouts WHERE userId = ?', ['extended']).expiresAt, now + 60000);
});

test('saved application answers resume instead of being replaced and delete with their form', () => {
  applications.createForm({ guildId: 'drafts', name: 'Staff', createdBy: 'owner' });
  const form = applications.getFormByName('drafts', 'Staff');
  const first = applications.createDraft({ guildId: 'drafts', formId: form.id, userId: 'applicant' });
  applications.saveDraft({ id: first.id, answers: [{ questionId: 1, answer: 'Saved answer' }], nextQuestionIndex: 1 });
  applications.setDraftMessage(first.id, 'dm-message');
  const resumed = applications.createDraft({ guildId: 'drafts', formId: form.id, userId: 'applicant' });
  assert.equal(resumed.id, first.id);
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.answers[0].answer, 'Saved answer');
  assert.equal(resumed.dmMessageId, 'dm-message');
  applications.deleteForm(form.id);
  assert.equal(applications.getDraft(first.id), null);
});

test('ticket fingerprints reject exact applications but allow distinct applications or new ticket requests', () => {
  const base = { guildId: 'guild', userId: 'user', type: 'application', formId: 1 };
  assert.equal(ticketFingerprint({ ...base, answers: [{ question: 'Why?', answer: 'My answer' }] }),
    ticketFingerprint({ ...base, answers: [{ answer: ' My  answer ', question: 'Why?' }] }));
  assert.notEqual(ticketFingerprint({ ...base, answers: ['One'] }), ticketFingerprint({ ...base, answers: ['Two'] }));
  assert.notEqual(ticketFingerprint({ ...base, requestId: 'one' }), ticketFingerprint({ ...base, requestId: 'two' }));
});

test('concurrent cooldown claims allow only one request and remain guild scoped', async () => {
  const claims = await Promise.all(Array.from({ length: 12 }, () => useCooldown('cooldown', 'user', 'claim', 60000)));
  assert.equal(claims.filter(value => value === 0).length, 1);
  assert.equal(await useCooldown('other', 'user', 'claim', 60000), 0);
});

test('batched statistics count midnight messages in their correct day', () => {
  queueMessageStat('stats', 'user', Date.UTC(2026, 9, 1, 23, 59, 59));
  queueMessageStat('stats', 'user', Date.UTC(2026, 9, 2, 0, 0, 0));
  assert.equal(flushMessageStats(), 2);
  const row = get('SELECT * FROM message_stats WHERE guildId = ?', ['stats']);
  assert.equal(row.totalMessages, 2);
  assert.equal(row.dailyMessages, 1);
  assert.equal(row.weeklyMessages, 2);
});

test('repeated database initialization preserves records and remains valid', () => {
  const before = all('SELECT * FROM moderation_actions');
  initDatabase();
  initDatabase();
  assert.deepEqual(all('SELECT * FROM moderation_actions'), before);
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
});
