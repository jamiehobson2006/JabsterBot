const {
  EmbedBuilder,
  PermissionsBitField,
  SlashCommandBuilder
} = require('discord.js');

const { all } = require('../../database');

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
      // ✅ Ensure reply exists
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
      }

      // 🔐 Permission
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return interaction.editReply({
          content: '❌ You need **Manage Server** permission.'
        });
      }

      const user = interaction.options.getUser('user', true);

      // 📦 Fetch cases (AWAITED)
      const cases = await all(
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

      // 📊 Stats summary
      const stats = {};
      for (const c of cases) {
        const key = c.action.toUpperCase();
        stats[key] = (stats[key] || 0) + 1;
      }

      const summary =
        Object.entries(stats)
          .map(([k, v]) => `**${k}**: ${v}`)
          .join(' • ') || 'No data';

      const embed = new EmbedBuilder()
        .setTitle(`History for ${user.tag}`)
        .setColor(0x5865F2)
        .setDescription(`**Recent Activity (last 20 cases)**\n${summary}`)
        .setFooter({ text: `Showing latest ${Math.min(10, cases.length)} entries` })
        .setTimestamp();

      // 📜 Add case entries (max 10 clean)
      for (const c of cases.slice(0, 10)) {
        let reason = c.reason || 'No reason provided';

        if (reason.length > 150) {
          reason = reason.slice(0, 150) + '...';
        }

        embed.addFields({
          name: `#${c.id} • ${c.action}`,
          value:
            `Moderator: <@${c.moderatorId}>\n` +
            `Time: <t:${Math.floor(c.timestamp / 1000)}:R>\n` +
            `Reason: ${reason}`,
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
          ephemeral: true
        });
      }
    }
  }
};