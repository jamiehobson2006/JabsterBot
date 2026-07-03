const {
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');

const {
  all,
  get
} = require('../../database');

const {
  formatHandleTime,
  getGlobalStats,
  getLeaderboard,
  getStaffStats,
  safeNumber
} = require('../../utils/tickets/stats');

function formatNumber(value) {
  return safeNumber(value)
    .toLocaleString();
}

function formatStaffLine(row, index) {
  const claims =
    formatNumber(row.claims);

  const closes =
    formatNumber(row.closes);

  const messages =
    formatNumber(row.messages);

  return `${index + 1}. <@${row.userId}> - ${claims} claim(s), ${closes} close(s), ${messages} message(s)`;
}

module.exports = {
  cooldown: 5000,
  ephemeral: true,

  data:
    new SlashCommandBuilder()
      .setName('ticketstats')
      .setDescription('View ticket statistics')
      .setDefaultMemberPermissions(
        PermissionFlagsBits.Administrator
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('overview')
          .setDescription('View server ticket totals')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('staff')
          .setDescription('View ticket stats for a staff member')
          .addUserOption(option =>
            option
              .setName('user')
              .setDescription('Staff member')
              .setRequired(false)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('leaderboard')
          .setDescription('View the staff ticket leaderboard')
          .addIntegerOption(option =>
            option
              .setName('limit')
              .setDescription('Number of staff members to show')
              .setMinValue(1)
              .setMaxValue(20)
              .setRequired(false)
          )
      ),

  async execute(interaction) {
    if (
      !interaction.memberPermissions.has(
        PermissionFlagsBits.Administrator
      )
    ) {
      return interaction.editReply({
        content:
          'You need Administrator permission.'
      });
    }

    const subcommand =
      interaction.options.getSubcommand();

    if (subcommand === 'overview') {
      const ticketTotals =
        get(
          `SELECT
             COUNT(*) AS total,
             SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END) AS open,
             SUM(CASE WHEN status = 'CLOSED' THEN 1 ELSE 0 END) AS closed,
             SUM(CASE WHEN status = 'DELETED' THEN 1 ELSE 0 END) AS deleted
           FROM tickets
           WHERE guildId = ?`,
          [interaction.guild.id]
        ) || {};

      const typeTotals =
        all(
          `SELECT type, COUNT(*) AS total
           FROM tickets
           WHERE guildId = ?
           GROUP BY type
           ORDER BY total DESC`,
          [interaction.guild.id]
        );

      const staffTotals =
        getGlobalStats(
          interaction.guild.id
        ) || {};

      const typeText =
        typeTotals.length
          ? typeTotals
              .map(row =>
                `${row.type}: ${formatNumber(row.total)}`
              )
              .join('\n')
          : 'No tickets created yet.';

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('Ticket Stats')
            .addFields(
              {
                name: 'Tickets',
                value:
                  `Total: ${formatNumber(ticketTotals.total)}\n` +
                  `Open: ${formatNumber(ticketTotals.open)}\n` +
                  `Closed: ${formatNumber(ticketTotals.closed)}\n` +
                  `Deleted: ${formatNumber(ticketTotals.deleted)}`
              },
              {
                name: 'Staff Handling',
                value:
                  `Claims: ${formatNumber(staffTotals.claims)}\n` +
                  `Closes: ${formatNumber(staffTotals.closes)}\n` +
                  `Messages: ${formatNumber(staffTotals.messages)}\n` +
                  `Handle Time: ${formatHandleTime(staffTotals.totalHandleTime)}`
              },
              {
                name: 'By Type',
                value: typeText
              }
            )
            .setTimestamp()
        ]
      });
    }

    if (subcommand === 'staff') {
      const user =
        interaction.options.getUser('user') ||
        interaction.user;

      const stats =
        getStaffStats(
          interaction.guild.id,
          user.id
        );

      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`Ticket Stats for ${user.tag}`)
            .setThumbnail(
              user.displayAvatarURL({
                size: 256
              })
            )
            .addFields(
              {
                name: 'Claims',
                value: formatNumber(stats?.claims),
                inline: true
              },
              {
                name: 'Closes',
                value: formatNumber(stats?.closes),
                inline: true
              },
              {
                name: 'Messages',
                value: formatNumber(stats?.messages),
                inline: true
              },
              {
                name: 'Total Handle Time',
                value: formatHandleTime(stats?.totalHandleTime),
                inline: true
              },
              {
                name: 'Average Handle Time',
                value: formatHandleTime(stats?.averageHandleTime),
                inline: true
              }
            )
            .setTimestamp()
        ]
      });
    }

    const limit =
      interaction.options.getInteger('limit') ||
      10;

    const leaderboard =
      getLeaderboard(
        interaction.guild.id,
        limit
      );

    return interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('Ticket Staff Leaderboard')
          .setDescription(
            leaderboard.length
              ? leaderboard
                  .map(formatStaffLine)
                  .join('\n')
              : 'No staff ticket stats yet.'
          )
          .setFooter({
            text:
              `Showing up to ${limit} staff member(s)`
          })
          .setTimestamp()
      ]
    });
  }
};
