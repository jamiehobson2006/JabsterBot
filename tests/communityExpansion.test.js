const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {Collection,PermissionsBitField,PermissionFlagsBits:P,ChannelType,EmbedBuilder}=require('discord.js');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'jabster-community-expansion-'));
process.env.DATABASE_PATH=path.join(temporary,'test.db');
const {db,all,get,run,initDatabase}=require('../database');initDatabase();
test.after(()=>{db.close();fs.rmSync(temporary,{recursive:true,force:true});});
const training=require('../utils/moderatorTraining'),access=require('../utils/communityAccess');
let sequence=0;
function fixture(id=`server-${++sequence}`){
  const members=new Collection(),channels=new Collection(),roles=new Collection(),audit=new Collection();
  const guild={id,name:'Community Test',ownerId:'owner',memberCount:5,roles:{cache:roles,fetch:async id=>roles.get(id)},
    members:{fetch:async input=>members.get(typeof input==='string'?input:input.user)},channels:{cache:channels},
    fetchAuditLogs:async()=>({entries:new Collection([...audit].reverse())})};
  const role=id=>{const value={id,name:id,guild,position:5,managed:false,permissions:new PermissionsBitField(0n)};roles.set(id,value);return value;};
  const member=(id,ids=[],privileges=0n)=>{
    ids.forEach(id=>{if(!roles.has(id))role(id);});
    const value={id,guild,displayName:id,user:{id,username:id,bot:false,displayAvatarURL:()=> 'https://example.com/avatar.png'},
      permissions:new PermissionsBitField(privileges),roles:{cache:new Collection(ids.map(id=>[id,roles.get(id)])),highest:{position:20}}};
    value.roles.add=async(role,reason)=>{value.roles.cache.set(role.id,role);const key=String(++sequence);audit.set(key,{id:key,target:{id},executor:{id:'bot'},reason,changes:[{key:'$add',new:[{id:role.id}]}]});};
    value.roles.remove=async(role,reason)=>{value.roles.cache.delete(role.id);const key=String(++sequence);audit.set(key,{id:key,target:{id},executor:{id:'bot'},reason,changes:[{key:'$remove',new:[{id:role.id}]}]});};
    members.set(id,value);return value;
  };
  const bot=member('bot',[],P.Administrator);bot.user.bot=true;bot.roles.highest.position=100;guild.members.me=bot;guild.members.fetchMe=async()=>bot;
  const sent=[],messages=new Collection();
  const channel={id:'channel',name:'general',guildId:id,guild,type:ChannelType.GuildText,isTextBased:()=>true,
    permissionsFor:()=>new PermissionsBitField(P.Administrator),messages:{fetch:async input=>typeof input==='string'?messages.get(input):messages},
    send:async payload=>{const message={id:String(++sequence),author:bot.user,createdTimestamp:Date.now(),...payload};sent.push(message);messages.set(message.id,message);return message;}};
  channels.set(channel.id,channel);guild.channels.fetch=async id=>id?channels.get(id):channels;
  const client={user:bot.user,guilds:{cache:new Collection([[id,guild]])},channels:{fetch:async id=>channels.get(id)},users:{fetch:async id=>({createDM:async()=>channel,id})}};
  guild.client=client;channel.client=client;
  return {guild,role,member,client,channel,roles,members,audit,sent};
}
function enableTraining(f,values={}){
  const admin=f.member('owner',[],P.Administrator);
  training.configure(f.guild.id,{enabled:1,trainerRoleId:'trainer',traineeRoleId:'trainee',questionCount:2,cooldownMinutes:0,...values},admin);
  const trainer=f.member('trainer-user',['trainer']),trainee=f.member('trainee-user',['trainee']);
  return {admin,trainer,trainee};
}
function scenario(f,values={}){return training.saveScenario(f.guild.id,'trainer-user',{title:'A moderation scenario',prompt:'A member repeatedly posts unrelated messages. What should staff do?',
  choices:['Warn','Escalate'],expected:'Warn',explanation:'Use the proportionate response defined by server policy.',...values});}

test('new commands remain global and below Discord command and option budgets',()=>{
  const registry=require('../utils/commandRegistry').loadCommandRegistry();
  assert.equal(registry.commands.size,61);assert.equal(registry.sources.size,106);
  for(const name of ['training','knowledge','challenge','temprole','partner'])assert.ok(registry.commands.has(name));
  require('../utils/commandValidation').validateGlobalCommands(registry.definitions);
  assert.ok(registry.commands.get('social').data.toJSON().options.find(row=>row.name==='settings'));
});

test('training starts disabled and admin configuration separates trainers from trainees',()=>{
  const f=fixture(),ordinary=f.member('ordinary');
  assert.throws(()=>training.start(ordinary),/disabled/);
  assert.throws(()=>training.configure(f.guild.id,{enabled:1},ordinary),/administrators/);
  const roles=enableTraining(f);
  assert.equal(training.trainer(roles.trainer),true);assert.equal(training.trainee(roles.trainer),false);
  assert.equal(training.trainee(roles.trainee),true);assert.equal(training.trainer(roles.trainee),false);
  assert.throws(()=>training.start(ordinary),/trainee/);
});

