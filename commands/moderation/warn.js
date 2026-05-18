const {
  PermissionsBitField,
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

const {
  run,
  get
} = require('../../database');

const {
  sendLog,
  createLogEmbed
} = require('../../utils/logger');

// ========================
// ⏱ AUTO PUNISHMENTS
// ========================
const punishments = {

  3: {
    type: 'timeout',
    duration: 10 * 60 * 1000 // 10m
  },

  5: {
    type: 'timeout',
    duration: 60 * 60 * 1000 // 1h
  }
};

module.exports = {

  cooldown: 3000,

  data: new SlashCommandBuilder()

    .setName('warn')

    .setDescription('Warn a user')

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
        user.id === interaction.user.id
      ) {

        return interaction.editReply({
          content:
            '❌ You cannot warn yourself.'
        });
      }

      if (
        user.id === interaction.client.user.id
      ) {

        return interaction.editReply({
          content:
            '❌ You cannot warn the bot.'
        });
      }

      if (
        user.id === interaction.guild.ownerId
      ) {

        return interaction.editReply({
          content:
            '❌ You cannot warn the server owner.'
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
            '❌ User not found in this server.'
        });
      }

      // ========================
      // 🔼 USER HIERARCHY
      // ========================
      if (

        member.id !== interaction.user.id &&

        member.roles.highest.position >=
        interaction.member.roles.highest.position

      ) {

        return interaction.editReply({
          content:
            '❌ You cannot warn this user due to role hierarchy.'
        });
      }

      // ========================
      // 🤖 BOT HIERARCHY
      // ========================
      if (

        member.roles.highest.position >=
        botMember.roles.highest.position

      ) {

        return interaction.editReply({
          content:
            '❌ I cannot warn this user due to role hierarchy.'
        });
      }

      // ========================
      // 🔢 UPDATE WARN COUNT
      // ========================
      run(

        `INSERT INTO warns
        (guildId, userId, count)
        VALUES (?, ?, 1)

        ON CONFLICT(guildId, userId)

        DO UPDATE SET
        count = count + 1`,

        [
          interaction.guild.id,
          user.id
        ]
      );

      const row =
        get(

          `SELECT count FROM warns
          WHERE guildId = ?
          AND userId = ?`,

          [
            interaction.guild.id,
            user.id
          ]
        );

      const warnCount =
        row?.count || 1;

      // ========================
      // 📁 CREATE CASE
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
            'WARN',
            reason,
            Date.now()
          ]
        );

      const caseId =
        result?.lastInsertRowid || 'N/A';

      // ========================
      // 🚨 ESCALATION
      // ========================
      let escalationText = null;

      const punishment =
        punishments[warnCount];

      if (
        punishment &&
        member.moderatable
      ) {

        try {

          if (
            punishment.type === 'timeout'
          ) {

            await member.timeout(

              punishment.duration,

              `Auto punishment (${warnCount} warns)`
            );

            const minutes =
              Math.floor(
                punishment.duration / 60000
              );

            escalationText =
              `🔇 Automatic timeout applied (${minutes} minutes)`;

            // ========================
            // 📁 AUTO CASE
            // ========================
            run(

              `INSERT INTO cases
              (guildId, userId, moderatorId, action, reason, timestamp)

              VALUES (?, ?, ?, ?, ?, ?)`,

              [
                interaction.guild.id,
                user.id,
                interaction.client.user.id,
                'AUTO-TIMEOUT',
                `Reached ${warnCount} warns`,
                Date.now()
              ]
            );
          }

        } catch (err) {

          console.error(
            'Warn Escalation Error:',
            err
          );
        }
      }

      // ========================
      // 📩 DM USER
      // ========================
      try {

        await user.send({

          embeds: [

            new EmbedBuilder()

              .setColor(0xF1C40F)

              .setTitle(
                `⚠️ You Were Warned`
              )

              .setDescription(
                `You were warned in **${interaction.guild.name}**.`
              )

              .addFields(

                {
                  name: '📄 Reason',
                  value: reason
                },

                {
                  name: '⚠️ Total Warnings',
                  value: `${warnCount}`
                }
              )

              .setTimestamp()
          ]
        });

      } catch {}

      // ========================
      // 🎨 RESPONSE
      // ========================
      const embed =
        new EmbedBuilder()

          .setColor(0xF1C40F)

          .setTitle('⚠️ User Warned')

          .setDescription(
            `${user} has been warned.`
          )

          .addFields(

            {
              name: '📄 Reason',
              value: reason
            },

            {
              name: '⚠️ Total Warns',
              value: `${warnCount}`,
              inline: true
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

      if (escalationText) {

        embed.addFields({

          name: '🚨 Automatic Action',

          value: escalationText
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
      const log =
        createLogEmbed({

          action: 'WARN',

          user,

          moderator: interaction.user,

          reason:
            `${reason}\nTotal Warns: ${warnCount}`,

          caseId
        });

      await sendLog(
        interaction.client,
        interaction.guild.id,
        log
      );

    } catch (err) {

      console.error(
        'Warn Error:',
        err
      );

      if (
        interaction.deferred ||
        interaction.replied
      ) {

        return interaction.editReply({
          content:
            '❌ Failed to warn user.'
        });
      }

      return interaction.reply({

        content:
          '❌ Failed to warn user.',

        ephemeral: true
      });
    }
  }
};