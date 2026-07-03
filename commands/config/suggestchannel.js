const {
  ChannelType,
  EmbedBuilder,
  PermissionsBitField,
  SlashCommandBuilder
} = require('discord.js');

const {
  get,
  run
} = require('../../database');

const textChannelTypes = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement
];

function getMissingPermissions(
  channel,
  botMember,
  {
    reactions = false
  } = {}
) {
  const permissions =
    [
      [
        PermissionsBitField.Flags.ViewChannel,
        'View Channel'
      ],
      [
        PermissionsBitField.Flags.SendMessages,
        'Send Messages'
      ],
      [
        PermissionsBitField.Flags.EmbedLinks,
        'Embed Links'
      ],
      [
        PermissionsBitField.Flags.ReadMessageHistory,
        'Read Message History'
      ]
    ];

  if (reactions) {
    permissions.push([
      PermissionsBitField.Flags.AddReactions,
      'Add Reactions'
    ]);
  }

  const channelPermissions =
    channel.permissionsFor(botMember);

  return permissions
    .filter(([flag]) =>
      !channelPermissions?.has(flag)
    )
    .map(([, name]) => name);
}

function validateChannel(
  channel,
  botMember,
  label,
  options
) {
  if (!channel) {
    return null;
  }

  if (!textChannelTypes.includes(channel.type)) {
    return `${label} must be a text or announcement channel.`;
  }

  const missing =
    getMissingPermissions(
      channel,
      botMember,
      options
    );

  if (missing.length) {
    return `${label} is missing: ${missing.join(', ')}`;
  }

  return null;
}

module.exports = {
  cooldown: 5000,
  ephemeral: true,

  data:
    new SlashCommandBuilder()
      .setName('suggestchannel')
      .setDescription('Configure suggestion channels')
      .addChannelOption(option =>
        option
          .setName('channel')
          .setDescription('Where new suggestions are posted')
          .addChannelTypes(...textChannelTypes)
          .setRequired(true)
      )
      .addChannelOption(option =>
        option
          .setName('accepted_channel')
          .setDescription('Optional channel for accepted suggestions')
          .addChannelTypes(...textChannelTypes)
          .setRequired(false)
      )
      .addChannelOption(option =>
        option
          .setName('denied_channel')
          .setDescription('Optional channel for denied suggestions')
          .addChannelTypes(...textChannelTypes)
          .setRequired(false)
      )
      .addBooleanOption(option =>
        option
          .setName('clear_accepted')
          .setDescription('Clear the accepted suggestion channel')
          .setRequired(false)
      )
      .addBooleanOption(option =>
        option
          .setName('clear_denied')
          .setDescription('Clear the denied suggestion channel')
          .setRequired(false)
      ),

  async execute(interaction) {
    try {
      if (
        !interaction.memberPermissions.has(
          PermissionsBitField.Flags.ManageGuild
        )
      ) {
        return interaction.editReply({
          content:
            'You need Manage Server permission.'
        });
      }

      const channel =
        interaction.options.getChannel(
          'channel',
          true
        );

      const acceptedChannel =
        interaction.options.getChannel(
          'accepted_channel',
          false
        );

      const deniedChannel =
        interaction.options.getChannel(
          'denied_channel',
          false
        );

      const clearAccepted =
        interaction.options.getBoolean(
          'clear_accepted'
        ) || false;

      const clearDenied =
        interaction.options.getBoolean(
          'clear_denied'
        ) || false;

      const existing =
        get(
          `SELECT acceptedSuggestionChannelId,
                  deniedSuggestionChannelId
           FROM guild_settings
           WHERE guildId = ?`,
          [interaction.guild.id]
        );

      const acceptedChannelId =
        clearAccepted
          ? null
          : acceptedChannel?.id ||
            existing?.acceptedSuggestionChannelId ||
            null;

      const deniedChannelId =
        clearDenied
          ? null
          : deniedChannel?.id ||
            existing?.deniedSuggestionChannelId ||
            null;

      const botMember =
        interaction.guild.members.me;

      const validationErrors =
        [
          validateChannel(
            channel,
            botMember,
            'Suggestion channel',
            {
              reactions: true
            }
          ),
          validateChannel(
            acceptedChannel,
            botMember,
            'Accepted suggestion channel'
          ),
          validateChannel(
            deniedChannel,
            botMember,
            'Denied suggestion channel'
          )
        ].filter(Boolean);

      if (validationErrors.length) {
        return interaction.editReply({
          content:
            validationErrors.join('\n')
        });
      }

      run(
        `INSERT INTO guild_settings
         (
           guildId,
           suggestionChannelId,
           acceptedSuggestionChannelId,
           deniedSuggestionChannelId
         )
         VALUES (?, ?, ?, ?)
         ON CONFLICT(guildId)
         DO UPDATE SET
           suggestionChannelId = excluded.suggestionChannelId,
           acceptedSuggestionChannelId = excluded.acceptedSuggestionChannelId,
           deniedSuggestionChannelId = excluded.deniedSuggestionChannelId`,
        [
          interaction.guild.id,
          channel.id,
          acceptedChannelId,
          deniedChannelId
        ]
      );

      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('Suggestions Enabled')
            .setDescription(
              'This channel is configured for new suggestions.'
            )
            .setFooter({
              text:
                `Configured by ${interaction.user.tag}`
            })
            .setTimestamp()
        ]
      }).catch(() => null);

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('Suggestion Channels Configured')
            .addFields(
              {
                name: 'New Suggestions',
                value: `${channel}`,
                inline: true
              },
              {
                name: 'Accepted',
                value:
                  clearAccepted
                    ? 'Fallback to suggestions'
                    : acceptedChannel
                    ? `${acceptedChannel}`
                    : acceptedChannelId
                      ? `<#${acceptedChannelId}>`
                      : 'Fallback to suggestions',
                inline: true
              },
              {
                name: 'Denied',
                value:
                  clearDenied
                    ? 'Fallback to suggestions'
                    : deniedChannel
                    ? `${deniedChannel}`
                    : deniedChannelId
                      ? `<#${deniedChannelId}>`
                      : 'Fallback to suggestions',
                inline: true
              }
            )
            .setTimestamp()
        ]
      });

    } catch (err) {
      console.error(
        'SuggestChannel Error:',
        err
      );

      return interaction.editReply({
        content:
          'Failed to set suggestion channels.'
      });
    }
  }
};
