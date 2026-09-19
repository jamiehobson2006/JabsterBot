const {
  PermissionFlagsBits
} = require('discord.js');

const AUTOMATION_BLOCKED_PERMISSIONS = Object.freeze([
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.MentionEveryone
]);

function automaticRoleSafetyError(guild, role) {
  const botMember = guild?.members?.me;

  if (!role) return 'That role no longer exists.';
  if (role.id === guild.id) return 'The @everyone role cannot be automated.';
  if (role.managed) return 'Bot and integration roles cannot be automated.';
  if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return 'I need Manage Roles permission.';
  }
  if (role.position >= botMember.roles.highest.position) {
    return 'That role must be below my highest role.';
  }
  if (AUTOMATION_BLOCKED_PERMISSIONS.some(permission => role.permissions.has(permission))) {
    return 'Roles with moderation, administration, or mention permissions cannot be automated.';
  }

  return null;
}

module.exports = {
  AUTOMATION_BLOCKED_PERMISSIONS,
  automaticRoleSafetyError
};
