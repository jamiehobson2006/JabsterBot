const {
  EmbedBuilder
} = require('discord.js');

const {
  all,
  run
} = require('../database');

const MINUTE = 60 * 1000;

function formatAge(milliseconds) {
  const minutes = Math.max(0, Math.floor(milliseconds / MINUTE));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days) return `${days}d ${hours % 24}h`;
  if (hours) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

function claimAlert(ticket, type) {
  return run(
    `INSERT OR IGNORE INTO ticket_sla_alerts (guildId, channelId, alertType, alertedAt)
     VALUES (?, ?, ?, ?)`,
    [ticket.guildId, ticket.channelId, type, Date.now()]
  ).changes === 1;
}

async function sendAlert(client, ticket, type, age) {
  if (!claimAlert(ticket, type)) return false;

  try {
    const channelId = ticket.alertChannelId || ticket.channelId;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) throw new Error('Alert channel is unavailable.');

    const firstResponse = type === 'FIRST_RESPONSE';
    const label = firstResponse ? 'First Response Overdue' : 'Resolution Overdue';
    const target = `<#${ticket.channelId}>`;
    const ping = ticket.pingRoleId ? `<@&${ticket.pingRoleId}>` : null;

    await channel.send({
      content: ping || undefined,
      embeds: [new EmbedBuilder()
        .setColor(firstResponse ? 0xFEE75C : 0xED4245)
        .setTitle(`Ticket SLA: ${label}`)
        .setDescription(`${target} needs staff attention.`)
        .addFields(
          { name: 'Ticket Type', value: ticket.type, inline: true },
          { name: 'Open For', value: formatAge(age), inline: true },
          { name: 'Opened By', value: `<@${ticket.userId}>`, inline: true }
        )
        .setTimestamp(ticket.createdAt)],
      allowedMentions: ticket.pingRoleId
        ? { roles: [ticket.pingRoleId], parse: [] }
        : { parse: [] }
    });

    return true;
  } catch (err) {
    run(
      `DELETE FROM ticket_sla_alerts
       WHERE guildId = ? AND channelId = ? AND alertType = ?`,
      [ticket.guildId, ticket.channelId, type]
    );
    throw err;
  }
}

async function checkTicketSlas(client, now = Date.now()) {
  const tickets = all(
    `SELECT ticket.*, settings.firstResponseMinutes, settings.resolutionMinutes,
            settings.alertChannelId, settings.pingRoleId
     FROM tickets AS ticket
     INNER JOIN ticket_sla_settings AS settings
       ON settings.guildId = ticket.guildId
     WHERE UPPER(ticket.status) = 'OPEN'
       AND settings.enabled = 1`
  );

  let sent = 0;
  for (const ticket of tickets) {
    const age = Math.max(0, now - Number(ticket.createdAt || now));
    const firstResponseLimit = Math.max(1, Number(ticket.firstResponseMinutes) || 60) * MINUTE;
    const resolutionLimit = Math.max(1, Number(ticket.resolutionMinutes) || 1440) * MINUTE;

    if (!ticket.firstStaffResponseAt && age >= firstResponseLimit) {
      if (await sendAlert(client, ticket, 'FIRST_RESPONSE', age)) sent += 1;
    }

    if (age >= resolutionLimit) {
      if (await sendAlert(client, ticket, 'RESOLUTION', age)) sent += 1;
    }
  }

  return sent;
}

class TicketSlaService {
  static interval = null;

  static start(client) {
    if (TicketSlaService.interval) return TicketSlaService.interval;

    checkTicketSlas(client).catch(err => console.error('Ticket SLA service error:', err));
    TicketSlaService.interval = setInterval(() => {
      checkTicketSlas(client).catch(err => console.error('Ticket SLA service error:', err));
    }, 5 * MINUTE);
    TicketSlaService.interval.unref?.();
    return TicketSlaService.interval;
  }
}

module.exports = {
  TicketSlaService,
  checkTicketSlas,
  formatAge
};
