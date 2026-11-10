const {ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder}=require('discord.js');
const {all,get}=require('../database');
const {automaticRoleSafetyError}=require('./roleSafety');
const queues=new Map();
async function selectPanelRoles({guild,messageId,userId,roleIds=[],mode='REPLACE'}) {
  const key=`role-panel:${guild.id}:${messageId}:${userId}`;
  const previous=queues.get(key) || Promise.resolve();
  const operation=previous.catch(()=>{}).then(()=>require('./workLeases').withWorkLease(key,async assertOwned=>{
    const panel=get('SELECT * FROM reaction_role_panels WHERE messageId=? AND guildId=?',[messageId,guild.id]);
    if(!panel) throw new Error('This role panel is no longer available.');
    const member=await guild.members.fetch({user:userId,force:true});
    if(member.user.bot) return;
    const mappings=all('SELECT * FROM reaction_role_mappings WHERE messageId=?',[messageId]);
    const mapped=new Set(mappings.map(row=>row.roleId));
    if(roleIds.some(id=>!mapped.has(id))) throw new Error('A selected role is no longer configured on this panel.');
    if(mode!=='REMOVE' && panel.requiredRoleId && !member.roles.cache.has(panel.requiredRoleId)) throw new Error('You do not have the role required to use this panel.');
    let selected=new Set(roleIds);
    if(mode==='ADD' && !panel.exclusive) selected=new Set([...mappings.filter(row=>member.roles.cache.has(row.roleId)).map(row=>row.roleId),...roleIds]);
    if(mode==='REMOVE') selected=new Set(mappings.filter(row=>member.roles.cache.has(row.roleId) && !roleIds.includes(row.roleId)).map(row=>row.roleId));
    if(mode==='TOGGLE') selected=member.roles.cache.has(roleIds[0]) ? new Set(mappings.filter(row=>member.roles.cache.has(row.roleId) && !roleIds.includes(row.roleId)).map(row=>row.roleId)) :
      panel.exclusive ? selected : new Set([...mappings.filter(row=>member.roles.cache.has(row.roleId)).map(row=>row.roleId),...roleIds]);
    if(panel.exclusive && selected.size>1) throw new Error('Choose one role from this panel.');
    for(const id of selected) {
      const issue=automaticRoleSafetyError(guild,guild.roles.cache.get(id));
      if(issue) throw new Error(issue);
    }
    assertOwned();
    for(const id of mapped) if(member.roles.cache.has(id) && !selected.has(id)) {
      const role=guild.roles.cache.get(id);
      if(automaticRoleSafetyError(guild,role)) throw new Error('An existing panel role is no longer safe to manage; an administrator must review it.');
      assertOwned();await member.roles.remove(role,'Role panel selection');
    }
    for(const id of selected) if(!member.roles.cache.has(id)) {assertOwned();await member.roles.add(guild.roles.cache.get(id),'Role panel selection');}
    return [...selected];
  }));
  queues.set(key,operation);
  try{return await operation;}finally{if(queues.get(key)===operation)queues.delete(key);}
}
function panelComponents(panel,guild) {
  if(panel.layout==='REACTIONS') return [];
  const mappings=all('SELECT * FROM reaction_role_mappings WHERE messageId=? ORDER BY createdAt,emojiKey',[panel.messageId]);
  if(mappings.length>25) throw new Error('Component panels support at most 25 roles. Remove extra mappings first.');
  if(!mappings.length) return [];
  if(panel.layout==='SELECT') return [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId(`rolepanel-select:${panel.messageId}`).setPlaceholder(panel.exclusive?'Choose a role':'Choose roles')
    .setMinValues(0).setMaxValues(panel.exclusive?1:mappings.length)
    .addOptions(mappings.map(row=>({label:String(guild.roles.cache.get(row.roleId)?.name || 'Unavailable role').slice(0,100),value:row.roleId}))))];
  const rows=[];
  for(let index=0;index<mappings.length;index+=5) rows.push(new ActionRowBuilder().addComponents(...mappings.slice(index,index+5).map(row=>new ButtonBuilder()
    .setCustomId(`rolepanel-button:${panel.messageId}:${row.roleId}`).setLabel(String(guild.roles.cache.get(row.roleId)?.name || 'Unavailable role').slice(0,80))
    .setStyle(ButtonStyle.Secondary).setDisabled(Boolean(automaticRoleSafetyError(guild,guild.roles.cache.get(row.roleId)))))));
  return rows;
}
async function refreshRolePanel(message,panel) {return message.edit({components:panelComponents(panel,message.guild)});}
module.exports={panelComponents,refreshRolePanel,selectPanelRoles};
