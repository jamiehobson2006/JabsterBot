const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  PermissionsBitField,
  StringSelectMenuBuilder
} = require('discord.js');

const {
  LOG_CATEGORIES,
  getCategory,
  getLogCategoryStates,
  getLogDestination,
  getLastLogTimestamp,
  memberCanManageLogging
} = require('./loggingConfig');

function canConfigureLogging(interaction) {
  return Boolean(
    interaction.guild &&
    (
      interaction.memberPermissions?.has(
        PermissionsBitField.Flags.Administrator
      ) || memberCanManageLogging(
        interaction.member,
        interaction.guild.id
      )
    )
  );
}

function categorySelect(selectedType = null) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('logging_category_select')
    .setPlaceholder('Choose a log category to configure')
    .addOptions(
      Object.entries(LOG_CATEGORIES).map(([type, category]) => ({
        label: category.label,
        value: type,
        description: category.description.slice(0, 100),
        default: type === selectedType
      }))
    );

  return new ActionRowBuilder().addComponents(menu);
}

function stateText(state) {
  if (!state.enabled) {
    return 'Disabled';
  }

  const status = state.channelId
    ? `Enabled in <#${state.channelId}>`
    : 'Disabled';

  return state.lastLoggedAt
    ? `${status}\nLast activity: <t:${Math.floor(state.lastLoggedAt / 1000)}:R>`
    : status;
}

function buildLoggingDashboard(guildId, notice = null) {
  const states = getLogCategoryStates(guildId);
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('Logging Configuration')
    .setDescription(
      notice ||
      'Choose a category below, then select the channel that should receive those logs. Disabling a category stops it immediately.'
    )
    .setFooter({
      text: 'Log changes are saved permanently and survive bot restarts.'
    })
    .setTimestamp();

  for (const state of states) {
    embed.addFields({
      name: state.label,
      value: stateText(state),
      inline: true
    });
  }

  return {
    embeds: [embed],
    components: [categorySelect()],
    allowedMentions: { parse: [] }
  };
}

function buildLoggingCategoryPanel(guildId, type, notice = null) {
  const category = getCategory(type);
  const state = getLogDestination(guildId, type);
  const lastLoggedAt = getLastLogTimestamp(guildId, type);

  if (!category) {
    return buildLoggingDashboard(guildId, 'That logging category is no longer available.');
  }

  const embed = new EmbedBuilder()
    .setColor(state.enabled ? 0x57F287 : 0xED4245)
    .setTitle(`${category.label} Logs`)
    .setDescription(notice || category.description)
    .addFields(
      {
        name: 'Status',
        value: state.enabled ? 'Enabled' : 'Disabled',
        inline: true
      },
      {
        name: 'Destination',
        value: state.channelId ? `<#${state.channelId}>` : 'No channel selected',
        inline: true
      },
      {
        name: 'Configuration',
        value: state.source === 'legacy'
          ? 'Using an existing legacy channel setting.'
          : state.source === 'configured'
            ? 'Managed by this dashboard.'
            : 'Not configured yet.',
        inline: false
      },
      {
        name: 'Last Logged',
        value: lastLoggedAt
          ? `<t:${Math.floor(lastLoggedAt / 1000)}:F>`
          : 'No events have been logged in this category yet.',
        inline: false
      }
    )
    .setFooter({
      text: 'Selecting a channel enables this category.'
    })
    .setTimestamp();

  const channelMenu = new ChannelSelectMenuBuilder()
    .setCustomId(`logging_channel_${type}`)
    .setPlaceholder(`Set ${category.label.toLowerCase()} log channel`)
    .setMinValues(1)
    .setMaxValues(1)
    .addChannelTypes(
      ChannelType.GuildText,
      ChannelType.GuildAnnouncement
    );

  const buttons = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`logging_disable_${type}`)
        .setLabel('Disable This Category')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`logging_test_${type}`)
        .setLabel('Send Test Log')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('logging_dashboard')
        .setLabel('Back to Overview')
        .setStyle(ButtonStyle.Secondary)
    );

  return {
    embeds: [embed],
    components: [
      categorySelect(type),
      new ActionRowBuilder().addComponents(channelMenu),
      buttons
    ],
    allowedMentions: { parse: [] }
  };
}

module.exports = {
  buildLoggingCategoryPanel,
  buildLoggingDashboard,
  canConfigureLogging
};
