const { Events } = require('discord.js');
const { createAuditEmbed, logAudit } = require('../utils/logger');

module.exports = {
  name: Events.GuildRoleUpdate,
  async execute(oldRole, newRole) {
    const changes = [];
    if (oldRole.name !== newRole.name) changes.push(`Name: ${oldRole.name} -> ${newRole.name}`);
    if (oldRole.color !== newRole.color) changes.push(`Color: ${oldRole.hexColor} -> ${newRole.hexColor}`);
    if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) changes.push('Permissions changed');
    if (!changes.length) return;

    await logAudit(newRole.client, newRole.guild.id, {
      action: 'ROLE_UPDATE',
      targetId: newRole.id,
      metadata: { changes },
      embed: createAuditEmbed({
        action: 'Role Updated',
        target: `${newRole} (${newRole.name})`,
        extra: changes.join('\n'),
        color: 'Blue',
      }),
    });
  },
};
