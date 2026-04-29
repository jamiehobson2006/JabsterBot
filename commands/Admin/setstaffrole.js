const {
  PermissionsBitField,
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

const { run } = require('../../database');

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

      const role = interaction.options.getRole('role', true);
      const botMember = interaction.guild.members.me;

      // ========================
      // 🚫 SAFETY CHECKS
      // ========================

      if (role.id === interaction.guild.id) {
        return interaction.editReply({
          content: '❌ You cannot use **@everyone** as staff.'
        });
      }

      if (role.managed) {
        return interaction.editReply({
          content: '❌ You cannot use bot/integration roles.'
        });
      }

      if (role.position >= botMember.roles.highest.position) {
        return interaction.editReply({
          content: '❌ That role is higher than or equal to my highest role.'
        });
      }

      // 🔒 Prevent abuse
      if (role.position >= interaction.member.roles.highest.position) {
        return interaction.editReply({
          content: '❌ You cannot set a role higher than your highest role.'
        });
      }

      // ========================
      // 💾 SAVE (AWAITED)
      // ========================

      await run(
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
        .setColor(0x3498DB) // clean blue hex
        .setTitle('Staff Role Updated')
        .setDescription(`The staff role has been set to ${role}.`)
        .addFields({
          name: 'Role ID',
          value: `\`${role.id}\``,
          inline: true
        })
        .setFooter({ text: `Set by ${interaction.user.tag}` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('SetStaffRole Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to set staff role. Please try again.'
        });
      } else {
        return interaction.reply({
          content: '❌ Failed to set staff role. Please try again.',
          ephemeral: true
        });
      }
    }
  }
};