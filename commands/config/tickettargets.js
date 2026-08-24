const {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');

const ticketTypes = require('../../utils/tickets/ticketTypes');

const {
  formatDuration,
  listTicketTargets,
  removeTicketTarget,
  setTicketTarget
} = require('../../utils/ticketTargets');

function addTypeOption(subcommand) {
  return subcommand.addStringOption(option => {
    option
      .setName('type')
      .setDescription('Ticket type')
      .setRequired(true);

    for (const [value, ticketType] of Object.entries(ticketTypes)) {
      option.addChoices({ name: ticketType.name, value });
    }

    return option;
  });
}

module.exports = {
  cooldown: 2000,
  ephemeral: true,

  data: new SlashCommandBuilder()
    .setName('tickettargets')
    .setDescription('Configure ticket response and resolution targets')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(subcommand =>
      addTypeOption(
        subcommand
          .setName('set')
          .setDescription('Set targets for one ticket type')
      )
        .addChannelOption(option => option
          .setName('alert_channel')
          .setDescription('Channel for target breach alerts')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true))
        .addIntegerOption(option => option
          .setName('response_minutes')
          .setDescription('Minutes allowed before a staff member claims it')
          .setMinValue(1)
          .setMaxValue(43200))
        .addIntegerOption(option => option
          .setName('resolve_minutes')
          .setDescription('Minutes allowed before it should be closed')
          .setMinValue(1)
          .setMaxValue(43200))
        .addRoleOption(option => option
          .setName('alert_role')
          .setDescription('Optional role pinged when a target is missed'))
    )
    .addSubcommand(subcommand =>
      addTypeOption(
        subcommand
          .setName('disable')
          .setDescription('Disable targets for one ticket type')
      )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('status')
        .setDescription('View every configured ticket target')
    ),

  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.editReply({ content: 'Administrator permission is required.' });
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'status') {
      const targets = listTicketTargets(interaction.guild.id);
      const description = targets.length
        ? targets.map(target => [
          `**${ticketTypes[target.type]?.name || target.type}**`,
          `Response: ${formatDuration(target.responseMinutes)}`,
          `Resolution: ${formatDuration(target.resolveMinutes)}`,
          `Alerts: <#${target.alertChannelId}>${target.alertRoleId ? `, <@&${target.alertRoleId}>` : ''}`
        ].join('\n')).join('\n\n')
        : 'No ticket targets are configured.';

      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('Ticket Service Targets')
          .setDescription(description)
          .setTimestamp()],
        allowedMentions: { parse: [] }
      });
    }

    const type = interaction.options.getString('type', true);

    if (subcommand === 'disable') {
      const result = removeTicketTarget(interaction.guild.id, type);

      return interaction.editReply({
        content: result.changes
          ? `Targets disabled for ${ticketTypes[type].name} tickets.`
          : `No targets were configured for ${ticketTypes[type].name} tickets.`
      });
    }

    const responseMinutes = interaction.options.getInteger('response_minutes');
    const resolveMinutes = interaction.options.getInteger('resolve_minutes');

    if (!responseMinutes && !resolveMinutes) {
      return interaction.editReply({
        content: 'Set at least a response or resolution target.'
      });
    }

    const alertChannel = interaction.options.getChannel('alert_channel', true);
    const alertRole = interaction.options.getRole('alert_role');
    const permissions = alertChannel.permissionsFor(interaction.guild.members.me);

    if (!permissions?.has([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks
    ])) {
      return interaction.editReply({
        content: 'I need View Channel, Send Messages, and Embed Links in the alert channel.'
      });
    }

    setTicketTarget({
      guildId: interaction.guild.id,
      type,
      responseMinutes,
      resolveMinutes,
      alertChannelId: alertChannel.id,
      alertRoleId: alertRole?.id || null,
      updatedBy: interaction.user.id
    });

    return interaction.editReply({
      content:
        `Targets saved for ${ticketTypes[type].name} tickets. ` +
        `Response: ${formatDuration(responseMinutes)}. ` +
        `Resolution: ${formatDuration(resolveMinutes)}.`
    });
  }
};
