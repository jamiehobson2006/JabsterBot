const {
  all,
  get,
  run
} = require('../database');

const {
  hasWhitelistedRole,
  isWhitelistedChannel
} = require('./contentFilterWhitelist');

const runtime = new Map();

const BYPASS_TYPES = new Set([
  'ROLE',
  'CHANNEL',
  'CATEGORY'
]);

function getAntiSpamSettings(guildId) {
  return get(
    `SELECT *
     FROM antispam_settings
     WHERE guildId = ?`,
    [guildId]
  );
}

function listAntiSpamBypasses(guildId, type = null) {
  if (type) {
    return all(
      `SELECT *
       FROM antispam_bypasses
       WHERE guildId = ?
       AND type = ?
       ORDER BY addedAt ASC`,
      [guildId, type]
    );
  }

  return all(
    `SELECT *
     FROM antispam_bypasses
     WHERE guildId = ?
     ORDER BY type ASC, addedAt ASC`,
    [guildId]
  );
}

function addAntiSpamBypass({
  guildId,
  type,
  valueId,
  addedBy
}) {
  const normalizedType = String(type || '').toUpperCase();

  if (!BYPASS_TYPES.has(normalizedType)) {
    throw new Error('Invalid anti-spam bypass type.');
  }

  return run(
    `INSERT OR IGNORE INTO antispam_bypasses (
       guildId,
       type,
       valueId,
       addedBy,
       addedAt
     )
     VALUES (?, ?, ?, ?, ?)`,
    [guildId, normalizedType, valueId, addedBy, Date.now()]
  );
}

function removeAntiSpamBypass({ guildId, type, valueId }) {
  return run(
    `DELETE FROM antispam_bypasses
     WHERE guildId = ?
     AND type = ?
     AND valueId = ?`,
    [guildId, String(type || '').toUpperCase(), valueId]
  );
}

function antiSpamBypassLists(guildId) {
  const lists = {
    roles: [],
    channels: [],
    categories: []
  };

  for (const bypass of listAntiSpamBypasses(guildId)) {
    if (bypass.type === 'ROLE') lists.roles.push(bypass.valueId);
    if (bypass.type === 'CHANNEL') lists.channels.push(bypass.valueId);
    if (bypass.type === 'CATEGORY') lists.categories.push(bypass.valueId);
  }

  return lists;
}

function canBypassAntiSpam(message) {
  const lists = antiSpamBypassLists(message.guild.id);

  return hasWhitelistedRole(message.member, lists.roles) ||
    isWhitelistedChannel(message, lists.channels, lists.categories);
}

function normalizeMessage(content) {
  return String(content || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000);
}

function pruneTimestamps(timestamps, cutoff) {
  return timestamps.filter(timestamp => timestamp >= cutoff);
}

function getRuntimeEntry(guildId, userId) {
  const key = `${guildId}:${userId}`;
  const existing = runtime.get(key);

  if (existing) return existing;

  const entry = {
    messages: [],
    duplicates: new Map()
  };

  runtime.set(key, entry);
  return entry;
}

function countMentions(message) {
  return (
    (message.mentions?.users?.size || 0) +
    (message.mentions?.roles?.size || 0)
  );
}

function evaluateAntiSpam(message) {
  const settings = getAntiSpamSettings(message.guild.id);

  if (
    Number(settings?.enabled || 0) !== 1 ||
    canBypassAntiSpam(message)
  ) {
    return null;
  }

  const now = Date.now();
  const entry = getRuntimeEntry(message.guild.id, message.author.id);
  const rateCutoff = now - Number(settings.intervalSeconds) * 1000;
  const duplicateCutoff = now - Number(settings.duplicateWindowSeconds) * 1000;

  entry.messages = pruneTimestamps(entry.messages, rateCutoff);
  entry.messages.push(now);

  const content = normalizeMessage(message.content);

  if (content) {
    const history = pruneTimestamps(
      entry.duplicates.get(content) || [],
      duplicateCutoff
    );

    history.push(now);
    entry.duplicates.set(content, history);

    if (history.length >= Number(settings.duplicateLimit)) {
      return {
        rule: 'DUPLICATE_MESSAGES',
        detail: `${history.length} matching messages in ${settings.duplicateWindowSeconds}s`,
        settings
      };
    }
  }

  if (
    Number(settings.mentionLimit || 0) > 0 &&
    countMentions(message) >= Number(settings.mentionLimit)
  ) {
    return {
      rule: 'MENTION_SPAM',
      detail: `${countMentions(message)} mentions in one message`,
      settings
    };
  }

  if (entry.messages.length >= Number(settings.maxMessages)) {
    return {
      rule: 'MESSAGE_FLOOD',
      detail: `${entry.messages.length} messages in ${settings.intervalSeconds}s`,
      settings
    };
  }

  return null;
}

function clearAntiSpamRuntime(guildId, userId) {
  runtime.delete(`${guildId}:${userId}`);
}

module.exports = {
  BYPASS_TYPES,
  addAntiSpamBypass,
  antiSpamBypassLists,
  canBypassAntiSpam,
  clearAntiSpamRuntime,
  evaluateAntiSpam,
  getAntiSpamSettings,
  listAntiSpamBypasses,
  removeAntiSpamBypass
};
