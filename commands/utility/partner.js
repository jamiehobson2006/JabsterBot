const {SlashCommandBuilder,EmbedBuilder}=require('discord.js');
const access=require('../../utils/communityAccess'),directory=require('../../utils/partnerDirectory');
const data=access.accessCommand(new SlashCommandBuilder().setName('partner').setDescription('Submit and browse staff-approved server partners.').setDMPermission(false));
const name=c=>c.addStringOption(o=>o.setName('name').setDescription('Listing name').setRequired(true).setMaxLength(32).setAutocomplete(true));
data.addSubcommand(c=>name(c.setName('submit').setDescription('Submit a partner listing for staff review.'))
  .addStringOption(o=>o.setName('title').setDescription('Partner title').setRequired(true).setMaxLength(120))
  .addStringOption(o=>o.setName('url').setDescription('Public HTTPS website or invite').setRequired(true).setMaxLength(500))
  .addStringOption(o=>o.setName('description').setDescription('Partner description').setRequired(true).setMaxLength(1000)));
for(const sub of ['approve','deny','archive'])data.addSubcommand(c=>name(c.setName(sub).setDescription(`Manager: ${sub} a partner listing.`))
  .addStringOption(o=>o.setName('reason').setDescription('Review reason').setRequired(true).setMaxLength(500)));
data.addSubcommand(c=>name(c.setName('show').setDescription('Show one approved partner.')));
data.addSubcommand(c=>name(c.setName('ticket').setDescription('Manager: privately view the linked partnership ticket and transcript.')));
for(const sub of ['list','pending'])data.addSubcommand(c=>c.setName(sub).setDescription(sub==='pending'?'Manager: review pending partner submissions.':'Browse approved partners.')
  .addStringOption(o=>o.setName('query').setDescription('Search partner titles and descriptions').setMaxLength(100))
  .addIntegerOption(o=>o.setName('page').setDescription('Page').setMinValue(1)));
module.exports={data,ephemeral:interaction=>!['show','list'].includes(interaction.options.getSubcommand()),dmPermission:false,async execute(interaction){
  const sub=interaction.options.getSubcommand(),manage=['approve','deny','archive','pending','ticket'].includes(sub);
  const member=await access.requireAccess(interaction,'partner',manage);
  if(sub==='configure')return interaction.editReply({content:await access.configureAccess(interaction,'partner'),allowedMentions:{parse:[]}});
  if(['list','pending'].includes(sub)){
    const rows=directory.browse(member,interaction.options.getString('query') || '',sub==='pending');
    return interaction.editReply({content:access.pageRows(rows,interaction.options.getInteger('page') || 1,2).map(row=>`**${row.title}** | \`${row.name}\`\n${row.url}\n${row.description.slice(0,160)}`).join('\n\n') || 'No matching partners on this page.',allowedMentions:{parse:[]}});
  }
  const name=interaction.options.getString('name');let row;
  if(sub==='ticket')return interaction.editReply({content:directory.ticketLinks(member,name),allowedMentions:{parse:[]}});
  if(sub==='submit'){row=directory.submit(member,{name,title:interaction.options.getString('title'),url:interaction.options.getString('url'),description:interaction.options.getString('description'),channelId:interaction.channelId});return interaction.editReply(`Partner listing ${row.name} submitted for staff review.`);}
  if(manage)row=directory.decide(member,name,{approve:'APPROVED',deny:'REJECTED',archive:'ARCHIVED'}[sub],interaction.options.getString('reason'));
  else row=directory.entry(member.guild.id,name);
  if(!row || row.status!=='APPROVED' && !manage)throw new Error('Approved partner not found.');
  return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x1B9AAA).setTitle(row.title).setURL(row.url).setDescription(row.description)
    .addFields({name:'Status',value:row.status},...(manage?[{name:'Review reason',value:row.reason}]:[]))],allowedMentions:{parse:[]}});
}};
