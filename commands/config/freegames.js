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

function describeSources(settings) {
  const sources = [];
  if (Number(settings?.epicEnabled) === 1) sources.push('Epic Games');
  if (Number(settings?.steamEnabled) === 1) sources.push('Steam');
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
    .setFooter({ text: 'Only temporary discounted-to-zero Steam games are announced.' })
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
      .setDescription('Send a sample free game alert in the configured channel')),

  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.editReply({ content: 'Administrator permission is required.' });
    }

    const subcommand = interaction.options.getSubcommand();
    const existing = getFreeGameSettings(interaction.guild.id);

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
        updatedBy: interaction.user.id
      });

      return interaction.editReply({ content: 'Free game alerts will no longer ping a role.' });
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
      await checkFreeGames(interaction.client);
      return interaction.editReply({ content: 'Checked Epic Games and Steam. Any new eligible offers were posted.' });
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
