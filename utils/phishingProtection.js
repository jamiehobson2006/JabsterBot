const { domainToASCII } = require('node:url');

const { all, get } = require('../database');
const { createAuditEmbed, logAudit } = require('./logger');
const {
  suppressMessageDelete,
  unsuppressMessageDelete
} = require('./messageDeletionTracker');

const OFFICIAL_DOMAINS = new Set([
  'discord.com',
  'discord.gg',
  'discordapp.com',
  'epicgames.com',
  'epicgamesstore.com',
  'roblox.com',
  'steamcommunity.com',
  'steampowered.com',
  'twitch.tv',
  'youtube.com',
  'youtu.be'
]);

const BRAND_PATTERNS = [
  /disc(?:o|0)rd/i,
  /epicgames/i,
  /r(?:o|0)bl(?:o|0)x/i,
  /steam(?:community|powered)?/i,
  /twitch/i,
  /y(?:o|0)utube/i
];

const BAIT_PATTERN = /(?:airdrop|claim|free.?nitro|free.?robux|gift|login|reward|skin|verify|wallet)/i;

function normalizeDomain(value) {
  const cleaned = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/)[0]
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
  return domainToASCII(cleaned) || '';
}

function domainMatches(hostname, configured) {
  return hostname === configured || hostname.endsWith(`.${configured}`);
}

function extractUrls(content) {
  const prepared = String(content || '')
    .replace(/\[(?:dot|\.)\]|\((?:dot|\.)\)/gi, '.')
    .replace(/\bhxxps?:\/\//gi, 'https://');
  const candidates = prepared.match(
    /(?:https?:\/\/|www\.)[^\s<>]+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>]*)?/gi
  ) || [];

  return candidates.map(candidate => {
    const value = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
    try {
      const parsed = new URL(value);
      return {
        raw: candidate,
        hostname: normalizeDomain(parsed.hostname),
        hasCredentials: Boolean(parsed.username || parsed.password),
        path: `${parsed.pathname}${parsed.search}`
      };
    } catch {
      return null;
    }
  }).filter(item => item?.hostname);
}

function detectPhishing(content, { allowlist = [], blocklist = [] } = {}) {
  const allowed = new Set([...OFFICIAL_DOMAINS, ...allowlist.map(normalizeDomain)]);
  const blocked = blocklist.map(normalizeDomain).filter(Boolean);

  for (const url of extractUrls(content)) {
    if ([...allowed].some(domain => domainMatches(url.hostname, domain))) continue;

    if (blocked.some(domain => domainMatches(url.hostname, domain))) {
      return { ...url, reason: 'Server blocklist match' };
    }
    if (url.hasCredentials) return { ...url, reason: 'URL contains hidden login credentials' };
    if (url.hostname.includes('xn--')) return { ...url, reason: 'Internationalized lookalike domain' };

    const hostText = url.hostname.replace(/[-.]/g, '');
    if (BRAND_PATTERNS.some(pattern => pattern.test(hostText))) {
      return { ...url, reason: 'Possible brand impersonation' };
    }

    const isIp = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(url.hostname);
    if (isIp && BAIT_PATTERN.test(`${content} ${url.path}`)) {
      return { ...url, reason: 'Suspicious offer hosted on an IP address' };
    }
  }

  return null;
}

function guildPhishingLists(guildId) {
  return {
    allowlist: all(
      `SELECT domain FROM phishing_allowlist WHERE guildId = ?`,
      [guildId]
    ).map(row => row.domain),
    blocklist: all(
      `SELECT domain FROM phishing_blocklist WHERE guildId = ?`,
      [guildId]
    ).map(row => row.domain)
  };
}

async function handlePhishing(message, client) {
  if (!message?.guild || !message.author || message.author.bot) return false;
  const settings = get(
    `SELECT * FROM phishing_settings WHERE guildId = ?`,
    [message.guild.id]
  );
  if (Number(settings?.enabled || 0) !== 1) return false;

  const match = detectPhishing(message.content, guildPhishingLists(message.guild.id));
  if (!match) return false;

  suppressMessageDelete(message.id);
  try {
    await message.delete();
  } catch (error) {
    unsuppressMessageDelete(message.id);
    console.error('Phishing message deletion failed:', error);
    return false;
  }

  const warning = await message.channel.send({
    content: `${message.author}, that message was removed because it contained a suspicious link.`,
    allowedMentions: { users: [message.author.id], roles: [], parse: [] }
  }).catch(() => null);
  if (warning) setTimeout(() => warning.delete().catch(() => null), 10000).unref?.();

  const embed = createAuditEmbed({
    action: 'Phishing Link Blocked',
    target: `${message.author.tag}\n<@${message.author.id}>`,
    executor: client.user ? `${client.user.tag}\n<@${client.user.id}>` : 'Bot',
    channel: `<#${message.channel.id}>`,
    reason: match.reason,
    extra: `Domain: \`${match.hostname}\`\nMessage: ${String(message.content || '').slice(0, 900)}`,
    color: 0xED4245
  });

  await logAudit(client, message.guild.id, {
    action: 'PHISHING_BLOCKED',
    targetId: message.author.id,
    executorId: client.user?.id,
    type: 'MESSAGES',
    metadata: {
      channelId: message.channel.id,
      messageId: message.id,
      domain: match.hostname,
      reason: match.reason
    },
    embed
  }).catch(() => null);

  if (settings.alertChannelId) {
    const channel = await client.channels.fetch(settings.alertChannelId).catch(() => null);
    if (channel?.isTextBased()) await channel.send({ embeds: [embed] }).catch(() => null);
  }

  return true;
}

module.exports = {
  OFFICIAL_DOMAINS,
  detectPhishing,
  extractUrls,
  guildPhishingLists,
  handlePhishing,
  normalizeDomain
};
