const { Events } = require('discord.js');
const { createAuditEmbed, logAudit } = require('../utils/logger');

module.exports = {
  name: Events.GuildBanRemove,
  async execute(ban) {
    await logAudit(ban.client, ban.guild.id, {
      action: 'BAN_REMOVE',
      targetId: ban.user.id,
      embed: createAuditEmbed({
        action: 'User Unbanned',
        target: `${ban.user} (${ban.user.tag})`,
        color: 'Green',
      }),
    });
  },
};
