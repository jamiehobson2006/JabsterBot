const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {Collection,ChannelType,PermissionFlagsBits,PermissionsBitField}=require('discord.js');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'jabster-community-tools-'));
process.env.DATABASE_PATH=path.join(temporary,'test.db');
const {db,run,get,all,initDatabase}=require('../database');
initDatabase();
test.after(()=>{db.close();fs.rmSync(temporary,{recursive:true,force:true});});
const config=require('../utils/configuration');
const {withConfigurationActor}=require('../utils/configurationContext');
const admin=new PermissionsBitField(PermissionFlagsBits.Administrator);
const guild={id:'guild',members:{me:{permissions:admin,roles:{highest:{position:100}}}},
  channels:{cache:new Collection([['new-category',{id:'new-category',type:ChannelType.GuildCategory}],['channel',{id:'channel',type:ChannelType.GuildText}]])},
  roles:{cache:new Collection([['new-role',{id:'new-role',position:1,permissions:new PermissionsBitField()}]])}};

test('configuration history records actor, ignores runtime columns, and survives restart',()=>{
  withConfigurationActor({id:'revision-1',user:{id:'owner'}},()=>run("INSERT INTO guild_settings(guildId,staffListRoleId) VALUES('guild','new-role')"));
  const row=get("SELECT * FROM configuration_changes WHERE revisionId='revision-1'");
  assert.equal(row.actorId,'owner');
  const count=all('SELECT * FROM configuration_changes').length;
  run("UPDATE guild_settings SET staffListMessageId='runtime-id' WHERE guildId='guild'");
  assert.equal(all('SELECT * FROM configuration_changes').length,count);
  const child=spawnSync(process.execPath,['-e',"const d=require('./database');d.initDatabase();if(!d.get(\"SELECT 1 FROM configuration_changes WHERE revisionId='revision-1'\"))process.exitCode=1;d.db.close();"],{cwd:path.resolve(__dirname,'..'),env:process.env,encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);
});

test('configuration import requires a preview, remaps resources, and preserves runtime state',()=>{
  const preview=config.planImport({version:1,sourceGuildId:'source',tables:{ticket_settings:[{guildId:'source',type:'support',enabled:1,categoryId:'old-category',roleId:'old-role'}]}},guild,'owner',{'old-category':'new-category','old-role':'new-role'});
  assert.equal(get("SELECT 1 FROM ticket_settings WHERE guildId='guild'"),undefined);
  assert.throws(()=>config.applyPlan(preview.id,guild,'imposter'),/another administrator/);
  withConfigurationActor({id:'import-1',user:{id:'owner'}},()=>assert.equal(config.applyPlan(preview.id,guild,'owner'),1));
  assert.equal(get("SELECT categoryId FROM ticket_settings WHERE guildId='guild'").categoryId,'new-category');
  assert.equal(get("SELECT staffListMessageId FROM guild_settings WHERE guildId='guild'").staffListMessageId,'runtime-id');
  assert.throws(()=>config.applyPlan(preview.id,guild,'owner'),/was applied/);
});

test('configuration import rejects runtime tables, unknown columns, stale previews and invalid resources',()=>{
  assert.throws(()=>config.planImport({version:1,tables:{giveaways:[]}},guild,'owner'),/Unknown configuration/);
  assert.throws(()=>config.planImport({version:1,tables:{guild_settings:[{guildId:'guild',staffListMessageId:'overwrite'}]}},guild,'owner'),/not an importable/);
  assert.throws(()=>config.planImport({version:1,tables:{ticket_settings:[{guildId:'guild',type:'bug',categoryId:'channel'}]}},guild,'owner'),/category/);
  const preview=config.planImport({version:1,tables:{guild_settings:[{guildId:'guild',censorEnabled:1}]}},guild,'owner');
  run("UPDATE guild_settings SET linkBlockEnabled=1 WHERE guildId='guild'");
  assert.throws(()=>config.applyPlan(preview.id,guild,'owner'),/changed after the preview/);
});

test('rollback only restores its revision and refuses to replace a subsequent change',()=>{
  withConfigurationActor({id:'rollback-target',user:{id:'owner'}},()=>run("UPDATE guild_settings SET censorEnabled=1 WHERE guildId='guild'"));
  run("UPDATE guild_settings SET censorAntiRacismEnabled=1 WHERE guildId='guild'");
  const preview=config.planRollback('rollback-target',guild,'owner');
  config.applyPlan(preview.id,guild,'owner');
  assert.equal(get("SELECT censorEnabled FROM guild_settings WHERE guildId='guild'").censorEnabled,0);
  assert.equal(get("SELECT linkBlockEnabled FROM guild_settings WHERE guildId='guild'").linkBlockEnabled,1);
  assert.equal(get("SELECT censorAntiRacismEnabled FROM guild_settings WHERE guildId='guild'").censorAntiRacismEnabled,1);
  withConfigurationActor({id:'older',user:{id:'owner'}},()=>run("UPDATE guild_settings SET censorAction='WARN' WHERE guildId='guild'"));
  run("UPDATE guild_settings SET censorAction='DELETE' WHERE guildId='guild'");
  assert.throws(()=>config.planRollback('older',guild,'owner'),/changed after this revision/);
});

test('related suggestions normalize punctuation and duplicate links preserve votes and reject cycles',()=>{
  const similarity=require('../utils/suggestions/similarity');
  const first=run("INSERT INTO suggestions(guildId,userId,content,messageId,timestamp) VALUES('suggest-guild','a','Add a music discussion channel','first',1)").lastInsertRowid;
  const second=run("INSERT INTO suggestions(guildId,userId,content,messageId,timestamp) VALUES('suggest-guild','b','Please add music discussion channel!','second',2)").lastInsertRowid;
  assert.equal(similarity.relatedSuggestions('suggest-guild','music discussion channel')[0].id,second);
  similarity.linkDuplicate('suggest-guild',second,first,'manager');
  assert.equal(get('SELECT duplicateOfId FROM suggestions WHERE id=?',[second]).duplicateOfId,first);
  assert.throws(()=>similarity.linkDuplicate('suggest-guild',first,second,'manager'),/cycle/);
  assert.throws(()=>similarity.linkDuplicate('other',first,second,'manager'),/Both suggestions/);
  similarity.unlinkDuplicate('suggest-guild',second);
  assert.equal(get('SELECT duplicateOfId FROM suggestions WHERE id=?',[second]).duplicateOfId,null);
  assert.equal(all("SELECT * FROM suggestions WHERE guildId='suggest-guild'").length,2);
});

test('source checks reject private DNS and classify health without verifying the claim',async()=>{
  const {isPublicAddress,checkSource}=require('../utils/publicSourceCheck');
  for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','100.64.0.1','::1','::ffff:127.0.0.1','fc00::1','2001:db8::1']) assert.equal(isPublicAddress(ip),false,ip);
  assert.equal(isPublicAddress('93.184.216.34'),true);
  let requested=false;
  await assert.rejects(checkSource('https://example.com/',{lookup:async()=>[{address:'127.0.0.1',family:4}],request:()=>{requested=true;}}),/non-public/);
  assert.equal(requested,false);
  const {EventEmitter}=require('node:events');
  const result=await checkSource('https://example.com/',{lookup:async()=>[{address:'93.184.216.34',family:4}],request:(_url,_options,callback)=>{
    const req=new EventEmitter();req.end=()=>callback({statusCode:200,headers:{},destroy:()=>{}});return req;
  }});
  assert.deepEqual(result,{status:'AVAILABLE',httpStatus:200});
  assert.equal(result.verifiedAt,undefined);
});

test('unsourced approved community facts remain eligible with a warning',()=>{
  const facts=require('../utils/dailyFacts');
  const saved=facts.saveApprovedFact({fact:'An approved community example remains eligible without a citation.',category:'science'});
  const pooled=facts.getFactsForCategory('random').find(row=>row.id===saved.id);
  assert.ok(pooled);
  const fields=require('../utils/factSources').sourceFields(pooled);
  assert.ok(fields.some(field=>field.name==='Source Warning'));
  assert.match(fields[0].value,/Not source-verified/);
});

test('free-game reminders require an expiry and are idempotent, cancellable and persistent',()=>{
  const reminders=require('../utils/freeGameReminders');
  const now=Date.now();
  assert.equal(reminders.saveReminderOffer({guildId:'guild',channelId:'channel'},{key:'unknown',source:'STEAM',url:'https://store.steampowered.com/app/1',endsAt:null}),null);
  const id=reminders.saveReminderOffer({guildId:'guild',channelId:'channel'},{key:'known',source:'EPIC',title:'Game',url:'https://store.epicgames.com/p/game',endsAt:now+7200000},now);
  const first=reminders.subscribe(id,'member',now);
  assert.equal(reminders.subscribe(id,'member',now).subscriptionKey,first.subscriptionKey);
  assert.equal(first.remindAt,now+3600000);
  reminders.cancel(id,'member');
  const second=reminders.subscribe(id,'member',now+1);
  assert.notEqual(second.subscriptionKey,first.subscriptionKey);
  const child=spawnSync(process.execPath,['-e',`const d=require('./database');d.initDatabase();if(!d.get("SELECT 1 FROM free_game_reminders WHERE offerId=${id} AND userId='member' AND status='PENDING'"))process.exitCode=1;d.db.close();`],{cwd:path.resolve(__dirname,'..'),env:process.env,encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);
  reminders.cancel(id,'member');
});

test('permission diagnostics honor disabled command controls without executing the command',()=>{
  const {commandReport}=require('../utils/permissionDiagnostics');
  run("INSERT INTO command_controls(guildId,commandName,enabled,updatedBy,updatedAt) VALUES('guild','help',0,'owner',1)");
  let executed=false;
  const report=commandReport({guild,member:{permissions:admin,roles:{cache:new Collection()}},channel:{id:'channel',permissionsFor:()=>admin},name:'help',
    command:{data:{toJSON:()=>({name:'help'})},execute:()=>{executed=true;}}});
  assert.equal(report[0].passed,false);
  assert.equal(executed,false);
});

test('every active built-in has an HTTPS source, reference bindings match exact text, and corrections retain cooldown aliases',()=>{
  const facts=require('../utils/dailyFacts');
  const catalogue=require('../data/dailyFacts.json');
  const references=require('../data/dailyFactReferences.json');
  const rows=facts.codedFactRows();
  assert.ok(rows.length>500);
  for(const row of rows) assert.ok(require('../utils/factSources').validateSourceUrl(row.sourceUrl),row.fact);
  for(const [category,refs] of Object.entries(references)) for(const reference of Object.values(refs)) {
    assert.ok(catalogue[category].some(entry=>(typeof entry==='string'?entry:entry.fact)===reference.originalFact));
    if(reference.replacement) {
      const corrected=rows.find(row=>row.category===category&&row.fact===reference.replacement);
      assert.ok(corrected);
      assert.ok(corrected.legacyFactKeys.includes('fact:'+facts.normalizeFact(reference.originalFact)));
    }
  }
});

test('link availability never verifies claims; a human review persists and source changes invalidate it',async()=>{
  const facts=require('../utils/dailyFacts');
  const maintenance=require('../utils/factSourceMaintenance');
  const saved=facts.saveApprovedFact({fact:'An independent example for persistent human source review.',category:'science',sourceUrl:'https://example.org/review'});
  maintenance.syncSources();
  const key='fact:'+facts.normalizeFact(saved.fact);
  const raw=maintenance.facts().find(row=>row.factKey===key);
  assert.equal(get('SELECT reviewedAt FROM fact_source_health WHERE factKey=?',[key]).reviewedAt,null);
  maintenance.markSourceReviewed(maintenance.referenceFor(raw),'reviewer','Checked the exact claim.');
  assert.ok(facts.getFactsForCategory('random').find(row=>row.id===saved.id).verifiedAt);
  const child=spawnSync(process.execPath,['-e',`const d=require('./database');d.initDatabase();if(!require('./utils/dailyFacts').getFactsForCategory('random').find(f=>f.id===${saved.id})?.verifiedAt)process.exitCode=1;d.db.close();`],{cwd:path.resolve(__dirname,'..'),env:process.env,encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);
  run('UPDATE dailyfact_facts SET sourceUrl=? WHERE id=?',['https://example.org/changed',saved.id]);
  maintenance.syncSources();
  assert.equal(get('SELECT reviewedAt FROM fact_source_health WHERE factKey=?',[key]).reviewedAt,null);
  assert.equal(facts.getFactsForCategory('random').find(row=>row.id===saved.id).verifiedAt,null);
});

test('repeated store checks do not push an existing reminder into the future and delivery is at most once',async()=>{
  const reminders=require('../utils/freeGameReminders');
  const now=Date.now();
  const offer={key:'deliver-once',source:'EPIC',title:'Example Game',url:'https://store.epicgames.com/p/example',endsAt:now+7_200_000};
  const settings={guildId:'remind-guild',channelId:'remind-channel'};
  const id=reminders.saveReminderOffer(settings,offer,now);
  const subscription=reminders.subscribe(id,'recipient',now);
  reminders.saveReminderOffer(settings,offer,now+3_500_000);
  assert.equal(get('SELECT remindAt FROM free_game_reminders WHERE offerId=?',[id]).remindAt,subscription.remindAt);
  let sends=0;
  const client={user:{id:'bot'},channels:{fetch:async()=>({guild:{members:{fetch:async()=>({id:'recipient'})}},permissionsFor:()=>admin})},
    users:{fetch:async()=>({createDM:async()=>({client:{user:{id:'bot'}},send:async()=>{sends++;return{id:'dm-reminder'};}})})}};
  await reminders.processReminders(client,now+3_600_001);
  await reminders.processReminders(client,now+3_600_002);
  assert.equal(sends,1);
  assert.equal(get('SELECT status FROM free_game_reminders WHERE offerId=?',[id]).status,'SENT');
});

test('configuration allowlist has no missing columns or keys and exports no runtime state',()=>{
  const {TABLES,configurationSpecs}=require('../utils/configurationTables');
  for(const [table,columns]of Object.entries(TABLES)) {
    const schema=all(`PRAGMA table_info(${table})`);
    for(const column of columns) assert.ok(schema.some(c=>c.name===column),`${table}.${column}`);
  }
  assert.equal(configurationSpecs(all).length,Object.keys(TABLES).length);
  const exported=config.exportConfiguration('guild');
  assert.equal(exported.tables.guild_settings[0].staffListMessageId,undefined);
  assert.equal(exported.tables.giveaways,undefined);
  assert.equal(exported.tables.tickets,undefined);
  assert.equal(exported.tables.dailyfact_facts,undefined);
});

test('source redirects are revalidated before connecting to a different address',async()=>{
  const {checkSource}=require('../utils/publicSourceCheck');
  const {EventEmitter}=require('node:events');
  let requests=0;
  await assert.rejects(checkSource('https://public.example.org/',{
    lookup:async host=>[{address:host==='public.example.org'?'93.184.216.34':'10.0.0.1',family:4}],
    request:(_url,_options,callback)=>{
      requests++;
      const req=new EventEmitter();req.end=()=>callback({statusCode:302,headers:{location:'https://internal.example.org/'},destroy:()=>{}});return req;
    }
  }),/non-public/);
  assert.equal(requests,1);
});

test('cancelling while the DM is being prepared prevents a reminder from being sent',async()=>{
  const reminders=require('../utils/freeGameReminders');
  const now=Date.now();
  const id=reminders.saveReminderOffer({guildId:'cancel-guild',channelId:'cancel-channel'},
    {key:'cancel-race',source:'EPIC',title:'Cancelled game',url:'https://store.epicgames.com/p/cancelled',endsAt:now+7_200_000});
  reminders.subscribe(id,'cancel-member');
  let sends=0;
  await reminders.processReminders({user:{id:'bot'},channels:{fetch:async()=>({guild:{members:{fetch:async()=>({id:'cancel-member'})}},permissionsFor:()=>admin})},
    users:{fetch:async()=>({createDM:async()=>{reminders.cancel(id,'cancel-member');return{client:{user:{id:'bot'}},send:async()=>{sends++;return{id:'unexpected'};}};}})}},now+3_600_001);
  assert.equal(sends,0);
  assert.equal(get('SELECT status FROM free_game_reminders WHERE offerId=?',[id]).status,'CANCELLED');
});

test('a source review delivered by the generic retry worker is finalized without resetting its sent time',()=>{
  const maintenance=require('../utils/factSourceMaintenance');
  const fact=require('../utils/dailyFacts').codedFactRows()[0];
  maintenance.syncSources();
  const sentAt=Date.now()-600_000;
  const result=require('../utils/deliveryOutbox').enqueueDelivery({deliveryKey:'source-review-finalize',type:'FACT_SOURCE_REVIEW',payload:{keys:[fact.factKey]}});
  run("UPDATE delivery_outbox SET status='SENT',sentAt=? WHERE deliveryKey=?",[sentAt,result.deliveryKey]);
  maintenance.finalizeReviewNotice(get('SELECT * FROM delivery_outbox WHERE deliveryKey=?',[result.deliveryKey]));
  assert.equal(get('SELECT reviewNotifiedAt FROM fact_source_health WHERE factKey=?',[fact.factKey]).reviewNotifiedAt,sentAt);
  assert.ok(get('SELECT finalizedAt FROM delivery_outbox WHERE deliveryKey=?',[result.deliveryKey]).finalizedAt);
});

test('explicitly disabled censor configuration is preserved by startup',()=>{
  run("INSERT INTO guild_settings(guildId,modlogChannelId,censorEnabled) VALUES('disabled-censor','log-channel',0)");
  const child=spawnSync(process.execPath,['-e',"const d=require('./database');d.initDatabase();d.db.close();"],{cwd:path.resolve(__dirname,'..'),env:process.env,encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);
  assert.equal(get("SELECT censorEnabled FROM guild_settings WHERE guildId='disabled-censor'").censorEnabled,0);
});

test('partial settings merges validate against the existing row and preserve daily delivery state',()=>{
  run("INSERT INTO dailyfact_config(guildId,enabled,channelId,lastSent) VALUES('guild',0,'channel','2026-10-30')");
  const plan=config.planImport({version:1,tables:{dailyfact_config:[{guildId:'guild',enabled:1}]}},guild,'owner');
  config.applyPlan(plan.id,guild,'owner');
  assert.equal(get("SELECT enabled FROM dailyfact_config WHERE guildId='guild'").enabled,1);
  assert.equal(get("SELECT lastSent FROM dailyfact_config WHERE guildId='guild'").lastSent,'2026-10-30');
  assert.throws(()=>config.planImport({version:1,tables:{free_game_settings:[{guildId:'guild',enabled:1}]}},guild,'owner'),/needs a channel/);
  assert.throws(()=>config.planImport({version:1,tables:{leveling_config:[{guildId:'guild',xpMin:50,xpMax:10}]}},guild,'owner'),/Maximum XP/);
});
