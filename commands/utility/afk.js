const {
  EmbedBuilder,
  SlashCommandBuilder
} = require('discord.js');

const {
  run,
  get
} = require('../../database');

module.exports = {

  cooldown: 3000,

  data: new SlashCommandBuilder()

    .setName('afk')

    .setDescription('Set your AFK status')

    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for being AFK')
        .setMaxLength(200)
    ),

  async execute(interaction) {

    try {

      // ========================
      // 📝 GET REASON
      // ========================
      let reason =
        interaction.options.getString(
          'reason'
        ) || 'AFK';

      // ========================
      // 🧹 CLEAN REASON
      // ========================
      reason = reason

        .replace(/@everyone|@here/g, '[mention removed]')

        .replace(/[`*_~|>#]/g, '')

        .replace(/\s+/g, ' ')

        .trim();

      if (!reason.length) {
        reason = 'AFK';
      }

      // ========================
      // 🔍 EXISTING AFK
      // ========================
      const existing =
        get(

          `SELECT * FROM afk
          WHERE guildId = ?
          AND userId = ?`,

          [
            interaction.guild.id,
            interaction.user.id
          ]
        );

      const now =
        Date.now();

      // ========================
      // 💾 SAVE AFK
      // ========================
      run(

        `INSERT INTO afk
        (guildId, userId, reason, timestamp)

        VALUES (?, ?, ?, ?)

        ON CONFLICT(guildId, userId)

        DO UPDATE SET
        reason = excluded.reason,
        timestamp = excluded.timestamp`,

        [
          interaction.guild.id,
          interaction.user.id,
          reason,
          now
        ]
      );

      // ========================
      // 🏷 AFK NICKNAME
      // ========================
      try {

        const member =
          interaction.member;

        if (
          member &&
          member.manageable
        ) {

          const currentName =
            member.nickname ||
            member.user.username;

          if (
            !currentName.startsWith('[AFK] ')
          ) {

            const newName =
              `[AFK] ${currentName}`.slice(0, 32);

            await member
              .setNickname(newName)
              .catch(() => {});
          }
        }

      } catch {}

      // ========================
      // 🎨 EMBED
      // ========================
      const embed =
        new EmbedBuilder()

          .setColor(0x5865F2)

          .setTitle('🌙 AFK Status Set')

          .setDescription(

            existing

              ? 'Your AFK status has been updated.'

              : 'You are now marked as AFK.'
          )

          .addFields(

            {
              name: '📄 Reason',
              value: reason
            },

            {
              name: '🕒 Since',
              value:
                `<t:${Math.floor(now / 1000)}:R>`,
              inline: true
            }
          )

          .setFooter({
            text:
              `User: ${interaction.user.tag}`
          })

          .setTimestamp();

      // ========================
      // ✅ RESPONSE
      // ========================
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

    } catch (err) {

      console.error(
        'AFK Error:',
        err
      );

      if (
        interaction.deferred ||
        interaction.replied
      ) {

        return interaction.editReply({
          content:
            '❌ Failed to set AFK.'
        });
      }

      return interaction.reply({

        content:
          '❌ Failed to set AFK.',

        ephemeral: true
      });
    }
  }
};