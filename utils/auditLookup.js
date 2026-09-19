const auditUsage = new Map();
const AUDIT_USAGE_TTL_MS = 15000;

const auditCleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, value] of auditUsage) {
    if (!value || value.expiresAt <= now) auditUsage.delete(key);
  }
}, 30000);
auditCleanup.unref?.();

function auditChannelId(entry) {
  return entry?.extra?.channel?.id || entry?.extra?.channelId || null;
}

function takeAuditEntry(entry, requestedCount = 1) {
  const key = entry.id || `${entry.action}:${entry.createdTimestamp}:${entry.executor?.id || 'unknown'}`;
  const now = Date.now();
  const previous = auditUsage.get(key);
  const available = previous && previous.expiresAt > now
    ? previous.remaining
    : Math.max(Number(entry.extra?.count || requestedCount || 1), 1);

  if (available <= 0) return false;
  auditUsage.set(key, {
    remaining: available - 1,
    expiresAt: now + AUDIT_USAGE_TTL_MS
  });
  return true;
}

async function findRecentAuditLog(
  guild,
  type,
  targetId,
  options = {}
) {

  async function lookup() {
    const logs = await guild.fetchAuditLogs({ type, limit: 25 });
    const now = Date.now();

    return logs.entries.find(entry => {

      const possibleTargetIds = [
        entry.targetId,
        entry.target?.id,
        entry.target?.code
      ].filter(Boolean);

      const channelMatches = !options.channelId ||
        auditChannelId(entry) === options.channelId;
      const countMatches = !options.count ||
        Number(entry.extra?.count || 0) === Number(options.count);
      const matches = (
        (!targetId || possibleTargetIds.includes(targetId)) &&
        channelMatches &&
        countMatches &&
        now - entry.createdTimestamp < 15000
      );

      return matches && takeAuditEntry(entry, options.count);
    }) || null;
  }

  try {
    const immediate = await lookup();
    if (immediate || options.retry === false) return immediate;

    await new Promise(resolve => setTimeout(resolve, 750));
    return await lookup();

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
