const { SlashCommandBuilder, ChannelType, PermissionFlagsBits:P } = require('discord.js');
const { all, get, run } = require('../../database');
const automation = require('../../utils/automation');
const raid = require('../../utils/raidProtection');
const safety = require('../../utils/safetyPolicies');

const data = new SlashCommandBuilder().setName('automation').setDescription('Anti-raid, safe tags, automatic replies and warning policies.').setDMPermission(false);
const moduleChoices = [...automation.MODULES].map(value => ({name:value,value}));
data.addSubcommand(command => command.setName('manager').setDescription('Administrator: add, remove or list management roles.')
  .addStringOption(o => o.setName('action').setDescription('Action').setRequired(true).addChoices(...['add','remove','list'].map(value=>({name:value,value}))))
  .addStringOption(o => o.setName('module').setDescription('Feature managed by the role').setRequired(true).addChoices(...moduleChoices))
  .addRoleOption(o => o.setName('role').setDescription('Management role')));
for (const kind of ['tag','response']) data.addSubcommandGroup(group => {
  group.setName(kind).setDescription(kind === 'tag' ? 'Saved staff-approved messages.' : 'Safe literal automatic replies.');
  for (const verb of ['create','edit']) group.addSubcommand(command => {
    command.setName(verb).setDescription(`${verb} a ${kind}; omitted restrictions on edit are kept.`)
      .addStringOption(o=>o.setName('name').setDescription('Unique name').setRequired(true))
      .addStringOption(o=>o.setName('text').setDescription('Message; fixed variables only, no code or mentions.').setRequired(true).setMaxLength(1800))
      .addRoleOption(o=>o.setName('required_role').setDescription('Role required to use this entry'))
      .addChannelOption(o=>o.setName('channel').setDescription('Restrict to this channel').addChannelTypes(ChannelType.GuildText,ChannelType.GuildAnnouncement))
      .addIntegerOption(o=>o.setName('cooldown').setDescription('Per-member cooldown in seconds').setMinValue(5).setMaxValue(86400));
    if (kind === 'response') command.addStringOption(o=>o.setName('trigger').setDescription('Literal text that triggers the reply').setRequired(true).setMaxLength(150))
      .addStringOption(o=>o.setName('match').setDescription('Matching rule').addChoices({name:'Exact message',value:'EXACT'},{name:'Contains text',value:'CONTAINS'}));
    // Discord requires required options before optional ones.
    command.options.sort((a,b)=>Number(Boolean(b.required))-Number(Boolean(a.required)));
    return command;
  });
  group.addSubcommand(command=>command.setName('delete').setDescription(`Delete a ${kind}.`).addStringOption(o=>o.setName('name').setDescription('Entry name').setRequired(true)));
  group.addSubcommand(command=>command.setName('list').setDescription(`List ${kind} entries and restrictions.`)
    .addIntegerOption(o=>o.setName('page').setDescription('Page').setMinValue(1)));
  group.addSubcommand(command=>command.setName('unrestrict').setDescription('Remove a saved use-role or channel restriction.')
    .addStringOption(o=>o.setName('name').setDescription('Entry name').setRequired(true))
    .addStringOption(o=>o.setName('restriction').setDescription('Restriction to remove').setRequired(true).addChoices({name:'Required role',value:'useRoleId'},{name:'Channel',value:'channelId'})));
  if(kind === 'tag') group.addSubcommand(command=>command.setName('use').setDescription('Post a saved tag in this channel.')
    .addStringOption(o=>o.setName('name').setDescription('Tag name').setRequired(true)));
  return group;
});
data.addSubcommandGroup(group=>group.setName('raid').setDescription('Join-burst protection, disabled until configured.')
  .addSubcommand(command=>command.setName('configure').setDescription('Configure and explicitly enable/disable anti-raid.')
    .addBooleanOption(o=>o.setName('enabled').setDescription('Enable protection').setRequired(true))
    .addChannelOption(o=>o.setName('channel').setDescription('Private incident/review channel').addChannelTypes(ChannelType.GuildText))
    .addStringOption(o=>o.setName('action').setDescription('Alert only by default').addChoices({name:'Alert only',value:'ALERT'},{name:'Timeout new accounts',value:'TIMEOUT'}))
    .addIntegerOption(o=>o.setName('joins').setDescription('Joins needed to open an incident').setMinValue(2).setMaxValue(100))
    .addIntegerOption(o=>o.setName('window').setDescription('Join window in seconds').setMinValue(10).setMaxValue(600))
    .addIntegerOption(o=>o.setName('account_days').setDescription('Only restrict accounts younger than this').setMinValue(1).setMaxValue(365))
    .addIntegerOption(o=>o.setName('timeout_minutes').setDescription('Timeout duration').setMinValue(1).setMaxValue(1440))
    .addIntegerOption(o=>o.setName('incident_minutes').setDescription('How long an incident lasts').setMinValue(1).setMaxValue(120)))
  .addSubcommand(command=>command.setName('status').setDescription('Settings and recent incident timeline.'))
  .addSubcommand(command=>command.setName('end').setDescription('End the current incident; optionally release only its unchanged timeouts.')
    .addBooleanOption(o=>o.setName('release').setDescription('Release unchanged anti-raid timeouts')))
  .addSubcommand(command=>command.setName('exemption').setDescription('Add, remove or list exempt roles.')
    .addStringOption(o=>o.setName('action').setDescription('Action').setRequired(true).addChoices(...['add','remove','list'].map(value=>({name:value,value}))))
    .addRoleOption(o=>o.setName('role').setDescription('Role exempt from anti-raid'))));
