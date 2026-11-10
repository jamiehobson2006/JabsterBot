const {all}=require('../database');
const {resolveInvocation,commandEntries}=require('./commandRegistry');
function markOptions(json,source){
  const visit=(node,parts=[])=>{
    for(const option of node.options || []){
      if(option.type<=2)visit(option,[...parts,option.name]);
      else if(option.type===3 && !option.choices){
        if(option.name==='command' && ['commandcontrol','permissions','help'].includes(source) ||
          source==='application' && option.name==='name' && !parts.includes('create') ||
          source==='automation' && option.name==='name' && !parts.includes('create') ||
          source==='socialsettings' && option.name==='feed' ||
          ['ginfo','gend','gdelete','greroll'].includes(source) && option.name==='message_id' ||
          source==='reactionrole' && option.name==='message_id' ||
          source==='training' && option.name==='topic')option.autocomplete=true;
      }
    }
  };visit(json);return json;
}
async function choices(interaction,commands){
  const root=commands.get(interaction.commandName);if(!root)return [];
  const resolved=resolveInvocation(root,interaction),options=resolved.interaction.options,focused=options.getFocused(true);
  const member=await interaction.guild.members.fetch({user:interaction.user.id,force:true});
  const path=require('./commandControls').interactionCommandPath(interaction);
  const access=require('./commandAccess').checkAction({commands,path,guild:interaction.guild,member,channel:interaction.channel});
  if(!access.eligible)return [];
  const source=resolved.sourceName,sub=options.getSubcommand(false),group=options.getSubcommandGroup(false);
  const text=String(focused.value || '').toLowerCase();let rows=[];
  if(focused.name==='command')rows=commandEntries(commands).map(entry=>({name:`/${entry.path}`,value:entry.path}));
  else if(source==='application'){
    if(!require('./applicationAccess').canManageApplications(member,require('../database').get('SELECT applicationCreatorRoleId FROM guild_settings WHERE guildId=?',[interaction.guild.id])?.applicationCreatorRoleId))return [];
    rows=all('SELECT name FROM application_forms WHERE guildId=? ORDER BY name',[interaction.guild.id]).map(row=>({name:row.name,value:row.name}));
  }else if(source==='automation'){
    const kind=group==='response'?'RESPONSE':'TAG';
    rows=all('SELECT * FROM automation_entries WHERE guildId=? AND kind=?',[interaction.guild.id,kind])
      .filter(row=>sub!=='use' || row.enabled && (!row.useRoleId || member.roles.cache.has(row.useRoleId)) && (!row.channelId || row.channelId===interaction.channelId))
      .map(row=>({name:row.name,value:row.name}));
  }else if(source==='socialsettings')rows=all('SELECT * FROM social_channels WHERE guildId=?',[interaction.guild.id])
    .map(row=>({name:`${row.creatorName} | ${row.platform} ${row.contentType}`,value:`${row.platform}:${row.creatorId}:${row.contentType}`}));
  else if(source==='knowledge')rows=require('./knowledgeBase').search(member).map(row=>({name:row.title,value:row.name}));
  else if(source==='challenge')rows=all('SELECT name,title FROM community_challenges WHERE guildId=?',[interaction.guild.id]).map(row=>({name:row.title,value:row.name}));
  else if(source==='partner')rows=all('SELECT * FROM partner_entries WHERE guildId=?',[interaction.guild.id])
    .filter(row=>row.status==='APPROVED' || require('./communityAccess').canManage(member,'partner') || row.userId===member.id)
    .map(row=>({name:row.title,value:row.name}));
  else if(source==='training')rows=all('SELECT DISTINCT topic FROM training_scenarios WHERE guildId=? AND enabled=1',[interaction.guild.id]).map(row=>({name:row.topic,value:row.topic}));
  else if(source==='reactionrole'){
    const channel=options.getChannel('channel');rows=all('SELECT messageId,title FROM reaction_role_panels WHERE guildId=? AND (? IS NULL OR channelId=?)',[interaction.guild.id,channel?.id || null,channel?.id || null]).map(row=>({name:`${row.title || 'Role panel'} | ${row.messageId}`,value:row.messageId}));
  }else if(focused.name==='message_id')rows=all('SELECT messageId,prize FROM giveaways WHERE guildId=? ORDER BY createdAt DESC LIMIT 100',[interaction.guild.id]).map(row=>({name:`${row.prize} | ${row.messageId}`,value:row.messageId}));
  return rows.filter(row=>`${row.name} ${row.value}`.toLowerCase().includes(text)).slice(0,25)
    .map(row=>({name:String(row.name).slice(0,100),value:String(row.value).slice(0,100)}));
}
module.exports={choices,markOptions};
