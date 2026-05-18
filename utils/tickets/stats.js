const {
  get,
  run,
  all
} = require('../../database');

// ==================================================
// 👮 CREATE STAFF ENTRY
// ==================================================
function ensureStaffEntry(
  guildId,
  userId
) {

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
}

// ==================================================
// 👮 ADD CLAIM
// ==================================================
function addClaim(
  guildId,
  userId
) {

  ensureStaffEntry(
    guildId,
    userId
  );

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
}

// ==================================================
// 🔒 ADD CLOSE
// ==================================================
function addClose(
  guildId,
  userId
) {

  ensureStaffEntry(
    guildId,
    userId
  );

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
}

// ==================================================
// 💬 ADD STAFF MESSAGE
// ==================================================
function addMessage(
  guildId,
  userId
) {

  ensureStaffEntry(
    guildId,
    userId
  );

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
}

// ==================================================
// ⏱ ADD HANDLE TIME
// ==================================================
function addHandleTime(
  guildId,
  userId,
  milliseconds
) {

  ensureStaffEntry(
    guildId,
    userId
  );

  run(

    `UPDATE ticket_stats

     SET totalHandleTime =
         totalHandleTime + ?

     WHERE guildId = ?
     AND userId = ?`,

    [
      milliseconds,
      guildId,
      userId
    ]
  );
}

// ==================================================
// 📊 GET STAFF STATS
// ==================================================
function getStaffStats(
  guildId,
  userId
) {

  ensureStaffEntry(
    guildId,
    userId
  );

  return get(

    `SELECT *
     FROM ticket_stats

     WHERE guildId = ?
     AND userId = ?`,

    [
      guildId,
      userId
    ]
  );
}

// ==================================================
// 🏆 GET LEADERBOARD
// ==================================================
function getLeaderboard(
  guildId,
  limit = 10
) {

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
      limit
    ]
  );
}

// ==================================================
// ⏱ FORMAT TIME
// ==================================================
function formatHandleTime(
  milliseconds
) {

  if (!milliseconds) {
    return '0m';
  }

  const totalSeconds =
    Math.floor(
      milliseconds / 1000
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

  const parts = [];

  if (days) {
    parts.push(`${days}d`);
  }

  if (hours) {
    parts.push(`${hours}h`);
  }

  if (minutes) {
    parts.push(`${minutes}m`);
  }

  return parts.join(' ') || '0m';
}

module.exports = {

  addClaim,

  addClose,

  addMessage,

  addHandleTime,

  getStaffStats,

  getLeaderboard,

  formatHandleTime
};