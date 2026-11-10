const {PermissionFlagsBits:P,PermissionsBitField}=require('discord.js');
const {all,get}=require('../database');
const {commandNode,commandEntries}=require('./commandRegistry');
const {getCommandAvailability}=require('./commandControls');
function checkAction({commands,path,guild,member,channel}){
  const found=commandNode(commands,path);
  if(!found)return {eligible:false,reason:'Command is not loaded.'};
  const parts=found.name.split(' '),source=found.route?.sourceName || parts[0],command=found.route?.command || found.command;
  const json=command.data.toJSON(),sub=parts.at(-1),group=found.route?parts[2]:parts[1];
  const admin=member.permissions.has(P.Administrator),has=permission=>member.permissions.has(permission);
  const settings=get('SELECT * FROM guild_settings WHERE guildId=?',[guild.id]) || {};
  const control=getCommandAvailability({guild,member,channel,channelId:channel.id,commandName:found.name});
  if(!control.allowed)return {eligible:false,reason:`Disabled by server command controls${control.reason?`: ${control.reason}`:''}`};
  if(!channel.permissionsFor(member)?.has([P.ViewChannel,P.UseApplicationCommands]))return {eligible:false,reason:'Missing channel access or Use Application Commands.'};
  let permitted=true,reason='No additional fixed permission requirement.',conditional=false;
  const required=found.route?.permission ?? require('./commandPermissions').permissionDefaults[source] ?? json.default_member_permissions;
  if(required!==null && required!==undefined){
    permitted=has(BigInt(required) || P.Administrator);
    reason=`Requires ${new PermissionsBitField(BigInt(required)).toArray().join(', ') || 'Administrator'}.`;
  }
  if(source==='application'){
    if(['setcreatorrole','clearcreatorrole'].includes(sub)){permitted=admin;reason='Administrator only.';}
    else if(['accept','deny'].includes(sub)){
      const ticket=get('SELECT * FROM tickets WHERE guildId=? AND channelId=?',[guild.id,channel.id]);
      permitted=admin || (ticket?require('./tickets/permissions').hasTicketAccess({member,guildId:guild.id,type:ticket.type,channelId:channel.id}):
        all('SELECT reviewerRoleId FROM application_forms WHERE guildId=?',[guild.id]).some(row=>member.roles.cache.has(row.reviewerRoleId)));
      reason='Application reviewer role in the current application ticket or Administrator.';conditional=true;
    }else{permitted=require('./applicationAccess').canManageApplications(member,settings.applicationCreatorRoleId);reason='Application management role or Administrator.';}
  }
  if(['logging','loggingstyle'].includes(source)){
    permitted=admin || require('./loggingConfig').memberCanManageLogging(member,guild.id);reason='Logging manager role or Administrator; evidence/privacy changes require Administrator.';conditional=source==='logging';
  }
  if(source==='censor'){permitted=has(P.ManageGuild) || !['setrole','clearrole'].includes(sub) && member.roles.cache.has(settings.censorRoleId);reason='Manage Server, or censor manager role for non-access settings.';}
  if(source==='antispam'){
    const config=get('SELECT managerRoleId FROM antispam_settings WHERE guildId=?',[guild.id]);
    permitted=has(P.ManageGuild) || !['setrole','clearrole'].includes(sub) && member.roles.cache.has(config?.managerRoleId);
    reason='Manage Server, or anti-spam manager role. Discord integration overrides may be needed for that role.';
    conditional=true;
  }
  if(source==='suggestions' && ['link','unlink'].includes(sub)){
    permitted=require('./suggestions/similarity').canManage(member,guild.id);reason='Administrator or suggestion manager role.';
  }
  if(source==='automation'){
    permitted=sub==='manager'?admin:group==='tag' && sub==='use'?true:require('./automation').canManage(member,group);
    reason=sub==='manager'?'Administrator only.':group==='tag' && sub==='use'?'The selected tag may require a role, channel and cooldown.':`Administrator or ${group} management role.`;
    conditional=group==='tag' && sub==='use';
  }
  if(['knowledge','challenge','partner','temprole'].includes(source)){
    const access=require('./communityAccess');
    const managed={knowledge:['create','edit','archive','restore','history'],challenge:['create','end','pending','approve','deny'],
      partner:['approve','deny','archive','pending','ticket'],temprole:['grant','cancel']};
    if(sub==='configure' || source==='temprole' && ['allow','disallow','resolve'].includes(sub)){permitted=admin;reason='Administrator only.';}
    else if(managed[source].includes(sub)){permitted=access.canManage(member,source);reason='Configured management role or Administrator.';}
    else{permitted=access.canUse(member,source);reason='Configured usage role, if set. Item-level restrictions may also apply.';conditional=true;}
  }
  if(source==='training'){
    const training=require('./moderatorTraining');
    if(sub==='configure'){permitted=admin;reason='Administrator only.';}
    else if(group==='scenario' || ['assign','grade','review','reset','cancel','queue'].includes(sub)){permitted=training.trainer(member);reason='Trainer role or Administrator. Self-grading is prohibited.';}
    else{permitted=training.trainee(member) || ['results','settings'].includes(sub) && training.trainer(member);reason='Trainee role or Administrator; trainers can inspect results. Training must be enabled to start or answer.';conditional=true;}
  }
  if(source==='ticket'){
    if(['limits','recovery','retrycreation','private'].includes(sub)){permitted=admin;reason='Administrator only.';}
    else{
      const ticket=get('SELECT * FROM tickets WHERE guildId=? AND channelId=?',[guild.id,channel.id]);
      permitted=admin || (ticket?require('./tickets/permissions').hasTicketAccess({member,guildId:guild.id,type:ticket.type,channelId:channel.id}):
        all('SELECT roleId FROM ticket_settings WHERE guildId=? UNION SELECT reviewerRoleId roleId FROM application_forms WHERE guildId=?',[guild.id,guild.id]).some(row=>member.roles.cache.has(row.roleId)));
      reason='Configured ticket staff/reviewer role or explicit ticket staff, inside the relevant ticket.';conditional=true;
    }
  }
  if(source==='modmail'){permitted=sub==='contact' || has(P.ManageGuild);reason=sub==='contact'?'Server modmail must be enabled.':'Manage Server; close also checks the modmail staff role or Administrator.';conditional=true;}
  if(['factsources','dailyfactsource'].includes(source)){permitted=channel.id===require('./dailyFactReview').reviewChannelId();reason='Private fact-review channel only.';}
  return {eligible:Boolean(permitted),conditional,reason,sourceName:source};
}
function matrix(context,{query='',category=null}={}){
  const words=query.toLowerCase().trim();
  return commandEntries(context.commands).filter(entry=>(!category || entry.category===category) &&
    `${entry.path} ${entry.description}`.toLowerCase().includes(words)).map(entry=>({...entry,...checkAction({...context,path:entry.path})}));
}
module.exports={checkAction,matrix};
