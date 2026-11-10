const { PermissionFlagsBits:P } = require('discord.js');
const { get,run } = require('../../database');
async function sealTicket(channel,botId) {
  if(!channel.permissionOverwrites?.set) return;
  const ticket=get('SELECT closePermissionsJson FROM tickets WHERE channelId=?',[channel.id]);
  let overwrites;
  if(ticket?.closePermissionsJson) overwrites=JSON.parse(ticket.closePermissionsJson);
  else {
    overwrites=[...channel.permissionOverwrites.cache.values()].map(row=>({id:row.id,type:row.type,allow:String(row.allow.bitfield),deny:String(row.deny.bitfield)}));
    run('UPDATE tickets SET closePermissionsJson=? WHERE channelId=?',[JSON.stringify(overwrites),channel.id]);
  }
  const sealed=overwrites.map(row=>row.id===botId ? row : {...row,
    allow:String(BigInt(row.allow)&~P.SendMessages&~P.SendMessagesInThreads),
    deny:String(BigInt(row.deny)|P.SendMessages|P.SendMessagesInThreads)});
  if(!sealed.some(row=>row.id===botId)) sealed.push({id:botId,type:1,allow:String(P.SendMessages|P.ReadMessageHistory|P.EmbedLinks|P.AttachFiles),deny:'0'});
  await channel.permissionOverwrites.set(sealed,'Seal ticket while archiving');
}
async function unsealTicket(channel) {
  const ticket=get('SELECT closePermissionsJson FROM tickets WHERE channelId=?',[channel.id]);
  if(!ticket?.closePermissionsJson || !channel.permissionOverwrites?.set) return;
  await channel.permissionOverwrites.set(JSON.parse(ticket.closePermissionsJson),'Restore ticket after interrupted closure');
  run('UPDATE tickets SET closePermissionsJson=NULL WHERE channelId=?',[channel.id]);
}
module.exports={sealTicket,unsealTicket};
