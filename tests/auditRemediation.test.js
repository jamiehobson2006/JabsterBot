const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { Collection } = require('discord.js');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jabster-audit-remediation-'));
process.env.DATABASE_PATH = path.join(tempDir, 'database.db');

const { get, initDatabase, run } = require('../database');
initDatabase();

const { MAX_LEVEL, calculateLevel, getTotalXPForLevel } = require('../utils/leveling');
const { recoverStaleSuggestionReviews } = require('../utils/suggestions/recovery');
const { recoverStaleApplicationReviews } = require('../utils/tickets/applicationReview');
const dailyFactInteractions = require('../events/dailyFactInteractions');
const { claimDueGiveaways } = require('../utils/giveaways/giveawayLoop');
const { cache, findUsedInvite } = require('../utils/giveaways/cache');
const { isTrustedDiscordMediaUrl } = require('../utils/deletedMessageCopy');
const { announceOffer } = require('../utils/freeGames');
const { buildRotaEmbed } = require('../services/StaffRotaService');
const { cleanupDeletedChannel, cleanupDeletedRole } = require('../utils/configCleanup');

test('all slash commands serialize with unique names', () => {
  const commandRoot = path.join(__dirname, '..', 'commands');
  const files = fs.readdirSync(commandRoot, { withFileTypes: true }).flatMap(entry => {
    if (!entry.isDirectory()) return [];
    const folder = path.join(commandRoot, entry.name);
    return fs.readdirSync(folder)
      .filter(file => file.endsWith('.js'))
      .map(file => path.join(folder, file));
  });
  const names = new Set();

  for (const file of files) {
    const command = require(file);
    assert.equal(typeof command.execute, 'function', `${file} has no execute function`);
    const json = command.data.toJSON();
    assert.equal(names.has(json.name), false, `duplicate command: ${json.name}`);
    names.add(json.name);
  }

  assert.equal(names.has('selfrole'), true);
});

test('all event modules load with valid event handlers', () => {
  const eventRoot = path.join(__dirname, '..', 'events');
  const files = fs.readdirSync(eventRoot)
    .filter(file => file.endsWith('.js'))
    .map(file => path.join(eventRoot, file));
  const script = `
    const files = ${JSON.stringify(files)};
    for (const file of files) {
      const event = require(file);
      if (typeof event.name !== 'string') throw new Error(file + ' has no event name');
      if (typeof event.execute !== 'function') throw new Error(file + ' has no execute function');
    }
    process.exit(0);
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      DATABASE_PATH: path.join(tempDir, 'event-load.db')
    },
    encoding: 'utf8',
    timeout: 15000
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('level calculations are bounded and handle the maximum level without iteration', () => {
  const total = getTotalXPForLevel(MAX_LEVEL);
  assert.equal(calculateLevel(total), MAX_LEVEL);
  assert.equal(calculateLevel(Number.MAX_SAFE_INTEGER), MAX_LEVEL);
  assert.throws(() => getTotalXPForLevel(MAX_LEVEL + 1), /between 0 and/i);
});

test('interrupted review claims recover without changing completed work', () => {
  const stale = Date.now() - (20 * 60 * 1000);
  run(
    `INSERT INTO suggestions (guildId, userId, content, status, moderatorId, reviewStartedAt, timestamp)
     VALUES ('guild', 'user', 'Suggestion', 'REVIEWING', 'mod', ?, ?)`,
    [stale, stale]
  );
  recoverStaleSuggestionReviews();
  assert.equal(get(`SELECT status FROM suggestions WHERE guildId = 'guild'`).status, 'PENDING');

  run(
    `INSERT INTO tickets (
       guildId, channelId, userId, type, createdAt, status,
       applicationStatus, applicationReviewedBy, applicationReviewedAt
     ) VALUES ('guild', 'application-channel', 'user', 'application', ?, 'OPEN',
       'REVIEWING_ACCEPTED', 'mod', ?)`,
    [stale, stale]
  );
  recoverStaleApplicationReviews();
  assert.equal(get(`SELECT applicationStatus FROM tickets WHERE channelId = 'application-channel'`).applicationStatus, 'PENDING');

  run(
    `INSERT INTO dailyfact_submissions (
       guildId, userId, fact, status, reviewerId, decisionAt, submittedAt
     ) VALUES ('guild', 'user', 'A sufficiently long fact for review.', 'REVIEWING', 'mod', ?, ?)`,
    [stale, stale]
  );
  dailyFactInteractions.recoverStaleDailyFactReviews();
  assert.equal(get(`SELECT status FROM dailyfact_submissions WHERE guildId = 'guild'`).status, 'PENDING');
});

test('giveaway retry backoff prevents a tight retry loop', () => {
  const now = Date.now();
  run(
    `INSERT INTO giveaways (
       messageId, guildId, channelId, hostId, prize, endsAt, ended, paused,
       ending, nextEndAttemptAt, createdAt
     ) VALUES ('backoff-giveaway', 'guild', 'channel', 'host', 'Prize', ?, 0, 0, 0, ?, ?)`,
    [now - 1000, now + 60000, now - 2000]
  );
  assert.equal(claimDueGiveaways(now).some(row => row.messageId === 'backoff-giveaway'), false);
  assert.equal(claimDueGiveaways(now + 60001).some(row => row.messageId === 'backoff-giveaway'), true);
});

test('a disappeared one-use invite can still be attributed exactly', async () => {
  cache.invites.set('invite-guild', new Collection([
    ['once', {
      code: 'once', uses: 0, maxUses: 1, inviterId: 'inviter', inviterTag: 'Inviter'
    }]
  ]));
  const guild = {
    id: 'invite-guild',
    name: 'Invite Guild',
    invites: { fetch: async () => new Collection() },
    fetchVanityData: async () => null
  };
  const used = await findUsedInvite({ guild });
  assert.equal(used.code, 'once');
  assert.equal(used.inviterId, 'inviter');
  assert.equal(used.confidence, 'EXACT');
});

test('deleted-message media downloader only trusts Discord HTTPS hosts', () => {
  assert.equal(isTrustedDiscordMediaUrl('https://cdn.discordapp.com/attachments/1/2/file.png'), true);
  assert.equal(isTrustedDiscordMediaUrl('https://media.discordapp.net/attachments/1/2/file.png'), true);
  assert.equal(isTrustedDiscordMediaUrl('http://127.0.0.1/private'), false);
  assert.equal(isTrustedDiscordMediaUrl('https://example.com/image.png'), false);
});

test('free-game announcements recover a sent message after a database-write crash', async () => {
  const marker = 'free-game:free-guild:steam:42';
  run(
    `INSERT INTO free_game_announcements (guildId, offerKey, source, title, announcedAt)
     VALUES ('free-guild', 'steam:42', 'STEAM', 'Free Game', ?)`,
    [Date.now() - 1000]
  );
  const existing = { id: 'announcement', content: `-# ${marker}` };
  const messages = new Collection([[existing.id, existing]]);
  let sends = 0;
  const channel = {
    id: 'free-channel',
    guild: { members: { me: {} } },
    isTextBased: () => true,
    permissionsFor: () => ({ has: () => true }),
    messages: { fetch: async () => messages },
    send: async () => { sends += 1; }
  };
  const result = await announceOffer(
    { channels: { fetch: async () => channel } },
    { guildId: 'free-guild', channelId: channel.id },
    { key: 'steam:42', source: 'STEAM', title: 'Free Game', url: 'https://store.steampowered.com/app/42' }
  );
  assert.equal(result, 'already-announced');
  assert.equal(sends, 0);
  assert.equal(get(`SELECT messageId FROM free_game_announcements WHERE offerKey = 'steam:42'`).messageId, 'announcement');
});

