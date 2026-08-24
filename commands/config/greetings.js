const {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');

const {
  all,
  get,
  run
} = require('../../database');

const {
  DEFAULT_COLOR,
  parseEmbedColor,
  validHttpsUrl
} = require('../../utils/memberExperience');

const textChannelTypes = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement
];

function typeChoice(type) {

  return {
    name: type === 'welcome' ? 'Welcome' : 'Goodbye',
    value: type
  };
}

function addGreetingOptions(subcommand) {

  return subcommand
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Channel to send the greeting')
        .addChannelTypes(...textChannelTypes)
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('mode')
        .setDescription('Use random built-in messages or your own message')
        .addChoices(
          { name: 'Random built-in messages', value: 'RANDOM' },
          { name: 'Custom message', value: 'CUSTOM' }
        )
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('message')
        .setDescription('Required for custom mode. Variables: {user}, {username}, {server}, {member_count}')
        .setMaxLength(4000)
    )
    .addBooleanOption(option =>
      option
        .setName('ping')
        .setDescription('Ping the member in the greeting')
    )
    .addStringOption(option =>
      option
        .setName('title')
        .setDescription('Optional embed title')
        .setMaxLength(256)
    )
    .addStringOption(option =>
      option
        .setName('color')
        .setDescription('Embed colour in hex, for example #5865F2')
        .setMaxLength(7)
    )
    .addStringOption(option =>
      option
        .setName('image_url')
        .setDescription('Optional HTTPS image for a branded greeting card')
        .setMaxLength(2000)
    );
}

function greetingSettingsEmbed(rows) {

  const settingsByType =
    new Map(rows.map(row => [row.type, row]));

  const fieldFor = type => {

    const setting =
      settingsByType.get(type);

    if (!setting?.enabled) {

      return 'Disabled';
    }

    return [
      `Channel: <#${setting.channelId}>`,
      `Mode: ${setting.mode === 'CUSTOM' ? 'Custom' : 'Random built-in'}`,
      `Ping: ${setting.ping ? 'Yes' : 'No'}`
    ].join('\n');
  };

  return new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('Greeting Settings')
    .addFields(
      {
        name: 'Welcome',
        value: fieldFor('welcome'),
        inline: true
      },
      {
        name: 'Goodbye',
        value: fieldFor('goodbye'),
        inline: true
      },
      {
        name: 'Milestones',
        value: settingsByType.get('milestone')?.enabled
          ? `Every ${settingsByType.get('milestone').milestoneInterval} members in <#${settingsByType.get('milestone').channelId}>`
          : 'Disabled',
        inline: true
      },
      {
        name: 'Message Variables',
        value: '`{user}`, `{username}`, `{server}`, `{member_count}`'
      }
    )
    .setTimestamp();
}

