const crypto = require('node:crypto');

const {
  all,
  get,
  run,
  transaction
} = require('../database');

const ACTIVE_TIMEOUT_ACTIONS = new Set(['MUTE', 'TIMEOUT', 'AUTO-TIMEOUT']);

function cleanError(error) {
  return String(error?.message || error || 'Unknown error').slice(0, 1000);
}

function beginModerationAction({
  guildId,
  userId,
  moderatorId,
  action,
  reason,
  duration = null,
  expiresAt = null,
  channelId = null
}) {
  const recordId = crypto.randomUUID();
  const now = Date.now();

  run(
    `INSERT INTO moderation_actions (
       recordId, guildId, userId, moderatorId, action, reason,
       duration, expiresAt, channelId, status, createdAt, updatedAt
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
    [
      recordId,
      guildId,
      userId,
      moderatorId,
      String(action).toUpperCase(),
      reason || 'No reason provided',
      duration,
      expiresAt,
      channelId,
      now,
      now
    ]
  );

  return get('SELECT * FROM moderation_actions WHERE recordId = ?', [recordId]);
}

function markDiscordApplied(recordId) {
  const now = Date.now();
  run(
    `UPDATE moderation_actions
     SET status = 'APPLIED', discordAppliedAt = ?, updatedAt = ?, error = NULL
     WHERE recordId = ? AND status IN ('PENDING', 'FAILED')`,
    [now, now, recordId]
  );
}

function markModerationFailed(recordId, error, applied = false) {
  run(
    `UPDATE moderation_actions
     SET status = ?, error = ?, attempts = attempts + 1, updatedAt = ?
     WHERE recordId = ?`,
    [applied ? 'APPLIED' : 'FAILED', cleanError(error), Date.now(), recordId]
  );
}

function completeModerationAction(recordId) {
  return transaction(() => {
    const row = get('SELECT * FROM moderation_actions WHERE recordId = ?', [recordId]);
    if (!row) throw new Error('Moderation action record not found.');
    if (row.caseId) return { record: row, caseId: Number(row.caseId), recovered: true };
    if (row.status !== 'APPLIED') {
      throw new Error(`Moderation action is not applied (${row.status}).`);
    }

    const now = Date.now();
    const actionAt = Number(row.discordAppliedAt || row.createdAt) || now;
    const result = run(
      `INSERT INTO cases (
         guildId, userId, moderatorId, action, reason, duration,
         expiresAt, channelId, timestamp, createdAt, actionRecordId
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.guildId,
        row.userId,
        row.moderatorId,
        row.action,
        row.reason,
        row.duration,
        row.expiresAt,
        row.channelId,
        actionAt,
        actionAt,
        row.recordId
      ]
    );
    const caseId = Number(result.lastInsertRowid);

    if (row.action === 'WARN') {
      run(
        `INSERT INTO warns (guildId, userId, count)
         VALUES (?, ?, 1)
         ON CONFLICT(guildId, userId) DO UPDATE SET count = count + 1`,
        [row.guildId, row.userId]
      );
    }

    if (ACTIVE_TIMEOUT_ACTIONS.has(row.action) && Number(row.expiresAt) > now) {
      run(
        `INSERT INTO active_timeouts (guildId, userId, caseId, expiresAt)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(guildId, userId) DO UPDATE SET
           caseId = excluded.caseId,
           expiresAt = excluded.expiresAt`,
        [row.guildId, row.userId, caseId, row.expiresAt]
      );
    }

    if (row.action === 'UNMUTE') {
      run(
        'DELETE FROM active_timeouts WHERE guildId = ? AND userId = ?',
        [row.guildId, row.userId]
      );
    }

    run(
      `UPDATE moderation_actions
       SET status = 'COMPLETED', caseId = ?, error = NULL, updatedAt = ?
       WHERE recordId = ?`,
      [caseId, now, row.recordId]
    );

    return {
      record: get('SELECT * FROM moderation_actions WHERE recordId = ?', [recordId]),
      caseId,
      recovered: false
    };
  });
}

async function performModerationAction(details, apply) {
  const record = beginModerationAction(details);
  let applied = false;

  try {
    await apply(record);
    applied = true;
    markDiscordApplied(record.recordId);
    return completeModerationAction(record.recordId);
  } catch (error) {
    try {
      markModerationFailed(record.recordId, error, applied);
    } catch (recordError) {
      console.error('Failed to update moderation action state:', recordError);
    }
    throw error;
  }
}

function recoverAppliedModerationActions(limit = 100) {
  const pending = all(
    `SELECT recordId
     FROM moderation_actions
     WHERE status = 'APPLIED'
     ORDER BY updatedAt ASC
     LIMIT ?`,
    [Math.min(Math.max(Number(limit) || 100, 1), 500)]
  );

  let recovered = 0;
  for (const row of pending) {
    try {
      completeModerationAction(row.recordId);
      recovered += 1;
    } catch (error) {
      markModerationFailed(row.recordId, error, true);
    }
  }
  return recovered;
}

module.exports = {
  beginModerationAction,
  completeModerationAction,
  markDiscordApplied,
  markModerationFailed,
  performModerationAction,
  recoverAppliedModerationActions
};
