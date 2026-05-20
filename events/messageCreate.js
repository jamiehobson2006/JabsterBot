const {
  run,
  get
} = require('../database');

// ==================================================
// ⏱ MESSAGE COOLDOWN CACHE
// ==================================================
const messageCooldowns =
  new Map();

// ==================================================
// ⏱ RESET HELPERS
// ==================================================
function shouldResetDaily(lastReset) {

  const now =
    new Date();

  const last =
    new Date(lastReset);

  return (

    now.getUTCDate() !==
    last.getUTCDate() ||

    now.getUTCMonth() !==
    last.getUTCMonth() ||

    now.getUTCFullYear() !==
    last.getUTCFullYear()
  );
}

function shouldResetWeekly(lastReset) {

  // ================================================
  // 📅 MONDAY UTC RESET
  // ================================================
  const now =
    new Date();

  const last =
    new Date(lastReset);

  const nowWeek =
    getWeekStart(now);

  const lastWeek =
    getWeekStart(last);

  return (
    nowWeek.getTime() !==
    lastWeek.getTime()
  );
}

function shouldResetMonthly(lastReset) {

  const now =
    new Date();

  const last =
    new Date(lastReset);

  return (

    now.getUTCMonth() !==
    last.getUTCMonth() ||

    now.getUTCFullYear() !==
    last.getUTCFullYear()
  );
}

// ==================================================
// 📅 WEEK START
// ==================================================
function getWeekStart(date) {

  const d =
    new Date(date);

  const day =
    d.getUTCDay();

  const diff =
    day === 0
      ? -6
      : 1 - day;

  d.setUTCDate(
    d.getUTCDate() + diff
  );

  d.setUTCHours(
    0,
    0,
    0,
    0
  );

  return d;
}

module.exports = {

  name: 'messageCreate',

  async execute(message) {

    try {

      // ==========================================
      // 🚫 IGNORE BOTS / DMS
      // ==========================================
      if (
        !message.guild ||
        message.author.bot
      ) {

        return;
      }

      // ==========================================
      // 🚫 IGNORE EMPTY
      // ==========================================
      const hasContent =
        message.content &&
        message.content.trim();

      const hasAttachments =
        message.attachments?.size > 0;

      if (
        !hasContent &&
        !hasAttachments
      ) {

        return;
      }

      // ==========================================
      // 🚫 IGNORE COMMANDS
      // ==========================================
      if (
        message.content?.startsWith('/')
      ) {

        return;
      }

      const guildId =
        message.guild.id;

      const userId =
        message.author.id;

      const now =
        Date.now();

      // ==========================================
      // ⏱ ANTI-SPAM COOLDOWN
      // ==========================================
      const cooldownKey =
        `${guildId}:${userId}`;

      const lastMessage =
        messageCooldowns.get(
          cooldownKey
        );

      if (
        lastMessage &&
        now - lastMessage < 10000
      ) {

        return;
      }

      messageCooldowns.set(
        cooldownKey,
        now
      );

      // ==========================================
      // 🧹 CLEANUP CACHE
      // ==========================================
      setTimeout(() => {

        messageCooldowns.delete(
          cooldownKey
        );

      }, 15000);

      // ==========================================
      // 📊 FETCH STATS
      // ==========================================
      let stats =
        get(

          `SELECT *
           FROM message_stats
           WHERE guildId = ?
           AND userId = ?`,

          [

            guildId,

            userId
          ]
        );

      // ==========================================
      // 🆕 CREATE ENTRY
      // ==========================================
      if (!stats) {

        run(

          `INSERT INTO message_stats (

            guildId,
            userId,

            totalMessages,

            dailyMessages,
            weeklyMessages,
            monthlyMessages,

            lastDailyReset,
            lastWeeklyReset,
            lastMonthlyReset

          )

          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,

          [

            guildId,
            userId,

            1,

            1,
            1,
            1,

            now,
            now,
            now
          ]
        );

        return;
      }

      // ==========================================
      // 🔄 RESET CHECKS
      // ==========================================
      let daily =
        stats.dailyMessages || 0;

      let weekly =
        stats.weeklyMessages || 0;

      let monthly =
        stats.monthlyMessages || 0;

      let dailyReset =
        stats.lastDailyReset || 0;

      let weeklyReset =
        stats.lastWeeklyReset || 0;

      let monthlyReset =
        stats.lastMonthlyReset || 0;

      // ==========================================
      // 📅 DAILY RESET
      // ==========================================
      if (
        shouldResetDaily(
          dailyReset
        )
      ) {

        daily = 0;
        dailyReset = now;
      }

      // ==========================================
      // 📆 WEEKLY RESET
      // ==========================================
      if (
        shouldResetWeekly(
          weeklyReset
        )
      ) {

        weekly = 0;
        weeklyReset = now;
      }

      // ==========================================
      // 🗓 MONTHLY RESET
      // ==========================================
      if (
        shouldResetMonthly(
          monthlyReset
        )
      ) {

        monthly = 0;
        monthlyReset = now;
      }

      // ==========================================
      // 💾 UPDATE STATS
      // ==========================================
      run(

        `UPDATE message_stats

         SET

         totalMessages =
         totalMessages + 1,

         dailyMessages = ?,
         weeklyMessages = ?,
         monthlyMessages = ?,

         lastDailyReset = ?,
         lastWeeklyReset = ?,
         lastMonthlyReset = ?

         WHERE guildId = ?
         AND userId = ?`,

        [

          daily + 1,
          weekly + 1,
          monthly + 1,

          dailyReset,
          weeklyReset,
          monthlyReset,

          guildId,
          userId
        ]
      );

    } catch (err) {

      console.error(
        'Message Tracker Error:',
        err
      );
    }
  }
};