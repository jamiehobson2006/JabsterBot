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
      // ✅ Always reply properly (no defer assumed)
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
      }

      // 🔐 Permission check
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.editReply({
          content: '❌ You need **Administrator** to use this command.'
        });
      }

      const role = interaction.options.getRole('role', true);
      const botMember = interaction.guild.members.me;

      // ========================
      // 🚫 SAFETY CHECKS
      // ========================

      // @everyone check
      if (role.id === interaction.guild.id) {
        return interaction.editReply({
          content: '❌ You cannot use **@everyone** as admin.'
        });
      }

      // Managed roles (bots/integrations)
      if (role.managed) {
        return interaction.editReply({
          content: '❌ You cannot use bot/integration roles.'
        });
      }

      // Bot hierarchy check
      if (role.position >= botMember.roles.highest.position) {
        return interaction.editReply({
          content: '❌ That role is higher than or equal to my highest role.'
        });
      }

      // Optional: Prevent user from setting role above themselves
      if (role.position >= interaction.member.roles.highest.position) {
        return interaction.editReply({
          content: '❌ You cannot set a role higher than your highest role.'
        });
      }

      // ========================
      // 💾 SAVE (AWAITED)
      // ========================

      await run(
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
        .setColor(0x57F287) // cleaner than "Green"
        .setTitle('Admin Role Updated')
        .setDescription(`The admin role has been set to ${role}.`)
        .addFields({
          name: 'Role ID',
          value: `\`${role.id}\``,
          inline: true
        })
        .setFooter({ text: `Set by ${interaction.user.tag}` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('SetAdminRole Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to set admin role. Please try again.'
        });
      } else {
        return interaction.reply({
          content: '❌ Failed to set admin role. Please try again.',
          ephemeral: true
        });
      }
    }
  }
};