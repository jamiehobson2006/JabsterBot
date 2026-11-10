function migrateTrapChannel(run) {
  run(`CREATE TABLE IF NOT EXISTS trap_channel_settings (
    guildId TEXT PRIMARY KEY, channelId TEXT NOT NULL, inviteUrl TEXT NOT NULL,
    durationHours INTEGER NOT NULL DEFAULT 6, enabled INTEGER NOT NULL DEFAULT 0, warningMessageId TEXT,
    updatedBy TEXT NOT NULL, updatedAt INTEGER NOT NULL)`);
  run(`CREATE TABLE IF NOT EXISTS trap_channel_exempt_roles (
    guildId TEXT NOT NULL, roleId TEXT NOT NULL, PRIMARY KEY(guildId,roleId))`);
  run(`CREATE TABLE IF NOT EXISTS trap_channel_incidents (
    id TEXT PRIMARY KEY, guildId TEXT NOT NULL, userId TEXT NOT NULL,
    channelId TEXT NOT NULL, messageId TEXT NOT NULL, banReason TEXT NOT NULL,
    status TEXT NOT NULL, createdAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL, dmSent INTEGER NOT NULL DEFAULT 0,
    moderationRecordId TEXT, caseId INTEGER, lastError TEXT, nextAttemptAt INTEGER NOT NULL DEFAULT 0)`);
  run(`CREATE UNIQUE INDEX IF NOT EXISTS trap_channel_active_member
    ON trap_channel_incidents(guildId,userId)
    WHERE status IN ('PREPARING','BANNING','ACTIVE','RELEASING')`);
  run('CREATE INDEX IF NOT EXISTS trap_channel_due ON trap_channel_incidents(status,nextAttemptAt,expiresAt)');
}

module.exports = { migrateTrapChannel };
