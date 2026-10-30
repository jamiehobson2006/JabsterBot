function migrateCommunityFeatures(run, ensureColumn) {
  ensureColumn('suggestions','duplicateOfId','INTEGER');
  ensureColumn('suggestions','duplicateLinkedBy','TEXT');
  ensureColumn('suggestions','duplicateLinkedAt','INTEGER');
  ensureColumn('suggestions','sourceChannelId','TEXT');
  run(`CREATE TABLE IF NOT EXISTS fact_source_health (
    factKey TEXT PRIMARY KEY, sourceUrl TEXT, status TEXT NOT NULL DEFAULT 'UNCHECKED',
    checkedAt INTEGER, nextCheckAt INTEGER NOT NULL DEFAULT 0, httpStatus INTEGER, error TEXT,
    reviewNotifiedAt INTEGER, reviewedAt INTEGER, reviewedBy TEXT, reviewNote TEXT)`);
  run(`CREATE TABLE IF NOT EXISTS free_game_reminder_offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guildId TEXT NOT NULL, offerKey TEXT NOT NULL,
    channelId TEXT NOT NULL, source TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL,
    endsAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, UNIQUE(guildId,offerKey))`);
  run(`CREATE TABLE IF NOT EXISTS free_game_reminders (
    offerId INTEGER NOT NULL, userId TEXT NOT NULL, remindAt INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING', subscriptionKey TEXT NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL,
    PRIMARY KEY(offerId,userId), FOREIGN KEY(offerId) REFERENCES free_game_reminder_offers(id))`);
  run('CREATE INDEX IF NOT EXISTS free_game_reminders_due ON free_game_reminders(status,remindAt)');
  run(`INSERT OR IGNORE INTO schema_migrations(version,name,appliedAt)
    VALUES(3,'configuration-and-community-tools',?)`,[Date.now()]);
}

module.exports = { migrateCommunityFeatures };
