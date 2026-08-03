const {
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');

const {
  run
} = require('../../database');

const {
  addCensorTerm,
  getCensorSettings,
  listCensorTerms,
  removeCensorTerm
} = require('../../utils/censor');

function canManageCensor(interaction, settings) {
  return interaction.memberPermissions.has(
    PermissionFlagsBits.ManageGuild
  ) || Boolean(
    settings?.censorRoleId &&
    interaction.member.roles.cache.has(settings.censorRoleId)
  );
}

function requireCensorAccess(interaction, settings) {
  if (canManageCensor(interaction, settings)) {
    return null;
  }

  return 'You need Manage Server permission or the configured censor role.';
}

module.exports = {
  cooldown: 2500,
  ephemeral: true,

  data: new SlashCommandBuilder()
    .setName('censor')
    .setDescription('Manage automatic message censoring')
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Add a word or phrase to the censor list')
        .addStringOption(option =>
          option
            .setName('term')
            .setDescription('Word or phrase to delete automatically')
            .setMinLength(1)
            .setMaxLength(100)
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Remove a word or phrase from the censor list')
        .addStringOption(option =>
          option
            .setName('term')
            .setDescription('Existing word or phrase')
            .setMinLength(1)
            .setMaxLength(100)
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('View the configured censor list')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('clear')
        .setDescription('Remove every word and phrase from the censor list')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('setrole')
        .setDescription('Set a role allowed to manage the censor list')
        .addRoleOption(option =>
          option
            .setName('role')
            .setDescription('Role allowed to use /censor')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('clearrole')
        .setDescription('Require Manage Server to manage censoring')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('status')
        .setDescription('View censoring status')
    ),

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
    if (accessError) {
      return interaction.editReply({ content: accessError });
    }

    if (subcommand === 'setrole') {
      const role = interaction.options.getRole('role', true);

      if (role.managed || role.id === interaction.guild.roles.everyone.id) {
        return interaction.editReply({
          content: 'Choose a normal server role.'
        });
      }

      run(
        `INSERT INTO guild_settings (guildId, censorRoleId)
         VALUES (?, ?)
         ON CONFLICT(guildId)
         DO UPDATE SET censorRoleId = excluded.censorRoleId`,
        [interaction.guild.id, role.id]
      );

      return interaction.editReply({
        content: `${role} can now manage the censor list.`
      });
    }

    if (subcommand === 'clearrole') {
      run(
        `INSERT INTO guild_settings (guildId, censorRoleId)
         VALUES (?, NULL)
         ON CONFLICT(guildId)
         DO UPDATE SET censorRoleId = NULL`,
        [interaction.guild.id]
      );

      return interaction.editReply({
        content: 'Censor-list management now requires Manage Server permission.'
      });
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
         ON CONFLICT(guildId)
         DO UPDATE SET censorEnabled = 1`,
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
        content: changes
          ? `Removed \`${term}\` from the censor list.`
          : 'That term is not in the censor list.'
      });
    }

    if (subcommand === 'clear') {
      const result = run(
        `DELETE FROM censor_words
         WHERE guildId = ?`,
        [interaction.guild.id]
      );

      return interaction.editReply({
        content: `Removed ${result.changes} censor term(s).`
      });
    }

    const terms = listCensorTerms(interaction.guild.id);

    if (subcommand === 'list') {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('Censor List')
            .setDescription(
              terms.length
                ? terms.slice(0, 100).map(item => `- \`${item.word}\``).join('\n')
                : 'No terms are configured.'
            )
            .setFooter({ text: `${terms.length} term(s) configured` })
        ]
      });
    }

    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(settings?.censorEnabled ? 0x57F287 : 0xED4245)
          .setTitle('Censor Status')
          .addFields(
            {
              name: 'Status',
              value: settings?.censorEnabled ? 'Active' : 'Inactive',
              inline: true
            },
            {
              name: 'Manager Role',
              value: settings?.censorRoleId
                ? `<@&${settings.censorRoleId}>`
                : 'Manage Server permission',
              inline: true
            },
            {
              name: 'Terms',
              value: `${terms.length}`,
              inline: true
            }
          )
          .setFooter({ text: 'Censoring automatically activates when moderation logging is configured.' })
      ]
    });
  }
};
