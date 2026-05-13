const {
  PermissionsBitField,
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

const { run, get } = require('../../database');

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
          content: '❌ You cannot use **@everyone**.'
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
        `SELECT giveawayRoleId FROM guild_settings WHERE guildId=?`,
        [interaction.guild.id]
      );

      const alreadySet = existing?.giveawayRoleId === role.id;

      // ========================
      // 💾 SAVE
      // ========================
      run(
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
        .setColor(0xF1C40F)
        .setTitle('🎉 Giveaway Role Updated')
        .setDescription(
          alreadySet
            ? `${role} is already set as the giveaway role.`
            : `Giveaway tickets will now be handled by ${role}.`
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
      console.error('SetGiveawayRole Error:', err);

      return interaction.editReply({
        content: '❌ Failed to set giveaway role.'
      });
    }
  }
};