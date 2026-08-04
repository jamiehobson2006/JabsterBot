const {
  PermissionFlagsBits
} = require('discord.js');

function canManageApplications(member, creatorRoleId) {
  return Boolean(
    member?.permissions?.has(PermissionFlagsBits.Administrator) ||
    (
      creatorRoleId &&
      member?.roles?.cache?.has(creatorRoleId)
    )
  );
}

module.exports = {
  canManageApplications
};
