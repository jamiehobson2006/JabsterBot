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

const {
  BUTTON_STYLES,
  buildVerificationPanel,
  parseEmbedColor,
  validHttpsUrl
} = require('../../utils/memberExperience');

const textChannelTypes = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement
];

function canManageRole(guild, role) {

  const botMember =
    guild.members.me;

  return Boolean(
    role &&
    !role.managed &&
    botMember &&
    botMember.permissions.has(
      PermissionFlagsBits.ManageRoles
    ) &&
    role.position < botMember.roles.highest.position
  );
}

async function disablePreviousPanel(
  client,
  settings
) {

  if (!settings?.channelId || !settings?.messageId) {

    return;
  }

  const channel =
    await client.channels.fetch(settings.channelId)
      .catch(() => null);

  const message =
    await channel?.messages.fetch(settings.messageId)
      .catch(() => null);

  await message?.edit({ components: [] })
    .catch(() => null);
}

module.exports = {

  cooldown: 3000,
  ephemeral: true,

  data: new SlashCommandBuilder()
    .setName('verification')
    .setDescription('Configure member verification')
    .setDefaultMemberPermissions(
      PermissionFlagsBits.Administrator
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('setup')
        .setDescription('Create a customizable verification panel')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Channel for the verification panel')
            .addChannelTypes(...textChannelTypes)
            .setRequired(true)
        )
        .addRoleOption(option =>
          option
            .setName('verified_role')
            .setDescription('Role given after verification')
            .setRequired(true)
        )
        .addRoleOption(option =>
          option
            .setName('unverified_role')
            .setDescription('Optional role removed after verification')
        )
        .addIntegerOption(option =>
          option
            .setName('minimum_account_age_days')
            .setDescription('Minimum Discord account age in days')
            .setMinValue(0)
            .setMaxValue(365)
        )
        .addStringOption(option =>
          option
            .setName('title')
            .setDescription('Embed title')
            .setMaxLength(256)
        )
        .addStringOption(option =>
          option
            .setName('description')
            .setDescription('Embed description')
            .setMaxLength(4000)
        )
        .addStringOption(option =>
          option
            .setName('button_label')
            .setDescription('Verification button text')
            .setMaxLength(80)
        )
        .addStringOption(option =>
          option
            .setName('button_emoji')
            .setDescription('Optional Unicode or custom emoji')
            .setMaxLength(100)
        )
        .addStringOption(option =>
          option
            .setName('button_style')
            .setDescription('Verification button colour')
            .addChoices(
              ...Object.keys(BUTTON_STYLES).map(style => ({
                name: style,
                value: style
              }))
            )
        )
        .addStringOption(option =>
          option
            .setName('color')
            .setDescription('Embed colour in hex, for example #5865F2')
            .setMaxLength(7)
        )
        .addStringOption(option =>
          option
            .setName('thumbnail_url')
            .setDescription('Optional HTTPS thumbnail image URL')
            .setMaxLength(1000)
        )
        .addStringOption(option =>
          option
            .setName('image_url')
            .setDescription('Optional HTTPS full-width image URL')
            .setMaxLength(1000)
        )
        .addStringOption(option =>
          option
            .setName('footer')
            .setDescription('Optional embed footer')
            .setMaxLength(2048)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('status')
        .setDescription('View verification settings')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('disable')
        .setDescription('Disable the current verification panel')
    ),

  async execute(interaction) {

    if (!interaction.memberPermissions?.has(
      PermissionFlagsBits.Administrator
    )) {

      return interaction.editReply({
        content: 'Administrator permission is required.'
      });
    }

    const guildId =
      interaction.guild.id;

    const subcommand =
      interaction.options.getSubcommand();

    const existing =
      get(
        `SELECT *
         FROM verification_settings
         WHERE guildId = ?`,
        [guildId]
      );

    if (subcommand === 'status') {

      if (!existing) {

        return interaction.editReply({
          content: 'Verification has not been configured.'
        });
      }

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(existing.enabled ? 0x57F287 : 0xED4245)
            .setTitle('Verification Settings')
            .addFields(
              {
                name: 'Status',
                value: existing.enabled ? 'Enabled' : 'Disabled',
                inline: true
              },
              {
                name: 'Channel',
                value: existing.channelId ? `<#${existing.channelId}>` : 'Not set',
                inline: true
              },
              {
                name: 'Verified Role',
                value: existing.verifiedRoleId ? `<@&${existing.verifiedRoleId}>` : 'Not set',
                inline: true
              },
              {
                name: 'Unverified Role',
                value: existing.unverifiedRoleId ? `<@&${existing.unverifiedRoleId}>` : 'Not used',
                inline: true
              },
              {
                name: 'Account Age',
                value: `${existing.minimumAccountAgeDays || 0} day(s)`,
                inline: true
              },
              {
                name: 'Panel Message',
                value: existing.messageId ? `\`${existing.messageId}\`` : 'Not set',
                inline: true
              }
            )
            .setTimestamp(existing.updatedAt || Date.now())
        ],
        allowedMentions: { parse: [] }
      });
    }

    if (subcommand === 'disable') {

      if (!existing) {

        return interaction.editReply({
          content: 'Verification has not been configured.'
        });
      }

      run(
        `UPDATE verification_settings
         SET enabled = 0,
             updatedBy = ?,
             updatedAt = ?
         WHERE guildId = ?`,
        [interaction.user.id, Date.now(), guildId]
      );

      await disablePreviousPanel(interaction.client, existing);

      return interaction.editReply({
        content: 'Verification has been disabled.'
      });
    }

    const channel =
      interaction.options.getChannel('channel', true);

    const verifiedRole =
      interaction.options.getRole('verified_role', true);

    const unverifiedRole =
      interaction.options.getRole('unverified_role');

    if (!textChannelTypes.includes(channel.type)) {

      return interaction.editReply({
        content: 'Choose a text or announcement channel.'
      });
    }

    if (!canManageRole(interaction.guild, verifiedRole)) {

      return interaction.editReply({
        content: 'The verified role must be a normal role below my highest role.'
      });
    }

    if (unverifiedRole && !canManageRole(interaction.guild, unverifiedRole)) {

      return interaction.editReply({
        content: 'The unverified role must be a normal role below my highest role.'
      });
    }

    if (verifiedRole.id === unverifiedRole?.id) {

      return interaction.editReply({
        content: 'Choose different verified and unverified roles.'
      });
    }

    const permissions =
      channel.permissionsFor(interaction.guild.members.me);

    const requiredPermissions = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.ReadMessageHistory
    ];

    if (!requiredPermissions.every(permission => permissions?.has(permission))) {

      return interaction.editReply({
        content: 'I need View Channel, Send Messages, Embed Links, and Read Message History there.'
      });
    }

    const color =
      parseEmbedColor(interaction.options.getString('color'));

    if (color === null) {

      return interaction.editReply({
        content: 'Use a six-digit hex colour such as `#5865F2`.'
      });
    }

    const thumbnailUrl =
      validHttpsUrl(interaction.options.getString('thumbnail_url'));

    const imageUrl =
      validHttpsUrl(interaction.options.getString('image_url'));

    if (
      (interaction.options.getString('thumbnail_url') && !thumbnailUrl) ||
      (interaction.options.getString('image_url') && !imageUrl)
    ) {

      return interaction.editReply({
        content: 'Image URLs must use HTTPS.'
      });
    }

    const settings = {
      guildId,
      enabled: 1,
      channelId: channel.id,
      verifiedRoleId: verifiedRole.id,
      unverifiedRoleId: unverifiedRole?.id || null,
      minimumAccountAgeDays: interaction.options.getInteger('minimum_account_age_days') || 0,
      title: interaction.options.getString('title') || 'Verify Your Account',
      description: interaction.options.getString('description') || 'Click the button below to verify.',
      buttonLabel: interaction.options.getString('button_label') || 'Verify',
      buttonEmoji: interaction.options.getString('button_emoji') || null,
      buttonStyle: interaction.options.getString('button_style') || 'Success',
      color,
      thumbnailUrl,
      imageUrl,
      footer: interaction.options.getString('footer') || null
    };

    let panel;

    try {

      panel = await channel.send(buildVerificationPanel(settings));

    } catch (err) {

      console.error('Verification panel send error:', err);

      return interaction.editReply({
        content: 'I could not create that panel. Check my channel permissions and button emoji.'
      });
    }

    run(
      `INSERT INTO verification_settings (
         guildId, enabled, channelId, messageId, verifiedRoleId,
         unverifiedRoleId, minimumAccountAgeDays, title, description,
         buttonLabel, buttonEmoji, buttonStyle, color, thumbnailUrl,
         imageUrl, footer, updatedBy, updatedAt
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(guildId)
       DO UPDATE SET
         enabled = excluded.enabled,
         channelId = excluded.channelId,
         messageId = excluded.messageId,
         verifiedRoleId = excluded.verifiedRoleId,
         unverifiedRoleId = excluded.unverifiedRoleId,
         minimumAccountAgeDays = excluded.minimumAccountAgeDays,
         title = excluded.title,
         description = excluded.description,
         buttonLabel = excluded.buttonLabel,
         buttonEmoji = excluded.buttonEmoji,
         buttonStyle = excluded.buttonStyle,
         color = excluded.color,
         thumbnailUrl = excluded.thumbnailUrl,
         imageUrl = excluded.imageUrl,
         footer = excluded.footer,
         updatedBy = excluded.updatedBy,
         updatedAt = excluded.updatedAt`,
      [
        settings.guildId,
        settings.enabled,
        settings.channelId,
        panel.id,
        settings.verifiedRoleId,
        settings.unverifiedRoleId,
        settings.minimumAccountAgeDays,
        settings.title,
        settings.description,
        settings.buttonLabel,
        settings.buttonEmoji,
        settings.buttonStyle,
        settings.color,
        settings.thumbnailUrl,
        settings.imageUrl,
        settings.footer,
        interaction.user.id,
        Date.now()
      ]
    );

    await disablePreviousPanel(interaction.client, existing);

    return interaction.editReply({
      content: `Verification panel created in ${channel}.`,
      allowedMentions: { parse: [] }
    });
  }
};
