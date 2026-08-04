function parseIdList(value) {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return [...new Set(parsed.map(String).filter(Boolean))];
    }
  } catch {
    // Older settings may use comma-separated IDs.
  }

  return [...new Set(String(value).split(',').map(id => id.trim()).filter(Boolean))];
}

function serializeIdList(ids) {
  return JSON.stringify([...new Set(ids.map(String).filter(Boolean))]);
}

function hasWhitelistedRole(member, roleIds) {
  return roleIds.some(roleId => member?.roles?.cache?.has(roleId));
}

function isWhitelistedChannel(message, channelIds, categoryIds) {
  return channelIds.includes(message.channel?.id) ||
    categoryIds.includes(message.channel?.parentId);
}

module.exports = {
  hasWhitelistedRole,
  isWhitelistedChannel,
  parseIdList,
  serializeIdList
};
