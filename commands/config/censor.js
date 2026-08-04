const {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');

const {
  run
} = require('../../database');

const {
  parseIdList,
  serializeIdList
} = require('../../utils/contentFilterWhitelist');

const {
  addCensorTerm,
  getCensorBypassCategories,
  getCensorBypassChannels,
  getCensorBypassRoles,
  getCensorSettings,
  listCensorTerms,
  removeCensorTerm
} = require('../../utils/censor');

const textChannelTypes = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum
];

function canManageCensor(interaction, settings) {
  return interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild) || Boolean(
    settings?.censorRoleId &&
    interaction.member.roles.cache.has(settings.censorRoleId)
  );
}

function requireCensorAccess(interaction, settings) {
  if (canManageCensor(interaction, settings)) return null;
  return 'You need Manage Server permission or the configured censor role.';
}

function saveBypassList(guildId, column, ids) {
  const allowedColumns = new Set([
    'censorBypassRoleIds',
    'censorBypassChannelIds',
    'censorBypassCategoryIds'
  ]);

  if (!allowedColumns.has(column)) {
    throw new Error('Invalid censor bypass setting.');
  }

  run(
    `INSERT INTO guild_settings (guildId, ${column})
     VALUES (?, ?)
     ON CONFLICT(guildId) DO UPDATE SET ${column} = excluded.${column}`,
    [guildId, serializeIdList(ids)]
  );
}

function formatRoles(guild, roleIds) {
  return roleIds.length
    ? roleIds.map(id => {
      const role = guild.roles.cache.get(id);
      return role ? `- **${role.name}** (<@&${id}>)` : `- Unknown role (${id})`;
    }).join('\n')
    : 'No roles are exempt from censoring.';
}

function formatChannels(ids, emptyText) {
  return ids.length ? ids.map(id => `- <#${id}>`).join('\n') : emptyText;
}

