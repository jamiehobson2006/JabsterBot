const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder
} = require('discord.js');

const { get } = require('../database');

const HOME_ID = 'setupwizard:home';

function enabled(value) {
  return Number(value) === 1;
}

function summary(guildId) {
  const logs = get(
    `SELECT COUNT(*) AS total FROM log_settings WHERE guildId = ? AND enabled = 1 AND channelId <> ''`,
    [guildId]
  )?.total || 0;
  const ticket = get(
    `SELECT enabled, categoryId, roleId FROM ticket_settings WHERE guildId = ? AND type = 'SUPPORT'`,
    [guildId]
  );
  const guild = get(
    `SELECT suggestionChannelId, linkBlockEnabled, censorAntiRacismEnabled
     FROM guild_settings WHERE guildId = ?`,
    [guildId]
  );
  const welcome = get(
    `SELECT enabled, channelId FROM greeting_settings WHERE guildId = ? AND type = 'welcome'`,
    [guildId]
  );
  const phishing = get(`SELECT enabled FROM phishing_settings WHERE guildId = ?`, [guildId]);
  const spam = get(`SELECT enabled FROM antispam_settings WHERE guildId = ?`, [guildId]);
  return {
    logs,
    ticketReady: enabled(ticket?.enabled) && Boolean(ticket?.categoryId && ticket?.roleId),
    ticket,
    suggestionChannelId: guild?.suggestionChannelId || null,
    welcomeReady: enabled(welcome?.enabled) && Boolean(welcome?.channelId),
    welcomeChannelId: welcome?.channelId || null,
    linkBlock: enabled(guild?.linkBlockEnabled),
    antiRacism: enabled(guild?.censorAntiRacismEnabled),
    phishing: enabled(phishing?.enabled),
    spam: enabled(spam?.enabled)
  };
}

function homePayload(guildId, notice = null) {
  const state = summary(guildId);
  const fields = [
    {
      name: 'Logging',
      value: state.logs ? `${state.logs} log categories enabled` : 'Not configured',
      inline: true
    },
    {
      name: 'Support Tickets',
      value: state.ticketReady ? 'Ready' : 'Needs a category and staff role',
      inline: true
    },
    {
      name: 'Community',
      value: [
        state.suggestionChannelId ? 'Suggestions ready' : 'Suggestions not set',
        state.welcomeReady ? 'Welcome messages ready' : 'Welcome messages not set'
      ].join('\n'),
      inline: true
    },
    {
      name: 'Safety',
      value: [
        `Phishing: ${state.phishing ? 'On' : 'Off'}`,
        `Link blocking: ${state.linkBlock ? 'On' : 'Off'}`,
        `Anti-racism: ${state.antiRacism ? 'On' : 'Off'}`,
        `Anti-spam: ${state.spam ? 'On' : 'Off'}`
      ].join('\n'),
      inline: true
    }
  ];
  if (notice) fields.unshift({ name: 'Saved', value: notice.slice(0, 1024) });

  return {
    embeds: [new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('Jabster Studios Setup Wizard')
      .setDescription('Choose a section below. Every selection is saved immediately and remains configured after restarts.')
      .addFields(fields)
      .setFooter({ text: 'You can revisit any section or use the full configuration commands later.' })],
    components: [new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('setupwizard:section')
        .setPlaceholder('Choose a setup section')
        .addOptions(
          { label: 'Logging', value: 'logging', description: 'Send all log categories to one channel' },
          { label: 'Support Tickets', value: 'tickets', description: 'Choose the support category and staff role' },
          { label: 'Community', value: 'community', description: 'Configure suggestions and welcome messages' },
          { label: 'Safety', value: 'safety', description: 'Enable recommended server protections' }
        )
    )]
  };
}

function backRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(HOME_ID)
      .setLabel('Back to Overview')
      .setStyle(ButtonStyle.Secondary)
  );
}

function sectionPayload(guildId, section) {
  const state = summary(guildId);

  if (section === 'logging') {
    return {
      embeds: [new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('Setup Logging')
        .setDescription('Choose a channel. All logging categories will be enabled there; you can split them later with `/logging`.')
        .addFields({ name: 'Current Status', value: `${state.logs} categories enabled` })],
      components: [
        new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId('setupwizard:set:logging')
            .setPlaceholder('Select a logging channel')
            .setChannelTypes(ChannelType.GuildText)
        ),
        backRow()
      ]
    };
  }

  if (section === 'tickets') {
    return {
      embeds: [new EmbedBuilder()
        .setColor(0xF1C40F)
        .setTitle('Setup Support Tickets')
        .setDescription('Choose both a category and the staff role that should see support tickets.')
        .addFields(
          { name: 'Category', value: state.ticket?.categoryId ? `<#${state.ticket.categoryId}>` : 'Not set', inline: true },
          { name: 'Staff Role', value: state.ticket?.roleId ? `<@&${state.ticket.roleId}>` : 'Not set', inline: true }
        )],
      components: [
        new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId('setupwizard:set:ticket-category')
            .setPlaceholder('Select the support ticket category')
            .setChannelTypes(ChannelType.GuildCategory)
        ),
        new ActionRowBuilder().addComponents(
          new RoleSelectMenuBuilder()
            .setCustomId('setupwizard:set:ticket-role')
            .setPlaceholder('Select the support staff role')
        ),
        backRow()
      ]
    };
  }

  if (section === 'community') {
    return {
      embeds: [new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('Setup Community Features')
        .setDescription('Suggestions use `/suggest`. Welcome messages use the built-in rotating message style without pinging.')
        .addFields(
          { name: 'Suggestions', value: state.suggestionChannelId ? `<#${state.suggestionChannelId}>` : 'Not set', inline: true },
          { name: 'Welcome Messages', value: state.welcomeChannelId ? `<#${state.welcomeChannelId}>` : 'Not set', inline: true }
        )],
      components: [
        new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId('setupwizard:set:suggestions')
            .setPlaceholder('Select the suggestions channel')
            .setChannelTypes(ChannelType.GuildText)
        ),
        new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId('setupwizard:set:welcome')
            .setPlaceholder('Select the welcome channel')
            .setChannelTypes(ChannelType.GuildText)
        ),
        backRow()
      ]
    };
  }

  return {
    embeds: [new EmbedBuilder()
      .setColor(0xED4245)
      .setTitle('Setup Safety')
      .setDescription('Recommended protection enables phishing detection, server-wide link blocking, built-in anti-racism, and balanced anti-spam defaults.')
      .addFields(
        { name: 'Phishing', value: state.phishing ? 'On' : 'Off', inline: true },
        { name: 'Link Blocking', value: state.linkBlock ? 'On' : 'Off', inline: true },
        { name: 'Anti-racism', value: state.antiRacism ? 'On' : 'Off', inline: true },
        { name: 'Anti-spam', value: state.spam ? 'On' : 'Off', inline: true }
      )],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('setupwizard:safety:recommended')
          .setLabel('Enable Recommended Protection')
          .setStyle(ButtonStyle.Success)
      ),
      backRow()
    ]
  };
}

module.exports = {
  HOME_ID,
  homePayload,
  sectionPayload,
  summary
};
