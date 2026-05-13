const { Events } = require('discord.js');
const { createAuditEmbed, logAudit } = require('../utils/logger');

module.exports = {
  name: Events.GuildMemberRemove,
  async execute(member) {
    await logAudit(member.client, member.guild.id, {
      action: 'MEMBER_LEAVE',
      targetId: member.id,
      metadata: { memberCount: member.guild.memberCount },
      embed: createAuditEmbed({
        action: 'Member Left',
        target: `${member.user} (${member.user.tag})`,
        extra: `Member count: ${member.guild.memberCount}`,
        color: 'Orange',
      }),
    });
  },
};
