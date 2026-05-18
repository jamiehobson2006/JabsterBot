const Database = require('better-sqlite3');

const db = new Database('./database.db');

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');
db.pragma('temp_store = MEMORY');
db.pragma('cache_size = -32000');

function rawRun(sql, params = []) {
  return db.prepare(sql).run(params);
}

function rawGet(sql, params = []) {
  return db.prepare(sql).get(params);
}

function rawAll(sql, params = []) {
  return db.prepare(sql).all(params);
}

function run(sql, params = []) {

  try {

    return rawRun(sql, params);

  } catch (err) {

    console.error(
      'DB run error:',
      err.message
    );

    return null;
  }
}

function get(sql, params = []) {

  try {

    return rawGet(sql, params);

  } catch (err) {

    console.error(
      'DB get error:',
      err.message
    );

    return null;
  }
}

function all(sql, params = []) {

  try {

    return rawAll(sql, params);

  } catch (err) {

    console.error(
      'DB all error:',
      err.message
    );

    return [];
  }
}

function tableExists(tableName) {

  return Boolean(

    rawGet(

      `SELECT name
       FROM sqlite_master
       WHERE type = 'table'
       AND name = ?`,

      [tableName]
    )
  );
}

function tableColumns(tableName) {

  if (!tableExists(tableName)) {
    return [];
  }

  return rawAll(
    `PRAGMA table_info(${tableName})`
  );
}

function columnNames(tableName) {

  return tableColumns(tableName)
    .map(column => column.name);
}

function ensureColumn(
  tableName,
  columnName,
  definition
) {

  if (
    !columnNames(tableName)
      .includes(columnName)
  ) {

    rawRun(
      `ALTER TABLE ${tableName}
       ADD COLUMN ${columnName} ${definition}`
    );
  }
}

function createCasesTable() {

  rawRun(`

    CREATE TABLE IF NOT EXISTS cases (

      id INTEGER PRIMARY KEY AUTOINCREMENT,

      guildId TEXT NOT NULL,

      userId TEXT NOT NULL,

      moderatorId TEXT NOT NULL,

      action TEXT NOT NULL,

      reason TEXT NOT NULL,

      duration INTEGER,

      timestamp INTEGER NOT NULL
    )
  `);

  ensureColumn(
    'cases',
    'duration',
    'INTEGER'
  );

  ensureColumn(
    'cases',
    'timestamp',
    'INTEGER'
  );

  rawRun(`
    CREATE INDEX IF NOT EXISTS idx_cases_user
    ON cases(guildId, userId)
  `);

  rawRun(`
    CREATE INDEX IF NOT EXISTS idx_cases_action
    ON cases(guildId, action)
  `);
}

function createWarnsTable() {

  rawRun(`

    CREATE TABLE IF NOT EXISTS warns (

      guildId TEXT NOT NULL,

      userId TEXT NOT NULL,

      count INTEGER NOT NULL DEFAULT 0,

      PRIMARY KEY (guildId, userId)
    )
  `);

  rawRun(`
    CREATE INDEX IF NOT EXISTS idx_warns_user
    ON warns(guildId, userId)
  `);
}

function createMutesTable() {

  rawRun(`

    CREATE TABLE IF NOT EXISTS mutes (

      guildId TEXT NOT NULL,

      userId TEXT NOT NULL,

      endTime INTEGER NOT NULL,

      PRIMARY KEY (guildId, userId)
    )
  `);
}

function createGuildSettingsTable() {

  rawRun(`

    CREATE TABLE IF NOT EXISTS guild_settings (

      guildId TEXT PRIMARY KEY,

      modlogChannelId TEXT,

      suggestionChannelId TEXT,

      transcriptChannelId TEXT,

      gamblingEnabled INTEGER DEFAULT 1,

      robEnabled INTEGER DEFAULT 1
    )
  `);

  ensureColumn(
    'guild_settings',
    'modlogChannelId',
    'TEXT'
  );

  ensureColumn(
    'guild_settings',
    'suggestionChannelId',
    'TEXT'
  );

  ensureColumn(
    'guild_settings',
    'transcriptChannelId',
    'TEXT'
  );

  ensureColumn(
    'guild_settings',
    'gamblingEnabled',
    'INTEGER DEFAULT 1'
  );

  ensureColumn(
    'guild_settings',
    'robEnabled',
    'INTEGER DEFAULT 1'
  );
}

function createLogSettingsTable() {

  rawRun(`

    CREATE TABLE IF NOT EXISTS log_settings (

      guildId TEXT NOT NULL,

      type TEXT NOT NULL,

      channelId TEXT NOT NULL,

      enabled INTEGER DEFAULT 1,

      PRIMARY KEY (guildId, type)
    )
  `);
}

function createTicketSettingsTable() {

  rawRun(`

    CREATE TABLE IF NOT EXISTS ticket_settings (

      guildId TEXT NOT NULL,

      type TEXT NOT NULL,

      enabled INTEGER DEFAULT 1,

      categoryId TEXT,

      roleId TEXT,

      PRIMARY KEY (guildId, type)
    )
  `);
}

function createTicketsTable() {

  rawRun(`

    CREATE TABLE IF NOT EXISTS tickets (

      id INTEGER PRIMARY KEY AUTOINCREMENT,

      guildId TEXT NOT NULL,

      channelId TEXT NOT NULL UNIQUE,

      userId TEXT NOT NULL,

      type TEXT NOT NULL,

      status TEXT DEFAULT 'OPEN',

      claimedBy TEXT,

      claimedAt INTEGER,

      closedBy TEXT,

      closedAt INTEGER,

      deletedBy TEXT,

      deletedAt INTEGER,

      transcriptUrl TEXT,

      createdAt INTEGER NOT NULL
    )
  `);

  rawRun(`
    CREATE INDEX IF NOT EXISTS idx_tickets_lookup
    ON tickets(guildId, userId, status)
  `);
}

