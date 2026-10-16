const {
  get,
  run,
  transaction
} = require('../database');

const pending = new Map();
const FLUSH_INTERVAL_MS = 2000;

function dayKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function weekKey(timestamp) {
  const date = new Date(timestamp);
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

function monthKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 7);
}

function queueMessageStat(guildId, userId, timestamp = Date.now()) {
  const key = `${guildId}:${userId}:${dayKey(timestamp)}`;
  const current = pending.get(key) || {
    guildId,
    userId,
    count: 0,
    firstAt: timestamp,
    lastAt: timestamp
  };
  current.count += 1;
  current.lastAt = Math.max(current.lastAt, timestamp);
  pending.set(key, current);
}

function flushMessageStats() {
  if (!pending.size) return 0;
  const batch = [...pending.values()].sort((left, right) => left.firstAt - right.firstAt);
  pending.clear();

  try {
    transaction(() => {
      for (const item of batch) {
        const row = get(
          'SELECT * FROM message_stats WHERE guildId = ? AND userId = ?',
          [item.guildId, item.userId]
        );
        const now = item.lastAt;

        if (!row) {
          run(
            `INSERT INTO message_stats (
               guildId, userId, totalMessages, dailyMessages, weeklyMessages,
               monthlyMessages, lastDailyReset, lastWeeklyReset, lastMonthlyReset
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              item.guildId,
              item.userId,
              item.count,
              item.count,
              item.count,
              item.count,
              now,
              now,
              now
            ]
          );
          continue;
        }

        const daily = dayKey(row.lastDailyReset || 0) === dayKey(now)
          ? Number(row.dailyMessages || 0) + item.count
          : item.count;
        const weekly = weekKey(row.lastWeeklyReset || 0) === weekKey(now)
          ? Number(row.weeklyMessages || 0) + item.count
          : item.count;
        const monthly = monthKey(row.lastMonthlyReset || 0) === monthKey(now)
          ? Number(row.monthlyMessages || 0) + item.count
          : item.count;

        run(
          `UPDATE message_stats
           SET totalMessages = totalMessages + ?,
               dailyMessages = ?,
               weeklyMessages = ?,
               monthlyMessages = ?,
               lastDailyReset = ?,
               lastWeeklyReset = ?,
               lastMonthlyReset = ?
           WHERE guildId = ? AND userId = ?`,
          [
            item.count,
            daily,
            weekly,
            monthly,
            dayKey(row.lastDailyReset || 0) === dayKey(now) ? row.lastDailyReset : now,
            weekKey(row.lastWeeklyReset || 0) === weekKey(now) ? row.lastWeeklyReset : now,
            monthKey(row.lastMonthlyReset || 0) === monthKey(now) ? row.lastMonthlyReset : now,
            item.guildId,
            item.userId
          ]
        );
      }
    });
  } catch (error) {
    for (const item of batch) {
      const key = `${item.guildId}:${item.userId}:${dayKey(item.firstAt)}`;
      const current = pending.get(key);
      if (current) {
        current.count += item.count;
        current.firstAt = Math.min(current.firstAt, item.firstAt);
        current.lastAt = Math.max(current.lastAt, item.lastAt);
      } else {
        pending.set(key, item);
      }
    }
    throw error;
  }

  return batch.reduce((total, item) => total + item.count, 0);
}

const flushInterval = setInterval(() => {
  try {
    flushMessageStats();
  } catch (error) {
    console.error('Message stats batch flush failed:', error);
  }
}, FLUSH_INTERVAL_MS);
flushInterval.unref?.();

module.exports = {
  flushMessageStats,
  queueMessageStat
};
