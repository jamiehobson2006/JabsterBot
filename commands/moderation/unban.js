const {
  PermissionsBitField,
  SlashCommandBuilder,
  EmbedBuilder,
  ChannelType
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

    .setName('unban')

    .setDescription('Unban a user by ID')

    .addStringOption(option =>
      option
        .setName('user_id')
        .setDescription('The ID of the user to unban')
        .setRequired(true)
    )

    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for unbanning')
        .setMaxLength(200)
    ),

  async execute(interaction) {

    try {

      // ========================
      // 🔐 USER PERMISSION
      // ========================
      if (
        !interaction.memberPermissions.has(
          PermissionsBitField.Flags.BanMembers
        )
      ) {

        return interaction.editReply({
          content:
            '❌ You need **Ban Members** permission.'
        });
      }

      const botMember =
        interaction.guild.members.me;

      // ========================
      // 🤖 BOT PERMISSION
      // ========================
      if (
        !botMember.permissions.has(
          PermissionsBitField.Flags.BanMembers
        )
      ) {

        return interaction.editReply({
          content:
            '❌ I do not have permission to unban members.'
        });
      }

      // ========================
      // 📥 OPTIONS
      // ========================
      const userId =
        interaction.options.getString(
          'user_id',
          true
        );

      const reason =
        interaction.options.getString(
          'reason'
        ) || 'No reason provided';

      // ========================
      // 🛡 VALIDATE ID
      // ========================
      if (!/^\d{17,20}$/.test(userId)) {

        return interaction.editReply({
          content:
            '❌ Invalid Discord user ID.'
        });
      }

      // ========================
      // 🔍 FETCH BAN
      // ========================
      let ban;

      try {

        ban =
          await interaction.guild.bans.fetch(
            userId
          );

      } catch {

        return interaction.editReply({
          content:
            '❌ That user is not banned.'
        });
      }

      // ========================
      // 🔓 UNBAN
      // ========================
      await interaction.guild.members.unban(
        userId,
        reason
      );

      // ========================
      // 🔗 CREATE INVITE
      // ========================
      let inviteLink = null;

      try {

        // Try current channel first
        if (
          interaction.channel &&
          interaction.channel.type === ChannelType.GuildText &&
          interaction.channel.permissionsFor(botMember)?.has(
            PermissionsBitField.Flags.CreateInstantInvite
          )
        ) {

          const invite =
            await interaction.channel.createInvite({

              maxAge: 86400,
              maxUses: 1,

              reason:
                `Invite for unbanned user ${userId}`
            });

          inviteLink = invite.url;
        }

        // Fallback channel
        if (!inviteLink) {

          const fallback =
            interaction.guild.channels.cache.find(c =>

              c.type === ChannelType.GuildText &&

              c.permissionsFor(botMember)?.has([

                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.CreateInstantInvite

              ])
            );

          if (fallback) {

            const invite =
              await fallback.createInvite({

                maxAge: 86400,
                maxUses: 1,

                reason:
                  `Invite for unbanned user ${userId}`
              });

            inviteLink = invite.url;
          }
        }

      } catch (err) {

        console.error(
          'Invite Creation Error:',
          err
        );
      }

      // ========================
      // 📩 DM USER
      // ========================
      try {

        const fetchedUser =
          await interaction.client.users.fetch(
            userId
          );

        const dmEmbed =
          new EmbedBuilder()

            .setColor(0x57F287)

            .setTitle(
              `🔓 You Were Unbanned`
            )

            .setDescription(

              `You have been unbanned from **${interaction.guild.name}**.`
            )

            .addFields({

              name: '📄 Reason',

              value: reason
            })

            .setTimestamp();

        if (inviteLink) {

          dmEmbed.addFields({

            name: '🔗 Rejoin Server',

            value: inviteLink
          });
        }

        await fetchedUser.send({
          embeds: [dmEmbed]
        });

      } catch (err) {

        console.error(
          'Failed to DM unbanned user:',
          err
        );
      }

      // ========================
      // 🎨 RESPONSE
      // ========================
      const embed =
        new EmbedBuilder()

          .setColor(0x57F287)

          .setTitle('🔓 User Unbanned')

          .setDescription(
            `Successfully unbanned **${ban.user.tag}**`
          )

          .addFields(

            {
              name: 'User ID',
              value: `\`${userId}\``,
              inline: true
            },

            {
              name: 'Reason',
              value: reason,
              inline: false
            }
          )

          .setFooter({
            text:
              `Moderator: ${interaction.user.tag}`
          })

          .setTimestamp();

      if (inviteLink) {

        embed.addFields({

          name: '🔗 Invite Created',

          value:
            '[Invite generated successfully]'
        });
      }

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
      const logEmbed =
        createLogEmbed({

          action: 'UNBAN',

          user: ban.user,

          moderator: interaction.user,

          reason
        });

      await sendLog(
        interaction.client,
        interaction.guild.id,
        logEmbed
      );

      // ========================
      // 💾 SAVE CASE
      // ========================
      run(

        `INSERT INTO cases
        (guildId, userId, moderatorId, action, reason, timestamp)
        VALUES (?, ?, ?, 'UNBAN', ?, ?)`,

        [
          interaction.guild.id,
          userId,
          interaction.user.id,
          reason,
          Date.now()
        ]
      );

    } catch (err) {

      console.error(
        'Unban Error:',
        err
      );

      if (
        interaction.deferred ||
        interaction.replied
      ) {

        return interaction.editReply({
          content:
            '❌ Failed to unban user.'
        });
      }

      return interaction.reply({

        content:
          '❌ Failed to unban user.',

        ephemeral: true
      });
    }
  }
};