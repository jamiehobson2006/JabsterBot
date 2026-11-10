const {all,get,run}=require('../database');
const {safeText,slug,canManage,canUse,isAdmin}=require('./communityAccess');
function entry(guildId,name){return get('SELECT * FROM partner_entries WHERE guildId=? AND name=?',[guildId,slug(name)]);}
function submit(member,values){
  if(!canUse(member,'partner') || member.user.bot)throw new Error('You cannot submit partner listings.');
  const name=slug(values.name),before=entry(member.guild.id,name);
  if(before && (before.userId!==member.id || !['REJECTED','ARCHIVED'].includes(before.status)))throw new Error('This directory name is already in use.');
  if(get("SELECT COUNT(*) n FROM partner_entries WHERE guildId=? AND userId=? AND status='PENDING'",[member.guild.id,member.id]).n>=3)throw new Error('You can have up to three listings awaiting review.');
  const url=require('./factSources').validateSourceUrl(values.url);if(!url)throw new Error('A public HTTPS website or invite link is required.');
  const ticket=values.channelId?get("SELECT channelId,userId FROM tickets WHERE guildId=? AND channelId=? AND type='partnership' AND status='OPEN'",[member.guild.id,values.channelId]):null;
  const ticketChannelId=ticket && (ticket.userId===member.id || canManage(member,'partner'))?ticket.channelId:null;
  run(`INSERT INTO partner_entries(guildId,name,userId,title,url,description,ticketChannelId,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(guildId,name) DO UPDATE SET title=excluded.title,url=excluded.url,description=excluded.description,
    status='PENDING',reviewedBy=NULL,reason=NULL,ticketChannelId=excluded.ticketChannelId,updatedAt=excluded.updatedAt`,
  [member.guild.id,name,member.id,safeText(values.title,120),url,safeText(values.description,1000),ticketChannelId,Date.now(),Date.now()]);return entry(member.guild.id,name);
}
function decide(member,name,status,reason){
  if(!canManage(member,'partner'))throw new Error('Partner management access is required.');
  const row=entry(member.guild.id,name);if(!row)throw new Error('Partner listing not found.');
  if(!['APPROVED','REJECTED','ARCHIVED'].includes(status))throw new Error('Invalid partner decision.');
  if(row.userId===member.id && !isAdmin(member))throw new Error('Another manager must review your own listing.');
  if(status!=='ARCHIVED' && row.status!=='PENDING')throw new Error('This listing is not awaiting review.');
  run('UPDATE partner_entries SET status=?,reason=?,reviewedBy=?,updatedAt=? WHERE guildId=? AND name=?',
    [status,safeText(reason,500),member.id,Date.now(),member.guild.id,row.name]);return entry(member.guild.id,row.name);
}
function browse(member,query='',pending=false){
  const manager=canManage(member,'partner');
  if(!canUse(member,'partner') && !manager)throw new Error('The configured usage role is required.');
  if(pending && !manager)throw new Error('Partner management access is required.');
  return all('SELECT * FROM partner_entries WHERE guildId=? AND status=? ORDER BY title COLLATE NOCASE',[member.guild.id,pending?'PENDING':'APPROVED'])
    .filter(row=>`${row.title} ${row.description}`.toLowerCase().includes(query.toLowerCase()));
}
function ticketLinks(member,name){
  if(!canManage(member,'partner'))throw new Error('Partner management access is required.');
  const listing=entry(member.guild.id,name);
  if(!listing)throw new Error('Partner listing not found.');
  const ticket=listing.ticketChannelId?get('SELECT * FROM tickets WHERE guildId=? AND channelId=?',[member.guild.id,listing.ticketChannelId]):null;
  if(!ticket)return 'This listing was not submitted from an owned partnership ticket.';
  const links=[`Ticket: https://discord.com/channels/${member.guild.id}/${ticket.channelId}`];
  if(ticket.transcriptArchiveChannelId && ticket.transcriptMessageId)links.push(`Transcript: https://discord.com/channels/${member.guild.id}/${ticket.transcriptArchiveChannelId}/${ticket.transcriptMessageId}`);
  return links.join('\n');
}
module.exports={browse,decide,entry,submit,ticketLinks};
