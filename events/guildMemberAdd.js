const { Events } = require('discord.js');
const { createAuditEmbed, logAudit } = require('../utils/logger');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    await logAudit(member.client, member.guild.id, {
      action: 'MEMBER_JOIN',
      targetId: member.id,
      metadata: { memberCount: member.guild.memberCount },
      embed: createAuditEmbed({
        action: 'Member Joined',
        target: `${member.user} (${member.user.tag})`,
        extra: `Account created: <t:${Math.floor(member.user.createdTimestamp / 1000)}:F>\nMember count: ${member.guild.memberCount}`,
        color: 'Green',
      }),
    });
  },
};
