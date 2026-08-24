const {
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');

const {
  addLoggingManagerRole,
  listLoggingManagerRoles,
  removeLoggingManagerRole
} = require('../../utils/loggingConfig');

function formatManagerRoles(roles) {
  if (!roles.length) {
    return 'No logging manager roles are configured.';
  }

  return roles
    .slice(0, 100)
    .map(role =>
      `<@&${role.roleId}> - added <t:${Math.floor(role.addedAt / 1000)}:R>`
    )
    .join('\n');
}

module.exports = {
  cooldown: 2000,
  ephemeral: true,

  data: new SlashCommandBuilder()
    .setName('loggingmanager')
    .setDescription('Manage roles allowed to configure logging')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Allow a role to manage logging')
        .addRoleOption(option =>
          option
            .setName('role')
            .setDescription('Role allowed to use /logging')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Remove a logging manager role')
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
        .setDescription('List logging manager roles')
    ),

  async execute(interaction) {
    if (!interaction.memberPermissions?.has(
      PermissionFlagsBits.Administrator
    )) {
      return interaction.editReply({
        content: 'Administrator permission is required.'
      });
    }

    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (subcommand === 'list') {
      const roles = listLoggingManagerRoles(guildId);

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('Logging Manager Roles')
            .setDescription(formatManagerRoles(roles))
            .setFooter({ text: `${roles.length} configured role(s)` })
            .setTimestamp()
        ],
        allowedMentions: { parse: [] }
      });
    }

    const role = interaction.options.getRole('role', true);

    if (role.id === interaction.guild.id || role.managed) {
      return interaction.editReply({
        content: 'Choose a normal server role, not @everyone or an integration-managed role.'
      });
    }

    if (subcommand === 'add') {
      const result = addLoggingManagerRole({
        guildId,
        roleId: role.id,
        addedBy: interaction.user.id
      });

      return interaction.editReply({
        content: result.changes
          ? `${role} can now configure logging with /logging.`
          : `${role} is already a logging manager role.`,
        allowedMentions: { parse: [] }
      });
    }

    const result = removeLoggingManagerRole({
      guildId,
      roleId: role.id
    });

    return interaction.editReply({
      content: result.changes
        ? `${role} can no longer configure logging.`
        : `${role} is not a logging manager role.`,
      allowedMentions: { parse: [] }
    });
  }
};
