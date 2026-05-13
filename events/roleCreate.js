const { Events } = require('discord.js');
const { createAuditEmbed, logAudit } = require('../utils/logger');

module.exports = {
  name: Events.GuildRoleCreate,
  async execute(role) {
    await logAudit(role.client, role.guild.id, {
      action: 'ROLE_CREATE',
      targetId: role.id,
      metadata: { roleName: role.name },
      embed: createAuditEmbed({
        action: 'Role Created',
        target: `${role} (${role.name})`,
        color: 'Green',
      }),
    });
  },
};
