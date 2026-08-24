const {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');

const {
  addCommandBypass,
  getCommandControl,
  listCommandBypasses,
  listCommandControls,
  normalizeCommandName,
  removeCommandBypass,
  resetCommandControl,
  setCommandEnabled
} = require('../../utils/commandControls');

const textChannelTypes = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
  ChannelType.GuildVoice,
  ChannelType.GuildStageVoice
];

function addCommandOption(subcommand) {
  return subcommand.addStringOption(option =>
    option
      .setName('command')
      .setDescription('Command name without the slash, for example giveaway')
      .setMinLength(1)
      .setMaxLength(32)
      .setRequired(true)
  );
}

function resolveCommand(interaction) {
  const name = normalizeCommandName(
    interaction.options.getString('command', true)
  );

  if (!interaction.client.commands.has(name)) {
    return null;
  }

  return name;
}

function formatBypasses(rows) {
  if (!rows.length) return 'No bypasses configured.';

  return rows.map(row => {
    if (row.type === 'ROLE') return `Role: <@&${row.valueId}>`;
    if (row.type === 'CHANNEL') return `Channel: <#${row.valueId}>`;
    return `Category: <#${row.valueId}>`;
  }).join('\n');
}

function formatControls(rows) {
  if (!rows.length) return 'Every command is currently available.';

  return rows.slice(0, 100).map(row =>
    `/${row.commandName}: ${row.enabled ? 'Enabled override' : 'Disabled'}${row.reason ? `\nReason: ${row.reason}` : ''}`
  ).join('\n\n');
}

function cannotConfigure(commandName) {
  return commandName === 'commandcontrol';
}

