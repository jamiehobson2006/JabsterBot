const {ChannelType,PermissionFlagsBits:P}=require('discord.js');
const TEXT_TYPES=new Set([ChannelType.GuildText,ChannelType.GuildAnnouncement]);
function destinationIssue(guild,channel,{kind='text',permissions=[P.ViewChannel,P.SendMessages,P.EmbedLinks]}={}) {
  if(!channel || (channel.guildId || channel.guild?.id)!==guild.id) return 'Choose an existing channel in this server.';
  if(kind==='text' && !TEXT_TYPES.has(channel.type)) return 'Choose a server text or announcement channel, not a thread, forum or voice channel.';
  if(kind==='category' && channel.type!==ChannelType.GuildCategory) return 'Choose a channel category.';
  if(kind==='voice' && channel.type!==ChannelType.GuildVoice) return 'Choose a regular voice channel.';
  const available=channel.permissionsFor?.(guild.members.me);
  if(!available?.has(permissions)) return `I need ${new (require('discord.js').PermissionsBitField)(permissions).toArray().join(', ')} there.`;
  return null;
}
function assertDestination(guild,channel,options) {const issue=destinationIssue(guild,channel,options);if(issue)throw new Error(issue);return channel;}
module.exports={assertDestination,destinationIssue,TEXT_TYPES};
