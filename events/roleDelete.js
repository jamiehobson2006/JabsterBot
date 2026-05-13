const { Events } = require('discord.js');
const { createAuditEmbed, logAudit } = require('../utils/logger');

module.exports = {
  name: Events.GuildRoleDelete,
  async execute(role) {
    await logAudit(role.client, role.guild.id, {
      action: 'ROLE_DELETE',
      targetId: role.id,
      metadata: { roleName: role.name },
      embed: createAuditEmbed({
        action: 'Role Deleted',
        target: role.name,
        color: 'Red',
      }),
    });
  },
};
