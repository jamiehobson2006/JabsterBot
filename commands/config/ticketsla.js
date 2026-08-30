const {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');

const {
  get,
  run
} = require('../../database');

function getSettings(guildId) {
  return get(
    'SELECT * FROM ticket_sla_settings WHERE guildId = ?',
    [guildId]
  );
}

function statusEmbed(settings) {
  return new EmbedBuilder()
    .setColor(settings?.enabled ? 0x57F287 : 0xED4245)
    .setTitle('Ticket SLA Settings')
    .addFields(
      { name: 'Status', value: settings?.enabled ? 'Enabled' : 'Disabled', inline: true },
      { name: 'First Response', value: `${settings?.firstResponseMinutes || 60} minute(s)`, inline: true },
      { name: 'Resolution', value: `${settings?.resolutionMinutes || 1440} minute(s)`, inline: true },
      { name: 'Alert Channel', value: settings?.alertChannelId ? `<#${settings.alertChannelId}>` : 'The ticket channel', inline: true },
      { name: 'Ping Role', value: settings?.pingRoleId ? `<@&${settings.pingRoleId}>` : 'None', inline: true }
    )
    .setFooter({ text: 'Each SLA alert is sent once per open ticket.' })
    .setTimestamp();
}

module.exports = {
  cooldown: 3000,
  ephemeral: true,

  data: new SlashCommandBuilder()
    .setName('ticketsla')
    .setDescription('Configure ticket response and resolution targets')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(subcommand => subcommand
      .setName('configure')
      .setDescription('Enable ticket SLA monitoring')
      .addIntegerOption(option => option
        .setName('first_response_minutes')
        .setDescription('Minutes before a ticket needs its first staff response')
        .setMinValue(1)
        .setMaxValue(10080)
        .setRequired(true))
      .addIntegerOption(option => option
        .setName('resolution_minutes')
        .setDescription('Minutes before an open ticket needs a resolution alert')
        .setMinValue(1)
        .setMaxValue(43200)
        .setRequired(true))
      .addChannelOption(option => option
        .setName('alert_channel')
        .setDescription('Optional staff alert channel')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
      .addRoleOption(option => option
        .setName('ping_role')
        .setDescription('Optional role to ping for overdue tickets')))
    .addSubcommand(subcommand => subcommand
      .setName('disable')
      .setDescription('Disable ticket SLA alerts'))
    .addSubcommand(subcommand => subcommand
      .setName('status')
      .setDescription('View ticket SLA settings')),

  async execute(interaction) {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.editReply({ content: 'Administrator permission is required.' });
    }

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'status') {
      return interaction.editReply({ embeds: [statusEmbed(getSettings(interaction.guild.id))] });
    }

    if (subcommand === 'disable') {
      run(
        `INSERT INTO ticket_sla_settings (guildId, enabled, updatedBy, updatedAt)
         VALUES (?, 0, ?, ?)
         ON CONFLICT(guildId) DO UPDATE SET enabled = 0, updatedBy = excluded.updatedBy, updatedAt = excluded.updatedAt`,
        [interaction.guild.id, interaction.user.id, Date.now()]
      );
      return interaction.editReply({ content: 'Ticket SLA alerts disabled.' });
    }

    const alertChannel = interaction.options.getChannel('alert_channel');
    const pingRole = interaction.options.getRole('ping_role');
    const botPermissions = alertChannel?.permissionsFor(interaction.guild.members.me);
    if (alertChannel && !botPermissions?.has([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks
    ])) {
      return interaction.editReply({ content: 'I need View Channel, Send Messages, and Embed Links in the alert channel.' });
    }

    if (pingRole && (pingRole.managed || pingRole.id === interaction.guild.roles.everyone.id)) {
      return interaction.editReply({ content: 'Choose a normal server role to ping.' });
    }

    if (pingRole && alertChannel && !botPermissions.has(PermissionFlagsBits.MentionEveryone)) {
      return interaction.editReply({ content: 'I need Mention Everyone permission in the alert channel to ping that role.' });
    }

    const firstResponseMinutes = interaction.options.getInteger('first_response_minutes', true);
    const resolutionMinutes = interaction.options.getInteger('resolution_minutes', true);
    run(
      `INSERT INTO ticket_sla_settings (
         guildId, enabled, firstResponseMinutes, resolutionMinutes,
         alertChannelId, pingRoleId, updatedBy, updatedAt
       ) VALUES (?, 1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(guildId) DO UPDATE SET
         enabled = 1,
         firstResponseMinutes = excluded.firstResponseMinutes,
         resolutionMinutes = excluded.resolutionMinutes,
         alertChannelId = excluded.alertChannelId,
         pingRoleId = excluded.pingRoleId,
         updatedBy = excluded.updatedBy,
         updatedAt = excluded.updatedAt`,
      [
        interaction.guild.id,
        firstResponseMinutes,
        resolutionMinutes,
        alertChannel?.id || null,
        pingRole?.id || null,
        interaction.user.id,
        Date.now()
      ]
    );

    return interaction.editReply({
      embeds: [statusEmbed(getSettings(interaction.guild.id))]
    });
  }
};