test('staff rota ignores stale availability and retains the full schedule', () => {
  const now = new Date('2026-09-21T12:00:00Z');
  const shifts = Array.from({ length: 35 }, (_, index) => ({
    id: index + 1,
    userId: `user-${index}`,
    dayOfWeek: 1,
    startMinute: 9 * 60,
    endMinute: 17 * 60,
    timezone: 'UTC',
    escalationOrder: index + 1
  }));
  const embed = buildRotaEmbed(
    { name: 'Guild' },
    shifts,
    [{ userId: 'user-0', status: 'OFFLINE', note: 'Old note', updatedAt: now.getTime() - (25 * 60 * 60 * 1000) }],
    now
  );
  const text = JSON.stringify(embed.toJSON());
  assert.doesNotMatch(text, /Old note/);
  assert.match(text, /#35/);
});

test('deleting configured channels and roles removes stale feature references', () => {
  run(
    `INSERT INTO guild_settings (
       guildId, suggestionChannelId, staffListRoleId,
       linkBypassChannelIds, linkBypassRoleIds
     ) VALUES ('cleanup-guild', 'deleted-channel', 'deleted-role', ?, ?)`,
    [JSON.stringify(['deleted-channel', 'keep-channel']), JSON.stringify(['deleted-role', 'keep-role'])]
  );
  run(
    `INSERT INTO ticket_settings (guildId, type, enabled, categoryId, roleId)
     VALUES ('cleanup-guild', 'SUPPORT', 1, 'deleted-channel', 'deleted-role')`
  );
  run(
    `INSERT INTO free_game_settings (guildId, enabled, channelId, pingRoleId)
     VALUES ('cleanup-guild', 1, 'deleted-channel', 'deleted-role')`
  );
  run(
    `INSERT INTO self_roles (guildId, roleId, createdAt)
     VALUES ('cleanup-guild', 'deleted-role', ?)`,
    [Date.now()]
  );

  const guild = { id: 'cleanup-guild' };
  cleanupDeletedChannel({ id: 'deleted-channel', guild });
  cleanupDeletedRole({ id: 'deleted-role', guild });

  const settings = get(`SELECT * FROM guild_settings WHERE guildId = 'cleanup-guild'`);
  const ticket = get(`SELECT * FROM ticket_settings WHERE guildId = 'cleanup-guild'`);
  const games = get(`SELECT * FROM free_game_settings WHERE guildId = 'cleanup-guild'`);
  assert.equal(settings.suggestionChannelId, null);
  assert.equal(settings.staffListRoleId, null);
  assert.deepEqual(JSON.parse(settings.linkBypassChannelIds), ['keep-channel']);
  assert.deepEqual(JSON.parse(settings.linkBypassRoleIds), ['keep-role']);
  assert.equal(ticket.enabled, 0);
  assert.equal(ticket.categoryId, null);
  assert.equal(ticket.roleId, null);
  assert.equal(games.enabled, 0);
  assert.equal(games.channelId, null);
  assert.equal(games.pingRoleId, null);
  assert.equal(get(`SELECT 1 FROM self_roles WHERE guildId = 'cleanup-guild'`), undefined);
});
