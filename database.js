const Database = require('better-sqlite3');
const db = new Database('./database.db');

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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
    console.error('DB run error:', err.message);
    return null;
  }
}

function get(sql, params = []) {
  try {
    return rawGet(sql, params);
  } catch (err) {
    console.error('DB get error:', err.message);
    return null;
  }
}

function all(sql, params = []) {
  try {
    return rawAll(sql, params);
  } catch (err) {
    console.error('DB all error:', err.message);
    return [];
  }
}

function tableExists(tableName) {
  return Boolean(rawGet(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [tableName],
  ));
}

function tableColumns(tableName) {
  if (!tableExists(tableName)) return [];
  return rawAll(`PRAGMA table_info(${tableName})`);
}

function columnNames(tableName) {
  return tableColumns(tableName).map((column) => column.name);
}

function ensureColumn(tableName, columnName, definition) {
  if (!columnNames(tableName).includes(columnName)) {
    rawRun(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function createCasesTable() {
  rawRun(`CREATE TABLE IF NOT EXISTS cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guildId TEXT NOT NULL,
    userId TEXT NOT NULL,
    moderatorId TEXT NOT NULL,
    action TEXT NOT NULL,
    reason TEXT NOT NULL,
    duration INTEGER,
    timestamp INTEGER NOT NULL
  )`);

  ensureColumn('cases', 'duration', 'INTEGER');
  ensureColumn('cases', 'timestamp', 'INTEGER');

  if (columnNames('cases').includes('createdAt')) {
    rawRun('UPDATE cases SET timestamp = COALESCE(timestamp, createdAt, ?) WHERE timestamp IS NULL', [Date.now()]);
  }
}

function createWarnsTable() {
  if (!tableExists('warns')) {
    rawRun(`CREATE TABLE warns (
      guildId TEXT NOT NULL,
      userId TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guildId, userId)
    )`);
    return;
  }

  const columns = tableColumns('warns');
  const names = columns.map((column) => column.name);
  const primaryKeys = columns.filter((column) => column.pk > 0).map((column) => column.name).sort();
  const hasExpectedShape = names.includes('guildId')
    && names.includes('userId')
    && names.includes('count')
    && primaryKeys.join(',') === 'guildId,userId';

  if (hasExpectedShape) return;

  const legacyName = `warns_legacy_${Date.now()}`;
  rawRun(`ALTER TABLE warns RENAME TO ${legacyName}`);

  rawRun(`CREATE TABLE warns (
    guildId TEXT NOT NULL,
    userId TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guildId, userId)
  )`);

  const legacyColumns = columnNames(legacyName);
  if (legacyColumns.includes('guildId') && legacyColumns.includes('userId')) {
    const countExpression = legacyColumns.includes('count') ? 'SUM(COALESCE(count, 1))' : 'COUNT(*)';
    rawRun(`INSERT OR REPLACE INTO warns (guildId, userId, count)
      SELECT guildId, userId, ${countExpression}
      FROM ${legacyName}
      GROUP BY guildId, userId`);
  }
}

function createMutesTable() {
  rawRun(`CREATE TABLE IF NOT EXISTS mutes (
    guildId TEXT NOT NULL,
    userId TEXT NOT NULL,
    endTime INTEGER NOT NULL,
    PRIMARY KEY (guildId, userId)
  )`);
}

function createGuildSettingsTable() {
  rawRun(`CREATE TABLE IF NOT EXISTS guild_settings (
    guildId TEXT PRIMARY KEY,
    modlogChannelId TEXT,
    suggestionChannelId TEXT,
    staffRoleId TEXT,
    adminRoleId TEXT,
    ticketCategoryId TEXT,
    supportCategoryId TEXT,
    applicationCategoryId TEXT,
    bugCategoryId TEXT,
    giveawayCategoryId TEXT,
    transcriptChannelId TEXT,
    giveawayRoleId TEXT,
    gamblingEnabled INTEGER DEFAULT 1,
    robEnabled INTEGER DEFAULT 1
  )`);

  ensureColumn('guild_settings', 'modlogChannelId', 'TEXT');
  ensureColumn('guild_settings', 'suggestionChannelId', 'TEXT');
  ensureColumn('guild_settings', 'staffRoleId', 'TEXT');
  ensureColumn('guild_settings', 'adminRoleId', 'TEXT');
  ensureColumn('guild_settings', 'ticketCategoryId', 'TEXT');
  ensureColumn('guild_settings', 'supportCategoryId', 'TEXT');
  ensureColumn('guild_settings', 'applicationCategoryId', 'TEXT');
  ensureColumn('guild_settings', 'bugCategoryId', 'TEXT');
  ensureColumn('guild_settings', 'giveawayCategoryId', 'TEXT');
  ensureColumn('guild_settings', 'transcriptChannelId', 'TEXT');
  ensureColumn('guild_settings', 'giveawayRoleId', 'TEXT');
  ensureColumn('guild_settings', 'gamblingEnabled', 'INTEGER DEFAULT 1');
  ensureColumn('guild_settings', 'robEnabled', 'INTEGER DEFAULT 1');

  rawRun(
    `UPDATE guild_settings
     SET supportCategoryId = COALESCE(supportCategoryId, ticketCategoryId)
     WHERE ticketCategoryId IS NOT NULL`,
  );
}

function createEconomyTables() {
  rawRun(`CREATE TABLE IF NOT EXISTS economy (
    guildId TEXT NOT NULL,
    userId TEXT NOT NULL,
    balance INTEGER DEFAULT 0,
    bank INTEGER DEFAULT 0,
    lastDaily INTEGER DEFAULT 0,
    lastWeekly INTEGER DEFAULT 0,
    lastBeg INTEGER DEFAULT 0,
    lastCrime INTEGER DEFAULT 0,
    lastWork INTEGER DEFAULT 0,
    lastRob INTEGER DEFAULT 0,
    PRIMARY KEY (guildId, userId)
  )`);

  rawRun(`CREATE TABLE IF NOT EXISTS shop_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guildId TEXT NOT NULL,
    name TEXT NOT NULL,
    price INTEGER NOT NULL,
    description TEXT DEFAULT '',
    roleId TEXT,
    UNIQUE(guildId, name)
  )`);

  rawRun(`CREATE TABLE IF NOT EXISTS inventory (
    guildId TEXT NOT NULL,
    userId TEXT NOT NULL,
    itemId INTEGER NOT NULL,
    quantity INTEGER DEFAULT 1,
    PRIMARY KEY (guildId, userId, itemId)
  )`);
}

function createSuggestionTables() {
  rawRun(`CREATE TABLE IF NOT EXISTS suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guildId TEXT NOT NULL,
    messageId TEXT,
    userId TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT DEFAULT 'PENDING',
    moderatorId TEXT,
    reason TEXT,
    timestamp INTEGER NOT NULL
  )`);

  ensureColumn('suggestions', 'moderatorId', 'TEXT');
  ensureColumn('suggestions', 'reason', 'TEXT');
}

function createAuditTables() {
  rawRun(`CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guildId TEXT NOT NULL,
    action TEXT NOT NULL,
    targetId TEXT,
    executorId TEXT,
    metadata TEXT,
    timestamp INTEGER NOT NULL
  )`);
}

function createAfkTable() {
  if (!tableExists('afk')) {
    rawRun(`CREATE TABLE afk (
      guildId TEXT NOT NULL,
      userId TEXT NOT NULL,
      reason TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      PRIMARY KEY (guildId, userId)
    )`);
    return;
  }

  const columns = tableColumns('afk');
  const names = columns.map((column) => column.name);
  const primaryKeys = columns.filter((column) => column.pk > 0).map((column) => column.name).sort();
  const hasExpectedShape = names.includes('guildId')
    && names.includes('userId')
    && names.includes('reason')
    && names.includes('timestamp')
    && primaryKeys.join(',') === 'guildId,userId';

  if (hasExpectedShape) return;

  const legacyName = `afk_legacy_${Date.now()}`;
  rawRun(`ALTER TABLE afk RENAME TO ${legacyName}`);

  rawRun(`CREATE TABLE afk (
    guildId TEXT NOT NULL,
    userId TEXT NOT NULL,
    reason TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    PRIMARY KEY (guildId, userId)
  )`);

  const legacyColumns = columnNames(legacyName);
  if (legacyColumns.includes('userId')) {
    const guildExpression = legacyColumns.includes('guildId') ? 'COALESCE(guildId, ?)' : '?';
    rawRun(`INSERT OR REPLACE INTO afk (guildId, userId, reason, timestamp)
      SELECT ${guildExpression}, userId, COALESCE(reason, 'AFK'), COALESCE(timestamp, ?)
      FROM ${legacyName}`,
      [process.env.GUILD_ID || 'global', Date.now()]);
  }
}

function createCooldownTable() {
  rawRun(`CREATE TABLE IF NOT EXISTS cooldowns (
    guildId TEXT NOT NULL,
    userId TEXT NOT NULL,
    command TEXT NOT NULL,
    lastUsed INTEGER NOT NULL,
    PRIMARY KEY (guildId, userId, command)
  )`);
}

function createTicketTables() {
  rawRun(`CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guildId TEXT NOT NULL,
    userId TEXT NOT NULL,
    channelId TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN',
    claimedBy TEXT,
    createdAt INTEGER NOT NULL,
    messageCount INTEGER DEFAULT 0,
    lastMessageAt INTEGER,
    closedAt INTEGER,
    deletedAt INTEGER
  )`);

  ensureColumn('tickets', 'status', "TEXT NOT NULL DEFAULT 'OPEN'");
  ensureColumn('tickets', 'createdAt', 'INTEGER');
  ensureColumn('tickets', 'messageCount', 'INTEGER DEFAULT 0');
  ensureColumn('tickets', 'lastMessageAt', 'INTEGER');
  ensureColumn('tickets', 'claimedBy', 'TEXT');
  ensureColumn('tickets', 'closedAt', 'INTEGER');
  ensureColumn('tickets', 'deletedAt', 'INTEGER');

  if (columnNames('tickets').includes('timestamp')) {
    rawRun('UPDATE tickets SET createdAt = COALESCE(createdAt, timestamp, ?) WHERE createdAt IS NULL', [Date.now()]);
  }
}

function createSocialTables() {
  rawRun(`CREATE TABLE IF NOT EXISTS social_channels (
    guildId TEXT NOT NULL,
    platform TEXT NOT NULL,
    channelId TEXT NOT NULL,
    targetChannelId TEXT NOT NULL,
    lastItemId TEXT,
    PRIMARY KEY (guildId, platform, channelId)
  )`);

  rawRun(`CREATE TABLE IF NOT EXISTS social_links (
    guildId TEXT NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    PRIMARY KEY (guildId, name)
  )`);
}

function initDatabase() {
  createCasesTable();
  createWarnsTable();
  createMutesTable();
  createGuildSettingsTable();
  createEconomyTables();
  createSuggestionTables();
  createAuditTables();
  createAfkTable();
  createCooldownTable();
  createTicketTables();
  createSocialTables();
}

initDatabase();

const cleanupInterval = setInterval(() => {
  const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
  run('DELETE FROM audit_logs WHERE timestamp < ?', [oneDayAgo]);
}, 60 * 60 * 1000);

cleanupInterval.unref?.();

module.exports = { db, run, get, all };

