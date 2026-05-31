const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require('discord.js');

const {
  run
} = require('../../database');

const {
  getChannel
} = require('../../utils/youtube');

module.exports = {

  cooldown: 3000,

  data: new SlashCommandBuilder()

    .setName('socialremove')

    .setDescription(
      'Remove a social feed'
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
        .setDescription('Creator')
        .setRequired(true)
    )

    .addStringOption(option =>
      option
        .setName('content_type')
        .setDescription('Content Type')
        .setRequired(true)
        .addChoices(
          { name: 'All', value: 'all' },
          { name: 'Videos', value: 'videos' },
          { name: 'Shorts', value: 'shorts' },
          { name: 'Streams', value: 'streams' }
        )
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

      let creatorId = creator;

      if (platform === 'youtube') {

        const channelInfo =
          await getChannel(
            creator
          );

        if (!channelInfo) {

          return interaction.editReply({

            content:
              '❌ Could not find that YouTube channel.'
          });
        }

        creatorId =
          channelInfo.id;
      }

      run(

        `DELETE FROM social_channels

         WHERE guildId = ?
         AND platform = ?
         AND creatorId = ?
         AND contentType = ?`,

        [

          interaction.guild.id,

          platform,

          creatorId,

          contentType
        ]
      );

      await interaction.editReply({

        content:
          `✅ Removed ${creator}`
      });

    } catch (err) {

      console.error(
        'SocialRemove Error:',
        err
      );

      await interaction.editReply({

        content:
          '❌ Failed to remove social feed.'
      });
    }
  }
};