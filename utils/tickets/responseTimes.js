const { get, run, transaction } = require('../../database');
const { formatHandleTime } = require('./stats');

function responseEstimate(guildId, type, roleId) {
  if (!roleId) return { count: 0, averageMs: null, label: 'N/A' };
  const row = get(`SELECT COUNT(*) AS count, AVG(responseMs) AS averageMs
    FROM ticket_response_samples WHERE guildId = ? AND type = ? AND roleId = ?`, [guildId, type, roleId]);
  return { count: row.count, averageMs: row.averageMs,
    label: row.count ? formatHandleTime(Math.round(row.averageMs)) : 'N/A' };
}

function setWaiting(channelId, waitingOn, now = Date.now()) {
  if (!['STAFF', 'MEMBER'].includes(waitingOn)) throw new Error('Invalid waiting state.');
  return transaction(() => {
    const ticket = get("SELECT * FROM tickets WHERE channelId = ? AND UPPER(status) = 'OPEN'", [channelId]);
    if (!ticket) throw new Error('This ticket is no longer open.');
    if (ticket.waitingOn === waitingOn) return false;
    // A first-response SLA cannot be paused before staff have actually replied.
    if (waitingOn === 'MEMBER' && !ticket.firstStaffResponseAt) {
      throw new Error('Reply to the ticket before marking it as waiting for the member.');
    }
    const elapsed = ticket.waitingOn === 'MEMBER' && ticket.waitingSince
      ? Math.max(0, now - ticket.waitingSince) : 0;
    run(`UPDATE tickets SET waitingOn = ?, waitingSince = ?, memberWaitMs = memberWaitMs + ?
      WHERE channelId = ?`, [waitingOn, now, elapsed, channelId]);
    return true;
  });
}

function recordTicketReply(ticket, { userId, isStaff, roleId, now = Date.now() }) {
  if (!ticket) return false;
  if (userId === ticket.userId && isStaff) isStaff = false;
  return transaction(() => {
    const current = get("SELECT * FROM tickets WHERE channelId = ? AND UPPER(status) = 'OPEN'", [ticket.channelId]);
    if (!current) return false;
    if (isStaff) {
      const responseRole = current.responseRoleId || roleId;
      run(`UPDATE tickets SET firstStaffResponseAt = COALESCE(firstStaffResponseAt, ?),
        responseRoleId = COALESCE(responseRoleId, ?) WHERE channelId = ?`, [now, responseRole, current.channelId]);
      if (!current.firstStaffResponseAt && responseRole && Number(current.createdAt) > 0 && now >= current.createdAt) {
        run(`INSERT OR IGNORE INTO ticket_response_samples
          (guildId, channelId, type, roleId, responseMs, recordedAt) VALUES (?, ?, ?, ?, ?, ?)`,
        [current.guildId, current.channelId, current.type, responseRole, now - current.createdAt, now]);
      }
      setWaiting(current.channelId, 'MEMBER', now);
    } else {
      setWaiting(current.channelId, 'STAFF', now);
    }
    return isStaff;
  });
}

function resolutionAge(ticket, now = Date.now()) {
  const until = Number(ticket.closedAt) || now;
  const activePause = ticket.waitingOn === 'MEMBER' && ticket.waitingSince
    ? Math.max(0, until - Number(ticket.waitingSince)) : 0;
  return Math.max(0, until - Number(ticket.createdAt || until) - Number(ticket.memberWaitMs || 0) - activePause);
}

async function refreshWaitingDisplay(client, channelId) {
  let ticket = get('SELECT * FROM tickets WHERE channelId = ?', [channelId]);
  if (!ticket?.messageId || String(ticket.status).toUpperCase() !== 'OPEN') return;
  const channel = await client.channels.fetch(channelId);
  const message = await channel.messages.fetch({ message: ticket.messageId, force: true });
  if (message.author?.id !== client.user.id || !message.embeds?.[0]) return;
  ticket = get('SELECT * FROM tickets WHERE channelId = ?', [channelId]);
  if (!ticket || String(ticket.status).toUpperCase() !== 'OPEN') return;
  const { EmbedBuilder } = require('discord.js');
  const embed = EmbedBuilder.from(message.embeds[0]);
  const fields = (embed.data.fields || []).filter(field => field.name !== 'Waiting For');
  fields.push({ name: 'Waiting For', value: ticket.waitingOn === 'MEMBER' ? 'Member (resolution SLA paused)' : 'Staff', inline: true });
  await message.edit({ embeds: [embed.setFields(fields)] });
}

module.exports = { recordTicketReply, refreshWaitingDisplay, resolutionAge, responseEstimate, setWaiting };