function createTicketStatsTable() {

  rawRun(`

    CREATE TABLE IF NOT EXISTS ticket_stats (

      guildId TEXT NOT NULL,

      userId TEXT NOT NULL,

      claims INTEGER DEFAULT 0,

      closes INTEGER DEFAULT 0,

      messages INTEGER DEFAULT 0,

      totalHandleTime INTEGER DEFAULT 0,

      PRIMARY KEY (guildId, userId)
    )
  `);
}

function createSuggestionTables() {

  rawRun(`

    CREATE TABLE IF NOT EXISTS suggestions (

      id INTEGER PRIMARY KEY AUTOINCREMENT,

      guildId TEXT NOT NULL,

      messageId TEXT,

      userId TEXT NOT NULL,

      content TEXT NOT NULL,

      status TEXT DEFAULT 'PENDING',

      moderatorId TEXT,

      reason TEXT,

      timestamp INTEGER NOT NULL
    )
  `);

  ensureColumn(
    'suggestions',
    'moderatorId',
    'TEXT'
  );

  ensureColumn(
    'suggestions',
    'reason',
    'TEXT'
  );

  rawRun(`
    CREATE INDEX IF NOT EXISTS idx_suggestions
    ON suggestions(guildId, status)
  `);
}

function createAuditTables() {

  rawRun(`

    CREATE TABLE IF NOT EXISTS audit_logs (

      id INTEGER PRIMARY KEY AUTOINCREMENT,

      guildId TEXT NOT NULL,

      action TEXT NOT NULL,

      targetId TEXT,

      executorId TEXT,

      metadata TEXT,

      timestamp INTEGER NOT NULL
    )
  `);

  rawRun(`
    CREATE INDEX IF NOT EXISTS idx_audit_logs
    ON audit_logs(guildId, timestamp)
  `);
}

function createAfkTable() {

  rawRun(`

    CREATE TABLE IF NOT EXISTS afk (

      guildId TEXT NOT NULL,

      userId TEXT NOT NULL,

      reason TEXT NOT NULL,

      timestamp INTEGER NOT NULL,

      PRIMARY KEY (guildId, userId)
    )
  `);
}

function createCooldownTable() {

  rawRun(`

    CREATE TABLE IF NOT EXISTS cooldowns (

      guildId TEXT NOT NULL,

      userId TEXT NOT NULL,

      command TEXT NOT NULL,

      lastUsed INTEGER NOT NULL,

      PRIMARY KEY (guildId, userId, command)
    )
  `);

  rawRun(`
    CREATE INDEX IF NOT EXISTS idx_cooldowns
    ON cooldowns(userId, command)
  `);
}

function createSocialTables() {

  rawRun(`

    CREATE TABLE IF NOT EXISTS social_channels (

      guildId TEXT NOT NULL,

      platform TEXT NOT NULL,

      channelId TEXT NOT NULL,

      targetChannelId TEXT NOT NULL,

      lastItemId TEXT,

      PRIMARY KEY (guildId, platform, channelId)
    )
  `);

  rawRun(`

    CREATE TABLE IF NOT EXISTS social_links (

      guildId TEXT NOT NULL,

      name TEXT NOT NULL,

      url TEXT NOT NULL,

      PRIMARY KEY (guildId, name)
    )
  `);
}

function createPollTables() {

  rawRun(`

    CREATE TABLE IF NOT EXISTS polls (

      messageId TEXT PRIMARY KEY,

      guildId TEXT NOT NULL,

      channelId TEXT NOT NULL,

      creatorId TEXT NOT NULL,

      question TEXT NOT NULL,

      options TEXT NOT NULL,

      endsAt INTEGER,

      active INTEGER DEFAULT 1,

      createdAt INTEGER NOT NULL
    )
  `);

  rawRun(`

    CREATE TABLE IF NOT EXISTS poll_votes (

      messageId TEXT NOT NULL,

      userId TEXT NOT NULL,

      optionIndex INTEGER NOT NULL,

      PRIMARY KEY (messageId, userId)
    )
  `);
}

function initDatabase() {

  createCasesTable();

  createWarnsTable();

  createMutesTable();

  createGuildSettingsTable();

  createLogSettingsTable();

  createTicketSettingsTable();

  createTicketsTable();

  createTicketStatsTable();

  createSuggestionTables();

  createAuditTables();

  createAfkTable();

  createCooldownTable();

  createSocialTables();

  createPollTables();
}

initDatabase();

const cleanupInterval = setInterval(() => {

  try {

    const ninetyDaysAgo =
      Date.now() -
      (90 * 24 * 60 * 60 * 1000);

    run(

      `DELETE FROM audit_logs
       WHERE timestamp < ?`,

      [ninetyDaysAgo]
    );

    const sevenDaysAgo =
      Date.now() -
      (7 * 24 * 60 * 60 * 1000);

    run(

      `DELETE FROM cooldowns
       WHERE lastUsed < ?`,

      [sevenDaysAgo]
    );

  } catch (err) {

    console.error(
      'Cleanup error:',
      err
    );
  }

}, 60 * 60 * 1000);

cleanupInterval.unref?.();

module.exports = {

  db,

  run,

  get,

  all
};