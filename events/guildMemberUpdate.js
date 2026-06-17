const {
  AuditLogEvent
} = require('discord.js');

const {
  createAuditEmbed,
  logAudit
} = require('../utils/logger');

const {
  findRecentAuditLog,
  formatExecutor
} = require('../utils/auditLookup');

function formatMember(member) {

  return `${member.user.tag}\n<@${member.id}>`;
}

function formatRoles(roles) {

  return roles
    .map(role => `${role} (${role.name})`)
    .join('\n');
}

module.exports = {

  name: 'guildMemberUpdate',

  async execute(oldMember, newMember, client) {

    try {

      const addedRoles =
        newMember.roles.cache.filter(role =>
          role.id !== newMember.guild.id &&
          !oldMember.roles.cache.has(role.id)
        );

      const removedRoles =
        oldMember.roles.cache.filter(role =>
          role.id !== oldMember.guild.id &&
          !newMember.roles.cache.has(role.id)
        );

      if (addedRoles.size) {

        const audit =
          await findRecentAuditLog(
            newMember.guild,
            AuditLogEvent.MemberRoleUpdate,
            newMember.id
          );

        await logAudit(
          client,
          newMember.guild.id,
          {
            action: 'MEMBER_ROLES_ADDED',
            targetId: newMember.id,
            executorId: audit?.executor?.id,
            type: 'MEMBERS',
            metadata: {
              roles: addedRoles.map(role => role.id)
            },
            embed: createAuditEmbed({
              action: 'Member Role Added',
              target: formatMember(newMember),
              executor: formatExecutor(audit),
              reason: audit?.reason || undefined,
              extra: formatRoles(addedRoles),
              color: 0x57F287
            })
          }
        );
      }

      if (removedRoles.size) {

        const audit =
          await findRecentAuditLog(
            newMember.guild,
            AuditLogEvent.MemberRoleUpdate,
            newMember.id
          );

        await logAudit(
          client,
          newMember.guild.id,
          {
            action: 'MEMBER_ROLES_REMOVED',
            targetId: newMember.id,
            executorId: audit?.executor?.id,
            type: 'MEMBERS',
            metadata: {
              roles: removedRoles.map(role => role.id)
            },
            embed: createAuditEmbed({
              action: 'Member Role Removed',
              target: formatMember(newMember),
              executor: formatExecutor(audit),
              reason: audit?.reason || undefined,
              extra: formatRoles(removedRoles),
              color: 0xED4245
            })
          }
        );
      }

      if (
        oldMember.nickname !==
        newMember.nickname
      ) {

        const audit =
          await findRecentAuditLog(
            newMember.guild,
            AuditLogEvent.MemberUpdate,
            newMember.id
          );

        await logAudit(
          client,
          newMember.guild.id,
          {
            action: 'MEMBER_NICKNAME_UPDATED',
            targetId: newMember.id,
            executorId: audit?.executor?.id,
            type: 'MEMBERS',
            metadata: {
              before: oldMember.nickname || null,
              after: newMember.nickname || null
            },
            embed: createAuditEmbed({
              action: 'Member Nickname Updated',
              target: formatMember(newMember),
              executor: formatExecutor(audit),
              reason: audit?.reason || undefined,
              extra:
                `Before: ${oldMember.nickname || 'None'}\n` +
                `After: ${newMember.nickname || 'None'}`,
              color: 0x5865F2
            })
          }
        );
      }

    } catch (err) {

      console.error(
        'GuildMemberUpdate Error:',
        err
      );
    }
  }
};
