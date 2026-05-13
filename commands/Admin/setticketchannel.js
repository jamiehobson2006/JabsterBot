const {
  PermissionsBitField,
  ChannelType,
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

const { run, get } = require('../../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setticketchannel')
    .setDescription('Configure the ticket system')

    .addChannelOption(option =>
      option
        .setName('support_category')
        .setDescription('Category for support tickets')
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true)
    )

    .addChannelOption(option =>
      option
        .setName('application_category')
        .setDescription('Category for application tickets')
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(false)
    )

    .addChannelOption(option =>
      option
        .setName('giveaway_category')
        .setDescription('Category for giveaway tickets')
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(false)
    )

    .addRoleOption(option =>
      option.setName('staff_role').setDescription('Staff role').setRequired(false)
    )

    .addRoleOption(option =>
      option.setName('admin_role').setDescription('Admin role').setRequired(false)
    )

    .addRoleOption(option =>
      option.setName('giveaway_role').setDescription('Giveaway role').setRequired(false)
    ),

  async execute(interaction) {
    try {
      const botMember = interaction.guild.members.me;

      // ========================
      // 🔐 PERMISSION
      // ========================
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.editReply({
          content: '❌ You need **Administrator**.'
        });
      }

      const supportCat = interaction.options.getChannel('support_category', true);
      const appCat = interaction.options.getChannel('application_category');
      const giveawayCat = interaction.options.getChannel('giveaway_category');

      const staffRole = interaction.options.getRole('staff_role');
      const adminRole = interaction.options.getRole('admin_role');
      const giveawayRole = interaction.options.getRole('giveaway_role');

      // ========================
      // 🛡 CATEGORY VALIDATION
      // ========================
      const categories = [supportCat, appCat, giveawayCat].filter(Boolean);

      for (const cat of categories) {
        if (cat.type !== ChannelType.GuildCategory) {
          return interaction.editReply({
            content: '❌ Invalid category selected.'
          });
        }
      }

      // ========================
      // 🛡 ROLE VALIDATION
      // ========================
      const roles = [staffRole, adminRole, giveawayRole].filter(Boolean);

      for (const role of roles) {
        if (role.id === interaction.guild.id) {
          return interaction.editReply({ content: '❌ Cannot use @everyone.' });
        }

        if (role.managed) {
          return interaction.editReply({ content: '❌ Cannot use bot roles.' });
        }

        if (role.position >= botMember.roles.highest.position) {
          return interaction.editReply({ content: '❌ Role above bot.' });
        }

        if (role.position >= interaction.member.roles.highest.position) {
          return interaction.editReply({ content: '❌ Role above you.' });
        }
      }

      // ========================
      // 🧠 GET EXISTING
      // ========================
      const existing = get(
        `SELECT * FROM guild_settings WHERE guildId=?`,
        [interaction.guild.id]
      );

      // ========================
      // 💾 SAVE
      // ========================
      run(
        `INSERT INTO guild_settings (
          guildId,
          supportCategoryId,
          applicationCategoryId,
          giveawayCategoryId,
          staffRoleId,
          adminRoleId,
          giveawayRoleId
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(guildId) DO UPDATE SET
          supportCategoryId = excluded.supportCategoryId,
          applicationCategoryId = COALESCE(excluded.applicationCategoryId, guild_settings.applicationCategoryId),
          giveawayCategoryId = COALESCE(excluded.giveawayCategoryId, guild_settings.giveawayCategoryId),
          staffRoleId = COALESCE(excluded.staffRoleId, guild_settings.staffRoleId),
          adminRoleId = COALESCE(excluded.adminRoleId, guild_settings.adminRoleId),
          giveawayRoleId = COALESCE(excluded.giveawayRoleId, guild_settings.giveawayRoleId)
        `,
        [
          interaction.guild.id,
          supportCat.id,
          appCat?.id ?? null,
          giveawayCat?.id ?? null,
          staffRole?.id ?? null,
          adminRole?.id ?? null,
          giveawayRole?.id ?? null
        ]
      );

      // ========================
      // 🎨 EMBED
      // ========================
      const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('🎟 Ticket System Updated')
        .addFields(
          { name: 'Support', value: `${supportCat}`, inline: true },
          {
            name: 'Applications',
            value: appCat ? `${appCat}` : (existing?.applicationCategoryId ? `<#${existing.applicationCategoryId}>` : 'Not set'),
            inline: true
          },
          {
            name: 'Giveaways',
            value: giveawayCat ? `${giveawayCat}` : (existing?.giveawayCategoryId ? `<#${existing.giveawayCategoryId}>` : 'Not set'),
            inline: true
          },
          {
            name: 'Staff Role',
            value: staffRole ? `${staffRole}` : (existing?.staffRoleId ? `<@&${existing.staffRoleId}>` : 'Not set'),
            inline: true
          },
          {
            name: 'Admin Role',
            value: adminRole ? `${adminRole}` : (existing?.adminRoleId ? `<@&${existing.adminRoleId}>` : 'Not set'),
            inline: true
          },
          {
            name: 'Giveaway Role',
            value: giveawayRole ? `${giveawayRole}` : (existing?.giveawayRoleId ? `<@&${existing.giveawayRoleId}>` : 'Not set'),
            inline: true
          }
        )
        .setFooter({ text: `Set by ${interaction.user.tag}` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error(err);

      return interaction.editReply({
        content: '❌ Failed to configure ticket system.'
      });
    }
  }
};