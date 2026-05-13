const {
  PermissionsBitField,
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

const { run, get } = require('../../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setstaffrole')
    .setDescription('Set the staff role for this server')
    .addRoleOption(option =>
      option
        .setName('role')
        .setDescription('The role to set as staff')
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
          content: '❌ You cannot use **@everyone** as staff.'
        });
      }

      // Managed roles
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

      // ========================
      // 🧠 CHECK EXISTING
      // ========================
      const existing = get(
        `SELECT staffRoleId FROM guild_settings WHERE guildId=?`,
        [interaction.guild.id]
      );

      const alreadySet = existing?.staffRoleId === role.id;

      // ========================
      // 💾 SAVE
      // ========================
      run(
        `INSERT INTO guild_settings (guildId, staffRoleId)
         VALUES (?, ?)
         ON CONFLICT(guildId)
         DO UPDATE SET staffRoleId = excluded.staffRoleId`,
        [interaction.guild.id, role.id]
      );

      // ========================
      // 🎨 RESPONSE
      // ========================
      const embed = new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle('👮 Staff Role Updated')
        .setDescription(
          alreadySet
            ? `${role} is already set as the staff role.`
            : `Staff role has been set to ${role}.`
        )
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
      console.error('SetStaffRole Error:', err);

      return interaction.editReply({
        content: '❌ Failed to set staff role.'
      });
    }
  }
};