const {SlashCommandBuilder,EmbedBuilder}=require('discord.js');
const access=require('../../utils/communityAccess'),service=require('../../utils/communityChallenges');
const {all,run}=require('../../database');
const name=c=>c.addStringOption(o=>o.setName('name').setDescription('Challenge name').setRequired(true).setAutocomplete(true).setMaxLength(32));
const data=access.accessCommand(new SlashCommandBuilder().setName('challenge').setDescription('Community goals with reviewed contributions and shared progress.').setDMPermission(false));
data.addSubcommand(c=>name(c.setName('create').setDescription('Manager: create a shared community goal.'))
  .addStringOption(o=>o.setName('title').setDescription('Challenge title').setRequired(true).setMaxLength(120))
  .addIntegerOption(o=>o.setName('goal').setDescription('Target amount').setRequired(true).setMinValue(1).setMaxValue(1000000000))
  .addStringOption(o=>o.setName('description').setDescription('What qualifies and what evidence members should submit').setRequired(true).setMaxLength(1000))
  .addIntegerOption(o=>o.setName('hours').setDescription('Optional submission duration').setMinValue(1).setMaxValue(8760)));
for(const sub of ['show','end'])data.addSubcommand(c=>name(c.setName(sub).setDescription(sub==='show'?'Show a challenge and its approved progress.':'Manager: close further challenge submissions.')));
data.addSubcommand(c=>name(c.setName('contribute').setDescription('Submit evidence for staff approval; progress changes only after review.'))
  .addIntegerOption(o=>o.setName('amount').setDescription('Contribution amount').setRequired(true).setMinValue(1).setMaxValue(1000000))
  .addStringOption(o=>o.setName('note').setDescription('Contribution evidence or explanation').setRequired(true).setMaxLength(500)));
for(const sub of ['approve','deny'])data.addSubcommand(c=>c.setName(sub).setDescription(`Manager: ${sub} a contribution.`)
  .addIntegerOption(o=>o.setName('id').setDescription('Contribution ID').setRequired(true).setMinValue(1))
  .addStringOption(o=>o.setName('reason').setDescription('Review reason').setRequired(true).setMaxLength(500)));
for(const sub of ['list','pending'])data.addSubcommand(c=>c.setName(sub).setDescription(sub==='list'?'List community challenges.':'Manager: list contributions waiting for review.')
  .addIntegerOption(o=>o.setName('page').setDescription('Page').setMinValue(1)));
module.exports={data,ephemeral:interaction=>!['show','list'].includes(interaction.options.getSubcommand()),dmPermission:false,async execute(interaction){
  const sub=interaction.options.getSubcommand(),manage=!['show','list','contribute','configure'].includes(sub);
  const member=await access.requireAccess(interaction,'challenge',manage);
  if(sub==='configure')return interaction.editReply({content:await access.configureAccess(interaction,'challenge'),allowedMentions:{parse:[]}});
  const name=interaction.options.getString('name'),page=interaction.options.getInteger('page') || 1;
  if(sub==='list')return interaction.editReply({content:access.pageRows(all('SELECT * FROM community_challenges WHERE guildId=? ORDER BY createdAt DESC',[member.guild.id]),page)
    .map(row=>`**${row.title}** | \`${row.name}\` | ${row.progress}/${row.goal} | ${row.status}`).join('\n') || 'No challenges on this page.',allowedMentions:{parse:[]}});
  if(sub==='pending')return interaction.editReply({content:access.pageRows(all("SELECT * FROM challenge_contributions WHERE guildId=? AND status='PENDING' ORDER BY id",[member.guild.id]),page,3)
    .map(row=>`#${row.id} | <@${row.userId}> | ${row.amount}\n${row.note}`).join('\n\n') || 'No pending contributions.',allowedMentions:{parse:[]}});
  if(sub==='contribute'){const row=service.contribute(member,name,interaction.options.getInteger('amount'),interaction.options.getString('note'),interaction.id);return interaction.editReply(`Contribution #${row.id} is awaiting staff review.`);}
  let row;
  if(sub==='create'){const hours=interaction.options.getInteger('hours');row=service.create(member,{name,title:interaction.options.getString('title'),description:interaction.options.getString('description'),goal:interaction.options.getInteger('goal'),endsAt:hours?Date.now()+hours*3600000:null});}
  else if(['approve','deny'].includes(sub))row=service.review(member,interaction.options.getInteger('id'),sub==='approve',interaction.options.getString('reason'));
  else {row=service.challenge(member.guild.id,name);if(!row)throw new Error('Challenge not found.');}
  if(sub==='end'){run("UPDATE community_challenges SET status='CLOSED' WHERE id=? AND guildId=?",[row.id,member.guild.id]);return interaction.editReply('Challenge closed. Its approved progress and contribution history were retained.');}
  return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x1B9AAA).setTitle(row.title).setDescription(row.description)
    .addFields({name:'Progress',value:`${row.progress}/${row.goal} (${Math.min(100,Math.floor(row.progress/row.goal*100))}%)`},
      {name:'Status',value:row.status},{name:'Submission deadline',value:row.endsAt?`<t:${Math.floor(row.endsAt/1000)}:F>`:'No deadline'})],allowedMentions:{parse:[]}});
}};
