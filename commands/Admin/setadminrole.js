const {
  PermissionsBitField,
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

const { run } = require('../../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setadminrole')
    .setDescription('Set the admin role for this server')
    .addRoleOption(option =>
      option
        .setName('role')
        .setDescription('The role to set as admin')
        .setRequired(true)
    ),

  async execute(interaction) {
    try {
      const role = interaction.options.getRole('role', true);
      const botMember = interaction.guild.members.me;

      // ========================
      // 🔐 PERMISSION CHECK
      // ========================
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.editReply({
          content: '❌ You need **Administrator** to use this command.'
        });
      }

      // ========================
      // 🚫 SAFETY CHECKS
      // ========================

      // @everyone
      if (role.id === interaction.guild.id) {
        return interaction.editReply({
          content: '❌ You cannot use **@everyone** as admin.'
        });
      }

      // Managed roles (bot roles)
      if (role.managed) {
        return interaction.editReply({
          content: '❌ You cannot use bot/integration roles.'
        });
      }

      // Bot hierarchy
      if (role.position >= botMember.roles.highest.position) {
        return interaction.editReply({
          content: '❌ That role is higher than or equal to my highest role.'
        });
      }

      // User hierarchy
      if (role.position >= interaction.member.roles.highest.position) {
        return interaction.editReply({
          content: '❌ You cannot set a role higher than your highest role.'
        });
      }

      // Already set check (nice UX)
      const current = await run(
        `SELECT adminRoleId FROM guild_settings WHERE guildId=?`,
        [interaction.guild.id]
      );

      // ========================
      // 💾 SAVE
      // ========================
      run(
        `INSERT INTO guild_settings (guildId, adminRoleId)
         VALUES (?, ?)
         ON CONFLICT(guildId)
         DO UPDATE SET adminRoleId = excluded.adminRoleId`,
        [interaction.guild.id, role.id]
      );

      // ========================
      // 🎨 RESPONSE
      // ========================
      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('🛡 Admin Role Updated')
        .setDescription(`Admin role has been set to ${role}.`)
        .addFields(
          {
            name: 'Role',
            value: `${role}`,
            inline: true
          },
          {
            name: 'Role ID',
            value: `\`${role.id}\``,
            inline: true
          }
        )
        .setFooter({ text: `Set by ${interaction.user.tag}` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('SetAdminRole Error:', err);

      return interaction.editReply({
        content: '❌ Failed to set admin role.'
      });
    }
  }
};