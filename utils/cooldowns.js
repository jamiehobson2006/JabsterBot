const { get, run } = require('../database');

// ⚡ In-memory cache (guild-user-command)
const cache = new Map();

// 🧠 Key helper
function key(guildId, userId, command) {
  return `${guildId || 'dm'}:${userId}:${command}`;
}

// 🧠 Get last used (cache first, DB fallback)
function getCooldown(guildId, userId, command) {
  const k = key(guildId, userId, command);

  if (cache.has(k)) {
    return cache.get(k);
  }

  const data = get(
    `SELECT lastUsed FROM cooldowns WHERE guildId=? AND userId=? AND command=?`,
    [guildId || 'dm', userId, command]
  );

  if (!data) return 0;

  cache.set(k, data.lastUsed);
  return data.lastUsed;
}

// ⏱ Check cooldown
function checkCooldown(guildId, userId, command, cooldownMs) {
  const lastUsed = getCooldown(guildId, userId, command);
  const now = Date.now();

  if (!lastUsed) return 0;

  const remaining = cooldownMs - (now - lastUsed);
  return remaining > 0 ? remaining : 0;
}

// 💾 Set cooldown (cache + DB)
function setCooldown(guildId, userId, command) {
  const now = Date.now();
  const k = key(guildId, userId, command);

  // ⚡ Update cache instantly
  cache.set(k, now);

  // 💾 Save async (non-blocking)
  run(
    `INSERT INTO cooldowns (guildId, userId, command, lastUsed)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(guildId, userId, command)
     DO UPDATE SET lastUsed = excluded.lastUsed`,
    [guildId || 'dm', userId, command, now]
  );
}

// ⚡ Combined helper
function useCooldown(guildId, userId, command, cooldownMs) {
  const remaining = checkCooldown(guildId, userId, command, cooldownMs);

  if (remaining > 0) return remaining;

  setCooldown(guildId, userId, command);
  return 0;
}

module.exports = {
  getCooldown,
  checkCooldown,
  setCooldown,
  useCooldown
};