const {
  get,
  run,
  all
} = require('../../database');

// ==================================================
// 🧠 SAFE NUMBER
// ==================================================
function safeNumber(
  value,
  minimum = 0
) {

  const parsed =
    Number(value);

  if (
    Number.isNaN(parsed) ||
    !Number.isFinite(parsed)
  ) {

    return minimum;
  }

  return Math.max(
    parsed,
    minimum
  );
}

// ==================================================
// 🧠 SAFE LIMIT
// ==================================================
function safeLimit(
  value
) {

  return Math.min(

    Math.max(
      safeNumber(value, 10),
      1
    ),

    100
  );
}

// ==================================================
// 👮 CREATE STAFF ENTRY
// ==================================================
function ensureStaffEntry(
  guildId,
  userId
) {

  if (
    !guildId ||
    !userId
  ) {

    return false;
  }

  run(

    `INSERT INTO ticket_stats
     (
       guildId,
       userId,
       claims,
       closes,
       messages,
       totalHandleTime
     )

     VALUES (?, ?, 0, 0, 0, 0)

     ON CONFLICT(guildId, userId)

     DO NOTHING`,

    [

      guildId,
      userId
    ]
  );

  return true;
}

// ==================================================
// 👮 ADD CLAIM
// ==================================================
function addClaim(
  guildId,
  userId
) {

  if (
    !ensureStaffEntry(
      guildId,
      userId
    )
  ) {

    return false;
  }

  run(

    `UPDATE ticket_stats

     SET claims = claims + 1

     WHERE guildId = ?
     AND userId = ?`,

    [

      guildId,
      userId
    ]
  );

  return true;
}

// ==================================================
// 🔒 ADD CLOSE
// ==================================================
function addClose(
  guildId,
  userId
) {

  if (
    !ensureStaffEntry(
      guildId,
      userId
    )
  ) {

    return false;
  }

  run(

    `UPDATE ticket_stats

     SET closes = closes + 1

     WHERE guildId = ?
     AND userId = ?`,

    [

      guildId,
      userId
    ]
  );

  return true;
}

// ==================================================
// 💬 ADD STAFF MESSAGE
// ==================================================
function addMessage(
  guildId,
  userId
) {

  if (
    !ensureStaffEntry(
      guildId,
      userId
    )
  ) {

    return false;
  }

  run(

    `UPDATE ticket_stats

     SET messages = messages + 1

     WHERE guildId = ?
     AND userId = ?`,

    [

      guildId,
      userId
    ]
  );

  return true;
}

// ==================================================
// ⏱ ADD HANDLE TIME
// ==================================================
function addHandleTime(

  guildId,
  userId,
  milliseconds

) {

  if (
    !ensureStaffEntry(
      guildId,
      userId
    )
  ) {

    return false;
  }

  const safeMs =
    safeNumber(
      milliseconds
    );

  run(

    `UPDATE ticket_stats

     SET totalHandleTime =
         totalHandleTime + ?

     WHERE guildId = ?
     AND userId = ?`,

    [

      safeMs,

      guildId,

      userId
    ]
  );

  return true;
}

// ==================================================
// 📊 GET STAFF STATS
// ==================================================
function getStaffStats(
  guildId,
  userId
) {

  if (
    !guildId ||
    !userId
  ) {

    return null;
  }

  ensureStaffEntry(
    guildId,
    userId
  );

  const stats =
    get(

      `SELECT *
       FROM ticket_stats

       WHERE guildId = ?
       AND userId = ?`,

      [

        guildId,
        userId
      ]
    );

  if (!stats) {

    return null;
  }

  // ==============================================
  // 📈 CALCULATED DATA
  // ==============================================
  const closes =
    safeNumber(
      stats.closes
    );

  const totalHandleTime =
    safeNumber(
      stats.totalHandleTime
    );

  return {

    ...stats,

    claims:
      safeNumber(
        stats.claims
      ),

    closes,

    messages:
      safeNumber(
        stats.messages
      ),

    totalHandleTime,

    averageHandleTime:

      closes > 0

        ? Math.floor(
            totalHandleTime / closes
          )

        : 0
  };
}

// ==================================================
// 🏆 GET LEADERBOARD
// ==================================================
function getLeaderboard(

  guildId,
  limit = 10

) {

  if (!guildId) {

    return [];
  }

  return all(

    `SELECT *

     FROM ticket_stats

     WHERE guildId = ?

     ORDER BY claims DESC,
              closes DESC,
              messages DESC

     LIMIT ?`,

    [

      guildId,

      safeLimit(limit)
    ]
  );
}

// ==================================================
// ⏱ FORMAT TIME
// ==================================================
function formatHandleTime(
  milliseconds
) {

  const ms =
    safeNumber(
      milliseconds
    );

  if (
    ms <= 0
  ) {

    return '0m';
  }

  const totalSeconds =
    Math.floor(
      ms / 1000
    );

  const days =
    Math.floor(
      totalSeconds / 86400
    );

  const hours =
    Math.floor(
      (totalSeconds % 86400) / 3600
    );

  const minutes =
    Math.floor(
      (totalSeconds % 3600) / 60
    );

  const seconds =
    Math.floor(
      totalSeconds % 60
    );

  const parts = [];

  if (days) {

    parts.push(
      `${days}d`
    );
  }

  if (hours) {

    parts.push(
      `${hours}h`
    );
  }

  if (minutes) {

    parts.push(
      `${minutes}m`
    );
  }

  // ==============================================
  // ⏱ UNDER 1 MINUTE
  // ==============================================
  if (

    !days &&
    !hours &&
    !minutes
  ) {

    parts.push(
      `${seconds}s`
    );
  }

  return parts.join(' ') ||
    '0m';
}

// ==================================================
// 🧹 RESET STAFF STATS
// ==================================================
function resetStaffStats(
  guildId,
  userId
) {

  if (
    !guildId ||
    !userId
  ) {

    return false;
  }

  run(

    `UPDATE ticket_stats

     SET
       claims = 0,
       closes = 0,
       messages = 0,
       totalHandleTime = 0

     WHERE guildId = ?
     AND userId = ?`,

    [

      guildId,
      userId
    ]
  );

  return true;
}

// ==================================================
// 📊 GET GLOBAL TICKET STATS
// ==================================================
function getGlobalStats(
  guildId
) {

  if (!guildId) {

    return null;
  }

  return get(

    `SELECT

      SUM(claims) AS claims,
      SUM(closes) AS closes,
      SUM(messages) AS messages,
      SUM(totalHandleTime) AS totalHandleTime

     FROM ticket_stats

     WHERE guildId = ?`,

    [

      guildId
    ]
  );
}

module.exports = {

  ensureStaffEntry,

  addClaim,

  addClose,

  addMessage,

  addHandleTime,

  getStaffStats,

  getLeaderboard,

  formatHandleTime,

  resetStaffStats,

  getGlobalStats,

  safeNumber
};