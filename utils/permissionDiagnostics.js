const { PermissionFlagsBits: P, PermissionsBitField } = require('discord.js');
const { get } = require('../database');
const { getCommandAvailability } = require('./commandControls');

function commandReport({ guild, member, channel, command, name }) {
  const checks = [];
  if (!command) return [{ passed:false, label:'Command is not loaded by this running build.' }];
  const availability = getCommandAvailability({ guild,member,channel,channelId:channel.id,commandName:name });
  checks.push({ passed:availability.allowed,label:`Server command controls${availability.reason ? `: ${availability.reason}` : ''}` });
  const channelPermissions = channel.permissionsFor(member);
  checks.push({ passed:!!channelPermissions?.has([P.ViewChannel,P.UseApplicationCommands]),label:'View Channel and Use Application Commands in the selected channel' });
  if(['factsources','dailyfactsource'].includes(name)) checks.push({passed:channel.id===require('./dailyFactReview').reviewChannelId(),label:'Must be used in the private fact-review channel'});
  const settings = get('SELECT * FROM guild_settings WHERE guildId=?',[guild.id]) || {};
  let permission = require('./commandPermissions').permissionDefaults[name] ?? command.data.toJSON().default_member_permissions;
  let custom;
  if (name === 'application') {
    permission = P.Administrator;
    custom = require('./applicationAccess').canManageApplications(member,settings.applicationCreatorRoleId);
  } else if (name === 'censor') {
    permission = P.ManageGuild;
    custom = member.permissions.has(P.ManageGuild) || !!member.roles.cache.has(settings.censorRoleId);
  } else if (name === 'logging') {
    permission = P.Administrator;
    custom = member.permissions.has(P.Administrator) || !!get(`SELECT 1 FROM logging_manager_roles WHERE guildId=? AND roleId IN
      (SELECT value FROM json_each(?))`,[guild.id,JSON.stringify([...member.roles.cache.keys()])]);
  }
  if (permission !== undefined && permission !== null) {
    checks.push({passed: custom ?? member.permissions.has(BigInt(permission)),
      label:`Default command permission: ${new PermissionsBitField(BigInt(permission)).toArray().join(', ') || 'No default access'}${custom !== undefined ? ' or configured manager role' : ''}` });
  }
  checks.push({passed:null,label:'Discord integration command overrides, subcommand-specific guards, cooldowns and target hierarchy are not simulated. A passing report does not grant permission.'});
  return checks;
}

function ticketReport({ guild, member, channel }) {
  const ticket = get('SELECT * FROM tickets WHERE guildId=? AND channelId=?',[guild.id,channel.id]);
  if (!ticket) return [{passed:false,label:'This channel has no stored ticket record.'}];
  return [
    {passed:!!channel.permissionsFor(member)?.has(P.ViewChannel),label:'Can view the ticket channel'},
    {passed:require('./tickets/permissions').canCloseTicket({member,guildId:guild.id,type:ticket.type,channelId:channel.id}),
      label:`Can manage this ${ticket.type} ticket using the configured reviewer/staff role, explicit ticket staff or Administrator`},
    {passed:ticket.status === 'OPEN',label:`Stored ticket status: ${ticket.status}`}
  ];
}

function filterReport({guild,member,channel}) {
  const settings = get('SELECT * FROM guild_settings WHERE guildId=?',[guild.id]) || {};
  const {parseIdList,hasWhitelistedRole,isWhitelistedChannel} = require('./contentFilterWhitelist');
  return ['link','censor'].map(kind => {
    const roles = parseIdList(settings[`${kind}BypassRoleIds`]);
    if (kind === 'link' && settings.linkBypassRoleId) roles.push(settings.linkBypassRoleId);
    const bypass = hasWhitelistedRole(member,roles) || isWhitelistedChannel({channel},
      parseIdList(settings[`${kind}BypassChannelIds`]),parseIdList(settings[`${kind}BypassCategoryIds`]));
    return {passed:null,label:`${kind === 'link' ? 'Link block' : 'Censor'}: ${settings[kind === 'link' ? 'linkBlockEnabled' : 'censorEnabled'] ? 'enabled' : 'disabled'}; configured whitelist ${bypass ? 'matches' : 'does not match'}.`};
  }).concat([{passed:null,label:'Ticket exemptions, anti-racism, phishing protection and Discord AutoMod have separate checks. Whitelisting is not a promise that arbitrary content is allowed.'}]);
}

module.exports = { commandReport, filterReport, ticketReport };
