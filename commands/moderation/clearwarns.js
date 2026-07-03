const {
  EmbedBuilder,
  PermissionsBitField,
  SlashCommandBuilder
} = require('discord.js');

const {
  get,
  run
} = require('../../database');

const {
  createAuditEmbed,
  logAudit
} = require('../../utils/logger');

module.exports = {
  cooldown: 3000,

  data:
    new SlashCommandBuilder()
      .setName('clearwarns')
      .setDescription('Clear all warnings for a user')
      .addUserOption(option =>
        option
          .setName('user')
          .setDescription('User')
          .setRequired(true)
      ),

  async execute(interaction) {
    try {
      if (
        !interaction.memberPermissions.has(
          PermissionsBitField.Flags.ManageGuild
        )
      ) {
        return interaction.editReply({
          content:
            'You need Manage Server permission.'
        });
      }

      const user =
        interaction.options.getUser(
          'user',
          true
        );

      if (user.id === interaction.user.id) {
        return interaction.editReply({
          content:
            'You cannot clear your own warnings.'
        });
      }

      if (user.id === interaction.client.user.id) {
        return interaction.editReply({
          content:
            "You cannot clear the bot's warnings."
        });
      }

      if (user.id === interaction.guild.ownerId) {
        return interaction.editReply({
          content:
            'You cannot clear warnings for the server owner.'
        });
      }

      const member =
        await interaction.guild.members
          .fetch(user.id)
          .catch(() => null);

      if (
        member &&
        member.roles.highest.position >=
          interaction.member.roles.highest.position &&
        interaction.user.id !== interaction.guild.ownerId
      ) {
        return interaction.editReply({
          content:
            'You cannot clear warnings for this user due to role hierarchy.'
        });
      }

      if (
        member?.permissions.has(
          PermissionsBitField.Flags.Administrator
        ) &&
        interaction.user.id !== interaction.guild.ownerId
      ) {
        return interaction.editReply({
          content:
            'You cannot clear warnings for administrators.'
        });
      }

      const warns =
        get(
          `SELECT COUNT(*) AS total
           FROM warns
           WHERE guildId = ?
           AND userId = ?`,
          [
            interaction.guild.id,
            user.id
          ]
        );

      const warnCount =
        warns?.total || 0;

      if (warnCount === 0) {
        return interaction.editReply({
          content:
            `${user.tag} has no warnings to clear.`
        });
      }

      run(
        `DELETE FROM warns
         WHERE guildId = ?
         AND userId = ?`,
        [
          interaction.guild.id,
          user.id
        ]
      );

      await user.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xE67E22)
            .setTitle('Warnings Cleared')
            .setDescription(
              `Your warnings in **${interaction.guild.name}** were cleared.\n\n` +
              `Removed warnings: **${warnCount}**`
            )
            .addFields({
              name: 'Moderator',
              value:
                interaction.user.tag
            })
            .setTimestamp()
        ]
      }).catch(() => {});

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('Warnings Cleared')
            .setDescription(
              `Removed **${warnCount} warning(s)** from ${user}.`
            )
            .addFields(
              {
                name: 'User ID',
                value: `\`${user.id}\``,
                inline: true
              },
              {
                name: 'Removed',
                value: `${warnCount} warning(s)`,
                inline: true
              }
            )
            .setFooter({
              text:
                `Moderator: ${interaction.user.tag}`
            })
            .setTimestamp()
        ]
      });

      await logAudit(
        interaction.client,
        interaction.guild.id,
        {
          action: 'CLEAR_WARNINGS',
          targetId: user.id,
          executorId: interaction.user.id,
          metadata: {
            warningsCleared: warnCount
          },
          embed:
            createAuditEmbed({
              action: 'Warnings Cleared',
              target:
                `<@${user.id}> (${user.tag})`,
              executor:
                `<@${interaction.user.id}>`,
              extra:
                `${warnCount} warning(s) cleared`,
              color: 'Green'
            })
        }
      );

    } catch (err) {
      console.error(
        'ClearWarns Error:',
        err
      );

      return interaction.editReply({
        content:
          'Failed to clear warnings.'
      });
    }
  }
};
