const {randomUUID}=require('node:crypto');
const {PermissionFlagsBits:P,AuditLogEvent}=require('discord.js');
const {all,get,run}=require('../database');
const access=require('./communityAccess');
function duration(value){
  const match=String(value || '').match(/^(\d+)(m|h|d)$/i);
  const ms=match?Number(match[1])*{m:60000,h:3600000,d:86400000}[match[2].toLowerCase()]:0;
  if(!Number.isSafeInteger(ms) || ms<60000 || ms>30*86400000)throw new Error('Use a duration from 1m to 30d.');
  return ms;
}
function job(guildId,id){return get('SELECT * FROM temporary_role_jobs WHERE id=? AND guildId=?',[id,guildId]);}
async function roleContext(guild,roleId,userId){
  await guild.members.fetchMe({force:true});
  const role=await guild.roles.fetch(roleId),member=await guild.members.fetch({user:userId,force:true});
  const issue=require('./roleSafety').automaticRoleSafetyError(guild,role);if(issue)throw new Error(issue);
  if(!guild.members.me.permissions.has(P.ViewAuditLog))throw new Error('View Audit Log permission is required to verify ownership before temporary-role expiry.');
  return {role,member};
}
async function schedule(interaction,{userId,roleId,time,delay=null,selfClaim=false,reason}){
  const guild=interaction.guild;
  const actor=await access.requireAccess(interaction,'temprole',!selfClaim);
  const allowed=get('SELECT * FROM temporary_role_allowlist WHERE guildId=? AND roleId=?',[guild.id,roleId]);
  if(!allowed || selfClaim && !allowed.selfClaim)throw new Error('This role is not approved for that temporary-role action.');
  if(selfClaim && userId!==actor.id)throw new Error('You can only claim a temporary role for yourself.');
  const lifetime=duration(time),wait=delay?duration(delay):0;
  if(lifetime>allowed.maxHours*3600000)throw new Error(`This role permits up to ${allowed.maxHours} hours.`);
  const {role,member}=await roleContext(guild,roleId,userId);
  if(member.user.bot || member.roles.cache.has(roleId))throw new Error('The recipient must be a person who does not already have this role. Existing permanent roles are never scheduled for removal.');
  if(!selfClaim && actor.id!==guild.ownerId && role.position>=actor.roles.highest.position)throw new Error('You cannot schedule a role at or above your highest role.');
  reason=access.safeText(reason || 'Temporary role',300);
  const id=randomUUID(),now=Date.now();
  run('INSERT INTO temporary_role_jobs(id,guildId,userId,roleId,actorId,selfClaim,startsAt,expiresAt,reason,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?)',
    [id,guild.id,userId,roleId,actor.id,Number(selfClaim),now+wait,now+wait+lifetime,reason,now]);
  if(!wait)await processJob(interaction.client,id);
  return job(guild.id,id);
}
async function latestRoleChange(guild,row){
  const audit=await guild.fetchAuditLogs({type:AuditLogEvent.MemberRoleUpdate,limit:100});
  return audit.entries.find(entry=>entry.target?.id===row.userId && (entry.changes || []).some(change=>
    ['$add','$remove'].includes(change.key) && (change.new || []).some(role=>role.id===row.roleId)));
}
function ownedEvent(entry,row,botId){return Boolean(entry && entry.executor?.id===botId && entry.reason?.includes(`temporary-role:${row.id}`) &&
  entry.changes?.some(change=>change.key==='$add' && (change.new || []).some(role=>role.id===row.roleId)));}