test('training snapshots scenarios and configuration rather than changing active attempts',()=>{
  const f=fixture(),{admin,trainee}=enableTraining(f,{shuffle:0});
  const first=scenario(f);scenario(f,{title:'Second scenario'});
  const attempt=training.start(trainee);
  training.saveScenario(f.guild.id,'trainer-user',{prompt:'A different situation.',expected:'Escalate'},first.id);
  training.configure(f.guild.id,{passPercent:30},admin);
  const saved=training.session(f.guild.id,attempt.id);
  assert.equal(JSON.parse(saved.questionsJson)[0].expected,'Warn');
  assert.equal(JSON.parse(saved.settingsJson).passPercent,80);
  const payload=training.questionPayload(saved);payload.embeds.forEach(embed=>embed.toJSON());payload.components.forEach(row=>row.toJSON());
  assert.doesNotMatch(JSON.stringify(payload),/Use the proportionate response/);
});

test('training rejects another trainee, stale answers, invalid choices and role loss',()=>{
  const f=fixture(),{trainee}=enableTraining(f,{shuffle:0});scenario(f);scenario(f,{title:'Second'});
  const row=training.start(trainee),other=f.member('other',['trainee']);
  assert.throws(()=>training.answer(other,row.id,0,'Warn'),/belongs/);
  assert.throws(()=>training.answer(trainee,row.id,0,'Invented'),/listed option/);
  const advanced=training.answer(trainee,row.id,0,'1','Proportionate first action.');
  assert.equal(advanced.nextQuestion,1);
  assert.throws(()=>training.answer(trainee,row.id,0,'2'),/out of date/);
  trainee.roles.cache.clear();assert.throws(()=>training.answer(trainee,row.id,1,'Warn'),/trainee role/);
});

test('written training requires marking, refuses self-review and uses saved weighted scoring',()=>{
  const f=fixture(),{trainer,trainee}=enableTraining(f,{shuffle:0});
  scenario(f,{points:2});scenario(f,{kind:'TEXT',title:'Explain escalation',expected:'Explain evidence preservation and escalation.',points:3});
  const row=training.start(trainee);training.answer(trainee,row.id,0,'Warn');
  const finished=training.answer(trainee,row.id,1,'I would preserve evidence and contact the responsible team.');
  assert.equal(finished.status,'REVIEW');assert.equal(finished.score,2);
  assert.throws(()=>training.review(trainer,row.id,'Reviewed'),/Grade every/);
  assert.throws(()=>training.grade(trainer,row.id,2,4,'Too many marks'),/maximum/);
  trainee.roles.cache.set('trainer',{id:'trainer'});assert.throws(()=>training.grade(trainee,row.id,2,3,'Self grade'),/own attempt/);
  training.grade(trainer,row.id,2,3,'Clear reasoning and evidence preservation.');
  const result=training.review(trainer,row.id,'You applied the server policy correctly.');
  assert.equal(result.status,'PASSED');assert.equal(result.score,5);
  assert.throws(()=>training.review(trainer,row.id,'Again'),/already reviewed/);
  assert.equal(get('SELECT COUNT(*) n FROM cases').n,0);
  assert.equal(get('SELECT COUNT(*) n FROM moderation_actions').n,0);
});

test('choice-only automatic training respects the configurable pass percentage and feedback privacy',()=>{
  const f=fixture(),{trainee}=enableTraining(f,{requireReview:0,questionCount:1,showFeedback:0});scenario(f);
  const row=training.start(trainee),result=training.answer(trainee,row.id,0,'Escalate');
  assert.equal(result.status,'FAILED');
  assert.doesNotMatch(JSON.stringify(training.resultPayload(result)),/Expected answer|proportionate/);
});

test('training enforces attempt caps without deleting historic results',()=>{
  const f=fixture(),{trainee}=enableTraining(f,{requireReview:0,questionCount:1,maxAttempts:1});scenario(f);
  const row=training.start(trainee);training.answer(trainee,row.id,0,'Warn');
  assert.throws(()=>training.start(trainee),/Attempt limit/);
  assert.equal(all('SELECT * FROM training_sessions WHERE guildId=?',[f.guild.id]).length,1);
});

test('training resets handle same-millisecond attempts without counting old results or bypassing the new cap',()=>{
  const f=fixture(),{trainer,trainee}=enableTraining(f,{requireReview:0,questionCount:1,maxAttempts:1});scenario(f);
  const first=training.start(trainee);training.answer(trainee,first.id,0,'Warn');
  run('INSERT INTO training_attempt_resets VALUES(?,?,?,?,?)',[f.guild.id,trainee.id,first.createdAt,trainer.id,'Eligibility reset.']);
  const second=training.start(trainee);assert.ok(second.createdAt>first.createdAt);
  training.answer(trainee,second.id,0,'Warn');assert.throws(()=>training.start(trainee),/Attempt limit/);
  assert.equal(all('SELECT * FROM training_sessions WHERE guildId=?',[f.guild.id]).length,2);
});

