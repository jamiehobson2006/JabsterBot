const {
  get,
  run
} = require('../database');

const DEFAULT_CONFIG = {
  enabled: 1,
  xpMin: 15,
  xpMax: 25,
  cooldown: 60,
  levelChannelId: null,
  levelMessage: null,
  ignoredChannels: null,
  ignoredRoles: null,
  levelUpStyle: 'EMBED'
};

function parseIdList(value) {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return [...new Set(parsed.map(String).filter(Boolean))];
    }
  } catch {
    // Older settings use comma-separated IDs.
  }

  return [...new Set(String(value).split(',').map(id => id.trim()).filter(Boolean))];
}

function stringifyIdList(ids) {
  return JSON.stringify([...new Set(ids.map(String).filter(Boolean))]);
}

function getLevelingConfig(guildId) {
  let config = get('SELECT * FROM leveling_config WHERE guildId = ?', [guildId]);

  if (!config) {
    run('INSERT INTO leveling_config (guildId) VALUES (?)', [guildId]);
    config = get('SELECT * FROM leveling_config WHERE guildId = ?', [guildId]);
  }

  return {
    ...DEFAULT_CONFIG,
    ...config,
    levelUpStyle: ['EMBED', 'MESSAGE', 'OFF'].includes(config?.levelUpStyle)
      ? config.levelUpStyle
      : 'EMBED'
  };
}

module.exports = {
  DEFAULT_CONFIG,
  getLevelingConfig,
  parseIdList,
  stringifyIdList
};
