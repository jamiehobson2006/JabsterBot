const {SlashCommandBuilder,PermissionFlagsBits:P}=require('discord.js');
const training=require('../../utils/moderatorTraining');
const {all,run}=require('../../database');
const {pageRows,safeText}=require('../../utils/communityAccess');
const text=(c,name,description,required=false,max=100)=>c.addStringOption(o=>o.setName(name).setDescription(description).setRequired(required).setMaxLength(max));
const integer=(c,name,description,min,max,required=false)=>c.addIntegerOption(o=>o.setName(name).setDescription(description).setMinValue(min).setMaxValue(max).setRequired(required));
const attempt=c=>text(c,'attempt','Attempt ID from results or the review notification',true,36);
const data=new SlashCommandBuilder().setName('training').setDescription('Custom moderator training simulations and trainer assessment.').setDMPermission(false);
data.addSubcommand(c=>c.setName('configure').setDescription('Administrator: customize access, scoring and assessment settings.')
  .addBooleanOption(o=>o.setName('enabled').setDescription('Enable training'))
  .addRoleOption(o=>o.setName('trainer_role').setDescription('Role allowed to author, assign and review scenarios'))
  .addRoleOption(o=>o.setName('trainee_role').setDescription('Role required to take and answer training'))
  .addChannelOption(o=>o.setName('review_channel').setDescription('Private channel for review notifications').addChannelTypes(0))
  .addStringOption(o=>o.setName('clear').setDescription('Remove a configured restriction').addChoices(...['trainer','trainee','review-channel'].map(value=>({name:value,value}))))
  .addStringOption(o=>o.setName('title').setDescription('Assessment title').setMaxLength(120))
  .addIntegerOption(o=>o.setName('pass_percent').setDescription('Passing percentage').setMinValue(1).setMaxValue(100))
  .addIntegerOption(o=>o.setName('questions').setDescription('Scenarios per new attempt').setMinValue(1).setMaxValue(20))
  .addIntegerOption(o=>o.setName('max_attempts').setDescription('Attempts allowed per rolling window').setMinValue(1).setMaxValue(50))
  .addIntegerOption(o=>o.setName('window_days').setDescription('Rolling attempt window in days').setMinValue(1).setMaxValue(365))
  .addIntegerOption(o=>o.setName('cooldown_minutes').setDescription('Gap between attempts').setMinValue(0).setMaxValue(10080))
  .addBooleanOption(o=>o.setName('require_review').setDescription('Require a trainer to finalize every attempt'))
  .addBooleanOption(o=>o.setName('show_feedback').setDescription('Release expected answers after final results'))
  .addBooleanOption(o=>o.setName('shuffle').setDescription('Randomize scenarios in new attempts')));
data.addSubcommand(c=>c.setName('settings').setDescription('Show training access and assessment settings.'));
data.addSubcommand(c=>integer(c.setName('queue').setDescription('Trainer: list attempts awaiting review.'),'page','Queue page',1,10000));
data.addSubcommandGroup(g=>{
  g.setName('scenario').setDescription('Trainer: create and maintain custom scenarios.');
  for(const verb of ['create','edit']) g.addSubcommand(c=>{
    c.setName(verb).setDescription(`${verb} a scenario; edits affect only future attempts.`);
    if(verb==='edit') integer(c,'id','Scenario ID',1,2147483647,true);
    const required=verb==='create';
    for(const [name,description,max]of [['title','Short scenario title',120],['prompt','Full situation and question',2000],
      ['expected','Correct choice or marking rubric',500],['explanation','Explanation released according to settings',1500]]) text(c,name,description,required,max);
    text(c,'topic','Topic name',false,32);
    c.addStringOption(o=>o.setName('kind').setDescription('Choice or manually assessed written answer').addChoices({name:'Choice',value:'CHOICE'},{name:'Written',value:'TEXT'}));
    text(c,'choices','2-10 choices separated by |',false,809);
    integer(c,'points','Maximum marks',1,20);
    c.addBooleanOption(o=>o.setName('enabled').setDescription('Include in future attempts'));
    return c;
  });
  g.addSubcommand(c=>integer(c.setName('remove').setDescription('Retire a scenario without changing saved attempts.'),'id','Scenario ID',1,2147483647,true));
  g.addSubcommand(c=>integer(c.setName('view').setDescription('Trainer: inspect a full scenario and marking rubric.'),'id','Scenario ID',1,2147483647,true));
  g.addSubcommand(c=>integer(text(c.setName('list').setDescription('List scenario IDs, topics and rubric details.'),'topic','Optional topic',false,32),'page','Page',1,10000));
  return g;
});
data.addSubcommand(c=>text(c.setName('start').setDescription('Start or resume your training attempt.'),'topic','Optional scenario topic',false,32));
data.addSubcommand(c=>c.setName('next').setDescription('Resume your current question after any restart.'));
data.addSubcommand(c=>text(text(c.setName('answer').setDescription('Submit an answer to your current scenario.'),'answer','Choice name/number or written response',true,1000),'reason','Explain your reasoning',false,1000));
data.addSubcommand(c=>text(c.setName('assign').setDescription('Trainer: assign or resume training for a member.')
  .addUserOption(o=>o.setName('user').setDescription('Trainee').setRequired(true)),'topic','Optional scenario topic',false,32));
