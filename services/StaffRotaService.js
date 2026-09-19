const { EmbedBuilder } = require('discord.js');

const { all, get, run } = require('../database');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const AVAILABILITY_TTL_MS = 24 * 60 * 60 * 1000;
let interval = null;

function localDayAndMinute(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.weekday);
  return { day, minute: (Number(values.hour) * 60) + Number(values.minute) };
}

function isShiftActive(shift, now = new Date()) {
  const local = localDayAndMinute(now, shift.timezone);
  const shiftDay = Number(shift.dayOfWeek);
  const start = Number(shift.startMinute);
  const end = Number(shift.endMinute);

  if (start < end) {
    return local.day === shiftDay && local.minute >= start && local.minute < end;
  }
  return (
    (local.day === shiftDay && local.minute >= start) ||
    (local.day === (shiftDay + 1) % 7 && local.minute < end)
  );
}

function formatMinute(value) {
  const hour = Math.floor(Number(value) / 60);
  const minute = Number(value) % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function availabilityRank(status) {
  return { AVAILABLE: 0, BUSY: 1, AWAY: 2, OFFLINE: 3 }[status] ?? 2;
}

function chunkLines(lines, maxLength = 1000) {
  const chunks = [];
  let current = '';
  for (const line of lines) {
    if (current && current.length + line.length + 1 > maxLength) {
      chunks.push(current);
      current = '';
    }
    current += `${current ? '\n' : ''}${line}`;
  }
  if (current) chunks.push(current);
  return chunks;
}

function buildRotaEmbeds(guild, shifts, availability, now = new Date()) {
  const cutoff = now.getTime() - AVAILABILITY_TTL_MS;
  const availabilityByUser = new Map(
    availability
      .filter(row => Number(row.updatedAt || 0) >= cutoff)
      .map(row => [row.userId, row])
  );
  const active = shifts.filter(shift => isShiftActive(shift, now))
    .sort((left, right) => {
      const leftStatus = availabilityByUser.get(left.userId)?.status || 'AVAILABLE';
      const rightStatus = availabilityByUser.get(right.userId)?.status || 'AVAILABLE';
      return availabilityRank(leftStatus) - availabilityRank(rightStatus) ||
        Number(left.escalationOrder) - Number(right.escalationOrder);
    });
  const onCall = active.find(shift =>
    !['AWAY', 'OFFLINE'].includes(availabilityByUser.get(shift.userId)?.status)
  );
  const activeLines = active.map(shift => {
    const state = availabilityByUser.get(shift.userId) || { status: 'AVAILABLE' };
    const note = state.note ? ` - ${state.note}` : '';
    return `<@${shift.userId}> | **${state.status}** | priority ${shift.escalationOrder}${note}`;
  });
  const scheduleLines = shifts
    .sort((a, b) => Number(a.dayOfWeek) - Number(b.dayOfWeek) || Number(a.startMinute) - Number(b.startMinute))
    .map(shift =>
      `#${shift.id} | ${DAY_NAMES[shift.dayOfWeek]} ${formatMinute(shift.startMinute)}-${formatMinute(shift.endMinute)} ` +
      `(${shift.timezone}) | <@${shift.userId}> | P${shift.escalationOrder}`
    );

  const activeChunks = chunkLines(activeLines);
  if (!activeChunks.length) activeChunks.push('Nobody is currently on duty.');
  const scheduleChunks = chunkLines(scheduleLines);
  if (!scheduleChunks.length) scheduleChunks.push('No shifts configured.');

  const fields = [
    ...activeChunks.map((value, index) => ({
      name: index ? `On Duty (${active.length}, continued)` : `On Duty (${active.length})`,
      value
    })),
    ...scheduleChunks.map((value, index) => ({
      name: index ? `Weekly Schedule (${index + 1})` : 'Weekly Schedule',
      value
    }))
  ];
  const embeds = [];
  for (let index = 0; index < fields.length; index += 20) {
    const page = embeds.length;
    const embed = new EmbedBuilder()
      .setColor(page ? 0x5865F2 : (active.length ? 0x57F287 : 0x95A5A6))
      .setTitle(page ? `${guild.name} Staff Rota (continued)` : `${guild.name} Staff Rota`)
      .addFields(fields.slice(index, index + 20))
      .setFooter({ text: 'Refreshes every 5 minutes | Availability resets after 24 hours' })
      .setTimestamp(now);
    if (!page) {
      embed.setDescription(onCall
        ? `**Current escalation contact:** <@${onCall.userId}>`
        : 'No available staff member is currently scheduled.');
    }
    embeds.push(embed);
  }

  return embeds.slice(0, 10);
}

function buildRotaEmbed(guild, shifts, availability, now = new Date()) {
  return buildRotaEmbeds(guild, shifts, availability, now)[0];
}

async function updateGuild(client, settings) {
  const guild = client.guilds.cache.get(settings.guildId);
  if (!guild) return false;
  const channel = await guild.channels.fetch(settings.channelId).catch(() => null);
  if (!channel?.isTextBased()) return false;
  const shifts = all(
    `SELECT * FROM staff_shifts WHERE guildId = ? AND active = 1`,
    [guild.id]
  );
  const availability = all(
    `SELECT * FROM staff_availability WHERE guildId = ?`,
    [guild.id]
  );
  run(
    `DELETE FROM staff_availability WHERE guildId = ? AND updatedAt < ?`,
    [guild.id, Date.now() - AVAILABILITY_TTL_MS]
  );
  const payload = { embeds: buildRotaEmbeds(guild, shifts, availability) };
  let message = settings.messageId
    ? await channel.messages.fetch(settings.messageId).catch(() => null)
    : null;
  if (message) {
    await message.edit(payload);
  } else {
    message = await channel.send(payload);
    run(
      `UPDATE staff_rota_settings SET messageId = ? WHERE guildId = ?`,
      [message.id, guild.id]
    );
  }
  return true;
}

async function refresh(client, guildId = null) {
  const settings = guildId
    ? [get(`SELECT * FROM staff_rota_settings WHERE guildId = ? AND enabled = 1`, [guildId])].filter(Boolean)
    : all(`SELECT * FROM staff_rota_settings WHERE enabled = 1`);
  let updated = 0;
  for (const setting of settings) {
    try {
      if (await updateGuild(client, setting)) updated += 1;
    } catch (error) {
      console.error(`Staff rota refresh failed for ${setting.guildId}:`, error);
    }
  }
  return updated;
}

function start(client) {
  if (interval) return interval;
  refresh(client).catch(error => console.error('Staff rota startup failed:', error));
  interval = setInterval(() => {
    refresh(client).catch(error => console.error('Staff rota refresh failed:', error));
  }, 5 * 60 * 1000);
  interval.unref?.();
  return interval;
}

module.exports = {
  DAY_NAMES,
  AVAILABILITY_TTL_MS,
  buildRotaEmbed,
  buildRotaEmbeds,
  formatMinute,
  isShiftActive,
  localDayAndMinute,
  refresh,
  start
};
