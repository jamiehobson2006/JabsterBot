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
      .addSubcommand(subcommand => subcommand.setName('responses')
        .setDescription('Average first replies by ticket type and responsible staff role')
        .addIntegerOption(option => option.setName('page').setDescription('Results page').setMinValue(1))
        .addIntegerOption(option => option.setName('days').setDescription('Rolling window, default 30 days').setMinValue(1).setMaxValue(365)))
      .addSubcommand(command=>command.setName('queue').setDescription('Open tickets, waiting state and responsible staff.')
        .addIntegerOption(option=>option.setName('page').setDescription('Queue page').setMinValue(1)))
      .addSubcommand(command=>command.setName('hours').setDescription('Set working hours for future first-response samples.')
        .addStringOption(option=>option.setName('timezone').setDescription('IANA timezone, e.g. Europe/London').setRequired(true))
        .addStringOption(option=>option.setName('start').setDescription('HH:MM local time').setRequired(true))
        .addStringOption(option=>option.setName('end').setDescription('HH:MM local time').setRequired(true))
        .addStringOption(option=>option.setName('weekdays').setDescription('0=Sunday through 6=Saturday, e.g. 1,2,3,4,5').setRequired(true)))
      .addSubcommand(command=>command.setName('hours-clear').setDescription('Stop collecting working-hour samples; keep historical statistics.'))
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
    if(subcommand==='hours-clear') {
      require('../../database').run('DELETE FROM ticket_work_hours WHERE guildId=?',[interaction.guild.id]);
      return interaction.editReply('Working-hour sampling disabled. Existing samples and all wall-clock statistics are retained.');
    }
    if(subcommand==='hours') {
      try {
        require('../../utils/tickets/workingHours').setWorkingHours(interaction.guild.id,interaction.user.id,{
          timezone:interaction.options.getString('timezone',true),start:interaction.options.getString('start',true),
          end:interaction.options.getString('end',true),weekdays:interaction.options.getString('weekdays',true)});
        return interaction.editReply('Working hours saved. New response samples will include working-hour time; older samples are not guessed.');
      } catch(error) { return interaction.editReply(error.message); }
    }
    if(subcommand==='queue') {
      const page=interaction.options.getInteger('page') || 1;
      const rows=all("SELECT * FROM tickets WHERE guildId=? AND UPPER(status) IN ('OPEN','CLOSING') ORDER BY createdAt LIMIT 12 OFFSET ?",[interaction.guild.id,(page-1)*12]);
      return interaction.editReply({content:rows.map(row=>`<#${row.channelId}> | ${row.type} | ${row.status}\nWaiting: ${row.waitingOn || 'STAFF'} | ${row.claimedBy?`Claimed by <@${row.claimedBy}>`:'Unclaimed'} | Opened <t:${Math.floor(row.createdAt/1000)}:R>`).join('\n\n') || 'No tickets on this page.',allowedMentions:{parse:[]}});
    }

    if (subcommand === 'responses') {
      const cohorts = all(`SELECT type, roleId FROM ticket_settings WHERE guildId = ? AND enabled = 1
        UNION SELECT 'application', reviewerRoleId FROM application_forms WHERE guildId = ? AND enabled = 1
        UNION SELECT type, roleId FROM ticket_response_samples WHERE guildId = ?`,
      [interaction.guild.id, interaction.guild.id, interaction.guild.id]);
      const lines = cohorts.filter(row => row.roleId).map(row => {
        const result = require('../../utils/tickets/responseTimes').responseEstimate(interaction.guild.id, row.type, row.roleId,{days:interaction.options.getInteger('days') || 30});
        const label=value=>value===null || value===undefined?'N/A':formatHandleTime(Math.round(value));
        return `**${row.type}** / <@&${row.roleId}>: **${result.label}** (${result.count} replies)\nMedian: ${label(result.medianMs)} | P90: ${label(result.p90Ms)} | Working-hours average: ${label(result.businessMs)}${result.distributionCount<result.count?' | Distribution: latest 5000 replies':''}`;
      });
      const pages = [];
      let text = '';
      for (const line of lines) {
        if (text.length + line.length > 3800) { pages.push(text); text = ''; }
        text += `${line}\n`;
      }
      if (text) pages.push(text);
      if (!pages.length) pages.push('No response history yet. N/A.');
      const page = Math.min(pages.length, interaction.options.getInteger('page') || 1);
      const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('Average First Staff Response').setDescription(pages[page - 1])
        .setFooter({ text: `Page ${page}/${pages.length} | Observed replies only; historical roles are not guessed.` });
      return interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
    }

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
