const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType
} = require('discord.js');

const {
  get,
  run
} = require('../../database');

const {
  getChannel,
  getLatestUpload,
  isYouTubeConfigured
} = require('../../utils/youtube');

const {
  getUser
} = require('../../utils/twitch');

const {
  parseEmbedColor
} = require('../../utils/memberExperience');

function isValidTimezone(timezone) {
  try {
    Intl.DateTimeFormat('en-GB', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function formatQuietHours(start, end, timezone) {
  if (!Number.isInteger(start) || !Number.isInteger(end)) return 'Disabled';
  return `${String(start).padStart(2, '0')}:00-${String(end).padStart(2, '0')}:00 (${timezone})`;
}

module.exports = {

  cooldown: 3000,

  data: new SlashCommandBuilder()

    .setName('socialadd')

    .setDescription(
      'Add a social media notification'
    )

    .addStringOption(option =>
      option
        .setName('platform')
        .setDescription('Platform')
        .setRequired(true)
        .addChoices(
          { name: 'YouTube', value: 'youtube' },
          { name: 'Twitch', value: 'twitch' },
        )
    )

    .addStringOption(option =>
      option
        .setName('creator')
        .setDescription(
          'Channel name or URL'
        )
        .setRequired(true)
    )

    .addStringOption(option =>
      option
        .setName('content_type')
        .setDescription(
          'Content type'
        )
        .setRequired(true)
        .addChoices(
          { name: 'All', value: 'all' },
          { name: 'Videos', value: 'videos' },
          { name: 'Shorts', value: 'shorts' },
          { name: 'Streams', value: 'streams' }
        )
    )

    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription(
          'Notification channel'
        )
        .addChannelTypes(
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement
        )
        .setRequired(true)
    )

    .addRoleOption(option =>
      option
        .setName('role')
        .setDescription(
          'Optional ping role'
        )
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('message_template')
        .setDescription('Optional text: {creator}, {title}, {url}, {type}')
        .setMaxLength(500)
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('color')
        .setDescription('Optional six-digit embed colour, for example #5865F2')
        .setMaxLength(7)
        .setRequired(false)
    )
    .addIntegerOption(option =>
      option
        .setName('quiet_start')
        .setDescription('Optional quiet-hours start, 0 to 23')
        .setMinValue(0)
        .setMaxValue(23)
        .setRequired(false)
    )
    .addIntegerOption(option =>
      option
        .setName('quiet_end')
        .setDescription('Optional quiet-hours end, 0 to 23')
        .setMinValue(0)
        .setMaxValue(23)
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('timezone')
        .setDescription('Timezone for quiet hours, for example Europe/London')
        .setMaxLength(100)
        .setRequired(false)
    )
    .addBooleanOption(option => option
      .setName('clear_template')
      .setDescription('Remove the saved custom message template')
      .setRequired(false)
    )
    .addBooleanOption(option => option
      .setName('clear_color')
      .setDescription('Return the feed to its default embed colour')
      .setRequired(false)
    )
    .addBooleanOption(option => option
      .setName('disable_quiet_hours')
      .setDescription('Remove this feed’s quiet-hours schedule')
      .setRequired(false)
    ),

  async execute(interaction) {

    if (
      !interaction.memberPermissions.has(
        PermissionFlagsBits.ManageGuild
      )
    ) {

      return interaction.editReply({

        content:
          '❌ You need Manage Server permission.'
      });
    }

    try {

      const platform =
        interaction.options.getString(
          'platform'
        );

      const creator =
        interaction.options.getString(
          'creator'
        );

      const contentType =
        interaction.options.getString(
          'content_type'
        );

      if (
        platform === 'twitch'
        && !['all', 'streams'].includes(contentType)
      ) {
        return interaction.editReply({

          content:
            'Twitch feeds can only use All or Streams.'
        });
      }

      if (platform === 'youtube' && !isYouTubeConfigured()) {
        return interaction.editReply({
          content: 'YouTube feeds need `YOUTUBE_API_KEY` set in the host `.env` file. Add a valid YouTube Data API v3 key, then restart the bot.'
        });
      }

      const channel =
        interaction.options.getChannel(
          'channel'
        );

      const role =
        interaction.options.getRole(
          'role'
        );

      const templateInput = interaction.options.getString('message_template')?.trim() || null;
      const colorInput = interaction.options.getString('color');
      const colorInputValue = colorInput ? parseEmbedColor(colorInput) : null;
      const quietStartInput = interaction.options.getInteger('quiet_start');
      const quietEndInput = interaction.options.getInteger('quiet_end');
      const timezoneInput = interaction.options.getString('timezone');
      const clearTemplate = interaction.options.getBoolean('clear_template') === true;
      const clearColor = interaction.options.getBoolean('clear_color') === true;
      const disableQuietHours = interaction.options.getBoolean('disable_quiet_hours') === true;

      if (colorInput && colorInputValue === null) {
        return interaction.editReply({ content: 'Use a six-digit hex colour such as `#5865F2`.' });
      }

      if ((quietStartInput === null) !== (quietEndInput === null)) {
        return interaction.editReply({ content: 'Set both quiet_start and quiet_end, or leave both blank.' });
      }

      if ((quietStartInput !== null || quietEndInput !== null) && !isValidTimezone(timezoneInput || 'Europe/London')) {
        return interaction.editReply({ content: 'Use a valid IANA timezone such as `Europe/London`.' });
      }

      if (role && (role.managed || role.id === interaction.guild.roles.everyone.id)) {
        return interaction.editReply({ content: 'Choose a normal server role, not @everyone or an integration-managed role.' });
      }

      const botPermissions = channel.permissionsFor(interaction.guild.members.me);
      if (!botPermissions?.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks
      ])) {
        return interaction.editReply({ content: 'I need View Channel, Send Messages, and Embed Links in that channel.' });
      }

      if (role && !botPermissions.has(PermissionFlagsBits.MentionEveryone)) {
        return interaction.editReply({ content: 'I need Mention Everyone permission in that channel to ping the selected role.' });
      }

let creatorId = creator;
let creatorName = creator;
let lastItemId = null;

if (platform === 'youtube') {

  const channelInfo =
    await getChannel(creator);

  if (!channelInfo) {

    return interaction.editReply({

      content:
        '❌ Could not find that YouTube channel.'
    });
  }

  creatorId =
    channelInfo.id;

  creatorName =
    channelInfo.name;

  const latestUpload =
    await getLatestUpload(
      creatorId
    );

  if (latestUpload) {

    lastItemId =
      latestUpload.videoId;
  }

} else if (platform === 'twitch') {

  const user =
    await getUser(
      creator
    );

  if (!user) {

    return interaction.editReply({

      content:
        '❌ Could not find that Twitch channel.'
    });
  }

  creatorId =
    user.id;

  creatorName =
    user.display_name;
}

      const existing = get(
        `SELECT * FROM social_channels
         WHERE guildId = ? AND platform = ? AND creatorId = ? AND contentType = ?`,
        [interaction.guild.id, platform, creatorId, contentType]
      );

      const template = clearTemplate ? null : (templateInput ?? existing?.messageTemplate ?? null);
      const color = clearColor ? null : (colorInputValue ?? existing?.embedColor ?? null);
      const quietStart = disableQuietHours ? null : (quietStartInput ?? existing?.quietStartHour ?? null);
      const quietEnd = disableQuietHours ? null : (quietEndInput ?? existing?.quietEndHour ?? null);
      const effectiveTimezone = disableQuietHours
        ? null
        : (timezoneInput || existing?.timezone ||
          ((quietStart !== null || quietEnd !== null) ? 'Europe/London' : null));

      if (effectiveTimezone && !isValidTimezone(effectiveTimezone)) {
        return interaction.editReply({ content: 'Use a valid IANA timezone such as `Europe/London`.' });
      }

      run(

        `INSERT INTO social_channels (

          guildId,
          platform,
          creatorId,
          creatorName,
          contentType,
          targetChannelId,
          pingRoleId,
          lastItemId,
          initialized,
          addedAt,
          embedColor,
          messageTemplate,
          quietStartHour,
          quietEndHour,
          timezone

        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(guildId, platform, creatorId, contentType)
        DO UPDATE SET
          creatorName = excluded.creatorName,
          targetChannelId = excluded.targetChannelId,
          pingRoleId = excluded.pingRoleId,
          embedColor = excluded.embedColor,
          messageTemplate = excluded.messageTemplate,
          quietStartHour = excluded.quietStartHour,
          quietEndHour = excluded.quietEndHour,
          timezone = excluded.timezone`,

        [

          interaction.guild.id,

          platform,

          creatorId,

          creatorName,

          contentType,

          channel.id,

          role?.id || null,

          lastItemId,

          1,

          existing?.addedAt || Date.now(),

          color,

          template,

          quietStart,

          quietEnd,

          effectiveTimezone
        ]
      );

      const embed =
        new EmbedBuilder()

          .setColor(0x00AE86)

          .setTitle(
            '✅ Social Channel Added'
          )

          .addFields(

            {
              name: 'Platform',
              value: platform,
              inline: true
            },

            {
              name: 'Creator',
              value: creatorName,
              inline: true
            },

            {
              name: 'Content',
              value: contentType,
              inline: true
            },

            {
              name: 'Channel',
              value: `<#${channel.id}>`
            },

            {
              name: 'Ping Role',
              value:
                role
                  ? `<@&${role.id}>`
                  : 'None'
            },
            {
              name: 'Quiet Hours',
              value: formatQuietHours(quietStart, quietEnd, effectiveTimezone || 'Europe/London')
            },
            {
              name: 'Template',
              value: template ? 'Custom' : 'Default',
              inline: true
            }
          )

          .setFooter({

            text:
              existing
                ? 'Feed updated without resetting live or upload state'
                : 'Only future uploads will be announced'
          })

          .setTimestamp();

      await interaction.editReply({

        embeds: [embed]
      });

    } catch (err) {

      console.error(
        'SocialAdd Error:',
        err
      );

      await interaction.editReply({

        content:
          '❌ Failed to add social channel.'
      });
    }
  }
};
