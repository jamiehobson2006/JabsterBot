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

  name: 'roleCreate',

  async execute(role, client) {

    try {

      const audit =
        await findRecentAuditLog(
          role.guild,
          AuditLogEvent.RoleCreate,
          role.id
        );

      await logAudit(
        client,
        role.guild.id,
        {
          action: 'ROLE_CREATED',
          targetId: role.id,
          executorId: audit?.executor?.id,
          type: 'SERVER',
          metadata: {
            roleId: role.id,
            roleName: role.name
          },
          embed: createAuditEmbed({
            action: 'Role Created',
            target: `${role.name}\n<@&${role.id}>`,
            executor: formatExecutor(audit),
            reason: audit?.reason || undefined,
            extra:
              `Color: ${role.hexColor}\n` +
              `Mentionable: ${role.mentionable}`,
            color: 0x57F287
          })
        }
      );

    } catch (err) {

      console.error(
        'RoleCreate Error:',
        err
      );
    }
  }
};
