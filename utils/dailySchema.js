function migrateDailyFeatures(run, ensureColumn) {
  for (const table of ['dailyfact_submissions', 'dailyfact_facts']) {
    for (const [column, definition] of Object.entries({ sourceUrl: 'TEXT', verifiedAt: 'INTEGER',
      verifiedBy: 'TEXT', verificationNote: 'TEXT' })) ensureColumn(table, column, definition);
  }
  ensureColumn('daily_interaction_posts', 'activityJson', 'TEXT');
  ensureColumn('daily_interaction_posts', 'displayedGameVersion', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('daily_interaction_posts', 'triviaRevealedAt', 'INTEGER');
  ensureColumn('daily_interaction_posts', 'displayedChoiceHash', 'TEXT');
  run(`CREATE TABLE IF NOT EXISTS daily_engagement_settings (
    guildId TEXT PRIMARY KEY, quietDays TEXT NOT NULL DEFAULT '[]',
    remindersEnabled INTEGER NOT NULL DEFAULT 0, reminderDelayMinutes INTEGER NOT NULL DEFAULT 120,
    dailyPointCap INTEGER NOT NULL DEFAULT 10, triviaMinutes INTEGER NOT NULL DEFAULT 60,
    seasonId TEXT NOT NULL DEFAULT 'season-1', seasonName TEXT NOT NULL DEFAULT 'Season 1',
    seasonStartedAt INTEGER NOT NULL DEFAULT 0)`);
  run(`CREATE TABLE IF NOT EXISTS daily_member_preferences (
    guildId TEXT NOT NULL, userId TEXT NOT NULL, reminders INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(guildId, userId))`);
  run(`CREATE TABLE IF NOT EXISTS daily_game_turns (
    messageId TEXT NOT NULL, turn INTEGER NOT NULL, userId TEXT NOT NULL,
    answer TEXT NOT NULL, createdAt INTEGER NOT NULL, PRIMARY KEY(messageId, turn))`);
  run(`CREATE TABLE IF NOT EXISTS daily_trivia_attempts (
    messageId TEXT NOT NULL, userId TEXT NOT NULL, answer TEXT NOT NULL,
    correct INTEGER NOT NULL, submittedAt INTEGER NOT NULL, PRIMARY KEY(messageId, userId))`);
  run(`CREATE TABLE IF NOT EXISTS daily_point_events (
    guildId TEXT NOT NULL, userId TEXT NOT NULL, seasonId TEXT NOT NULL, dateKey TEXT NOT NULL,
    messageId TEXT NOT NULL, kind TEXT NOT NULL, points INTEGER NOT NULL, createdAt INTEGER NOT NULL,
    PRIMARY KEY(messageId, userId, kind))`);
  run(`CREATE TABLE IF NOT EXISTS daily_seasons (
    guildId TEXT NOT NULL, seasonId TEXT NOT NULL, name TEXT NOT NULL,
    startedAt INTEGER NOT NULL, endedAt INTEGER, PRIMARY KEY(guildId, seasonId))`);
  run(`CREATE INDEX IF NOT EXISTS idx_daily_points_season ON daily_point_events(guildId, seasonId, userId)`);
  run(`CREATE INDEX IF NOT EXISTS idx_daily_points_cap ON daily_point_events(guildId, userId, dateKey)`);
  run(`CREATE TABLE IF NOT EXISTS daily_milestone_roles (
    guildId TEXT NOT NULL, roleId TEXT NOT NULL, points INTEGER NOT NULL,
    PRIMARY KEY(guildId, roleId))`);
  run(`CREATE TABLE IF NOT EXISTS daily_role_grants (
    guildId TEXT NOT NULL, userId TEXT NOT NULL, roleId TEXT NOT NULL, seasonId TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0,
    nextAttemptAt INTEGER NOT NULL DEFAULT 0, lastError TEXT, grantedAt INTEGER,
    PRIMARY KEY(guildId, userId, roleId, seasonId))`);
}

module.exports = { migrateDailyFeatures };
