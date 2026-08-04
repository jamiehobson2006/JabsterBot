const {
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');

const {
  get,
  run
} = require('../../database');

const {
  getLinkWhitelist,
  serializeLinkWhitelist
} = require('../../utils/linkWhitelist');

function getSettings(guildId) {
  return get(
    `SELECT linkBlockEnabled, linkBypassRoleId, linkBypassRoleIds
     FROM guild_settings
     WHERE guildId = ?`,
    [guildId]
  ) || {};
}

function saveWhitelist(guildId, roleIds) {
  run(
    `INSERT INTO guild_settings (guildId, linkBypassRoleIds, linkBypassRoleId)
     VALUES (?, ?, NULL)
     ON CONFLICT(guildId) DO UPDATE SET
       linkBypassRoleIds = excluded.linkBypassRoleIds,
       linkBypassRoleId = NULL`,
    [guildId, serializeLinkWhitelist(roleIds)]
  );
}

function formatRoles(guild, roleIds) {
  if (!roleIds.length) return 'No roles can bypass link blocking.';

  return roleIds.map(roleId => {
    const role = guild.roles.cache.get(roleId);
    return role ? `- **${role.name}** (<@&${role.id}>)` : `- Unknown role (${roleId})`;
  }).join('\n');
}

module.exports = {
  cooldown: 3000,

  data: new SlashCommandBuilder()
    .setName('linkblock')
    .setDescription('Configure automatic link blocking')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(subcommand => subcommand
      .setName('set')
      .setDescription('Enable or disable automatic link blocking')
      .addBooleanOption(option => option
        .setName('enabled')
        .setDescription('Whether links should be removed')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('whitelist-add')
      .setDescription('Allow a role to post links')
      .addRoleOption(option => option
        .setName('role')
        .setDescription('Role that can bypass the link block')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('whitelist-remove')
      .setDescription('Remove a role from the link whitelist')
      .addRoleOption(option => option
        .setName('role')
        .setDescription('Role that should no longer bypass the link block')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('whitelist-list')
      .setDescription('View roles that can bypass link blocking'))
    .addSubcommand(subcommand => subcommand
      .setName('whitelist-clear')
      .setDescription('Remove every role from the link whitelist')),

  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.editReply({ content: 'You need Manage Server permission.' });
    }

    const guildId = interaction.guild.id;
    const subcommand = interaction.options.getSubcommand();
    const settings = getSettings(guildId);
    const roleIds = getLinkWhitelist(settings);

    if (subcommand === 'set') {
      const enabled = interaction.options.getBoolean('enabled', true);
      run(
        `INSERT INTO guild_settings (guildId, linkBlockEnabled)
         VALUES (?, ?)
         ON CONFLICT(guildId) DO UPDATE SET linkBlockEnabled = excluded.linkBlockEnabled`,
        [guildId, enabled ? 1 : 0]
      );

      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(enabled ? 0x57F287 : 0xED4245)
          .setTitle('Link Blocking Updated')
          .addFields(
            { name: 'Status', value: enabled ? 'Enabled' : 'Disabled', inline: true },
            { name: 'Whitelisted roles', value: String(roleIds.length), inline: true }
          )
          .setFooter({ text: `Updated by ${interaction.user.tag}` })
          .setTimestamp()]
      });
    }

    if (subcommand === 'whitelist-list') {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('Link Block Whitelist')
          .setDescription(formatRoles(interaction.guild, roleIds))
          .setFooter({ text: `${roleIds.length} role(s) can post links` })]
      });
    }

    if (subcommand === 'whitelist-clear') {
      if (!roleIds.length) {
        return interaction.editReply({ content: 'The link whitelist is already empty.' });
      }

      saveWhitelist(guildId, []);
      return interaction.editReply({ content: 'Removed every role from the link whitelist.' });
    }

    const role = interaction.options.getRole('role', true);
    if (role.id === interaction.guild.id) {
      return interaction.editReply({ content: 'The @everyone role cannot bypass link blocking.' });
    }

    if (subcommand === 'whitelist-add') {
      if (roleIds.includes(role.id)) {
        return interaction.editReply({ content: `${role} is already allowed to post links.` });
      }

      if (roleIds.length >= 50) {
        return interaction.editReply({ content: 'The link whitelist can contain up to 50 roles.' });
      }

      saveWhitelist(guildId, [...roleIds, role.id]);
      return interaction.editReply({ content: `${role} can now post links while link blocking is enabled.` });
    }

    if (!roleIds.includes(role.id)) {
      return interaction.editReply({ content: `${role} is not in the link whitelist.` });
    }

    saveWhitelist(guildId, roleIds.filter(roleId => roleId !== role.id));
    return interaction.editReply({ content: `${role} can no longer bypass link blocking.` });
  }
};
