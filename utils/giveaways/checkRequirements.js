const {
  get
} = require('../../database');

// ==================================================
// 🔢 SAFE NUMBER
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
// 🧠 CLEAN ARRAY
// ==================================================
function safeArray(value) {

  return Array.isArray(value)
    ? value
    : [];
}

function isSameUtcDay(first, second) {
  const left = new Date(Number(first) || 0);
  const right = new Date(Number(second) || Date.now());

  return left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth() &&
    left.getUTCDate() === right.getUTCDate();
}

function getUtcWeekKey(value) {
  const date = new Date(Number(value) || 0);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

function getCurrentMessageCounts(stats, now = Date.now()) {
  if (!stats) {
    return { total: 0, daily: 0, weekly: 0, monthly: 0 };
  }

  const current = new Date(now);
  const monthlyReset = new Date(Number(stats.lastMonthlyReset) || 0);

  return {
    total: safeNumber(stats.totalMessages),
    daily: isSameUtcDay(stats.lastDailyReset, now)
      ? safeNumber(stats.dailyMessages)
      : 0,
    weekly: getUtcWeekKey(stats.lastWeeklyReset) === getUtcWeekKey(now)
      ? safeNumber(stats.weeklyMessages)
      : 0,
    monthly: monthlyReset.getUTCFullYear() === current.getUTCFullYear() &&
      monthlyReset.getUTCMonth() === current.getUTCMonth()
      ? safeNumber(stats.monthlyMessages)
      : 0
  };
}

// ==================================================
// 🎯 REQUIREMENT ENGINE
// ==================================================
async function checkRequirements(

  member,
  requirements = {}

) {

  try {

    // ==========================================
    // 🚫 INVALID MEMBER
    // ==========================================
    if (!member) {

      return {

        success: false,

        reason:
          'Member not found.',

        failedRequirements: [

          'Member not found'
        ]
      };
    }

    const guild =
      member.guild;

    const user =
      member.user;

    // ==========================================
    // 📋 FAILED REQUIREMENTS
    // ==========================================
    const failed = [];

    // ==========================================
    // 🚫 REQUIRED ROLES
    // ==========================================
    const requiredRoles =
      safeArray(
        requirements.requiredRoles
      );

    if (
      requiredRoles.length
    ) {

      const hasRole =
        requiredRoles.some(

          roleId =>

            member.roles.cache.has(
              roleId
            )
        );

      if (!hasRole) {

        failed.push(
          'Missing required role'
        );
      }
    }

    // ==========================================
    // 🚫 BLACKLIST ROLES
    // ==========================================
    const blacklistedRoles =
      safeArray(
        requirements.blacklistedRoles
      );

    if (
      blacklistedRoles.length
    ) {

      const blacklisted =
        blacklistedRoles.some(

          roleId =>

            member.roles.cache.has(
              roleId
            )
        );

      if (blacklisted) {

        failed.push(
          'You have a blacklisted role'
        );
      }
    }

    // ==========================================
    // 📅 ACCOUNT AGE
    // ==========================================
    const accountAgeRequirement =
      safeNumber(
        requirements.accountAge
      );

    if (
      accountAgeRequirement > 0
    ) {

      const ageDays =
        Math.floor(

          (
            Date.now() -

            user.createdTimestamp
          ) /

          (1000 * 60 * 60 * 24)
        );

      if (
        ageDays <
        accountAgeRequirement
      ) {

        failed.push(

          `Account must be at least ` +

          `${accountAgeRequirement} day(s) old`
        );
      }
    }

    // ==========================================
    // 📥 SERVER AGE
    // ==========================================
    const serverAgeRequirement =
      safeNumber(
        requirements.serverAge
      );

    if (
      serverAgeRequirement > 0
    ) {

      // ======================================
      // 🚫 INVALID JOIN DATA
      // ======================================
      if (
        !member.joinedTimestamp
      ) {

        failed.push(
          'Unable to verify server join date'
        );

      } else {

        const joinedDays =
          Math.floor(

            (
              Date.now() -

              member.joinedTimestamp
            ) /

            (1000 * 60 * 60 * 24)
          );

        if (
          joinedDays <
          serverAgeRequirement
        ) {

          failed.push(

            `Must be in the server for at least ` +

            `${serverAgeRequirement} day(s)`
          );
        }
      }
    }

    // ==========================================
    // 📨 INVITE REQUIREMENT
    // ==========================================
    const minInvites =
      safeNumber(
        requirements.minInvites
      );

    if (
      minInvites > 0
    ) {

      const stats =
        get(

          `SELECT *
           FROM invite_stats
           WHERE guildId = ?
           AND userId = ?`,

          [

            guild.id,

            user.id
          ]
        );

      const invites =
        safeNumber(
          stats?.invites
        );

      const fake =
        safeNumber(
          stats?.fake
        );

      const leaves =
        safeNumber(
          stats?.leaves
        );

      const bonus =
        safeNumber(
          stats?.bonus
        );

      const realInvites =
        Math.max(

          invites -

          fake -

          leaves,

          0
        ) +

        bonus;

      if (
        realInvites <
        minInvites
      ) {

        failed.push(

          `Need at least ` +

          `${minInvites} invite(s)`
        );
      }
    }

    // ==========================================
    // 💬 MESSAGE REQUIREMENTS
    // ==========================================
    const totalRequirement =
      safeNumber(
        requirements.totalMessages
      );

    const dailyRequirement =
      safeNumber(
        requirements.dailyMessages
      );

    const weeklyRequirement =
      safeNumber(
        requirements.weeklyMessages
      );

    const monthlyRequirement =
      safeNumber(
        requirements.monthlyMessages
      );

    if (

      totalRequirement > 0 ||

      dailyRequirement > 0 ||

      weeklyRequirement > 0 ||

      monthlyRequirement > 0
    ) {

      const stats =
        get(

          `SELECT *
           FROM message_stats
           WHERE guildId = ?
           AND userId = ?`,

          [

            guild.id,

            user.id
          ]
        );

      const counts = getCurrentMessageCounts(stats);
      const { total, daily, weekly, monthly } = counts;

      // ======================================
      // TOTAL
      // ======================================
      if (
        total <
        totalRequirement
      ) {

        failed.push(

          `Need at least ` +

          `${totalRequirement} total messages`
        );
      }

      // ======================================
      // DAILY
      // ======================================
      if (
        daily <
        dailyRequirement
      ) {

        failed.push(

          `Need at least ` +

          `${dailyRequirement} messages today`
        );
      }

      // ======================================
      // WEEKLY
      // ======================================
      if (
        weekly <
        weeklyRequirement
      ) {

        failed.push(

          `Need at least ` +

          `${weeklyRequirement} weekly messages`
        );
      }

      // ======================================
      // MONTHLY
      // ======================================
      if (
        monthly <
        monthlyRequirement
      ) {

        failed.push(

          `Need at least ` +

          `${monthlyRequirement} monthly messages`
        );
      }
    }

    // ==========================================
    // 🚀 BOOSTER REQUIREMENT
    // ==========================================
    if (
      requirements.mustBoost
    ) {

      if (
        !member.premiumSince
      ) {

        failed.push(
          'Must be boosting the server'
        );
      }
    }

    // ==========================================
    // ❌ FAILED
    // ==========================================
    if (
      failed.length
    ) {

      return {

        success: false,

        failedRequirements:
          failed,

        reason:

          'You do not meet the giveaway requirements.\n\n' +

          failed

            .map(
              r => `• ${r}`
            )

            .join('\n')
      };
    }

    // ==========================================
    // ✅ SUCCESS
    // ==========================================
    return {

      success: true,

      bonusEntries:
        calculateBonusEntries(

          member,
          requirements
        )
    };

  } catch (err) {

    console.error(
      'Requirement Engine Error:',
      err
    );

    return {

      success: false,

      failedRequirements: [

        'Internal validation error'
      ],

      reason:
        'Failed to validate requirements.'
    };
  }
}

// ==================================================
// 🎁 BONUS ENTRIES
// ==================================================
function calculateBonusEntries(

  member,
  requirements
) {

  try {

    const bonusRoles =
      safeArray(
        requirements.bonusRoles
      );

    if (
      !bonusRoles.length
    ) {

      return 0;
    }

    let highestBonus =
      0;

    for (
      const role of
      bonusRoles
    ) {

      if (
        !role ||
        !role.roleId
      ) {

        continue;
      }

      // ==========================================
      // 🎯 HAS BONUS ROLE
      // ==========================================
      if (
        member.roles.cache.has(
          role.roleId
        )
      ) {

        const entries =
          safeNumber(
            role.entries
          );

        // ======================================
        // 🏆 HIGHEST BONUS ONLY
        // ======================================
        if (
          entries >
          highestBonus
        ) {

          highestBonus =
            entries;
        }
      }
    }

    // ==========================================
    // 🛡 BONUS CAP
    // ==========================================
    return Math.min(
      highestBonus,
      100
    );

  } catch {

    return 0;
  }
}

module.exports = {

  checkRequirements,

  calculateBonusEntries,
  getCurrentMessageCounts,

  safeNumber,

  safeArray
};
