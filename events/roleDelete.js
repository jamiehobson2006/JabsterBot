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

  name: 'roleDelete',

  async execute(role, client) {

    try {

      const audit =
        await findRecentAuditLog(
          role.guild,
          AuditLogEvent.RoleDelete,
          role.id
        );

      await logAudit(
        client,
        role.guild.id,
        {
          action: 'ROLE_DELETED',
          targetId: role.id,
          executorId: audit?.executor?.id,
          type: 'SERVER',
          metadata: {
            roleId: role.id,
            roleName: role.name
          },
          embed: createAuditEmbed({
            action: 'Role Deleted',
            target: `${role.name}\n${role.id}`,
            executor: formatExecutor(audit),
            reason: audit?.reason || undefined,
            color: 0xED4245
          })
        }
      );

    } catch (err) {

      console.error(
        'RoleDelete Error:',
        err
      );
    }
  }
};
