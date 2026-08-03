const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} = require('discord.js');

const {
  run,
  get,
  all
} = require('../../database');

module.exports = {

  cooldown: 3000,

  data: new SlashCommandBuilder()

    .setName('levelreward')

    .setDescription(
      'Manage level rewards'
    )

    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    )

    .addSubcommand(subcommand =>

      subcommand

        .setName('add')

        .setDescription(
          'Add a level reward'
        )

        .addIntegerOption(option =>
          option

            .setName('level')

            .setDescription(
              'Required level'
            )

            .setMinValue(1)

            .setRequired(true)
        )

        .addRoleOption(option =>
          option

            .setName('role')

            .setDescription(
              'Reward role'
            )

            .setRequired(true)
        )
    )

    .addSubcommand(subcommand =>

      subcommand

        .setName('remove')

        .setDescription(
          'Remove a level reward'
        )

        .addIntegerOption(option =>
          option

            .setName('level')

            .setDescription(
              'Reward level'
            )

            .setRequired(true)
        )
    )

    .addSubcommand(subcommand =>

      subcommand

        .setName('list')

        .setDescription(
          'View rewards'
        )
    ),

  async execute(interaction) {

    const guildId =
      interaction.guild.id;

    const subcommand =
      interaction.options.getSubcommand();

    if (
      subcommand === 'add'
    ) {

      const level =
        interaction.options.getInteger(
          'level'
        );

      const role =
        interaction.options.getRole(
          'role'
        );

      run(

        `INSERT OR REPLACE INTO leveling_rewards (

          guildId,
          level,
          roleId

        )

        VALUES (?, ?, ?)`,

        [

          guildId,
          level,
          role.id
        ]
      );

      return interaction.editReply({

        embeds: [

          new EmbedBuilder()

            .setColor(
              0x57F287
            )

            .setTitle(
              '🎁 Reward Added'
            )

            .setDescription(

              `Level **${level}** → ${role}`
            )

            .setFooter({

              text:
                'Jabster Studios Leveling'
            })
        ]
      });
    }

    if (
      subcommand === 'remove'
    ) {

      const level =
        interaction.options.getInteger(
          'level'
        );

      run(

        `DELETE FROM leveling_rewards
         WHERE guildId = ?
         AND level = ?`,

        [

          guildId,
          level
        ]
      );

      return interaction.editReply({

        embeds: [

          new EmbedBuilder()

            .setColor(
              0xED4245
            )

            .setTitle(
              '🗑 Reward Removed'
            )

            .setDescription(

              `Removed reward for level **${level}**`
            )

            .setFooter({

              text:
                'Jabster Studios Leveling'
            })
        ]
      });
    }

    const rewards =
      all(

        `SELECT *
         FROM leveling_rewards
         WHERE guildId = ?
         ORDER BY level ASC`,

        [

          guildId
        ]
      );

    if (
      rewards.length === 0
    ) {

      return interaction.editReply({

        content:
          '❌ No level rewards configured.'
      });
    }

    const lines =
      rewards.map(

        reward =>

          `**Level ${reward.level}** → <@&${reward.roleId}>`
      );

    await interaction.editReply({

      embeds: [

        new EmbedBuilder()

          .setColor(
            0x5865F2
          )

          .setTitle(
            '🎁 Level Rewards'
          )

          .setDescription(
            lines.join('\n')
          )

          .setFooter({

            text:
              'Jabster Studios Leveling'
          })
      ]
    });
  }
};
