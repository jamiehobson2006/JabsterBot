const { PermissionFlagsBits: P } = require('discord.js');
const { get,run } = require('../database');
const FEATURES = new Set(['knowledge','challenge','partner','temprole']);
function settings(guildId,feature) {
  if(!FEATURES.has(feature)) throw new Error('Unknown community feature.');
  return get('SELECT * FROM community_access WHERE guildId=? AND feature=?',[guildId,feature]) || {guildId,feature};
}
function isAdmin(member) { return Boolean(member?.permissions?.has(P.Administrator)); }
function canManage(member,feature) {
  const config=settings(member.guild.id,feature);
  return isAdmin(member) || Boolean(config.managerRoleId && member.roles.cache.has(config.managerRoleId));
}
function canUse(member,feature) {
  const config=settings(member.guild.id,feature);
  return isAdmin(member) || !config.useRoleId || member.roles.cache.has(config.useRoleId);
}
async function requireAccess(interaction,feature,management=false) {
  const member=await interaction.guild.members.fetch({user:interaction.user.id,force:true});
  if(!(management?canManage(member,feature):canUse(member,feature))) throw new Error(management?
    'Administrator or the configured management role is required.':'You do not have the role required to use this feature.');
  return member;
}
function validRole(guild,role) {
  if(role && (role.guild?.id && role.guild.id!==guild.id || role.id===guild.id || role.managed)) throw new Error('Choose a normal role in this server.');
}
async function configureAccess(interaction,feature) {
  const member=await interaction.guild.members.fetch({user:interaction.user.id,force:true});
  if(!isAdmin(member)) throw new Error('Only administrators can change management or usage roles.');
  const before=settings(interaction.guild.id,feature);
  const manager=interaction.options.getRole('manager_role'),user=interaction.options.getRole('required_role');
  validRole(interaction.guild,manager);validRole(interaction.guild,user);
  const clear=interaction.options.getString('clear');
  const managerId=clear==='manager'?null:manager?.id ?? before.managerRoleId ?? null;
  const userId=clear==='required'?null:user?.id ?? before.useRoleId ?? null;
  run(`INSERT INTO community_access(guildId,feature,managerRoleId,useRoleId) VALUES(?,?,?,?) ON CONFLICT(guildId,feature)
    DO UPDATE SET managerRoleId=excluded.managerRoleId,useRoleId=excluded.useRoleId`,[interaction.guild.id,feature,managerId,userId]);
  return `Management: ${managerId?`<@&${managerId}>`:'Administrator only'}\nUsage: ${userId?`<@&${userId}>`:'All members'}`;
}
function accessCommand(data) {
  return data.addSubcommand(command=>command.setName('configure').setDescription('Administrator: configure management and usage roles.')
    .addRoleOption(option=>option.setName('manager_role').setDescription('Role allowed to manage this feature'))
    .addRoleOption(option=>option.setName('required_role').setDescription('Role required for ordinary use'))
    .addStringOption(option=>option.setName('clear').setDescription('Remove a saved role restriction')
      .addChoices({name:'Management role',value:'manager'},{name:'Required role',value:'required'})));
}
function safeText(value,max,{required=true}={}) {
  const text=String(value || '').trim();
  if(required && !text || text.length>max) throw new Error(`Text must contain ${required?'1':'0'}-${max} characters.`);
  if(require('./dailyInteractionSafety').containsBuiltInUnsafeLanguage(text)) throw new Error('This content contains blocked language.');
  return text;
}
function slug(value) {
  const name=String(value || '').trim().toLowerCase();
  if(!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(name)) throw new Error('Names must use 1-32 letters, digits, hyphens or underscores.');
  safeText(name,32);
  return name;
}
function pageRows(rows,page=1,size=8) {return rows.slice((Math.max(1,page)-1)*size,Math.max(1,page)*size);}
module.exports={FEATURES,accessCommand,canManage,canUse,configureAccess,isAdmin,pageRows,requireAccess,safeText,settings,slug,validRole};
