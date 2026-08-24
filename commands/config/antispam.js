const {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');

const {
  addAntiSpamBypass,
  antiSpamBypassLists,
  getAntiSpamSettings,
  listAntiSpamBypasses,
  removeAntiSpamBypass
} = require('../../utils/antispam');

const {
  run
} = require('../../database');

const textChannelTypes = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum
];

function canManage(interaction, settings) {
  return interaction.memberPermissions?.has(
    PermissionFlagsBits.ManageGuild
  ) || Boolean(
    settings?.managerRoleId &&
    interaction.member?.roles?.cache?.has(settings.managerRoleId)
  );
}

function addSettingOptions(subcommand) {
  return subcommand
    .addBooleanOption(option => option
      .setName('enabled')
      .setDescription('Enable or disable anti-spam')
      .setRequired(true))
    .addIntegerOption(option => option
      .setName('max_messages')
      .setDescription('Messages allowed during the rate window')
      .setMinValue(2)
      .setMaxValue(25))
    .addIntegerOption(option => option
      .setName('interval_seconds')
      .setDescription('Rate window in seconds')
      .setMinValue(2)
      .setMaxValue(120))
    .addIntegerOption(option => option
      .setName('duplicate_limit')
      .setDescription('Matching messages allowed during duplicate window')
      .setMinValue(2)
      .setMaxValue(10))
    .addIntegerOption(option => option
      .setName('duplicate_window_seconds')
      .setDescription('Duplicate message window in seconds')
      .setMinValue(5)
      .setMaxValue(600))
    .addIntegerOption(option => option
      .setName('mention_limit')
      .setDescription('Mentions allowed in one message. Set 0 to disable.')
      .setMinValue(0)
      .setMaxValue(50))
    .addIntegerOption(option => option
      .setName('timeout_seconds')
      .setDescription('Automatic timeout length. Set 0 to only delete.')
      .setMinValue(0)
      .setMaxValue(2419200));
}

function formatBypasses(guildId) {
  const lists = antiSpamBypassLists(guildId);

  return {
    roles: lists.roles.length
      ? lists.roles.map(id => `<@&${id}>`).join('\n')
      : 'None',
    channels: lists.channels.length
      ? lists.channels.map(id => `<#${id}>`).join('\n')
      : 'None',
    categories: lists.categories.length
      ? lists.categories.map(id => `<#${id}>`).join('\n')
      : 'None'
  };
}

