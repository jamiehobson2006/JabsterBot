const { randomUUID,randomInt } = require('node:crypto');
const { EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,PermissionFlagsBits:P } = require('discord.js');
const { all,get,run,transaction } = require('../database');
const { safeText,validRole } = require('./communityAccess');

const DEFAULTS={enabled:0,title:'Moderator Training',passPercent:80,questionCount:5,maxAttempts:3,
  cooldownMinutes:60,attemptWindowDays:7,requireReview:1,showFeedback:0,shuffle:1};
function settings(guildId) {return {...DEFAULTS,...get('SELECT * FROM training_settings WHERE guildId=?',[guildId]),guildId};}
function trainer(member) {
  const config=settings(member.guild.id);
  return member.permissions.has(P.Administrator) || Boolean(config.trainerRoleId && member.roles.cache.has(config.trainerRoleId));
}
function trainee(member) {
  const config=settings(member.guild.id);
  return member.permissions.has(P.Administrator) || !config.traineeRoleId || member.roles.cache.has(config.traineeRoleId);
}
async function authorize(interaction,management=false,allowTrainer=false) {
  const member=await interaction.guild.members.fetch({user:interaction.user.id,force:true});
  if(!(management?trainer(member):trainee(member) || allowTrainer && trainer(member))) throw new Error(management?
    'Administrator or the configured trainer role is required.':'The configured trainee role is required.');
  return member;
}
function configure(guildId,values,member) {
  if(!member.permissions.has(P.Administrator)) throw new Error('Only administrators may change training access or assessment settings.');
  const row={...settings(guildId),...values};
  row.title=safeText(row.title,120);
  for(const [key,min,max] of [['passPercent',1,100],['questionCount',1,20],['maxAttempts',1,50],
    ['cooldownMinutes',0,10080],['attemptWindowDays',1,365]]) {
    if(!Number.isInteger(row[key]) || row[key]<min || row[key]>max) throw new Error(`${key} must be ${min}-${max}.`);
  }
  const columns=['enabled','trainerRoleId','traineeRoleId','reviewChannelId','title','passPercent','questionCount',
    'maxAttempts','cooldownMinutes','attemptWindowDays','requireReview','showFeedback','shuffle'];
  for(const key of ['enabled','requireReview','showFeedback','shuffle']) row[key]=Number(Boolean(row[key]));
  run(`INSERT INTO training_settings(guildId,${columns.join(',')}) VALUES(?,${columns.map(()=>'?').join(',')})
    ON CONFLICT(guildId) DO UPDATE SET ${columns.map(key=>`${key}=excluded.${key}`).join(',')}`,
  [guildId,...columns.map(key=>row[key] ?? null)]);
  return settings(guildId);
}
function scenario(guildId,id) {return get('SELECT * FROM training_scenarios WHERE guildId=? AND id=?',[guildId,id]);}
function saveScenario(guildId,actorId,values,id=null) {
  const before=id?scenario(guildId,id):null;
  if(id && !before) throw new Error('Scenario not found in this server.');
  const row={kind:'CHOICE',topic:'general',points:1,enabled:1,...before,...values};
  row.title=safeText(row.title,120);row.prompt=safeText(row.prompt,2000);
  row.expected=safeText(row.expected,500);row.explanation=safeText(row.explanation,1500);
  row.topic=require('./communityAccess').slug(row.topic);
  if(!['CHOICE','TEXT'].includes(row.kind)) throw new Error('Choose CHOICE or TEXT.');
  const choices=values.choices ?? JSON.parse(before?.choicesJson || '[]');
  const normalized=choices.map(value=>safeText(value,80));
  if(row.kind==='CHOICE' && (normalized.length<2 || normalized.length>10 || new Set(normalized.map(value=>value.toLowerCase())).size!==normalized.length ||
    !normalized.some(value=>value.toLowerCase()===row.expected.toLowerCase()))) {
    throw new Error('Choice scenarios need 2-10 unique options and an expected answer matching one option.');
  }
  if(!Number.isInteger(row.points) || row.points<1 || row.points>20) throw new Error('Points must be 1-20.');
  if(!before && get('SELECT COUNT(*) n FROM training_scenarios WHERE guildId=?',[guildId]).n>=500) throw new Error('This server has reached 500 scenarios. Edit an existing scenario.');
  const args=[row.title,row.prompt,row.topic,row.kind,JSON.stringify(row.kind==='CHOICE'?normalized:[]),row.expected,row.explanation,row.points,
    Number(Boolean(row.enabled)),actorId,Date.now()];
  if(before) run(`UPDATE training_scenarios SET title=?,prompt=?,topic=?,kind=?,choicesJson=?,expected=?,explanation=?,points=?,
    enabled=?,updatedBy=?,updatedAt=?,version=version+1 WHERE guildId=? AND id=?`,[...args,guildId,id]);
  else id=Number(run(`INSERT INTO training_scenarios(title,prompt,topic,kind,choicesJson,expected,explanation,points,enabled,updatedBy,updatedAt,guildId)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,[...args,guildId]).lastInsertRowid);
  return scenario(guildId,id);
}
function session(guildId,id) {return get('SELECT * FROM training_sessions WHERE guildId=? AND id=?',[guildId,id]);}
function ownSession(guildId,userId) {return get("SELECT * FROM training_sessions WHERE guildId=? AND userId=? AND status IN ('ACTIVE','REVIEW') ORDER BY createdAt DESC LIMIT 1",[guildId,userId]);}
function start(member,{topic=null,assignedBy=null,random=randomInt}={}) {
  const guildId=member.guild.id,config=settings(guildId);
  if(!config.enabled) throw new Error('Moderator training is disabled. Ask an administrator to configure and enable it.');
  if(!trainee(member) || member.user?.bot) throw new Error('This member does not meet the trainee-role requirement.');
  const existing=ownSession(guildId,member.id);
  if(existing) return existing;
  const reset=get('SELECT resetAt FROM training_attempt_resets WHERE guildId=? AND userId=?',[guildId,member.id])?.resetAt || 0;
  const cutoff=Date.now()-config.attemptWindowDays*86400000;
  const attempts=get("SELECT COUNT(*) n,MAX(createdAt) latest FROM training_sessions WHERE guildId=? AND userId=? AND createdAt>=? AND createdAt>? AND status!='CANCELLED'",[guildId,member.id,cutoff,reset]);
  if(attempts.n>=config.maxAttempts) throw new Error('Attempt limit reached for this training window. A trainer can reset eligibility without deleting your results.');
  if(attempts.latest && Date.now()-attempts.latest<config.cooldownMinutes*60000) throw new Error('Please wait for the configured training cooldown before starting again.');
  const questions=all('SELECT * FROM training_scenarios WHERE guildId=? AND enabled=1 AND (? IS NULL OR topic=?) ORDER BY id',[guildId,topic,topic]);
  if(!questions.length) throw new Error('No enabled scenarios match this topic. Ask a trainer to add scenarios.');
  if(config.shuffle) for(let i=questions.length-1;i>0;i--) {const j=random(i+1);[questions[i],questions[j]]=[questions[j],questions[i]];}
  const picked=questions.slice(0,config.questionCount),id=randomUUID();
  run(`INSERT INTO training_sessions(id,guildId,userId,assignedBy,questionsJson,settingsJson,maxScore,createdAt)
    VALUES(?,?,?,?,?,?,?,?)`,[id,guildId,member.id,assignedBy,JSON.stringify(picked),JSON.stringify(config),picked.reduce((sum,row)=>sum+row.points,0),Math.max(Date.now(),reset+1)]);
  return session(guildId,id);
}
function questionPayload(row) {
  const questions=JSON.parse(row.questionsJson),config=JSON.parse(row.settingsJson),question=questions[row.nextQuestion];
  if(row.status!=='ACTIVE' || !question) return resultPayload(row,false);
  const choices=JSON.parse(question.choicesJson || '[]');
  const embed=new EmbedBuilder().setColor(0x5865F2).setTitle(config.title)
    .setDescription(`**${question.title}**\n\n${question.prompt}`)
    .addFields({name:'Question',value:`${row.nextQuestion+1}/${questions.length}`,inline:true},
      {name:'Points',value:String(question.points),inline:true});
  if(choices.length) embed.addFields({name:'Choices',value:choices.map((value,index)=>`${index+1}. ${value}`).join('\n')});
  embed.setFooter({text:'Simulation only. No real warnings, bans, kicks or timeouts are applied.'});
  return {embeds:[embed],components:[new ActionRowBuilder().addComponents(new ButtonBuilder()
    .setCustomId(`training-answer:${row.id}:${row.nextQuestion}`).setLabel('Answer scenario').setStyle(ButtonStyle.Primary))],allowedMentions:{parse:[]}};
}
function answer(member,id,index,response,reason='') {
  if(!trainee(member) || !settings(member.guild.id).enabled) throw new Error('Training is disabled or you no longer have the trainee role.');
  response=safeText(response,1000);reason=safeText(reason,1000,{required:false});
  return transaction(()=>{
    const row=session(member.guild.id,id);
    if(!row || row.userId!==member.id || row.status!=='ACTIVE' || row.nextQuestion!==index) throw new Error('This question is out of date or belongs to another trainee. Use /training next.');
    const questions=JSON.parse(row.questionsJson),config=JSON.parse(row.settingsJson),answers=JSON.parse(row.answersJson),question=questions[index];
    if(question.kind==='CHOICE') {
      const choices=JSON.parse(question.choicesJson);
      const selected=choices.find(value=>value.toLowerCase()===response.toLowerCase()) || (/^\d+$/.test(response)?choices[Number(response)-1]:null);
      if(!selected) throw new Error('Choose one listed option by its name or number.');
      response=selected;
    }
    answers.push({questionId:question.id,response,reason,submittedAt:Date.now(),
      points:question.kind==='CHOICE'?(response.toLowerCase()===question.expected.toLowerCase()?question.points:0):null,
      feedback:null,gradedBy:null});
    const finished=index+1===questions.length;
    const score=answers.reduce((sum,value)=>sum+(value.points || 0),0);
    const status=finished ? config.requireReview || answers.some(value=>value.points===null)?'REVIEW':score/row.maxScore*100>=config.passPercent?'PASSED':'FAILED' : 'ACTIVE';
    const changed=run(`UPDATE training_sessions SET answersJson=?,nextQuestion=?,score=?,status=?,completedAt=?
      WHERE id=? AND guildId=? AND status='ACTIVE' AND nextQuestion=?`,
    [JSON.stringify(answers),index+1,score,status,finished?Date.now():null,id,member.guild.id,index]);
    if(!changed.changes) throw new Error('Another answer already advanced this attempt.');
    return session(member.guild.id,id);
  });
}
function grade(member,id,number,points,feedback) {
  if(!trainer(member)) throw new Error('Trainer access is required.');
  feedback=safeText(feedback,1000);
  return transaction(()=>{
    const row=session(member.guild.id,id);
    if(!row || row.status!=='REVIEW') throw new Error('This attempt is not awaiting review.');
    if(row.userId===member.id) throw new Error('You cannot grade your own attempt.');
    const questions=JSON.parse(row.questionsJson),answers=JSON.parse(row.answersJson),question=questions[number-1];
    if(!question || !Number.isInteger(points) || points<0 || points>question.points) throw new Error('Choose an existing question and points within its maximum.');
    answers[number-1]={...answers[number-1],points,feedback,gradedBy:member.id};
    run('UPDATE training_sessions SET answersJson=?,score=? WHERE id=?',[JSON.stringify(answers),answers.reduce((sum,value)=>sum+(value.points || 0),0),id]);
    return session(member.guild.id,id);
  });
}
function review(member,id,feedback) {
  if(!trainer(member)) throw new Error('Trainer access is required.');
  feedback=safeText(feedback,1500);
  return transaction(()=>{
    const row=session(member.guild.id,id);
    if(!row || row.status!=='REVIEW') throw new Error('Attempt not found or already reviewed.');
    if(row.userId===member.id) throw new Error('You cannot review your own attempt.');
    if(JSON.parse(row.answersJson).some(value=>value.points===null)) throw new Error('Grade every written answer before completing review.');
    const config=JSON.parse(row.settingsJson),status=row.score/row.maxScore*100>=config.passPercent?'PASSED':'FAILED';
    run("UPDATE training_sessions SET status=?,reviewedBy=?,reviewedAt=?,feedback=? WHERE id=? AND status='REVIEW'",
      [status,member.id,Date.now(),feedback,id]);
    return session(member.guild.id,id);
  });
}
function resultPayload(row,includeAnswers=false,page=1) {
  const config=JSON.parse(row.settingsJson),questions=JSON.parse(row.questionsJson),answers=JSON.parse(row.answersJson);
  const released=['PASSED','FAILED'].includes(row.status);
  const details=includeAnswers || released && config.showFeedback;
  page=Math.max(1,Math.min(details?questions.length*2:1,page));
  const embed=new EmbedBuilder().setColor(row.status==='PASSED'?0x57F287:0x5865F2).setTitle(config.title)
    .setDescription(`Trainee: <@${row.userId}>\nStatus: **${row.status}**\nAttempt: \`${row.id}\``)
    .addFields({name:'Progress',value:`${row.nextQuestion}/${questions.length}`,inline:true});
  if(released || includeAnswers) embed.addFields({name:'Score',value:`${row.score}/${row.maxScore} (${Math.round(row.score/row.maxScore*100)}%)`,inline:true});
  const add=(name,value)=>{
    for(let index=0;index<String(value).length;index+=1000)embed.addFields({name:index?`${name} continued`:name,value:String(value).slice(index,index+1000)});
  };
  if(details) {
    const index=Math.floor((page-1)/2),question=questions[index],value=answers[index];
    if(page%2) {
      embed.setDescription(`${embed.data.description}\n\n**${index+1}. ${question.title}**\n${question.prompt}`);
      add('Submitted answer',value?.response || 'Not answered');add('Reasoning',value?.reason || 'Not supplied');
      if(value?.feedback)add('Marking feedback',value.feedback);
    } else {
      add('Expected answer / rubric',question.expected);add('Explanation',question.explanation);
      if(value?.feedback)add('Marking feedback',value.feedback);
      if(row.feedback && released)add('Overall trainer feedback',row.feedback);
    }
  }else if(row.feedback && released) {
    add('Trainer feedback',row.feedback);
  }
  embed.setFooter({text:`Simulation only | Answer review page ${page}/${details?questions.length*2:1}`});
  return {embeds:[embed],components:[],allowedMentions:{parse:[]}};
}
async function notifyReview(client,row) {
  if(!['REVIEW','PASSED','FAILED'].includes(row.status)) return;
  if(row.status==='REVIEW') {
    const channelId=settings(row.guildId).reviewChannelId;
    if(!channelId) return;
    const payload={content:`Training attempt awaiting review: \`${row.id}\`\nTrainee: <@${row.userId}>`,allowedMentions:{parse:[]}};
    const outbox=require('./deliveryOutbox'),key=`training-review:${row.id}`;
    outbox.enqueueDelivery({deliveryKey:key,type:'TRAINING_REVIEW',guildId:row.guildId,channelId,payload:{message:payload}});
    await outbox.deliverOnce(key,async claimed=>{
      const channel=await client.channels.fetch(claimed.channelId);
      if(channel?.guild?.id!==row.guildId) throw new Error('Training review channel is unavailable.');
      return outbox.sendQueuedMessage(channel,claimed,payload,{beforeSend:()=>{
        if(session(row.guildId,row.id)?.status!=='REVIEW' || settings(row.guildId).reviewChannelId!==claimed.channelId)
          throw new Error('Training review destination or attempt changed before delivery.');
      }});
    });
  } else {
    const outbox=require('./deliveryOutbox'),key=`training-result:${row.id}`;
    const payload=resultPayload(row);
    outbox.enqueueDelivery({deliveryKey:key,type:'TRAINING_RESULT',guildId:row.guildId,payload:{sessionId:row.id,message:payload}});
    await outbox.deliverOnce(key,async claimed=>{
      const user=await client.users.fetch(row.userId),dm=await user.createDM();
      return outbox.sendQueuedMessage(dm,claimed,payload);
    });
  }
}
async function maintainNotifications(client){
  run(`UPDATE delivery_outbox SET status='CANCELLED',leaseUntil=NULL WHERE type='TRAINING_REVIEW'
    AND status IN ('PENDING','FAILED','PROCESSING') AND COALESCE(leaseUntil,0)<? AND deliveryKey IN
    (SELECT 'training-review:'||s.id FROM training_sessions s LEFT JOIN training_settings c ON c.guildId=s.guildId
     WHERE s.status!='REVIEW' OR c.reviewChannelId IS NULL)`,[Date.now()]);
  // Recover notices even if the process stopped after saving an answer but before enqueueing its notification.
  const rows=all(`SELECT s.* FROM training_sessions s LEFT JOIN training_settings c ON c.guildId=s.guildId
    LEFT JOIN delivery_outbox d ON d.deliveryKey=(CASE WHEN s.status='REVIEW' THEN 'training-review:' ELSE 'training-result:' END)||s.id
    WHERE (s.status IN ('PASSED','FAILED') OR (s.status='REVIEW' AND c.reviewChannelId IS NOT NULL))
    AND (d.deliveryKey IS NULL OR (d.status IN ('PENDING','FAILED','PROCESSING') AND d.nextAttemptAt<=? AND COALESCE(d.leaseUntil,0)<?))
    ORDER BY s.completedAt LIMIT 25`,[Date.now(),Date.now()]);
  for(const row of rows)try{await notifyReview(client,row);}catch(error){
    if(Number(error.code)===50007)run("UPDATE delivery_outbox SET status='CANCELLED',leaseUntil=NULL WHERE deliveryKey=?",[`training-result:${row.id}`]);
  }
  run('DELETE FROM help_views WHERE expiresAt<?',[Date.now()]);
}
module.exports={DEFAULTS,answer,authorize,configure,grade,maintainNotifications,notifyReview,ownSession,questionPayload,resultPayload,review,saveScenario,scenario,session,settings,start,trainee,trainer,validRole};
