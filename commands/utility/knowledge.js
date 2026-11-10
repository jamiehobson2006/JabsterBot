const {SlashCommandBuilder,EmbedBuilder}=require('discord.js');
const access=require('../../utils/communityAccess'),kb=require('../../utils/knowledgeBase');
const {all,run}=require('../../database');
const named=c=>c.addStringOption(o=>o.setName('name').setDescription('Article name').setRequired(true).setAutocomplete(true).setMaxLength(32));
const data=access.accessCommand(new SlashCommandBuilder().setName('knowledge').setDescription('Search and maintain the server knowledge base.').setDMPermission(false));
for(const verb of ['create','edit'])data.addSubcommand(c=>{
  named(c.setName(verb).setDescription(`${verb} a knowledge article.`));
  c.addStringOption(o=>o.setName('title').setDescription('Article title').setRequired(verb==='create').setMaxLength(120))
    .addStringOption(o=>o.setName('content').setDescription('Article body').setRequired(verb==='create').setMaxLength(3500))
    .addStringOption(o=>o.setName('category').setDescription('Article category').setMaxLength(32))
    .addRoleOption(o=>o.setName('reader_role').setDescription('Optional article-specific reader role'))
    .addBooleanOption(o=>o.setName('clear_reader_role').setDescription('Remove the article reader restriction'));
  return c;
});
for(const verb of ['show','archive','restore','history'])data.addSubcommand(c=>named(c.setName(verb).setDescription(`${verb} a knowledge article.`)));
for(const verb of ['search','list'])data.addSubcommand(c=>c.setName(verb).setDescription('Find visible server knowledge articles.')
  .addStringOption(o=>o.setName('query').setDescription('Search titles and full article text').setMaxLength(100))
  .addStringOption(o=>o.setName('category').setDescription('Category filter').setMaxLength(32))
  .addIntegerOption(o=>o.setName('page').setDescription('Results page').setMinValue(1)));
module.exports={data,ephemeral:true,dmPermission:false,async execute(interaction){
  const sub=interaction.options.getSubcommand(),manage=!['show','search','list'].includes(sub);
  const member=await access.requireAccess(interaction,'knowledge',manage && sub!=='configure');
  if(sub==='configure')return interaction.editReply({content:await access.configureAccess(interaction,'knowledge'),allowedMentions:{parse:[]}});
  const name=interaction.options.getString('name');
  if(['create','edit'].includes(sub)){
    const previous=kb.article(member.guild.id,name);
    if(sub==='create' && previous)throw new Error('This article already exists; use edit.');
    if(sub==='edit' && !previous)throw new Error('Article not found.');
    const values={name};for(const key of ['title','content','category'])if(interaction.options.getString(key)!==null)values[key]=interaction.options.getString(key);
    const role=interaction.options.getRole('reader_role');access.validRole(interaction.guild,role);
    if(role)values.readerRoleId=role.id;
    if(interaction.options.getBoolean('clear_reader_role'))values.readerRoleId=null;
    const row=kb.save(member.guild.id,member.id,values,name);return interaction.editReply(`Article ${row.name} saved as version ${row.version}.`);
  }
  if(['search','list'].includes(sub)){
    const rows=kb.search(member,interaction.options.getString('query') || '',interaction.options.getString('category'));
    return interaction.editReply({content:access.pageRows(rows,interaction.options.getInteger('page') || 1).map(row=>`**${row.title}** | \`${row.name}\` | ${row.category}${row.archived?' | Archived':''}`).join('\n') || 'No matching articles on this page.',allowedMentions:{parse:[]}});
  }
  const row=kb.article(member.guild.id,name);if(!row || !kb.visible(member,row))throw new Error('Article not found or not available to you.');
  if(sub==='history')return interaction.editReply({content:all('SELECT version,updatedBy,updatedAt FROM knowledge_revisions WHERE guildId=? AND name=? ORDER BY version DESC LIMIT 15',[member.guild.id,row.name]).map(v=>`Version ${v.version} | <@${v.updatedBy}> | <t:${Math.floor(v.updatedAt/1000)}:F>`).join('\n') || 'No earlier versions.',allowedMentions:{parse:[]}});
  if(['archive','restore'].includes(sub)){run('UPDATE knowledge_articles SET archived=? WHERE guildId=? AND name=?',[sub==='archive'?1:0,member.guild.id,row.name]);return interaction.editReply(`Article ${sub==='archive'?'archived':'restored'}.`);}
  return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x5865F2).setTitle(row.title).setDescription(row.content)
    .setFooter({text:`${row.category} | Version ${row.version}`}).setTimestamp(row.updatedAt)],allowedMentions:{parse:[]}});
}};
