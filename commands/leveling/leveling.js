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

module.exports = {

  cooldown: 3000,

  data: new SlashCommandBuilder()

    .setName('leveling')

    .setDescription(
      'Configure the leveling system'
    )

    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    )

    .addSubcommand(subcommand =>

      subcommand

        .setName('settings')

        .setDescription(
          'View leveling settings'
        )
    )

    .addSubcommand(subcommand =>

      subcommand

        .setName('enable')

        .setDescription(
          'Enable leveling'
        )
    )

    .addSubcommand(subcommand =>

      subcommand

        .setName('disable')

        .setDescription(
          'Disable leveling'
        )
    )

    .addSubcommand(subcommand =>

      subcommand

        .setName('xp')

        .setDescription(
          'Set XP range'
        )

        .addIntegerOption(option =>
          option

            .setName('min')

            .setDescription(
              'Minimum XP'
            )

            .setMinValue(1)

            .setRequired(true)
        )

        .addIntegerOption(option =>
          option

            .setName('max')

            .setDescription(
              'Maximum XP'
            )

            .setMinValue(1)

            .setRequired(true)
        )
    )

    .addSubcommand(subcommand =>

      subcommand

        .setName('cooldown')

        .setDescription(
          'Set XP cooldown'
        )

        .addIntegerOption(option =>
          option

            .setName('seconds')

            .setDescription(
              'Cooldown in seconds'
            )

            .setMinValue(0)

            .setRequired(true)
        )
    )

    .addSubcommand(subcommand =>

      subcommand

        .setName('channel')

        .setDescription(
          'Set level-up channel'
        )

        .addChannelOption(option =>
          option

            .setName('channel')

            .setDescription(
              'Level-up channel'
            )

            .addChannelTypes(
              ChannelType.GuildText
            )

            .setRequired(true)
        )
    )

  .addSubcommand(subcommand =>

  subcommand

    .setName('message')

    .setDescription(
      'Set level-up message'
    )

    .addStringOption(option =>
      option

        .setName('text')

        .setDescription(
          'Custom message'
        )

        .setMaxLength(500)

        .setRequired(true)
    )
)

.addSubcommand(subcommand =>

  subcommand

    .setName('ignore-channel-add')

    .setDescription(
      'Add an ignored channel'
    )

    .addChannelOption(option =>

      option

        .setName('channel')

        .setDescription(
          'Channel to ignore'
        )

        .addChannelTypes(
          ChannelType.GuildText
        )

        .setRequired(true)
    )
)

.addSubcommand(subcommand =>

  subcommand

    .setName('ignore-channel-list')

    .setDescription(
      'View ignored channels'
    )
)

