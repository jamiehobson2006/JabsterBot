const { EmbedBuilder, ChannelType, PermissionsBitField } = require('discord.js');
const { get } = require('../database');

// 🎨 Action styling
function getStyle(action = 'LOG') {
  const a = action.toUpperCase();

  if (a.includes('BAN')) return { color: 0x992d22, icon: '🔨' };
  if (a.includes('KICK')) return { color: 0xe74c3c, icon: '👢' };
  if (a.includes('MUTE')) return { color: 0xf39c12, icon: '🔇' };
  if (a.includes('UNMUTE')) return { color: 0x2ecc71, icon: '🔊' };
  if (a.includes('WARN')) return { color: 0xf1c40f, icon: '⚠️' };
  if (a.includes('CLEAR')) return { color: 0x95a5a6, icon: '🧹' };

  return { color: 0x5865F2, icon: '📌' };
}

// 🧠 Clean user format (Carl-bot style)
function formatUser(user) {
  if (!user) return '`Unknown`';

  const tag = user.tag || 'Unknown';
  const id = user.id || 'Unknown';

  return `${tag} (\`${id}\`)`;
}

// 🧠 Safe truncate
function trim(text, max = 1000) {
  if (!text) return 'No reason provided';
  return text.length > max ? text.slice(0, max) + '...' : text;
}

// 🔥 SEND LOG
async function sendLog(client, guildId, embed) {
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    const row = get(
      `SELECT modlogChannelId FROM guild_settings WHERE guildId=?`,
      [guildId]
    );

    if (!row?.modlogChannelId) return;

    const channel = await guild.channels.fetch(row.modlogChannelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) return;

    const perms = channel.permissionsFor(guild.members.me);
    if (!perms?.has([
      PermissionsBitField.Flags.SendMessages,
      PermissionsBitField.Flags.EmbedLinks,
      PermissionsBitField.Flags.ViewChannel
    ])) return;

    await channel.send({ embeds: [embed] });

  } catch (err) {
    console.error('Logger error:', err);
  }
}

// 🔥 ADVANCED EMBED (PRO LEVEL)
function createLogEmbed({
  action = 'LOG',
  user,
  moderator,
  reason,
  caseId,
  duration,
  channel,
  messageLink,
  extra = {}
}) {
  const { color, icon } = getStyle(action);

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${icon} ${action}`)
    .setTimestamp();

  // ========================
  // 🧾 MAIN BLOCK
  // ========================
  embed.setDescription(
    `**User:** ${formatUser(user)}\n` +
    `**Moderator:** ${formatUser(moderator)}\n` +
    (channel ? `**Channel:** <#${channel.id}>\n` : '') +
    (duration ? `**Duration:** ${duration}\n` : '') +
    (caseId ? `**Case:** #${caseId}\n` : '')
  );

  // ========================
  // 📄 REASON
  // ========================
  embed.addFields({
    name: '📄 Reason',
    value: trim(reason),
    inline: false
  });

  // ========================
  // 🔗 LINKS
  // ========================
  if (messageLink) {
    embed.addFields({
      name: '🔗 Message',
      value: `[Jump to message](${messageLink})`,
      inline: false
    });
  }

  // ========================
  // ➕ EXTRA DATA
  // ========================
  if (extra && typeof extra === 'object') {
    for (const [key, value] of Object.entries(extra)) {
      if (!value) continue;

      embed.addFields({
        name: key,
        value: trim(String(value), 500),
        inline: true
      });
    }
  }

  // ========================
  // 🧠 FOOTER
  // ========================
  embed.setFooter({
    text: `Moderation Log • ${new Date().toLocaleString()}`
  });

  return embed;
}

module.exports = {
  sendLog,
  createLogEmbed
};