const { PermissionFlagsBits: P, escapeMarkdown } = require('discord.js');
const { all, get, run } = require('../database');
const { useCooldown } = require('./cooldowns');
const { containsBuiltInUnsafeLanguage } = require('./dailyInteractionSafety');
const { findCensoredTerm, listCensorTerms } = require('./censor');

const MODULES = new Set(['raid', 'tag', 'response', 'safety','prompts']);
async function freshMember(guild, userId) {
  return guild.members.fetch({ user:userId, force:true });
}
function canManage(member, module) {
  if (!MODULES.has(module)) return false;
  if (member.permissions.has(P.Administrator)) return true;
  return all('SELECT roleId FROM automation_managers WHERE guildId=? AND module=?', [member.guild.id,module])
    .some(row => member.roles.cache.has(row.roleId));
}
async function requireManager(interaction, module, adminOnly = false) {
  const member = await freshMember(interaction.guild, interaction.user.id);
  if (adminOnly ? !member.permissions.has(P.Administrator) : !canManage(member,module)) {
    throw new Error(adminOnly ? 'Only administrators can assign management roles.' : `You need Administrator or a configured ${module} management role.`);
  }
  return member;
}
function entryName(value) {
  const name = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(name)) throw new Error('Use a name of 1-32 letters, digits, underscores or hyphens.');
  return name;
}
function validateTemplate(guildId, template) {
  if (!template || template.length > 1800) throw new Error('Templates must contain 1-1800 characters.');
  if (/@(?:everyone|here)|<@(?:!?|&)?\d+>|<#[0-9]+>/i.test(template)) throw new Error('Use {user} for a non-pinging member name; literal mentions are not allowed.');
  if (containsBuiltInUnsafeLanguage(template) || findCensoredTerm(template,listCensorTerms(guildId),'AGGRESSIVE')) {
    throw new Error('This template contains blocked language.');
  }
  const unknown = [...template.matchAll(/\{([^{}]+)\}/g)].map(match => match[1])
    .filter(key => !['user','username','server','channel','member_count'].includes(key));
  if (unknown.length) throw new Error('Supported variables: {user}, {username}, {server}, {channel}, {member_count}.');
  return template;
}
function saveEntry(guildId, actorId, values, existing = null) {
  const name = entryName(values.name);
  const kind = values.kind;
  if (!['TAG','RESPONSE'].includes(kind)) throw new Error('Invalid automation type.');
  const template = validateTemplate(guildId,values.template);
  const trigger = kind === 'RESPONSE' ? String(values.triggerText || '').normalize('NFKC').trim().toLowerCase() : null;
  if (kind === 'RESPONSE' && (!trigger || trigger.length > 150)) throw new Error('Response triggers must contain 1-150 characters.');
  const cooldown = values.cooldownSeconds ?? 30;
  if (!Number.isInteger(cooldown) || cooldown < 5 || cooldown > 86400) throw new Error('Cooldown must be 5-86400 seconds.');
  if (existing && existing.kind !== kind) throw new Error('An entry with this name belongs to another automation type.');
  const mode = values.matchMode || 'EXACT';
  if (!['EXACT','CONTAINS'].includes(mode)) throw new Error('Invalid match mode.');
  run(`INSERT INTO automation_entries(guildId,name,kind,template,triggerText,matchMode,useRoleId,channelId,cooldownSeconds,createdBy,updatedAt)
    VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(guildId,name) DO UPDATE SET template=excluded.template,
    triggerText=excluded.triggerText,matchMode=excluded.matchMode,useRoleId=excluded.useRoleId,
    channelId=excluded.channelId,cooldownSeconds=excluded.cooldownSeconds,updatedAt=excluded.updatedAt`,
  [guildId,name,kind,template,trigger,mode,values.useRoleId || null,values.channelId || null,cooldown,actorId,Date.now()]);
  return get('SELECT * FROM automation_entries WHERE guildId=? AND name=?',[guildId,name]);
}
function renderEntry(entry, member, channel) {
  const values = { user:member.displayName || member.user.username, username:member.user.username,
    server:member.guild.name, channel:channel.name, member_count:String(member.guild.memberCount) };
  for(const key of ['user','username','server','channel']) {
    if(containsBuiltInUnsafeLanguage(values[key]) || require('./linkDetection').hasLink(values[key])) values[key]=key==='user' || key==='username'?'member':key;
  }
  const content = entry.template.replace(/\{(user|username|server|channel|member_count)\}/g,
    (_,key) => escapeMarkdown(String(values[key] || '').replace(/@/g,'\u200b@')));
  validateTemplate(member.guild.id, content.replace(/\{[^{}]+\}/g,''));
  return content;
}
async function deliverEntry(entry, member, channel, send) {
  if (!entry.enabled || member.user.bot || (entry.useRoleId && !member.roles.cache.has(entry.useRoleId)) ||
      (entry.channelId && entry.channelId !== channel.id)) return { delivered:false, reason:'restricted' };
  const permissions = channel.permissionsFor(member);
  if (!permissions?.has([P.ViewChannel,P.SendMessages])) return { delivered:false,reason:'channel-access' };
  const bot = member.guild.members.me;
  if (!bot || !channel.permissionsFor(bot)?.has([P.ViewChannel,P.SendMessages])) throw new Error('I cannot send messages in this channel.');
  const content = renderEntry(entry,member,channel);
  const remaining = await useCooldown(entry.guildId,member.id,`automation:${entry.name}`,entry.cooldownSeconds*1000);
  if (remaining) return { delivered:false,reason:`Try again in ${Math.ceil(remaining/1000)} seconds.` };
  // Server-wide response limits prevent different users from flooding the same trigger.
  if (entry.kind === 'RESPONSE' && await useCooldown(entry.guildId,'shared',`response:${entry.name}`,5000)) {
    return { delivered:false,reason:'busy' };
  }
  await send({ content,allowedMentions:{ parse:[],repliedUser:false } });
  run('UPDATE automation_entries SET uses=uses+1 WHERE guildId=? AND name=?',[entry.guildId,entry.name]);
  return { delivered:true };
}
async function handleAutoResponse(message) {
  if (!message.guild || message.author.bot || message.webhookId || message.system || !message.content) return false;
  const text = message.content.normalize('NFKC').trim().toLowerCase();
  const entries = all("SELECT * FROM automation_entries WHERE guildId=? AND kind='RESPONSE' AND enabled=1 ORDER BY name LIMIT 100",[message.guild.id]);
  const entry = entries.find(row => row.matchMode === 'EXACT' ? text === row.triggerText : text.includes(row.triggerText));
  if (!entry) return false;
  const member = await freshMember(message.guild,message.author.id);
  return (await deliverEntry(entry,member,message.channel,payload => message.channel.send(payload))).delivered;
}
module.exports = { MODULES, canManage, deliverEntry, entryName, freshMember, handleAutoResponse, renderEntry,
  requireManager, saveEntry, validateTemplate };