data.addSubcommandGroup(group=>group.setName('safety').setDescription('Warning escalation and decay; history is preserved.')
  .addSubcommand(command=>command.setName('preview').setDescription('Preview the next warning without issuing a punishment.')
    .addUserOption(option=>option.setName('user').setDescription('Member to preview').setRequired(true)))
  .addSubcommand(command=>command.setName('status').setDescription('Show the warning policy and filter precedence.'))
  .addSubcommand(command=>command.setName('warnings').setDescription('Set warning decay; zero disables decay.')
    .addIntegerOption(o=>o.setName('decay_days').setDescription('Expire active warnings after this many days').setRequired(true).setMinValue(0).setMaxValue(3650)))
  .addSubcommand(command=>command.setName('threshold').setDescription('Set a timeout threshold, or use zero seconds to remove it.')
    .addIntegerOption(o=>o.setName('warnings').setDescription('Active warning count').setRequired(true).setMinValue(1).setMaxValue(999))
    .addIntegerOption(o=>o.setName('seconds').setDescription('Timeout seconds; zero removes the threshold').setRequired(true).setMinValue(0).setMaxValue(2419200))));

data.addSubcommandGroup(group=>group.setName('prompts').setDescription('Review ratings and curate daily interaction prompts.')
  .addSubcommand(command=>command.setName('list').setDescription('Lowest-rated prompts, sample sizes and curation state.')
    .addIntegerOption(option=>option.setName('page').setDescription('Page').setMinValue(1)))
  .addSubcommand(command=>command.setName('set').setDescription('Enable/retire a prompt or change its selection weight.')
    .addStringOption(option=>option.setName('key').setDescription('Prompt key from the quality list').setRequired(true))
    .addBooleanOption(option=>option.setName('enabled').setDescription('Allow automatic selection').setRequired(true))
    .addIntegerOption(option=>option.setName('weight').setDescription('Selection weight 1-10').setMinValue(1).setMaxValue(10))
    .addStringOption(option=>option.setName('reason').setDescription('Private curation note').setMaxLength(300))));

