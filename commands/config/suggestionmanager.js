const {
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');

const {
  addSuggestionManagerRole,
  listSuggestionManagerRoles,
  removeSuggestionManagerRole
} = require('../../utils/suggestions/managers');

function roleListDescription(managers) {

  if (!managers.length) {

    return 'No suggestion manager roles are configured.';
  }

  const shown =
    managers.slice(0, 100);

  const lines =
    shown.map(manager =>
      `<@&${manager.roleId}> - added <t:${Math.floor(manager.addedAt / 1000)}:R>`
    );

  if (managers.length > shown.length) {

    lines.push(
      `...and ${managers.length - shown.length} more role(s).`
    );
  }

  return lines.join('\n');
}

module.exports = {

  cooldown: 2000,
  ephemeral: true,

  data: new SlashCommandBuilder()
    .setName('suggestionmanager')
    .setDescription('Manage roles that can review suggestions')
    .setDefaultMemberPermissions(
      PermissionFlagsBits.Administrator
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Allow a role to accept and deny suggestions')
        .addRoleOption(option =>
          option
            .setName('role')
            .setDescription('Role allowed to review suggestions')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Remove a suggestion manager role')
        .addRoleOption(option =>
          option
            .setName('role')
            .setDescription('Role to remove')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('List suggestion manager roles')
    ),

  async execute(interaction) {

    if (!interaction.memberPermissions?.has(
      PermissionFlagsBits.Administrator
    )) {

      return interaction.editReply({
        content: 'Administrator permission is required.'
      });
    }

    const subcommand =
      interaction.options.getSubcommand();

    const guildId =
      interaction.guild.id;

    if (subcommand === 'list') {

      const managers =
        listSuggestionManagerRoles(guildId);

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('Suggestion Manager Roles')
            .setDescription(roleListDescription(managers))
            .setFooter({
              text: `${managers.length} configured role(s)`
            })
            .setTimestamp()
        ],
        allowedMentions: {
          parse: []
        }
      });
    }

    const role =
      interaction.options.getRole('role', true);

    if (role.id === interaction.guild.id) {

      return interaction.editReply({
        content: 'The @everyone role cannot manage suggestions.'
      });
    }

    if (role.managed) {

      return interaction.editReply({
        content: 'Choose a normal server role, not an integration-managed role.'
      });
    }

    if (subcommand === 'add') {

      const result =
        addSuggestionManagerRole({
          guildId,
          roleId: role.id,
          addedBy: interaction.user.id
        });

      return interaction.editReply({
        content: result.changes
          ? `${role} can now accept and deny suggestions.`
          : `${role} is already a suggestion manager role.`,
        allowedMentions: {
          parse: []
        }
      });
    }

    const result =
      removeSuggestionManagerRole({
        guildId,
        roleId: role.id
      });

    return interaction.editReply({
      content: result.changes
        ? `${role} can no longer accept or deny suggestions.`
        : `${role} is not a suggestion manager role.`,
      allowedMentions: {
        parse: []
      }
    });
  }
};
