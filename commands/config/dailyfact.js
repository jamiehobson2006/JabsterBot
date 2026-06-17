const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType
} = require('discord.js');

const {
  get,
  run
} = require('../../database');

module.exports = {

  ephemeral: true,

  data: new SlashCommandBuilder()

    .setName('dailyfact')

    .setDescription(
      'Configure daily facts'
    )

    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    )

    .addSubcommand(subcommand =>

      subcommand

        .setName('channel')

        .setDescription(
          'Set daily fact channel'
        )

        .addChannelOption(option =>

          option

            .setName('channel')

            .setDescription(
              'Channel to post facts in'
            )

            .addChannelTypes(
              ChannelType.GuildText
            )

            .setRequired(true)
        )
    )

    .addSubcommand(subcommand =>

      subcommand

        .setName('enable')

        .setDescription(
          'Enable daily facts'
        )
    )

    .addSubcommand(subcommand =>

      subcommand

        .setName('disable')

        .setDescription(
          'Disable daily facts'
        )
    ),

  async execute(
    interaction
  ) {

    const guildId =
      interaction.guild.id;

    const subcommand =
      interaction.options.getSubcommand();

    let config =
      get(

        `SELECT *
         FROM dailyfact_config
         WHERE guildId = ?`,

        [guildId]
      );

    if (!config) {

      run(

        `INSERT INTO dailyfact_config (
          guildId
        )
        VALUES (?)`,

        [guildId]
      );
    }

    if (
      subcommand === 'channel'
    ) {

      const channel =
        interaction.options.getChannel(
          'channel'
        );

      run(

        `UPDATE dailyfact_config

         SET channelId = ?

         WHERE guildId = ?`,

        [

          channel.id,
          guildId
        ]
      );

      return interaction.editReply({

        content:
          `✅ Daily fact channel set to ${channel}`,

        allowedMentions: {
          parse: []
        }
      });
    }

    if (
      subcommand === 'enable'
    ) {

      run(

        `UPDATE dailyfact_config

         SET enabled = 1

         WHERE guildId = ?`,

        [guildId]
      );

      return interaction.editReply({

        content:
          '✅ Daily facts enabled.',

        allowedMentions: {
          parse: []
        }
      });
    }

    if (
      subcommand === 'disable'
    ) {

      run(

        `UPDATE dailyfact_config

         SET enabled = 0

         WHERE guildId = ?`,

        [guildId]
      );

      return interaction.editReply({

        content:
          '✅ Daily facts disabled.',

        allowedMentions: {
          parse: []
        }
      });
    }
  }
};
