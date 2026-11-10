const { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const diagnostics = require('../../utils/permissionDiagnostics');
const memberOption = s => s.addUserOption(o=>o.setName('user').setDescription('Member to check').setRequired(true));
const channelOption = s => s.addChannelOption(o=>o.setName('channel').setDescription('Channel to check (defaults to here)'));

module.exports = {
  ephemeral:true,dmPermission:false,
  data:new SlashCommandBuilder().setName('permissions').setDescription('Explain access without performing an action')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s=>channelOption(memberOption(s.setName('matrix').setDescription('Review local access for every command and configured management role.'))
      .addStringOption(o=>o.setName('query').setDescription('Filter command paths and descriptions').setMaxLength(100))
      .addIntegerOption(o=>o.setName('page').setDescription('Results page').setMinValue(1))))
    .addSubcommand(s=>channelOption(memberOption(s.setName('destination').setDescription('Check destination type and bot feature permissions'))))
    .addSubcommand(s=>channelOption(memberOption(s.setName('command').setDescription('Check command controls and default permissions'))
      .addStringOption(o=>o.setName('command').setDescription('Command/action path, e.g. leveling admin set-level').setRequired(true).setMaxLength(100))
      .addUserOption(o=>o.setName('target').setDescription('Optional moderation target for hierarchy checks'))))
    .addSubcommand(s=>channelOption(memberOption(s.setName('ticket').setDescription('Check stored ticket staff access'))))
    .addSubcommand(s=>channelOption(memberOption(s.setName('filters').setDescription('Explain configured filter whitelists'))))
    .addSubcommand(s=>memberOption(s.setName('role').setDescription('Check whether a role is safe for automated assignment'))
      .addRoleOption(o=>o.setName('role').setDescription('Role to check').setRequired(true))),
  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return interaction.editReply('Administrator permission is required.');
    const user = interaction.options.getUser('user',true);
    const member = await interaction.guild.members.fetch({user:user.id,force:true}).catch(()=>null);
    if (!member) return interaction.editReply('That user is not a member of this server.');
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    if (channel.guildId !== interaction.guild.id || !channel.permissionsFor) return interaction.editReply('Choose a channel in this server.');
    const sub = interaction.options.getSubcommand();
    if(sub==='matrix') {
      const rows=require('../../utils/commandAccess').matrix({commands:interaction.client.commands,guild:interaction.guild,member,channel},
        {query:interaction.options.getString('query') || ''});
      const page=interaction.options.getInteger('page') || 1,shown=rows.slice((page-1)*8,page*8);
      return interaction.editReply({embeds:[new EmbedBuilder().setColor(0x5865F2).setTitle('Server Permission Matrix')
        .setDescription(shown.map(row=>`**/${row.path}** | ${row.eligible?row.conditional?'Conditional':'Eligible':'Blocked'}\n${row.reason}`).join('\n\n') || 'No matching actions on this page.')
        .setFooter({text:`Page ${page}/${Math.max(1,Math.ceil(rows.length/8))} | ${rows.filter(row=>row.eligible).length}/${rows.length} locally eligible | Discord overrides and target checks still apply`})],allowedMentions:{parse:[]}});
    }
    const name = String(interaction.options.getString('command') || '').replace(/^\//,'').trim().toLowerCase();
    let checks;
    const context = {guild:interaction.guild,member,channel};
    const targetUser=interaction.options.getUser('target');
    if(targetUser) {
      context.target=await interaction.guild.members.fetch({user:targetUser.id,force:true}).catch(error=>{
        if(Number(error.code)===10007) return null;
        throw error;
      });
    }
    if (sub === 'command') {
      const resolved = require('../../utils/commandRegistry').commandNode(interaction.client.commands,name);
      checks = diagnostics.commandReport({...context,name:resolved?.name || name,command:resolved?.command,route:resolved?.route});
    }
    else if(sub==='destination') checks=diagnostics.destinationReport(context);
    else if (sub === 'ticket') checks = diagnostics.ticketReport(context);
    else if (sub === 'filters') checks = diagnostics.filterReport(context);
    else {
      const role = interaction.options.getRole('role',true);
      const issue = require('../../utils/roleSafety').automaticRoleSafetyIssue(interaction.guild,role);
      checks = [{passed:!issue,label:issue?.message || 'Role passes automated-assignment safety checks'},
        {passed:null,label:member.roles.cache.has(role.id) ? 'Member already has this role.' : 'Member does not have this role. Feature eligibility and configuration still apply.'}];
    }
    return interaction.editReply({embeds:[new EmbedBuilder().setTitle('Permission Diagnostic').setColor(0x5865F2)
      .setDescription(`Member: <@${user.id}>\nChannel: <#${channel.id}>\n\n${checks.map(c=>`**${c.passed === null ? 'Note' : c.passed ? 'Pass' : 'Blocked'}:** ${c.label}`).join('\n\n')}`)],allowedMentions:{parse:[]} });
  }
};
