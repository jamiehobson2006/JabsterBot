const {SlashCommandBuilder}=require('discord.js');
const access=require('../../utils/communityAccess'),roles=require('../../utils/temporaryRoles');
const {all,run}=require('../../database');
const data=access.accessCommand(new SlashCommandBuilder().setName('temprole').setDescription('Approved temporary roles with persistent schedules and safe expiry.').setDMPermission(false));
data.addSubcommand(c=>c.setName('allow').setDescription('Administrator: approve a safe role for temporary grants.')
  .addRoleOption(o=>o.setName('role').setDescription('Safe role below the bot').setRequired(true))
  .addIntegerOption(o=>o.setName('max_hours').setDescription('Maximum duration').setMinValue(1).setMaxValue(720).setRequired(true))
  .addBooleanOption(o=>o.setName('self_claim').setDescription('Allow eligible members to claim this role')));
data.addSubcommand(c=>c.setName('disallow').setDescription('Administrator: stop future grants; existing expiries remain.')
  .addRoleOption(o=>o.setName('role').setDescription('Role').setRequired(true)));
for(const sub of ['grant','claim'])data.addSubcommand(c=>{
  c.setName(sub).setDescription(sub==='grant'?'Manager: grant or schedule an approved role.':'Claim an approved self-claim role.');
  if(sub==='grant')c.addUserOption(o=>o.setName('user').setDescription('Recipient').setRequired(true));
  c.addRoleOption(o=>o.setName('role').setDescription('Approved temporary role').setRequired(true))
    .addStringOption(o=>o.setName('duration').setDescription('For example 30m, 6h or 7d').setRequired(true).setMaxLength(10))
    .addStringOption(o=>o.setName('starts_in').setDescription('Optional delay before granting, e.g. 2h').setMaxLength(10))
    .addStringOption(o=>o.setName('reason').setDescription('Grant reason').setMaxLength(300));return c;
});
data.addSubcommand(c=>c.setName('list').setDescription('Your schedules; managers can inspect other members.')
  .addUserOption(o=>o.setName('user').setDescription('Recipient'))
  .addIntegerOption(o=>o.setName('page').setDescription('Page').setMinValue(1)));
data.addSubcommand(c=>c.setName('approved').setDescription('List roles approved for temporary grants.')
  .addIntegerOption(o=>o.setName('page').setDescription('Approved roles page').setMinValue(1)));
data.addSubcommand(c=>c.setName('cancel').setDescription('Manager: cancel a future grant or safely expire an owned temporary role.')
  .addStringOption(o=>o.setName('id').setDescription('Schedule ID').setRequired(true).setMaxLength(36)));
data.addSubcommand(c=>c.setName('resolve').setDescription('Administrator: release an ownership hold without changing member roles.')
  .addStringOption(o=>o.setName('id').setDescription('Schedule awaiting ownership review').setRequired(true).setMaxLength(36))
  .addStringOption(o=>o.setName('reason').setDescription('Record your manual review decision; this never removes a role').setRequired(true).setMaxLength(500)));
module.exports={data,ephemeral:true,dmPermission:false,async execute(interaction){
  const sub=interaction.options.getSubcommand(),manage=['grant','cancel','allow','disallow','resolve'].includes(sub);
  const member=await access.requireAccess(interaction,'temprole',manage);
  if(sub==='configure')return interaction.editReply({content:await access.configureAccess(interaction,'temprole'),allowedMentions:{parse:[]}});
  if(sub==='resolve'){
    roles.resolveReview(member,interaction.options.getString('id',true),interaction.options.getString('reason',true));
    return interaction.editReply('Ownership review recorded and the schedule cancelled. The member\'s roles were not changed.');
  }
  if(['allow','disallow'].includes(sub)){
    if(!access.isAdmin(member))throw new Error('Only administrators may approve or disallow automated roles.');
    const selected=interaction.options.getRole('role',true);
    if(sub==='allow'){
      await interaction.guild.members.fetchMe({force:true});const role=await interaction.guild.roles.fetch(selected.id);
      const issue=require('../../utils/roleSafety').automaticRoleSafetyError(interaction.guild,role);if(issue)throw new Error(issue);
      run(`INSERT INTO temporary_role_allowlist VALUES(?,?,?,?) ON CONFLICT(guildId,roleId) DO UPDATE SET maxHours=excluded.maxHours,selfClaim=excluded.selfClaim`,
        [interaction.guild.id,role.id,interaction.options.getInteger('max_hours'),Number(interaction.options.getBoolean('self_claim') || false)]);
    }else run('DELETE FROM temporary_role_allowlist WHERE guildId=? AND roleId=?',[interaction.guild.id,selected.id]);
    return interaction.editReply('Approved-role settings updated. Existing expiry jobs were retained.');
  }
  if(['grant','claim'].includes(sub)){
    const row=await roles.schedule(interaction,{userId:sub==='claim'?member.id:interaction.options.getUser('user',true).id,
      roleId:interaction.options.getRole('role',true).id,time:interaction.options.getString('duration'),delay:interaction.options.getString('starts_in'),
      selfClaim:sub==='claim',reason:interaction.options.getString('reason')});
    return interaction.editReply({content:`Schedule \`${row.id}\` | ${row.status}\nStarts <t:${Math.floor(row.startsAt/1000)}:F> | Expires <t:${Math.floor(row.expiresAt/1000)}:F>`,allowedMentions:{parse:[]}});
  }
  if(sub==='approved')return interaction.editReply({content:access.pageRows(all('SELECT * FROM temporary_role_allowlist WHERE guildId=? ORDER BY roleId',[member.guild.id]),interaction.options.getInteger('page') || 1,15)
    .map(row=>`<@&${row.roleId}> | Up to ${row.maxHours} hours | ${row.selfClaim?'Self-claim enabled':'Manager grants only'}`).join('\n') || 'No approved roles on this page.',allowedMentions:{parse:[]}});
  if(sub==='cancel'){
    const row=roles.job(member.guild.id,interaction.options.getString('id'));if(!row)throw new Error('Schedule not found in this server.');
    if(row.status==='REVIEW')throw new Error('This role needs ownership review. An administrator should inspect the member\'s roles, then use /temprole resolve to release the hold without changing roles.');
    const result=await roles.processJob(interaction.client,row.id,{forceExpire:true});return interaction.editReply(`Schedule status: ${result.status}.`);
  }
  const selected=interaction.options.getUser('user');if(selected && selected.id!==member.id && !access.canManage(member,'temprole'))throw new Error('Only managers may inspect other members.');
  const userId=selected?.id || (access.canManage(member,'temprole')?null:member.id);
  const rows=all('SELECT * FROM temporary_role_jobs WHERE guildId=? AND (? IS NULL OR userId=?) ORDER BY createdAt DESC',[member.guild.id,userId,userId]);
  return interaction.editReply({content:access.pageRows(rows,interaction.options.getInteger('page') || 1,2).map(row=>`\`${row.id}\` | <@${row.userId}> | <@&${row.roleId}> | ${row.status}\nExpires <t:${Math.floor(row.expiresAt/1000)}:F>${row.lastError?'\n'+row.lastError:''}`).join('\n\n') || 'No schedules on this page.',allowedMentions:{parse:[]}});
}};
