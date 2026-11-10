const { all, get, run, transaction } = require('../database');

function safetyPolicy(guildId) {
  const row = get('SELECT * FROM safety_policies WHERE guildId=?',[guildId]);
  return row || { guildId,warningDecayDays:0,warningThresholds:'{"3":600,"5":3600}' };
}

function expireWarnings(guildId, now = Date.now()) {
  const days = safetyPolicy(guildId).warningDecayDays;
  if (!days) return 0;
  return transaction(() => {
    const rows = all(`SELECT userId,COUNT(*) AS count FROM cases WHERE guildId=? AND action='WARN'
      AND warningActive=1 AND COALESCE(createdAt,timestamp)<? GROUP BY userId`,[guildId,now-days*86400000]);
    for (const row of rows) run('UPDATE warns SET count=MAX(0,count-?) WHERE guildId=? AND userId=?',[row.count,guildId,row.userId]);
    run('DELETE FROM warns WHERE guildId=? AND count<=0',[guildId]);
    return run(`UPDATE cases SET warningActive=0 WHERE guildId=? AND action='WARN' AND warningActive=1
      AND COALESCE(createdAt,timestamp)<?`,[guildId,now-days*86400000]).changes;
  });
}

function warningTimeout(guildId, count) {
  let thresholds;
  try { thresholds = JSON.parse(safetyPolicy(guildId).warningThresholds); } catch { thresholds = {}; }
  const seconds = thresholds[String(count)];
  return Number.isInteger(seconds) && seconds > 0 && seconds <= 2419200 ? seconds*1000 : null;
}
function warningPreview(guildId,userId,now=Date.now()) {
  const policy=safetyPolicy(guildId);
  const total=get('SELECT count FROM warns WHERE guildId=? AND userId=?',[guildId,userId])?.count || 0;
  const expired=policy.warningDecayDays?get(`SELECT COUNT(*) AS count FROM cases WHERE guildId=? AND userId=? AND action='WARN'
    AND warningActive=1 AND COALESCE(createdAt,timestamp)<?`,[guildId,userId,now-policy.warningDecayDays*86400000]).count:0;
  const active=Math.max(0,total-expired);
  return {active,expiresOnNextCheck:expired,nextCount:active+1,timeoutMs:warningTimeout(guildId,active+1)};
}

function saveSafetyPolicy(guildId, values, actorId) {
  const before = safetyPolicy(guildId);
  const days = values.warningDecayDays ?? before.warningDecayDays;
  if (!Number.isInteger(days) || days < 0 || days > 3650) throw new Error('Warning decay must be 0-3650 days.');
  const thresholds = values.thresholds ?? JSON.parse(before.warningThresholds);
  if (!thresholds || Array.isArray(thresholds) || Object.entries(thresholds).some(([count,seconds]) =>
    !/^[1-9]\d{0,2}$/.test(count) || !Number.isInteger(seconds) || seconds < 1 || seconds > 2419200)) {
    throw new Error('Warning thresholds must map counts 1-999 to timeout seconds 1-2419200.');
  }
  run(`INSERT INTO safety_policies(guildId,warningDecayDays,warningThresholds,updatedBy,updatedAt) VALUES(?,?,?,?,?)
    ON CONFLICT(guildId) DO UPDATE SET warningDecayDays=excluded.warningDecayDays,
    warningThresholds=excluded.warningThresholds,updatedBy=excluded.updatedBy,updatedAt=excluded.updatedAt`,
  [guildId,days,JSON.stringify(thresholds),actorId,Date.now()]);
  return safetyPolicy(guildId);
}

module.exports = { expireWarnings, safetyPolicy, saveSafetyPolicy, warningTimeout,warningPreview };
