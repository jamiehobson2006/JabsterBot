function migrateCommunityExpansion(run, ensureColumn) {
  run(`CREATE TABLE IF NOT EXISTS help_views(id TEXT PRIMARY KEY,guildId TEXT NOT NULL,userId TEXT NOT NULL,
    query TEXT NOT NULL,includeLocked INTEGER NOT NULL,expiresAt INTEGER NOT NULL)`);
  run(`CREATE TABLE IF NOT EXISTS community_access(guildId TEXT NOT NULL,feature TEXT NOT NULL,
    managerRoleId TEXT,useRoleId TEXT,channelId TEXT,PRIMARY KEY(guildId,feature))`);
  run(`CREATE TABLE IF NOT EXISTS knowledge_articles(guildId TEXT NOT NULL,name TEXT NOT NULL,title TEXT NOT NULL,
    content TEXT NOT NULL,category TEXT NOT NULL DEFAULT 'general',readerRoleId TEXT,archived INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,updatedBy TEXT NOT NULL,updatedAt INTEGER NOT NULL,PRIMARY KEY(guildId,name))`);
  run(`CREATE TABLE IF NOT EXISTS knowledge_revisions(id INTEGER PRIMARY KEY AUTOINCREMENT,guildId TEXT NOT NULL,
    name TEXT NOT NULL,version INTEGER NOT NULL,title TEXT NOT NULL,content TEXT NOT NULL,updatedBy TEXT NOT NULL,updatedAt INTEGER NOT NULL)`);
  run(`CREATE TABLE IF NOT EXISTS community_challenges(id INTEGER PRIMARY KEY AUTOINCREMENT,guildId TEXT NOT NULL,
    name TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,goal INTEGER NOT NULL,progress INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ACTIVE',endsAt INTEGER,createdBy TEXT NOT NULL,createdAt INTEGER NOT NULL,UNIQUE(guildId,name))`);
  run(`CREATE TABLE IF NOT EXISTS challenge_contributions(id INTEGER PRIMARY KEY AUTOINCREMENT,challengeId INTEGER NOT NULL,
    guildId TEXT NOT NULL,userId TEXT NOT NULL,amount INTEGER NOT NULL,note TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING',
    requestId TEXT NOT NULL UNIQUE,reviewedBy TEXT,reviewReason TEXT,createdAt INTEGER NOT NULL)`);
  run(`CREATE TABLE IF NOT EXISTS partner_entries(guildId TEXT NOT NULL,name TEXT NOT NULL,userId TEXT NOT NULL,
    title TEXT NOT NULL,url TEXT NOT NULL,description TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING',reviewedBy TEXT,
    reason TEXT,ticketChannelId TEXT,createdAt INTEGER NOT NULL,updatedAt INTEGER NOT NULL,PRIMARY KEY(guildId,name))`);
  run(`CREATE TABLE IF NOT EXISTS temporary_role_allowlist(guildId TEXT NOT NULL,roleId TEXT NOT NULL,
    maxHours INTEGER NOT NULL DEFAULT 24,selfClaim INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(guildId,roleId))`);
  run(`CREATE TABLE IF NOT EXISTS temporary_role_jobs(id TEXT PRIMARY KEY,guildId TEXT NOT NULL,userId TEXT NOT NULL,
    roleId TEXT NOT NULL,actorId TEXT NOT NULL,selfClaim INTEGER NOT NULL DEFAULT 0,startsAt INTEGER NOT NULL,
    expiresAt INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'SCHEDULED',reason TEXT NOT NULL,lastError TEXT,
    nextAttemptAt INTEGER NOT NULL DEFAULT 0,resolutionActorId TEXT,resolutionReason TEXT,createdAt INTEGER NOT NULL)`);
  run(`CREATE UNIQUE INDEX IF NOT EXISTS temporary_role_active ON temporary_role_jobs(guildId,userId,roleId)
    WHERE status IN ('SCHEDULED','APPLYING','ACTIVE','REMOVING','REVIEW')`);
  run(`CREATE TABLE IF NOT EXISTS training_settings(guildId TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 0,
    trainerRoleId TEXT,traineeRoleId TEXT,reviewChannelId TEXT,title TEXT NOT NULL DEFAULT 'Moderator Training',
    passPercent INTEGER NOT NULL DEFAULT 80,questionCount INTEGER NOT NULL DEFAULT 5,maxAttempts INTEGER NOT NULL DEFAULT 3,
    cooldownMinutes INTEGER NOT NULL DEFAULT 60,attemptWindowDays INTEGER NOT NULL DEFAULT 7,
    requireReview INTEGER NOT NULL DEFAULT 1,showFeedback INTEGER NOT NULL DEFAULT 0,shuffle INTEGER NOT NULL DEFAULT 1)`);
  run(`CREATE TABLE IF NOT EXISTS training_scenarios(id INTEGER PRIMARY KEY AUTOINCREMENT,guildId TEXT NOT NULL,
    title TEXT NOT NULL,prompt TEXT NOT NULL,topic TEXT NOT NULL DEFAULT 'general',kind TEXT NOT NULL DEFAULT 'CHOICE',
    choicesJson TEXT NOT NULL DEFAULT '[]',expected TEXT NOT NULL,explanation TEXT NOT NULL,points INTEGER NOT NULL DEFAULT 1,
    enabled INTEGER NOT NULL DEFAULT 1,version INTEGER NOT NULL DEFAULT 1,updatedBy TEXT NOT NULL,updatedAt INTEGER NOT NULL)`);
  run(`CREATE TABLE IF NOT EXISTS training_sessions(id TEXT PRIMARY KEY,guildId TEXT NOT NULL,userId TEXT NOT NULL,
    assignedBy TEXT,questionsJson TEXT NOT NULL,answersJson TEXT NOT NULL DEFAULT '[]',settingsJson TEXT NOT NULL,
    nextQuestion INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'ACTIVE',score INTEGER NOT NULL DEFAULT 0,
    maxScore INTEGER NOT NULL,createdAt INTEGER NOT NULL,completedAt INTEGER,reviewedBy TEXT,reviewedAt INTEGER,feedback TEXT)`);
  run(`CREATE UNIQUE INDEX IF NOT EXISTS training_open_session ON training_sessions(guildId,userId)
    WHERE status IN ('ACTIVE','REVIEW')`);
  run(`CREATE TABLE IF NOT EXISTS training_attempt_resets(guildId TEXT NOT NULL,userId TEXT NOT NULL,
    resetAt INTEGER NOT NULL,resetBy TEXT NOT NULL,reason TEXT NOT NULL,PRIMARY KEY(guildId,userId))`);
  run(`CREATE TABLE IF NOT EXISTS social_digest_items(deliveryKey TEXT PRIMARY KEY,guildId TEXT NOT NULL,
    platform TEXT NOT NULL,creatorId TEXT NOT NULL,feedType TEXT NOT NULL,feedAddedAt INTEGER NOT NULL,
    channelId TEXT NOT NULL,title TEXT NOT NULL,url TEXT NOT NULL,createdAt INTEGER NOT NULL,batchKey TEXT,status TEXT NOT NULL DEFAULT 'PENDING')`);
  run(`CREATE TABLE IF NOT EXISTS free_game_routes(guildId TEXT NOT NULL,source TEXT NOT NULL,channelId TEXT,
    pingRoleId TEXT,pingMode TEXT NOT NULL DEFAULT 'INHERIT',enabled INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(guildId,source))`);
  for (const [table, column, definition] of [
    ['partner_entries','ticketChannelId','TEXT'],
    ['temporary_role_jobs','resolutionActorId','TEXT'],
    ['temporary_role_jobs','resolutionReason','TEXT'],
    ['social_channels','digestMinutes','INTEGER NOT NULL DEFAULT 0'],
    ['social_channels','lastDigestAt','INTEGER NOT NULL DEFAULT 0']
  ]) ensureColumn(table,column,definition);
}
module.exports = { migrateCommunityExpansion };