module.exports = {
  cooldown: 2000,
  ephemeral: true,

  data: new SlashCommandBuilder()
    .setName('antispam')
    .setDescription('Configure automatic anti-spam protection')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(subcommand =>
      addSettingOptions(
        subcommand
          .setName('set')
          .setDescription('Set anti-spam thresholds and automatic action')
      )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('disable')
        .setDescription('Disable anti-spam protection')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('status')
        .setDescription('View anti-spam settings and exceptions')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('setrole')
        .setDescription('Set a role allowed to manage anti-spam')
        .addRoleOption(option => option
          .setName('role')
          .setDescription('Role allowed to manage anti-spam')
          .setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('clearrole')
        .setDescription('Require Manage Server to manage anti-spam')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('bypass-role-add')
        .setDescription('Allow a role to bypass anti-spam')
        .addRoleOption(option => option
          .setName('role')
          .setDescription('Role exempt from anti-spam')
          .setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('bypass-role-remove')
        .setDescription('Remove a role anti-spam bypass')
        .addRoleOption(option => option
          .setName('role')
          .setDescription('Role to remove')
          .setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('bypass-role-list')
        .setDescription('List roles exempt from anti-spam')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('bypass-channel-add')
        .setDescription('Allow anti-spam bypass in a channel')
        .addChannelOption(option => option
          .setName('channel')
          .setDescription('Channel exempt from anti-spam')
          .addChannelTypes(...textChannelTypes)
          .setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('bypass-channel-remove')
        .setDescription('Remove a channel anti-spam bypass')
        .addChannelOption(option => option
          .setName('channel')
          .setDescription('Channel to remove')
          .addChannelTypes(...textChannelTypes)
          .setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('bypass-channel-list')
        .setDescription('List channels exempt from anti-spam')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('bypass-category-add')
        .setDescription('Allow anti-spam bypass in a category')
        .addChannelOption(option => option
          .setName('category')
          .setDescription('Category exempt from anti-spam')
          .addChannelTypes(ChannelType.GuildCategory)
          .setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('bypass-category-remove')
        .setDescription('Remove a category anti-spam bypass')
        .addChannelOption(option => option
          .setName('category')
          .setDescription('Category to remove')
          .addChannelTypes(ChannelType.GuildCategory)
          .setRequired(true))
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('bypass-category-list')
        .setDescription('List categories exempt from anti-spam')
    ),

  async execute(interaction) {
    const guildId = interaction.guild.id;
    const subcommand = interaction.options.getSubcommand();
    const settings = getAntiSpamSettings(guildId);

    if (
      ['setrole', 'clearrole'].includes(subcommand) &&
      !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
    ) {
      return interaction.editReply({
        content: 'You need Manage Server permission to change the anti-spam manager role.'
      });
    }

    if (!canManage(interaction, settings)) {
      return interaction.editReply({
        content: 'You need Manage Server permission or the configured anti-spam manager role.'
      });
    }

    if (subcommand === 'setrole') {
      const role = interaction.options.getRole('role', true);

      if (role.managed || role.id === interaction.guild.id) {
        return interaction.editReply({ content: 'Choose a normal server role.' });
      }

      run(
        `INSERT INTO antispam_settings (guildId, managerRoleId, updatedBy, updatedAt)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(guildId)
         DO UPDATE SET managerRoleId = excluded.managerRoleId,
                       updatedBy = excluded.updatedBy,
                       updatedAt = excluded.updatedAt`,
        [guildId, role.id, interaction.user.id, Date.now()]
      );

      return interaction.editReply({
        content: `${role} can now manage anti-spam.`,
        allowedMentions: { parse: [] }
      });
    }

    if (subcommand === 'clearrole') {
      run(
        `INSERT INTO antispam_settings (guildId, managerRoleId, updatedBy, updatedAt)
         VALUES (?, NULL, ?, ?)
         ON CONFLICT(guildId)
         DO UPDATE SET managerRoleId = NULL,
                       updatedBy = excluded.updatedBy,
                       updatedAt = excluded.updatedAt`,
        [guildId, interaction.user.id, Date.now()]
      );

      return interaction.editReply({
        content: 'Anti-spam management now requires Manage Server permission.'
      });
    }

    if (subcommand === 'set') {
      const next = {
        enabled: interaction.options.getBoolean('enabled', true),
        maxMessages: interaction.options.getInteger('max_messages') ?? settings?.maxMessages ?? 6,
        intervalSeconds: interaction.options.getInteger('interval_seconds') ?? settings?.intervalSeconds ?? 8,
        duplicateLimit: interaction.options.getInteger('duplicate_limit') ?? settings?.duplicateLimit ?? 3,
        duplicateWindowSeconds: interaction.options.getInteger('duplicate_window_seconds') ?? settings?.duplicateWindowSeconds ?? 30,
        mentionLimit: interaction.options.getInteger('mention_limit') ?? settings?.mentionLimit ?? 6,
        timeoutSeconds: interaction.options.getInteger('timeout_seconds') ?? settings?.timeoutSeconds ?? 0
      };

      run(
        `INSERT INTO antispam_settings (
           guildId, enabled, managerRoleId, maxMessages, intervalSeconds,
           duplicateLimit, duplicateWindowSeconds, mentionLimit, timeoutSeconds,
           updatedBy, updatedAt
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(guildId)
         DO UPDATE SET enabled = excluded.enabled,
                       maxMessages = excluded.maxMessages,
                       intervalSeconds = excluded.intervalSeconds,
                       duplicateLimit = excluded.duplicateLimit,
                       duplicateWindowSeconds = excluded.duplicateWindowSeconds,
                       mentionLimit = excluded.mentionLimit,
                       timeoutSeconds = excluded.timeoutSeconds,
                       updatedBy = excluded.updatedBy,
                       updatedAt = excluded.updatedAt`,
        [
          guildId,
          next.enabled ? 1 : 0,
          settings?.managerRoleId || null,
          next.maxMessages,
          next.intervalSeconds,
          next.duplicateLimit,
          next.duplicateWindowSeconds,
          next.mentionLimit,
          next.timeoutSeconds,
          interaction.user.id,
          Date.now()
        ]
      );

      return interaction.editReply({
        content: next.enabled
          ? 'Anti-spam protection is active with your saved thresholds.'
          : 'Anti-spam protection is disabled.',
      });
    }

    if (subcommand === 'disable') {
      run(
        `INSERT INTO antispam_settings (guildId, enabled, updatedBy, updatedAt)
         VALUES (?, 0, ?, ?)
         ON CONFLICT(guildId)
         DO UPDATE SET enabled = 0,
                       updatedBy = excluded.updatedBy,
                       updatedAt = excluded.updatedAt`,
        [guildId, interaction.user.id, Date.now()]
      );

      return interaction.editReply({ content: 'Anti-spam protection is disabled.' });
    }

    if (subcommand === 'status') {
      const bypasses = formatBypasses(guildId);

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(settings?.enabled ? 0x57F287 : 0xED4245)
            .setTitle('Anti-Spam Protection')
            .addFields(
              {
                name: 'Status',
                value: settings?.enabled ? 'Active' : 'Inactive',
                inline: true
              },
              {
                name: 'Manager Role',
                value: settings?.managerRoleId
                  ? `<@&${settings.managerRoleId}>`
                  : 'Manage Server permission',
                inline: true
              },
              {
                name: 'Flood Protection',
                value: `${settings?.maxMessages || 6} messages / ${settings?.intervalSeconds || 8}s`,
                inline: true
              },
              {
                name: 'Duplicate Protection',
                value: `${settings?.duplicateLimit || 3} messages / ${settings?.duplicateWindowSeconds || 30}s`,
                inline: true
              },
              {
                name: 'Mention Limit',
                value: settings?.mentionLimit ? String(settings.mentionLimit) : 'Disabled',
                inline: true
              },
              {
                name: 'Automatic Timeout',
                value: settings?.timeoutSeconds ? `${settings.timeoutSeconds}s` : 'Delete only',
                inline: true
              },
              { name: 'Role Bypasses', value: bypasses.roles, inline: true },
              { name: 'Channel Bypasses', value: bypasses.channels, inline: true },
              { name: 'Category Bypasses', value: bypasses.categories, inline: true }
            )
            .setTimestamp()
        ],
        allowedMentions: { parse: [] }
      });
    }

    const isRole = subcommand.startsWith('bypass-role-');
    const isCategory = subcommand.startsWith('bypass-category-');
    const type = isRole ? 'ROLE' : isCategory ? 'CATEGORY' : 'CHANNEL';

    if (subcommand.endsWith('-list')) {
      const rows = listAntiSpamBypasses(guildId, type);
      const label = isRole ? 'Roles' : isCategory ? 'Categories' : 'Channels';
      const description = rows.length
        ? rows.map(row => type === 'ROLE'
          ? `<@&${row.valueId}>`
          : `<#${row.valueId}>`).join('\n')
        : `No ${label.toLowerCase()} are exempt.`;

      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle(`Anti-Spam Bypass ${label}`)
          .setDescription(description)],
        allowedMentions: { parse: [] }
      });
    }

    const item = isRole
      ? interaction.options.getRole('role', true)
      : interaction.options.getChannel(isCategory ? 'category' : 'channel', true);

    if (isRole && item.id === interaction.guild.id) {
      return interaction.editReply({ content: 'The @everyone role cannot bypass anti-spam.' });
    }

    if (subcommand.endsWith('-add')) {
      const result = addAntiSpamBypass({
        guildId,
        type,
        valueId: item.id,
        addedBy: interaction.user.id
      });

      return interaction.editReply({
        content: result.changes
          ? `${item} now bypasses anti-spam.`
          : `${item} already bypasses anti-spam.`,
        allowedMentions: { parse: [] }
      });
    }

    const result = removeAntiSpamBypass({
      guildId,
      type,
      valueId: item.id
    });

    return interaction.editReply({
      content: result.changes
        ? `${item} no longer bypasses anti-spam.`
        : `${item} does not bypass anti-spam.`,
      allowedMentions: { parse: [] }
    });
  }
};
