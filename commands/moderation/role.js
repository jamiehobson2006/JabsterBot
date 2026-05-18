const {
  PermissionsBitField,
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

const {
  sendLog,
  createLogEmbed
} = require('../../utils/logger');

// ========================
// 🚫 DANGEROUS PERMISSIONS
// ========================
const dangerousPerms = [

  PermissionsBitField.Flags.Administrator,

  PermissionsBitField.Flags.ManageGuild,
  PermissionsBitField.Flags.ManageRoles,
  PermissionsBitField.Flags.ManageChannels,
  PermissionsBitField.Flags.ManageMessages,

  PermissionsBitField.Flags.BanMembers,
  PermissionsBitField.Flags.KickMembers,
  PermissionsBitField.Flags.ModerateMembers,

  PermissionsBitField.Flags.MentionEveryone

];

// ========================
// 🔐 CHECK ROLE SAFETY
// ========================
function hasUnsafePermissions(
  executor,
  role
) {

  for (const perm of dangerousPerms) {

    // Role has dangerous permission
    if (role.permissions.has(perm)) {

      // Executor DOES NOT have it
      if (
        !executor.permissions.has(perm)
      ) {

        return true;
      }
    }
  }

  return false;
}

module.exports = {

  cooldown: 3000,

  data: new SlashCommandBuilder()

    .setName('role')

    .setDescription('Add or remove a role')

    .addStringOption(option =>
      option
        .setName('action')
        .setDescription('Add or remove')
        .setRequired(true)
        .addChoices(

          {
            name: 'Add',
            value: 'add'
          },

          {
            name: 'Remove',
            value: 'remove'
          }
        )
    )

    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User')
        .setRequired(true)
    )

    .addRoleOption(option =>
      option
        .setName('role')
        .setDescription('Role')
        .setRequired(true)
    ),

  async execute(interaction) {

    try {

      const action =
        interaction.options.getString(
          'action',
          true
        );

      const user =
        interaction.options.getUser(
          'user',
          true
        );

      const role =
        interaction.options.getRole(
          'role',
          true
        );

      const botMember =
        interaction.guild.members.me;

      const executor =
        interaction.member;

      const member =
        await interaction.guild.members
          .fetch(user.id)
          .catch(() => null);

      if (!member) {

        return interaction.editReply({
          content:
            '❌ User not found in this server.'
        });
      }

      // ========================
      // 🤖 BOT PERMISSION
      // ========================
      if (
        !botMember.permissions.has(
          PermissionsBitField.Flags.ManageRoles
        )
      ) {

        return interaction.editReply({
          content:
            '❌ I do not have permission to manage roles.'
        });
      }

      // ========================
      // 🚫 @EVERYONE
      // ========================
      if (
        role.id === interaction.guild.id
      ) {

        return interaction.editReply({
          content:
            '❌ You cannot manage @everyone.'
        });
      }

      // ========================
      // 🚫 MANAGED ROLE
      // ========================
      if (role.managed) {

        return interaction.editReply({
          content:
            '❌ You cannot manage bot/integration roles.'
        });
      }

      // ========================
      // 🤖 BOT HIERARCHY
      // ========================
      if (
        role.position >=
        botMember.roles.highest.position
      ) {

        return interaction.editReply({
          content:
            '❌ That role is higher than my highest role.'
        });
      }

      // ========================
      // 👑 ADMIN BYPASS
      // ========================
      const isAdmin =
        executor.permissions.has(
          PermissionsBitField.Flags.Administrator
        );

      // ========================
      // 👤 NORMAL USERS
      // ========================
      if (!isAdmin) {

        // 🚫 ONLY SELF
        if (user.id !== interaction.user.id) {

          return interaction.editReply({
            content:
              '❌ You can only manage your own roles.'
          });
        }

        // 🚫 HIGHER ROLE
        if (
          role.position >=
          executor.roles.highest.position
        ) {

          return interaction.editReply({
            content:
              '❌ You cannot assign a role higher than or equal to your highest role.'
          });
        }

        // 🚫 DANGEROUS PERMISSIONS
        if (
          hasUnsafePermissions(
            executor,
            role
          )
        ) {

          return interaction.editReply({
            content:
              '❌ You cannot assign roles with permissions you do not already have.'
          });
        }
      }

      // ========================
      // 👑 ADMIN TARGET CHECK
      // ========================
      if (
        isAdmin &&
        member.roles.highest.position >=
        executor.roles.highest.position &&
        member.id !== executor.id
      ) {

        return interaction.editReply({
          content:
            '❌ You cannot manage this user due to role hierarchy.'
        });
      }

      // ========================
      // ➕ ADD ROLE
      // ========================
      if (action === 'add') {

        if (
          member.roles.cache.has(role.id)
        ) {

          return interaction.editReply({
            content:
              '❌ User already has that role.'
          });
        }

        await member.roles.add(role);

        const embed =
          new EmbedBuilder()

            .setColor(0x57F287)

            .setTitle('➕ Role Added')

            .setDescription(
              `${role} added to ${user}`
            )

            .addFields({

              name: 'Role ID',

              value: `\`${role.id}\``
            })

            .setFooter({
              text:
                `By ${interaction.user.tag}`
            })

            .setTimestamp();

        await interaction.editReply({
          embeds: [embed]
        });

        const log =
          createLogEmbed({

            action: 'ROLE_ADD',

            user,

            moderator: interaction.user,

            reason:
              `Added role ${role.name}`
          });

        return sendLog(
          interaction.client,
          interaction.guild.id,
          log
        );
      }

      // ========================
      // ➖ REMOVE ROLE
      // ========================
      if (action === 'remove') {

        if (
          !member.roles.cache.has(role.id)
        ) {

          return interaction.editReply({
            content:
              '❌ User does not have that role.'
          });
        }

        await member.roles.remove(role);

        const embed =
          new EmbedBuilder()

            .setColor(0xE67E22)

            .setTitle('➖ Role Removed')

            .setDescription(
              `${role} removed from ${user}`
            )

            .addFields({

              name: 'Role ID',

              value: `\`${role.id}\``
            })

            .setFooter({
              text:
                `By ${interaction.user.tag}`
            })

            .setTimestamp();

        await interaction.editReply({
          embeds: [embed]
        });

        const log =
          createLogEmbed({

            action: 'ROLE_REMOVE',

            user,

            moderator: interaction.user,

            reason:
              `Removed role ${role.name}`
          });

        return sendLog(
          interaction.client,
          interaction.guild.id,
          log
        );
      }

      return interaction.editReply({
        content:
          '❌ Invalid action.'
      });

    } catch (err) {

      console.error(
        'Role Command Error:',
        err
      );

      if (
        interaction.deferred ||
        interaction.replied
      ) {

        return interaction.editReply({
          content:
            '❌ Failed to manage role.'
        });
      }

      return interaction.reply({

        content:
          '❌ Failed to manage role.',

        ephemeral: true
      });
    }
  }
};