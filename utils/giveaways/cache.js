const {
  Collection
} = require('discord.js');

const {
  all,
  run
} = require('../../database');

// ==================================================
// 📦 GLOBAL CACHE
// ==================================================
const cache = {

  // ================================================
  // 📨 INVITES
  // ================================================
  invites:
    new Collection(),

  // ================================================
  // 🎫 TICKETS
  // ================================================
  tickets:
    new Collection(),

  // ================================================
  // ⚡ TEMP RUNTIME
  // ================================================
  temp:
    new Collection()
};

// ==================================================
// ⏱ TEMP CACHE TTL
// ==================================================
const TEMP_TTL =
  1000 * 60 * 30;

const VANITY_CACHE_CODE = '__VANITY__';
const inviteLookupQueues = new Map();

// ==================================================
// 🧹 TEMP CACHE SWEEPER
// ==================================================
const tempCacheCleanupInterval = setInterval(() => {

  try {

    const now =
      Date.now();

    let cleaned = 0;

    for (
      const [key, value] of
      cache.temp.entries()
    ) {

      if (
        !value ||
        typeof value !== 'object'
      ) {

        cache.temp.delete(key);

        cleaned++;

        continue;
      }

      const createdAt =
        value.createdAt || 0;

      if (
        now - createdAt >
        TEMP_TTL
      ) {

        cache.temp.delete(key);

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

        `🧹 Cleaned ${cleaned} temp cache entries`
      );
    }

  } catch (err) {

    console.error(
      'Temp cache cleanup error:',
      err
    );

  }

}, 1000 * 60 * 5);

// Cache eviction is maintenance only. It must not keep deployment scripts,
// migrations, or the test runner alive after their real work has finished.
tempCacheCleanupInterval.unref?.();

// ==================================================
// 📨 LOAD GUILD INVITES
// ==================================================
async function loadGuildInvites(guild) {

  try {

    const invites =
      await guild.invites.fetch();

    const guildCache =
      new Collection();

    // ==============================================
    // 📦 BATCH DATABASE VALUES
    // ==============================================
    const dbUpdates = [];

    for (
      const invite of
      invites.values()
    ) {

      const inviteData = {

        code:
          invite.code,

        uses:
          invite.uses || 0,

        inviterId:
          invite.inviter?.id || null,

        inviterTag:
          invite.inviter?.tag || 'Unknown',

        createdAt:
          invite.createdTimestamp ||

          Date.now()
      };

      guildCache.set(
        invite.code,
        inviteData
      );

      dbUpdates.push([

        guild.id,

        invite.code,

        invite.inviter?.id || null,

        invite.uses || 0,

        Date.now()
      ]);
    }

    // ==============================================
    // 💾 SAVE DATABASE CACHE
    // ==============================================
    // Keep the persisted snapshot identical to Discord's current invite list.
    // This removes invites deleted while the bot was offline before the next
    // member join needs to compare invite-use counts.
    run(
      `DELETE FROM invite_cache
       WHERE guildId = ?`,
      [guild.id]
    );

    for (
      const update of dbUpdates
    ) {

      run(

        `INSERT INTO invite_cache

         (
           guildId,
           inviteCode,
           inviterId,
           uses,
           updatedAt
         )

         VALUES (?, ?, ?, ?, ?)

         ON CONFLICT(guildId, inviteCode)

         DO UPDATE SET

           uses = excluded.uses,
           inviterId = excluded.inviterId,
           updatedAt = excluded.updatedAt`,

        update
      );
    }

    const vanity = await guild.fetchVanityData().catch(() => null);
    if (vanity?.code) {
      const vanityData = {
        code: vanity.code,
        uses: vanity.uses || 0,
        inviterId: null,
        inviterTag: 'Vanity URL',
        vanity: true,
        createdAt: Date.now()
      };

      guildCache.set(VANITY_CACHE_CODE, vanityData);
      run(
        `INSERT INTO invite_cache (guildId, inviteCode, inviterId, uses, updatedAt)
         VALUES (?, ?, NULL, ?, ?)
         ON CONFLICT(guildId, inviteCode)
         DO UPDATE SET uses = excluded.uses, updatedAt = excluded.updatedAt`,
        [guild.id, VANITY_CACHE_CODE, vanityData.uses, Date.now()]
      );
    }

    // ==============================================
    // 💾 UPDATE MEMORY CACHE
    // ==============================================
    cache.invites.set(
      guild.id,
      guildCache
    );

    // ==============================================
    // 🧾 DEBUG LOG
    // ==============================================
    if (
      process.env.NODE_ENV !==
      'production'
    ) {

      console.log(

        `📨 Cached ${guildCache.size} invites ` +

        `for ${guild.name}`
      );
    }

    return guildCache;

  } catch (err) {

    console.error(

      `❌ Failed to cache invites for ${guild.name}:`,

      err
    );

    return null;
  }
}