data.addSubcommand(c=>integer(integer(attempt(c.setName('grade').setDescription('Trainer: award marks and feedback for one answer.')),
  'question','Question number',1,20,true),'points','Marks awarded',0,20,true)
  .addStringOption(o=>o.setName('feedback').setDescription('Marking explanation').setRequired(true).setMaxLength(1000)));
data.addSubcommand(c=>text(attempt(c.setName('review').setDescription('Trainer: finalize a graded attempt using its saved pass mark.')),'feedback','Overall trainer feedback',true,1500));
data.addSubcommand(c=>integer(text(c.setName('results').setDescription('Your results; trainers can inspect other attempts.')
  .addUserOption(o=>o.setName('user').setDescription('Trainee to inspect')),'attempt','Specific attempt ID',false,36),'page','Results/review page',1,10000));
data.addSubcommand(c=>text(attempt(c.setName('cancel').setDescription('Trainer: cancel an attempt while keeping its audit history.')),'reason','Cancellation reason',true,500));
data.addSubcommand(c=>text(c.setName('reset').setDescription('Trainer: reset attempt eligibility without deleting results.')
  .addUserOption(o=>o.setName('user').setDescription('Trainee').setRequired(true)),'reason','Reset reason',true,500));

module.exports={data,ephemeral:true,dmPermission:false,async execute(interaction){
  const sub=interaction.options.getSubcommand(),group=interaction.options.getSubcommandGroup(false),guildId=interaction.guild.id;
  const management=Boolean(group) || ['assign','grade','review','reset','cancel','queue'].includes(sub);
  const member=await training.authorize(interaction,management,['settings','results'].includes(sub));
  const string=name=>interaction.options.getString(name),number=name=>interaction.options.getInteger(name);
  if(sub==='queue')return interaction.editReply({content:pageRows(all("SELECT * FROM training_sessions WHERE guildId=? AND status='REVIEW' ORDER BY completedAt",[guildId]),number('page') || 1,5)
    .map(row=>`\`${row.id}\` | <@${row.userId}> | ${row.score}/${row.maxScore} provisional marks`).join('\n') || 'No attempts awaiting review on this page.',allowedMentions:{parse:[]}});
  if(sub==='configure') {
    const values={};
    for(const [option,key]of Object.entries({title:'title',pass_percent:'passPercent',questions:'questionCount',max_attempts:'maxAttempts',window_days:'attemptWindowDays',cooldown_minutes:'cooldownMinutes'})) {
      const value=option==='title'?string(option):number(option);if(value!==null) values[key]=value;
    }
    for(const [option,key]of Object.entries({enabled:'enabled',require_review:'requireReview',show_feedback:'showFeedback',shuffle:'shuffle'})) {
      const value=interaction.options.getBoolean(option);if(value!==null) values[key]=Number(value);
    }
    for(const [option,key]of [['trainer_role','trainerRoleId'],['trainee_role','traineeRoleId']]) {
      const role=interaction.options.getRole(option);training.validRole(interaction.guild,role);if(role) values[key]=role.id;
    }
    const channel=interaction.options.getChannel('review_channel');
    if(channel) {const issue=require('../../utils/destinationValidation').destinationIssue(interaction.guild,channel);if(issue) throw new Error(issue);values.reviewChannelId=channel.id;}
    const clear=string('clear');if(clear) values[{trainer:'trainerRoleId',trainee:'traineeRoleId','review-channel':'reviewChannelId'}[clear]]=null;
    training.configure(guildId,values,member);
    return interaction.editReply('Training configuration saved. Existing attempts keep their original assessment settings.');
  }
  if(sub==='settings') {
    const s=training.settings(guildId);
    return interaction.editReply({content:`**${s.title}**\n${s.enabled?'Enabled':'Disabled'} | Pass: ${s.passPercent}% | Questions: ${s.questionCount}\nTrainer: ${s.trainerRoleId?`<@&${s.trainerRoleId}>`:'Administrator'}\nTrainee: ${s.traineeRoleId?`<@&${s.traineeRoleId}>`:'All members'}\nReview: ${s.requireReview?'Required':'Automatic for choice-only attempts'} | Answer feedback: ${s.showFeedback?'After final results':'Hidden'}\nAttempts: ${s.maxAttempts} per ${s.attemptWindowDays} days | Cooldown: ${s.cooldownMinutes} minutes`,allowedMentions:{parse:[]}});
  }
  if(group==='scenario') {
    if(sub==='view') {
      const row=training.scenario(guildId,number('id'));if(!row)throw new Error('Scenario not found.');
      const {EmbedBuilder}=require('discord.js');const embed=new EmbedBuilder().setColor(0x5865F2).setTitle(row.title).setDescription(row.prompt)
        .addFields({name:'Expected / rubric',value:row.expected},{name:'Explanation',value:row.explanation.slice(0,1000)});
      if(row.explanation.length>1000)embed.addFields({name:'Explanation continued',value:row.explanation.slice(1000)});
      return interaction.editReply({embeds:[embed],allowedMentions:{parse:[]}});
    }
    if(sub==='list') {
      const rows=all('SELECT * FROM training_scenarios WHERE guildId=? AND (? IS NULL OR topic=?) ORDER BY id',[guildId,string('topic'),string('topic')]);
      return interaction.editReply({content:pageRows(rows,number('page') || 1,4).map(row=>`**#${row.id} ${row.title}** | ${row.topic} | ${row.kind} | ${row.points} marks | ${row.enabled?'Enabled':'Retired'}`).join('\n\n') || 'No scenarios on this page.',allowedMentions:{parse:[]}});
    }
    if(sub==='remove') {if(!training.scenario(guildId,number('id'))) throw new Error('Scenario not found.');run('UPDATE training_scenarios SET enabled=0,version=version+1 WHERE guildId=? AND id=?',[guildId,number('id')]);return interaction.editReply('Scenario retired. Existing attempts are unchanged.');}
    const values={};for(const key of ['title','prompt','expected','explanation','topic','kind']) if(string(key)!==null) values[key]=string(key);
    if(string('choices')!==null) values.choices=string('choices').split('|').map(value=>value.trim());
    if(number('points')!==null) values.points=number('points');
    if(interaction.options.getBoolean('enabled')!==null) values.enabled=Number(interaction.options.getBoolean('enabled'));
    const row=training.saveScenario(guildId,member.id,values,sub==='edit'?number('id'):null);
    return interaction.editReply(`Scenario #${row.id} saved (version ${row.version}).`);
  }
  if(['start','assign'].includes(sub)) {
    const target=sub==='assign'?await interaction.guild.members.fetch({user:interaction.options.getUser('user',true).id,force:true}):member;
    const row=training.start(target,{topic:string('topic'),assignedBy:sub==='assign'?member.id:null});
    return interaction.editReply(sub==='assign'?{content:`Training assigned to <@${target.id}>. They can use /training next. Attempt: \`${row.id}\``,allowedMentions:{parse:[]}}:training.questionPayload(row));
  }
  if(['next','answer'].includes(sub)) {
    let row=training.ownSession(guildId,member.id);if(!row) throw new Error('No open attempt. Use /training start.');
    if(sub==='answer') {row=training.answer(member,row.id,row.nextQuestion,string('answer'),string('reason') || '');await training.notifyReview(interaction.client,row).catch(error=>console.error('Training notification:',error.message));}
    return interaction.editReply(training.questionPayload(row));
  }
  if(sub==='results') {
    const user=interaction.options.getUser('user') || interaction.user;
    if(user.id!==member.id && !training.trainer(member)) throw new Error('Only trainers can inspect another trainee.');
    const row=string('attempt')?training.session(guildId,string('attempt')):null;
    if(string('attempt')) {
      if(!row || row.userId!==member.id && !training.trainer(member)) throw new Error('Attempt not found.');
      return interaction.editReply(training.resultPayload(row,training.trainer(member) && row.userId!==member.id,number('page') || 1));
    }
    const rows=all('SELECT id,status,score,maxScore,createdAt FROM training_sessions WHERE guildId=? AND userId=? ORDER BY createdAt DESC',[guildId,user.id]);
    return interaction.editReply({content:pageRows(rows,number('page') || 1).map(row=>`\`${row.id}\` | ${row.status}${['PASSED','FAILED'].includes(row.status)?` | ${row.score}/${row.maxScore}`:''} | <t:${Math.floor(row.createdAt/1000)}:d>`).join('\n') || 'No attempts on this page.',allowedMentions:{parse:[]}});
  }
  if(sub==='grade') {const row=training.grade(member,string('attempt'),number('question'),number('points'),string('feedback'));return interaction.editReply(training.resultPayload(row,true,number('question')*2-1));}
  if(sub==='review') {const row=training.review(member,string('attempt'),string('feedback'));await training.notifyReview(interaction.client,row).catch(error=>console.error('Training result DM:',error.message));return interaction.editReply(training.resultPayload(row,true));}
  if(sub==='cancel') {
    const row=training.session(guildId,string('attempt'));if(!row || !['ACTIVE','REVIEW'].includes(row.status)) throw new Error('Open attempt not found.');
    run("UPDATE training_sessions SET status='CANCELLED',feedback=?,reviewedBy=?,reviewedAt=? WHERE id=? AND guildId=?",[safeText(string('reason'),500),member.id,Date.now(),row.id,guildId]);
    return interaction.editReply('Attempt cancelled. Its questions and answers remain in history.');
  }
  if(sub==='reset') {const user=interaction.options.getUser('user',true);run(`INSERT INTO training_attempt_resets VALUES(?,?,?,?,?) ON CONFLICT(guildId,userId)
    DO UPDATE SET resetAt=excluded.resetAt,resetBy=excluded.resetBy,reason=excluded.reason`,[guildId,user.id,Date.now(),member.id,safeText(string('reason'),500)]);return interaction.editReply('Attempt eligibility reset. Historical results were kept.');}
}};
