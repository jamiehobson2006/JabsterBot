const {
  PermissionsBitField,
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

const { run } = require('../../database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setgiveawayrole')
    .setDescription('Set the role that handles giveaway claim tickets')
    .addRoleOption(option =>
      option
        .setName('role')
        .setDescription('Role that will see and be pinged in giveaway tickets')
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
          content: '❌ You cannot use **@everyone**.'
        });
      }

      if (role.managed) {
        return interaction.editReply({
          content: '❌ You cannot use bot/integration roles.'
        });
      }

      // Bot hierarchy check (important for ticket perms)
      if (role.position >= botMember.roles.highest.position) {
        return interaction.editReply({
          content: '❌ That role is higher than or equal to my highest role.'
        });
      }

      // Prevent user abuse
      if (role.position >= interaction.member.roles.highest.position) {
        return interaction.editReply({
          content: '❌ You cannot set a role higher than your highest role.'
        });
      }

      // ========================
      // 💾 SAVE (AWAITED)
      // ========================

      await run(
        `INSERT INTO guild_settings (guildId, giveawayRoleId)
         VALUES (?, ?)
         ON CONFLICT(guildId)
         DO UPDATE SET giveawayRoleId = excluded.giveawayRoleId`,
        [interaction.guild.id, role.id]
      );

      // ========================
      // 🎨 RESPONSE
      // ========================

      const embed = new EmbedBuilder()
        .setColor(0xF1C40F) // gold hex (more consistent)
        .setTitle('Giveaway Role Updated')
        .setDescription(`Giveaway claim tickets will now be handled by ${role}.`)
        .addFields({
          name: 'Role ID',
          value: `\`${role.id}\``,
          inline: true
        })
        .setFooter({ text: `Set by ${interaction.user.tag}` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('SetGiveawayRole Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to set giveaway role. Please try again.'
        });
      } else {
        return interaction.reply({
          content: '❌ Failed to set giveaway role. Please try again.',
          ephemeral: true
        });
      }
    }
  }
};