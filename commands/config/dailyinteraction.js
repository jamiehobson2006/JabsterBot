const {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');

const {
  DAY_NAMES,
  DEFAULT_TIMEZONE,
  DailyInteractionService,
  addCustomPrompt,
  clearDayTheme,
  getDailyInteractionAnalytics,
  getDailyInteractionConfig,
  getEngagementLeaderboard,
  getMemberEngagementStats,
  getInteractionTypes,
  listDayThemes,
  listCustomPrompts,
  listInteractionTypes,
  removeCustomPrompt,
  setDayTheme,
  setCustomPromptEnabled,
  updateDailyInteractionConfig,
  updateInteractionType,
  validTimezone
} = require('../../services/DailyInteractionService');

const {
  parseEmbedColor
} = require('../../utils/memberExperience');

const textChannelTypes = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement
];

function typeChoices({ includeRandom = false } = {}) {
  const choices = listInteractionTypes().map(type => ({
    name: type.label,
    value: type.value
  }));

  return includeRandom
    ? [{ name: 'Random enabled activity', value: 'RANDOM' }, ...choices]
    : choices;
}

function dayChoices() {
  return DAY_NAMES.map((name, value) => ({ name, value: String(value) }));
}

function formatTime(config) {
  return `${String(config.hour).padStart(2, '0')}:${String(config.minute).padStart(2, '0')} (${config.timezone || DEFAULT_TIMEZONE})`;
}

function truncate(value, max = 180) {
  const text = String(value || '');
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}

function statusEmbed(config, types) {
  const enabledTypes = types
    .filter(type => Number(type.enabled) === 1)
    .map(type => {
      const definition = listInteractionTypes().find(item => item.value === type.type);
      return `${definition?.emoji || '•'} ${definition?.label || type.type} (weight ${type.weight})`;
    })
    .join('\n') || 'None. Enable at least one interaction type.';

  return new EmbedBuilder()
    .setColor(Number(config?.color) || 0x5865F2)
    .setTitle(config?.titlePrefix || 'Daily Interaction')
    .addFields(
      { name: 'Status', value: config?.enabled ? 'Enabled' : 'Disabled', inline: true },
      { name: 'Channel', value: config?.channelId ? `<#${config.channelId}>` : 'Not set', inline: true },
      { name: 'Ping Role', value: config?.pingRoleId ? `<@&${config.pingRoleId}>` : 'No role ping', inline: true },
      { name: 'Schedule', value: config ? formatTime(config) : `12:00 (${DEFAULT_TIMEZONE})`, inline: true },
      { name: 'Discussion Threads', value: Number(config?.discussionEnabled) === 1 ? 'Enabled' : 'Disabled', inline: true },
      { name: 'Enabled Activities', value: enabledTypes }
    )
    .setFooter({ text: 'Custom prompts and history are saved per server.' })
    .setTimestamp();
}

function themeEmbed(config, themes) {
  const byDay = new Map(themes.map(theme => [Number(theme.dayOfWeek), theme.type]));
  const description = DAY_NAMES.map((day, index) => {
    const type = byDay.get(index);
    const definition = listInteractionTypes().find(item => item.value === type);
    return `**${day}:** ${definition ? `${definition.emoji} ${definition.label}` : 'Weighted random activity'}`;
  }).join('\n');

  return new EmbedBuilder()
    .setColor(Number(config?.color) || 0x5865F2)
    .setTitle('Daily Interaction Weekly Themes')
    .setDescription(description)
    .setFooter({ text: 'Unassigned days use your enabled activity weights.' })
    .setTimestamp();
}

function leaderboardEmbed(config, entries) {
  const description = entries.length
    ? entries.map((entry, index) => {
      const points = Number(entry.totalJoins) + (Number(entry.totalResponses) * 2);
      return `**${index + 1}.** <@${entry.userId}> - ${points} points | ${entry.currentStreak} day streak`;
    }).join('\n')
    : 'No one has joined a daily interaction yet.';

  return new EmbedBuilder()
    .setColor(Number(config?.color) || 0x5865F2)
    .setTitle('Daily Interaction Leaderboard')
    .setDescription(description)
    .setFooter({ text: 'Answers are worth 2 points. Joining is worth 1 point.' })
    .setTimestamp();
}

