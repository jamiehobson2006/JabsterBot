const {
  get,
  run
} = require('../database');

// ==================================================
// ⚡ CACHE
// ==================================================
const cache =
  new Map();

// ==================================================
// ⏱ SETTINGS
// ==================================================
const CACHE_LIFETIME =
  1000 * 60 * 30;

const SWEEP_INTERVAL =
  1000 * 60 * 10;

// ==================================================
// 🧠 CACHE KEY
// ==================================================
function key(

  guildId,
  userId,
  command

) {

  return [

    guildId || 'dm',

    userId,

    command
  ].join(':');
}

// ==================================================
// 🧠 SAFE NUMBER
// ==================================================
function safeNumber(
  value,
  fallback = 0
) {

  const parsed =
    Number(value);

  if (
    Number.isNaN(parsed) ||
    !Number.isFinite(parsed)
  ) {

    return fallback;
  }

  return parsed;
}

// ==================================================
// 🧹 CACHE SWEEPER
// ==================================================
setInterval(() => {

  try {

    const now =
      Date.now();

    let cleaned = 0;

    for (
      const [k, data] of
      cache.entries()
    ) {

      // ==========================================
      // 🚫 INVALID CACHE
      // ==========================================
      if (
        !data ||
        typeof data !== 'object'
      ) {

        cache.delete(k);

        cleaned++;

        continue;
      }

      // ==========================================
      // ⏱ EXPIRED
      // ==========================================
      if (
        safeNumber(data.expires) <
        now
      ) {

        cache.delete(k);

        cleaned++;
      }
    }

    // ==========================================
    // 🧾 DEBUG
    // ==========================================
    if (

      cleaned > 0 &&

      process.env.NODE_ENV !==
      'production'
    ) {

      console.log(

        `🧹 Cooldown cache cleaned: ${cleaned}`
      );
    }

  } catch (err) {

    console.error(
      'Cooldown cache cleanup error:',
      err
    );
  }

}, SWEEP_INTERVAL);

// ==================================================
// 🧠 GET COOLDOWN
// ==================================================
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

  const cached =
    cache.get(k);

  // ==============================================
  // ⚡ CACHE HIT
  // ==============================================
  if (

    cached &&

    safeNumber(cached.expires) >
    Date.now()
  ) {

    return safeNumber(
      cached.lastUsed
    );
  }

  // ==============================================
  // 💾 DATABASE FALLBACK
  // ==============================================
  const data =
    await get(

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
    safeNumber(
      data?.lastUsed
    );

  // ==============================================
  // 💾 UPDATE CACHE
  // ==============================================
  cache.set(k, {

    lastUsed,

    expires:

      Date.now() +

      CACHE_LIFETIME
  });

  return lastUsed;
}

// ==================================================
// ⏱ CHECK COOLDOWN
// ==================================================
async function checkCooldown(

  guildId,
  userId,
  command,
  cooldownMs

) {

  const safeCooldown =
    Math.max(

      safeNumber(cooldownMs),

      0
    );

  // ==============================================
  // 🚫 NO COOLDOWN
  // ==============================================
  if (
    safeCooldown <= 0
  ) {

    return 0;
  }

  const lastUsed =
    await getCooldown(

      guildId,
      userId,
      command
    );

  // ==============================================
  // 🚫 UNUSED
  // ==============================================
  if (!lastUsed) {

    return 0;
  }

  const now =
    Date.now();

  const remaining =

    safeCooldown -

    (now - lastUsed);

  return Math.max(
    remaining,
    0
  );
}

// ==================================================
// 💾 SET COOLDOWN
// ==================================================
async function setCooldown(

  guildId,
  userId,
  command

) {

  const now =
    Date.now();

  const k = key(

    guildId,
    userId,
    command
  );

  // ==============================================
  // ⚡ UPDATE CACHE
  // ==============================================
  cache.set(k, {

    lastUsed: now,

    expires:

      now +

      CACHE_LIFETIME
  });

  // ==============================================
  // 💾 SAVE DATABASE
  // ==============================================
  await run(

    `INSERT INTO cooldowns

    (
      guildId,
      userId,
      command,
      lastUsed
    )

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

  return now;
}

// ==================================================
// ⚡ USE COOLDOWN
// ==================================================
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

  // ==============================================
  // ⏱ STILL ACTIVE
  // ==============================================
  if (
    remaining > 0
  ) {

    return remaining;
  }

  // ==============================================
  // 💾 APPLY COOLDOWN
  // ==============================================
  await setCooldown(

    guildId,
    userId,
    command
  );

  return 0;
}

// ==================================================
// 🗑 REMOVE COOLDOWN
// ==================================================
async function removeCooldown(

  guildId,
  userId,
  command

) {

  const k = key(

    guildId,
    userId,
    command
  );

  cache.delete(k);

  await run(

    `DELETE FROM cooldowns

     WHERE guildId = ?
     AND userId = ?
     AND command = ?`,

    [

      guildId || 'dm',

      userId,

      command
    ]
  );

  return true;
}

// ==================================================
// 🧹 CLEAR USER COOLDOWNS
// ==================================================
async function clearUserCooldowns(
  guildId,
  userId
) {

  const prefix =
    `${guildId || 'dm'}:${userId}:`;

  for (
    const k of cache.keys()
  ) {

    if (
      k.startsWith(prefix)
    ) {

      cache.delete(k);
    }
  }

  await run(

    `DELETE FROM cooldowns

     WHERE guildId = ?
     AND userId = ?`,

    [

      guildId || 'dm',

      userId
    ]
  );

  return true;
}

// ==================================================
// 📊 CACHE SIZE
// ==================================================
function getCooldownCacheSize() {

  return cache.size;
}

module.exports = {

  getCooldown,

  checkCooldown,

  setCooldown,

  useCooldown,

  removeCooldown,

  clearUserCooldowns,

  getCooldownCacheSize
};