const { get, run, transaction } = require('../database');

function clearWarnings(guildId, userId) {
  return transaction(() => {
    const count = Number(get('SELECT count FROM warns WHERE guildId=? AND userId=?', [guildId,userId])?.count) || 0;
    run("UPDATE cases SET warningActive=0 WHERE guildId=? AND userId=? AND UPPER(action)='WARN'", [guildId,userId]);
    run('DELETE FROM warns WHERE guildId=? AND userId=?', [guildId,userId]);
    return count;
  });
}

function revokeWarningCase(row) {
  if (row.warningActive !== 1 || String(row.action).toUpperCase() !== 'WARN') return;
  run('UPDATE warns SET count=MAX(count-1,0) WHERE guildId=? AND userId=?', [row.guildId,row.userId]);
  run('DELETE FROM warns WHERE guildId=? AND userId=? AND count<=0', [row.guildId,row.userId]);
}

module.exports = { clearWarnings, revokeWarningCase };
