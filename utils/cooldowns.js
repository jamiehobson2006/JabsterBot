const { get, run } = require('../database');

// ⚡ In-memory cache (guild-user-command)
const cache = new Map();

// 🧠 Key helper
function key(guildId, userId, command) {
  return `${guildId || 'dm'}:${userId}:${command}`;
}

// 🧠 Get last used (cache first, DB fallback)
async function getCooldown(guildId, userId, command) {
  const k = key(guildId, userId, command);

  if (cache.has(k)) {
    return cache.get(k);
  }

  const data = await get(
    `SELECT lastUsed FROM cooldowns WHERE guildId=? AND userId=? AND command=?`,
    [guildId || 'dm', userId, command]
  );

  const lastUsed = data?.lastUsed || 0;

  cache.set(k, lastUsed);
  return lastUsed;
}

// ⏱ Check cooldown
async function checkCooldown(guildId, userId, command, cooldownMs) {
  const lastUsed = await getCooldown(guildId, userId, command);
  const now = Date.now();

  if (!lastUsed) return 0;

  const remaining = cooldownMs - (now - lastUsed);
  return remaining > 0 ? remaining : 0;
}

// 💾 Set cooldown (cache + DB)
async function setCooldown(guildId, userId, command) {
  const now = Date.now();
  const k = key(guildId, userId, command);

  // ⚡ Update cache instantly
  cache.set(k, now);

  // 💾 Save async
  await run(
    `INSERT INTO cooldowns (guildId, userId, command, lastUsed)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(guildId, userId, command)
     DO UPDATE SET lastUsed = excluded.lastUsed`,
    [guildId || 'dm', userId, command, now]
  );
}

// ⚡ Combined helper (BEST to use)
async function useCooldown(guildId, userId, command, cooldownMs) {
  const remaining = await checkCooldown(guildId, userId, command, cooldownMs);

  if (remaining > 0) return remaining;

  await setCooldown(guildId, userId, command);
  return 0;
}

module.exports = {
  getCooldown,
  checkCooldown,
  setCooldown,
  useCooldown
};