function hydrateGuildInvites(guildId) {
  if (cache.invites.has(guildId)) {
    return cache.invites.get(guildId);
  }

  const guildCache = new Collection();
  const rows = all(
    `SELECT guildId, inviteCode, inviterId, uses
     FROM invite_cache
     WHERE guildId = ?`,
    [guildId]
  );

  for (const row of rows) {
    guildCache.set(row.inviteCode, {
      code: row.inviteCode === VANITY_CACHE_CODE ? 'vanity' : row.inviteCode,
      uses: Number(row.uses) || 0,
      inviterId: row.inviterId || null,
      inviterTag: row.inviteCode === VANITY_CACHE_CODE ? 'Vanity URL' : 'Unknown',
      vanity: row.inviteCode === VANITY_CACHE_CODE,
      createdAt: Date.now()
    });
  }

  cache.invites.set(guildId, guildCache);
  return guildCache;
}

// ==================================================
// 📥 GET GUILD INVITES
// ==================================================
function getGuildInvites(guildId) {

  return (

    cache.invites.get(guildId) ||
    hydrateGuildInvites(guildId)
  );
}

// ==================================================
// 🧠 FIND USED INVITE
// ==================================================
async function findUsedInvite(member) {
  const guildId = member?.guild?.id;
  if (!guildId) return null;

  const previous = inviteLookupQueues.get(guildId) || Promise.resolve();
  const current = previous
    .catch(() => null)
    .then(() => findUsedInviteInternal(member));

  inviteLookupQueues.set(guildId, current);
  try {
    return await current;
  } finally {
    if (inviteLookupQueues.get(guildId) === current) {
      inviteLookupQueues.delete(guildId);
    }
  }
}

async function findUsedInviteInternal(member) {

  try {

    const guild =
      member.guild;

    const hadMemoryBaseline = cache.invites.has(guild.id);
    const oldInvites =
      getGuildInvites(
        guild.id
      );
    const canAttributeFromBaseline = hadMemoryBaseline || oldInvites.size > 0;

    let newInvites;

    // ==============================================
    // 📡 FETCH NEW INVITES
    // ==============================================
    try {

      newInvites =
        await guild.invites.fetch();

    } catch (err) {

      console.error(
        'Failed fetching invites:',
        err
      );

      return null;
    }

    const changedInvites = [];

    // ==============================================
    // 🔍 FIND DIFFERENCE
    // ==============================================
    for (
      const invite of
      newInvites.values()
    ) {

      const cached =
        oldInvites.get(
          invite.code
        );

      const oldUses =
        cached?.uses || 0;

      const newUses =
        invite.uses || 0;

      // ==========================================
      // 🎯 USED INVITE FOUND
      // ==========================================
      if (newUses > oldUses) {
        changedInvites.push({

          code:
            invite.code,

          inviter:
            invite.inviter,

          inviterId:
            invite.inviter?.id || null,

          uses: newUses,
          delta: newUses - oldUses
        });
      }
    }

    let usedInvite = null;
    if (canAttributeFromBaseline && changedInvites.length === 1 && changedInvites[0].delta === 1) {
      usedInvite = {
        ...changedInvites[0],
        confidence: 'EXACT',
        source: 'INVITE'
      };
    } else if (changedInvites.length) {
      usedInvite = {
        code: 'Unknown',
        inviter: null,
        inviterId: null,
        uses: 0,
        confidence: 'AMBIGUOUS',
        source: 'INVITE'
      };
    }

    // ==============================================
    // 🌟 VANITY INVITE SUPPORT
    // ==============================================
    if (!usedInvite) {

      try {

        const vanity =
          await guild.fetchVanityData()
            .catch(() => null);

        const cachedVanity = oldInvites.get(VANITY_CACHE_CODE);
        if (canAttributeFromBaseline && vanity?.code && Number(vanity.uses || 0) > Number(cachedVanity?.uses || 0)) {

          usedInvite = {

            code:
              vanity.code,

            inviter:
              null,

            inviterId:
              null,

            uses:
              vanity.uses || 0,

            vanity:
              true,
            confidence: Number(vanity.uses || 0) - Number(cachedVanity?.uses || 0) === 1
              ? 'EXACT'
              : 'AMBIGUOUS',
            source: 'VANITY'
          };
        }

      } catch {}
    }

    // ==============================================
    // 🔄 REFRESH CACHE
    // ==============================================
    await loadGuildInvites(
      guild
    );

    return usedInvite || {
      code: 'Unknown',
      inviter: null,
      inviterId: null,
      uses: 0,
      confidence: 'UNKNOWN',
      source: 'UNKNOWN'
    };

  } catch (err) {

    console.error(
      '❌ Failed finding used invite:',
      err
    );

    return null;
  }
}