async function processJob(client,id,{forceExpire=false,now=Date.now()}={}){
  return require('./workLeases').withWorkLease(`temporary-role-job:${id}`,async assertOwned=>{
    let row=get('SELECT * FROM temporary_role_jobs WHERE id=?',[id]);
    if(!row || !['SCHEDULED','APPLYING','ACTIVE','REMOVING'].includes(row.status))return row;
    const guild=client.guilds.cache.get(row.guildId);if(!guild)throw new Error('Server unavailable; retaining the role schedule.');
    if(row.status==='SCHEDULED' && forceExpire){run("UPDATE temporary_role_jobs SET status='CANCELLED' WHERE id=?",[id]);return job(row.guildId,id);}
    let context;
    try{context=await roleContext(guild,row.roleId,row.userId);}
    catch(error){
      if([10007,10011].includes(Number(error.code))){run("UPDATE temporary_role_jobs SET status='ABSENT',lastError=? WHERE id=?",[error.message,id]);return job(row.guildId,id);}
      throw error;
    }
    const {member,role}=context;
    if(['APPLYING','ACTIVE','REMOVING'].includes(row.status)){
      if(!member.roles.cache.has(row.roleId)){run("UPDATE temporary_role_jobs SET status='EXPIRED',lastError=NULL WHERE id=?",[id]);return job(row.guildId,id);}
      const latest=await latestRoleChange(guild,row);
      if(!ownedEvent(latest,row,client.user.id)){
        run("UPDATE temporary_role_jobs SET status='REVIEW',lastError='Role ownership changed or could not be verified; no role was removed.' WHERE id=?",[id]);
        return job(row.guildId,id);
      }
      if(row.status==='APPLYING'){run("UPDATE temporary_role_jobs SET status='ACTIVE',lastError=NULL WHERE id=?",[id]);row=job(row.guildId,id);}
      if(row.expiresAt>now && !forceExpire)return row;
      assertOwned();run("UPDATE temporary_role_jobs SET status='REMOVING' WHERE id=?",[id]);
      await member.roles.remove(role,`Temporary role expired | temporary-role:${row.id}`);
      run("UPDATE temporary_role_jobs SET status='EXPIRED',lastError=NULL WHERE id=?",[id]);
    }else{
      if(row.startsAt>now)return row;
      if(row.expiresAt<=now){run("UPDATE temporary_role_jobs SET status='EXPIRED',lastError='Schedule expired while the bot was offline; no role was granted.' WHERE id=?",[id]);return job(row.guildId,id);}
      const actor=await guild.members.fetch({user:row.actorId,force:true});
      const allowed=get('SELECT * FROM temporary_role_allowlist WHERE guildId=? AND roleId=?',[guild.id,row.roleId]);
      const eligible=allowed && row.expiresAt-row.startsAt<=allowed.maxHours*3600000 &&
        (row.selfClaim?allowed.selfClaim && access.canUse(actor,'temprole'):access.canManage(actor,'temprole') &&
          (actor.id===guild.ownerId || role.position<actor.roles.highest.position));
      if(!eligible || member.roles.cache.has(row.roleId)){
        run("UPDATE temporary_role_jobs SET status='CANCELLED',lastError='Eligibility changed or role already exists; no role was granted.' WHERE id=?",[id]);return job(row.guildId,id);
      }
      assertOwned();run("UPDATE temporary_role_jobs SET status='APPLYING' WHERE id=?",[id]);
      await member.roles.add(role,`${row.reason} | temporary-role:${row.id}`);
      run("UPDATE temporary_role_jobs SET status='ACTIVE',lastError=NULL WHERE id=?",[id]);
    }
    const updated=job(row.guildId,id);
    await require('./logger').logAudit(client,row.guildId,{action:'TEMPORARY_ROLE_CHANGED',type:'SERVER',targetId:row.userId,
      executorId:row.actorId,metadata:{roleId:row.roleId,status:updated.status,expiresAt:row.expiresAt}}).catch(()=>{});
    return updated;
  });
}
async function maintain(client){
  const rows=all(`SELECT id FROM temporary_role_jobs WHERE nextAttemptAt<=? AND
    ((status='SCHEDULED' AND startsAt<=?) OR status='APPLYING' OR status='REMOVING' OR (status='ACTIVE' AND expiresAt<=?))
    ORDER BY expiresAt LIMIT 100`,[Date.now(),Date.now(),Date.now()]);
  for(const row of rows)try{await processJob(client,row.id);}catch(error){run('UPDATE temporary_role_jobs SET lastError=?,nextAttemptAt=? WHERE id=?',[String(error.message).slice(0,500),Date.now()+60000,row.id]);}
  return rows.length;
}
function resolveReview(member,id,reason){
  if(!access.isAdmin(member))throw new Error('Only administrators may resolve ownership reviews.');
  reason=access.safeText(reason,500);
  const changed=run(`UPDATE temporary_role_jobs SET status='CANCELLED',resolutionActorId=?,resolutionReason=?,lastError=NULL
    WHERE id=? AND guildId=? AND status='REVIEW'`,[member.id,reason,id,member.guild.id]);
  if(!changed.changes)throw new Error('No schedule awaiting ownership review was found in this server.');
  return job(member.guild.id,id);
}
module.exports={duration,job,latestRoleChange,maintain,ownedEvent,processJob,resolveReview,roleContext,schedule};
