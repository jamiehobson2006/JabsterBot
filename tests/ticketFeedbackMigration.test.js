const assert =
  require('node:assert/strict');

const Database =
  require('better-sqlite3');

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
    path.join(os.tmpdir(), 'jabster-studios-ticket-migration-')
  );

const databasePath =
  path.join(tempDir, 'database.db');

const legacyDb =
  new Database(databasePath);

legacyDb.exec(`
  CREATE TABLE guild_settings (
    guildId TEXT PRIMARY KEY
  );

  CREATE TABLE tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guildId TEXT NOT NULL,
    channelId TEXT NOT NULL,
    userId TEXT NOT NULL,
    type TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN'
  );
`);

legacyDb.close();

process.env.DATABASE_PATH =
  databasePath;

const {
  all,
  initDatabase
} = require('../database');

test(
  'ticket feedback changes migrate an existing ticket database safely',
  () => {
    initDatabase();

    const ticketColumns =
      all('PRAGMA table_info(tickets)')
        .map(column => column.name);

    const settingsColumns =
      all('PRAGMA table_info(guild_settings)')
        .map(column => column.name);

    assert.ok(ticketColumns.includes('closeReason'));
    assert.ok(settingsColumns.includes('ticketFeedbackChannelId'));
    assert.ok(settingsColumns.includes('staffListChannelId'));
    assert.ok(settingsColumns.includes('staffListRoleId'));
    assert.ok(settingsColumns.includes('applicationCreatorRoleId'));

    const feedbackTable =
      all(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table'
         AND name = 'ticket_feedback'`
      );

    assert.equal(feedbackTable.length, 1);
  }
);
