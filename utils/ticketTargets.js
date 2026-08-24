const {
  EmbedBuilder
} = require('discord.js');

const {
  all,
  get,
  run
} = require('../database');

const {
  createAuditEmbed,
  logAudit
} = require('./logger');

const ticketTypes = require('./tickets/ticketTypes');

function getTicketTarget(guildId, type) {
  return get(
    `SELECT *
     FROM ticket_targets
     WHERE guildId = ?
     AND type = ?`,
    [guildId, type]
  );
}

function listTicketTargets(guildId) {
  return all(
    `SELECT *
     FROM ticket_targets
     WHERE guildId = ?
     ORDER BY type ASC`,
    [guildId]
  );
}

function setTicketTarget({
  guildId,
  type,
  responseMinutes,
  resolveMinutes,
  alertChannelId,
  alertRoleId,
  updatedBy
}) {
  return run(
    `INSERT INTO ticket_targets (
       guildId, type, responseMinutes, resolveMinutes,
       alertChannelId, alertRoleId, updatedBy, updatedAt
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(guildId, type)
     DO UPDATE SET responseMinutes = excluded.responseMinutes,
                   resolveMinutes = excluded.resolveMinutes,
                   alertChannelId = excluded.alertChannelId,
                   alertRoleId = excluded.alertRoleId,
                   updatedBy = excluded.updatedBy,
                   updatedAt = excluded.updatedAt`,
    [
      guildId,
      type,
      responseMinutes || null,
      resolveMinutes || null,
      alertChannelId,
      alertRoleId || null,
      updatedBy,
      Date.now()
    ]
  );
}

function removeTicketTarget(guildId, type) {
  return run(
    `DELETE FROM ticket_targets
     WHERE guildId = ?
     AND type = ?`,
    [guildId, type]
  );
}

function formatDuration(minutes) {
  const value = Number(minutes || 0);
  if (!value) return 'Not set';
  if (value < 60) return `${value} minute(s)`;
  if (value % 60 === 0) return `${value / 60} hour(s)`;
  return `${Math.floor(value / 60)}h ${value % 60}m`;
}

function targetDescription(ticket, target, targetMinutes) {
  const label = target === 'RESPONSE'
    ? 'first staff response'
    : 'resolution';

  return `${label} target of ${formatDuration(targetMinutes)} was missed.`;
}

async function sendTargetAlert(client, row, target, targetMinutes) {
  const inserted = run(
    `INSERT OR IGNORE INTO ticket_target_alerts (
       ticketId,
       target,
       alertedAt
     )
     VALUES (?, ?, ?)`,
    [row.id, target, Date.now()]
  );

  if (!inserted.changes) {
    return false;
  }

  const channel = await client.channels.fetch(row.alertChannelId)
    .catch(() => null);

  const ticketType = ticketTypes[row.type]?.name || row.type;
  const content = row.alertRoleId
    ? `<@&${row.alertRoleId}>`
    : undefined;

  const embed = new EmbedBuilder()
    .setColor(0xED4245)
    .setTitle(
      target === 'RESPONSE'
        ? 'Ticket Response Target Missed'
        : 'Ticket Resolution Target Missed'
    )
    .addFields(
      {
        name: 'Ticket',
        value: `<#${row.channelId}>`,
        inline: true
      },
      {
        name: 'Type',
        value: ticketType,
        inline: true
      },
      {
        name: 'Opened By',
        value: `<@${row.userId}>`,
        inline: true
      },
      {
        name: 'Target',
        value: formatDuration(targetMinutes),
        inline: true
      },
      {
        name: 'Opened',
        value: `<t:${Math.floor(row.createdAt / 1000)}:R>`,
        inline: true
      },
      {
        name: 'Claimed By',
        value: row.claimedBy ? `<@${row.claimedBy}>` : 'Not claimed',
        inline: true
      }
    )
    .setTimestamp();

  if (channel?.isTextBased()) {
    await channel.send({
      content,
      embeds: [embed],
      allowedMentions: row.alertRoleId
        ? { roles: [row.alertRoleId], parse: [] }
        : { parse: [] }
    }).catch(err => console.error('Ticket target alert send error:', err));
  }

  await logAudit(client, row.guildId, {
    action: `TICKET_${target}_TARGET_MISSED`,
    targetId: row.userId,
    type: 'TICKETS',
    metadata: {
      ticketId: row.id,
      channelId: row.channelId,
      type: row.type,
      targetMinutes
    },
    embed: createAuditEmbed({
      action: target === 'RESPONSE'
        ? 'Ticket Response Target Missed'
        : 'Ticket Resolution Target Missed',
      target: `<@${row.userId}>`,
      channel: `<#${row.channelId}>`,
      extra: targetDescription(row, target, targetMinutes),
      color: 0xED4245
    })
  });

  return true;
}

async function checkTicketTargets(client) {
  const now = Date.now();
  const rows = all(
    `SELECT tickets.*, ticket_targets.responseMinutes,
            ticket_targets.resolveMinutes, ticket_targets.alertChannelId,
            ticket_targets.alertRoleId
     FROM tickets
     INNER JOIN ticket_targets
       ON ticket_targets.guildId = tickets.guildId
       AND ticket_targets.type = tickets.type
     WHERE UPPER(tickets.status) = 'OPEN'`
  );

  for (const row of rows) {
    if (
      row.responseMinutes &&
      !row.claimedAt &&
      now >= row.createdAt + (row.responseMinutes * 60 * 1000)
    ) {
      await sendTargetAlert(
        client,
        row,
        'RESPONSE',
        row.responseMinutes
      );
    }

    if (
      row.resolveMinutes &&
      now >= row.createdAt + (row.resolveMinutes * 60 * 1000)
    ) {
      await sendTargetAlert(
        client,
        row,
        'RESOLUTION',
        row.resolveMinutes
      );
    }
  }
}

function startTicketTargetLoop(client) {
  checkTicketTargets(client)
    .catch(err => console.error('Ticket target check error:', err));

  const interval = setInterval(
    () => checkTicketTargets(client)
      .catch(err => console.error('Ticket target check error:', err)),
    60 * 1000
  );

  interval.unref?.();
  return interval;
}

module.exports = {
  checkTicketTargets,
  formatDuration,
  getTicketTarget,
  listTicketTargets,
  removeTicketTarget,
  setTicketTarget,
  startTicketTargetLoop
};
