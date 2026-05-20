const Database =
  require('better-sqlite3');

const db =
  new Database('./database.db');

// ==================================================
// ⚡ SQLITE PRAGMAS
// ==================================================
db.pragma(
  'journal_mode = WAL'
);

db.pragma(
  'foreign_keys = ON'
);

db.pragma(
  'synchronous = NORMAL'
);

db.pragma(
  'temp_store = MEMORY'
);

db.pragma(
  'cache_size = -32000'
);

// ==================================================
// ⚡ RAW DATABASE METHODS
// ==================================================
function rawRun(
  sql,
  params = []
) {

  return db
    .prepare(sql)
    .run(params);
}

function rawGet(
  sql,
  params = []
) {

  return db
    .prepare(sql)
    .get(params);
}

function rawAll(
  sql,
  params = []
) {

  return db
    .prepare(sql)
    .all(params);
}

// ==================================================
// 🧠 SAFE WRAPPERS
// ==================================================
function run(
  sql,
  params = []
) {

  try {

    return rawRun(
      sql,
      params
    );

  } catch (err) {

    console.error(
      'DB run error:',
      err.message
    );

    return null;
  }
}

function get(
  sql,
  params = []
) {

  try {

    return rawGet(
      sql,
      params
    );

  } catch (err) {

    console.error(
      'DB get error:',
      err.message
    );

    return null;
  }
}

function all(
  sql,
  params = []
) {

  try {

    return rawAll(
      sql,
      params
    );

  } catch (err) {

    console.error(
      'DB all error:',
      err.message
    );

    return [];
  }
}

// ==================================================
// 🧠 TABLE HELPERS
// ==================================================
function tableExists(
  tableName
) {

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

function tableColumns(
  tableName
) {

  if (
    !tableExists(tableName)
  ) {

    return [];
  }

  return rawAll(

    `PRAGMA table_info(${tableName})`
  );
}

function columnNames(
  tableName
) {

  return tableColumns(
    tableName
  )

    .map(
      column => column.name
    );
}

// ==================================================
// 🧠 SAFE COLUMN CHECK
// ==================================================
function ensureColumn(

  tableName,
  columnName,
  definition

) {

  try {

    if (

      !columnNames(tableName)
        .includes(columnName)
    ) {

      rawRun(

        `ALTER TABLE ${tableName}

         ADD COLUMN ${columnName}

         ${definition}`
      );

      console.log(

        `➕ Added column ${columnName} to ${tableName}`
      );
    }

  } catch (err) {

    console.error(

      `Ensure column error (${tableName}.${columnName}):`,

      err.message
    );
  }
}

// ==================================================
// 🧠 SAFE INDEX
// ==================================================
function createIndex(
  name,
  sql
) {

  try {

    rawRun(sql);

  } catch (err) {

    console.error(

      `Index creation error (${name}):`,

      err.message
    );
  }
}

// ==================================================
// 📜 CASES TABLE
// ==================================================
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

  createIndex(

    'idx_cases_user',

    `CREATE INDEX IF NOT EXISTS idx_cases_user
     ON cases(guildId, userId)`
  );

  createIndex(

    'idx_cases_action',

    `CREATE INDEX IF NOT EXISTS idx_cases_action
     ON cases(guildId, action)`
  );
}

// ==================================================
// ⚠️ WARNS
// ==================================================
function createWarnsTable() {

  rawRun(`

    CREATE TABLE IF NOT EXISTS warns (

      guildId TEXT NOT NULL,

      userId TEXT NOT NULL,

      count INTEGER NOT NULL DEFAULT 0,

      PRIMARY KEY (guildId, userId)
    )
  `);

  createIndex(

    'idx_warns_user',

    `CREATE INDEX IF NOT EXISTS idx_warns_user
     ON warns(guildId, userId)`
  );
}

// ==================================================
// 🔇 MUTES
// ==================================================
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

// ==================================================
// ⚙️ GUILD SETTINGS
// ==================================================
function createGuildSettingsTable() {

  rawRun(`

    CREATE TABLE IF NOT EXISTS guild_settings (

      guildId TEXT PRIMARY KEY,

      modlogChannelId TEXT,

      suggestionChannelId TEXT,

      transcriptChannelId TEXT,

      inviteChannelId TEXT,

      giveawayChannelId TEXT,

      messageLogChannelId TEXT,

      memberLogChannelId TEXT,

      serverLogChannelId TEXT,

      voiceLogChannelId TEXT,

      ticketLogChannelId TEXT,

      suggestionLogChannelId TEXT,

      gamblingEnabled INTEGER DEFAULT 1,

      robEnabled INTEGER DEFAULT 1
    )
  `);

  const columns = [

    ['modlogChannelId', 'TEXT'],
    ['suggestionChannelId', 'TEXT'],
    ['transcriptChannelId', 'TEXT'],
    ['inviteChannelId', 'TEXT'],
    ['giveawayChannelId', 'TEXT'],

    ['messageLogChannelId', 'TEXT'],
    ['memberLogChannelId', 'TEXT'],
    ['serverLogChannelId', 'TEXT'],
    ['voiceLogChannelId', 'TEXT'],
    ['ticketLogChannelId', 'TEXT'],
    ['suggestionLogChannelId', 'TEXT'],

    ['gamblingEnabled', 'INTEGER DEFAULT 1'],
    ['robEnabled', 'INTEGER DEFAULT 1']
  ];

  for (
    const [name, def] of columns
  ) {

    ensureColumn(
      'guild_settings',
      name,
      def
    );
  }
}

