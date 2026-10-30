const { EmbedBuilder } = require('discord.js');
const { get } = require('../database');
const { trackMemberLeave } = require('../utils/inviteTracking');
const { createMemberLeaveEmbed, sendLog } = require('../utils/logger');
const { sendGreeting } = require('../utils/greetings');

module.exports = {
  name: 'guildMemberRemove',
  async execute(member, client) {
    try {
      const invite = await trackMemberLeave(member);
      for (const operation of [
        () => sendLog(client, member.guild.id, 'MEMBERS', createMemberLeaveEmbed(member)),
        () => sendGreeting({ client, member, type: 'goodbye' })
      ]) { try { await operation(); } catch (error) { console.error('Member goodbye:', error.message); } }
      if (!invite) return;
      const stats = invite.inviterId ? get('SELECT * FROM invite_stats WHERE guildId = ? AND userId = ?', [member.guild.id, invite.inviterId]) : null;
      await sendLog(client, member.guild.id, 'INVITES', new EmbedBuilder().setTitle('Member Left').setColor(0xED4245)
        .addFields({ name: 'Member', value: `<@${member.id}> (${member.id})` },
          { name: 'Invited By', value: invite.inviterId ? `<@${invite.inviterId}>` : 'Unknown', inline: true },
          { name: 'Joined', value: `<t:${Math.floor(invite.joinedAt / 1000)}:F>`, inline: true },
          { name: 'Stayed For', value: `${Math.max(0, Math.floor((invite.leftAt - invite.joinedAt) / 60000))} minutes`, inline: true },
          { name: 'Invite', value: `${invite.inviteCode || 'Unknown'} (${invite.confidence || 'UNKNOWN'})` },
          { name: 'Fast Leave', value: invite.leftAt - invite.joinedAt < 1800000 ? 'Within 30 minutes (not proof of abuse)' : 'No', inline: true },
          { name: 'Inviter Stats', value: stats ? `Total: ${stats.invites || 0}\nLeaves: ${stats.leaves || 0}` : 'N/A' })
        .setFooter({ text: 'Jabster Studios Invite Tracking' }).setTimestamp());
    } catch (error) { console.error('GuildMemberRemove Error:', error); }
  }
};