module.exports = {
  cooldown: 2000,
  ephemeral: true,

  data: new SlashCommandBuilder()
    .setName('commandcontrol')
    .setDescription('Enable, disable, and restrict bot commands')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(subcommand =>
      addCommandOption(
        subcommand
          .setName('disable')
          .setDescription('Disable a command for this server')
      )
        .addStringOption(option =>
          option
            .setName('reason')
            .setDescription('Optional explanation shown when the command is blocked')
            .setMaxLength(300)
        )
    )
    .addSubcommand(subcommand =>
      addCommandOption(
        subcommand
          .setName('enable')
          .setDescription('Enable a command for this server')
      )
    )
    .addSubcommand(subcommand =>
      addCommandOption(
        subcommand
          .setName('reset')
          .setDescription('Remove a command override and every bypass')
      )
    )
    .addSubcommand(subcommand =>
      addCommandOption(
        subcommand
          .setName('status')
          .setDescription('View one command setting')
      )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('List command overrides')
    )
    .addSubcommand(subcommand =>
      addCommandOption(
        subcommand
          .setName('bypass-role-add')
          .setDescription('Allow a role to use a disabled command')
      )
        .addRoleOption(option => option
          .setName('role')
          .setDescription('Role allowed to bypass the command block')
          .setRequired(true))
    )
    .addSubcommand(subcommand =>
      addCommandOption(
        subcommand
          .setName('bypass-role-remove')
          .setDescription('Remove a role command bypass')
      )
        .addRoleOption(option => option
          .setName('role')
          .setDescription('Role to remove')
          .setRequired(true))
    )
    .addSubcommand(subcommand =>
      addCommandOption(
        subcommand
          .setName('bypass-channel-add')
          .setDescription('Allow a command in one channel')
      )
        .addChannelOption(option => option
          .setName('channel')
          .setDescription('Channel allowed to use the command')
          .addChannelTypes(...textChannelTypes)
          .setRequired(true))
    )
    .addSubcommand(subcommand =>
      addCommandOption(
        subcommand
          .setName('bypass-channel-remove')
          .setDescription('Remove a channel command bypass')
      )
        .addChannelOption(option => option
          .setName('channel')
          .setDescription('Channel to remove')
          .addChannelTypes(...textChannelTypes)
          .setRequired(true))
    )
    .addSubcommand(subcommand =>
      addCommandOption(
        subcommand
          .setName('bypass-category-add')
          .setDescription('Allow a command in a category')
      )
        .addChannelOption(option => option
          .setName('category')
          .setDescription('Category allowed to use the command')
          .addChannelTypes(ChannelType.GuildCategory)
          .setRequired(true))
    )
    .addSubcommand(subcommand =>
      addCommandOption(
        subcommand
          .setName('bypass-category-remove')
          .setDescription('Remove a category command bypass')
      )
        .addChannelOption(option => option
          .setName('category')
          .setDescription('Category to remove')
          .addChannelTypes(ChannelType.GuildCategory)
          .setRequired(true))
    )
    .addSubcommand(subcommand =>
      addCommandOption(
        subcommand
          .setName('bypass-list')
          .setDescription('List all bypasses for a command')
      )
    ),

  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.editReply({
        content: 'You need Manage Server permission.'
      });
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'list') {
      const controls = listCommandControls(interaction.guild.id);

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('Command Controls')
            .setDescription(formatControls(controls))
            .setFooter({ text: `${controls.length} command override(s)` })
            .setTimestamp()
        ],
        allowedMentions: { parse: [] }
      });
    }

    const commandName = resolveCommand(interaction);

    if (!commandName) {
      return interaction.editReply({
        content: 'That command does not exist. Use the command name without `/`.'
      });
    }

    if (cannotConfigure(commandName)) {
      return interaction.editReply({
        content: 'The command-control command cannot be disabled or restricted.'
      });
    }

    if (subcommand === 'status') {
      const control = getCommandControl(interaction.guild.id, commandName);
      const bypasses = listCommandBypasses(interaction.guild.id, commandName);

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(control?.enabled === 0 ? 0xED4245 : 0x57F287)
            .setTitle(`/${commandName} Command Control`)
            .addFields(
              {
                name: 'Status',
                value: control?.enabled === 0 ? 'Disabled' : 'Enabled',
                inline: true
              },
              {
                name: 'Updated',
                value: control?.updatedAt
                  ? `<t:${Math.floor(control.updatedAt / 1000)}:R>`
                  : 'Default setting',
                inline: true
              },
              {
                name: 'Reason',
                value: control?.reason || 'No reason set.'
              },
              {
                name: 'Bypasses',
                value: formatBypasses(bypasses)
              }
            )
            .setTimestamp()
        ],
        allowedMentions: { parse: [] }
      });
    }

    if (subcommand === 'disable' || subcommand === 'enable') {
      const enabled = subcommand === 'enable';

      setCommandEnabled({
        guildId: interaction.guild.id,
        commandName,
        enabled,
        reason: enabled ? null : interaction.options.getString('reason'),
        updatedBy: interaction.user.id
      });

      return interaction.editReply({
        content: enabled
          ? `/${commandName} is now enabled.`
          : `/${commandName} is now disabled.`,
        allowedMentions: { parse: [] }
      });
    }

    if (subcommand === 'reset') {
      resetCommandControl(interaction.guild.id, commandName);

      return interaction.editReply({
        content: `/${commandName} was reset to its default availability.`
      });
    }

    if (subcommand === 'bypass-list') {
      const bypasses = listCommandBypasses(interaction.guild.id, commandName);

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`/${commandName} Bypasses`)
            .setDescription(formatBypasses(bypasses))
            .setFooter({ text: `${bypasses.length} bypass(es)` })
        ],
        allowedMentions: { parse: [] }
      });
    }

    const isRole = subcommand.startsWith('bypass-role-');
    const isCategory = subcommand.startsWith('bypass-category-');
    const type = isRole ? 'ROLE' : isCategory ? 'CATEGORY' : 'CHANNEL';
    const item = isRole
      ? interaction.options.getRole('role', true)
      : interaction.options.getChannel(isCategory ? 'category' : 'channel', true);

    if (isRole && item.id === interaction.guild.id) {
      return interaction.editReply({
        content: 'The @everyone role cannot bypass a disabled command.'
      });
    }

    if (subcommand.endsWith('-add')) {
      const result = addCommandBypass({
        guildId: interaction.guild.id,
        commandName,
        type,
        valueId: item.id,
        addedBy: interaction.user.id
      });

      return interaction.editReply({
        content: result.changes
          ? `${item} can now use /${commandName} while it is disabled.`
          : `${item} already bypasses /${commandName}.`,
        allowedMentions: { parse: [] }
      });
    }

    const result = removeCommandBypass({
      guildId: interaction.guild.id,
      commandName,
      type,
      valueId: item.id
    });

    return interaction.editReply({
      content: result.changes
        ? `${item} no longer bypasses /${commandName}.`
        : `${item} does not bypass /${commandName}.`,
      allowedMentions: { parse: [] }
    });
  }
};
