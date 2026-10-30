// Only server-owned configuration belongs here. Runtime state and member content
// must never be imported, exported or restored by configuration tools.
const TABLES = {
  guild_settings: ['guildId','modlogChannelId','suggestionChannelId','acceptedSuggestionChannelId','deniedSuggestionChannelId',
    'transcriptChannelId','applicationTranscriptChannelId','ticketFeedbackChannelId','staffListChannelId','staffListRoleId',
    'applicationCreatorRoleId','inviteChannelId','giveawayChannelId','messageLogChannelId','commandLogChannelId',
    'memberLogChannelId','serverLogChannelId','voiceLogChannelId','ticketLogChannelId','suggestionLogChannelId',
    'reactionLogChannelId','staffRoleId','adminRoleId','giveawayRoleId','supportCategoryId','applicationCategoryId',
    'giveawayCategoryId','bugCategoryId','linkBlockEnabled','linkBypassRoleId','linkBypassRoleIds','linkBypassChannelIds',
    'linkBypassCategoryIds','censorEnabled','censorAntiRacismEnabled','censorRoleId','censorBypassRoleIds',
    'censorBypassChannelIds','censorBypassCategoryIds','censorMatchMode','censorAction'],
  ticket_settings: ['guildId','type','enabled','categoryId','roleId'],
  log_settings: ['guildId','type','channelId','enabled','color','style'],
  dailyfact_config: ['guildId','enabled','channelId','category','hour','minute','timezone'],
  daily_interaction_config: ['guildId','enabled','channelId','pingRoleId','hour','minute','timezone','titlePrefix','color','discussionEnabled'],
  daily_interaction_types: ['guildId','type','enabled','weight'],
  daily_interaction_day_themes: ['guildId','dayOfWeek','type'],
  daily_engagement_settings: ['guildId','quietDays','remindersEnabled','reminderDelayMinutes','dailyPointCap','triviaMinutes'],
  free_game_settings: ['guildId','enabled','channelId','pingRoleId','epicEnabled','steamEnabled','steamCountry'],
  leveling_config: ['guildId','enabled','xpMin','xpMax','cooldown','levelChannelId','levelMessage','permissionLevel','ignoredChannels','ignoredRoles','levelUpStyle'],
  leveling_rewards: ['guildId','level','roleId'],
  verification_settings: ['guildId','enabled','channelId','verifiedRoleId','unverifiedRoleId','minimumAccountAgeDays',
    'title','description','buttonLabel','buttonEmoji','buttonStyle','color','thumbnailUrl','imageUrl','footer'],
  greeting_settings: ['guildId','type','enabled','channelId','mode','customMessage','ping','title','color','imageUrl','milestoneInterval'],
  antispam_settings: ['guildId','enabled','managerRoleId','maxMessages','intervalSeconds','duplicateLimit','duplicateWindowSeconds','mentionLimit','timeoutSeconds'],
  antispam_bypasses: ['guildId','type','valueId'],
  social_links: ['guildId','name','url'],
  command_controls: ['guildId','commandName','enabled','reason'],
  command_control_bypasses: ['guildId','commandName','type','valueId'],
  logging_manager_roles: ['guildId','roleId'],
  suggestion_manager_roles: ['guildId','roleId'],
  censor_words: ['guildId','normalizedWord','word'],
  phishing_settings: ['guildId','enabled','alertChannelId'],
  phishing_allowlist: ['guildId','domain'],
  phishing_blocklist: ['guildId','domain'],
  modmail_settings: ['guildId','enabled','categoryId','staffRoleId','logChannelId'],
  staff_rota_settings: ['guildId','enabled','channelId','staffRoleId'],
  temp_voice_settings: ['guildId','enabled','lobbyChannelId','categoryId','nameTemplate','userLimit'],
  ticket_sla_settings: ['guildId','enabled','firstResponseMinutes','resolutionMinutes','alertChannelId','pingRoleId']
};

function configurationSpecs(all) {
  return Object.entries(TABLES).flatMap(([table, allowed]) => {
    const schema = all(`PRAGMA table_info(${table})`);
    if (!schema.length) return [];
    const columns = schema.filter(column => allowed.includes(column.name));
    const keys = schema.filter(column => column.pk).sort((a,b) => a.pk-b.pk).map(column => column.name);
    if (!keys.length || keys.some(key => !allowed.includes(key))) return [];
    return [{ table, columns, keys, schema }];
  });
}

function installConfigurationHistory(db, all) {
  db.exec(`CREATE TABLE IF NOT EXISTS configuration_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, revisionId TEXT NOT NULL, guildId TEXT NOT NULL,
    actorId TEXT, tableName TEXT NOT NULL, beforeJson TEXT, afterJson TEXT, changedAt INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS configuration_history_guild ON configuration_changes(guildId,id);
    CREATE TABLE IF NOT EXISTS configuration_plans (
    id TEXT PRIMARY KEY, guildId TEXT NOT NULL, actorId TEXT NOT NULL, baseHash TEXT NOT NULL,
    operationsJson TEXT NOT NULL, createdAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL, appliedAt INTEGER);`);
  for (const { table, columns } of configurationSpecs(all)) {
    const json = prefix => `json_object(${columns.map(c => `'${c.name}',${prefix}.${c.name}`).join(',')})`;
    for (const operation of ['INSERT','UPDATE','DELETE']) {
      const trigger = `configuration_${table}_${operation.toLowerCase()}`;
      db.exec(`DROP TRIGGER IF EXISTS ${trigger}`);
      const before = operation === 'INSERT' ? 'NULL' : json('OLD');
      const after = operation === 'DELETE' ? 'NULL' : json('NEW');
      const guild = operation === 'DELETE' ? 'OLD.guildId' : 'NEW.guildId';
      db.exec(`CREATE TRIGGER ${trigger} AFTER ${operation} ON ${table}
        ${operation === 'UPDATE' ? `WHEN ${before} IS NOT ${after}` : ''}
        BEGIN INSERT INTO configuration_changes(revisionId,guildId,actorId,tableName,beforeJson,afterJson,changedAt)
        VALUES(configuration_revision(),${guild},configuration_actor(),'${table}',${before},${after},
        CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)); END;`);
    }
  }
}

module.exports = { TABLES, configurationSpecs, installConfigurationHistory };
