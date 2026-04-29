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
        .setName('category')
        .setDescription('Category where tickets will be created')
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true)
    )

    .addRoleOption(option =>
      option
        .setName('staff_role')
        .setDescription('Role that handles support/application tickets')
        .setRequired(false)
    )

    .addRoleOption(option =>
      option
        .setName('admin_role')
        .setDescription('Admin role (extra access / pings)')
        .setRequired(false)
    )

    .addRoleOption(option =>
      option
        .setName('giveaway_role')
        .setDescription('Role that handles giveaway claim tickets')
        .setRequired(false)
    ),

  async execute(interaction) {
    try {
      // ✅ Ensure reply exists
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
      }

      // 🔐 Permission check
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.editReply({
          content: '❌ You need **Administrator** to use this command.'
        });
      }

      const category = interaction.options.getChannel('category', true);
      const staffRole = interaction.options.getRole('staff_role');
      const adminRole = interaction.options.getRole('admin_role');
      const giveawayRole = interaction.options.getRole('giveaway_role');

      const botMember = interaction.guild.members.me;

      // ========================
      // 🛡 CATEGORY CHECK
      // ========================

      if (category.type !== ChannelType.GuildCategory) {
        return interaction.editReply({
          content: '❌ You must select a valid **category**.'
        });
      }

      // ========================
      // 🛡 ROLE VALIDATION
      // ========================

      const roles = [staffRole, adminRole, giveawayRole].filter(Boolean);

      for (const role of roles) {
        if (role.id === interaction.guild.id) {
          return interaction.editReply({
            content: '❌ You cannot use **@everyone** as a role.'
          });
        }

        if (role.managed) {
          return interaction.editReply({
            content: '❌ You cannot use bot/integration roles.'
          });
        }

        if (role.position >= botMember.roles.highest.position) {
          return interaction.editReply({
            content: '❌ One of the roles is higher than or equal to my highest role.'
          });
        }

        if (role.position >= interaction.member.roles.highest.position) {
          return interaction.editReply({
            content: '❌ You cannot set a role higher than your highest role.'
          });
        }
      }

      // ========================
      // 🔄 GET EXISTING DATA (IMPORTANT)
      // ========================

      const existing = await get(
        `SELECT * FROM guild_settings WHERE guildId = ?`,
        [interaction.guild.id]
      );

      // ========================
      // 💾 SAVE (SAFE MERGE)
      // ========================

      await run(
        `INSERT INTO guild_settings (
          guildId,
          ticketCategoryId,
          staffRoleId,
          adminRoleId,
          giveawayRoleId
        )
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(guildId) DO UPDATE SET
          ticketCategoryId = excluded.ticketCategoryId,
          staffRoleId = COALESCE(excluded.staffRoleId, guild_settings.staffRoleId),
          adminRoleId = COALESCE(excluded.adminRoleId, guild_settings.adminRoleId),
          giveawayRoleId = COALESCE(excluded.giveawayRoleId, guild_settings.giveawayRoleId)
        `,
        [
          interaction.guild.id,
          category.id,
          staffRole?.id ?? null,
          adminRole?.id ?? null,
          giveawayRole?.id ?? null
        ]
      );

      // ========================
      // 🎨 RESPONSE
      // ========================

      const embed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setTitle('Ticket System Updated')
        .setDescription('Your ticket system configuration has been updated.')
        .addFields(
          {
            name: 'Category',
            value: `${category}`,
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
      console.error('SetTicketChannel Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to configure ticket system.'
        });
      } else {
        return interaction.reply({
          content: '❌ Failed to configure ticket system.',
          ephemeral: true
        });
      }
    }
  }
};