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

function formatPermission(permission) {
  return permission.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function permissionChanges(oldRole, newRole) {
  const before = new Set(oldRole.permissions.toArray());
  const after = new Set(newRole.permissions.toArray());
  const added = [...after].filter(permission => !before.has(permission));
  const removed = [...before].filter(permission => !after.has(permission));
  const changes = [];

  if (added.length) {
    changes.push(`Permissions added: ${added.map(formatPermission).join(', ')}`);
  }

  if (removed.length) {
    changes.push(`Permissions removed: ${removed.map(formatPermission).join(', ')}`);
  }

  return changes;
}

module.exports = {
  name: 'roleUpdate',

  async execute(oldRole, newRole, client) {
    try {
      const changes = [];

      if (oldRole.name !== newRole.name) {
        changes.push(`Name: ${oldRole.name} -> ${newRole.name}`);
      }

      if (oldRole.hexColor !== newRole.hexColor) {
        changes.push(`Color: ${oldRole.hexColor} -> ${newRole.hexColor}`);
      }

      if (oldRole.hoist !== newRole.hoist) {
        changes.push(`Displayed separately: ${oldRole.hoist} -> ${newRole.hoist}`);
      }

      if (oldRole.mentionable !== newRole.mentionable) {
        changes.push(`Mentionable: ${oldRole.mentionable} -> ${newRole.mentionable}`);
      }

      if (oldRole.position !== newRole.position) {
        changes.push(`Position: ${oldRole.position} -> ${newRole.position}`);
      }

      if (oldRole.icon !== newRole.icon) {
        changes.push('Role icon changed');
      }

      if (oldRole.unicodeEmoji !== newRole.unicodeEmoji) {
        changes.push(`Role emoji: ${oldRole.unicodeEmoji || 'None'} -> ${newRole.unicodeEmoji || 'None'}`);
      }

      changes.push(...permissionChanges(oldRole, newRole));

      if (!changes.length) {
        return;
      }

      const audit = await findRecentAuditLog(
        newRole.guild,
        AuditLogEvent.RoleUpdate,
        newRole.id
      );

      await logAudit(
        client,
        newRole.guild.id,
        {
          action: 'ROLE_UPDATED',
          targetId: newRole.id,
          executorId: audit?.executor?.id,
          type: 'SERVER',
          metadata: {
            roleId: newRole.id,
            changes
          },
          embed: createAuditEmbed({
            action: 'Role Updated',
            target: `${newRole.name}\n<@&${newRole.id}>`,
            executor: formatExecutor(audit),
            reason: audit?.reason || undefined,
            extra: changes.join('\n'),
            color: 0xFEE75C
          })
        }
      );
    } catch (err) {
      console.error('RoleUpdate Error:', err);
    }
  }
};
