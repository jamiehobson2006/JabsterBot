const {
  parseIdList,
  serializeIdList
} = require('./contentFilterWhitelist');

function getLinkWhitelist(settings) {
  return [...new Set([
    settings?.linkBypassRoleId,
    ...parseIdList(settings?.linkBypassRoleIds)
  ].filter(Boolean))];
}

function serializeLinkWhitelist(roleIds) {
  return serializeIdList(roleIds);
}

function getLinkChannelWhitelist(settings) {
  return parseIdList(settings?.linkBypassChannelIds);
}

function getLinkCategoryWhitelist(settings) {
  return parseIdList(settings?.linkBypassCategoryIds);
}

module.exports = {
  getLinkCategoryWhitelist,
  getLinkChannelWhitelist,
  getLinkWhitelist,
  serializeLinkWhitelist
};
