const { ChannelType, EmbedBuilder, PermissionFlagsBits: P, SlashCommandBuilder } = require('discord.js');
const { all, get, run } = require('../../database');
const { holdTrapBan, settingsFor } = require('../../utils/trapChannel');

function parseInvite(input) {
  const match = String(input).trim().match(/^https:\/\/(?:discord\.gg\/|(?:www\.)?discord\.com\/invite\/)([a-zA-Z0-9-]+)\/?$/);
  if (!match) throw new Error('Use a Discord server invite such as https://discord.gg/yourcode.');
  return `https://discord.gg/${match[1]}`;
}

async function configure(interaction) {
  if (!interaction.options.getBoolean('confirm', true)) {
    return interaction.editReply({ content: 'Nothing changed. Set confirm to true only for a dedicated do-not-post trap channel.' });
  }
  const channel = interaction.options.getChannel('channel', true);
  const durationHours = interaction.options.getInteger('duration_hours') ?? 6;
  const inviteUrl = parseInvite(interaction.options.getString('invite', true));
  if (channel.guildId !== interaction.guild.id || channel.type !== ChannelType.GuildText) {
    throw new Error('Choose a dedicated text channel in this server, not a general chat, ticket, or thread.');
  }
  const bot = await interaction.guild.members.fetchMe({ force: true });
  if (!bot.permissions.has(P.BanMembers) || !channel.permissionsFor(bot)?.has([P.ViewChannel,P.SendMessages,P.EmbedLinks,P.ManageMessages])) {
    throw new Error('I need Ban Members, and View Channel, Send Messages, Embed Links and Manage Messages in the trap channel.');
  }
  const invite = await interaction.client.fetchInvite(inviteUrl);
  if (invite.guild?.id !== interaction.guild.id) throw new Error('The recovery invite must lead back to this server.');
  if (invite.expiresTimestamp && invite.expiresTimestamp <= Date.now() + (durationHours+24)*3_600_000) {
    throw new Error('Use a permanent invite, or one valid for at least 24 hours beyond the ban duration.');
  }
  // Publish a clear warning before enabling a destructive, opt-in feature.
  const previous = settingsFor(interaction.guild.id);
  const warning = await channel.send({ allowedMentions: { parse: [] }, embeds: [new EmbedBuilder()
    .setColor(0xED4245).setTitle('Do not post in this channel')
    .setDescription(`This is an account-safety trap, not a chat channel. Posting anything here triggers a ${durationHours}-hour temporary ban.\n\n` +
      'Jabster Studios will try to DM you a safety notice and recovery invite before banning. Posting here does not prove that your account is compromised. ' +
      'Bots, server staff and configured exempt roles are excluded. Contact staff elsewhere if you need help.')
    .setFooter({ text: 'Jabster Studios | Account safety' })] });
  run(`INSERT INTO trap_channel_settings(guildId,channelId,inviteUrl,durationHours,enabled,updatedBy,updatedAt,warningMessageId)
    VALUES(?,?,?,?,1,?,?,?) ON CONFLICT(guildId) DO UPDATE SET channelId=excluded.channelId,
    inviteUrl=excluded.inviteUrl,durationHours=excluded.durationHours,enabled=1,updatedBy=excluded.updatedBy,
    updatedAt=excluded.updatedAt,warningMessageId=excluded.warningMessageId`,
  [interaction.guild.id,channel.id,inviteUrl,durationHours,interaction.user.id,Date.now(),warning.id]);
  if (previous) await retireWarning(interaction,previous);
  return interaction.editReply({ content: `Trap protection enabled in ${channel} for **${durationHours} hours**. ` +
    'A warning was posted. This applies only to new messages in that exact channel; channel permissions were not changed. ' +
    'Closed DMs do not prevent protection. Existing bans keep their original expiry when settings change.' });
}

async function retireWarning(interaction, settings) {
  if (!settings?.warningMessageId) return;
  try {
    const channel = await interaction.guild.channels.fetch(settings.channelId);
    const warning = await channel?.messages.fetch(settings.warningMessageId);
    if (warning?.author?.id !== interaction.client.user.id) return;
    await warning.edit({ embeds: [new EmbedBuilder().setColor(0x95A5A6)
      .setTitle('Trap-channel notice no longer active')
      .setDescription('This setup notice has been replaced or disabled. Ask server staff about the current channel rules.')],
    allowedMentions: { parse: [] } });
  } catch (error) { console.error('Could not update the previous trap-channel warning:', error); }
}

