const { ChannelType, EmbedBuilder } = require('discord.js');
const { get, run } = require('../database');

async function getLogChannel(client, guildId) {
  const settings = get('SELECT modlogChannelId FROM guild_settings WHERE guildId = ?', [guildId]);
  const channelId = settings?.modlogChannelId || process.env.MODLOG_CHANNEL_ID || '1425864349641216100';
  if (!channelId) return null;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) return null;
  return channel;
}

async function sendLog(client, guildId, embed) {
  const channel = await getLogChannel(client, guildId);
  if (!channel) return null;

  return channel.send({ embeds: [embed] }).catch((err) => {
    console.error('Failed to send mod log:', err.message);
    return null;
  });
}

function formatUser(userId) {
  return userId ? `<@${userId}>` : 'Unknown';
}

function formatEmbedValue(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;

  if (value.id === 'CHANNEL') {
    return value.tag || value.name || 'Channel';
  }

  if (value.id && value.tag) {
    return `<@${value.id}> (${value.tag})`;
  }

  if (value.id && value.username) {
    return `<@${value.id}> (${value.username})`;
  }

  if (value.id) {
    return `<@${value.id}>`;
  }

  return String(value);
}

function createLogEmbed({ action, user, moderator, reason, caseId, duration, color = 'Blurple' }) {
  const embed = new EmbedBuilder()
    .setTitle(caseId ? `Case #${caseId} | ${action}` : action)
    .setColor(color)
    .setTimestamp();

  const userValue = formatEmbedValue(user);
  const moderatorValue = formatEmbedValue(moderator);

  if (userValue) embed.addFields({ name: 'User', value: userValue, inline: true });
  if (moderatorValue) embed.addFields({ name: 'Moderator', value: moderatorValue, inline: true });
  if (duration) embed.addFields({ name: 'Duration', value: String(duration), inline: true });
  if (reason) embed.addFields({ name: 'Reason', value: String(reason).slice(0, 1024) });

  return embed;
}

function createAuditEmbed({ action, target, executor, reason, channel, messageLink, extra, color = 'DarkButNotBlack' }) {
  const embed = new EmbedBuilder()
    .setTitle(action)
    .setColor(color)
    .setTimestamp();

  if (target) embed.addFields({ name: 'Target', value: target, inline: true });
  if (executor) embed.addFields({ name: 'Executor', value: executor, inline: true });
  if (channel) embed.addFields({ name: 'Channel', value: channel, inline: true });
  if (messageLink) embed.addFields({ name: 'Message', value: messageLink });
  if (reason) embed.addFields({ name: 'Reason', value: reason.slice(0, 1024) });
  if (extra) embed.addFields({ name: 'Details', value: extra.slice(0, 1024) });

  return embed;
}

async function logAudit(client, guildId, { action, targetId, executorId, metadata = {}, embed }) {
  run(
    `INSERT INTO audit_logs (guildId, action, targetId, executorId, metadata, timestamp)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [guildId, action, targetId || null, executorId || null, JSON.stringify(metadata), Date.now()],
  );

  return sendLog(client, guildId, embed || createAuditEmbed({
    action,
    target: formatUser(targetId),
    executor: formatUser(executorId),
    extra: Object.keys(metadata).length ? JSON.stringify(metadata).slice(0, 1024) : undefined,
  }));
}

module.exports = {
  createAuditEmbed,
  createLogEmbed,
  getLogChannel,
  logAudit,
  sendLog,
};

