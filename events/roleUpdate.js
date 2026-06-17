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
        changes.push(`Displayed Separately: ${oldRole.hoist} -> ${newRole.hoist}`);
      }

      if (oldRole.mentionable !== newRole.mentionable) {
        changes.push(`Mentionable: ${oldRole.mentionable} -> ${newRole.mentionable}`);
      }

      if (
        oldRole.permissions.bitfield !==
        newRole.permissions.bitfield
      ) {
        changes.push('Permissions changed');
      }

      if (!changes.length) {
        return;
      }

      const audit =
        await findRecentAuditLog(
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

      console.error(
        'RoleUpdate Error:',
        err
      );
    }
  }
};
