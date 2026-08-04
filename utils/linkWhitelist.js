function parseStoredRoleIds(value) {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    // Accept comma-separated values saved by an older configuration.
  }

  return String(value).split(',').map(id => id.trim()).filter(Boolean);
}

function getLinkWhitelist(settings) {
  return [...new Set([
    settings?.linkBypassRoleId,
    ...parseStoredRoleIds(settings?.linkBypassRoleIds)
  ].filter(Boolean))];
}

function serializeLinkWhitelist(roleIds) {
  return JSON.stringify([...new Set(roleIds.map(String).filter(Boolean))]);
}

module.exports = {
  getLinkWhitelist,
  serializeLinkWhitelist
};
