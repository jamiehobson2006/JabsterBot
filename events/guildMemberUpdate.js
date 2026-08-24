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

function formatTimestamp(timestamp) {
  return timestamp
    ? `<t:${Math.floor(timestamp / 1000)}:F>`
    : 'None';
}

async function logMemberChange({
  client,
  member,
  action,
  metadata,
  details,
  color = 0x5865F2
}) {
  const audit = await findRecentAuditLog(
    member.guild,
    AuditLogEvent.MemberUpdate,
    member.id
  );

  return logAudit(client, member.guild.id, {
    action,
    targetId: member.id,
    executorId: audit?.executor?.id,
    type: 'MEMBERS',
    metadata,
    embed: createAuditEmbed({
      action: action
        .split('_')
        .map(word => word[0] + word.slice(1).toLowerCase())
        .join(' '),
      target: formatMember(member),
      executor: formatExecutor(audit),
      reason: audit?.reason || undefined,
      extra: details,
      color
    })
  });
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

      if (
        oldMember.communicationDisabledUntilTimestamp !==
        newMember.communicationDisabledUntilTimestamp
      ) {
        const before = oldMember.communicationDisabledUntilTimestamp;
        const after = newMember.communicationDisabledUntilTimestamp;
        const action = after
          ? (before ? 'MEMBER_TIMEOUT_UPDATED' : 'MEMBER_TIMEOUT_ADDED')
          : 'MEMBER_TIMEOUT_REMOVED';

        await logMemberChange({
          client,
          member: newMember,
          action,
          metadata: { before: before || null, after: after || null },
          details:
            `Before: ${formatTimestamp(before)}\n` +
            `After: ${formatTimestamp(after)}`,
          color: after ? 0xFEE75C : 0x57F287
        });
      }

      if (oldMember.pending !== newMember.pending) {
        await logMemberChange({
          client,
          member: newMember,
          action: 'MEMBER_SCREENING_UPDATED',
          metadata: { pending: newMember.pending },
          details: newMember.pending
            ? 'Membership screening is pending.'
            : 'Membership screening was completed.',
          color: newMember.pending ? 0xFEE75C : 0x57F287
        });
      }

      if (
        oldMember.premiumSinceTimestamp !==
        newMember.premiumSinceTimestamp
      ) {
        const boosting = Boolean(newMember.premiumSinceTimestamp);

        await logMemberChange({
          client,
          member: newMember,
          action: boosting
            ? 'MEMBER_BOOST_STARTED'
            : 'MEMBER_BOOST_ENDED',
          metadata: {
            before: oldMember.premiumSinceTimestamp || null,
            after: newMember.premiumSinceTimestamp || null
          },
          details: boosting
            ? `Boost started: ${formatTimestamp(newMember.premiumSinceTimestamp)}`
            : 'Server boost ended.',
          color: boosting ? 0xFEE75C : 0xED4245
        });
      }

    } catch (err) {

      console.error(
        'GuildMemberUpdate Error:',
        err
      );
    }
  }
};
