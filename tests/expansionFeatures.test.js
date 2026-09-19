const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), 'jabster-studios-expansion-features-')
);
process.env.DATABASE_PATH = path.join(tempDir, 'database.db');

const { get, initDatabase, run } = require('../database');
initDatabase();

const { cleanAnswer } = require('../events/applicationTickets');
const { detectPhishing } = require('../utils/phishingProtection');
const { finishGiveaway } = require('../utils/giveaways/endGiveaway');
const { isShiftActive } = require('../services/StaffRotaService');
const { summary } = require('../utils/setupWizard');

test('application answers are normalized and limited to 250 characters', () => {
  const answer = cleanAnswer(`@everyone ${'a'.repeat(400)}`);
  assert.equal(answer.length, 250);
  assert.doesNotMatch(answer, /@everyone/);
});

test('phishing detection catches common bypasses without blocking official domains', () => {
  assert.equal(detectPhishing('https://discord.com/channels/123/456'), null);
  assert.equal(detectPhishing('https://help.example.com', {
    allowlist: ['example.com']
  }), null);
  assert.match(
    detectPhishing('Claim at hxxps://disc0rd-gift[dot]com/login').reason,
    /impersonation/i
  );
  assert.match(
    detectPhishing('Visit blocked.example/path', {
      blocklist: ['blocked.example']
    }).reason,
    /blocklist/i
  );
});

test('staff rota handles normal and overnight shifts in their configured timezone', () => {
  const normal = {
    dayOfWeek: 1,
    startMinute: 9 * 60,
    endMinute: 17 * 60,
    timezone: 'UTC'
  };
  const overnight = {
    dayOfWeek: 5,
    startMinute: 22 * 60,
    endMinute: 2 * 60,
    timezone: 'UTC'
  };

  assert.equal(isShiftActive(normal, new Date('2026-09-21T12:00:00Z')), true);
  assert.equal(isShiftActive(normal, new Date('2026-09-21T18:00:00Z')), false);
  assert.equal(isShiftActive(overnight, new Date('2026-09-26T01:00:00Z')), true);
  assert.equal(isShiftActive(overnight, new Date('2026-09-26T03:00:00Z')), false);
});

test('new feature configuration is persisted and appears in setup status', () => {
  const guildId = 'feature-guild';
  run(
    `INSERT INTO phishing_settings (guildId, enabled, updatedAt) VALUES (?, 1, ?)`,
    [guildId, Date.now()]
  );
  run(
    `INSERT INTO modmail_settings (guildId, enabled, categoryId, staffRoleId, updatedAt)
     VALUES (?, 1, 'modmail-category', 'staff-role', ?)`,
    [guildId, Date.now()]
  );
  run(
    `INSERT INTO staff_rota_settings (guildId, enabled, channelId, staffRoleId, updatedAt)
     VALUES (?, 1, 'rota-channel', 'staff-role', ?)`,
    [guildId, Date.now()]
  );
  run(
    `INSERT INTO ticket_settings (guildId, type, enabled, categoryId, roleId)
     VALUES (?, 'SUPPORT', 1, 'ticket-category', 'staff-role')`,
    [guildId]
  );

  const state = summary(guildId);
  assert.equal(state.phishing, true);
  assert.equal(state.ticketReady, true);
  assert.equal(
    get(`SELECT enabled FROM modmail_settings WHERE guildId = ?`, [guildId]).enabled,
    1
  );
  assert.equal(
    get(`SELECT enabled FROM staff_rota_settings WHERE guildId = ?`, [guildId]).enabled,
    1
  );
});

test('giveaway completion edits and announces exactly once', async () => {
  const giveaway = {
    messageId: 'durable-result',
    guildId: 'feature-guild',
    channelId: 'giveaway-channel',
    hostId: 'host-user',
    prize: 'A durable prize',
    endsAt: Date.now() - 1000,
    createdAt: Date.now() - 2000
  };
  run(
    `INSERT INTO giveaways (
       messageId, guildId, channelId, hostId, prize, endsAt, ended, ending, createdAt
     ) VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?)`,
    [
      giveaway.messageId,
      giveaway.guildId,
      giveaway.channelId,
      giveaway.hostId,
      giveaway.prize,
      giveaway.endsAt,
      giveaway.createdAt
    ]
  );

  let edits = 0;
  let announcements = 0;
  const channel = {
    messages: {
      fetch: async () => ({ find: () => null })
    },
    send: async () => {
      announcements += 1;
      return { id: `announcement-${announcements}` };
    }
  };
  const message = {
    embeds: [],
    channel,
    edit: async () => {
      edits += 1;
    }
  };

  assert.equal(await finishGiveaway({
    giveaway,
    message,
    winners: ['winner-user']
  }), true);
  assert.equal(await finishGiveaway({
    giveaway,
    message,
    winners: ['winner-user']
  }), false);
  assert.equal(edits, 1);
  assert.equal(announcements, 1);
  assert.equal(
    get(`SELECT ended FROM giveaways WHERE messageId = ?`, [giveaway.messageId]).ended,
    1
  );
});