module.exports = {
  cooldown: 3000,
  ephemeral: true,
  dmPermission: false,
  data: new SlashCommandBuilder().setName('trapchannel')
    .setDescription('Configure opt-in trap-channel account protection')
    .setDefaultMemberPermissions(P.Administrator).setDMPermission(false)
    .addSubcommand(command => command.setName('set').setDescription('Enable a dedicated trap channel; new posts trigger temporary bans')
      .addChannelOption(option => option.setName('channel').setDescription('Dedicated do-not-post channel, never a general chat')
        .addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addStringOption(option => option.setName('invite').setDescription('Recovery invite for this server; a permanent invite is recommended')
        .setMaxLength(200).setRequired(true))
      .addBooleanOption(option => option.setName('confirm').setDescription('Confirm that new non-exempt posts here should trigger bans').setRequired(true))
      .addIntegerOption(option => option.setName('duration_hours').setDescription('Temporary ban duration; defaults to 6 hours')
        .setMinValue(1).setMaxValue(168)))
    .addSubcommand(command => command.setName('disable').setDescription('Stop new trap bans; existing temporary bans still expire'))
    .addSubcommand(command => command.setName('status').setDescription('Show settings, scheduled bans and recent recovery errors'))
    .addSubcommand(command => command.setName('exempt-add').setDescription('Exclude an additional role from trap bans')
      .addRoleOption(option => option.setName('role').setDescription('Role to exempt').setRequired(true)))
    .addSubcommand(command => command.setName('exempt-remove').setDescription('Remove an additional trap exemption')
      .addRoleOption(option => option.setName('role').setDescription('Role to remove').setRequired(true)))
    .addSubcommand(command => command.setName('exempt-list').setDescription('List additional exempt roles and automatic staff exemptions'))
    .addSubcommand(command => command.setName('hold').setDescription('Cancel automatic expiry of an active trap ban; keep the user banned')
      .addUserOption(option => option.setName('user').setDescription('User whose trap ban should remain until manually lifted').setRequired(true))),

  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.memberPermissions?.has(P.Administrator)) {
      return interaction.editReply({ content: 'Only server administrators can manage trap-channel protection.' });
    }
    const action = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    try {
      if (action === 'set') return await configure(interaction);
      if (action === 'disable') {
        const previous = settingsFor(guildId);
        run('UPDATE trap_channel_settings SET enabled=0,updatedBy=?,updatedAt=? WHERE guildId=?', [interaction.user.id,Date.now(),guildId]);
        await retireWarning(interaction,previous);
        return interaction.editReply({ content: 'New trap bans are disabled. Existing scheduled bans will still expire; no bans were extended or removed.' });
      }
      if (action === 'hold') {
        await holdTrapBan(interaction.client,guildId,interaction.options.getUser('user',true).id);
        return interaction.editReply({ content: 'Automatic expiry cancelled. This user will stay banned until staff manually unban them.' });
      }
      if (action === 'exempt-add' || action === 'exempt-remove') {
        const role = interaction.options.getRole('role',true);
        if (role.id === guildId || role.managed) throw new Error('Choose a normal role, not @everyone or an integration role.');
        if (action === 'exempt-add') {
          if (get('SELECT COUNT(*) AS count FROM trap_channel_exempt_roles WHERE guildId=?',[guildId]).count >= 50) {
            throw new Error('A maximum of 50 additional exempt roles is supported.');
          }
          run('INSERT OR IGNORE INTO trap_channel_exempt_roles(guildId,roleId) VALUES(?,?)',[guildId,role.id]);
        } else run('DELETE FROM trap_channel_exempt_roles WHERE guildId=? AND roleId=?',[guildId,role.id]);
        return interaction.editReply({ content: `${role} ${action === 'exempt-add' ? 'is now exempt' : 'was removed from additional exemptions'}. Automatic staff protections remain in place.`, allowedMentions: { parse: [] } });
      }
      if (action === 'exempt-list') {
        const roles = all('SELECT roleId FROM trap_channel_exempt_roles WHERE guildId=? ORDER BY roleId',[guildId]);
        return interaction.editReply({ content: `Additional exempt roles: ${roles.map(row=>`<@&${row.roleId}>`).join(', ') || 'None'}\n\n` +
          'Bots, the server owner, members with moderation/server-management permissions, configured staff/admin/giveaway roles, ticket staff roles, and members I cannot ban are automatically protected.',
        allowedMentions: { parse: [] } });
      }
      const settings = settingsFor(guildId);
      const pending = get(`SELECT COUNT(*) AS count FROM trap_channel_incidents WHERE guildId=?
        AND status IN ('PREPARING','BANNING','ACTIVE','RELEASING')`,[guildId]).count;
      const errors = all(`SELECT userId,status,lastError FROM trap_channel_incidents WHERE guildId=? AND lastError IS NOT NULL
        AND status IN ('PREPARING','BANNING','ACTIVE','RELEASING') ORDER BY updatedAt DESC LIMIT 3`,[guildId]);
      return interaction.editReply({ embeds: [new EmbedBuilder().setTitle('Trap-channel protection').setColor(0x5865F2)
        .addFields({name:'Status',value:settings?.enabled?'Enabled':'Disabled',inline:true},
          {name:'Channel',value:settings?`<#${settings.channelId}>`:'Not set',inline:true},
          {name:'New ban duration',value:`${settings?.durationHours || 6} hours`,inline:true},
          {name:'Pending / active temporary bans',value:String(pending)},
          {name:'Recovery issues',value:errors.map(row=>`<@${row.userId}> (${row.status}): ${row.lastError.slice(0,220)}`).join('\n') || 'None recorded'})
        .setFooter({text:'Expiry checked every 30 seconds while online. Disabling does not cancel existing expiries.'})] });
    } catch (error) {
      return interaction.editReply({ content: `Trap-channel settings were not completed: ${error.message}`, allowedMentions: { parse: [] } });
    }
  },
  parseInvite
};