module.exports = {
  cooldown: 2500,
  ephemeral: true,

  data: new SlashCommandBuilder()
    .setName('censor')
    .setDescription('Manage automatic message censoring')
    .addSubcommand(subcommand => subcommand
      .setName('add')
      .setDescription('Add a word or phrase to the censor list')
      .addStringOption(option => option
        .setName('term')
        .setDescription('Word or phrase to delete automatically')
        .setMinLength(1)
        .setMaxLength(100)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('remove')
      .setDescription('Remove a word or phrase from the censor list')
      .addStringOption(option => option
        .setName('term')
        .setDescription('Existing word or phrase')
        .setMinLength(1)
        .setMaxLength(100)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('list')
      .setDescription('View the configured censor list'))
    .addSubcommand(subcommand => subcommand
      .setName('clear')
      .setDescription('Remove every word and phrase from the censor list'))
    .addSubcommand(subcommand => subcommand
      .setName('setrole')
      .setDescription('Set a role allowed to manage the censor list')
      .addRoleOption(option => option
        .setName('role')
        .setDescription('Role allowed to use /censor')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('clearrole')
      .setDescription('Require Manage Server to manage censoring'))
    .addSubcommand(subcommand => subcommand
      .setName('status')
      .setDescription('View censoring status'))
    .addSubcommand(subcommand => subcommand
      .setName('bypass-role-add')
      .setDescription('Allow a role to bypass censoring')
      .addRoleOption(option => option
        .setName('role')
        .setDescription('Role exempt from censoring')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('bypass-role-remove')
      .setDescription('Remove a role from the censor bypass list')
      .addRoleOption(option => option
        .setName('role')
        .setDescription('Role that should be censored again')
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('bypass-role-list')
      .setDescription('View roles exempt from censoring'))
    .addSubcommand(subcommand => subcommand
      .setName('bypass-channel-add')
      .setDescription('Allow censored words in a channel')
      .addChannelOption(option => option
        .setName('channel')
        .setDescription('Channel exempt from censoring')
        .addChannelTypes(...textChannelTypes)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('bypass-channel-remove')
      .setDescription('Remove a channel from the censor bypass list')
      .addChannelOption(option => option
        .setName('channel')
        .setDescription('Whitelisted channel')
        .addChannelTypes(...textChannelTypes)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('bypass-channel-list')
      .setDescription('View channels exempt from censoring'))
    .addSubcommand(subcommand => subcommand
      .setName('bypass-category-add')
      .setDescription('Allow censored words in a category')
      .addChannelOption(option => option
        .setName('category')
        .setDescription('Category exempt from censoring')
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('bypass-category-remove')
      .setDescription('Remove a category from the censor bypass list')
      .addChannelOption(option => option
        .setName('category')
        .setDescription('Whitelisted category')
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('bypass-category-list')
      .setDescription('View categories exempt from censoring')),

  async execute(interaction) {
    const settings = getCensorSettings(interaction.guild.id);
    const subcommand = interaction.options.getSubcommand();

    if (['setrole', 'clearrole'].includes(subcommand) &&
      !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.editReply({
        content: 'You need Manage Server permission to change the censor manager role.'
      });
    }

    const accessError = requireCensorAccess(interaction, settings);
    if (accessError) return interaction.editReply({ content: accessError });

    if (subcommand === 'setrole') {
      const role = interaction.options.getRole('role', true);

      if (role.managed || role.id === interaction.guild.roles.everyone.id) {
        return interaction.editReply({ content: 'Choose a normal server role.' });
      }

      run(
        `INSERT INTO guild_settings (guildId, censorRoleId)
         VALUES (?, ?)
         ON CONFLICT(guildId) DO UPDATE SET censorRoleId = excluded.censorRoleId`,
        [interaction.guild.id, role.id]
      );

      return interaction.editReply({ content: `${role} can now manage the censor list.` });
    }

    if (subcommand === 'clearrole') {
      run(
        `INSERT INTO guild_settings (guildId, censorRoleId)
         VALUES (?, NULL)
         ON CONFLICT(guildId) DO UPDATE SET censorRoleId = NULL`,
        [interaction.guild.id]
      );

      return interaction.editReply({
        content: 'Censor-list management now requires Manage Server permission.'
      });
    }

    const roleIds = getCensorBypassRoles(settings);
    const channelIds = getCensorBypassChannels(settings);
    const categoryIds = getCensorBypassCategories(settings);

    if (subcommand === 'bypass-role-list') {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('Censor Role Bypass List')
          .setDescription(formatRoles(interaction.guild, roleIds))]
      });
    }

    if (subcommand === 'bypass-channel-list') {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('Censor Channel Bypass List')
          .setDescription(formatChannels(channelIds, 'No channels are exempt from censoring.'))]
      });
    }

    if (subcommand === 'bypass-category-list') {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('Censor Category Bypass List')
          .setDescription(formatChannels(categoryIds, 'No categories are exempt from censoring.'))]
      });
    }

    if (subcommand.startsWith('bypass-role-')) {
      const role = interaction.options.getRole('role', true);

      if (role.id === interaction.guild.roles.everyone.id) {
        return interaction.editReply({ content: 'The @everyone role cannot bypass censoring.' });
      }

      if (subcommand === 'bypass-role-add') {
        if (roleIds.includes(role.id)) {
          return interaction.editReply({ content: `${role} already bypasses censoring.` });
        }

        if (roleIds.length >= 50) {
          return interaction.editReply({ content: 'You can whitelist up to 50 roles.' });
        }

        saveBypassList(interaction.guild.id, 'censorBypassRoleIds', [...roleIds, role.id]);
        return interaction.editReply({ content: `${role} can now bypass censoring.` });
      }

      if (!roleIds.includes(role.id)) {
        return interaction.editReply({ content: `${role} is not exempt from censoring.` });
      }

      saveBypassList(interaction.guild.id, 'censorBypassRoleIds', roleIds.filter(id => id !== role.id));
      return interaction.editReply({ content: `${role} can no longer bypass censoring.` });
    }

    if (subcommand.startsWith('bypass-channel-') || subcommand.startsWith('bypass-category-')) {
      const isCategory = subcommand.startsWith('bypass-category-');
      const item = interaction.options.getChannel(isCategory ? 'category' : 'channel', true);
      const ids = isCategory ? categoryIds : channelIds;
      const column = isCategory ? 'censorBypassCategoryIds' : 'censorBypassChannelIds';
      const noun = isCategory ? 'category' : 'channel';

      if (subcommand.endsWith('-add')) {
        if (ids.includes(item.id)) {
          return interaction.editReply({ content: `${item} already bypasses censoring.` });
        }

        if (ids.length >= 100) {
          return interaction.editReply({ content: `You can whitelist up to 100 ${noun}s.` });
        }

        saveBypassList(interaction.guild.id, column, [...ids, item.id]);
        return interaction.editReply({ content: `${item} can now bypass censoring.` });
      }

      if (!ids.includes(item.id)) {
        return interaction.editReply({ content: `${item} is not exempt from censoring.` });
      }

      saveBypassList(interaction.guild.id, column, ids.filter(id => id !== item.id));
      return interaction.editReply({ content: `${item} can no longer bypass censoring.` });
    }

    if (subcommand === 'add') {
      const term = addCensorTerm({
        guildId: interaction.guild.id,
        word: interaction.options.getString('term', true),
        addedBy: interaction.user.id
      });

      run(
        `INSERT INTO guild_settings (guildId, censorEnabled)
         VALUES (?, 1)
         ON CONFLICT(guildId) DO UPDATE SET censorEnabled = 1`,
        [interaction.guild.id]
      );

      return interaction.editReply({
        content: `Censoring is active. Messages containing \`${term}\` will be deleted.`
      });
    }

    if (subcommand === 'remove') {
      const term = interaction.options.getString('term', true);
      const changes = removeCensorTerm(interaction.guild.id, term);
      return interaction.editReply({
        content: changes ? `Removed \`${term}\` from the censor list.` : 'That term is not in the censor list.'
      });
    }

    if (subcommand === 'clear') {
      const result = run('DELETE FROM censor_words WHERE guildId = ?', [interaction.guild.id]);
      return interaction.editReply({ content: `Removed ${result.changes} censor term(s).` });
    }

    const terms = listCensorTerms(interaction.guild.id);

    if (subcommand === 'list') {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('Censor List')
          .setDescription(terms.length ? terms.slice(0, 100).map(item => `- \`${item.word}\``).join('\n') : 'No terms are configured.')
          .setFooter({ text: `${terms.length} term(s) configured` })]
      });
    }

    return interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(settings?.censorEnabled ? 0x57F287 : 0xED4245)
        .setTitle('Censor Status')
        .addFields(
          { name: 'Status', value: settings?.censorEnabled ? 'Active' : 'Inactive', inline: true },
          { name: 'Manager Role', value: settings?.censorRoleId ? `<@&${settings.censorRoleId}>` : 'Manage Server permission', inline: true },
          { name: 'Terms', value: String(terms.length), inline: true },
          { name: 'Role Bypasses', value: String(roleIds.length), inline: true },
          { name: 'Channel Bypasses', value: String(channelIds.length), inline: true },
          { name: 'Category Bypasses', value: String(categoryIds.length), inline: true }
        )
        .setFooter({ text: 'Censoring automatically activates when moderation logging is configured.' })]
    });
  }
};
