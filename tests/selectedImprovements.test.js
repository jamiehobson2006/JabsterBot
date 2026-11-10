const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {Collection,PermissionFlagsBits:P,PermissionsBitField,ChannelType}=require('discord.js');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'jabster-selected-'));
process.env.DATABASE_PATH=path.join(temporary,'test.db');
const {db,run,get,all,initDatabase}=require('../database');
initDatabase();
test.after(()=>{db.close();fs.rmSync(temporary,{recursive:true,force:true});});
const permissions=value=>new PermissionsBitField(value || 0n);
const automation=require('../utils/automation');
const raid=require('../utils/raidProtection');
function fixture(id='guild') {
  const members=new Collection(),channels=new Collection();
  const guild={id,name:'Test server',ownerId:'owner',memberCount:3,roles:{cache:new Collection()},
    members:{fetch:async input=>input ? members.get(typeof input==='string'?input:input.user):members},
    channels:{cache:channels,fetch:async input=>input ? channels.get(input):channels}};
  const bot={id:'bot',guild,permissions:permissions(P.Administrator),roles:{highest:{position:100}},user:{id:'bot',bot:true}};
  guild.members.me=bot;guild.members.fetchMe=async()=>bot;members.set('bot',bot);
  const channel={id:'channel',name:'general',guild,guildId:id,type:ChannelType.GuildText,permissionsFor:()=>permissions(P.Administrator),
    send:async payload=>{channel.sent.push(payload);return{id:`sent-${channel.sent.length}`};},sent:[]};
  channels.set(channel.id,channel);
  const client={user:bot.user,guilds:{cache:new Collection([[id,guild]])},channels:{fetch:async input=>channels.get(input)}};
  const member=(id,roles=[],privileges=0n)=>{
    const value={id,guild,displayName:id,user:{id,username:id,bot:false,createdTimestamp:Date.now()-60000},
      joinedTimestamp:Date.now(),permissions:permissions(privileges),moderatable:true,roles:{cache:new Collection(roles.map(id=>[id,{id}])),highest:{position:1}}};
    value.disableCommunicationUntil=async expiry=>{value.communicationDisabledUntilTimestamp=expiry;value.timeouts=(value.timeouts || 0)+1;};
    value.timeout=async duration=>{value.communicationDisabledUntilTimestamp=duration?Date.now()+duration:null;};
    members.set(id,value);return value;
  };
  return{guild,channel,client,member,members};
}

test('automation stays global, fits the command schema and separates ordinary use from management',()=>{
  const command=require('../commands/config/automation').data.toJSON();
  assert.equal(command.name,'automation');assert.equal(command.dm_permission,false);
  assert.equal(command.default_member_permissions,undefined);
  require('../utils/commandValidation').validateGlobalCommands([command]);
  assert.ok(command.options.some(group=>group.name==='raid'));
  const f=fixture('access'),member=f.member('member',['tag-manager']);
  assert.equal(automation.canManage(member,'tag'),false);
  run("INSERT INTO automation_managers VALUES('access','tag','tag-manager')");
  assert.equal(automation.canManage(member,'tag'),true);
  assert.equal(automation.canManage(member,'raid'),false);
});

test('every command fits global registration count, character budgets and required-option ordering',()=>{
  const {definitions:commands}=require('../utils/commandRegistry').loadCommandRegistry();
  assert.equal(commands.length,61);
  require('../utils/commandValidation').validateGlobalCommands(commands);
});

