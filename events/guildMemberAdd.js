const { EmbedBuilder } = require('discord.js');
const { get } = require('../database');
const { trackMemberJoin } = require('../utils/inviteTracking');
const { createMemberJoinEmbed, sendLog } = require('../utils/logger');
const { sendGreeting, sendMilestone } = require('../utils/greetings');

module.exports = {
  name: 'guildMemberAdd',
  async execute(member, client) {
    const inviteCheck=trackMemberJoin(member);
    const raidCheck=require('../utils/raidProtection').handleRaidJoin(member,client)
      .catch(error=>console.error('Anti-raid join check:',error.message));
    try {
      // Capture attribution before welcome/logging network requests can consume the evidence.
      const invite = await inviteCheck;
      if (invite.duplicate) return;
      for (const operation of [
        () => sendLog(client, member.guild.id, 'MEMBERS', createMemberJoinEmbed(member)),
        () => sendGreeting({ client, member, type: 'welcome' }),
        () => sendMilestone({ client, member })
      ]) { try { await operation(); } catch (error) { console.error('Member welcome:', error.message); } }
      const stats = invite.inviterId ? get('SELECT * FROM invite_stats WHERE guildId = ? AND userId = ?', [member.guild.id, invite.inviterId]) : null;
      const days = Math.floor((Date.now() - member.user.createdTimestamp) / 86400000);
      const flags = [days < 7 ? 'New account' : null, member.user.avatar === null ? 'Default avatar' : null,
        /\d{4,}/.test(member.user.username || '') ? 'Username with a long numeric sequence' : null].filter(Boolean);
      const embed = new EmbedBuilder().setTitle('Member Joined').setColor(flags.length ? 0xFEE75C : 0x57F287)
        .setThumbnail(member.user.displayAvatarURL({ size: 256 })).addFields(
          { name: 'Member', value: `<@${member.id}> (${member.id})` },
          { name: 'Invited By', value: invite.inviterId ? `<@${invite.inviterId}>` : invite.source === 'VANITY' ? 'Server vanity URL' : 'Unknown', inline: true },
          { name: 'Invite', value: invite.inviteCode, inline: true },
          { name: 'Attribution', value: invite.confidence === 'EXACT' ? 'Observed invite use' : String(invite.reason || 'Unknown; no credit guessed').slice(0,900) },
          { name: 'Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:F>` },
          { name: 'Inviter Stats', value: stats ? `Total: ${stats.invites || 0}\nLeaves: ${stats.leaves || 0}\nFake: ${stats.fake || 0}\nBonus: ${stats.bonus || 0}` : 'N/A' })
        .setFooter({ text: flags.length ? `${flags.join(' | ')} (not proof of an alternate account)` : `Account age: ${days} days` }).setTimestamp();
      await sendLog(client, member.guild.id, 'INVITES', embed);
    } catch (error) { console.error('GuildMemberAdd Error:', error); }
    finally {await raidCheck;}
  }
};
