const {
  ChannelType,
  EmbedBuilder,
  PermissionsBitField,
  SlashCommandBuilder,
} = require('discord.js');

const { get, run } = require('../../database');

const VERSION = 'Ticket System v3';

function formatChannel(channelId) {
  return channelId ? `<#${channelId}>` : 'Disabled';
}

function formatRole(roleId) {
  return roleId ? `<@&${roleId}>` : 'Not set';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setticketchannel')
    .setDescription('Configure the ticket system')
    .addChannelOption((option) => option
      .setName('support_category')
      .setDescription('Category for support tickets')
      .addChannelTypes(ChannelType.GuildCategory)
      .setRequired(true))
    .addChannelOption((option) => option
      .setName('application_category')
      .setDescription('Optional category for application tickets')
      .addChannelTypes(ChannelType.GuildCategory)
      .setRequired(false))
    .addChannelOption((option) => option
      .setName('bug_category')
      .setDescription('Optional category for bug report tickets')
      .addChannelTypes(ChannelType.GuildCategory)
      .setRequired(false))
    .addChannelOption((option) => option
      .setName('giveaway_category')
      .setDescription('Optional category for giveaway tickets')
      .addChannelTypes(ChannelType.GuildCategory)
      .setRequired(false))
    .addRoleOption((option) => option
      .setName('staff_role')
      .setDescription('Optional role pinged for support and bug tickets')
      .setRequired(false))
    .addRoleOption((option) => option
      .setName('admin_role')
      .setDescription('Optional role pinged for application tickets')
      .setRequired(false))
    .addRoleOption((option) => option
      .setName('giveaway_role')
      .setDescription('Optional role pinged for giveaway tickets')
      .setRequired(false)),

  async execute(interaction) {
    try {
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.editReply({ content: 'You need Administrator permission.' });
      }

      const botMember = interaction.guild.members.me;
      const supportCategory = interaction.options.getChannel('support_category', true);
      const applicationCategory = interaction.options.getChannel('application_category');
      const bugCategory = interaction.options.getChannel('bug_category');
      const giveawayCategory = interaction.options.getChannel('giveaway_category');
      const staffRole = interaction.options.getRole('staff_role');
      const adminRole = interaction.options.getRole('admin_role');
      const giveawayRole = interaction.options.getRole('giveaway_role');

      const categories = [
        supportCategory,
        applicationCategory,
        bugCategory,
        giveawayCategory,
      ].filter(Boolean);

      for (const category of categories) {
        if (category.type !== ChannelType.GuildCategory) {
          return interaction.editReply({ content: 'Please select category channels only.' });
        }
      }

      const roles = [staffRole, adminRole, giveawayRole].filter(Boolean);
      for (const role of roles) {
        if (role.id === interaction.guild.id) {
          return interaction.editReply({ content: 'You cannot use @everyone as a ticket ping role.' });
        }

        if (role.managed) {
          return interaction.editReply({ content: 'You cannot use bot-managed roles.' });
        }

        if (role.position >= botMember.roles.highest.position) {
          return interaction.editReply({ content: 'That role is above the bot. Move the bot role higher first.' });
        }

        if (role.position >= interaction.member.roles.highest.position) {
          return interaction.editReply({ content: 'That role is equal to or above your highest role.' });
        }
      }

      const result = run(
        `INSERT INTO guild_settings (
          guildId,
          ticketCategoryId,
          supportCategoryId,
          applicationCategoryId,
          bugCategoryId,
          giveawayCategoryId,
          staffRoleId,
          adminRoleId,
          giveawayRoleId
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(guildId) DO UPDATE SET
          ticketCategoryId = excluded.ticketCategoryId,
          supportCategoryId = excluded.supportCategoryId,
          applicationCategoryId = excluded.applicationCategoryId,
          bugCategoryId = excluded.bugCategoryId,
          giveawayCategoryId = excluded.giveawayCategoryId,
          staffRoleId = excluded.staffRoleId,
          adminRoleId = excluded.adminRoleId,
          giveawayRoleId = excluded.giveawayRoleId`,
        [
          interaction.guild.id,
          supportCategory.id,
          supportCategory.id,
          applicationCategory?.id ?? null,
          bugCategory?.id ?? null,
          giveawayCategory?.id ?? null,
          staffRole?.id ?? null,
          adminRole?.id ?? null,
          giveawayRole?.id ?? null,
        ],
      );

      if (!result) {
        return interaction.editReply({
          content: 'The ticket settings could not be saved. Check the console for the database error.',
        });
      }

      const saved = get(
        `SELECT ticketCategoryId, supportCategoryId, applicationCategoryId, bugCategoryId,
                giveawayCategoryId, staffRoleId, adminRoleId, giveawayRoleId
         FROM guild_settings
         WHERE guildId = ?`,
        [interaction.guild.id],
      );

      const supportCategoryId = saved?.supportCategoryId || saved?.ticketCategoryId;
      if (!supportCategoryId) {
        return interaction.editReply({
          content: 'The ticket settings saved, but I could not read the support category back from the database.',
        });
      }

      const enabledTypes = [
        'Support',
        saved.applicationCategoryId ? 'Applications' : null,
        saved.bugCategoryId ? 'Bug Reports' : null,
        saved.giveawayCategoryId ? 'Giveaways' : null,
      ].filter(Boolean).join(', ');

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`${VERSION} Updated`)
        .setDescription('Only configured ticket types will appear on the panel.')
        .addFields(
          { name: 'Enabled Types', value: enabledTypes, inline: false },
          { name: 'Support', value: formatChannel(supportCategoryId), inline: true },
          { name: 'Applications', value: formatChannel(saved.applicationCategoryId), inline: true },
          { name: 'Bug Reports', value: formatChannel(saved.bugCategoryId), inline: true },
          { name: 'Giveaways', value: formatChannel(saved.giveawayCategoryId), inline: true },
          { name: 'Staff Role', value: formatRole(saved.staffRoleId), inline: true },
          { name: 'Admin Role', value: formatRole(saved.adminRoleId), inline: true },
          { name: 'Giveaway Role', value: formatRole(saved.giveawayRoleId), inline: true },
          { name: 'Saved For Server', value: interaction.guild.id, inline: false },
        )
        .setFooter({ text: `Set by ${interaction.user.tag}` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('SetTicketChannel Error:', err);
      return interaction.editReply({ content: 'Failed to configure the ticket system.' });
    }
  },
};