test('tag restrictions, safe rendering and cooldown claims survive module reload and concurrent requests',async()=>{
  const f=fixture('tags'),member=f.member('member',['required']);
  const entry=automation.saveEntry('tags','admin',{name:'rules',kind:'TAG',template:'Welcome {user} to {server}.',useRoleId:'required',channelId:'channel',cooldownSeconds:30});
  const results=await Promise.all([1,2].map(()=>automation.deliverEntry(entry,member,f.channel,payload=>f.channel.send(payload))));
  assert.equal(results.filter(row=>row.delivered).length,1);assert.equal(f.channel.sent.length,1);
  assert.deepEqual(f.channel.sent[0].allowedMentions,{parse:[],repliedUser:false});
  assert.equal((await automation.deliverEntry(entry,f.member('other'),f.channel,()=>{throw new Error('must not send');})).delivered,false);
  delete require.cache[require.resolve('../utils/automation')];
  assert.equal((await require('../utils/automation').deliverEntry(entry,member,f.channel,()=>{throw new Error('cooldown bypass');})).delivered,false);
  for(const template of ['@everyone hello','<@12345678901234567>','{eval}','.fuck']) assert.throws(()=>automation.validateTemplate('tags',template));
  const child=spawnSync(process.execPath,['-e',"const d=require('./database');d.initDatabase();if(!d.get(\"SELECT 1 FROM automation_entries WHERE guildId='tags'\"))process.exitCode=1;d.db.close();"],{cwd:path.join(__dirname,'..'),env:process.env,encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);
});

test('autoresponders ignore bot loops and only match configured literal triggers in allowed channels',async()=>{
  const f=fixture('responses'),member=f.member('member');
  automation.saveEntry('responses','admin',{name:'hello',kind:'RESPONSE',template:'Hello there.',triggerText:'hello',matchMode:'EXACT',cooldownSeconds:10,channelId:'channel'});
  const message={guild:f.guild,author:member.user,content:'hello',channel:f.channel};
  assert.equal(await automation.handleAutoResponse({...message,author:{bot:true}}),false);
  assert.equal(await automation.handleAutoResponse({...message,webhookId:'hook'}),false);
  assert.equal(await automation.handleAutoResponse({...message,content:'hello unrelated words'}),false);
  assert.equal(await automation.handleAutoResponse(message),true);
  assert.equal(f.channel.sent.length,1);
});

test('anti-raid is opt-in, alert-only by default, and persists one incident for a join burst',async()=>{
  const f=fixture('raid-alert'),a=f.member('one'),b=f.member('two');
  await raid.handleRaidJoin(a,f.client);assert.equal(all("SELECT * FROM raid_joins WHERE guildId='raid-alert'").length,0);
  raid.saveRaidSettings(f.guild.id,'admin',{enabled:1,alertChannelId:'channel',threshold:2});
  await raid.handleRaidJoin(a,f.client);await raid.handleRaidJoin(b,f.client);await raid.handleRaidJoin(b,f.client);
  assert.equal(f.channel.sent.length,1);
  assert.equal(all("SELECT * FROM raid_incidents WHERE guildId='raid-alert'").length,1);
  assert.equal(a.timeouts,undefined);assert.equal(b.timeouts,undefined);
  assert.equal(raid.raidSettings(f.guild.id).action,'ALERT');
});

test('anti-raid timeout mode records cases, excludes staff/exempt roles and safely releases only its unchanged timeouts',async()=>{
  const f=fixture('raid-timeout'),a=f.member('one'),b=f.member('two',['safe']),staff=f.member('staff',[],P.ModerateMembers);
  raid.saveRaidSettings(f.guild.id,'admin',{enabled:1,action:'TIMEOUT',alertChannelId:'channel',threshold:2});
  run("INSERT INTO raid_exempt_roles VALUES('raid-timeout','safe')");
  await raid.handleRaidJoin(a,f.client);await raid.handleRaidJoin(b,f.client);await raid.handleRaidJoin(staff,f.client);
  assert.equal(a.timeouts,1);assert.equal(b.timeouts,undefined);assert.equal(staff.timeouts,undefined);
  assert.equal(get("SELECT COUNT(*) AS count FROM cases WHERE guildId='raid-timeout'").count,1);
  a.communicationDisabledUntilTimestamp+=60000;
  const result=await raid.endIncident(f.guild,'admin',true);
  assert.equal(result.released,0);assert.ok(a.communicationDisabledUntilTimestamp>Date.now());
});

test('warning decay removes active counts, never case history, and thresholds can be customized',async()=>{
  const safety=require('../utils/safetyPolicies'),actions=require('../utils/moderationActions');
  safety.saveSafetyPolicy('warning-policy',{warningDecayDays:1,thresholds:{2:120}},'admin');
  assert.equal(safety.warningTimeout('warning-policy',2),120000);
  const result=await actions.performModerationAction({guildId:'warning-policy',userId:'member',moderatorId:'admin',action:'WARN'},async()=>{});
  run('UPDATE cases SET createdAt=?,timestamp=? WHERE id=?',[Date.now()-172800000,Date.now()-172800000,result.caseId]);
  assert.equal(safety.expireWarnings('warning-policy'),1);
  assert.equal(get('SELECT warningActive FROM cases WHERE id=?',[result.caseId]).warningActive,0);
  assert.equal(get("SELECT count FROM warns WHERE guildId='warning-policy'"),undefined);
  assert.equal(safety.expireWarnings('warning-policy'),0);
});

test('unknown moderation outcomes recover a tagged audit event without repeating the punishment',async()=>{
  const actions=require('../utils/moderationActions');
  let calls=0;
  await assert.rejects(actions.performModerationAction({guildId:'uncertain',userId:'member',moderatorId:'bot',action:'KICK'},async()=>{calls++;throw new Error('Response lost');}));
  const row=get("SELECT * FROM moderation_actions WHERE guildId='uncertain'");
  assert.equal(row.status,'UNCERTAIN');run('UPDATE moderation_actions SET updatedAt=0 WHERE recordId=?',[row.recordId]);
  const guild={fetchAuditLogs:async()=>({entries:new Collection([['audit',{target:{id:'member'},executor:{id:'bot'},reason:actions.moderationReason('Test',row)}]])})};
  const client={user:{id:'bot'},guilds:{cache:new Collection([['uncertain',guild]])}};
  await actions.reconcileModerationActions(client);await actions.reconcileModerationActions(client);
  assert.equal(calls,1);assert.equal(get('SELECT COUNT(*) AS count FROM cases WHERE actionRecordId=?',[row.recordId]).count,1);
});

test('full application questions appear inside modern modals and stale forms cannot overwrite saved answers',async()=>{
  const apps=require('../utils/applications'),event=require('../events/applicationTickets');
  const form=Number(apps.createForm({guildId:'apps',name:'Reviewers',createdBy:'admin'}).lastInsertRowid);
  const question='Explain how you would respond to a difficult situation. '.repeat(4).slice(0,240);
  apps.addQuestion({guildId:'apps',formId:form,question,answerType:'YES_NO'});
  const draft=apps.createDraft({guildId:'apps',formId:form,userId:'applicant'});
  let modal;
  await event.execute({guild:null,user:{id:'applicant'},customId:`application_open_${draft.id}`,
    isButton:()=>true,isStringSelectMenu:()=>false,isModalSubmit:()=>false,showModal:async value=>{modal=value.toJSON();}});
  assert.equal(modal.components[0].content,`**${question.trim()}**\nAnswer Yes or No.`);
  assert.equal(modal.components[1].component.max_length,250);
  apps.saveDraft({id:draft.id,answers:[{questionId:draft.questions[0].id,answer:'Yes'}],nextQuestionIndex:1,expectedVersion:0});
  assert.throws(()=>apps.saveDraft({id:draft.id,answers:[],nextQuestionIndex:0,expectedVersion:0}),/out of date/);
  assert.equal(apps.getDraft(draft.id).answers[0].answer,'Yes');
});

test('ticket fingerprints treat repeated reasons as duplicates but allow distinct requests',()=>{
  const {ticketFingerprint}=require('../utils/ticketFingerprint');
  const common={guildId:'guild',userId:'member',type:'support'};
  assert.equal(ticketFingerprint({...common,reason:'Please help',requestId:'first'}),ticketFingerprint({...common,reason:'please   help',requestId:'second'}));
  assert.notEqual(ticketFingerprint({...common,reason:'Please help'}),ticketFingerprint({...common,reason:'Another problem'}));
});

test('interrupted ticket creation discovers its channel by durable identity instead of creating another',async()=>{
  const {prepareChannel}=require('../utils/tickets/creationIntent');
  const key='a'.repeat(64),channel={id:'created',topic:`Jabster Studios ticket | request:${key}`};
  run("INSERT INTO ticket_creation_intents(fingerprint,guildId,userId,type,createdAt,updatedAt,status) VALUES(?,'intent','user','support',1,1,'REVIEW')",[key]);
  const guild={id:'intent',channels:{fetch:async()=>new Collection([['created',channel]])}};
  const result=await prepareChannel({guild,fingerprint:key,userId:'user',type:'support',create:()=>{throw new Error('Duplicate creation');}});
  assert.equal(result.id,'created');assert.equal(get('SELECT channelId FROM ticket_creation_intents WHERE fingerprint=?',[key]).channelId,'created');
});

test('ticket cleanup retains records on transient fetch errors and refuses to delete unarchived messages',async()=>{
  const {deleteClosedTicketChannel}=require('../utils/tickets/closedTicketCleanup');
  run("INSERT INTO tickets(guildId,channelId,userId,type,createdAt,status,deleteAfter,transcriptBoundaryId) VALUES('close','channel','member','support',1,'CLOSED',1,'old')");
  assert.equal(await deleteClosedTicketChannel({channels:{fetch:async()=>{throw new Error('Temporary outage');}}},'channel'),false);
  assert.equal(get("SELECT status FROM tickets WHERE channelId='channel'").status,'CLOSED');
  const channel={id:'channel',messages:{fetch:async()=>new Collection([['new',{id:'new'}]])},send:async()=>({id:'new-close-controls'}),delete:()=>{throw new Error('Must retain new content');}};
  assert.equal(await deleteClosedTicketChannel({channels:{fetch:async()=>channel}},'channel'),false);
  assert.equal(get("SELECT status FROM tickets WHERE channelId='channel'").status,'OPEN');
});

test('working-hour durations skip weekends and honor the configured timezone',()=>{
  const {businessDuration,setWorkingHours}=require('../utils/tickets/workingHours');
  assert.equal(businessDuration('none',0,1),null);
  setWorkingHours('hours','admin',{timezone:'Europe/London',start:'09:00',end:'17:00',weekdays:'1,2,3,4,5'});
  assert.equal(businessDuration('hours',Date.parse('2026-10-23T15:00:00Z'),Date.parse('2026-10-26T10:00:00Z')),7200000);
  assert.throws(()=>setWorkingHours('bad','admin',{timezone:'UTC',start:'17:00',end:'09:00',weekdays:'1'}),/after/);
});

test('supplementary game providers identify supported stores, exclude trials, attribute offers and never guess deadline timezones',()=>{
  const {normalizeProviderOffers}=require('../utils/gameProviders');
  const base={id:1,title:'Example Ubisoft Giveaway',type:'Game',status:'Active',platforms:'PC, Ubisoft',
    gamerpower_url:'https://www.gamerpower.com/example',open_giveaway_url:'https://www.gamerpower.com/open/example',end_date:'2026-12-01 12:00:00'};
  const offers=normalizeProviderOffers([base,{...base,id:2,title:'Free Weekend Trial'},{...base,id:3,open_giveaway_url:'javascript:bad'}]);
  assert.equal(offers.length,1);assert.equal(offers[0].source,'UBISOFT');assert.equal(offers[0].endsAt,null);assert.ok(offers[0].attribution);
  const embed=require('../utils/freeGames').buildOfferEmbed(offers[0]).toJSON();
  assert.match(embed.title,/Ubisoft/);assert.ok(embed.fields.some(field=>field.name==='Offer source' && field.value.includes('GamerPower')));
});

test('removed social feeds cancel queued deliveries rather than reappearing after restart',async()=>{
  const outbox=require('../utils/deliveryOutbox');
  outbox.enqueueDelivery({deliveryKey:'social:twitch:removed:creator:streams:item',type:'SOCIAL_TWITCH',guildId:'removed',channelId:'channel',payload:{creatorId:'creator',feedType:'streams',message:{content:'Must not post'}}});
  await outbox.retryChannelDeliveries({channels:{fetch:async()=>({isTextBased:()=>true,send:()=>{throw new Error('Removed feed sent');}})}});
  assert.equal(get("SELECT status FROM delivery_outbox WHERE guildId='removed'").status,'CANCELLED');
});

test('valid social feeds remain eligible and queued deliveries respect changed destinations and quiet hours',()=>{
  const policy=require('../utils/socialDeliveryPolicy');
  run("INSERT INTO social_channels(guildId,platform,creatorId,creatorName,contentType,targetChannelId,timezone) VALUES('active-social','twitch','creator','Creator','streams','channel','UTC')");
  const row={guildId:'active-social',channelId:'channel',deliveryKey:'social:twitch:active-social:creator:streams:item',type:'SOCIAL_TWITCH',parsedPayload:{creatorId:'creator',feedType:'streams'}};
  assert.equal(policy.activeSocialDelivery(row),true);
  policy.assertActiveSocialDelivery(row);
  const hour=new Date().getUTCHours();
  run("UPDATE social_channels SET quietStartHour=?,quietEndHour=? WHERE guildId='active-social'",[hour,(hour+1)%24]);
  assert.throws(()=>policy.assertActiveSocialDelivery(row),/quiet hours/);
  run("UPDATE social_channels SET targetChannelId='elsewhere' WHERE guildId='active-social'");
  assert.equal(policy.activeSocialDelivery(row),false);
});

test('invite corrections preserve an immutable before/after trail and adjust only that membership credit',()=>{
  const {correctAttribution}=require('../utils/inviteTracking');
  run("INSERT INTO invites(guildId,userId,inviterId,inviteCode,joinedAt,confidence,source) VALUES('invite','member','old','code',1,'EXACT','INVITE')");
  run("INSERT INTO invite_stats(guildId,userId,invites) VALUES('invite','old',1)");
  correctAttribution({guildId:'invite',memberId:'member',inviterId:'new',actorId:'admin',reason:'Verified manually with the inviter.'});
  assert.equal(get("SELECT invites FROM invite_stats WHERE guildId='invite' AND userId='old'").invites,0);
  assert.equal(get("SELECT invites FROM invite_stats WHERE guildId='invite' AND userId='new'").invites,1);
  assert.equal(JSON.parse(get("SELECT beforeJson FROM invite_corrections WHERE guildId='invite'").beforeJson).inviterId,'old');
});

test('retired daily prompts are excluded, and rating weighting is smoothed rather than controlled by one vote',()=>{
  const quality=require('../utils/promptQuality'),service=require('../services/DailyInteractionService');
  const prompt=service.promptsForType('quality','QUESTION')[0];
  assert.ok(prompt);
  quality.curatePrompt('quality',prompt.key,'admin',{enabled:false,weight:1,reason:'Retired by staff.'});
  assert.equal(service.promptsForType('quality','QUESTION').some(row=>row.key===prompt.key),false);
  assert.ok(quality.qualityWeight({votes:1,total:1})>0.8);
});

test('exclusive role selections are serialized and preserve unrelated member roles',async()=>{
  const f=fixture('panels'),member=f.member('member',['unrelated']);
  for(const id of ['first','second']) {
    const role={id,name:id,position:1,managed:false,permissions:permissions()};f.guild.roles.cache.set(id,role);
  }
  member.roles.add=async role=>{await new Promise(resolve=>setTimeout(resolve,5));member.roles.cache.set(role.id,role);};
  member.roles.remove=async role=>{member.roles.cache.delete(role.id);};
  run("INSERT INTO reaction_role_panels(messageId,guildId,channelId,title,description,exclusive,createdBy,createdAt) VALUES('panel','panels','channel','Roles','Pick one',1,'admin',1)");
  for(const id of ['first','second']) run('INSERT INTO reaction_role_mappings(messageId,emojiKey,emoji,roleId,createdAt) VALUES(?,?,?,?,1)',['panel',id,'x',id]);
  const {selectPanelRoles}=require('../utils/rolePanels');
  await Promise.all(['first','second'].map(id=>selectPanelRoles({guild:f.guild,messageId:'panel',userId:'member',roleIds:[id],mode:'ADD'})));
  assert.equal(member.roles.cache.has('first'),false);assert.equal(member.roles.cache.has('second'),true);assert.equal(member.roles.cache.has('unrelated'),true);
});

test('duplicate leveling content does not earn XP after cooldown or after a service module reload',async()=>{
  const f=fixture('xp'),member=f.member('member');
  run("INSERT INTO leveling_config(guildId,enabled,cooldown,xpMin,xpMax,levelUpStyle,duplicateWindow) VALUES('xp',1,0,1,1,'OFF',300)");
  const message={guild:f.guild,channel:f.channel,member,author:member.user,content:'The same message'};
  assert.equal((await require('../utils/LevelingService').handleMessage(message)).awarded,true);
  delete require.cache[require.resolve('../utils/LevelingService')];
  assert.equal((await require('../utils/LevelingService').handleMessage(message)).reason,'DUPLICATE_CONTENT');
  assert.equal(get("SELECT xp FROM leveling_users WHERE guildId='xp'").xp,1);
  assert.equal((await require('../utils/LevelingService').handleMessage({...message,content:'Another message'})).awarded,true);
  assert.equal((await require('../utils/LevelingService').handleMessage(message)).reason,'DUPLICATE_CONTENT');
});

test('moderation notifications do not claim a pending action already succeeded and record closed-DM failures',async()=>{
  const notifications=require('../utils/moderationNotifications');
  let received;
  const result=await notifications.sendPendingModerationDM({send:async payload=>{received=payload;}},'BAN','Server',{
    embeds:[new (require('discord.js').EmbedBuilder)().setTitle('Old wording').setDescription('Old wording')]});
  assert.equal(result.status,'SENT');assert.match(received.embeds[0].data.description,/does not confirm/);
  const action=await require('../utils/moderationActions').performModerationAction({guildId:'dm-status',userId:'member',moderatorId:'admin',action:'WARN'},async()=>{});
  const failed=await notifications.sendModerationDM({send:async()=>{throw new Error('Closed DMs');}},action.caseId,{content:'Notice'});
  assert.equal(failed.status,'FAILED');assert.equal(notifications.notificationStatus(action.caseId),'FAILED');
  let response;
  await require('../commands/moderation/case').execute({guild:{id:'dm-status'},deferred:true,
    memberPermissions:permissions(P.Administrator),options:{getInteger:()=>action.caseId},editReply:async payload=>{response=payload;}});
  const embed=response.embeds[0].toJSON();
  assert.equal(embed.fields.find(field=>field.name==='Member DM notification').value,'FAILED');
});

test('feedback transcript DMs recover an accepted send after a lost response without sending twice',async()=>{
  const feedback=require('../utils/ticketFeedback'),sent=new Collection();
  run("INSERT INTO tickets(guildId,channelId,userId,type,createdAt,status,transcriptMessageId,transcriptArchiveChannelId) VALUES('feedback-retry','ticket-feedback','member','appeal',1,'CLOSED','archive-message','archive-channel')");
  const record=feedback.createFeedbackRecord({ticket:get("SELECT * FROM tickets WHERE channelId='ticket-feedback'"),closedBy:{id:'staff'},closeReason:'Resolved'});
  let sends=0;
  const dm={client:{user:{id:'bot'}},messages:{fetch:async()=>sent},send:async payload=>{
    sends++;sent.set('dm-receipt',{id:'dm-receipt',author:{id:'bot'},nonce:payload.nonce,createdTimestamp:Date.now(),attachments:new Collection()});
    throw Object.assign(new Error('Response lost'),{status:503});
  }};
  const archive={messages:{fetch:async()=>({attachments:new Collection([['html',{name:'ticket-ticket-feedback.html',url:'https://cdn.discordapp.com/attachments/1/2/ticket-ticket-feedback.html'}]])})}};
  const client={users:{fetch:async()=>({createDM:async()=>dm})},channels:{fetch:async()=>archive}};
  assert.equal(await feedback.sendFeedbackPrompt({client,feedback:record}),false);
  run("UPDATE delivery_outbox SET nextAttemptAt=0 WHERE deliveryKey=?",[`ticket-feedback-dm:${record.id}`]);
  run('UPDATE ticket_feedback SET dmNextAttemptAt=0 WHERE id=?',[record.id]);
  assert.equal(await feedback.retryFeedbackPrompts(client),1);
  assert.equal(sends,1);assert.equal(feedback.getFeedback(record.id).dmMessageId,'dm-receipt');
  assert.equal(await feedback.retryFeedbackPrompts(client),0);
});

test('membership reconciliation never changes records after an incomplete member fetch and never guesses offline inviters',async()=>{
  const tracking=require('../utils/inviteTracking'),f=fixture('reconcile');
  f.member('present');f.guild.memberCount=20;
  run("INSERT INTO invites(guildId,userId,inviteCode,joinedAt,confidence,source) VALUES('reconcile','departed','unknown',1,'UNKNOWN','UNKNOWN')");
  await assert.rejects(tracking.reconcileMembership(f.guild),/complete member list/);
  assert.equal(get("SELECT leftAt FROM invites WHERE guildId='reconcile'").leftAt,null);
  f.guild.memberCount=f.members.size;
  const result=await tracking.reconcileMembership(f.guild);
  assert.equal(result.left,1);assert.equal(result.observed,1);
  assert.equal(get("SELECT inviterId FROM invites WHERE guildId='reconcile' AND userId='present'").inviterId,null);
  assert.equal(get("SELECT source FROM invites WHERE guildId='reconcile' AND userId='present'").source,'RECONCILED');
});

test('disabled snapshot storage is respected and media-only edits update persisted evidence',async()=>{
  const f=fixture('snapshots');
  run("INSERT INTO log_settings(guildId,type,channelId,enabled) VALUES('snapshots','MESSAGES','channel',1)");
  const snapshots=require('../utils/messageSnapshots');
  const message={id:'snapshot-message',guild:f.guild,channel:f.channel,author:{id:'member',tag:'Member'},content:'Same text',embeds:[],attachments:new Collection(),stickers:new Collection(),createdTimestamp:Date.now()};
  snapshots.captureMessageSnapshot(message);snapshots.flushMessageSnapshots();
  const updated={...message,embeds:[{toJSON:()=>({title:'New embed',timestamp:'2026-11-09T12:00:00.123000+00:00'})}]};
  await require('../events/messageUpdate').execute({...message},updated,f.client);
  snapshots.flushMessageSnapshots();
  assert.match(get("SELECT embeds FROM message_snapshots WHERE messageId='snapshot-message'").embeds,/New embed/);
  run("INSERT INTO logging_privacy(guildId,retentionDays) VALUES('snapshots',0)");
  snapshots.captureMessageSnapshot({...message,id:'do-not-store'});snapshots.flushMessageSnapshots();
  assert.equal(get("SELECT * FROM message_snapshots WHERE messageId='do-not-store'"),undefined);
});
