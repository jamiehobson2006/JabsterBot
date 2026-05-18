const {
  EmbedBuilder,
  PermissionsBitField,
  SlashCommandBuilder,
} = require('discord.js');

const { all, get } = require('../../database');

function countValue(row) {
  return row?.value || 0;
}

function formatGroup(rows, emptyText = 'None') {
  if (!rows.length) return emptyText;
  return rows
    .map((row) => `${row.label || 'Unknown'}: **${row.value}**`)
    .join('\n');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticketstats')
    .setDescription('View ticket stats for this server'),

  async execute(interaction) {
    try {
      if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.editReply({ content: 'You need Administrator permission.' });
      }

      const guildId = interaction.guild.id;
      const total = countValue(get(
        'SELECT COUNT(*) AS value FROM tickets WHERE guildId = ?',
        [guildId],
      ));
      const handled = countValue(get(
        `SELECT COUNT(*) AS value
         FROM tickets
         WHERE guildId = ?
           AND (claimedBy IS NOT NULL OR status IN ('CLOSED', 'DELETED'))`,
        [guildId],
      ));
      const open = countValue(get(
        `SELECT COUNT(*) AS value FROM tickets WHERE guildId = ? AND status = 'OPEN'`,
        [guildId],
      ));
      const closed = countValue(get(
        `SELECT COUNT(*) AS value FROM tickets WHERE guildId = ? AND status = 'CLOSED'`,
        [guildId],
      ));
      const deleted = countValue(get(
        `SELECT COUNT(*) AS value FROM tickets WHERE guildId = ? AND status = 'DELETED'`,
        [guildId],
      ));
      const messages = countValue(get(
        'SELECT COALESCE(SUM(messageCount), 0) AS value FROM tickets WHERE guildId = ?',
        [guildId],
      ));

      const byType = all(
        `SELECT UPPER(SUBSTR(type, 1, 1)) || SUBSTR(type, 2) AS label,
                COUNT(*) AS value
         FROM tickets
         WHERE guildId = ?
         GROUP BY type
         ORDER BY value DESC`,
        [guildId],
      );

      const byStatus = all(
        `SELECT status AS label,
                COUNT(*) AS value
         FROM tickets
         WHERE guildId = ?
         GROUP BY status
         ORDER BY value DESC`,
        [guildId],
      );

      const topStaff = all(
        `SELECT claimedBy AS userId,
                COUNT(*) AS value
         FROM tickets
         WHERE guildId = ? AND claimedBy IS NOT NULL
         GROUP BY claimedBy
         ORDER BY value DESC
         LIMIT 5`,
        [guildId],
      );

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('Ticket Stats')
        .addFields(
          {
            name: 'Overview',
            value: [
              `Total tickets: **${total}**`,
              `Handled tickets: **${handled}**`,
              `Open tickets: **${open}**`,
              `Closed tickets: **${closed}**`,
              `Deleted tickets: **${deleted}**`,
              `Tracked ticket messages: **${messages}**`,
            ].join('\n'),
          },
          {
            name: 'By Type',
            value: formatGroup(byType),
            inline: true,
          },
          {
            name: 'By Status',
            value: formatGroup(byStatus),
            inline: true,
          },
          {
            name: 'Top Staff',
            value: topStaff.length
              ? topStaff.map((row) => `<@${row.userId}>: **${row.value}**`).join('\n')
              : 'No claimed tickets yet',
          },
        )
        .setFooter({ text: 'Message counts are tracked from this update onward.' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('TicketStats Error:', err);
      return interaction.editReply({ content: 'Failed to load ticket stats.' });
    }
  },
};
