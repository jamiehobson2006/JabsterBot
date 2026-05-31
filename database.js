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

      expiresAt INTEGER,

      channelId TEXT,

      timestamp INTEGER,

      createdAt INTEGER NOT NULL DEFAULT 0
    )
  `);

  migrateCasesTable();

  ensureColumn(
    'cases',
    'duration',
    'INTEGER'
  );

  ensureColumn(
    'cases',
    'expiresAt',
    'INTEGER'
  );

  ensureColumn(
    'cases',
    'channelId',
    'TEXT'
  );

  ensureColumn(
    'cases',
    'timestamp',
    'INTEGER'
  );

  ensureColumn(
    'cases',
    'createdAt',
    'INTEGER NOT NULL DEFAULT 0'
  );

  rawRun(`
    UPDATE cases
    SET createdAt = timestamp
    WHERE (createdAt IS NULL OR createdAt = 0)
    AND timestamp IS NOT NULL
  `);

  rawRun(`
    UPDATE cases
    SET timestamp = createdAt
    WHERE (timestamp IS NULL OR timestamp = 0)
    AND createdAt IS NOT NULL
  `);

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

function getColumnDef(
  columns,
  name
) {

  return columns.find(
    column => column.name === name
  );
}

function hasColumn(
  columns,
  name
) {

  return Boolean(
    getColumnDef(columns, name)
  );
}

function caseSelectExpr(
  columns,
  name,
  fallback
) {

  return hasColumn(columns, name)
    ? name
    : fallback;
}

function migrateCasesTable() {

  const columns =
    tableColumns('cases');

  const timestampColumn =
    getColumnDef(
      columns,
      'timestamp'
    );

  const needsMigration =
    !hasColumn(columns, 'createdAt') ||
    !hasColumn(columns, 'expiresAt') ||
    !hasColumn(columns, 'channelId') ||
    Boolean(timestampColumn?.notnull);

  if (!needsMigration) {
    return;
  }

  const backupName =
    `cases_legacy_${Date.now()}`;

  rawRun(
    `ALTER TABLE cases RENAME TO ${backupName}`
  );

  rawRun(`
    CREATE TABLE cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guildId TEXT NOT NULL,
      userId TEXT NOT NULL,
      moderatorId TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT NOT NULL,
      duration INTEGER,
      expiresAt INTEGER,
      channelId TEXT,
      timestamp INTEGER,
      createdAt INTEGER NOT NULL DEFAULT 0
    )
  `);

  const legacyColumns =
    tableColumns(backupName);

  const timestampExpr =
    hasColumn(legacyColumns, 'timestamp')
      ? 'timestamp'
      : caseSelectExpr(
          legacyColumns,
          'createdAt',
          '?'
        );

  const createdAtExpr =
    hasColumn(legacyColumns, 'createdAt')
      ? 'createdAt'
      : caseSelectExpr(
          legacyColumns,
          'timestamp',
          '?'
        );

  const params = [];

  if (timestampExpr === '?') {
    params.push(Date.now());
  }

  if (createdAtExpr === '?') {
    params.push(Date.now());
  }

  rawRun(
    `INSERT INTO cases (
       id,
       guildId,
       userId,
       moderatorId,
       action,
       reason,
       duration,
       expiresAt,
       channelId,
       timestamp,
       createdAt
     )
     SELECT
       ${caseSelectExpr(legacyColumns, 'id', 'NULL')},
       ${caseSelectExpr(legacyColumns, 'guildId', "'legacy'")},
       ${caseSelectExpr(legacyColumns, 'userId', "'unknown'")},
       ${caseSelectExpr(legacyColumns, 'moderatorId', "'unknown'")},
       ${caseSelectExpr(legacyColumns, 'action', "'UNKNOWN'")},
       ${caseSelectExpr(legacyColumns, 'reason', "'No reason provided'")},
       ${caseSelectExpr(legacyColumns, 'duration', 'NULL')},
       ${caseSelectExpr(legacyColumns, 'expiresAt', 'NULL')},
       ${caseSelectExpr(legacyColumns, 'channelId', 'NULL')},
       ${timestampExpr},
       COALESCE(${createdAtExpr}, ${timestampExpr}, 0)
     FROM ${backupName}`,
    params
  );

  rawRun(
    `DROP TABLE ${backupName}`
  );
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

  createIndex(

    'idx_warns_user',

    `CREATE INDEX IF NOT EXISTS idx_warns_user
     ON warns(guildId, userId)`
  );
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

      inviteChannelId TEXT,

      giveawayChannelId TEXT,

      messageLogChannelId TEXT,

      memberLogChannelId TEXT,

      serverLogChannelId TEXT,

      voiceLogChannelId TEXT,

      ticketLogChannelId TEXT,

      suggestionLogChannelId TEXT,

      staffRoleId TEXT,

      adminRoleId TEXT,

      giveawayRoleId TEXT,

      supportCategoryId TEXT,

      applicationCategoryId TEXT,

      giveawayCategoryId TEXT,

      bugCategoryId TEXT,

      linkBlockEnabled INTEGER DEFAULT 0,

      linkBypassRoleId TEXT
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

    ['staffRoleId', 'TEXT'],
    ['adminRoleId', 'TEXT'],
    ['giveawayRoleId', 'TEXT'],

    ['supportCategoryId', 'TEXT'],
    ['applicationCategoryId', 'TEXT'],
    ['giveawayCategoryId', 'TEXT'],
    ['bugCategoryId', 'TEXT'],

    ['linkBlockEnabled', 'INTEGER DEFAULT 0'],
    ['linkBypassRoleId', 'TEXT']
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

function createSocialTables() {

  rawRun(`

    CREATE TABLE IF NOT EXISTS social_channels (

      guildId TEXT NOT NULL,

      platform TEXT NOT NULL,

      creatorId TEXT NOT NULL,

      creatorName TEXT NOT NULL,

      contentType TEXT NOT NULL,

      targetChannelId TEXT NOT NULL,

      pingRoleId TEXT,

      lastItemId TEXT,

      PRIMARY KEY (
        guildId,
        platform,
        creatorId,
        contentType
      )
    )
  `);

ensureColumn(
  'social_channels',
  'creatorId',
  'TEXT'
);

ensureColumn(
  'social_channels',
  'creatorName',
  'TEXT'
);

ensureColumn(
  'social_channels',
  'contentType',
  'TEXT'
);

ensureColumn(
  'social_channels',
  'pingRoleId',
  'TEXT'
);

ensureColumn(
  'social_channels',
  'lastMessageId',
  'TEXT'
);

ensureColumn(
  'social_channels',
  'lastLiveVideoId',
  'TEXT'
);

ensureColumn(
  'social_channels',
  'lastLiveMessageId',
  'TEXT'
);

ensureColumn(
  'social_channels',
  'peakLiveViewers',
  'INTEGER DEFAULT 0'
);

ensureColumn(
  'social_channels',
  'streamStartTime',
  'TEXT'
);

ensureColumn(
  'social_channels',
  'lastTwitchStreamId',
  'TEXT'
);

ensureColumn(
  'social_channels',
  'peakTwitchViewers',
  'INTEGER DEFAULT 0'
);

ensureColumn(
  'social_channels',
  'twitchStartTime',
  'TEXT'
);

ensureColumn(
  'social_channels',
  'initialized',
  'INTEGER DEFAULT 0'
);

ensureColumn(
  'social_channels',
  'addedAt',
  'INTEGER DEFAULT 0'
);
  rawRun(`

    CREATE TABLE IF NOT EXISTS social_links (

      guildId TEXT NOT NULL,

      name TEXT NOT NULL,

      url TEXT NOT NULL,

      PRIMARY KEY (guildId, name)
    )
  `);
}

function createLevelingTables() {

  rawRun(`

    CREATE TABLE IF NOT EXISTS leveling_users (

      guildId TEXT NOT NULL,

      userId TEXT NOT NULL,

      xp INTEGER DEFAULT 0,

      level INTEGER DEFAULT 0,

      messages INTEGER DEFAULT 0,

      lastXpTime INTEGER DEFAULT 0,

      PRIMARY KEY (
        guildId,
        userId
      )
    )
  `);

  createIndex(

    'idx_leveling_users',

    `CREATE INDEX IF NOT EXISTS idx_leveling_users
     ON leveling_users(guildId, xp)`
  );

rawRun(`

  CREATE TABLE IF NOT EXISTS leveling_config (

    guildId TEXT PRIMARY KEY,

    enabled INTEGER DEFAULT 1,

    xpMin INTEGER DEFAULT 15,

    xpMax INTEGER DEFAULT 25,

    cooldown INTEGER DEFAULT 60,

    levelChannelId TEXT,

    levelMessage TEXT,

    permissionLevel TEXT DEFAULT 'ManageGuild',

    ignoredChannels TEXT,

    ignoredRoles TEXT
  )
