const {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');

const {
  CHECK_INTERVAL,
  buildOfferEmbed,
  checkFreeGames,
  disableFreeGameWatch,
  getFreeGameSettings,
  saveFreeGameSettings
} = require('../../utils/freeGames');

const SOURCE_CHOICES = [
  { name: 'Epic Games and Steam', value: 'BOTH' },
  { name: 'Epic Games only', value: 'EPIC' },
  { name: 'Steam only', value: 'STEAM' }
];

const COUNTRY_CHOICES = [
  { name: 'United Kingdom', value: 'GB' },
  { name: 'United States', value: 'US' },
  { name: 'Canada', value: 'CA' },
  { name: 'Australia', value: 'AU' },
  { name: 'Germany', value: 'DE' }
];

const STORE_CHOICES=[{name:'Epic Games',value:'EPIC'},{name:'Steam',value:'STEAM'},
  ...Object.entries(require('../../utils/gameProviders').SOURCES).map(([value,name])=>({name,value}))];

function describeSources(settings) {
  const sources = [];
  if (Number(settings?.epicEnabled) === 1) sources.push('Epic Games');
  if (Number(settings?.steamEnabled) === 1) sources.push('Steam');
  sources.push(...require('../../utils/gameProviders').extraSources(settings).map(source=>require('../../utils/gameProviders').SOURCES[source]));
  return sources.length ? sources.join(' and ') : 'None';
}

function statusEmbed(settings) {
  return new EmbedBuilder()
    .setColor(settings?.enabled ? 0x57F287 : 0xED4245)
    .setTitle('Free Game Watch')
    .addFields(
      { name: 'Status', value: settings?.enabled ? 'Enabled' : 'Disabled', inline: true },
      { name: 'Sources', value: describeSources(settings), inline: true },
      { name: 'Region', value: settings?.steamCountry || 'GB', inline: true },
      { name: 'Channel', value: settings?.channelId ? `<#${settings.channelId}>` : 'Not set', inline: true },
      { name: 'Ping Role', value: settings?.pingRoleId ? `<@&${settings.pingRoleId}>` : 'No role ping', inline: true },
      { name: 'Checks', value: `Every ${CHECK_INTERVAL / 60000} minutes`, inline: true }
    )
    .setFooter({ text: 'Extra stores use GamerPower coverage; regional/key-stock limits may apply. Detection is not exhaustive.' })
    .setTimestamp();
}

module.exports = {
  cooldown: 2000,
  ephemeral: true,

  data: new SlashCommandBuilder()
    .setName('freegames')
    .setDescription('Watch Epic Games and Steam for free game offers')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(subcommand => subcommand
      .setName('setup')
      .setDescription('Choose where free game offers are posted')
      .addChannelOption(option => option
        .setName('channel')
        .setDescription('Channel for free game alerts')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true))
      .addStringOption(option => option
        .setName('source')
        .setDescription('Stores to watch')
        .addChoices(...SOURCE_CHOICES))
      .addRoleOption(option => option
        .setName('ping_role')
        .setDescription('Optional role to ping for every alert'))
      .addStringOption(option => option
        .setName('country')
        .setDescription('Store region used for offer availability')
        .addChoices(...COUNTRY_CHOICES)))
    .addSubcommand(subcommand => subcommand
      .setName('disable')
      .setDescription('Disable free game alerts'))
    .addSubcommand(subcommand => subcommand
      .setName('clear-ping')
      .setDescription('Stop pinging a role for free game alerts'))
    .addSubcommand(subcommand => subcommand
      .setName('status')
      .setDescription('View free game watch settings'))
    .addSubcommand(subcommand => subcommand
      .setName('check')
      .setDescription('Check the stores now and post any unannounced offers'))
    .addSubcommand(subcommand => subcommand
      .setName('test')
      .setDescription('Send a sample free game alert in the configured channel'))
    .addSubcommand(command=>command.setName('source').setDescription('Add/remove supplementary stores, or list enabled sources.')
      .addStringOption(option=>option.setName('action').setDescription('Action').setRequired(true).addChoices(...['add','remove','list'].map(value=>({name:value,value}))))
      .addStringOption(option=>option.setName('store').setDescription('Supplementary store').addChoices(...Object.entries(require('../../utils/gameProviders').SOURCES).map(([value,name])=>({name,value})))))
    .addSubcommand(command=>command.setName('health').setDescription('Last successful store checks and provider errors.'))
    .addSubcommand(command=>command.setName('route').setDescription('Override destination, ping and enabled state for one store.')
      .addStringOption(option=>option.setName('store').setDescription('Store').setRequired(true).addChoices(...STORE_CHOICES))
      .addChannelOption(option=>option.setName('channel').setDescription('Store-specific destination').addChannelTypes(ChannelType.GuildText,ChannelType.GuildAnnouncement))
      .addRoleOption(option=>option.setName('ping_role').setDescription('Store-specific ping role'))
      .addStringOption(option=>option.setName('ping').setDescription('Notification preference').addChoices({name:'Inherit main ping',value:'INHERIT'},{name:'No ping',value:'NONE'},{name:'Selected role',value:'ROLE'}))
      .addBooleanOption(option=>option.setName('enabled').setDescription('Post alerts from this store')))
    .addSubcommand(command=>command.setName('route-reset').setDescription('Restore the main watch settings for one store.')
      .addStringOption(option=>option.setName('store').setDescription('Store').setRequired(true).addChoices(...STORE_CHOICES)))
    .addSubcommand(command=>command.setName('routes').setDescription('List per-store destinations and notification preferences.')),

  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.editReply({ content: 'Administrator permission is required.' });
    }

    const subcommand = interaction.options.getSubcommand();
    const existing = getFreeGameSettings(interaction.guild.id);
    if(['route','route-reset','routes'].includes(subcommand)) {
      const {all,get,run}=require('../../database');
      if(!existing) return interaction.editReply('Run /freegames setup first.');
      if(subcommand==='routes') return interaction.editReply({content:all('SELECT * FROM free_game_routes WHERE guildId=? ORDER BY source',[interaction.guild.id])
        .map(row=>`**${row.source}** | ${row.enabled?'Enabled':'Disabled'} | ${row.channelId?`<#${row.channelId}>`:'Main channel'} | ${row.pingMode==='ROLE'?`<@&${row.pingRoleId}>`:row.pingMode==='NONE'?'No ping':'Main ping'}`).join('\n').slice(0,1900) || 'All stores inherit the main watch settings.',allowedMentions:{parse:[]}});
      const source=interaction.options.getString('store',true);
      if(subcommand==='route-reset') {run('DELETE FROM free_game_routes WHERE guildId=? AND source=?',[interaction.guild.id,source]);return interaction.editReply('Store overrides removed. The main watch settings apply again.');}
      const previous=get('SELECT * FROM free_game_routes WHERE guildId=? AND source=?',[interaction.guild.id,source]) || {};
      const channel=interaction.options.getChannel('channel'),role=interaction.options.getRole('ping_role');
      if(channel) {const issue=require('../../utils/destinationValidation').destinationIssue(interaction.guild,channel);if(issue)throw new Error(issue);}
      require('../../utils/communityAccess').validRole(interaction.guild,role);
      const mode=interaction.options.getString('ping') || (role?'ROLE':previous.pingMode || 'INHERIT');
      const roleId=role?.id || previous.pingRoleId || null;
      if(mode==='ROLE' && !roleId)throw new Error('Select a ping role or choose No ping / Inherit main ping.');
      run(`INSERT INTO free_game_routes(guildId,source,channelId,pingRoleId,pingMode,enabled) VALUES(?,?,?,?,?,?)
        ON CONFLICT(guildId,source) DO UPDATE SET channelId=excluded.channelId,pingRoleId=excluded.pingRoleId,pingMode=excluded.pingMode,enabled=excluded.enabled`,
      [interaction.guild.id,source,channel?.id || previous.channelId || null,roleId,mode,Number(interaction.options.getBoolean('enabled') ?? previous.enabled ?? true)]);
      return interaction.editReply('Store preferences saved. Enable its provider in the main watch/source settings if it is not already watched.');
    }
    if(subcommand==='health') {
      const country=existing?.steamCountry || 'GB';
      const providers=require('../../utils/gameProviders');
      return interaction.editReply({content:['EPIC:'+country,'STEAM:'+country,'GAMERPOWER'].map(name=>{
        const health=providers.providerHealth(name);
        return `**${name}**: ${health?.error?`Error: ${health.error}`:health?'Healthy':'Not checked'}${health?.successAt?` | Success <t:${Math.floor(health.successAt/1000)}:R>`:''}`;
      }).join('\n'),allowedMentions:{parse:[]}});
    }
    if(subcommand==='source') {
      if(!existing) return interaction.editReply('Run /freegames setup first.');
      const {extraSources,SOURCES}=require('../../utils/gameProviders');
      const action=interaction.options.getString('action',true),store=interaction.options.getString('store');
      const sources=new Set(extraSources(existing));
      if(action!=='list') {
        if(!Object.hasOwn(SOURCES,store || '')) return interaction.editReply('Choose a supplementary store.');
        if(action==='add') sources.add(store); else sources.delete(store);
        require('../../database').run('UPDATE free_game_settings SET extraSources=?,updatedBy=?,updatedAt=? WHERE guildId=?',[JSON.stringify([...sources]),interaction.user.id,Date.now(),interaction.guild.id]);
      }
      return interaction.editReply({content:`Supplementary stores: ${[...sources].map(source=>SOURCES[source]).join(', ') || 'None'}.\nCoverage supplied by [GamerPower](https://www.gamerpower.com/); availability and claim requirements vary.`,allowedMentions:{parse:[]}});
    }

    if (subcommand === 'status') {
      return interaction.editReply({
        embeds: [statusEmbed(existing)],
        allowedMentions: { parse: [] }
      });
    }

    if (subcommand === 'disable') {
      const result = disableFreeGameWatch(interaction.guild.id, interaction.user.id);
      return interaction.editReply({
        content: result.changes
          ? 'Free game alerts are disabled.'
          : 'Free game alerts have not been configured.'
      });
    }

    if (subcommand === 'clear-ping') {
      if (!existing) {
        return interaction.editReply({ content: 'Configure free game alerts first.' });
      }

      saveFreeGameSettings({
        guildId: interaction.guild.id,
        channelId: existing.channelId,
        pingRoleId: null,
        epicEnabled: Number(existing.epicEnabled) === 1,
        steamEnabled: Number(existing.steamEnabled) === 1,
        steamCountry: existing.steamCountry,
        enabled: Boolean(existing.enabled),
        updatedBy: interaction.user.id
      });

      return interaction.editReply({ content: 'The main free-game ping role was cleared. Store-specific ping overrides are unchanged; use /freegames route to edit them.' });
    }

    if (subcommand === 'setup') {
      const channel = interaction.options.getChannel('channel', true);
      const source = interaction.options.getString('source') ||
        (Number(existing?.epicEnabled) === 1 && Number(existing?.steamEnabled) === 0
          ? 'EPIC'
          : Number(existing?.steamEnabled) === 1 && Number(existing?.epicEnabled) === 0
            ? 'STEAM'
            : 'BOTH');
      const role = interaction.options.getRole('ping_role');
      const country = interaction.options.getString('country') || existing?.steamCountry || 'GB';
      const permissions = channel.permissionsFor(interaction.guild.members.me);

      if (!permissions?.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks
      ])) {
        return interaction.editReply({
          content: 'I need View Channel, Send Messages, and Embed Links in that channel.'
        });
      }

      if (role && (role.id === interaction.guild.id || role.managed)) {
        return interaction.editReply({
          content: 'Choose a normal server role, not @everyone or an integration-managed role.'
        });
      }

      saveFreeGameSettings({
        guildId: interaction.guild.id,
        channelId: channel.id,
        pingRoleId: role?.id || existing?.pingRoleId || null,
        epicEnabled: source === 'BOTH' || source === 'EPIC',
        steamEnabled: source === 'BOTH' || source === 'STEAM',
        steamCountry: country,
        updatedBy: interaction.user.id
      });

      return interaction.editReply({
        content: `Free game alerts are enabled in ${channel} for ${source === 'BOTH' ? 'Epic Games and Steam' : source === 'EPIC' ? 'Epic Games' : 'Steam'}.`
      });
    }

    if (!existing?.enabled || !existing.channelId) {
      return interaction.editReply({ content: 'Use `/freegames setup` first.' });
    }

    const channel = await interaction.client.channels.fetch(existing.channelId).catch(() => null);
    if (!channel?.isTextBased()) {
      return interaction.editReply({ content: 'The configured free game channel is unavailable. Run `/freegames setup` again.' });
    }

    if (subcommand === 'check') {
      const summary = await checkFreeGames(interaction.client, {
        guildId: interaction.guild.id
      });

      if (summary.busy) {
        return interaction.editReply({
          content: 'A free-game check is already running. Please try again in a moment.'
        });
      }

      const detected = Object.entries(summary.detected).map(([source,count])=>`${source}: ${count}`).join(' | ');
      const result = [
        `Checked ${summary.configurations} configured watch${summary.configurations === 1 ? '' : 'es'}.`,
        detected,
        `Posted: ${summary.announced}.`,
        summary.skipped ? `Already posted or unavailable: ${summary.skipped}.` : null,
        summary.failures.length ? `Store errors: ${summary.failures.join(' | ').slice(0, 800)}` : null
      ].filter(Boolean).join('\n');

      return interaction.editReply({ content: result });
    }

    const sample = {
      source: Number(existing.epicEnabled) === 1 ? 'EPIC' : 'STEAM',
      title: 'Example Free Game',
      originalPrice: '£19.99',
      endsAt: Date.now() + (24 * 60 * 60 * 1000),
      image: null,
      url: 'https://store.epicgames.com/'
    };

    await channel.send({
      content: existing.pingRoleId ? `<@&${existing.pingRoleId}>` : undefined,
      embeds: [buildOfferEmbed(sample)],
      allowedMentions: existing.pingRoleId
        ? { roles: [existing.pingRoleId], parse: [] }
        : { parse: [] }
    });

    return interaction.editReply({ content: `A sample alert was sent to ${channel}.` });
  }
};
