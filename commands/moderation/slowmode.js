const {
  PermissionsBitField,
  EmbedBuilder,
  SlashCommandBuilder,
  ChannelType
} = require('discord.js');

const {
  sendLog,
  createLogEmbed
} = require('../../utils/logger');

// ========================
// ⏱ FORMAT TIME
// ========================
function formatTime(seconds) {

  if (seconds === 0) {
    return 'Disabled';
  }

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  const parts = [];

  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s) parts.push(`${s}s`);

  return parts.join(' ');
}

module.exports = {

  cooldown: 3000,

  data: new SlashCommandBuilder()

    .setName('slowmode')

    .setDescription('Set slowmode for this channel')

    .addIntegerOption(option =>
      option
        .setName('seconds')
        .setDescription('0 = disable, max 21600 (6 hours)')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(21600)
    ),

  async execute(interaction) {

    try {

      // ========================
      // 🔐 USER PERMISSION
      // ========================
      if (
        !interaction.memberPermissions.has(
          PermissionsBitField.Flags.ManageChannels
        )
      ) {

        return interaction.editReply({
          content:
            '❌ You need **Manage Channels** permission.'
        });
      }

      const channel =
        interaction.channel;

      const botMember =
        interaction.guild.members.me;

      // ========================
      // 🤖 BOT PERMISSION
      // ========================
      if (
        !botMember.permissions.has(
          PermissionsBitField.Flags.ManageChannels
        )
      ) {

        return interaction.editReply({
          content:
            '❌ I do not have permission to manage channels.'
        });
      }

      // ========================
      // 🚫 CHANNEL CHECK
      // ========================
      if (
        ![
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement
        ].includes(channel.type)
      ) {

        return interaction.editReply({
          content:
            '❌ This command can only be used in text channels.'
        });
      }

      const seconds =
        interaction.options.getInteger(
          'seconds',
          true
        );

      // ========================
      // ⚠️ NO CHANGE
      // ========================
      if (
        channel.rateLimitPerUser === seconds
      ) {

        return interaction.editReply({

          content:
            `⚠️ Slowmode is already set to **${formatTime(seconds)}**.`
        });
      }

      // ========================
      // 🔧 APPLY SLOWMODE
      // ========================
      await channel.setRateLimitPerUser(seconds);

      const formatted =
        formatTime(seconds);

      // ========================
      // 🎨 EMBED
      // ========================
      const embed =
        new EmbedBuilder()

          .setTitle(

            seconds === 0

              ? 'Slowmode Disabled'

              : 'Slowmode Enabled'
          )

          .setColor(

            seconds === 0

              ? 0x57F287

              : 0xE67E22
          )

          .setDescription(

            seconds === 0

              ? 'Slowmode has been removed from this channel.'

              : `Slowmode set to **${formatted}** (${seconds}s)`
          )

          .setFooter({
            text:
              `By ${interaction.user.tag}`
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

      }, 2000);

      // ========================
      // 📜 LOG
      // ========================
      const log =
        createLogEmbed({

          action: 'SLOWMODE',

          user: {
            id: 'CHANNEL',
            tag: channel.name
          },

          moderator: interaction.user,

          reason:

            seconds === 0

              ? 'Disabled slowmode'

              : `Set to ${formatted} (${seconds}s)`
        });

      await sendLog(
        interaction.client,
        interaction.guild.id,
        log
      );

    } catch (err) {

      console.error(
        'Slowmode Error:',
        err
      );

      if (
        interaction.deferred ||
        interaction.replied
      ) {

        return interaction.editReply({
          content:
            '❌ Failed to set slowmode. Check my permissions.'
        });
      }

      return interaction.reply({

        content:
          '❌ Failed to set slowmode.',

        ephemeral: true
      });
    }
  }
};