// ==================================================
// 📜 LOG SETTINGS
// ==================================================
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

// ==================================================
// 🎫 TICKET SETTINGS
// ==================================================
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

// ==================================================
// 🎫 TICKETS
// ==================================================
function createTicketsTable() {

  rawRun(`

    CREATE TABLE IF NOT EXISTS tickets (

      id INTEGER PRIMARY KEY AUTOINCREMENT,

      guildId TEXT NOT NULL,

      channelId TEXT NOT NULL UNIQUE,

      messageId TEXT,

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

  ensureColumn(
    'tickets',
    'messageId',
    'TEXT'
  );

  createIndex(

    'idx_tickets_lookup',

    `CREATE INDEX IF NOT EXISTS idx_tickets_lookup
     ON tickets(guildId, userId, status)`
  );
}

// ==================================================
// 👮 TICKET STATS
// ==================================================
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

// ==================================================
// 💡 SUGGESTIONS
// ==================================================
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

  createIndex(

    'idx_suggestions',

    `CREATE INDEX IF NOT EXISTS idx_suggestions
     ON suggestions(guildId, status)`
  );
}

// ==================================================
// 📜 AUDIT LOGS
// ==================================================
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

  createIndex(

    'idx_audit_logs',

    `CREATE INDEX IF NOT EXISTS idx_audit_logs
     ON audit_logs(guildId, timestamp)`
  );
}

// ==================================================
// 🌙 AFK
// ==================================================
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

// ==================================================
// ⏱ COOLDOWNS
// ==================================================
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

  createIndex(

    'idx_cooldowns',

    `CREATE INDEX IF NOT EXISTS idx_cooldowns
     ON cooldowns(userId, command)`
  );
}

// ==================================================
// 📱 SOCIAL
// ==================================================
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

// ==================================================
// 📊 POLLS
// ==================================================
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

// ==================================================
// 📨 INVITES
// ==================================================
function createInviteTables() {

  rawRun(`

    CREATE TABLE IF NOT EXISTS invite_cache (

      guildId TEXT NOT NULL,

      inviteCode TEXT NOT NULL,

      inviterId TEXT,

      uses INTEGER DEFAULT 0,

      PRIMARY KEY (guildId, inviteCode)
    )
  `);

  createIndex(

    'idx_invite_cache',

    `CREATE INDEX IF NOT EXISTS idx_invite_cache
     ON invite_cache(guildId, inviterId)`
  );

  rawRun(`

    CREATE TABLE IF NOT EXISTS invites (

      guildId TEXT NOT NULL,

      userId TEXT NOT NULL PRIMARY KEY,

      inviterId TEXT,

      inviteCode TEXT,

      uses INTEGER DEFAULT 0,

      joinedAt INTEGER NOT NULL,

      leftAt INTEGER,

      fake INTEGER DEFAULT 0,

      bonus INTEGER DEFAULT 0
    )
  `);

  createIndex(

    'idx_invites_inviter',

    `CREATE INDEX IF NOT EXISTS idx_invites_inviter
     ON invites(guildId, inviterId)`
  );

  createIndex(

    'idx_invites_user',

    `CREATE INDEX IF NOT EXISTS idx_invites_user
     ON invites(guildId, userId)`
  );

  rawRun(`

    CREATE TABLE IF NOT EXISTS invite_stats (

      guildId TEXT NOT NULL,

      userId TEXT NOT NULL,

      invites INTEGER DEFAULT 0,

      leaves INTEGER DEFAULT 0,

      fake INTEGER DEFAULT 0,

      bonus INTEGER DEFAULT 0,

      PRIMARY KEY (guildId, userId)
    )
  `);

  createIndex(

    'idx_invite_stats',

    `CREATE INDEX IF NOT EXISTS idx_invite_stats
     ON invite_stats(guildId, invites)`
  );
}

// ==================================================
// 🎉 GIVEAWAYS
// ==================================================
function createGiveawayTables() {

  rawRun(`

    CREATE TABLE IF NOT EXISTS giveaways (

      messageId TEXT PRIMARY KEY,

      guildId TEXT NOT NULL,

      channelId TEXT NOT NULL,

      hostId TEXT NOT NULL,

      prize TEXT NOT NULL,

      description TEXT,

      winners INTEGER DEFAULT 1,

      endsAt INTEGER NOT NULL,

      ended INTEGER DEFAULT 0,

      paused INTEGER DEFAULT 0,

      ending INTEGER DEFAULT 0,

      requirements TEXT,

      blacklistedRoles TEXT,

      bonusEntries TEXT,

      totalEntries INTEGER DEFAULT 0,

      createdAt INTEGER NOT NULL
    )
  `);

  ensureColumn(
    'giveaways',
    'ending',
    'INTEGER DEFAULT 0'
  );

  createIndex(

    'idx_giveaways_guild',

    `CREATE INDEX IF NOT EXISTS idx_giveaways_guild
     ON giveaways(guildId, ended)`
  );

  createIndex(

    'idx_giveaways_end',

    `CREATE INDEX IF NOT EXISTS idx_giveaways_end
     ON giveaways(endsAt, ended)`
  );

  rawRun(`

    CREATE TABLE IF NOT EXISTS giveaway_entries (

      messageId TEXT NOT NULL,

      guildId TEXT NOT NULL,

      userId TEXT NOT NULL,

      bonus INTEGER DEFAULT 0,

      joinedAt INTEGER NOT NULL,

      PRIMARY KEY (messageId, userId)
    )
  `);

  createIndex(

    'idx_giveaway_entries',

    `CREATE INDEX IF NOT EXISTS idx_giveaway_entries
     ON giveaway_entries(messageId, userId)`
  );

  rawRun(`

    CREATE TABLE IF NOT EXISTS message_stats (

      guildId TEXT NOT NULL,

      userId TEXT NOT NULL,

      totalMessages INTEGER DEFAULT 0,

      dailyMessages INTEGER DEFAULT 0,

      weeklyMessages INTEGER DEFAULT 0,

      monthlyMessages INTEGER DEFAULT 0,

      lastDailyReset INTEGER DEFAULT 0,

      lastWeeklyReset INTEGER DEFAULT 0,

      lastMonthlyReset INTEGER DEFAULT 0,

      PRIMARY KEY (guildId, userId)
    )
  `);

  createIndex(

    'idx_message_stats',

    `CREATE INDEX IF NOT EXISTS idx_message_stats
     ON message_stats(guildId, totalMessages)`
  );

  rawRun(`

    CREATE TABLE IF NOT EXISTS giveaway_winners (

      messageId TEXT NOT NULL,

      guildId TEXT NOT NULL,

      userId TEXT NOT NULL,

      rerolled INTEGER DEFAULT 0,

      wonAt INTEGER NOT NULL
    )
  `);

  createIndex(

    'idx_giveaway_winners',

    `CREATE INDEX IF NOT EXISTS idx_giveaway_winners
     ON giveaway_winners(messageId, userId)`
  );

  rawRun(`

    CREATE TABLE IF NOT EXISTS giveaway_blacklist (

      guildId TEXT NOT NULL,

      userId TEXT NOT NULL,

      reason TEXT,

      addedBy TEXT,

      addedAt INTEGER NOT NULL,

      PRIMARY KEY (guildId, userId)
    )
  `);

  createIndex(

    'idx_giveaway_blacklist',

    `CREATE INDEX IF NOT EXISTS idx_giveaway_blacklist
     ON giveaway_blacklist(guildId, userId)`
  );
}

// ==================================================
// 🚀 INIT DATABASE
// ==================================================
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

  createInviteTables();

  createGiveawayTables();

  console.log(
    '✅ Database initialized'
  );
}

initDatabase();

// ==================================================
// 🧹 CLEANUP TASK
// ==================================================
const cleanupInterval =
  setInterval(() => {

    try {

      // ==========================================
      // 📜 AUDIT LOGS
      // ==========================================
      const ninetyDaysAgo =
        Date.now() -

        (90 * 24 * 60 * 60 * 1000);

      run(

        `DELETE FROM audit_logs
         WHERE timestamp < ?`,

        [ninetyDaysAgo]
      );

      // ==========================================
      // ⏱ COOLDOWNS
      // ==========================================
      const sevenDaysAgo =
        Date.now() -

        (7 * 24 * 60 * 60 * 1000);

      run(

        `DELETE FROM cooldowns
         WHERE lastUsed < ?`,

        [sevenDaysAgo]
      );

      console.log(
        '🧹 Database cleanup complete'
      );

    } catch (err) {

      console.error(
        'Cleanup error:',
        err
      );
    }

  }, 60 * 60 * 1000);

// ==================================================
// 🚫 DO NOT BLOCK EXIT
// ==================================================
cleanupInterval.unref?.();

// ==================================================
// 📦 EXPORTS
// ==================================================
module.exports = {

  db,

  run,

  get,

  all,

  rawRun,

  rawGet,

  rawAll,

  tableExists,

  tableColumns,

  columnNames,

  ensureColumn
};