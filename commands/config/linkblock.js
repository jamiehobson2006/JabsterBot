const {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');

const {
  get,
  run
} = require('../../database');

const {
  parseIdList,
  serializeIdList
} = require('../../utils/contentFilterWhitelist');

const {
  getLinkCategoryWhitelist,
  getLinkChannelWhitelist,
  getLinkWhitelist,
  serializeLinkWhitelist
} = require('../../utils/linkWhitelist');

const textChannelTypes = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum
];

function getSettings(guildId) {
  return get(
    `SELECT linkBlockEnabled,
            linkBypassRoleId,
            linkBypassRoleIds,
            linkBypassChannelIds,
            linkBypassCategoryIds
     FROM guild_settings
     WHERE guildId = ?`,
    [guildId]
  ) || {};
}

function saveList(guildId, column, ids) {
  const allowedColumns = new Set([
    'linkBypassChannelIds',
    'linkBypassCategoryIds'
  ]);

  if (!allowedColumns.has(column)) {
    throw new Error('Invalid link whitelist setting.');
  }

  run(
    `INSERT INTO guild_settings (guildId, ${column})
     VALUES (?, ?)
     ON CONFLICT(guildId) DO UPDATE SET ${column} = excluded.${column}`,
    [guildId, serializeIdList(ids)]
  );
}

function saveRoleWhitelist(guildId, roleIds) {
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

function formatChannels(ids, emptyText) {
  return ids.length ? ids.map(id => `- <#${id}>`).join('\n') : emptyText;
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
      .setDescription('Remove every role from the link whitelist'))
    .addSubcommand(subcommand => subcommand
      .setName('channel-add')
      .setDescription('Allow links in a channel')
      .addChannelOption(option => option
        .setName('channel')
        .setDescription('Channel where links are allowed')
        .addChannelTypes(...textChannelTypes)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('channel-remove')
      .setDescription('Stop allowing links in a channel')
      .addChannelOption(option => option
        .setName('channel')
        .setDescription('Whitelisted channel')
        .addChannelTypes(...textChannelTypes)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('channel-list')
      .setDescription('View channels where links are allowed'))
    .addSubcommand(subcommand => subcommand
      .setName('category-add')
      .setDescription('Allow links in every channel in a category')
      .addChannelOption(option => option
        .setName('category')
        .setDescription('Category where links are allowed')
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('category-remove')
      .setDescription('Stop allowing links in a category')
      .addChannelOption(option => option
        .setName('category')
        .setDescription('Whitelisted category')
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('category-list')
      .setDescription('View categories where links are allowed')),

  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.editReply({ content: 'You need Manage Server permission.' });
    }

    const guildId = interaction.guild.id;
    const subcommand = interaction.options.getSubcommand();
    const settings = getSettings(guildId);
    const roleIds = getLinkWhitelist(settings);
    const channelIds = getLinkChannelWhitelist(settings);
    const categoryIds = getLinkCategoryWhitelist(settings);

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
            { name: 'Role exceptions', value: String(roleIds.length), inline: true },
            { name: 'Channel exceptions', value: String(channelIds.length), inline: true },
            { name: 'Category exceptions', value: String(categoryIds.length), inline: true }
          )
          .setFooter({ text: `Updated by ${interaction.user.tag}` })
          .setTimestamp()]
      });
    }

    if (subcommand === 'whitelist-list') {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('Link Block Role Whitelist')
          .setDescription(formatRoles(interaction.guild, roleIds))
          .setFooter({ text: `${roleIds.length} role(s) can post links` })]
      });
    }

    if (subcommand === 'channel-list') {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('Link Block Channel Whitelist')
          .setDescription(formatChannels(channelIds, 'No channels are exempt from link blocking.'))]
      });
    }

    if (subcommand === 'category-list') {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('Link Block Category Whitelist')
          .setDescription(formatChannels(categoryIds, 'No categories are exempt from link blocking.'))]
      });
    }

    if (subcommand === 'whitelist-clear') {
      if (!roleIds.length) {
        return interaction.editReply({ content: 'The link role whitelist is already empty.' });
      }

      saveRoleWhitelist(guildId, []);
      return interaction.editReply({ content: 'Removed every role from the link whitelist.' });
    }

    if (subcommand.startsWith('whitelist-')) {
      const role = interaction.options.getRole('role', true);
      if (role.id === interaction.guild.id) {
        return interaction.editReply({ content: 'The @everyone role cannot bypass link blocking.' });
      }

      if (subcommand === 'whitelist-add') {
        if (roleIds.includes(role.id)) {
          return interaction.editReply({ content: `${role} is already allowed to post links.` });
        }

        if (roleIds.length >= 50) {
          return interaction.editReply({ content: 'The link role whitelist can contain up to 50 roles.' });
        }

        saveRoleWhitelist(guildId, [...roleIds, role.id]);
        return interaction.editReply({ content: `${role} can now post links while link blocking is enabled.` });
      }

      if (!roleIds.includes(role.id)) {
        return interaction.editReply({ content: `${role} is not in the link whitelist.` });
      }

      saveRoleWhitelist(guildId, roleIds.filter(roleId => roleId !== role.id));
      return interaction.editReply({ content: `${role} can no longer bypass link blocking.` });
    }

    const isCategory = subcommand.startsWith('category-');
    const item = interaction.options.getChannel(isCategory ? 'category' : 'channel', true);
    const ids = isCategory ? categoryIds : channelIds;
    const column = isCategory ? 'linkBypassCategoryIds' : 'linkBypassChannelIds';
    const noun = isCategory ? 'category' : 'channel';

    if (subcommand.endsWith('-add')) {
      if (ids.includes(item.id)) {
        return interaction.editReply({ content: `${item} is already exempt from link blocking.` });
      }

      if (ids.length >= 100) {
        return interaction.editReply({ content: `You can whitelist up to 100 ${noun}s.` });
      }

      saveList(guildId, column, [...ids, item.id]);
      return interaction.editReply({ content: `Links are now allowed in ${item}.` });
    }

    if (!ids.includes(item.id)) {
      return interaction.editReply({ content: `${item} is not exempt from link blocking.` });
    }

    saveList(guildId, column, ids.filter(id => id !== item.id));
    return interaction.editReply({ content: `Links are no longer automatically allowed in ${item}.` });
  }
};