,

    

  async execute(interaction) {

    const guildId =
      interaction.guild.id;

    const subcommand =
      interaction.options.getSubcommand();

    let config =
      get(

        `SELECT *
         FROM leveling_config
         WHERE guildId = ?`,

        [guildId]
      );

    if (!config) {

      run(

        `INSERT INTO leveling_config (
          guildId
        )
        VALUES (?)`,

        [guildId]
      );

      config =
        get(

          `SELECT *
           FROM leveling_config
           WHERE guildId = ?`,

          [guildId]
        );
    }

    if (
      subcommand === 'settings'
    ) {

      const embed =
        new EmbedBuilder()

          .setColor(
            0x5865F2
          )

          .setTitle(
            '⚙️ Leveling Settings'
          )

          .addFields(

            {
              name: 'Status',
              value:
                config.enabled
                  ? '✅ Enabled'
                  : '❌ Disabled',
              inline: true
            },

            {
              name: 'XP Range',
              value:
                `${config.xpMin} - ${config.xpMax}`,
              inline: true
            },

            {
              name: 'Cooldown',
              value:
                `${config.cooldown}s`,
              inline: true
            },

            {
              name: 'Level Channel',
              value:
                config.levelChannelId
                  ? `<#${config.levelChannelId}>`
                  : 'Not Set'
            },

            {
              name: 'Level Message',
              value:
                config.levelMessage ||
                '🎉 {user} reached level **{level}**!'
            }
          )

          .setFooter({

            text:
              'Jabster Studios Leveling'
          })

          .setTimestamp();

      return interaction.editReply({

        embeds: [embed]
      });
    }

    if (
      subcommand === 'enable'
    ) {

      run(

        `UPDATE leveling_config
         SET enabled = 1
         WHERE guildId = ?`,

        [guildId]
      );

      return interaction.editReply({

        content:
          '✅ Leveling enabled.'
      });
    }

    if (
      subcommand === 'disable'
    ) {

      run(

        `UPDATE leveling_config
         SET enabled = 0
         WHERE guildId = ?`,

        [guildId]
      );

      return interaction.editReply({

        content:
          '✅ Leveling disabled.'
      });
    }

    if (
      subcommand === 'xp'
    ) {

      const min =
        interaction.options.getInteger(
          'min'
        );

      const max =
        interaction.options.getInteger(
          'max'
        );

      if (min > max) {

        return interaction.editReply({

          content:
            '❌ Minimum XP cannot be greater than maximum XP.'
        });
      }

      run(

        `UPDATE leveling_config

         SET

         xpMin = ?,
         xpMax = ?

         WHERE guildId = ?`,

        [

          min,
          max,

          guildId
        ]
      );

      return interaction.editReply({

        content:
          `✅ XP range updated to **${min}-${max}**.`
      });
    }

    if (
      subcommand === 'cooldown'
    ) {

      const seconds =
        interaction.options.getInteger(
          'seconds'
        );

      run(

        `UPDATE leveling_config

         SET cooldown = ?

         WHERE guildId = ?`,

        [

          seconds,
          guildId
        ]
      );

      return interaction.editReply({

        content:
          `✅ Cooldown updated to **${seconds}s**.`
      });
    }

if (
  subcommand === 'channel'
) {

  const channel =
    interaction.options.getChannel(
      'channel'
    );

  run(

    `UPDATE leveling_config

     SET levelChannelId = ?

     WHERE guildId = ?`,

    [

      channel.id,
      guildId
    ]
  );

  return interaction.editReply({

    content:
      `✅ Level-up channel set to ${channel}.`
  });
}

if (
  subcommand === 'message'
) {

  const text =
    interaction.options.getString(
      'text'
    );

  run(

    `UPDATE leveling_config

     SET levelMessage = ?

     WHERE guildId = ?`,

    [

      text,
      guildId
    ]
  );

  return interaction.editReply({

    embeds: [

      new EmbedBuilder()

        .setColor(
          0x57F287
        )

        .setTitle(
          '✅ Level Message Updated'
        )

        .setDescription(text)

        .addFields({

          name:
            'Available Variables',

          value:
            '`{user}` `{level}`'
        })
    ]
  });
}

if (
  subcommand ===
  'ignore-channel-add'
) {

  const channel =
    interaction.options.getChannel(
      'channel'
    );

  const ignored =
    config.ignoredChannels
      ? config.ignoredChannels
          .split(',')
          .filter(Boolean)
      : [];

  if (
    ignored.includes(
      channel.id
    )
  ) {

    return interaction.editReply({

      content:
        '❌ Channel is already ignored.'
    });
  }

  ignored.push(
    channel.id
  );

  run(

    `UPDATE leveling_config

     SET ignoredChannels = ?

     WHERE guildId = ?`,

    [

      ignored.join(','),
      guildId
    ]
  );

  return interaction.editReply({

    content:
      `✅ ${channel} is now ignored for XP.`
  });
}

if (
  subcommand ===
  'ignore-channel-list'
) {

  const ignored =
    config.ignoredChannels
      ? config.ignoredChannels
          .split(',')
          .filter(Boolean)
      : [];

  if (
    ignored.length === 0
  ) {

    return interaction.editReply({

      content:
        '❌ No ignored channels configured.'
    });
  }

  const channels =
    ignored.map(
      id => `<#${id}>`
    );

  return interaction.editReply({

    embeds: [

      new EmbedBuilder()

        .setColor(
          0x5865F2
        )

        .setTitle(
          '🚫 Ignored Channels'
        )

        .setDescription(
          channels.join('\n')
        )
    ]
  });
}
 
  }
};
