const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType
} = require('discord.js');

const {
  get,
  run
} = require('../../database');

const {
  FACT_CATEGORIES,
  categoryName
} = require('../../utils/dailyFacts');

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
)

.addSubcommand(subcommand => {

  subcommand

    .setName('category')

    .setDescription(
      'Set the type of facts to post'
    );

  const option =
    optionBuilder =>

      optionBuilder

        .setName('category')

        .setDescription(
          'Random uses every approved and coded fact'
        )

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
        );

  return subcommand.addStringOption(
    option
  );
})

.addSubcommand(subcommand =>

  subcommand

    .setName('time')

    .setDescription(
      'Set posting time'
    )

    .addIntegerOption(option =>

      option

        .setName('hour')

        .setDescription(
          'Hour (0-23)'
        )

        .setMinValue(0)

        .setMaxValue(23)

        .setRequired(true)
    )

    .addIntegerOption(option =>

      option

        .setName('minute')

        .setDescription(
          'Minute (0-59)'
        )

        .setMinValue(0)

        .setMaxValue(59)

        .setRequired(true)
    )
)

.addSubcommand(subcommand =>

  subcommand

    .setName('settings')

    .setDescription(
      'View daily fact settings'
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

      config =
        get(

          `SELECT *
           FROM dailyfact_config
           WHERE guildId = ?`,

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

      if (!config?.channelId) {

        return interaction.editReply({

          content:
            'Set a Daily Fact channel first with `/dailyfact channel`.',

          allowedMentions: {
            parse: []
          }
        });
      }

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

    if (
      subcommand === 'category'
    ) {

      const category =
        interaction.options.getString(
          'category',
          true
        );

      run(

        `UPDATE dailyfact_config

         SET category = ?

         WHERE guildId = ?`,

        [
          category,
          guildId
        ]
      );

      return interaction.editReply({

        content:
          `✅ Daily fact category set to **${categoryName(category)}**.`,

        allowedMentions: {
          parse: []
        }
      });
    }

    if (
  subcommand === 'time'
) {

  const hour =
    interaction.options.getInteger(
      'hour'
    );

  const minute =
    interaction.options.getInteger(
      'minute'
    );

  run(

    `UPDATE dailyfact_config

     SET hour = ?,
         minute = ?

     WHERE guildId = ?`,

    [

      hour,
      minute,
      guildId
    ]
  );

  return interaction.editReply({

    content:
      `✅ Daily fact time set to ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,

    allowedMentions: {
      parse: []
    }
  });
}

if (
  subcommand === 'settings'
) {

  const current =
    get(

      `SELECT *
       FROM dailyfact_config
       WHERE guildId = ?`,

      [guildId]
    );

  return interaction.editReply({

    content:
      [
        `Enabled: **${current?.enabled ? 'Yes' : 'No'}**`,
        `Channel: ${current?.channelId ? `<#${current.channelId}>` : '**Not set**'}`,
        `Category: **${categoryName(current?.category || 'random')}**`,
        `Time: **${String(current?.hour ?? 12).padStart(2, '0')}:${String(current?.minute ?? 0).padStart(2, '0')}**`
      ].join('\n'),

    allowedMentions: {
      parse: []
    }
  });
}
  }
};
