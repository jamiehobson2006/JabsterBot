const crypto = require('node:crypto');
const { get, transaction } = require('../database');
const { deliverOnce, enqueueDelivery, deliveryNonce } = require('./deliveryOutbox');
const { getLogDestination } = require('./loggingConfig');

const WINDOW_MS = 5000;
const BATCH_ACTIONS = new Set(['ROLE_UPDATED', 'CHANNEL_UPDATED', 'MEMBER_ROLES_ADDED',
  'MEMBER_ROLES_REMOVED', 'MEMBER_NICKNAME_UPDATED']);
const timers = new Map();

function queueLogBurst({ guildId, action, type, executorId, targetId, metadata, embed, now = Date.now() }) {
  if (!BATCH_ACTIONS.has(action) || !executorId) return null;
  const destination = getLogDestination(guildId, type);
  if (!destination.enabled || !destination.channelId) return null;
  return transaction(() => {
    const group = `${guildId}:${destination.channelId}:${type}:${action}:${executorId}`;
    const existing = get(`SELECT * FROM delivery_outbox WHERE type = 'LOG_BURST' AND status = 'PENDING'
      AND attempts = 0 AND nextAttemptAt > ? AND json_extract(payload, '$.group') = ? ORDER BY createdAt DESC LIMIT 1`, [now, group]);
    const payload = existing ? JSON.parse(existing.payload) : { group, action, logType: type, executorId, entries: [] };
    // Freeze a claimed batch and bound attachment size; subsequent events start another batch.
    const usable = existing && payload.entries.length < 50 && Buffer.byteLength(existing.payload) < 500_000;
    const key = usable ? existing.deliveryKey : `log-burst:${crypto.randomUUID()}`;
    const nextPayload = usable || !existing ? payload : { group, action, logType: type, executorId, entries: [] };
    nextPayload.entries.push({ targetId, metadata, embed: embed.toJSON ? embed.toJSON() : embed, timestamp: now });
    return enqueueDelivery({ deliveryKey: key, type: 'LOG_BURST', guildId, channelId: destination.channelId,
      payload: nextPayload, nextAttemptAt: now + WINDOW_MS });
  });
}

async function deliverLogBurst(client, row) {
  return deliverOnce(row.deliveryKey, async claimed => {
    const payload = claimed.parsedPayload;
    const destination = getLogDestination(row.guildId, payload.logType);
    if (!destination.enabled || destination.channelId !== row.channelId) {
      // Do not redirect historical details into a newly configured channel.
      throw new Error('Log destination changed or logging is disabled. Pending audit details remain stored.');
    }
    const channel = await require('./logger').getLogChannel(client, row.guildId, payload.logType, destination);
    if (!channel) throw new Error('Log channel is unavailable.');
    const marker = `Ref: ${deliveryNonce(row.deliveryKey)}`;
    if (claimed.attempts > 1 && channel.messages?.fetch) {
      const recent = await channel.messages.fetch({ limit: 100 });
      const existing = recent.find(message => message.author?.id === client.user.id &&
        message.embeds?.some(embed => (embed.footer?.text || embed.data?.footer?.text || '').includes(marker)));
      if (existing) return existing;
    }
    const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
    const entries = payload.entries;
    const embed = entries.length === 1 ? new EmbedBuilder(entries[0].embed)
      : new EmbedBuilder().setColor(destination.color || 0xFEE75C).setTitle(`${entries.length} ${payload.action.toLowerCase().replaceAll('_', ' ')} events`)
        .setDescription(`By <@${payload.executorId}>\nTargets: ${[...new Set(entries.map(entry => entry.targetId))].length}\nComplete individual details are attached.`)
        .setTimestamp(entries.at(-1).timestamp);
    const footer = embed.data.footer?.text;
    embed.setFooter({ text: `${footer ? `${footer} | ` : ''}${marker}`.slice(-2048) });
    const files = entries.length > 1 ? [new AttachmentBuilder(Buffer.from(JSON.stringify({ action: payload.action,
      executorId: payload.executorId, guildId: row.guildId, events: entries }, null, 2)), { name: 'audit-event-details.json' })] : [];
    if (files.length && !channel.permissionsFor(channel.guild.members.me)?.has('AttachFiles')) {
      throw new Error('Attach Files permission is required to deliver full audit burst details.');
    }
    return channel.send({ embeds: [embed], files, allowedMentions: { parse: [] }, nonce: deliveryNonce(row.deliveryKey), enforceNonce: true });
  });
}

function scheduleLogBurst(client, row) {
  if (timers.has(row.deliveryKey)) return;
  const timer = setTimeout(() => {
    timers.delete(row.deliveryKey);
    deliverLogBurst(client, row).catch(error => console.error('Log burst delivery:', error.message));
  }, Math.max(1, row.nextAttemptAt - Date.now()));
  timer.unref?.();
  timers.set(row.deliveryKey, timer);
}

module.exports = { queueLogBurst, deliverLogBurst, scheduleLogBurst };
