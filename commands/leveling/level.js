const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} = require('discord.js');

const {
  get,
  run
} = require('../../database');

const {
  calculateLevel,
  getTotalXPForLevel
} = require('../../utils/leveling');

module.exports = {

  cooldown: 3000,

  data: new SlashCommandBuilder()

    .setName('level')

    .setDescription(
      'Manage leveling data'
    )

    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    )

    .addSubcommand(subcommand =>

      subcommand

        .setName('set-level')

        .setDescription(
          'Set a user level'
        )

        .addUserOption(option =>
          option

            .setName('user')

            .setDescription('User')

            .setRequired(true)
        )

        .addIntegerOption(option =>
          option

            .setName('level')

            .setDescription('Level')

            .setMinValue(0)

            .setRequired(true)
        )
    )

    .addSubcommand(subcommand =>

      subcommand

        .setName('give-level')

        .setDescription(
          'Give levels'
        )

        .addUserOption(option =>
          option

            .setName('user')

            .setDescription('User')

            .setRequired(true)
        )

        .addIntegerOption(option =>
          option

            .setName('amount')

            .setDescription('Levels')

            .setMinValue(1)

            .setRequired(true)
        )
    )

    .addSubcommand(subcommand =>

      subcommand

        .setName('remove-level')

        .setDescription(
          'Remove levels'
        )

        .addUserOption(option =>
          option

            .setName('user')

            .setDescription('User')

            .setRequired(true)
        )

        .addIntegerOption(option =>
          option

            .setName('amount')

            .setDescription('Levels')

            .setMinValue(1)

            .setRequired(true)
        )
    )

    .addSubcommand(subcommand =>

      subcommand

        .setName('set-xp')

        .setDescription(
          'Set XP'
        )

        .addUserOption(option =>
          option

            .setName('user')

            .setDescription('User')

            .setRequired(true)
        )

        .addIntegerOption(option =>
          option

            .setName('xp')

            .setDescription('XP')

            .setMinValue(0)

            .setRequired(true)
        )
    )

    .addSubcommand(subcommand =>

      subcommand

        .setName('give-xp')

        .setDescription(
          'Give XP'
        )

        .addUserOption(option =>
          option

            .setName('user')

            .setDescription('User')

            .setRequired(true)
        )

        .addIntegerOption(option =>
          option

            .setName('amount')

            .setDescription('XP')

            .setMinValue(1)

            .setRequired(true)
        )
    )

    .addSubcommand(subcommand =>

      subcommand

        .setName('remove-xp')

        .setDescription(
          'Remove XP'
        )

        .addUserOption(option =>
          option

            .setName('user')

            .setDescription('User')

            .setRequired(true)
        )

        .addIntegerOption(option =>
          option

            .setName('amount')

            .setDescription('XP')

            .setMinValue(1)

            .setRequired(true)
        )
    )

    .addSubcommand(subcommand =>

      subcommand

        .setName('reset')

        .setDescription(
          'Reset leveling data'
        )

        .addUserOption(option =>
          option

            .setName('user')

            .setDescription('User')

            .setRequired(true)
        )
    ),

  async execute(interaction) {

    const guildId =
      interaction.guild.id;

    const subcommand =
      interaction.options.getSubcommand();

    const target =
      interaction.options.getUser(
        'user'
      );

    let data =
      get(

        `SELECT *
         FROM leveling_users
         WHERE guildId = ?
         AND userId = ?`,

        [

          guildId,
          target.id
        ]
      );

    if (!data) {

      run(

        `INSERT INTO leveling_users (

          guildId,
          userId,

          xp,
          level,

          messages,

          lastXpTime

        )

        VALUES (?, ?, ?, ?, ?, ?)`,

        [

          guildId,
          target.id,

          0,
          0,

          0,

          0
        ]
      );

      data = {

        xp: 0,
        level: 0
      };
    }

    let newXP =
      data.xp;

    if (
      subcommand ===
      'set-level'
    ) {

      const level =
        interaction.options.getInteger(
          'level'
        );

      newXP =
        getTotalXPForLevel(
          level
        );
    }

    if (
      subcommand ===
      'give-level'
    ) {

      const amount =
        interaction.options.getInteger(
          'amount'
        );

      newXP =
        getTotalXPForLevel(

          data.level +
          amount
        );
    }

    if (
      subcommand ===
      'remove-level'
    ) {

      const amount =
        interaction.options.getInteger(
          'amount'
        );

      const newLevel =

        Math.max(

          data.level -
          amount,

          0
        );

      newXP =
        getTotalXPForLevel(
          newLevel
        );
    }

    if (
      subcommand ===
      'set-xp'
    ) {

      newXP =
        interaction.options.getInteger(
          'xp'
        );
    }

    if (
      subcommand ===
      'give-xp'
    ) {

      newXP +=

        interaction.options.getInteger(
          'amount'
        );
    }

    if (
      subcommand ===
      'remove-xp'
    ) {

      newXP =

        Math.max(

          newXP -

          interaction.options.getInteger(
            'amount'
          ),

          0
        );
    }

    if (
      subcommand ===
      'reset'
    ) {

      newXP = 0;
    }

    const newLevel =
      calculateLevel(
        newXP
      );

    run(

      `UPDATE leveling_users

       SET

       xp = ?,
       level = ?

       WHERE guildId = ?
       AND userId = ?`,

      [

        newXP,
        newLevel,

        guildId,
        target.id
      ]
    );

    const embed =
      new EmbedBuilder()

        .setColor(
          0x5865F2
        )

        .setTitle(
          '⭐ Leveling Updated'
        )

        .setDescription(

          [
            `👤 **User:** ${target.tag}`,
            `📈 **Level:** ${newLevel}`,
            `✨ **XP:** ${newXP.toLocaleString()}`
          ].join('\n')
        )

        .setFooter({

          text:
            'Jabster Studios Leveling'
        })

        .setTimestamp();

    await interaction.editReply({

      embeds: [embed]
    });
  }
};
