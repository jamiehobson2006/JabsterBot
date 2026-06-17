async function findRecentAuditLog(
  guild,
  type,
  targetId
) {

  try {

    const logs =
      await guild.fetchAuditLogs({
        type,
        limit: 6
      });

    const now =
      Date.now();

    return logs.entries.find(entry => {

      const possibleTargetIds = [
        entry.targetId,
        entry.target?.id,
        entry.target?.code
      ].filter(Boolean);

      return (
        (!targetId || possibleTargetIds.includes(targetId)) &&
        now - entry.createdTimestamp < 10000
      );
    }) || null;

  } catch {

    return null;
  }
}

function formatExecutor(entry) {

  return entry?.executor
    ? `${entry.executor.tag}\n<@${entry.executor.id}>`
    : 'Unknown';
}

module.exports = {
  findRecentAuditLog,
  formatExecutor
};
