const { EmbedBuilder, PermissionFlagsBits:P } = require('discord.js');
const { all, get, run, transaction } = require('../database');
const { performModerationAction, moderationReason } = require('./moderationActions');

function raidSettings(guildId) {
  return get('SELECT * FROM raid_settings WHERE guildId=?',[guildId]) || {
    guildId,enabled:0,threshold:8,windowSeconds:60,accountAgeDays:7,action:'ALERT',timeoutMinutes:10,incidentMinutes:15
  };
}
function saveRaidSettings(guildId,actorId,values) {
  const row = { ...raidSettings(guildId),...values };
  for (const [key,min,max] of [['threshold',2,100],['windowSeconds',10,600],['accountAgeDays',1,365],
    ['timeoutMinutes',1,1440],['incidentMinutes',1,120]]) {
    if (!Number.isInteger(row[key]) || row[key]<min || row[key]>max) throw new Error(`${key} must be ${min}-${max}.`);
  }
  if (!['ALERT','TIMEOUT'].includes(row.action)) throw new Error('Choose alert or timeout.');
  if (row.enabled && !row.alertChannelId) throw new Error('Set an accessible alert channel before enabling protection.');
  run(`INSERT INTO raid_settings(guildId,enabled,alertChannelId,threshold,windowSeconds,accountAgeDays,action,
    timeoutMinutes,incidentMinutes,updatedBy,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(guildId) DO UPDATE SET
    enabled=excluded.enabled,alertChannelId=excluded.alertChannelId,threshold=excluded.threshold,windowSeconds=excluded.windowSeconds,
    accountAgeDays=excluded.accountAgeDays,action=excluded.action,timeoutMinutes=excluded.timeoutMinutes,
    incidentMinutes=excluded.incidentMinutes,updatedBy=excluded.updatedBy,updatedAt=excluded.updatedAt`,
  [guildId,Number(Boolean(row.enabled)),row.alertChannelId,row.threshold,row.windowSeconds,row.accountAgeDays,row.action,
    row.timeoutMinutes,row.incidentMinutes,actorId,Date.now()]);
  return raidSettings(guildId);
}
function exempt(member) {
  return member.user.bot || member.id === member.guild.ownerId ||
    member.permissions.has([P.Administrator]) || member.permissions.has(P.ManageGuild) ||
    member.permissions.has(P.ModerateMembers) || member.permissions.has(P.ManageRoles) || member.permissions.has(P.KickMembers) ||
    member.permissions.has(P.BanMembers) || all("SELECT roleId FROM raid_exempt_roles WHERE guildId=? UNION SELECT roleId FROM automation_managers WHERE guildId=? AND module='raid'",[member.guild.id,member.guild.id])
      .some(row => member.roles.cache.has(row.roleId));
}
async function restrictMember(guild, incident, userId) {
  const settings = raidSettings(guild.id);
  if (!settings.enabled || settings.action !== 'TIMEOUT' || incident.status !== 'ACTIVE' || incident.endsAt<=Date.now()) return;
  const member = await guild.members.fetch({user:userId,force:true});
  const bot = await guild.members.fetchMe({force:true});
  if (exempt(member) || Date.now()-member.user.createdTimestamp >= settings.accountAgeDays*86400000 ||
      !bot.permissions.has(P.ModerateMembers) || !member.moderatable || member.communicationDisabledUntilTimestamp>Date.now()) return;
  if (!run(`INSERT OR IGNORE INTO raid_actions(incidentId,userId,status) VALUES(?,?,'PENDING')`,[incident.id,userId]).changes) return;
  try {
    // Recheck the incident after network lookups; disabling protection cancels future actions.
    if (!raidSettings(guild.id).enabled || !get("SELECT id FROM raid_incidents WHERE id=? AND status='ACTIVE' AND endsAt>?",[incident.id,Date.now()])) {
      run("UPDATE raid_actions SET status='CANCELLED' WHERE incidentId=? AND userId=?",[incident.id,userId]); return;
    }
    const expiresAt = Date.now()+settings.timeoutMinutes*60000;
    await performModerationAction({guildId:guild.id,userId,moderatorId:bot.id,action:'AUTO-TIMEOUT',
      reason:`Anti-raid incident #${incident.id}: new account during a join burst`,duration:settings.timeoutMinutes*60000,expiresAt},
    async record => {
      run('UPDATE raid_actions SET recordId=?,expiresAt=? WHERE incidentId=? AND userId=?',[record.recordId,expiresAt,incident.id,userId]);
      await member.disableCommunicationUntil(expiresAt,moderationReason(`Anti-raid incident #${incident.id}`,record));
    });
    run("UPDATE raid_actions SET status='APPLIED' WHERE incidentId=? AND userId=?",[incident.id,userId]);
  } catch (error) {
    run("UPDATE raid_actions SET status='REVIEW',error=? WHERE incidentId=? AND userId=?",[String(error.message).slice(0,1000),incident.id,userId]);
  }
}
async function handleRaidJoin(member, client) {
  if (member.user.bot) return;
  const settings = raidSettings(member.guild.id);
  if (!settings.enabled) return;
  const now = Date.now();
  run('INSERT OR IGNORE INTO raid_joins(guildId,userId,joinedAt) VALUES(?,?,?)',[member.guild.id,member.id,member.joinedTimestamp || now]);
  const recent = all('SELECT DISTINCT userId FROM raid_joins WHERE guildId=? AND joinedAt>=?',[member.guild.id,now-settings.windowSeconds*1000]);
  let opened = false;
  const incident = transaction(() => {
    run("UPDATE raid_incidents SET status='EXPIRED' WHERE guildId=? AND status='ACTIVE' AND endsAt<=?",[member.guild.id,now]);
    let active = get("SELECT * FROM raid_incidents WHERE guildId=? AND status='ACTIVE'",[member.guild.id]);
    if (!active && recent.length>=settings.threshold) {
      const result = run('INSERT INTO raid_incidents(guildId,startedAt,endsAt) VALUES(?,?,?)',[member.guild.id,now,now+settings.incidentMinutes*60000]);
      active = get('SELECT * FROM raid_incidents WHERE id=?',[Number(result.lastInsertRowid)]); opened = true;
    }
    return active;
  });
  if (!incident) return;
  if (!incident.alertMessageId) {
    const channel = await client.channels.fetch(settings.alertChannelId);
    if (channel?.guild?.id !== member.guild.id) throw new Error('Anti-raid alert channel is unavailable.');
    const payload={ embeds:[new EmbedBuilder().setTitle(`Join burst | Incident #${incident.id}`)
      .setDescription(`${recent.length} joins in ${settings.windowSeconds}s. Mode: ${settings.action}.\nA join burst is not proof of abuse. Review before taking further action.`)
      .addFields({name:'Review window',value:`Until <t:${Math.floor(incident.endsAt/1000)}:F>`},
        {name:'Automatic restriction',value:settings.action === 'TIMEOUT' ? `Only accounts younger than ${settings.accountAgeDays} days; staff and exemptions excluded.` : 'Disabled: alert only'})
      .setColor(0xED4245).setTimestamp(incident.startedAt)],allowedMentions:{parse:[]} };
    const {enqueueDelivery,deliverOnce,sendQueuedMessage}=require('./deliveryOutbox');
    const key=`raid-alert:${incident.id}`;
    enqueueDelivery({deliveryKey:key,type:'RAID_ALERT',guildId:member.guild.id,channelId:channel.id,payload:{message:payload}});
    const alert=await deliverOnce(key,claimed=>sendQueuedMessage(channel,claimed,payload));
    if(alert?.status!=='SENT') return;
    run('UPDATE raid_incidents SET alertMessageId=? WHERE id=?',[alert.messageId,incident.id]);
  }
  for (const row of (opened ? recent.slice(0,100) : [{userId:member.id}])) {
    try { await restrictMember(member.guild,incident,row.userId); }
    catch (error) { console.error('Anti-raid member check:',error.message); }
  }
}
async function endIncident(guild, actorId, release = false) {
  const incident = get("SELECT * FROM raid_incidents WHERE guildId=? AND status='ACTIVE'",[guild.id]);
  if (!incident) return { released:0,failed:0 };
  run("UPDATE raid_incidents SET status='ENDED',endedBy=?,endsAt=? WHERE id=?",[actorId,Date.now(),incident.id]);
  let released=0,failed=0;
  if (release) for (const row of all("SELECT * FROM raid_actions WHERE incidentId=? AND status='APPLIED'",[incident.id])) {
    try {
      const member = await guild.members.fetch({user:row.userId,force:true});
      if (Math.abs(Number(member.communicationDisabledUntilTimestamp)-row.expiresAt)<1000 && row.expiresAt>Date.now()) {
        await performModerationAction({guildId:guild.id,userId:row.userId,moderatorId:actorId,action:'UNMUTE',reason:`Anti-raid incident #${incident.id} ended`},
          record => member.timeout(null,moderationReason('Anti-raid review release',record)));
        run("UPDATE raid_actions SET status='RELEASED' WHERE incidentId=? AND userId=?",[incident.id,row.userId]); released++;
      }
    } catch { failed++; }
  }
  return { released,failed };
}
function startAutomationMaintenance(client) {
  if (client.automationMaintenance) return;
  client.automationMaintenance = require('./serviceRunner').startManagedLoop('automation-maintenance',async () => {
    const now = Date.now();
    run("UPDATE raid_incidents SET status='EXPIRED' WHERE status='ACTIVE' AND endsAt<=?",[now]);
    run('DELETE FROM raid_joins WHERE joinedAt<?',[now-86400000]);
    run('DELETE FROM leveling_content_receipts WHERE awardedAt<?',[now-86400000]);
    run(`UPDATE raid_actions SET status='APPLIED' WHERE status IN ('PENDING','REVIEW') AND recordId IN
      (SELECT recordId FROM moderation_actions WHERE status='COMPLETED')`);
    for (const row of all('SELECT guildId FROM safety_policies WHERE warningDecayDays>0')) require('./safetyPolicies').expireWarnings(row.guildId,now);
    await require('./moderationActions').reconcileModerationActions(client,now);
  },60000,{ timeoutMs:55000 });
}
module.exports = { endIncident, exempt, handleRaidJoin, raidSettings, restrictMember, saveRaidSettings, startAutomationMaintenance };
