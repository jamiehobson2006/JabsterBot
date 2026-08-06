const {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');

const {
  get,
  run
} = require('../../database');

const DailyFactService =
  require('../../services/DailyFactService');

const {
  FACT_CATEGORIES,
  categoryName
} = require('../../utils/dailyFacts');

const DEFAULT_TIMEZONE =
  'Europe/London';

function validTimezone(timezone) {

  try {

    Intl.DateTimeFormat(
      'en-GB',
      { timeZone: timezone }
    );

    return true;

  } catch {

    return false;
  }
}

function ensureConfig(guildId) {

  let config =
    get(
      `SELECT *
       FROM dailyfact_config
       WHERE guildId = ?`,
      [guildId]
    );

  if (config) {

    return config;
  }

  run(
    `INSERT INTO dailyfact_config (guildId)
     VALUES (?)`,
    [guildId]
  );

  config =
    get(
      `SELECT *
       FROM dailyfact_config
       WHERE guildId = ?`,
      [guildId]
    );

  return config;
}

function safeReply(
  interaction,
  content
) {

  return interaction.editReply({
    content,
    allowedMentions: {
      parse: []
    }
  });
}

module.exports = {

  ephemeral: true,

  data: new SlashCommandBuilder()
    .setName('dailyfact')
    .setDescription('Configure Daily Facts')
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('channel')
        .setDescription('Set the Daily Fact channel')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Channel to post facts in')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('enable')
        .setDescription('Enable scheduled Daily Facts')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('disable')
        .setDescription('Disable scheduled Daily Facts')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('category')
        .setDescription('Set the type of facts to post')
        .addStringOption(option =>
          option
            .setName('category')
            .setDescription('Random uses every approved and coded fact')
            .setRequired(true)
            .addChoices(
              {
                name: 'Random / All Facts',
                value: 'random'
              },
              ...FACT_CATEGORIES.map(category => ({
                name: category.name,
                value: category.value
              }))
            )
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('time')
        .setDescription('Set the Daily Fact posting time')
        .addIntegerOption(option =>
          option
            .setName('hour')
            .setDescription('Hour from 0 to 23')
            .setMinValue(0)
            .setMaxValue(23)
            .setRequired(true)
        )
        .addIntegerOption(option =>
          option
            .setName('minute')
            .setDescription('Minute from 0 to 59')
            .setMinValue(0)
            .setMaxValue(59)
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('timezone')
            .setDescription('Optional IANA timezone, for example Europe/London')
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('force')
        .setDescription('Post an approved community fact now')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('settings')
        .setDescription('View Daily Fact settings')
    ),

  async execute(interaction) {

    const guildId =
      interaction.guild.id;

    const subcommand =
      interaction.options.getSubcommand();

    const config =
      ensureConfig(guildId);

    if (subcommand === 'channel') {

      const channel =
        interaction.options.getChannel('channel', true);

      run(
        `UPDATE dailyfact_config
         SET channelId = ?
         WHERE guildId = ?`,
        [channel.id, guildId]
      );

      return safeReply(
        interaction,
        `Daily Fact channel set to ${channel}.`
      );
    }

    if (subcommand === 'enable') {

      if (!config.channelId) {

        return safeReply(
          interaction,
          'Set a Daily Fact channel first with `/dailyfact channel`.'
        );
      }

      run(
        `UPDATE dailyfact_config
         SET enabled = 1
         WHERE guildId = ?`,
        [guildId]
      );

      return safeReply(
        interaction,
        'Daily Facts enabled.'
      );
    }

    if (subcommand === 'disable') {

      run(
        `UPDATE dailyfact_config
         SET enabled = 0
         WHERE guildId = ?`,
        [guildId]
      );

      return safeReply(
        interaction, 'Daily Facts disabled.'
      );
    }

    if (subcommand === 'category') {

      const category =
        interaction.options.getString('category', true);

      run(
        `UPDATE dailyfact_config
         SET category = ?
         WHERE guildId = ?`,
        [category, guildId]
      );

      return safeReply(
        interaction,
        `Daily Fact category set to **${categoryName(category)}**.`
      );
    }

    if (subcommand === 'time') {

      const hour =
        interaction.options.getInteger('hour', true);

      const minute =
        interaction.options.getInteger('minute', true);

      const timezone =
        interaction.options.getString('timezone') ||
        config.timezone ||
        DEFAULT_TIMEZONE;

      if (!validTimezone(timezone)) {

        return safeReply(
          interaction,
          'Use an IANA timezone such as `Europe/London` or `America/New_York`.'
        );
      }

      run(
        `UPDATE dailyfact_config
         SET hour = ?,
             minute = ?,
             timezone = ?
         WHERE guildId = ?`,
        [hour, minute, timezone, guildId]
      );

      return safeReply(
        interaction,
        `Daily Fact time set to ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} (${timezone}).`
      );
    }

    if (subcommand === 'force') {

      const result =
        await DailyFactService.forceCommunityFact(
          interaction.client,
          guildId
        );

      const messages = {
        'sent': 'Approved community fact posted.',
        'missing-channel': 'Set a Daily Fact channel first with `/dailyfact channel`.',
        'no-eligible-facts': 'There are no approved community facts available, or every one was shown in this server within the last 30 days.',
        'already-delivered': 'That fact was just posted. Run `/dailyfact force` again.'
      };

      return safeReply(
        interaction,
        messages[result.status] ||
          'Could not post an approved community fact right now.'
      );
    }

    const current =
      ensureConfig(guildId);

    return safeReply(
      interaction,
      [
        `Enabled: **${current.enabled ? 'Yes' : 'No'}**`,
        `Channel: ${current.channelId ? `<#${current.channelId}>` : '**Not set**'}`,
        `Category: **${categoryName(current.category || 'random')}**`,
        `Time: **${String(current.hour ?? 12).padStart(2, '0')}:${String(current.minute ?? 0).padStart(2, '0')}**`,
        `Timezone: **${current.timezone || DEFAULT_TIMEZONE}**`,
        'Rotation: **Facts are not repeated in this server for 30 days.**'
      ].join('\n')
    );
  }
};
