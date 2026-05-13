const { Events } = require('discord.js');
const { createAuditEmbed, logAudit } = require('../utils/logger');

module.exports = {
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember) {
    const changes = [];

    if (oldMember.nickname !== newMember.nickname) {
      changes.push(`Nickname: ${oldMember.nickname || oldMember.user.username} -> ${newMember.nickname || newMember.user.username}`);
    }

    const oldRoles = oldMember.roles.cache;
    const newRoles = newMember.roles.cache;
    const addedRoles = newRoles.filter((role) => !oldRoles.has(role.id));
    const removedRoles = oldRoles.filter((role) => !newRoles.has(role.id));

    if (addedRoles.size) changes.push(`Roles added: ${addedRoles.map((role) => role.toString()).join(', ')}`);
    if (removedRoles.size) changes.push(`Roles removed: ${removedRoles.map((role) => role.toString()).join(', ')}`);
    if (!changes.length) return;

    await logAudit(newMember.client, newMember.guild.id, {
      action: 'MEMBER_UPDATE',
      targetId: newMember.id,
      metadata: { changes },
      embed: createAuditEmbed({
        action: 'Member Updated',
        target: `${newMember.user} (${newMember.user.tag})`,
        extra: changes.join('\n'),
        color: 'Blue',
      }),
    });
  },
};
