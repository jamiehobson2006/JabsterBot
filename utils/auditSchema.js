function migrateAuditFixes(run, ensureColumn, get, all) {
  ensureColumn('cases', 'warningActive', 'INTEGER');
  ensureColumn('application_drafts', 'questionsJson', 'TEXT');
  ensureColumn('application_drafts', 'submissionStatus', "TEXT NOT NULL DEFAULT 'ANSWERING'");
  ensureColumn('application_drafts', 'submissionChannelId', 'TEXT');
  ensureColumn('tickets', 'applicationDraftId', 'TEXT');
  ensureColumn('leveling_reward_grants', 'nextAttemptAt', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('delivery_outbox', 'uncertainSince', 'INTEGER');
  ensureColumn('guild_settings', 'staffListMessageIds', 'TEXT');
  ensureColumn('staff_rota_settings', 'messageIds', 'TEXT');
  ensureColumn('tickets', 'transcriptPublicCleanedAt', 'INTEGER');
  ensureColumn('giveaways', 'publicCleanedAt', 'INTEGER');
  ensureColumn('suggestions', 'publicCleanedAt', 'INTEGER');
  run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_application_ticket_draft
    ON tickets(applicationDraftId) WHERE applicationDraftId IS NOT NULL`);
  run(`CREATE TABLE IF NOT EXISTS work_leases (
    resourceKey TEXT PRIMARY KEY, token TEXT NOT NULL, expiresAt INTEGER NOT NULL)`);
  run(`CREATE TABLE IF NOT EXISTS free_game_observations (
    offerKey TEXT PRIMARY KEY, source TEXT NOT NULL, occurrence TEXT NOT NULL,
    isFree INTEGER NOT NULL DEFAULT 1, firstSeenAt INTEGER NOT NULL, lastSeenAt INTEGER NOT NULL,
    absentSince INTEGER, sourceWindow TEXT, receiptKey TEXT NOT NULL)`);
  run(`CREATE TABLE IF NOT EXISTS ticket_settings_legacy (
    guildId TEXT NOT NULL, type TEXT NOT NULL, enabled INTEGER, categoryId TEXT, roleId TEXT,
    PRIMARY KEY(guildId,type))`);
  run(`CREATE TRIGGER IF NOT EXISTS modmail_one_open_insert BEFORE INSERT ON modmail_threads
    WHEN NEW.status='OPEN' AND EXISTS(SELECT 1 FROM modmail_threads WHERE guildId=NEW.guildId AND userId=NEW.userId AND status='OPEN')
    BEGIN SELECT RAISE(ABORT,'An open modmail conversation already exists.'); END`);
  run(`CREATE TRIGGER IF NOT EXISTS modmail_one_open_update BEFORE UPDATE OF status,guildId,userId ON modmail_threads
    WHEN NEW.status='OPEN' AND EXISTS(SELECT 1 FROM modmail_threads WHERE guildId=NEW.guildId AND userId=NEW.userId AND status='OPEN' AND id<>NEW.id)
    BEGIN SELECT RAISE(ABORT,'An open modmail conversation already exists.'); END`);

  if (!get('SELECT 1 FROM schema_migrations WHERE version=2')) {
    run("UPDATE delivery_outbox SET uncertainSince=COALESCE(updatedAt,createdAt) WHERE status='FAILED' AND attempts>0 AND uncertainSince IS NULL");
    for (const row of all(`SELECT announcement.offerKey,MIN(announcement.announcedAt) AS announcedAt,
      COALESCE(settings.steamCountry,'GB') AS country FROM free_game_announcements announcement
      LEFT JOIN free_game_settings settings ON settings.guildId=announcement.guildId
      WHERE announcement.source='STEAM' GROUP BY announcement.offerKey,COALESCE(settings.steamCountry,'GB')`)) {
      if (!/^steam:\d+$/.test(row.offerKey)) continue;
      run(`INSERT OR IGNORE INTO free_game_observations(offerKey,source,occurrence,isFree,firstSeenAt,lastSeenAt,receiptKey)
        VALUES(?,'STEAM','initial',1,?,?,?)`, [`${row.country.toUpperCase()}:${row.offerKey}`,row.announcedAt,row.announcedAt,row.offerKey]);
    }
    for (const row of all('SELECT * FROM ticket_settings WHERE type <> LOWER(type)')) {
      if (!['support','bug','application','giveaway','partnership','appeal'].includes(row.type.toLowerCase())) continue;
      run('INSERT OR IGNORE INTO ticket_settings_legacy (guildId,type,enabled,categoryId,roleId) VALUES (?,?,?,?,?)',
        [row.guildId,row.type,row.enabled,row.categoryId,row.roleId]);
      run(`INSERT INTO ticket_settings (guildId,type,enabled,categoryId,roleId) VALUES (?,?,?,?,?)
        ON CONFLICT(guildId,type) DO UPDATE SET
        categoryId=COALESCE(NULLIF(ticket_settings.categoryId,''),excluded.categoryId),
        roleId=COALESCE(NULLIF(ticket_settings.roleId,''),excluded.roleId)`,
      [row.guildId,row.type.toLowerCase(),row.enabled,row.categoryId,row.roleId]);
      run('DELETE FROM ticket_settings WHERE guildId=? AND type=?', [row.guildId,row.type]);
    }
    // Legacy counters may predate cases. Preserve the counter; mark only the most
    // recent known cases active so deleting an already-cleared case cannot affect it.
    run("UPDATE cases SET warningActive=0 WHERE UPPER(action)='WARN' AND warningActive IS NULL");
    for (const row of all('SELECT * FROM warns WHERE count>0')) {
      run(`UPDATE cases SET warningActive=1 WHERE id IN (SELECT id FROM cases
        WHERE guildId=? AND userId=? AND UPPER(action)='WARN' ORDER BY timestamp DESC,id DESC LIMIT ?)`,
      [row.guildId,row.userId,row.count]);
    }
    run("UPDATE leveling_reward_grants SET status='PENDING',nextAttemptAt=0 WHERE status='FAILED' OR (status='CANCELLED' AND (lastError LIKE '%Manage Roles%' OR lastError LIKE '%below my highest role%'))");
    run("INSERT INTO schema_migrations(version,name,appliedAt) VALUES(2,'audit-recovery-and-safety',?)", [Date.now()]);
  }
}

module.exports = { migrateAuditFixes };
