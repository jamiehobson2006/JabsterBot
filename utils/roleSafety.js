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
  PermissionFlagsBits.MentionEveryone,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageThreads,
  PermissionFlagsBits.ViewAuditLog,
  PermissionFlagsBits.ManageNicknames,
  PermissionFlagsBits.MuteMembers,
  PermissionFlagsBits.DeafenMembers,
  PermissionFlagsBits.MoveMembers,
  PermissionFlagsBits.ManageEvents,
  PermissionFlagsBits.ManageGuildExpressions,
  PermissionFlagsBits.ManageEmojisAndStickers
].filter(permission => permission !== undefined));

function automaticRoleSafetyIssue(guild, role) {
  const botMember = guild?.members?.me;
  const issue = (message, retryable = false) => ({ message, retryable });

  if (!role) return issue('That role no longer exists.');
  if (role.guild?.id && role.guild.id !== guild.id) return issue('That role belongs to another server.');
  if (role.id === guild.id) return issue('The @everyone role cannot be automated.');
  if (role.managed) return issue('Bot and integration roles cannot be automated.');
  if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return issue('I need Manage Roles permission.', true);
  }
  if (role.position >= botMember.roles.highest.position) {
    return issue('That role must be below my highest role.', true);
  }
  if (AUTOMATION_BLOCKED_PERMISSIONS.some(permission => role.permissions.has(permission))) {
    return issue('Roles with staff permissions (moderation, administration, or mentions) cannot be automated.');
  }
  for (const channel of guild.channels?.cache?.values?.() || []) {
    const overwrite = channel.permissionOverwrites?.cache?.get(role.id);
    if (overwrite && AUTOMATION_BLOCKED_PERMISSIONS.some(permission => overwrite.allow.has(permission))) {
      return issue('That role has staff permissions in a channel and cannot be automated.');
    }
  }

  return null;
}

function automaticRoleSafetyError(guild, role) {
  return automaticRoleSafetyIssue(guild, role)?.message || null;
}

module.exports = {
  AUTOMATION_BLOCKED_PERMISSIONS,
  automaticRoleSafetyIssue,
  automaticRoleSafetyError
};
