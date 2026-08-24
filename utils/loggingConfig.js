const {
  all,
  get,
  run
} = require('../database');

const LOG_CATEGORIES = Object.freeze({
  MODERATION: {
    label: 'Moderation',
    description: 'Warnings, mutes, bans, cases, and moderation actions.',
    legacyColumn: 'modlogChannelId'
  },
  COMMANDS: {
    label: 'Commands',
    description: 'Commands that make a server change.',
    legacyColumn: 'commandLogChannelId'
  },
  MESSAGES: {
    label: 'Messages',
    description: 'Deleted, bulk-deleted, and edited messages.',
    legacyColumn: 'messageLogChannelId'
  },
  MEMBERS: {
    label: 'Members',
    description: 'Joins, leaves, nickname changes, and role changes.',
    legacyColumn: 'memberLogChannelId'
  },
  SERVER: {
    label: 'Server',
    description: 'Server, channel, role, permission, and emoji changes.',
    legacyColumn: 'serverLogChannelId'
  },
  VOICE: {
    label: 'Voice',
    description: 'Voice joins, leaves, moves, mutes, and deafens.',
    legacyColumn: 'voiceLogChannelId'
  },
  TICKETS: {
    label: 'Tickets',
    description: 'Ticket creation, claims, and closures.',
    legacyColumn: 'ticketLogChannelId'
  },
  SUGGESTIONS: {
    label: 'Suggestions',
    description: 'Suggestions accepted and denied by your team.',
    legacyColumn: 'suggestionLogChannelId'
  },
  INVITES: {
    label: 'Invites',
    description: 'Invite joins, leaves, and invite link changes.',
    legacyColumn: 'inviteChannelId'
  },
  REACTIONS: {
    label: 'Reactions',
    description: 'Member reactions added to and removed from messages.',
    legacyColumn: 'reactionLogChannelId'
  }
});

function getCategory(type) {
  return LOG_CATEGORIES[String(type || '').toUpperCase()] || null;
}

function listLogSettings(guildId) {
  return all(
    `SELECT type, channelId, enabled, color, style
     FROM log_settings
     WHERE guildId = ?`,
    [guildId]
  );
}

function getStoredLogSetting(guildId, type) {
  return get(
    `SELECT type, channelId, enabled, color, style
     FROM log_settings
     WHERE guildId = ?
     AND type = ?`,
    [guildId, String(type || '').toUpperCase()]
  );
}

function getLogDestination(guildId, type) {
  const normalizedType = String(type || '').toUpperCase();
  const category = getCategory(normalizedType);

  if (!category) {
    return {
      enabled: false,
      channelId: null,
      source: 'invalid'
    };
  }

  const stored = getStoredLogSetting(guildId, normalizedType);

  if (stored) {
    const presentation = {};

    if (stored.color) {
      presentation.color = stored.color;
    }

    if (stored.style && stored.style !== 'DEFAULT') {
      presentation.style = stored.style;
    }

    return {
      enabled: Boolean(stored.enabled),
      channelId: stored.enabled ? stored.channelId : null,
      ...presentation,
      source: 'configured'
    };
  }

  const settings = get(
    `SELECT ${category.legacyColumn}
     FROM guild_settings
     WHERE guildId = ?`,
    [guildId]
  );

  const channelId = settings?.[category.legacyColumn] || null;

  return {
    enabled: Boolean(channelId),
    channelId,
    source: channelId ? 'legacy' : 'unset'
  };
}

function getLogCategoryStates(guildId) {
  const recentLogs = all(
    `SELECT type, MAX(timestamp) AS lastLoggedAt
     FROM audit_logs
     WHERE guildId = ?
     AND type IS NOT NULL
     GROUP BY type`,
    [guildId]
  );

  const lastLoggedByType = new Map(
    recentLogs.map(log => [log.type, log.lastLoggedAt])
  );

  return Object.entries(LOG_CATEGORIES).map(([type, category]) => ({
    type,
    ...category,
    ...getLogDestination(guildId, type),
    lastLoggedAt: lastLoggedByType.get(type) || null
  }));
}

function getLastLogTimestamp(guildId, type) {
  const result = get(
    `SELECT MAX(timestamp) AS lastLoggedAt
     FROM audit_logs
     WHERE guildId = ?
     AND type = ?`,
    [guildId, String(type || '').toUpperCase()]
  );

  return result?.lastLoggedAt || null;
}

function setLogDestination({ guildId, type, channelId }) {
  const normalizedType = String(type || '').toUpperCase();

  if (!getCategory(normalizedType)) {
    throw new Error('Invalid logging category.');
  }

  return run(
    `INSERT INTO log_settings (guildId, type, channelId, enabled)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(guildId, type)
     DO UPDATE SET channelId = excluded.channelId,
                   enabled = 1`,
    [guildId, normalizedType, channelId]
  );
}

function disableLogCategory({ guildId, type }) {
  const normalizedType = String(type || '').toUpperCase();
  const destination = getLogDestination(guildId, normalizedType);

  if (!getCategory(normalizedType)) {
    throw new Error('Invalid logging category.');
  }

  return run(
    `INSERT INTO log_settings (guildId, type, channelId, enabled)
     VALUES (?, ?, ?, 0)
     ON CONFLICT(guildId, type)
     DO UPDATE SET enabled = 0`,
    [guildId, normalizedType, destination.channelId || '']
  );
}

function setLogPresentation({ guildId, type, color, style }) {
  const normalizedType = String(type || '').toUpperCase();

  if (!getCategory(normalizedType)) {
    throw new Error('Invalid logging category.');
  }

  const destination = getLogDestination(guildId, normalizedType);
  const normalizedStyle = ['DEFAULT', 'BRANDED', 'COMPACT'].includes(style)
    ? style
    : 'DEFAULT';

  return run(
    `INSERT INTO log_settings (
       guildId, type, channelId, enabled, color, style
     )
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(guildId, type)
     DO UPDATE SET color = excluded.color,
                   style = excluded.style`,
    [
      guildId,
      normalizedType,
      destination.channelId || '',
      destination.enabled ? 1 : 0,
      color || null,
      normalizedStyle
    ]
  );
}

function addLoggingManagerRole({ guildId, roleId, addedBy }) {
  return run(
    `INSERT OR IGNORE INTO logging_manager_roles (
       guildId,
       roleId,
       addedBy,
       addedAt
     )
     VALUES (?, ?, ?, ?)`,
    [guildId, roleId, addedBy, Date.now()]
  );
}

function removeLoggingManagerRole({ guildId, roleId }) {
  return run(
    `DELETE FROM logging_manager_roles
     WHERE guildId = ?
     AND roleId = ?`,
    [guildId, roleId]
  );
}

function listLoggingManagerRoles(guildId) {
  return all(
    `SELECT roleId, addedBy, addedAt
     FROM logging_manager_roles
     WHERE guildId = ?
     ORDER BY addedAt ASC`,
    [guildId]
  );
}

function memberCanManageLogging(member, guildId) {
  if (!member?.roles?.cache) {
    return false;
  }

  return listLoggingManagerRoles(guildId)
    .some(manager => member.roles.cache.has(manager.roleId));
}

module.exports = {
  LOG_CATEGORIES,
  addLoggingManagerRole,
  disableLogCategory,
  getCategory,
  getLogCategoryStates,
  getLogDestination,
  getLastLogTimestamp,
  listLoggingManagerRoles,
  listLogSettings,
  memberCanManageLogging,
  removeLoggingManagerRole,
  setLogPresentation,
  setLogDestination
};