test('maximum training content is paginated without losing question, answer or feedback text',()=>{
  const f=fixture(),{trainer,trainee}=enableTraining(f,{questionCount:1,showFeedback:1});
  scenario(f,{kind:'TEXT',prompt:'Q'.repeat(2000),expected:'R'.repeat(500),explanation:'E'.repeat(1500),points:5});
  const row=training.start(trainee);training.answer(trainee,row.id,0,'A'.repeat(1000),'B'.repeat(1000));
  training.grade(trainer,row.id,1,5,'G'.repeat(1000));const completed=training.review(trainer,row.id,'F'.repeat(1500));
  const pages=[1,2].map(page=>training.resultPayload(completed,true,page).embeds[0]);
  for(const embed of pages){embed.toJSON();assert.ok(embed.length<=6000);for(const field of embed.data.fields)assert.ok(field.value.length<=1024);}
  const rendered=JSON.stringify(pages.map(embed=>embed.toJSON()));
  assert.ok(rendered.includes('Q'.repeat(2000)));assert.ok(rendered.includes('A'.repeat(1000)));assert.ok(rendered.includes('E'.repeat(1000)));
});

test('training session lookup is server-scoped and the persisted answer form resumes after a process restart',()=>{
  const f=fixture('restart-training'),{trainee}=enableTraining(f,{shuffle:0});scenario(f);scenario(f,{title:'After restart'});
  const row=training.start(trainee);training.answer(trainee,row.id,0,'Warn');
  assert.equal(training.session('another-server',row.id),undefined);
  const child=spawnSync(process.execPath,['-e',`const d=require('./database');d.initDatabase();const t=require('./utils/moderatorTraining');const row=t.session('restart-training','${row.id}');if(row.nextQuestion!==1||JSON.parse(row.answersJson).length!==1)process.exitCode=1;d.db.close();`],
    {cwd:path.join(__dirname,'..'),env:process.env,encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);
});

test('knowledge articles enforce reader roles, preserve revisions and do not cross servers',()=>{
  const f=fixture(),manager=f.member('manager',['manager']),reader=f.member('reader',['reader']),outsider=f.member('outsider');
  run('INSERT INTO community_access(guildId,feature,managerRoleId) VALUES(?,?,?)',[f.guild.id,'knowledge','manager']);
  const kb=require('../utils/knowledgeBase');
  kb.save(f.guild.id,manager.id,{name:'handbook',title:'Staff handbook',content:'Private guidance.',readerRoleId:'reader'});
  assert.equal(kb.visible(outsider,kb.article(f.guild.id,'handbook')),false);
  assert.equal(kb.visible(reader,kb.article(f.guild.id,'handbook')),true);
  assert.equal(kb.search(outsider,'handbook').length,0);
  kb.save(f.guild.id,manager.id,{content:'Updated private guidance.'},'handbook');
  assert.equal(kb.article(f.guild.id,'handbook').version,2);
  assert.equal(get('SELECT content FROM knowledge_revisions WHERE guildId=?',[f.guild.id]).content,'Private guidance.');
  assert.equal(kb.article('different','handbook'),undefined);
});

test('challenge progress changes only once after independent approval, never on submission',()=>{
  const f=fixture(),manager=f.member('manager',['manager']),member=f.member('member');
  run('INSERT INTO community_access(guildId,feature,managerRoleId) VALUES(?,?,?)',[f.guild.id,'challenge','manager']);
  const challenges=require('../utils/communityChallenges');
  challenges.create(manager,{name:'community-build',title:'Build together',description:'Submit proof of completed contributions.',goal:5});
  const item=challenges.contribute(member,'community-build',5,'Completed the agreed task.','request-1');
  assert.equal(challenges.challenge(f.guild.id,'community-build').progress,0);
  assert.throws(()=>challenges.review(member,item.id,true,'Approved'),/management/);
  const result=challenges.review(manager,item.id,true,'Evidence verified.');
  assert.equal(result.progress,5);assert.equal(result.status,'COMPLETED');
  assert.throws(()=>challenges.review(manager,item.id,true,'Duplicate'),/Pending contribution/);
  assert.equal(challenges.challenge(f.guild.id,'community-build').progress,5);
});

test('partners require approval, reject dangerous URLs and keep pending listings out of public browse',()=>{
  const f=fixture(),manager=f.member('manager',['manager']),member=f.member('member');
  run('INSERT INTO community_access(guildId,feature,managerRoleId) VALUES(?,?,?)',[f.guild.id,'partner','manager']);
  const directory=require('../utils/partnerDirectory');
  assert.throws(()=>directory.submit(member,{name:'bad',title:'Bad',url:'http://localhost',description:'Test'}),/HTTPS/);
  directory.submit(member,{name:'studio',title:'Partner studio',url:'https://example.com/',description:'A community partner.'});
  assert.equal(directory.browse(member).length,0);
  assert.throws(()=>directory.browse(member,'',true),/management/);
  directory.decide(manager,'studio','APPROVED','Partnership verified.');
  assert.equal(directory.browse(member).length,1);
});

test('temporary roles enforce an admin-approved safe allowlist and preserve existing permanent roles',async()=>{
  const f=fixture(),manager=f.member('manager',['manager']),target=f.member('target'),role=f.role('event-role');
  run('INSERT INTO community_access(guildId,feature,managerRoleId) VALUES(?,?,?)',[f.guild.id,'temprole','manager']);
  const roles=require('../utils/temporaryRoles'),interaction={guild:f.guild,user:manager.user,client:f.client};
  await assert.rejects(roles.schedule(interaction,{userId:target.id,roleId:role.id,time:'1h'}),/not approved/);
  run('INSERT INTO temporary_role_allowlist VALUES(?,?,?,?)',[f.guild.id,role.id,2,0]);
  target.roles.cache.set(role.id,role);
  await assert.rejects(roles.schedule(interaction,{userId:target.id,roleId:role.id,time:'1h'}),/already have/);
  target.roles.cache.delete(role.id);role.permissions=new PermissionsBitField(P.ManageGuild);
  await assert.rejects(roles.schedule(interaction,{userId:target.id,roleId:role.id,time:'1h'}),/staff permissions/);
});

test('temporary roles persist schedules, expire only owned roles and never strip manual replacements',async()=>{
  const f=fixture('role-expiry'),manager=f.member('manager',['manager']),target=f.member('target'),role=f.role('event');
  run('INSERT INTO community_access(guildId,feature,managerRoleId) VALUES(?,?,?)',[f.guild.id,'temprole','manager']);
  run('INSERT INTO temporary_role_allowlist VALUES(?,?,?,?)',[f.guild.id,role.id,2,0]);
  const service=require('../utils/temporaryRoles');
  const row=await service.schedule({guild:f.guild,user:manager.user,client:f.client},{userId:target.id,roleId:role.id,time:'1h',reason:'Community event'});
  assert.equal(row.status,'ACTIVE');assert.equal(target.roles.cache.has(role.id),true);
  const expired=await service.processJob(f.client,row.id,{now:row.expiresAt+1});
  assert.equal(expired.status,'EXPIRED');assert.equal(target.roles.cache.has(role.id),false);
  const replacement=await service.schedule({guild:f.guild,user:manager.user,client:f.client},{userId:target.id,roleId:role.id,time:'1h'});
  f.audit.set('manual',{target:{id:target.id},executor:{id:'human'},reason:'Permanent role',changes:[{key:'$add',new:[{id:role.id}]}]});
  const held=await service.processJob(f.client,replacement.id,{now:replacement.expiresAt+1});
  assert.equal(held.status,'REVIEW');assert.equal(target.roles.cache.has(role.id),true);
});

test('temporary role schedules recheck manager authority and never grant expired offline schedules',async()=>{
  const f=fixture(),manager=f.member('manager',['manager']),target=f.member('target'),role=f.role('event');
  run('INSERT INTO community_access(guildId,feature,managerRoleId) VALUES(?,?,?)',[f.guild.id,'temprole','manager']);
  run('INSERT INTO temporary_role_allowlist VALUES(?,?,?,?)',[f.guild.id,role.id,2,0]);
  const service=require('../utils/temporaryRoles'),interaction={guild:f.guild,user:manager.user,client:f.client};
  const row=await service.schedule(interaction,{userId:target.id,roleId:role.id,time:'1h',delay:'1m'});
  manager.roles.cache.clear();
  assert.equal((await service.processJob(f.client,row.id,{now:row.startsAt+1})).status,'CANCELLED');
  assert.equal(target.roles.cache.has(role.id),false);
  manager.roles.cache.set('manager',f.roles.get('manager'));
  const stale=await service.schedule(interaction,{userId:target.id,roleId:role.id,time:'1h',delay:'1m'});
  assert.equal((await service.processJob(f.client,stale.id,{now:stale.expiresAt+1})).status,'EXPIRED');
  assert.equal(target.roles.cache.has(role.id),false);
});

test('application question edits and moves affect future drafts only',()=>{
  const app=require('../utils/applications'),guildId='editable-applications';
  const formId=Number(app.createForm({guildId,name:'Staff',createdBy:'admin'}).lastInsertRowid);
  app.addQuestion({guildId,formId,question:'Original first question?'});app.addQuestion({guildId,formId,question:'Original second question?'});
  const draft=app.createDraft({guildId,formId,userId:'applicant'});
  app.editQuestion(formId,1,{question:'Updated first question?',answerType:'YES_NO'});app.moveQuestion(formId,1,2);
  assert.equal(app.getQuestions(formId)[0].question,'Original second question?');
  assert.equal(app.getDraft(draft.id).questions[0].question,'Original first question?');
  assert.throws(()=>app.moveQuestion(formId,1,99),/existing question/);
  assert.deepEqual(app.getQuestions(formId).map(row=>row.position),[1,2]);
});

test('permission matrix, filtered help and autocomplete honor training and article roles',async()=>{
  const f=fixture(),roles=enableTraining(f);const registry=require('../utils/commandRegistry').loadCommandRegistry();
  const check=require('../utils/commandAccess').checkAction,base={commands:registry.commands,guild:f.guild,channel:f.channel};
  assert.equal(check({...base,member:roles.trainee,path:'training scenario create'}).eligible,false);
  assert.equal(check({...base,member:roles.trainer,path:'training scenario create'}).eligible,true);
  assert.equal(check({...base,member:roles.trainee,path:'training answer'}).eligible,true);
  const pages=require('../commands/utility/help').categoryPages({commands:registry.commands},'all',{...base,member:roles.trainee,query:'training'}).join('\n');
  assert.ok(pages.includes('/training answer'));assert.equal(pages.includes('/training scenario create'),false);
  const kb=require('../utils/knowledgeBase');kb.save(f.guild.id,'owner',{name:'secret',title:'Secret staff article',content:'Only authorized readers.',readerRoleId:'private'});
  const choices=await require('../utils/commandAutocomplete').choices({commandName:'knowledge',guild:f.guild,channel:f.channel,user:roles.trainee.user,
    options:{getSubcommand:()=> 'show',getSubcommandGroup:()=>null,getFocused:()=>({name:'name',value:''})}},registry.commands);
  assert.equal(choices.some(row=>row.value==='secret'),false);
});

test('social digests coalesce multiple posts once and persist member-independent receipt keys',async()=>{
  const f=fixture('digest');
  run("INSERT INTO social_channels(guildId,platform,creatorId,creatorName,contentType,targetChannelId,addedAt,digestMinutes) VALUES(?,'youtube','creator','Creator','videos','channel',1,15)",[f.guild.id]);
  const feed=get('SELECT * FROM social_channels WHERE guildId=?',[f.guild.id]),digests=require('../utils/socialDigests');
  for(let index=0;index<3;index++)await digests.deliverSocialOrQueue({client:f.client,social:feed,deliveryKey:`digest-item:${index}`,type:'SOCIAL_YOUTUBE',channel:f.channel,
    message:{embeds:[new EmbedBuilder().setTitle(`Video ${index}`).setURL(`https://youtube.com/watch?v=${index}`)]},metadata:{title:`Video ${index}`}});
  assert.equal(f.sent.length,0);
  run('UPDATE social_digest_items SET createdAt=? WHERE guildId=?',[Date.now()-20*60000,f.guild.id]);
  await digests.maintain(f.client);assert.equal(f.sent.length,1);
  await digests.maintain(f.client);assert.equal(f.sent.length,1);
  assert.equal(get("SELECT COUNT(*) n FROM social_digest_items WHERE guildId=? AND status='SENT'",[f.guild.id]).n,3);
});

test('digest items are cancelled rather than redirected when their feed is removed or replaced',async()=>{
  const f=fixture('digest-removed');
  run("INSERT INTO social_channels(guildId,platform,creatorId,creatorName,contentType,targetChannelId,addedAt,digestMinutes) VALUES(?,'youtube','creator','Creator','videos','channel',1,15)",[f.guild.id]);
  const feed=get('SELECT * FROM social_channels WHERE guildId=?',[f.guild.id]),digests=require('../utils/socialDigests');
  await digests.deliverSocialOrQueue({client:f.client,social:feed,deliveryKey:'removed-digest',type:'SOCIAL_YOUTUBE',channel:f.channel,
    message:{embeds:[new EmbedBuilder().setTitle('Video').setURL('https://youtube.com/watch?v=one')]},metadata:{title:'Video'}});
  run('DELETE FROM social_channels WHERE guildId=?',[f.guild.id]);
  await digests.maintain(f.client);
  assert.equal(get('SELECT status FROM social_digest_items WHERE deliveryKey=?',['removed-digest']).status,'CANCELLED');assert.equal(f.sent.length,0);
});

test('free-game per-store routing applies channel and ping overrides without enabling a disabled watch',async()=>{
  const f=fixture('store-routing'),games=require('../utils/freeGames');
  games.saveFreeGameSettings({guildId:f.guild.id,channelId:'base',pingRoleId:'main-ping',epicEnabled:true,steamEnabled:true,updatedBy:'owner'});
  run('INSERT INTO free_game_routes(guildId,source,channelId,pingMode,enabled) VALUES(?,?,?,?,?)',[f.guild.id,'STEAM','channel','NONE',1]);
  const settings=games.getFreeGameSettings(f.guild.id),offer={key:'steam:777',source:'STEAM',title:'Free game',url:'https://store.steampowered.com/app/777'};
  assert.equal(await games.announceOffer(f.client,settings,offer),'sent');assert.equal(f.sent[0].content,undefined);
  games.disableFreeGameWatch(f.guild.id,'owner');
  await require('../commands/config/freegames').execute({guild:f.guild,user:{id:'owner'},memberPermissions:new PermissionsBitField(P.Administrator),
    options:{getSubcommand:()=> 'clear-ping'},editReply:async()=>{}});
  assert.equal(games.getFreeGameSettings(f.guild.id).enabled,0);
  assert.equal(await games.announceOffer(f.client,settings,{...offer,key:'steam:888'}),'watch-disabled');
});

test('new configuration exports contain settings but never article contents, trainee answers or active role jobs',()=>{
  const tables=require('../utils/configuration').exportConfiguration('restart-training').tables;
  assert.ok(Object.hasOwn(tables,'training_settings'));assert.ok(Object.hasOwn(tables,'community_access'));
  assert.equal(Object.hasOwn(tables,'training_sessions'),false);assert.equal(Object.hasOwn(tables,'knowledge_articles'),false);
  assert.equal(Object.hasOwn(tables,'temporary_role_jobs'),false);
});

test('training modal shows the full saved question and rejects forged or repeated submissions',async()=>{
  const f=fixture(),{trainee}=enableTraining(f,{questionCount:1,requireReview:0});
  const prompt=('Full question. '+ 'Explain the next action. '.repeat(65)).trim();
  scenario(f,{prompt});const row=training.start(trainee),event=require('../events/trainingInteractions');
  let modal,response;
  const interaction={guild:f.guild,channel:f.channel,channelId:f.channel.id,client:f.client,user:trainee.user,inGuild:()=>true,isButton:()=>true,isModalSubmit:()=>false,
    customId:`training-answer:${row.id}:0`,showModal:async value=>{modal=value.toJSON();},reply:async value=>{response=value;}};
  await event.execute(interaction);
  assert.ok(JSON.stringify(modal).includes(prompt));assert.ok(JSON.stringify(modal).includes('Your answer'));
  const stranger=f.member('stranger',['trainee']);
  await event.execute({...interaction,user:stranger.user});
  assert.match(response.content,/belongs/);assert.equal(training.session(f.guild.id,row.id).nextQuestion,0);
  const submit={...interaction,customId:`training-submit:${row.id}:0`,isButton:()=>false,isModalSubmit:()=>true,
    fields:{getTextInputValue:name=>name==='answer'?'Warn':'Follow the policy.'},
    deferReply:async()=>{},editReply:async value=>{response=value;}};
  await event.execute(submit);assert.equal(training.session(f.guild.id,row.id).status,'PASSED');
  await event.execute(submit);assert.match(response.content,/out of date/);
  assert.equal(JSON.parse(training.session(f.guild.id,row.id).answersJson).length,1);
});

test('training buttons respect disabled commands and disabled training after a session starts',async()=>{
  const f=fixture(),{admin,trainee}=enableTraining(f,{questionCount:1});scenario(f);const row=training.start(trainee);
  const controls=require('../utils/commandControls');controls.setCommandEnabled({guildId:f.guild.id,commandName:'training answer',enabled:false,updatedBy:admin.id});
  let response,shown=false;
  const interaction={guild:f.guild,channel:f.channel,channelId:f.channel.id,client:f.client,user:trainee.user,inGuild:()=>true,isButton:()=>true,
    customId:`training-answer:${row.id}:0`,showModal:async()=>{shown=true;},reply:async value=>{response=value;}};
  await require('../events/trainingInteractions').execute(interaction);
  assert.equal(shown,false);assert.match(response.content,/command controls/);
  controls.resetCommandControl(f.guild.id,'training answer');training.configure(f.guild.id,{enabled:0},admin);
  await require('../events/trainingInteractions').execute(interaction);
  assert.equal(shown,false);assert.match(response.content,/disabled/);
});

test('training recovers a result saved before notification enqueue and sends its DM only once',async()=>{
  const f=fixture(),{trainee}=enableTraining(f,{questionCount:1,requireReview:0});scenario(f);
  const row=training.start(trainee);training.answer(trainee,row.id,0,'Warn');
  assert.equal(get('SELECT * FROM delivery_outbox WHERE deliveryKey=?',[`training-result:${row.id}`]),undefined);
  await training.maintainNotifications(f.client);
  assert.equal(get('SELECT status FROM delivery_outbox WHERE deliveryKey=?',[`training-result:${row.id}`]).status,'SENT');
  const count=f.sent.filter(message=>JSON.stringify(message.embeds).includes(row.id)).length;
  assert.equal(count,1);await training.maintainNotifications(f.client);
  assert.equal(f.sent.filter(message=>JSON.stringify(message.embeds).includes(row.id)).length,count);
});

test('a failed review-channel fetch retains a retryable notification and blocked DMs retain results',async()=>{
  const f=fixture(),{trainee}=enableTraining(f,{questionCount:1,reviewChannelId:'channel'});scenario(f);
  const row=training.start(trainee),completed=training.answer(trainee,row.id,0,'Warn');
  const fetch=f.client.channels.fetch;f.client.channels.fetch=async()=>{throw Object.assign(new Error('Temporary Discord outage'),{status:503});};
  await assert.rejects(training.notifyReview(f.client,completed),/outage/);
  assert.equal(get('SELECT status FROM delivery_outbox WHERE deliveryKey=?',[`training-review:${row.id}`]).status,'FAILED');
  f.client.channels.fetch=fetch;run('UPDATE delivery_outbox SET nextAttemptAt=0 WHERE deliveryKey=?',[`training-review:${row.id}`]);
  await training.maintainNotifications(f.client);
  assert.equal(get('SELECT status FROM delivery_outbox WHERE deliveryKey=?',[`training-review:${row.id}`]).status,'SENT');
  const separate=fixture(),{trainee:other}=enableTraining(separate,{questionCount:1,requireReview:0});scenario(separate);
  const attempt=training.start(other);training.answer(other,attempt.id,0,'Warn');
  separate.client.users.fetch=async()=>{throw Object.assign(new Error('Cannot send messages to this user'),{code:50007});};
  await training.maintainNotifications(separate.client);
  assert.equal(get('SELECT status FROM delivery_outbox WHERE deliveryKey=?',[`training-result:${attempt.id}`]).status,'CANCELLED');
  assert.equal(training.session(separate.guild.id,attempt.id).status,'PASSED');
});

test('temporary-role ownership holds require an administrator and resolving never removes a manual role',async()=>{
  const f=fixture(),manager=f.member('manager',['manager']),admin=f.member('owner',[],P.Administrator),target=f.member('target'),role=f.role('event');
  run('INSERT INTO community_access(guildId,feature,managerRoleId) VALUES(?,?,?)',[f.guild.id,'temprole','manager']);
  run('INSERT INTO temporary_role_allowlist VALUES(?,?,?,?)',[f.guild.id,role.id,2,0]);
  const service=require('../utils/temporaryRoles');
  const row=await service.schedule({guild:f.guild,user:manager.user,client:f.client},{userId:target.id,roleId:role.id,time:'1h'});
  run("UPDATE temporary_role_jobs SET status='REVIEW' WHERE id=?",[row.id]);
  assert.throws(()=>service.resolveReview(manager,row.id,'Reviewed ownership'),/administrators/);
  assert.throws(()=>service.resolveReview(admin,row.id,''),/Text/);
  const resolved=service.resolveReview(admin,row.id,'Keep the manually granted role.');
  assert.equal(resolved.status,'CANCELLED');assert.equal(resolved.resolutionActorId,admin.id);
  assert.equal(target.roles.cache.has(role.id),true);
  assert.throws(()=>service.resolveReview(admin,row.id,'Again'),/awaiting ownership review/);
});

test('partnership-ticket links remain manager-only and cannot be attached from another user or server',()=>{
  const f=fixture(),manager=f.member('manager',['manager']),member=f.member('member'),other=f.member('other');
  run('INSERT INTO community_access(guildId,feature,managerRoleId) VALUES(?,?,?)',[f.guild.id,'partner','manager']);
  run("INSERT INTO tickets(guildId,channelId,userId,type,createdAt,transcriptArchiveChannelId,transcriptMessageId) VALUES(?,?,?,'partnership',?,?,?)",
    [f.guild.id,'private-partnership',member.id,Date.now(),'archive','transcript']);
  const directory=require('../utils/partnerDirectory'),values={title:'Studio partner',url:'https://example.com',description:'A verified community.',channelId:'private-partnership'};
  assert.equal(directory.submit(member,{...values,name:'owned'}).ticketChannelId,'private-partnership');
  assert.equal(directory.submit(other,{...values,name:'not-owned'}).ticketChannelId,null);
  assert.throws(()=>directory.ticketLinks(member,'owned'),/management/);
  assert.match(directory.ticketLinks(manager,'owned'),/archive\/transcript/);
  assert.equal(require('../commands/utility/partner').ephemeral({options:{getSubcommand:()=> 'ticket'}}),true);
  assert.equal(directory.entry('another-server','owned'),undefined);
});

test('re-adding a social feed cancels only old digest items, not the replacement feed items',async()=>{
  const f=fixture(),service=require('../utils/socialDigests');
  run("INSERT INTO social_channels(guildId,platform,creatorId,creatorName,contentType,targetChannelId,addedAt,digestMinutes) VALUES(?,'youtube','creator','Creator','videos','channel',1,15)",[f.guild.id]);
  const enqueue=async key=>service.deliverSocialOrQueue({client:f.client,social:get('SELECT * FROM social_channels WHERE guildId=?',[f.guild.id]),
    deliveryKey:key,type:'SOCIAL_YOUTUBE',channel:f.channel,message:{embeds:[new EmbedBuilder().setURL('https://youtube.com/watch?v=example')]},metadata:{title:'New video'}});
  await enqueue('old-feed-item');run('UPDATE social_channels SET addedAt=2 WHERE guildId=?',[f.guild.id]);await enqueue('replacement-feed-item');
  await service.maintain(f.client);
  assert.equal(get('SELECT status FROM social_digest_items WHERE deliveryKey=?',['old-feed-item']).status,'CANCELLED');
  assert.equal(get('SELECT status FROM social_digest_items WHERE deliveryKey=?',['replacement-feed-item']).status,'PENDING');
});

test('social digest delivery respects configured quiet hours before and after batching',async()=>{
  const f=fixture(),service=require('../utils/socialDigests'),hour=new Date().getUTCHours();
  run("INSERT INTO social_channels(guildId,platform,creatorId,creatorName,contentType,targetChannelId,addedAt,digestMinutes,quietStartHour,quietEndHour,timezone) VALUES(?,'youtube','creator','Creator','videos','channel',1,15,?,?,'UTC')",
    [f.guild.id,hour,(hour+1)%24]);
  await service.deliverSocialOrQueue({client:f.client,social:get('SELECT * FROM social_channels WHERE guildId=?',[f.guild.id]),deliveryKey:'quiet-digest',
    type:'SOCIAL_YOUTUBE',channel:f.channel,message:{embeds:[new EmbedBuilder().setURL('https://youtube.com/watch?v=quiet')]},metadata:{title:'Quiet hours video'}});
  run('UPDATE social_digest_items SET createdAt=? WHERE guildId=?',[Date.now()-20*60000,f.guild.id]);
  await service.maintain(f.client);assert.equal(f.sent.length,0);
  run('UPDATE social_channels SET quietStartHour=NULL,quietEndHour=NULL WHERE guildId=?',[f.guild.id]);
  await service.maintain(f.client);assert.equal(f.sent.length,1);
});

test('a pre-send policy deferral stays retryable without an uncertain-delivery hold',async()=>{
  const f=fixture(),outbox=require('../utils/deliveryOutbox'),key='pre-send-policy-deferral';
  const message={content:'Digest waiting for quiet hours to end.'};
  outbox.enqueueDelivery({deliveryKey:key,type:'SOCIAL_DIGEST',guildId:f.guild.id,channelId:f.channel.id,payload:{message}});
  await assert.rejects(outbox.deliverOnce(key,claimed=>outbox.sendQueuedMessage(f.channel,claimed,message,{beforeSend:()=>{throw new Error('Quiet hours');}})),/Quiet hours/);
  const failed=get('SELECT * FROM delivery_outbox WHERE deliveryKey=?',[key]);
  assert.equal(failed.status,'FAILED');assert.equal(failed.uncertainSince,null);assert.equal(f.sent.length,0);
  run('UPDATE delivery_outbox SET nextAttemptAt=0 WHERE deliveryKey=?',[key]);
  await outbox.deliverOnce(key,claimed=>outbox.sendQueuedMessage(f.channel,claimed,message));
  assert.equal(f.sent.length,1);
});

test('help menu persistence preserves include-locked search settings and rejects another user',async()=>{
  const f=fixture(),{trainee}=enableTraining(f),registry=require('../utils/commandRegistry').loadCommandRegistry();
  const client={...f.client,commands:registry.commands},help=require('../commands/utility/help');let initial,response;
  await help.execute({guild:f.guild,channel:f.channel,user:trainee.user,options:{getString:()=>null,getBoolean:()=>true},editReply:async value=>{initial=value;}},client);
  const customId=initial.components[0].toJSON().components[0].custom_id;
  assert.match(customId,/^help_category:/);
  const event=require('../events/helpMenu'),base={guild:f.guild,channel:f.channel,user:trainee.user,customId,values:['config'],isButton:()=>false,isStringSelectMenu:()=>true,reply:async value=>{response=value;}};
  await event.execute(base,client);
  assert.match(response.embeds[0].data.description,/Blocked:/);
  const stranger=f.member('other-help-user');await event.execute({...base,user:stranger.user},client);
  assert.match(response.content,/belongs to someone else/);
});

test('new-feature command logging redacts private answers, rubrics and article content',()=>{
  const logger=require('../utils/logger');
  const details=logger.formatCommandInvocation({commandName:'training',options:{data:[{name:'scenario',options:[{name:'create',options:[
    {name:'title',value:'Staff scenario'},{name:'prompt',value:'Confidential prompt'},{name:'expected',value:'Confidential answer'}]}]}]}});
  assert.ok(details.command.includes('Staff scenario'));assert.doesNotMatch(JSON.stringify(details),/Confidential/);
  assert.match(details.command,/private content omitted/);
});

test('new schemas initialize repeatedly without deleting active jobs, challenges or training attempts',()=>{
  const tables=['training_sessions','training_scenarios','temporary_role_jobs','knowledge_articles','community_challenges','partner_entries'];
  const before=Object.fromEntries(tables.map(table=>[table,get(`SELECT COUNT(*) n FROM ${table}`).n]));
  initDatabase();initDatabase();
  for(const table of tables)assert.equal(get(`SELECT COUNT(*) n FROM ${table}`).n,before[table],table);
  const script=`const d=require('./database');d.initDatabase();const expected=${JSON.stringify(before)};for(const [table,count]of Object.entries(expected)){if(d.get('SELECT COUNT(*) n FROM '+table).n!==count)throw new Error(table+' changed during restart');}d.db.close();`;
  const child=spawnSync(process.execPath,['-e',script],{cwd:path.join(__dirname,'..'),env:process.env,encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);
});
