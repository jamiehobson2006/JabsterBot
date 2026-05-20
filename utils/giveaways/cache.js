const {
  Collection
} = require('discord.js');

const {
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

// ==================================================
// 🧹 TEMP CACHE SWEEPER
// ==================================================
setInterval(() => {

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

        invite.uses || 0
      ]);
    }

    // ==============================================
    // 💾 SAVE DATABASE CACHE
    // ==============================================
    for (
      const update of dbUpdates
    ) {

      run(

        `INSERT INTO invite_cache

         (
           guildId,
           inviteCode,
           inviterId,
           uses
         )

         VALUES (?, ?, ?, ?)

         ON CONFLICT(guildId, inviteCode)

         DO UPDATE SET

           uses = excluded.uses,
           inviterId = excluded.inviterId`,

        update
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

// ==================================================
// 📥 GET GUILD INVITES
// ==================================================
function getGuildInvites(guildId) {

  return (

    cache.invites.get(guildId) ||

    new Collection()
  );
}

// ==================================================
// 🧠 FIND USED INVITE
// ==================================================
async function findUsedInvite(member) {

  try {

    const guild =
      member.guild;

    const oldInvites =
      getGuildInvites(
        guild.id
      );

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

    let usedInvite =
      null;

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
      if (
        newUses > oldUses
      ) {

        usedInvite = {

          code:
            invite.code,

          inviter:
            invite.inviter,

          inviterId:
            invite.inviter?.id || null,

          uses:
            newUses
        };

        break;
      }
    }

    // ==============================================
    // 🌟 VANITY INVITE SUPPORT
    // ==============================================
    if (!usedInvite) {

      try {

        const vanity =
          await guild.fetchVanityData()
            .catch(() => null);

        if (
          vanity?.code
        ) {

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
              true
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

    return usedInvite;

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
       uses
     )

     VALUES (?, ?, ?, ?)

     ON CONFLICT(guildId, inviteCode)

     DO UPDATE SET

       uses = excluded.uses,
       inviterId = excluded.inviterId`,

    [

      guildId,

      invite.code,

      invite.inviter?.id || null,

      invite.uses || 0
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

     SET uses = ?

     WHERE guildId = ?
     AND inviteCode = ?`,

    [

      uses,

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