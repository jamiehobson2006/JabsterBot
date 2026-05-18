const { get, run } = require('../database');

// ========================
// ⚡ CACHE
// ========================
const cache = new Map();

// 🧹 Cache cleanup interval
const CACHE_LIFETIME = 1000 * 60 * 30; // 30 mins

// ========================
// 🧠 CACHE KEY
// ========================
function key(guildId, userId, command) {

  return `${guildId || 'dm'}:${userId}:${command}`;
}

// ========================
// 🧹 CACHE SWEEPER
// ========================
setInterval(() => {

  const now = Date.now();

  for (const [k, data] of cache.entries()) {

    if (data.expires < now) {
      cache.delete(k);
    }
  }

}, 1000 * 60 * 10); // every 10 mins

// ========================
// 🧠 GET COOLDOWN
// ========================
async function getCooldown(
  guildId,
  userId,
  command
) {

  const k = key(
    guildId,
    userId,
    command
  );

  const cached = cache.get(k);

  // ========================
  // ⚡ CACHE HIT
  // ========================
  if (cached) {

    return cached.lastUsed;
  }

  // ========================
  // 💾 DB FALLBACK
  // ========================
  const data = await get(

    `SELECT lastUsed
     FROM cooldowns

     WHERE guildId = ?
     AND userId = ?
     AND command = ?`,

    [
      guildId || 'dm',
      userId,
      command
    ]
  );

  const lastUsed =
    data?.lastUsed || 0;

  // ========================
  // 💾 STORE CACHE
  // ========================
  cache.set(k, {

    lastUsed,

    expires:
      Date.now() +
      CACHE_LIFETIME
  });

  return lastUsed;
}

// ========================
// ⏱ CHECK COOLDOWN
// ========================
async function checkCooldown(
  guildId,
  userId,
  command,
  cooldownMs
) {

  const lastUsed =
    await getCooldown(
      guildId,
      userId,
      command
    );

  if (!lastUsed) {
    return 0;
  }

  const now = Date.now();

  const remaining =
    cooldownMs -
    (now - lastUsed);

  return remaining > 0

    ? remaining

    : 0;
}

// ========================
// 💾 SET COOLDOWN
// ========================
async function setCooldown(
  guildId,
  userId,
  command
) {

  const now = Date.now();

  const k = key(
    guildId,
    userId,
    command
  );

  // ========================
  // ⚡ UPDATE CACHE
  // ========================
  cache.set(k, {

    lastUsed: now,

    expires:
      now + CACHE_LIFETIME
  });

  // ========================
  // 💾 SAVE DATABASE
  // ========================
  await run(

    `INSERT INTO cooldowns
    (guildId, userId, command, lastUsed)

    VALUES (?, ?, ?, ?)

    ON CONFLICT(guildId, userId, command)

    DO UPDATE SET
    lastUsed = excluded.lastUsed`,

    [
      guildId || 'dm',
      userId,
      command,
      now
    ]
  );
}

// ========================
// ⚡ USE COOLDOWN
// ========================
async function useCooldown(
  guildId,
  userId,
  command,
  cooldownMs
) {

  const remaining =
    await checkCooldown(

      guildId,
      userId,
      command,
      cooldownMs
    );

  if (remaining > 0) {
    return remaining;
  }

  await setCooldown(
    guildId,
    userId,
    command
  );

  return 0;
}

module.exports = {

  getCooldown,

  checkCooldown,

  setCooldown,

  useCooldown
};