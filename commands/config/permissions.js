const { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const diagnostics = require('../../utils/permissionDiagnostics');
const memberOption = s => s.addUserOption(o=>o.setName('user').setDescription('Member to check').setRequired(true));
const channelOption = s => s.addChannelOption(o=>o.setName('channel').setDescription('Channel to check (defaults to here)'));

module.exports = {
  ephemeral:true,dmPermission:false,
  data:new SlashCommandBuilder().setName('permissions').setDescription('Explain access without performing an action')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s=>channelOption(memberOption(s.setName('command').setDescription('Check command controls and default permissions'))
      .addStringOption(o=>o.setName('command').setDescription('Command name without /').setRequired(true))))
    .addSubcommand(s=>channelOption(memberOption(s.setName('ticket').setDescription('Check stored ticket staff access'))))
    .addSubcommand(s=>channelOption(memberOption(s.setName('filters').setDescription('Explain configured filter whitelists'))))
    .addSubcommand(s=>memberOption(s.setName('role').setDescription('Check whether a role is safe for automated assignment'))
      .addRoleOption(o=>o.setName('role').setDescription('Role to check').setRequired(true))),
  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return interaction.editReply('Administrator permission is required.');
    const user = interaction.options.getUser('user',true);
    const member = await interaction.guild.members.fetch(user.id).catch(()=>null);
    if (!member) return interaction.editReply('That user is not a member of this server.');
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    if (channel.guildId !== interaction.guild.id || !channel.permissionsFor) return interaction.editReply('Choose a channel in this server.');
    const sub = interaction.options.getSubcommand();
    const name = String(interaction.options.getString('command') || '').replace(/^\//,'').trim().toLowerCase();
    let checks;
    const context = {guild:interaction.guild,member,channel};
    if (sub === 'command') checks = diagnostics.commandReport({...context,name,command:interaction.client.commands.get(name)});
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
