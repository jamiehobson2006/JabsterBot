function migrateSelectedImprovements(run, ensureColumn) {
  for (const [table, column, type] of [
    ['tickets','transcriptBoundaryId','TEXT'], ['tickets','closePermissionsJson','TEXT'],
    ['ticket_feedback','dmAttempts','INTEGER NOT NULL DEFAULT 0'], ['ticket_feedback','dmNextAttemptAt','INTEGER NOT NULL DEFAULT 0'],
    ['ticket_feedback','dmLastError','TEXT'], ['ticket_feedback','dmMessageId','TEXT'],
    ['free_game_settings','extraSources','TEXT NOT NULL DEFAULT \'[]\''],
    ['reaction_role_panels','layout','TEXT NOT NULL DEFAULT \'REACTIONS\''],
    ['reaction_role_panels','requiredRoleId','TEXT'],
    ['leveling_config','duplicateWindow','INTEGER NOT NULL DEFAULT 300'],
    ['leveling_users','lastContentHash','TEXT'], ['leveling_users','lastContentAt','INTEGER'],
    ['application_questions','answerType','TEXT NOT NULL DEFAULT \'TEXT\''],
    ['application_questions','choicesJson','TEXT'], ['application_drafts','questionVersion','INTEGER NOT NULL DEFAULT 0']
  ]) ensureColumn(table,column,type);
  run(`CREATE TABLE IF NOT EXISTS safety_policies (
    guildId TEXT PRIMARY KEY, managerRoleId TEXT, warningDecayDays INTEGER NOT NULL DEFAULT 0,
    warningThresholds TEXT NOT NULL DEFAULT '{"3":600,"5":3600}', updatedBy TEXT, updatedAt INTEGER)`);
  run(`CREATE TABLE IF NOT EXISTS logging_privacy(guildId TEXT PRIMARY KEY,retentionDays INTEGER NOT NULL DEFAULT 7,
    updatedBy TEXT,updatedAt INTEGER)`);
  run(`CREATE TABLE IF NOT EXISTS logging_excluded_channels(guildId TEXT NOT NULL,channelId TEXT NOT NULL,PRIMARY KEY(guildId,channelId))`);
  ensureColumn('moderation_actions','dmStatus','TEXT');
  ensureColumn('moderation_actions','dmError','TEXT');
  ensureColumn('ticket_response_samples','businessMs','INTEGER');
  run(`CREATE TABLE IF NOT EXISTS ticket_work_hours(guildId TEXT PRIMARY KEY,timezone TEXT NOT NULL,
    startMinute INTEGER NOT NULL,endMinute INTEGER NOT NULL,weekdays TEXT NOT NULL,updatedBy TEXT,updatedAt INTEGER)`);
  run(`CREATE TABLE IF NOT EXISTS ticket_creation_intents (
    fingerprint TEXT PRIMARY KEY, guildId TEXT NOT NULL, userId TEXT NOT NULL, type TEXT NOT NULL,
    channelId TEXT, messageId TEXT, pagesSent INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'CREATING')`);
  run(`CREATE TABLE IF NOT EXISTS ticket_limits(guildId TEXT PRIMARY KEY,maxPerWindow INTEGER NOT NULL DEFAULT 3,
    windowMinutes INTEGER NOT NULL DEFAULT 10,cooldownSeconds INTEGER NOT NULL DEFAULT 15)`);
  run(`CREATE TABLE IF NOT EXISTS daily_prompt_overrides (
    guildId TEXT NOT NULL, promptKey TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
    weight INTEGER NOT NULL DEFAULT 1, reason TEXT, updatedBy TEXT NOT NULL, updatedAt INTEGER NOT NULL,
    PRIMARY KEY(guildId,promptKey))`);
  run(`CREATE TABLE IF NOT EXISTS automation_managers (
    guildId TEXT NOT NULL, module TEXT NOT NULL, roleId TEXT NOT NULL, PRIMARY KEY(guildId,module,roleId))`);
  run(`CREATE TABLE IF NOT EXISTS automation_entries (
    guildId TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, template TEXT NOT NULL,
    triggerText TEXT, matchMode TEXT NOT NULL DEFAULT 'EXACT', useRoleId TEXT, channelId TEXT,
    cooldownSeconds INTEGER NOT NULL DEFAULT 30, enabled INTEGER NOT NULL DEFAULT 1,
    uses INTEGER NOT NULL DEFAULT 0, createdBy TEXT NOT NULL, updatedAt INTEGER NOT NULL,
    PRIMARY KEY(guildId,name))`);
  run(`CREATE TABLE IF NOT EXISTS raid_settings (
    guildId TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, alertChannelId TEXT,
    threshold INTEGER NOT NULL DEFAULT 8, windowSeconds INTEGER NOT NULL DEFAULT 60,
    accountAgeDays INTEGER NOT NULL DEFAULT 7, action TEXT NOT NULL DEFAULT 'ALERT',
    timeoutMinutes INTEGER NOT NULL DEFAULT 10, incidentMinutes INTEGER NOT NULL DEFAULT 15,
    updatedBy TEXT, updatedAt INTEGER)`);
  run(`CREATE TABLE IF NOT EXISTS raid_exempt_roles (
    guildId TEXT NOT NULL, roleId TEXT NOT NULL, PRIMARY KEY(guildId,roleId))`);
  run(`CREATE TABLE IF NOT EXISTS raid_joins (
    guildId TEXT NOT NULL, userId TEXT NOT NULL, joinedAt INTEGER NOT NULL,
    PRIMARY KEY(guildId,userId,joinedAt))`);
  run(`CREATE TABLE IF NOT EXISTS raid_incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guildId TEXT NOT NULL, startedAt INTEGER NOT NULL,
    endsAt INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE', alertMessageId TEXT, endedBy TEXT)`);
  run(`CREATE UNIQUE INDEX IF NOT EXISTS active_raid_incident ON raid_incidents(guildId) WHERE status='ACTIVE'`);
  run(`CREATE TABLE IF NOT EXISTS raid_actions (
    incidentId INTEGER NOT NULL, userId TEXT NOT NULL, expiresAt INTEGER, recordId TEXT,
    status TEXT NOT NULL, error TEXT, PRIMARY KEY(incidentId,userId))`);
  run(`CREATE TABLE IF NOT EXISTS source_health (
    provider TEXT PRIMARY KEY, checkedAt INTEGER NOT NULL, successAt INTEGER, error TEXT, items INTEGER)`);
  run(`CREATE TABLE IF NOT EXISTS leveling_content_receipts(guildId TEXT NOT NULL,userId TEXT NOT NULL,
    contentHash TEXT NOT NULL,awardedAt INTEGER NOT NULL,PRIMARY KEY(guildId,userId,contentHash))`);
  run(`CREATE TABLE IF NOT EXISTS invite_corrections (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guildId TEXT NOT NULL, memberId TEXT NOT NULL,
    actorId TEXT NOT NULL, beforeJson TEXT NOT NULL, afterJson TEXT NOT NULL, reason TEXT NOT NULL, createdAt INTEGER NOT NULL)`);
}

module.exports = { migrateSelectedImprovements };
