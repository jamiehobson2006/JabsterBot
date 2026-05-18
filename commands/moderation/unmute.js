const {
  PermissionsBitField,
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

const {
  run
} = require('../../database');

const {
  sendLog,
  createLogEmbed
} = require('../../utils/logger');

module.exports = {

  cooldown: 3000,

  data: new SlashCommandBuilder()

    .setName('unmute')

    .setDescription('Remove timeout (unmute) from a user')

    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User')
        .setRequired(true)
    )

    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason')
        .setMaxLength(300)
    ),

  async execute(interaction) {

    try {

      // ========================
      // 🔐 USER PERMISSION
      // ========================
      if (
        !interaction.memberPermissions.has(
          PermissionsBitField.Flags.ModerateMembers
        )
      ) {

        return interaction.editReply({
          content:
            '❌ You need **Moderate Members** permission.'
        });
      }

      const botMember =
        interaction.guild.members.me;

      // ========================
      // 🤖 BOT PERMISSION
      // ========================
      if (
        !botMember.permissions.has(
          PermissionsBitField.Flags.ModerateMembers
        )
      ) {

        return interaction.editReply({
          content:
            '❌ I do not have permission to moderate members.'
        });
      }

      // ========================
      // 📥 OPTIONS
      // ========================
      const user =
        interaction.options.getUser(
          'user',
          true
        );

      const reason =
        interaction.options.getString(
          'reason'
        ) || 'No reason provided';

      // ========================
      // 🚫 BASIC CHECKS
      // ========================
      if (
        user.id === interaction.client.user.id
      ) {

        return interaction.editReply({
          content:
            '❌ You cannot unmute the bot.'
        });
      }

      if (
        user.id === interaction.guild.ownerId
      ) {

        return interaction.editReply({
          content:
            '❌ You cannot unmute the server owner.'
        });
      }

      // ========================
      // 👤 FETCH MEMBER
      // ========================
      const member =
        await interaction.guild.members
          .fetch(user.id)
          .catch(() => null);

      if (!member) {

        return interaction.editReply({
          content:
            '❌ User not found.'
        });
      }

      // ========================
      // 🔼 ROLE HIERARCHY
      // ========================
      if (

        member.id !== interaction.user.id &&

        member.roles.highest.position >=
        interaction.member.roles.highest.position

      ) {

        return interaction.editReply({
          content:
            '❌ You cannot unmute this user due to role hierarchy.'
        });
      }

      // ========================
      // 🚫 BOT HIERARCHY
      // ========================
      if (!member.moderatable) {

        return interaction.editReply({
          content:
            '❌ I cannot unmute this user.'
        });
      }

      // ========================
      // 🔍 CHECK MUTE
      // ========================
      if (
        !member.isCommunicationDisabled()
      ) {

        return interaction.editReply({
          content:
            '⚠️ This user is not muted.'
        });
      }

      // ========================
      // 🔊 REMOVE TIMEOUT
      // ========================
      await member.timeout(

        null,

        `${reason} | Unmuted by ${interaction.user.tag}`
      );

      // ========================
      // 📩 DM USER
      // ========================
      try {

        await user.send({

          embeds: [

            new EmbedBuilder()

              .setColor(0x57F287)

              .setTitle(
                `🔊 You Were Unmuted`
              )

              .setDescription(
                `You were unmuted in **${interaction.guild.name}**.`
              )

              .addFields({

                name: '📄 Reason',

                value: reason
              })

              .setTimestamp()
          ]
        });

      } catch {}

      // ========================
      // 💾 SAVE CASE
      // ========================
      const result =
        run(

          `INSERT INTO cases
          (guildId, userId, moderatorId, action, reason, timestamp)
          VALUES (?, ?, ?, ?, ?, ?)`,

          [
            interaction.guild.id,
            user.id,
            interaction.user.id,
            'UNMUTE',
            reason,
            Date.now()
          ]
        );

      const caseId =
        result?.lastInsertRowid || 'N/A';

      // ========================
      // 🎨 RESPONSE EMBED
      // ========================
      const embed =
        new EmbedBuilder()

          .setColor(0x57F287)

          .setTitle('🔊 User Unmuted')

          .setDescription(
            `Successfully unmuted ${user}`
          )

          .addFields(

            {
              name: '📄 Reason',
              value: reason
            },

            {
              name: '📁 Case',
              value: `#${caseId}`,
              inline: true
            }
          )

          .setFooter({
            text:
              `Moderator: ${interaction.user.tag}`
          })

          .setTimestamp();

      await interaction.editReply({
        embeds: [embed]
      });

      // ========================
      // 🗑 AUTO DELETE
      // ========================
      setTimeout(() => {

        interaction
          .deleteReply()
          .catch(() => {});

      }, 3000);

      // ========================
      // 📜 LOG
      // ========================
      const log =
        createLogEmbed({

          action: 'UNMUTE',

          user,

          moderator: interaction.user,

          reason,

          caseId
        });

      await sendLog(
        interaction.client,
        interaction.guild.id,
        log
      );

    } catch (err) {

      console.error(
        'Unmute Error:',
        err
      );

      if (
        interaction.deferred ||
        interaction.replied
      ) {

        return interaction.editReply({
          content:
            '❌ Failed to unmute user.'
        });
      }

      return interaction.reply({

        content:
          '❌ Failed to unmute user.',

        ephemeral: true
      });
    }
  }
};