const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} = require('discord.js');

const {
  run
} = require('../../database');

const {
  getChannel,
  getLatestUpload
} = require('../../utils/youtube');

const {
  getUser
} = require('../../utils/twitch');

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
        .setRequired(true)
    )

    .addRoleOption(option =>
      option
        .setName('role')
        .setDescription(
          'Optional ping role'
        )
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

      const channel =
        interaction.options.getChannel(
          'channel'
        );

      const role =
        interaction.options.getRole(
          'role'
        );

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

      run(

        `INSERT OR REPLACE INTO social_channels (

          guildId,
          platform,
          creatorId,
          creatorName,
          contentType,
          targetChannelId,
          pingRoleId,
          lastItemId,
          initialized,
          addedAt

        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

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

          Date.now()
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
            }
          )

          .setFooter({

            text:
              'Only future uploads will be announced'
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