function memberStatsEmbed(config, user, stats) {
  const joins = Number(stats?.totalJoins) || 0;
  const responses = Number(stats?.totalResponses) || 0;
  const points = joins + (responses * 2);

  return new EmbedBuilder()
    .setColor(Number(config?.color) || 0x5865F2)
    .setTitle(`${user.tag}'s Daily Interaction Stats`)
    .addFields(
      { name: 'Points', value: String(points), inline: true },
      { name: 'Joined', value: String(joins), inline: true },
      { name: 'Answers', value: String(responses), inline: true },
      { name: 'Current Streak', value: `${Number(stats?.currentStreak) || 0} day(s)`, inline: true },
      { name: 'Best Streak', value: `${Number(stats?.longestStreak) || 0} day(s)`, inline: true }
    )
    .setTimestamp();
}

function analyticsEmbed(config, analytics) {
  const types = analytics.types.length
    ? analytics.types.map(row => {
      const definition = listInteractionTypes().find(type => type.value === row.type);
      return `${definition?.emoji || '-'} ${definition?.label || row.type}: ${row.count}`;
    }).join('\n')
    : 'No interactions posted in the last 30 days.';

  return new EmbedBuilder()
    .setColor(Number(config?.color) || 0x5865F2)
    .setTitle('Daily Interaction Analytics')
    .setDescription('Last 30 days')
    .addFields(
      { name: 'Interactions Posted', value: String(analytics.posts), inline: true },
      { name: 'Unique Participants', value: String(analytics.participants), inline: true },
      { name: 'Answers Submitted', value: String(analytics.responses), inline: true },
      { name: 'Activity Mix', value: types }
    )
    .setTimestamp();
}

function resultMessage(result) {
  const messages = {
    sent: 'Daily interaction posted.',
    'missing-channel': 'Set a daily interaction channel first with `/dailyinteraction setup`.',
    'missing-permissions': 'I need View Channel, Send Messages, and Embed Links in the configured channel.',
    'no-prompts': 'No prompt is available. Enable an activity type or add a custom prompt.'
  };

  return messages[result.status] || 'Could not post a daily interaction right now.';
}