`);

ensureColumn(
  'leveling_config',
  'permissionLevel',
  "TEXT DEFAULT 'ManageGuild'"
);

ensureColumn(
  'leveling_config',
  'ignoredChannels',
  'TEXT'
);

ensureColumn(
  'leveling_config',
  'ignoredRoles',
  'TEXT'
);

rawRun(`

  CREATE TABLE IF NOT EXISTS leveling_rewards (

    guildId TEXT NOT NULL,

    level INTEGER NOT NULL,

    roleId TEXT NOT NULL,

    PRIMARY KEY (
      guildId,
      level
    )
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

  createIndex(
    'idx_poll_votes',
    `CREATE INDEX IF NOT EXISTS idx_poll_votes
     ON poll_votes(messageId)`
  );
}

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

      userId TEXT NOT NULL,

      inviterId TEXT,

      inviteCode TEXT,

      uses INTEGER DEFAULT 0,

      joinedAt INTEGER NOT NULL,

      leftAt INTEGER,

      fake INTEGER DEFAULT 0,

      bonus INTEGER DEFAULT 0,

      PRIMARY KEY (guildId, userId)
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

      wonAt INTEGER NOT NULL,

      PRIMARY KEY (messageId, userId)

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

  createLevelingTables();

  createPollTables();

  createInviteTables();

  createGiveawayTables();

  console.log(
    '✅ Database initialized'
  );
}

initDatabase();

const cleanupInterval =
  setInterval(() => {

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

cleanupInterval.unref?.();

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
