const {SlashCommandBuilder,PermissionFlagsBits:P}=require('discord.js');
const {all,get,run}=require('../../database');
const data=new SlashCommandBuilder().setName('socialsettings').setDescription('Configure creator notification digests.').setDefaultMemberPermissions(P.ManageGuild);
for(const sub of ['digest','direct'])data.addSubcommand(c=>{
  c.setName(sub).setDescription(sub==='digest'?'Combine new creator activity into periodic summaries.':'Send individual alerts again; pending digest items are retained.')
    .addStringOption(o=>o.setName('feed').setDescription('Configured feed').setRequired(true).setAutocomplete(true));
  if(sub==='digest')c.addIntegerOption(o=>o.setName('minutes').setDescription('Digest interval in minutes').setRequired(true).setMinValue(15).setMaxValue(1440));return c;
});
data.addSubcommand(c=>c.setName('list').setDescription('List feed identifiers and delivery modes.'));
data.options.find(option=>option.name==='list').addIntegerOption(o=>o.setName('page').setDescription('Feed page').setMinValue(1));
module.exports={data,ephemeral:true,async execute(interaction){
  if(!interaction.memberPermissions?.has(P.ManageGuild))throw new Error('Manage Server permission is required.');
  const rows=all('SELECT * FROM social_channels WHERE guildId=?',[interaction.guild.id]),sub=interaction.options.getSubcommand();
  if(sub==='list')return interaction.editReply({content:require('../../utils/communityAccess').pageRows(rows,interaction.options.getInteger('page') || 1,6).map(row=>`**${String(row.creatorName).slice(0,100)}** | \`${row.platform}:${row.creatorId}:${row.contentType}\` | ${row.digestMinutes?`Digest every ${row.digestMinutes}m`:'Individual alerts'}`).join('\n') || 'No feeds on this page.',allowedMentions:{parse:[]}});
  const id=interaction.options.getString('feed'),row=rows.find(row=>`${row.platform}:${row.creatorId}:${row.contentType}`===id);
  if(!row)throw new Error('Feed not found in this server.');
  run('UPDATE social_channels SET digestMinutes=? WHERE guildId=? AND platform=? AND creatorId=? AND contentType=?',
    [sub==='digest'?interaction.options.getInteger('minutes'):0,row.guildId,row.platform,row.creatorId,row.contentType]);
  return interaction.editReply('Social delivery preference saved. Queued digest items survive restarts.');
}};
