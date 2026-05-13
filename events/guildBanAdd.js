const { Events } = require('discord.js');
const { createAuditEmbed, logAudit } = require('../utils/logger');

module.exports = {
  name: Events.GuildBanAdd,
  async execute(ban) {
    await logAudit(ban.client, ban.guild.id, {
      action: 'BAN_ADD',
      targetId: ban.user.id,
      metadata: { reason: ban.reason || null },
      embed: createAuditEmbed({
        action: 'User Banned',
        target: `${ban.user} (${ban.user.tag})`,
        reason: ban.reason || 'No reason provided',
        color: 'DarkRed',
      }),
    });
  },
};