function checkedRole(role,guild) {
  if (!role || role.id===guild.id || role.managed) throw new Error('Choose a normal server role, not @everyone or an integration role.');
  return role;
}
async function execute(interaction) {
  const group=interaction.options.getSubcommandGroup(false), action=interaction.options.getSubcommand();
  const guildId=interaction.guild.id, actorId=interaction.user.id;
  try {
    if (!group) {
      const module=interaction.options.getString('module',true);
      await automation.requireManager(interaction,module,true);
      const verb=interaction.options.getString('action',true), role=interaction.options.getRole('role');
      if(verb!=='list') {
        checkedRole(role,interaction.guild);
        run(verb==='add' ? 'INSERT OR IGNORE INTO automation_managers(guildId,module,roleId) VALUES(?,?,?)' :
          'DELETE FROM automation_managers WHERE guildId=? AND module=? AND roleId=?',[guildId,module,role.id]);
      }
      const roles=all('SELECT roleId FROM automation_managers WHERE guildId=? AND module=?',[guildId,module]);
      return interaction.editReply({content:`${module} managers: ${roles.slice(0,50).map(row=>`<@&${row.roleId}>`).join(', ') || 'Administrator only'}${roles.length>50?` (and ${roles.length-50} more)`:''}`,allowedMentions:{parse:[]}});
    }
    if (group==='tag' && action==='use') {
      const entry=get("SELECT * FROM automation_entries WHERE guildId=? AND name=? AND kind='TAG'",[guildId,automation.entryName(interaction.options.getString('name',true))]);
      if(!entry) throw new Error('Tag not found.');
      const member=await automation.freshMember(interaction.guild,actorId);
      const result=await automation.deliverEntry(entry,member,interaction.channel,payload=>interaction.editReply(payload));
      if(!result.delivered) throw new Error(result.reason==='restricted' ? 'This tag is restricted to its configured role/channel.' : result.reason);
      return;
    }
    await automation.requireManager(interaction,group);
    if(group==='prompts') {
      const quality=require('../../utils/promptQuality');
      if(action==='set') {
        quality.curatePrompt(guildId,interaction.options.getString('key',true),actorId,{enabled:interaction.options.getBoolean('enabled',true),
          weight:interaction.options.getInteger('weight') || 1,reason:interaction.options.getString('reason')});
        return interaction.editReply('Prompt curation saved. Retired prompts will not be selected automatically; history and ratings are kept.');
      }
      const page=interaction.options.getInteger('page') || 1;
      const rows=[...quality.promptQuality(guildId).values()].sort((a,b)=>(a.average ?? 5)-(b.average ?? 5)).slice((page-1)*6,page*6);
      return interaction.editReply({content:rows.map(row=>{
        const post=get('SELECT prompt FROM daily_interaction_posts WHERE guildId=? AND promptKey=? ORDER BY sentAt DESC LIMIT 1',[guildId,row.promptKey]);
        return `**${String(post?.prompt || 'Curated prompt').slice(0,180)}**\n${row.average?.toFixed(2) || 'N/A'}/5 (${row.votes || 0} ratings), ${row.enabled===0?'Retired':'Enabled'}, weight ${row.weight || 1}\n\`${row.promptKey}\``;
      }).join('\n\n') || 'No prompt ratings yet.',allowedMentions:{parse:[]}});
    }
    if(['tag','response'].includes(group)) {
      const kind=group.toUpperCase(), page=interaction.options.getInteger('page') || 1;
      if(action==='list') {
        const entries=all('SELECT * FROM automation_entries WHERE guildId=? AND kind=? ORDER BY name LIMIT 10 OFFSET ?',[guildId,kind,(page-1)*10]);
        return interaction.editReply({content:entries.map(row=>`**${row.name}** | ${row.uses} uses | ${row.cooldownSeconds}s\nRole: ${row.useRoleId?`<@&${row.useRoleId}>`:'Everyone'} | Channel: ${row.channelId?`<#${row.channelId}>`:'Any accessible channel'}`).join('\n\n') || 'No entries on this page.',allowedMentions:{parse:[]}});
      }
      const name=automation.entryName(interaction.options.getString('name',true));
      const existing=get('SELECT * FROM automation_entries WHERE guildId=? AND name=?',[guildId,name]);
      if(action!=='create' && (!existing || existing.kind!==kind)) throw new Error(`${group} not found.`);
      if(action==='create' && existing) throw new Error('This name already exists. Use edit.');
      if(action==='delete') run('DELETE FROM automation_entries WHERE guildId=? AND name=?',[guildId,name]);
      else if(action==='unrestrict') {
        const field=interaction.options.getString('restriction',true);
        if(!['useRoleId','channelId'].includes(field)) throw new Error('Invalid restriction.');
        run(`UPDATE automation_entries SET ${field}=NULL,updatedAt=? WHERE guildId=? AND name=?`,[Date.now(),guildId,name]);
      } else {
        const role=interaction.options.getRole('required_role');
        if(role) checkedRole(role,interaction.guild);
        automation.saveEntry(guildId,actorId,{...existing,name,kind,template:interaction.options.getString('text',true),
          triggerText:kind==='RESPONSE'?interaction.options.getString('trigger',true):null,
          matchMode:interaction.options.getString('match') || existing?.matchMode || 'EXACT',
          useRoleId:role?.id || existing?.useRoleId,channelId:interaction.options.getChannel('channel')?.id || existing?.channelId,
          cooldownSeconds:interaction.options.getInteger('cooldown') ?? existing?.cooldownSeconds ?? 30},existing);
      }
      return interaction.editReply({content:`${group} ${name}: ${action} saved.`,allowedMentions:{parse:[]}});
    }
    if(group==='raid') {
      if(action==='configure') {
        const values={enabled:interaction.options.getBoolean('enabled',true)};
        for(const [option,key] of [['joins','threshold'],['window','windowSeconds'],['account_days','accountAgeDays'],['timeout_minutes','timeoutMinutes'],['incident_minutes','incidentMinutes']]) {
          const value=interaction.options.getInteger(option); if(value!==null) values[key]=value;
        }
        const channel=interaction.options.getChannel('channel');
        if(channel) values.alertChannelId=channel.id;
        const selected=interaction.options.getString('action'); if(selected) values.action=selected;
        const settings={...raid.raidSettings(guildId),...values};
        if(values.enabled) {
          const destination=channel || await interaction.guild.channels.fetch(settings.alertChannelId);
          const bot=await interaction.guild.members.fetchMe({force:true});
          if(!destination?.permissionsFor(bot)?.has([P.ViewChannel,P.SendMessages,P.EmbedLinks])) throw new Error('I need View Channel, Send Messages and Embed Links in the incident channel.');
          if(settings.action==='TIMEOUT' && !bot.permissions.has(P.ModerateMembers)) throw new Error('I need Moderate Members for timeout mode.');
        }
        raid.saveRaidSettings(guildId,actorId,values);
      } else if(action==='end') {
        const result=await raid.endIncident(interaction.guild,actorId,Boolean(interaction.options.getBoolean('release')));
        return interaction.editReply(`Incident ended. Timeouts released: ${result.released}; release failures: ${result.failed}.`);
      } else if(action==='exemption') {
        const verb=interaction.options.getString('action',true),role=interaction.options.getRole('role');
        if(verb!=='list') {
          checkedRole(role,interaction.guild);
          run(verb==='add'?'INSERT OR IGNORE INTO raid_exempt_roles(guildId,roleId) VALUES(?,?)':'DELETE FROM raid_exempt_roles WHERE guildId=? AND roleId=?',[guildId,role.id]);
        }
        return interaction.editReply({content:all('SELECT roleId FROM raid_exempt_roles WHERE guildId=? LIMIT 50',[guildId]).map(row=>`<@&${row.roleId}>`).join(', ') || 'No additional exempt roles. Staff are always exempt.',allowedMentions:{parse:[]}});
      }
      const settings=raid.raidSettings(guildId);
      const incidents=all(`SELECT i.*,(SELECT COUNT(*) FROM raid_actions a WHERE a.incidentId=i.id) AS actions
        FROM raid_incidents i WHERE guildId=? ORDER BY id DESC LIMIT 5`,[guildId]);
      return interaction.editReply({content:`Anti-raid: ${settings.enabled?'Enabled':'Disabled'} | ${settings.action}\nTrigger: ${settings.threshold} joins / ${settings.windowSeconds}s; new-account cutoff ${settings.accountAgeDays} days.\n`+
        incidents.map(row=>`#${row.id}: ${row.status}, ${row.actions} actions; <t:${Math.floor(row.startedAt/1000)}:F>`).join('\n'),allowedMentions:{parse:[]}});
    }
    if(group==='safety') {
      if(action==='preview') {
        const result=safety.warningPreview(guildId,interaction.options.getUser('user',true).id);
        return interaction.editReply(`Active warnings: ${result.active}. Next warning: ${result.nextCount}.\nEscalation: ${result.timeoutMs?`${result.timeoutMs/1000}s timeout`:'None'}. ${result.expiresOnNextCheck} expired warning(s) will be deactivated on the next maintenance check; their cases remain.`);
      }
      if(action==='warnings') safety.saveSafetyPolicy(guildId,{warningDecayDays:interaction.options.getInteger('decay_days',true)},actorId);
      if(action==='threshold') {
        const thresholds=JSON.parse(safety.safetyPolicy(guildId).warningThresholds);
        const count=interaction.options.getInteger('warnings',true),seconds=interaction.options.getInteger('seconds',true);
        if(seconds) thresholds[count]=seconds; else delete thresholds[count];
        safety.saveSafetyPolicy(guildId,{thresholds},actorId);
      }
      const policy=safety.safetyPolicy(guildId);
      return interaction.editReply({content:`Warning decay: ${policy.warningDecayDays?`${policy.warningDecayDays} days`:'Disabled'} (case history retained).\n`+
        `Timeout thresholds: ${Object.entries(JSON.parse(policy.warningThresholds)).map(([count,seconds])=>`${count} warnings: ${seconds}s`).join('; ') || 'None'}.\n`+
        'Message safety: trap protection, daily-thread validation, spam, phishing, censor and link rules are evaluated before engagement rewards. Explicit phishing blocks override allowlists.',allowedMentions:{parse:[]}});
    }
  } catch(error) { return interaction.editReply({content:error.message,allowedMentions:{parse:[]}}); }
}
module.exports={data,execute};