module.exports = {
  cooldown: 2000,
  ephemeral: true,

  data: new SlashCommandBuilder()
    .setName('dailyinteraction')
    .setDescription('Configure scheduled community questions, games, and challenges')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(subcommand => subcommand
      .setName('setup')
      .setDescription('Set the channel for daily community interactions')
      .addChannelOption(option => option
        .setName('channel')
        .setDescription('Channel where daily interactions are posted')
        .addChannelTypes(...textChannelTypes)
        .setRequired(true))
      .addRoleOption(option => option
        .setName('ping_role')
        .setDescription('Optional role to ping when an interaction is posted')))
    .addSubcommand(subcommand => subcommand
      .setName('enable')
      .setDescription('Enable scheduled daily interactions'))
    .addSubcommand(subcommand => subcommand
      .setName('disable')
      .setDescription('Disable scheduled daily interactions'))
    .addSubcommand(subcommand => subcommand
      .setName('schedule')
      .setDescription('Set the daily posting time')
      .addIntegerOption(option => option
        .setName('hour')
        .setDescription('Hour from 0 to 23')
        .setMinValue(0)
        .setMaxValue(23)
        .setRequired(true))
      .addIntegerOption(option => option
        .setName('minute')
        .setDescription('Minute from 0 to 59')
        .setMinValue(0)
        .setMaxValue(59)
        .setRequired(true))
      .addStringOption(option => option
        .setName('timezone')
        .setDescription('Optional IANA timezone, for example Europe/London')
        .setMaxLength(100)))
    .addSubcommand(subcommand => subcommand
      .setName('appearance')
      .setDescription('Set the daily interaction embed title and colour')
      .addStringOption(option => option
        .setName('title')
        .setDescription('Title shown before the activity type')
        .setMaxLength(120))
      .addStringOption(option => option
        .setName('color')
        .setDescription('Six-digit hex colour, for example #5865F2')
        .setMaxLength(7)))
    .addSubcommand(subcommand => subcommand
      .setName('ping-set')
      .setDescription('Set the role pinged for daily interactions')
      .addRoleOption(option => option
        .setName('role')
        .setDescription('Role to ping')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('ping-clear')
      .setDescription('Stop pinging a role for daily interactions'))
    .addSubcommand(subcommand => subcommand
      .setName('discussion')
      .setDescription('Enable or disable discussion-thread buttons')
      .addBooleanOption(option => option
        .setName('enabled')
        .setDescription('Whether members can open a discussion thread')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('type-enable')
      .setDescription('Enable an activity type')
      .addStringOption(option => option
        .setName('type')
        .setDescription('Activity type')
        .addChoices(...typeChoices())
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('type-disable')
      .setDescription('Disable an activity type')
      .addStringOption(option => option
        .setName('type')
        .setDescription('Activity type')
        .addChoices(...typeChoices())
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('type-weight')
      .setDescription('Set how often an enabled activity is chosen')
      .addStringOption(option => option
        .setName('type')
        .setDescription('Activity type')
        .addChoices(...typeChoices())
        .setRequired(true))
      .addIntegerOption(option => option
        .setName('weight')
        .setDescription('Higher values are chosen more often')
        .setMinValue(1)
        .setMaxValue(10)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('prompt-add')
      .setDescription('Add a custom prompt to an activity type')
      .addStringOption(option => option
        .setName('type')
        .setDescription('Activity type')
        .addChoices(...typeChoices())
        .setRequired(true))
      .addStringOption(option => option
        .setName('prompt')
        .setDescription('Prompt shown to the community')
        .setMaxLength(600)
        .setRequired(true))
      .addStringOption(option => option
        .setName('title')
        .setDescription('Optional title replacing the standard heading')
        .setMaxLength(120)))
    .addSubcommand(subcommand => subcommand
      .setName('prompt-remove')
      .setDescription('Remove one custom prompt')
      .addIntegerOption(option => option
        .setName('id')
        .setDescription('Custom prompt ID from prompt-list')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('prompt-toggle')
      .setDescription('Enable or disable one custom prompt')
      .addIntegerOption(option => option
        .setName('id')
        .setDescription('Custom prompt ID')
        .setRequired(true))
      .addBooleanOption(option => option
        .setName('enabled')
        .setDescription('Whether the prompt can be selected')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('prompt-list')
      .setDescription('View custom prompts')
      .addStringOption(option => option
        .setName('type')
        .setDescription('Optional activity type filter')
        .addChoices(...typeChoices())))
    .addSubcommand(subcommand => subcommand
      .setName('send-now')
      .setDescription('Post a real daily interaction now')
      .addStringOption(option => option
        .setName('type')
        .setDescription('Optional activity type')
        .addChoices(...typeChoices({ includeRandom: true }))))
    .addSubcommand(subcommand => subcommand
      .setName('test')
      .setDescription('Post a preview without using the prompt history')
      .addStringOption(option => option
        .setName('type')
        .setDescription('Optional activity type')
        .addChoices(...typeChoices({ includeRandom: true }))))
    .addSubcommand(subcommand => subcommand
      .setName('status')
      .setDescription('View daily interaction settings'))
    .addSubcommand(subcommand => subcommand
      .setName('theme-set')
      .setDescription('Assign one activity type to a weekday')
      .addStringOption(option => option
        .setName('day')
        .setDescription('Day of the week')
        .addChoices(...dayChoices())
        .setRequired(true))
      .addStringOption(option => option
        .setName('type')
        .setDescription('Activity type for this day')
        .addChoices(...typeChoices())
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('theme-clear')
      .setDescription('Return a weekday to weighted random activities')
      .addStringOption(option => option
        .setName('day')
        .setDescription('Day of the week')
        .addChoices(...dayChoices())
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('theme-list')
      .setDescription('View your weekly activity themes'))
    .addSubcommand(subcommand => subcommand
      .setName('leaderboard')
      .setDescription('View the most active daily-interaction members')
      .addIntegerOption(option => option
        .setName('limit')
        .setDescription('Number of members to show')
        .setMinValue(1)
        .setMaxValue(20)))
    .addSubcommand(subcommand => subcommand
      .setName('member-stats')
      .setDescription('View a member’s daily-interaction streak and activity')
      .addUserOption(option => option
        .setName('user')
        .setDescription('Member to view (defaults to you)')))
    .addSubcommand(subcommand => subcommand
      .setName('analytics')
      .setDescription('View daily-interaction engagement over the last 30 days')),

  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.editReply({ content: 'Manage Server permission is required.' });
    }

    const guildId = interaction.guild.id;
    const subcommand = interaction.options.getSubcommand();
    let config = getDailyInteractionConfig(guildId);

    if (!config) {
      getInteractionTypes(guildId);
      config = getDailyInteractionConfig(guildId);
    }

    if (subcommand === 'status') {
      return interaction.editReply({
        embeds: [statusEmbed(config, getInteractionTypes(guildId))],
        allowedMentions: { parse: [] }
      });
    }

    if (subcommand === 'theme-list') {
      return interaction.editReply({
        embeds: [themeEmbed(config, listDayThemes(guildId))],
        allowedMentions: { parse: [] }
      });
    }

    if (subcommand === 'leaderboard') {
      return interaction.editReply({
        embeds: [leaderboardEmbed(
          config,
          getEngagementLeaderboard(guildId, interaction.options.getInteger('limit') || 10)
        )],
        allowedMentions: { parse: [] }
      });
    }

    if (subcommand === 'member-stats') {
      const user = interaction.options.getUser('user') || interaction.user;
      return interaction.editReply({
        embeds: [memberStatsEmbed(config, user, getMemberEngagementStats(guildId, user.id))],
        allowedMentions: { users: [user.id], parse: [] }
      });
    }

    if (subcommand === 'analytics') {
      return interaction.editReply({
        embeds: [analyticsEmbed(config, getDailyInteractionAnalytics(guildId))],
        allowedMentions: { parse: [] }
      });
    }

    if (subcommand === 'setup') {
      const channel = interaction.options.getChannel('channel', true);
      const role = interaction.options.getRole('ping_role');
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

      updateDailyInteractionConfig(guildId, {
        channelId: channel.id,
        pingRoleId: role?.id || config?.pingRoleId || null,
        updatedBy: interaction.user.id
      });

      const threadReady = permissions.has([
        PermissionFlagsBits.CreatePublicThreads,
        PermissionFlagsBits.SendMessagesInThreads
      ]);

      return interaction.editReply({
        content: `Daily interactions will post in ${channel}. Use \`/dailyinteraction enable\` when you are ready.` +
          (threadReady
            ? ''
            : '\nFor answer submission and discussion threads, also give me Create Public Threads and Send Messages in Threads there.')
      });
    }

    if (subcommand === 'enable') {
      if (!config?.channelId) {
        return interaction.editReply({ content: 'Set a channel first with `/dailyinteraction setup`.' });
      }

      updateDailyInteractionConfig(guildId, { enabled: 1, updatedBy: interaction.user.id });
      return interaction.editReply({ content: `Daily interactions enabled for ${formatTime(config)}.` });
    }

    if (subcommand === 'disable') {
      updateDailyInteractionConfig(guildId, { enabled: 0, updatedBy: interaction.user.id });
      return interaction.editReply({ content: 'Daily interactions disabled.' });
    }

    if (subcommand === 'schedule') {
      const hour = interaction.options.getInteger('hour', true);
      const minute = interaction.options.getInteger('minute', true);
      const timezone = interaction.options.getString('timezone') || config?.timezone || DEFAULT_TIMEZONE;

      if (!validTimezone(timezone)) {
        return interaction.editReply({ content: 'Use an IANA timezone such as `Europe/London` or `America/New_York`.' });
      }

      updateDailyInteractionConfig(guildId, {
        hour,
        minute,
        timezone,
        updatedBy: interaction.user.id
      });

      return interaction.editReply({
        content: `Daily interaction time set to ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} (${timezone}).`
      });
    }

    if (subcommand === 'appearance') {
      const title = interaction.options.getString('title');
      const colorInput = interaction.options.getString('color');

      if (!title && !colorInput) {
        return interaction.editReply({ content: 'Provide a title, a colour, or both.' });
      }

      const color = parseEmbedColor(colorInput);
      if (color === null) {
        return interaction.editReply({ content: 'Use a six-digit hex colour such as `#5865F2`.' });
      }

      try {
        updateDailyInteractionConfig(guildId, {
          ...(title ? { titlePrefix: title } : {}),
          ...(colorInput ? { color } : {}),
          updatedBy: interaction.user.id
        });
      } catch (err) {
        return interaction.editReply({ content: err.message });
      }

      return interaction.editReply({ content: 'Daily interaction appearance updated.' });
    }

    if (subcommand === 'ping-set') {
      const role = interaction.options.getRole('role', true);
      if (role.id === interaction.guild.id || role.managed) {
        return interaction.editReply({ content: 'Choose a normal server role, not @everyone or an integration-managed role.' });
      }

      updateDailyInteractionConfig(guildId, { pingRoleId: role.id, updatedBy: interaction.user.id });
      return interaction.editReply({ content: `${role} will be pinged for daily interactions.` });
    }

    if (subcommand === 'ping-clear') {
      updateDailyInteractionConfig(guildId, { pingRoleId: null, updatedBy: interaction.user.id });
      return interaction.editReply({ content: 'Daily interactions will no longer ping a role.' });
    }

    if (subcommand === 'discussion') {
      const enabled = interaction.options.getBoolean('enabled', true);

      if (enabled && config?.channelId) {
        const channel = await interaction.guild.channels.fetch(config.channelId).catch(() => null);
        const permissions = channel?.permissionsFor(interaction.guild.members.me);

        if (!permissions?.has([
          PermissionFlagsBits.CreatePublicThreads,
          PermissionFlagsBits.SendMessagesInThreads
        ])) {
          return interaction.editReply({
            content: 'I need Create Public Threads and Send Messages in Threads in the configured channel before answer submission can be enabled.'
          });
        }
      }

      updateDailyInteractionConfig(guildId, { discussionEnabled: enabled ? 1 : 0, updatedBy: interaction.user.id });
      return interaction.editReply({
        content: `Discussion and answer buttons ${enabled ? 'enabled' : 'disabled'}.`
      });
    }

    if (subcommand === 'theme-set') {
      const dayOfWeek = Number(interaction.options.getString('day', true));
      const type = interaction.options.getString('type', true);
      setDayTheme({ guildId, dayOfWeek, type });

      return interaction.editReply({
        content: `${DAY_NAMES[dayOfWeek]} will use ${typeChoices().find(choice => choice.value === type).name}.`
      });
    }

    if (subcommand === 'theme-clear') {
      const dayOfWeek = Number(interaction.options.getString('day', true));
      const result = clearDayTheme(guildId, dayOfWeek);
      return interaction.editReply({
        content: result.changes
          ? `${DAY_NAMES[dayOfWeek]} will now use weighted random activities.`
          : `${DAY_NAMES[dayOfWeek]} was already using weighted random activities.`
      });
    }

    if (subcommand === 'type-enable' || subcommand === 'type-disable' || subcommand === 'type-weight') {
      const type = interaction.options.getString('type', true);
      const weight = interaction.options.getInteger('weight');
      updateInteractionType({
        guildId,
        type,
        ...(subcommand === 'type-enable' ? { enabled: true } : {}),
        ...(subcommand === 'type-disable' ? { enabled: false } : {}),
        ...(subcommand === 'type-weight' ? { weight } : {})
      });

      return interaction.editReply({
        content: subcommand === 'type-weight'
          ? `${typeChoices().find(choice => choice.value === type).name} weight set to ${weight}.`
          : `${typeChoices().find(choice => choice.value === type).name} ${subcommand === 'type-enable' ? 'enabled' : 'disabled'}.`
      });
    }

    if (subcommand === 'prompt-add') {
      let id;
      try {
        id = addCustomPrompt({
          guildId,
          type: interaction.options.getString('type', true),
          prompt: interaction.options.getString('prompt', true),
          title: interaction.options.getString('title'),
          createdBy: interaction.user.id
        });
      } catch (err) {
        return interaction.editReply({ content: err.message });
      }

      return interaction.editReply({ content: `Custom prompt #${id} added.` });
    }

    if (subcommand === 'prompt-remove') {
      const result = removeCustomPrompt(guildId, interaction.options.getInteger('id', true));
      return interaction.editReply({
        content: result.changes ? 'Custom prompt removed.' : 'Custom prompt not found.'
      });
    }

    if (subcommand === 'prompt-toggle') {
      const result = setCustomPromptEnabled({
        guildId,
        id: interaction.options.getInteger('id', true),
        enabled: interaction.options.getBoolean('enabled', true)
      });

      return interaction.editReply({
        content: result.changes ? 'Custom prompt updated.' : 'Custom prompt not found.'
      });
    }

    if (subcommand === 'prompt-list') {
      const type = interaction.options.getString('type');
      const prompts = listCustomPrompts(guildId, type).slice(0, 25);
      const description = prompts.length
        ? prompts.map(prompt => `**#${prompt.id} | ${prompt.type} | ${prompt.enabled ? 'Enabled' : 'Disabled'}**\n${truncate(prompt.prompt)}`).join('\n\n')
        : 'No custom prompts have been added.';

      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(Number(config?.color) || 0x5865F2)
          .setTitle('Custom Daily Interaction Prompts')
          .setDescription(description)
          .setFooter({ text: 'Showing up to 25 prompts' })
          .setTimestamp()]
      });
    }

    const type = interaction.options.getString('type') || 'RANDOM';
    const result = subcommand === 'test'
      ? await DailyInteractionService.test(interaction.client, guildId, type)
      : await DailyInteractionService.sendNow(interaction.client, guildId, type);

    return interaction.editReply({ content: resultMessage(result) });
  }
};
