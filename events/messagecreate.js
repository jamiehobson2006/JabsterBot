const { Events, PermissionsBitField } = require('discord.js');
const { get, run } = require('../database');
const { createAuditEmbed, logAudit } = require('../utils/logger');

const LINK_REGEX = /(https?:\/\/|www\.|discord\.gg\/|(?:^|\s)[\w-]+\.(?:com|net|org|gg|io|co|uk|dev|app|xyz)(?:\/\S*)?)/i;
const DEFAULT_ALLOWED_DOMAINS = ['roblox.com', 'youtube.com', 'youtu.be', 'twitch.tv'];

function allowedDomains() {
  return [
    ...DEFAULT_ALLOWED_DOMAINS,
    ...(process.env.LINK_ALLOWLIST || '').split(',').map((domain) => domain.trim().toLowerCase()).filter(Boolean),
  ];
}

function canBypassLinkFilter(member) {
  return member.permissions.has(PermissionsBitField.Flags.Administrator)
    || member.permissions.has(PermissionsBitField.Flags.ManageGuild)
    || member.permissions.has(PermissionsBitField.Flags.ManageMessages);
}

function containsBlockedLink(content) {
  if (!LINK_REGEX.test(content)) return false;
  const lower = content.toLowerCase();
  return !allowedDomains().some((domain) => lower.includes(domain));
}

async function handleLinkFilter(message) {
  if (!message.inGuild() || message.author.bot || canBypassLinkFilter(message.member)) return false;
  if (!containsBlockedLink(message.content)) return false;

  await message.delete().catch(() => null);

  const warning = await message.channel.send({
    content: `${message.author}, links are blocked in this server for safety.`,
    allowedMentions: { users: [message.author.id] },
  }).catch(() => null);

  if (warning) {
    setTimeout(() => warning.delete().catch(() => null), 6000).unref?.();
  }

  await logAudit(message.client, message.guild.id, {
    action: 'LINK_BLOCKED',
    targetId: message.author.id,
    executorId: message.client.user.id,
    metadata: {
      channelId: message.channel.id,
      content: message.content.slice(0, 500),
    },
    embed: createAuditEmbed({
      action: 'Link Blocked',
      target: `${message.author} (${message.author.tag})`,
      executor: `${message.client.user}`,
      channel: `${message.channel}`,
      extra: message.content.slice(0, 900),
      color: 'Red',
    }),
  });

  return true;
}

async function handleAfkMentions(message) {
  const mentionedIds = new Set(message.mentions.users.keys());
  for (const userId of mentionedIds) {
    const afk = get('SELECT reason FROM afk WHERE guildId = ? AND userId = ?', [message.guild.id, userId]);
    if (afk) {
      await message.reply(`<@${userId}> is AFK: ${afk.reason}`).catch(() => null);
    }
  }
}

async function clearAuthorAfk(message) {
  const afk = get('SELECT reason FROM afk WHERE guildId = ? AND userId = ?', [message.guild.id, message.author.id]);
  if (!afk) return;

  run('DELETE FROM afk WHERE guildId = ? AND userId = ?', [message.guild.id, message.author.id]);
  await message.reply('Welcome back, I removed your AFK status.').catch(() => null);
}

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (!message.guild || message.author.bot) return;

    const blocked = await handleLinkFilter(message);
    if (blocked) return;

    await handleAfkMentions(message);
    await clearAuthorAfk(message);
  },
};
