const Database = require('better-sqlite3');

const db = new Database('./database.db');

// 🚀 PERFORMANCE
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

// ========================
// ⚡ STATEMENT CACHE
// ========================
const statements = new Map();

function prepare(sql) {
  if (!statements.has(sql)) {
    statements.set(sql, db.prepare(sql));
  }
  return statements.get(sql);
}

// ========================
// 🛡 SAFE WRAPPERS
// ========================
function run(sql, params = []) {
  try {
    return prepare(sql).run(params);
  } catch (err) {
    console.error('DB RUN ERROR:', err, sql);
    return null;
  }
}

function get(sql, params = []) {
  try {
    return prepare(sql).get(params);
  } catch (err) {
    console.error('DB GET ERROR:', err, sql);
    return null;
  }
}

function all(sql, params = []) {
  try {
    return prepare(sql).all(params);
  } catch (err) {
    console.error('DB ALL ERROR:', err, sql);
    return [];
  }
}

// ========================
// 🔁 TRANSACTIONS
// ========================
function transaction(fn) {
  return db.transaction(fn);
}

// ========================
// 🧠 META (VERSIONING)
// ========================
db.prepare(`
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
)
`).run();

run(`INSERT OR IGNORE INTO meta (key, value) VALUES ('version', '1')`);

// ========================
// 📄 CASES (UPGRADED)
// ========================
db.prepare(`
CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guildId TEXT NOT NULL,
  userId TEXT NOT NULL,
  moderatorId TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN (
    'BAN','KICK','MUTE','UNMUTE','WARN','CLEARWARNS',
    'LOCK','UNLOCK','ROLE_ADD','ROLE_REMOVE'
  )),
  reason TEXT,
  duration INTEGER,
  createdAt INTEGER
)
`).run();

db.prepare(`CREATE INDEX IF NOT EXISTS idx_cases_lookup ON cases(guildId, userId)`).run();

// ========================
// ⚠️ WARNS (REAL SYSTEM)
// ========================
db.prepare(`
CREATE TABLE IF NOT EXISTS warns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guildId TEXT,
  userId TEXT,
  moderatorId TEXT,
  reason TEXT,
  timestamp INTEGER
)
`).run();

db.prepare(`CREATE INDEX IF NOT EXISTS idx_warns_lookup ON warns(guildId, userId)`).run();

// ========================
// 🔇 MUTES
// ========================
db.prepare(`
CREATE TABLE IF NOT EXISTS mutes (
  guildId TEXT,
  userId TEXT,
  endTime INTEGER,
  PRIMARY KEY (guildId, userId)
)
`).run();

db.prepare(`CREATE INDEX IF NOT EXISTS idx_mutes_end ON mutes(endTime)`).run();

// ========================
// 🎟️ TICKETS (UPGRADED)
// ========================
db.prepare(`
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guildId TEXT NOT NULL,
  userId TEXT NOT NULL,
  channelId TEXT UNIQUE,
  type TEXT,
  status TEXT CHECK(status IN ('OPEN','CLOSED','DELETED')) DEFAULT 'OPEN',
  claimedBy TEXT,
  createdAt INTEGER,
  closedAt INTEGER,
  deletedAt INTEGER
)
`).run();

db.prepare(`CREATE INDEX IF NOT EXISTS idx_tickets_lookup ON tickets(guildId, userId, status)`).run();

// ========================
// ⚙️ GUILD SETTINGS
// ========================
db.prepare(`
CREATE TABLE IF NOT EXISTS guild_settings (
  guildId TEXT PRIMARY KEY,
  modlogChannelId TEXT,
  suggestionChannelId TEXT,
  staffRoleId TEXT,
  adminRoleId TEXT,
  ticketCategoryId TEXT,
  giveawayRoleId TEXT,
  transcriptChannelId TEXT
)
`).run();

// ========================
// 💡 SUGGESTIONS
// ========================
db.prepare(`
CREATE TABLE IF NOT EXISTS suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guildId TEXT,
  messageId TEXT UNIQUE,
  userId TEXT,
  content TEXT,
  status TEXT CHECK(status IN ('PENDING','ACCEPTED','DENIED')) DEFAULT 'PENDING',
  moderatorId TEXT,
  reason TEXT,
  timestamp INTEGER
)
`).run();

db.prepare(`CREATE INDEX IF NOT EXISTS idx_suggestions_lookup ON suggestions(guildId, status)`).run();

// ========================
// 💤 AFK
// ========================
db.prepare(`
CREATE TABLE IF NOT EXISTS afk (
  userId TEXT PRIMARY KEY,
  reason TEXT,
  timestamp INTEGER
)
`).run();

db.prepare(`CREATE INDEX IF NOT EXISTS idx_afk_user ON afk(userId)`).run();

// ========================
// ⏱ COOLDOWNS
// ========================
db.prepare(`
CREATE TABLE IF NOT EXISTS cooldowns (
  guildId TEXT,
  userId TEXT,
  command TEXT,
  lastUsed INTEGER,
  PRIMARY KEY (guildId, userId, command)
)
`).run();

db.prepare(`CREATE INDEX IF NOT EXISTS idx_cooldowns_lookup ON cooldowns(guildId, userId, command)`).run();

// ========================
// 📝 NOTES
// ========================
db.prepare(`
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guildId TEXT,
  userId TEXT,
  moderatorId TEXT,
  note TEXT,
  timestamp INTEGER
)
`).run();

db.prepare(`CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(userId)`).run();

// ========================
// 🏆 BADGES
// ========================
db.prepare(`
CREATE TABLE IF NOT EXISTS badges (
  userId TEXT,
  badge TEXT,
  PRIMARY KEY (userId, badge)
)
`).run();

// ========================
// 📜 AUDIT LOGS (NEW 🔥)
// ========================
db.prepare(`
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guildId TEXT,
  action TEXT,
  targetId TEXT,
  executorId TEXT,
  metadata TEXT,
  timestamp INTEGER
)
`).run();

// ========================
// 🧹 AUTO CLEANUP
// ========================
setInterval(() => {
  try {
    const now = Date.now();

    // ⏱ Cooldowns (24h)
    run(`DELETE FROM cooldowns WHERE lastUsed < ?`, [now - 86400000]);

    // 🎟 Deleted tickets (7 days)
    run(`DELETE FROM tickets WHERE status='DELETED' AND deletedAt < ?`, [
      now - 7 * 86400000
    ]);

    // 🔇 Expired mutes cleanup (optional)
    run(`DELETE FROM mutes WHERE endTime < ?`, [now]);

  } catch (err) {
    console.error('Cleanup error:', err);
  }
}, 3600000);

// ========================
// EXPORTS
// ========================
module.exports = {
  run,
  get,
  all,
  transaction
};