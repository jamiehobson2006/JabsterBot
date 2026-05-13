const {
  PermissionsBitField,
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

const { sendLog, createLogEmbed } = require('../../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Add or remove a role from a user')
    .addStringOption(option =>
      option
        .setName('action')
        .setDescription('Add or remove')
        .setRequired(true)
        .addChoices(
          { name: 'Add', value: 'add' },
          { name: 'Remove', value: 'remove' }
        )
    )
    .addUserOption(option =>
      option.setName('user').setDescription('User').setRequired(true)
    )
    .addRoleOption(option =>
      option.setName('role').setDescription('Role').setRequired(true)
    ),

  async execute(interaction) {
    try {

      // 🔐 User permission
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ManageRoles)) {
        return interaction.editReply({
          content: '❌ You need **Manage Roles** permission.'
        });
      }

      const botMember = interaction.guild.members.me;

      // ❌ Bot permission
      if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        return interaction.editReply({
          content: '❌ I do not have permission to manage roles.'
        });
      }

      const action = interaction.options.getString('action', true);
      const user = interaction.options.getUser('user', true);
      const role = interaction.options.getRole('role', true);

      const member = await interaction.guild.members.fetch(user.id).catch(() => null);

      if (!member) {
        return interaction.editReply({ content: '❌ User not found in this server.' });
      }

      // 🚫 @everyone
      if (role.id === interaction.guild.id) {
        return interaction.editReply({ content: '❌ You cannot manage @everyone.' });
      }

      // 🚫 Managed roles
      if (role.managed) {
        return interaction.editReply({
          content: '❌ Cannot manage bot/integration roles.'
        });
      }

      // 🚫 Dangerous roles (optional but recommended)
      if (role.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.editReply({
          content: '❌ You cannot manage roles with **Administrator** permission.'
        });
      }

      // 🚫 Bot hierarchy
      if (role.position >= botMember.roles.highest.position) {
        return interaction.editReply({
          content: '❌ That role is higher than my highest role.'
        });
      }

      // 🚫 Executor hierarchy
      if (role.position >= interaction.member.roles.highest.position) {
        return interaction.editReply({
          content: '❌ That role is higher than your highest role.'
        });
      }

      // 🚫 Target hierarchy
      if (member.roles.highest.position >= interaction.member.roles.highest.position) {
        return interaction.editReply({
          content: '❌ You cannot manage this user.'
        });
      }

      // ========================
      // ADD ROLE
      // ========================
      if (action === 'add') {
        if (member.roles.cache.has(role.id)) {
          return interaction.editReply({
            content: '❌ User already has that role.'
          });
        }

        await member.roles.add(role).catch(() => {
          throw new Error('Failed to add role');
        });

        const embed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('Role Added')
          .setDescription(`${role} added to ${user}`)
          .addFields({ name: 'Role ID', value: `\`${role.id}\`` })
          .setFooter({ text: `By ${interaction.user.tag}` })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        const log = createLogEmbed({
          action: 'ROLE ADD',
          user,
          moderator: interaction.user,
          reason: `Added role ${role.name}`
        });

        return sendLog(interaction.client, interaction.guild.id, log);
      }

      // ========================
      // REMOVE ROLE
      // ========================
      if (action === 'remove') {
        if (!member.roles.cache.has(role.id)) {
          return interaction.editReply({
            content: '❌ User does not have that role.'
          });
        }

        await member.roles.remove(role).catch(() => {
          throw new Error('Failed to remove role');
        });

        const embed = new EmbedBuilder()
          .setColor(0xE67E22)
          .setTitle('Role Removed')
          .setDescription(`${role} removed from ${user}`)
          .addFields({ name: 'Role ID', value: `\`${role.id}\`` })
          .setFooter({ text: `By ${interaction.user.tag}` })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        const log = createLogEmbed({
          action: 'ROLE REMOVE',
          user,
          moderator: interaction.user,
          reason: `Removed role ${role.name}`
        });

        return sendLog(interaction.client, interaction.guild.id, log);
      }

      return interaction.editReply({
        content: '❌ Invalid action.'
      });

    } catch (err) {
      console.error('Role Command Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to manage role. Check my permissions and role hierarchy.'
        });
      } else {
        return interaction.reply({
          content: '❌ Failed to manage role.',
          ephemeral: true
        });
      }
    }
  }
};