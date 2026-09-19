const {
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');

const { all, get, run } = require('../../database');
const { automaticRoleSafetyError } = require('../../utils/roleSafety');

function managerOnly(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles);
}

module.exports = {
  cooldown: 2000,
  data: new SlashCommandBuilder()
    .setName('selfrole')
    .setDescription('Choose an approved self-assignable role or configure the list')
    .addSubcommand(command => command
      .setName('add')
      .setDescription('Give yourself an approved self role')
      .addRoleOption(option => option
        .setName('role')
        .setDescription('Approved role to add')
        .setRequired(true)))
    .addSubcommand(command => command
      .setName('remove')
      .setDescription('Remove an approved self role from yourself')
      .addRoleOption(option => option
        .setName('role')
        .setDescription('Approved role to remove')
        .setRequired(true)))
    .addSubcommand(command => command
      .setName('list')
      .setDescription('List the roles members can assign themselves'))
    .addSubcommand(command => command
      .setName('allow')
      .setDescription('Allow members to assign themselves a role')
      .addRoleOption(option => option
        .setName('role')
        .setDescription('Role to allow')
        .setRequired(true)))
    .addSubcommand(command => command
      .setName('disallow')
      .setDescription('Remove a role from the self-role list')
      .addRoleOption(option => option
        .setName('role')
        .setDescription('Role to disallow')
        .setRequired(true))),

  async execute(interaction) {
    const action = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (action === 'list') {
      const rows = all(
        `SELECT roleId FROM self_roles WHERE guildId = ? ORDER BY createdAt, roleId`,
        [guildId]
      ).filter(row => interaction.guild.roles.cache.has(row.roleId));

      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('Self Roles')
          .setDescription(rows.length
            ? rows.map(row => `<@&${row.roleId}>`).join('\n').slice(0, 4096)
            : 'No self-assignable roles are configured.')]
      });
    }

    const role = interaction.options.getRole('role', true);

    if (action === 'allow' || action === 'disallow') {
      if (!managerOnly(interaction)) {
        return interaction.editReply({ content: 'You need Manage Roles permission.' });
      }

      if (action === 'allow') {
        const safetyError = automaticRoleSafetyError(interaction.guild, role);
        if (safetyError) return interaction.editReply({ content: safetyError });
        if (
          interaction.user.id !== interaction.guild.ownerId &&
          role.position >= interaction.member.roles.highest.position
        ) {
          return interaction.editReply({ content: 'That role must be below your highest role.' });
        }

        run(
          `INSERT OR REPLACE INTO self_roles (guildId, roleId, addedBy, createdAt)
           VALUES (?, ?, ?, ?)`,
          [guildId, role.id, interaction.user.id, Date.now()]
        );
        return interaction.editReply({ content: `${role} is now self-assignable.` });
      }

      const removed = run(
        `DELETE FROM self_roles WHERE guildId = ? AND roleId = ?`,
        [guildId, role.id]
      );
      return interaction.editReply({
        content: removed.changes
          ? `${role} is no longer self-assignable.`
          : `${role} was not on the self-role list.`
      });
    }

    const approved = get(
      `SELECT 1 FROM self_roles WHERE guildId = ? AND roleId = ?`,
      [guildId, role.id]
    );
    if (!approved) {
      return interaction.editReply({ content: 'That role is not self-assignable.' });
    }

    const safetyError = automaticRoleSafetyError(interaction.guild, role);
    if (safetyError) return interaction.editReply({ content: safetyError });

    if (action === 'add') {
      if (interaction.member.roles.cache.has(role.id)) {
        return interaction.editReply({ content: `You already have ${role}.` });
      }
      await interaction.member.roles.add(role, 'Self role selected');
      return interaction.editReply({ content: `Added ${role}.` });
    }

    if (!interaction.member.roles.cache.has(role.id)) {
      return interaction.editReply({ content: `You do not have ${role}.` });
    }
    await interaction.member.roles.remove(role, 'Self role removed');
    return interaction.editReply({ content: `Removed ${role}.` });
  }
};
