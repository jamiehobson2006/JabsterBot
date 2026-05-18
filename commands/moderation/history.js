const {
  EmbedBuilder,
  PermissionsBitField,
  SlashCommandBuilder
} = require('discord.js');

const { all } = require('../../database');

// 🧠 Clean reason
function trim(text, max = 150) {

  if (!text) return 'No reason provided';

  return text.length > max
    ? text.slice(0, max) + '...'
    : text;
}

// 🎨 Format action nicely
function formatAction(action) {

  if (!action) return 'Unknown';

  const map = {

    BAN: '🔨 Ban',
    UNBAN: '🔓 Unban',

    KICK: '👢 Kick',

    MUTE: '🔇 Mute',
    UNMUTE: '🔊 Unmute',

    WARN: '⚠️ Warn',
    CLEARWARNS: '🧹 Clear Warns',

    LOCK: '🔒 Lock',
    UNLOCK: '🔓 Unlock',

    ROLE_ADD: '➕ Role Added',
    ROLE_REMOVE: '➖ Role Removed',

    EDIT_CASE: '✏️ Edit Case'
  };

  return map[action.toUpperCase()] || action;
}

module.exports = {

  cooldown: 3000,

  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('View moderation history for a user')

    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User to view history for')
        .setRequired(true)
    ),

  async execute(interaction) {

    try {

      const user =
        interaction.options.getUser('user', true);

      // 🔐 Permission
      if (!interaction.memberPermissions.has(
        PermissionsBitField.Flags.ManageGuild
      )) {

        return interaction.editReply({
          content:
            '❌ You need **Manage Server** permission.'
        });
      }

      // 📄 Fetch cases
      const cases = all(
        `SELECT * FROM cases
         WHERE guildId=? AND userId=?
         ORDER BY id DESC
         LIMIT 20`,
        [interaction.guild.id, user.id]
      );

      // ❌ No history
      if (!cases.length) {

        return interaction.editReply({
          content:
            `ℹ️ No history found for ${user.tag}.`
        });
      }

      // 📊 Stats
      const stats = {};

      for (const c of cases) {

        const key =
          c.action?.toUpperCase() || 'UNKNOWN';

        stats[key] = (stats[key] || 0) + 1;
      }

      const summary =
        Object.entries(stats)

          .map(([k, v]) =>
            `**${k}**: ${v}`
          )

          .join(' • ') ||

        'No data';

      // 🎨 Embed
      const embed = new EmbedBuilder()

        .setTitle(`📜 History for ${user.tag}`)

        .setColor(0x5865F2)

        .setThumbnail(
          user.displayAvatarURL({
            dynamic: true
          })
        )

        .setDescription(
          `**Recent Activity**\n${summary}`
        )

        .setFooter({
          text:
            `Showing latest ${Math.min(10, cases.length)} cases`
        })

        .setTimestamp();

      // 📜 Entries
      for (const c of cases.slice(0, 10)) {

        embed.addFields({

          name:
            `#${c.id} • ${formatAction(c.action)}`,

          value:

            `👮 Moderator: ${
              c.moderatorId
                ? `<@${c.moderatorId}>`
                : '`Unknown`'
            }\n` +

            `🕒 Time: ${
              c.createdAt
                ? `<t:${Math.floor(c.createdAt / 1000)}:R>`
                : '`Unknown`'
            }\n` +

            `📄 Reason: ${trim(c.reason)}`,

          inline: false
        });
      }

      // ➕ More indicator
      if (cases.length > 10) {

        embed.addFields({
          name: 'More Cases',
          value:
            `+ ${cases.length - 10} more case(s)`
        });
      }

      return interaction.editReply({
        embeds: [embed]
      });

    } catch (err) {

      console.error('History Command Error:', err);

      if (interaction.deferred || interaction.replied) {

        return interaction.editReply({
          content:
            '❌ Failed to fetch history.'
        });
      }

      return interaction.reply({
        content:
          '❌ Failed to fetch history.',
        ephemeral: true
      });
    }
  }
};