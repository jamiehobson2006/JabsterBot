const {
  EmbedBuilder,
  PermissionsBitField,
  SlashCommandBuilder
} = require('discord.js');

const { all } = require('../../database');

// 🧠 Clean reason
function trim(text, max = 150) {
  if (!text) return 'No reason provided';
  return text.length > max ? text.slice(0, max) + '...' : text;
}

// 🎨 Format action nicely
function formatAction(action) {
  if (!action) return 'Unknown';

  const map = {
    BAN: '🔨 Ban',
    KICK: '👢 Kick',
    MUTE: '🔇 Mute',
    UNMUTE: '🔊 Unmute',
    WARN: '⚠️ Warn',
    CLEAR: '🧹 Clear',
    'CLEAR WARNINGS': '🧹 Clear Warns',
    'EDIT CASE': '✏️ Edit Case'
  };

  return map[action.toUpperCase()] || action;
}

module.exports = {
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
      const user = interaction.options.getUser('user', true);

      // 🔐 Permission
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.editReply({
          content: '❌ You need **Manage Server** permission.'
        });
      }

      // ⚡ Sync DB
      const cases = all(
        `SELECT * FROM cases 
         WHERE guildId=? AND userId=? 
         ORDER BY id DESC LIMIT 20`,
        [interaction.guild.id, user.id]
      );

      if (!cases.length) {
        return interaction.editReply({
          content: `ℹ️ No history found for ${user.tag}.`
        });
      }

      // 📊 Stats
      const stats = {};
      for (const c of cases) {
        const key = c.action?.toUpperCase() || 'UNKNOWN';
        stats[key] = (stats[key] || 0) + 1;
      }

      const summary = Object.entries(stats)
        .map(([k, v]) => `**${k}**: ${v}`)
        .join(' • ') || 'No data';

      const embed = new EmbedBuilder()
        .setTitle(`History for ${user.tag}`)
        .setColor(0x5865F2)
        .setDescription(`**Recent Activity (last 20 cases)**\n${summary}`)
        .setFooter({ text: `Showing ${Math.min(10, cases.length)} of ${cases.length} cases` })
        .setTimestamp();

      // 📜 Entries (top 10 for readability)
      for (const c of cases.slice(0, 10)) {
        embed.addFields({
          name: `#${c.id} • ${formatAction(c.action)}`,
          value:
            `👮 Moderator: ${c.moderatorId ? `<@${c.moderatorId}>` : '`Unknown`'}\n` +
            `🕒 Time: ${c.timestamp ? `<t:${Math.floor(c.timestamp / 1000)}:R>` : '`Unknown`'}\n` +
            `📄 Reason: ${trim(c.reason)}`,
          inline: false
        });
      }

      // ➕ More indicator
      if (cases.length > 10) {
        embed.addFields({
          name: 'More Cases',
          value: `+ ${cases.length - 10} more (use \`/modlogs\` for full history)`
        });
      }

      return interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('History Command Error:', err);

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({
          content: '❌ Failed to fetch history.'
        });
      } else {
        return interaction.reply({
          content: '❌ Failed to fetch history.',
          flags: 64
        });
      }
    }
  }
};