module.exports = {

  cooldown: 2500,
  ephemeral: true,

  data: new SlashCommandBuilder()
    .setName('greetings')
    .setDescription('Configure custom welcome and goodbye messages')
    .setDefaultMemberPermissions(
      PermissionFlagsBits.Administrator
    )
    .addSubcommand(subcommand =>
      addGreetingOptions(
        subcommand
          .setName('welcome')
          .setDescription('Configure welcome messages')
      )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('milestone-set')
        .setDescription('Celebrate every configured member milestone')
        .addChannelOption(option => option
          .setName('channel')
          .setDescription('Channel for milestone announcements')
          .addChannelTypes(...textChannelTypes)
          .setRequired(true))
        .addIntegerOption(option => option
          .setName('interval')
          .setDescription('Post every N members')
          .setMinValue(2)
          .setMaxValue(100000)
          .setRequired(true))
        .addStringOption(option => option
          .setName('message')
          .setDescription('Variables: {user}, {username}, {server}, {member_count}')
          .setMaxLength(4000)
          .setRequired(true))
        .addBooleanOption(option => option
          .setName('ping')
          .setDescription('Ping the member who triggered the milestone'))
        .addStringOption(option => option
          .setName('title')
          .setDescription('Optional embed title')
          .setMaxLength(256))
        .addStringOption(option => option
          .setName('color')
          .setDescription('Embed colour in hex, for example #5865F2')
          .setMaxLength(7))
        .addStringOption(option => option
          .setName('image_url')
          .setDescription('Optional HTTPS image for the milestone card')
          .setMaxLength(2000))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('milestone-disable')
        .setDescription('Disable member milestone announcements')
    )
    .addSubcommand(subcommand =>
      addGreetingOptions(
        subcommand
          .setName('goodbye')
          .setDescription('Configure goodbye messages')
      )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('disable')
        .setDescription('Disable a greeting type')
        .addStringOption(option =>
          option
            .setName('type')
            .setDescription('Greeting type to disable')
            .addChoices(
              typeChoice('welcome'),
              typeChoice('goodbye')
            )
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('status')
        .setDescription('View welcome and goodbye settings')
    ),

  async execute(interaction) {

    if (!interaction.memberPermissions?.has(
      PermissionFlagsBits.Administrator
    )) {

      return interaction.editReply({
        content: 'Administrator permission is required.'
      });
    }

    const subcommand =
      interaction.options.getSubcommand();

    if (subcommand === 'status') {

      const settings =
        all(
          `SELECT *
           FROM greeting_settings
           WHERE guildId = ?`,
          [interaction.guild.id]
        );

      return interaction.editReply({
        embeds: [greetingSettingsEmbed(settings)],
        allowedMentions: { parse: [] }
      });
    }

    if (subcommand === 'disable') {

      const type =
        interaction.options.getString('type', true);

      const existing =
        get(
          `SELECT *
           FROM greeting_settings
           WHERE guildId = ?
           AND type = ?`,
          [interaction.guild.id, type]
        );

      if (!existing) {

        return interaction.editReply({
          content: `No ${type} greeting has been configured.`
        });
      }

      run(
        `UPDATE greeting_settings
         SET enabled = 0,
             updatedBy = ?,
             updatedAt = ?
         WHERE guildId = ?
         AND type = ?`,
        [interaction.user.id, Date.now(), interaction.guild.id, type]
      );

      return interaction.editReply({
        content: `${type === 'welcome' ? 'Welcome' : 'Goodbye'} greetings disabled.`
      });
    }

    if (subcommand === 'milestone-disable') {
      const result = run(
        `UPDATE greeting_settings
         SET enabled = 0,
             updatedBy = ?,
             updatedAt = ?
         WHERE guildId = ?
         AND type = 'milestone'`,
        [interaction.user.id, Date.now(), interaction.guild.id]
      );

      return interaction.editReply({
        content: result.changes
          ? 'Member milestone announcements disabled.'
          : 'Member milestones have not been configured.'
      });
    }

    if (subcommand === 'milestone-set') {
      const channel = interaction.options.getChannel('channel', true);
      const interval = interaction.options.getInteger('interval', true);
      const message = interaction.options.getString('message', true).trim();
      const permissions = channel.permissionsFor(interaction.guild.members.me);

      if (![PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]
        .every(permission => permissions?.has(permission))) {
        return interaction.editReply({
          content: 'I need View Channel, Send Messages, and Embed Links in that channel.'
        });
      }

      const color = parseEmbedColor(interaction.options.getString('color'));
      if (color === null) {
        return interaction.editReply({ content: 'Use a six-digit hex colour such as `#5865F2`.' });
      }

      const imageInput = interaction.options.getString('image_url');
      const imageUrl = validHttpsUrl(imageInput);
      if (imageInput && !imageUrl) {
        return interaction.editReply({ content: 'The image URL must begin with `https://`.' });
      }

      run(
        `INSERT INTO greeting_settings (
           guildId, type, enabled, channelId, mode, customMessage,
           ping, title, color, imageUrl, milestoneInterval, updatedBy, updatedAt
         )
         VALUES (?, 'milestone', 1, ?, 'CUSTOM', ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(guildId, type)
         DO UPDATE SET enabled = excluded.enabled,
                       channelId = excluded.channelId,
                       mode = excluded.mode,
                       customMessage = excluded.customMessage,
                       ping = excluded.ping,
                       title = excluded.title,
                       color = excluded.color,
                       imageUrl = excluded.imageUrl,
                       milestoneInterval = excluded.milestoneInterval,
                       updatedBy = excluded.updatedBy,
                       updatedAt = excluded.updatedAt`,
        [
          interaction.guild.id,
          channel.id,
          message,
          interaction.options.getBoolean('ping') ? 1 : 0,
          interaction.options.getString('title') || null,
          color ?? DEFAULT_COLOR,
          imageUrl,
          interval,
          interaction.user.id,
          Date.now()
        ]
      );

      return interaction.editReply({
        content: `Member milestones will post in ${channel} every ${interval} members.`
      });
    }

    const type =
      subcommand;

    const channel =
      interaction.options.getChannel('channel', true);

    const mode =
      interaction.options.getString('mode', true);

    const customMessage =
      interaction.options.getString('message');

    if (mode === 'CUSTOM' && !customMessage?.trim()) {

      return interaction.editReply({
        content: 'A message is required when using custom mode.'
      });
    }

    const permissions =
      channel.permissionsFor(interaction.guild.members.me);

    const requiredPermissions = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks
    ];

    if (!requiredPermissions.every(permission => permissions?.has(permission))) {

      return interaction.editReply({
        content: 'I need View Channel, Send Messages, and Embed Links in that channel.'
      });
    }

    const color =
      parseEmbedColor(interaction.options.getString('color'));

    if (color === null) {

      return interaction.editReply({
        content: 'Use a six-digit hex colour such as `#5865F2`.'
      });
    }

    const imageInput = interaction.options.getString('image_url');
    const imageUrl = validHttpsUrl(imageInput);

    if (imageInput && !imageUrl) {
      return interaction.editReply({
        content: 'The image URL must begin with `https://`.'
      });
    }

    run(
      `INSERT INTO greeting_settings (
         guildId, type, enabled, channelId, mode, customMessage,
         ping, title, color, imageUrl, updatedBy, updatedAt
       )
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(guildId, type)
       DO UPDATE SET
         enabled = excluded.enabled,
         channelId = excluded.channelId,
         mode = excluded.mode,
         customMessage = excluded.customMessage,
         ping = excluded.ping,
          title = excluded.title,
          color = excluded.color,
          imageUrl = excluded.imageUrl,
         updatedBy = excluded.updatedBy,
         updatedAt = excluded.updatedAt`,
      [
        interaction.guild.id,
        type,
        channel.id,
        mode,
        mode === 'CUSTOM' ? customMessage.trim() : null,
        interaction.options.getBoolean('ping') ? 1 : 0,
        interaction.options.getString('title') || null,
        color ?? DEFAULT_COLOR,
        imageUrl,
        interaction.user.id,
        Date.now()
      ]
    );

    return interaction.editReply({
      content: `${type === 'welcome' ? 'Welcome' : 'Goodbye'} greetings enabled in ${channel} using ${mode === 'CUSTOM' ? 'your custom message' : 'rotating built-in messages'}.`,
      allowedMentions: { parse: [] }
    });
  }
};
