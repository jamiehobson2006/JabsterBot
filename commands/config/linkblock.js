const {
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');

const {
  get,
  run
} = require('../../database');

module.exports = {

  cooldown: 3000,

  ephemeral: true,

  data: new SlashCommandBuilder()

    .setName('linkblock')

    .setDescription(
      'Enable or disable automatic link blocking'
    )

    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    )

    .addBooleanOption(option =>

      option

        .setName('enabled')

        .setDescription(
          'Turn link blocking on or off'
        )

        .setRequired(true)
    )

    .addRoleOption(option =>

      option

        .setName('bypass_role')

        .setDescription(
          'Optional role that can post links'
        )

        .setRequired(false)
    ),

  async execute(interaction) {

    if (
      !interaction.memberPermissions?.has(
        PermissionFlagsBits.ManageGuild
      )
    ) {

      return interaction.editReply({

        content:
          'You need Manage Server permission.'
      });
    }

    const enabled =
      interaction.options.getBoolean(
        'enabled',
        true
      );

    const bypassRole =
      interaction.options.getRole(
        'bypass_role',
        false
      );

    const existing =
      get(

        `SELECT linkBypassRoleId
         FROM guild_settings
         WHERE guildId = ?`,

        [interaction.guild.id]
      );

    const bypassRoleId =
      bypassRole?.id ||
      existing?.linkBypassRoleId ||
      null;

    run(

      `INSERT INTO guild_settings
       (
         guildId,
         linkBlockEnabled,
         linkBypassRoleId
       )
       VALUES (?, ?, ?)
       ON CONFLICT(guildId)
       DO UPDATE SET
         linkBlockEnabled = excluded.linkBlockEnabled,
         linkBypassRoleId = excluded.linkBypassRoleId`,

      [
        interaction.guild.id,
        enabled ? 1 : 0,
        bypassRoleId
      ]
    );

    return interaction.editReply({

      embeds: [

        new EmbedBuilder()

          .setColor(
            enabled
              ? 0x57F287
              : 0xED4245
          )

          .setTitle('Link Blocking Updated')

          .addFields(

            {
              name: 'Status',
              value: enabled
                ? 'Enabled'
                : 'Disabled',
              inline: true
            },

            {
              name: 'Bypass Role',
              value: bypassRoleId
                ? `<@&${bypassRoleId}>`
                : 'None',
              inline: true
            }
          )

          .setFooter({
            text: `Updated by ${interaction.user.tag}`
          })

          .setTimestamp()
      ],

      allowedMentions: {
        parse: []
      }
    });
  }
};