// ==================================================
// ➕ ADD INVITE
// ==================================================
function addInvite(
  guildId,
  invite
) {

  if (
    !cache.invites.has(guildId)
  ) {

    cache.invites.set(

      guildId,

      new Collection()
    );
  }

  const inviteData = {

    code:
      invite.code,

    uses:
      invite.uses || 0,

    inviterId:
      invite.inviter?.id || null,

    inviterTag:
      invite.inviter?.tag || 'Unknown',

    createdAt:
      invite.createdTimestamp ||

      Date.now()
  };

  cache.invites

    .get(guildId)

    .set(
      invite.code,
      inviteData
    );

  // ==============================================
  // 💾 DATABASE
  // ==============================================
  run(

    `INSERT INTO invite_cache

     (
       guildId,
       inviteCode,
       inviterId,
       uses,
       updatedAt
     )

     VALUES (?, ?, ?, ?, ?)

     ON CONFLICT(guildId, inviteCode)

       DO UPDATE SET

       uses = excluded.uses,
       inviterId = excluded.inviterId,
       updatedAt = excluded.updatedAt`,

    [

      guildId,

      invite.code,

      invite.inviter?.id || null,

       invite.uses || 0,

       Date.now()
    ]
  );
}

// ==================================================
// ➖ REMOVE INVITE
// ==================================================
function removeInvite(
  guildId,
  inviteCode
) {

  cache.invites
    .get(guildId)
    ?.delete(inviteCode);

  // ==============================================
  // 💾 DATABASE
  // ==============================================
  run(

    `DELETE FROM invite_cache

     WHERE guildId = ?
     AND inviteCode = ?`,

    [

      guildId,

      inviteCode
    ]
  );
}

// ==================================================
// 🔄 UPDATE INVITE USES
// ==================================================
function updateInviteUses(
  guildId,
  inviteCode,
  uses
) {

  const guildInvites =
    cache.invites.get(guildId);

  if (

    !guildInvites ||

    !guildInvites.has(inviteCode)
  ) {

    return;
  }

  const invite =
    guildInvites.get(
      inviteCode
    );

  invite.uses =
    uses;

  guildInvites.set(

    inviteCode,

    invite
  );

  // ==============================================
  // 💾 DATABASE
  // ==============================================
  run(

    `UPDATE invite_cache

     SET uses = ?,
         updatedAt = ?

     WHERE guildId = ?
     AND inviteCode = ?`,

    [

      uses,

      Date.now(),

      guildId,

      inviteCode
    ]
  );
}

// ==================================================
// ⚡ TEMP CACHE HELPERS
// ==================================================
function setTemp(
  key,
  value
) {

  cache.temp.set(
    key,
    {

      ...value,

      createdAt:
        Date.now()
    }
  );
}

function getTemp(
  key
) {

  return (
    cache.temp.get(key)
  );
}

function deleteTemp(
  key
) {

  return cache.temp.delete(
    key
  );
}

// ==================================================
// 🧹 CLEAR GUILD CACHE
// ==================================================
function clearGuildCache(
  guildId
) {

  cache.invites.delete(
    guildId
  );

  cache.tickets.delete(
    guildId
  );
}

// ==================================================
// 📦 EXPORTS
// ==================================================
module.exports = {

  cache,

  loadGuildInvites,

  hydrateGuildInvites,

  getGuildInvites,

  findUsedInvite,

  addInvite,

  removeInvite,

  updateInviteUses,

  setTemp,

  getTemp,

  deleteTemp,

  clearGuildCache
};
