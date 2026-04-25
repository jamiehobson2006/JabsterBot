require('dotenv').config();

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  PermissionsBitField,
} = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

const db = new sqlite3.Database('./database.db');
const legacyGuildId = process.env.GUILD_ID || 'legacy';

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function tableExists(tableName) {
  const row = await get(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [tableName],
  );

  return Boolean(row);
}

async function getColumns(tableName) {
  const rows = await all(`PRAGMA table_info(${tableName})`);
  return rows.map((row) => row.name);
}

async function migrateLegacyTables() {
  if (await tableExists('warns')) {
    const columns = await getColumns('warns');
    if (!columns.includes('guildId')) {
      await run('ALTER TABLE warns RENAME TO warns_legacy');
    }
  }

  await run(`CREATE TABLE IF NOT EXISTS warns (
    guildId TEXT NOT NULL,
    userId TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guildId, userId)
  )`);

  if (await tableExists('warns_legacy')) {
    await run(
      `INSERT OR REPLACE INTO warns (guildId, userId, count)
       SELECT ?, userId, MAX(count)
       FROM warns_legacy
       GROUP BY userId`,
      [legacyGuildId],
    );
    await run('DROP TABLE warns_legacy');
  }

  if (await tableExists('mutes')) {
    const columns = await getColumns('mutes');
    if (!columns.includes('guildId')) {
      await run('ALTER TABLE mutes RENAME TO mutes_legacy');
    }
  }

  await run(`CREATE TABLE IF NOT EXISTS mutes (
    guildId TEXT NOT NULL,
    userId TEXT NOT NULL,
    endTime INTEGER NOT NULL,
    PRIMARY KEY (guildId, userId)
  )`);

  if (await tableExists('mutes_legacy')) {
    await run(
      `INSERT OR REPLACE INTO mutes (guildId, userId, endTime)
       SELECT ?, userId, MAX(endTime)
       FROM mutes_legacy
       GROUP BY userId`,
      [legacyGuildId],
    );
    await run('DROP TABLE mutes_legacy');
  }

  if (await tableExists('cases')) {
    const columns = await getColumns('cases');
    if (!columns.includes('guildId')) {
      await run('ALTER TABLE cases RENAME TO cases_legacy');
    }
  }

  await run(`CREATE TABLE IF NOT EXISTS cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guildId TEXT NOT NULL,
    userId TEXT NOT NULL,
    moderatorId TEXT NOT NULL,
    action TEXT NOT NULL,
    reason TEXT NOT NULL,
    timestamp INTEGER NOT NULL
  )`);

  if (await tableExists('cases_legacy')) {
    await run(
      `INSERT INTO cases (id, guildId, userId, moderatorId, action, reason, timestamp)
       SELECT id, ?, userId, moderatorId, action, reason, timestamp
       FROM cases_legacy`,
      [legacyGuildId],
    );
    await run('DROP TABLE cases_legacy');
  }
}

async function initDatabase() {
  await migrateLegacyTables();

  await run(`CREATE TABLE IF NOT EXISTS warns (
    guildId TEXT NOT NULL,
    userId TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guildId, userId)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS mutes (
    guildId TEXT NOT NULL,
    userId TEXT NOT NULL,
    endTime INTEGER NOT NULL,
    PRIMARY KEY (guildId, userId)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guildId TEXT NOT NULL,
    userId TEXT NOT NULL,
    moderatorId TEXT NOT NULL,
    action TEXT NOT NULL,
    reason TEXT NOT NULL,
    timestamp INTEGER NOT NULL
  )`);

  await run(`CREATE TABLE IF NOT EXISTS economy (
    guildId TEXT NOT NULL,
    userId TEXT NOT NULL,
    wallet INTEGER NOT NULL DEFAULT 0,
    dailyAt INTEGER NOT NULL DEFAULT 0,
    workAt INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guildId, userId)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS economy_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guildId TEXT NOT NULL,
    userId TEXT NOT NULL,
    actorId TEXT NOT NULL,
    change INTEGER NOT NULL,
    balanceBefore INTEGER NOT NULL,
    balanceAfter INTEGER NOT NULL,
    reason TEXT NOT NULL,
    timestamp INTEGER NOT NULL
  )`);

  await run(`CREATE TABLE IF NOT EXISTS social_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guildId TEXT NOT NULL,
    alertType TEXT NOT NULL,
    source TEXT NOT NULL,
    discordChannelId TEXT NOT NULL,
    pingRoleId TEXT,
    lastItemKey TEXT,
    enabled INTEGER NOT NULL DEFAULT 1
  )`);
}

function parseDuration(input) {
  if (!input) return null;

  const match = input.trim().match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;

  const value = Number(match[1]);
  const unit = match[2].toLowerCase();

  if (!Number.isSafeInteger(value) || value <= 0) return null;

  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return value * multipliers[unit];
}

function formatDuration(ms) {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.ceil(hours / 24)}d`;
}

function truncateText(text, maxLength = 900) {
  if (!text) return 'No reason provided';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function formatCoins(amount) {
  return `${amount.toLocaleString()} coin${amount === 1 ? '' : 's'}`;
}

const helpCategories = {
  moderation: {
    title: 'Moderation Commands',
    description: 'Staff tools for keeping the server tidy.',
    commands: [
      ['warn', 'Warn a member and create a modlog case. Requires Moderate Members.'],
      ['mute', 'Temporarily mute a member. Requires Moderate Members.'],
      ['unmute', 'Remove a member mute. Requires Moderate Members.'],
      ['kick', 'Kick a member. Requires Kick Members.'],
      ['ban', 'Ban a user. Requires Ban Members.'],
      ['unban', 'Unban by user ID. Requires Ban Members.'],
      ['clear', 'Delete recent messages. Requires Manage Messages.'],
      ['lock / unlock', 'Lock or unlock the current channel. Requires Manage Channels.'],
      ['modlogs', 'View cases with reason, moderator, and date. Requires Moderate Members.'],
      ['modlogremove', 'Remove a case from modlogs. Requires Manage Server.'],
    ],
  },
  economy: {
    title: 'Economy Commands',
    description: 'Coins, wagers, leaderboards, and admin controls.',
    commands: [
      ['balance', 'Check your balance or another user balance.'],
      ['daily / work', 'Claim daily coins or work once per hour.'],
      ['pay', 'Send coins to another user.'],
      ['leaderboard', 'Show the richest users in the server.'],
      ['transactions', 'View recent balance changes.'],
      ['coinbet / slots / dicebet', 'Gamble coins with different odds.'],
      ['roulette / scratch / highlow / lottery', 'More coin gambling games.'],
      ['fight', 'Fight another user, optionally with a wager.'],
      ['ecoadd / ecoremove', 'Admin coin controls. Requires Manage Server.'],
    ],
  },
  fun: {
    title: 'Fun Commands',
    description: 'Casual commands for chat.',
    commands: [
      ['8ball', 'Ask the magic 8 ball a question.'],
      ['coinflip / roll', 'Flip a coin or roll dice.'],
      ['rate / ship', 'Rate something or match two users.'],
      ['joke / compliment / roast', 'Send a joke, compliment, or playful roast.'],
      ['choose / reverse', 'Pick from choices or reverse text.'],
      ['meme / cat / dog / fox / duck', 'Send random images from public APIs.'],
      ['fact', 'Send a random, cat, or dog fact.'],
    ],
  },
  utility: {
    title: 'Utility Commands',
    description: 'General server and bot information.',
    commands: [
      ['game', 'Send the Endless Summer Simulator Roblox link.'],
      ['ping / uptime', 'Check bot latency or uptime.'],
      ['poll', 'Create a reaction poll. Requires Manage Messages.'],
      ['say', 'Make the bot send a message. Requires Manage Messages.'],
      ['announce', 'Send an announcement embed. Requires Manage Server.'],
      ['avatar / userinfo', 'Show user avatar or user information.'],
      ['serverinfo / servericon', 'Show server details or server icon.'],
      ['roleinfo / membercount', 'Show role details or member count.'],
      ['invite', 'Get the bot invite link.'],
    ],
  },
  suggestions: {
    title: 'Suggestion Commands',
    description: 'Suggestion posting and staff review.',
    commands: [
      ['suggest', 'Send a suggestion to your configured suggestions channel.'],
      ['suggestaccept', 'Mark a suggestion as accepted. Requires Manage Server.'],
      ['suggestdeny', 'Mark a suggestion as denied. Requires Manage Server.'],
      ['suggestconsider', 'Mark a suggestion as being considered. Requires Manage Server.'],
    ],
  },
  social: {
    title: 'Social Alert Commands',
    description: 'YouTube and Twitch alert configuration.',
    commands: [
      ['socialadd', 'Add YouTube video, Shorts, stream, or Twitch stream alerts. Requires Manage Server.'],
      ['socialedit', 'Edit an existing social alert source, channel, role, or enabled status. Requires Manage Server.'],
      ['sociallist', 'List configured social alerts. Requires Manage Server.'],
      ['socialcheck', 'Manually check one social alert. Requires Manage Server.'],
      ['socialremove', 'Remove a social alert. Requires Manage Server.'],
    ],
  },
};

function buildHelpRows(activeCategory = 'moderation') {
  const categories = Object.keys(helpCategories);
  const buttons = categories.map((category) => new ButtonBuilder()
    .setCustomId(`help:${category}`)
    .setLabel(helpCategories[category].title.replace(' Commands', ''))
    .setStyle(category === activeCategory ? ButtonStyle.Primary : ButtonStyle.Secondary));

  return [
    new ActionRowBuilder().addComponents(buttons.slice(0, 5)),
    new ActionRowBuilder().addComponents(buttons.slice(5)),
  ];
}

function buildHelpEmbed(category = 'moderation') {
  const help = helpCategories[category] || helpCategories.moderation;

  return new EmbedBuilder()
    .setTitle(help.title)
    .setDescription(help.description)
    .setColor('Blurple')
    .addFields(help.commands.map(([name, description]) => ({
      name: `/${name}`,
      value: description,
    })))
    .setFooter({ text: 'Use the buttons below to browse command categories.' });
}

async function ensureEconomyUser(guildId, userId) {
  await run(
    `INSERT OR IGNORE INTO economy (guildId, userId, wallet, dailyAt, workAt)
     VALUES (?, ?, 0, 0, 0)`,
    [guildId, userId],
  );

  return get(
    'SELECT * FROM economy WHERE guildId = ? AND userId = ?',
    [guildId, userId],
  );
}

async function recordEconomyTransaction(guildId, userId, actorId, change, balanceBefore, balanceAfter, reason) {
  await run(
    `INSERT INTO economy_transactions
     (guildId, userId, actorId, change, balanceBefore, balanceAfter, reason, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [guildId, userId, actorId, change, balanceBefore, balanceAfter, reason, Date.now()],
  );
}

async function addCoins(guildId, userId, amount, reason = 'Adjustment', actorId = userId) {
  const before = await ensureEconomyUser(guildId, userId);
  await run(
    'UPDATE economy SET wallet = MAX(wallet + ?, 0) WHERE guildId = ? AND userId = ?',
    [amount, guildId, userId],
  );

  const after = await ensureEconomyUser(guildId, userId);
  const actualChange = after.wallet - before.wallet;

  if (actualChange !== 0) {
    await recordEconomyTransaction(
      guildId,
      userId,
      actorId,
      actualChange,
      before.wallet,
      after.wallet,
      reason,
    );
  }

  return after;
}

async function canBet(interaction, amount) {
  const account = await ensureEconomyUser(interaction.guild.id, interaction.user.id);

  if (account.wallet < amount) {
    await interaction.reply({ content: `You only have ${formatCoins(account.wallet)}.`, ephemeral: true });
    return null;
  }

  return account;
}

async function sendLog(guild, embed) {
  const configuredChannelId = process.env.MOD_LOGS_CHANNEL_ID;
  const channel = configuredChannelId
    ? guild.channels.cache.get(configuredChannelId)
    : guild.channels.cache.find(
      (c) => c.name === 'mod-logs' && c.type === ChannelType.GuildText,
    );

  if (!channel || channel.type !== ChannelType.GuildText) return;
  await channel.send({ embeds: [embed] }).catch(console.error);
}

async function createCase(guildId, userId, moderatorId, action, reason) {
  const result = await run(
    `INSERT INTO cases (guildId, userId, moderatorId, action, reason, timestamp)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [guildId, userId, moderatorId, action, reason, Date.now()],
  );

  return result.lastID;
}

function hasPermission(interaction, permission) {
  return interaction.memberPermissions?.has(permission);
}

async function fetchMember(interaction, userId) {
  return interaction.guild.members.fetch(userId).catch(() => null);
}

function canModerate(interaction, targetMember) {
  const moderator = interaction.member;
  const botMember = interaction.guild.members.me;

  if (!targetMember || !moderator || !botMember) {
    return 'Could not find that server member.';
  }

  if (targetMember.id === interaction.user.id) {
    return 'You cannot punish yourself.';
  }

  if (targetMember.id === client.user.id) {
    return 'I cannot punish myself.';
  }

  if (targetMember.roles.highest.position >= moderator.roles.highest.position) {
    return 'You cannot punish someone with an equal or higher role.';
  }

  if (targetMember.roles.highest.position >= botMember.roles.highest.position) {
    return 'My role is not high enough to punish that member.';
  }

  return null;
}

async function getOrCreateMuteRole(guild) {
  let muteRole = guild.roles.cache.find((role) => role.name === 'Muted');
  if (muteRole) return muteRole;

  muteRole = await guild.roles.create({
    name: 'Muted',
    reason: 'Mute role required by moderation bot',
  });

  const channels = guild.channels.cache.filter((channel) => (
    channel.type === ChannelType.GuildText
    || channel.type === ChannelType.GuildVoice
    || channel.type === ChannelType.GuildForum
  ));

  for (const channel of channels.values()) {
    await channel.permissionOverwrites.edit(muteRole, {
      SendMessages: false,
      AddReactions: false,
      Speak: false,
      SendMessagesInThreads: false,
      CreatePublicThreads: false,
      CreatePrivateThreads: false,
    }).catch(console.error);
  }

  return muteRole;
}

async function handleExpiredMutes() {
  const expiredMutes = await all('SELECT * FROM mutes WHERE endTime <= ?', [Date.now()]);

  for (const mute of expiredMutes) {
    const guild = client.guilds.cache.get(mute.guildId);
    if (!guild) {
      await run('DELETE FROM mutes WHERE guildId = ? AND userId = ?', [mute.guildId, mute.userId]);
      continue;
    }

    const member = await guild.members.fetch(mute.userId).catch(() => null);
    const muteRole = guild.roles.cache.find((role) => role.name === 'Muted');

    if (member && muteRole && member.roles.cache.has(muteRole.id)) {
      await member.roles.remove(muteRole, 'Mute expired').catch(console.error);
    }

    await run('DELETE FROM mutes WHERE guildId = ? AND userId = ?', [mute.guildId, mute.userId]);
  }
}

function decodeXml(text = '') {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

let twitchAccessToken = null;
let twitchAccessTokenExpiresAt = 0;

function getXmlValue(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeXml(match[1].trim()) : '';
}

function getXmlAttribute(block, tag, attribute) {
  const match = block.match(new RegExp(`<${tag}[^>]*${attribute}="([^"]+)"`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'JabsterBot social alerts',
    },
  });

  if (!response.ok) {
    throw new Error(`Feed request failed: ${response.status}`);
  }

  return response.text();
}

async function resolveYouTubeFeed(source) {
  const trimmed = source.trim();
  if (trimmed.includes('feeds/videos.xml')) return trimmed;

  const channelMatch = trimmed.match(/(?:channel\/|channel_id=)(UC[a-zA-Z0-9_-]{20,})/);
  if (channelMatch) {
    return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelMatch[1]}`;
  }

  if (/^UC[a-zA-Z0-9_-]{20,}$/.test(trimmed)) {
    return `https://www.youtube.com/feeds/videos.xml?channel_id=${trimmed}`;
  }

  if (trimmed.includes('youtube.com/@')) {
    const page = await fetchText(trimmed);
    const handleMatch = page.match(/"externalId":"(UC[a-zA-Z0-9_-]{20,})"/)
      || page.match(/"channelId":"(UC[a-zA-Z0-9_-]{20,})"/);

    if (handleMatch) {
      return `https://www.youtube.com/feeds/videos.xml?channel_id=${handleMatch[1]}`;
    }
  }

  throw new Error('Use a YouTube channel ID, /channel/ URL, @handle URL, or RSS feed URL.');
}

function resolveTwitchLogin(source) {
  const trimmed = source.trim();
  const match = trimmed.match(/twitch\.tv\/([a-zA-Z0-9_]+)/i);
  return (match ? match[1] : trimmed.replace(/^@/, '')).toLowerCase();
}

async function getTwitchAccessToken() {
  if (twitchAccessToken && Date.now() < twitchAccessTokenExpiresAt) {
    return twitchAccessToken;
  }

  const { TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET } = process.env;
  if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET) {
    throw new Error('Missing TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET in your .env file.');
  }

  const params = new URLSearchParams({
    client_id: TWITCH_CLIENT_ID,
    client_secret: TWITCH_CLIENT_SECRET,
    grant_type: 'client_credentials',
  });

  const response = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    body: params,
  });

  if (!response.ok) {
    throw new Error(`Twitch auth failed: ${response.status}`);
  }

  const data = await response.json();
  twitchAccessToken = data.access_token;
  twitchAccessTokenExpiresAt = Date.now() + ((data.expires_in - 60) * 1000);
  return twitchAccessToken;
}

async function getTwitchStreamItem(source) {
  const login = resolveTwitchLogin(source);
  const { TWITCH_CLIENT_ID } = process.env;
  const token = await getTwitchAccessToken();
  const url = `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(login)}`;
  const response = await fetch(url, {
    headers: {
      'Client-ID': TWITCH_CLIENT_ID,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Twitch stream check failed: ${response.status}`);
  }

  const data = await response.json();
  const stream = data.data?.[0];
  if (!stream) return [];

  return [{
    key: stream.id,
    title: `${stream.user_name} is live: ${stream.title}`,
    url: `https://www.twitch.tv/${stream.user_login}`,
    published: stream.started_at,
  }];
}

function parseFeedItems(feedText) {
  const entryMatches = [...feedText.matchAll(/<entry[\s\S]*?<\/entry>/gi)];
  if (entryMatches.length) {
    return entryMatches.map((match) => {
      const block = match[0];
      return {
        key: getXmlValue(block, 'yt:videoId') || getXmlValue(block, 'id'),
        title: getXmlValue(block, 'title'),
        url: getXmlAttribute(block, 'link', 'href') || getXmlValue(block, 'link'),
        published: getXmlValue(block, 'published') || getXmlValue(block, 'updated'),
      };
    }).filter((item) => item.key && item.title && item.url);
  }

  return [...feedText.matchAll(/<item[\s\S]*?<\/item>/gi)].map((match) => {
    const block = match[0];
    return {
      key: getXmlValue(block, 'guid') || getXmlValue(block, 'link'),
      title: getXmlValue(block, 'title'),
      url: getXmlValue(block, 'link'),
      published: getXmlValue(block, 'pubDate') || getXmlValue(block, 'published'),
    };
  }).filter((item) => item.key && item.title && item.url);
}

function socialAlertLabel(alertType) {
  const labels = {
    youtube_video: 'New YouTube Video',
    youtube_short: 'New YouTube Short',
    youtube_stream: 'YouTube Stream Alert',
    twitch_stream: 'Twitch Stream Alert',
  };

  return labels[alertType] || 'Social Alert';
}

function itemMatchesAlert(alertType, item) {
  const title = item.title.toLowerCase();
  const url = item.url.toLowerCase();

  if (alertType === 'youtube_short') {
    return title.includes('#shorts') || title.includes('shorts') || url.includes('/shorts/');
  }

  if (alertType === 'youtube_stream') {
    return title.includes('live') || title.includes('stream') || title.includes('premiere');
  }

  if (alertType === 'youtube_video') {
    return !itemMatchesAlert('youtube_short', item) && !itemMatchesAlert('youtube_stream', item);
  }

  return true;
}

async function getSocialItems(alert) {
  if (alert.alertType === 'twitch_stream') {
    return getTwitchStreamItem(alert.source);
  }

  if (!alert.alertType.startsWith('youtube_')) return [];

  const feedUrl = await resolveYouTubeFeed(alert.source);

  const feedText = await fetchText(feedUrl);
  return parseFeedItems(feedText).filter((item) => itemMatchesAlert(alert.alertType, item));
}

async function sendSocialAlert(alert, item) {
  const guild = client.guilds.cache.get(alert.guildId);
  const channel = guild?.channels.cache.get(alert.discordChannelId);

  if (!channel || channel.type !== ChannelType.GuildText) return;

  const ping = alert.pingRoleId ? `<@&${alert.pingRoleId}> ` : '';
  await channel.send({
    content: `${ping}**${socialAlertLabel(alert.alertType)}**\n${item.title}\n${item.url}`,
    allowedMentions: alert.pingRoleId ? { roles: [alert.pingRoleId] } : { parse: [] },
  }).catch(console.error);
}

async function checkSocialAlert(alert, shouldAnnounce = true) {
  const items = await getSocialItems(alert);
  if (!items.length) {
    if (alert.alertType === 'twitch_stream' && alert.lastItemKey) {
      await run('UPDATE social_alerts SET lastItemKey = NULL WHERE id = ?', [alert.id]);
      return 'Twitch channel is offline. Live marker reset.';
    }

    return 'No matching posts found.';
  }

  const newest = items[0];
  if (!alert.lastItemKey) {
    await run('UPDATE social_alerts SET lastItemKey = ? WHERE id = ?', [newest.key, alert.id]);
    return `Tracking started from: ${newest.title}`;
  }

  if (newest.key === alert.lastItemKey) {
    return 'No new posts found.';
  }

  const newItems = [];
  for (const item of items) {
    if (item.key === alert.lastItemKey) break;
    newItems.push(item);
  }

  if (shouldAnnounce) {
    for (const item of newItems.reverse()) {
      await sendSocialAlert(alert, item);
    }
  }

  await run('UPDATE social_alerts SET lastItemKey = ? WHERE id = ?', [newest.key, alert.id]);
  return `Found ${newItems.length} new post(s).`;
}

async function checkSocialAlerts() {
  const alerts = await all('SELECT * FROM social_alerts WHERE enabled = 1');

  for (const alert of alerts) {
    await checkSocialAlert(alert, true).catch(console.error);
  }
}

async function handleWarn(interaction) {
  if (!hasPermission(interaction, PermissionsBitField.Flags.ModerateMembers)) {
    return interaction.reply({ content: 'No permission.', ephemeral: true });
  }

  const user = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason') || 'No reason provided';
  const member = await fetchMember(interaction, user.id);
  const moderationError = canModerate(interaction, member);

  if (moderationError) {
    return interaction.reply({ content: moderationError, ephemeral: true });
  }

  await run(
    `INSERT INTO warns (guildId, userId, count)
     VALUES (?, ?, 1)
     ON CONFLICT(guildId, userId) DO UPDATE SET count = count + 1`,
    [interaction.guild.id, user.id],
  );

  const caseId = await createCase(interaction.guild.id, user.id, interaction.user.id, 'WARN', reason);

  await interaction.reply(`Warned ${user.tag} | Case #${caseId}`);
  await sendLog(interaction.guild, new EmbedBuilder()
    .setTitle(`Case #${caseId} | WARN`)
    .setColor('Yellow')
    .addFields(
      { name: 'User', value: `<@${user.id}> (${user.tag})` },
      { name: 'Moderator', value: `<@${interaction.user.id}>` },
      { name: 'Reason', value: reason },
    )
    .setTimestamp());
}

async function handleMute(interaction) {
  if (!hasPermission(interaction, PermissionsBitField.Flags.ModerateMembers)) {
    return interaction.reply({ content: 'No permission.', ephemeral: true });
  }

  const user = interaction.options.getUser('user', true);
  const durationInput = interaction.options.getString('duration', true);
  const reason = interaction.options.getString('reason') || 'No reason provided';
  const durationMs = parseDuration(durationInput);

  if (!durationMs) {
    return interaction.reply({ content: 'Use a duration like 10s, 5m, 1h, or 1d.', ephemeral: true });
  }

  const member = await fetchMember(interaction, user.id);
  const moderationError = canModerate(interaction, member);

  if (moderationError) {
    return interaction.reply({ content: moderationError, ephemeral: true });
  }

  const muteRole = await getOrCreateMuteRole(interaction.guild);
  await member.roles.add(muteRole, reason);

  const endTime = Date.now() + durationMs;
  await run(
    `INSERT INTO mutes (guildId, userId, endTime)
     VALUES (?, ?, ?)
     ON CONFLICT(guildId, userId) DO UPDATE SET endTime = excluded.endTime`,
    [interaction.guild.id, member.id, endTime],
  );

  const caseId = await createCase(interaction.guild.id, member.id, interaction.user.id, 'MUTE', reason);

  await interaction.reply(`Muted ${user.tag} for ${formatDuration(durationMs)} | Case #${caseId}`);
  await sendLog(interaction.guild, new EmbedBuilder()
    .setTitle(`Case #${caseId} | MUTE`)
    .setColor('Orange')
    .addFields(
      { name: 'User', value: `<@${member.id}> (${user.tag})` },
      { name: 'Moderator', value: `<@${interaction.user.id}>` },
      { name: 'Duration', value: formatDuration(durationMs) },
      { name: 'Reason', value: reason },
    )
    .setTimestamp());
}

async function handleUnmute(interaction) {
  if (!hasPermission(interaction, PermissionsBitField.Flags.ModerateMembers)) {
    return interaction.reply({ content: 'No permission.', ephemeral: true });
  }

  const user = interaction.options.getUser('user', true);
  const member = await fetchMember(interaction, user.id);

  if (!member) {
    return interaction.reply({ content: 'Could not find that server member.', ephemeral: true });
  }

  const muteRole = interaction.guild.roles.cache.find((role) => role.name === 'Muted');
  if (muteRole && member.roles.cache.has(muteRole.id)) {
    await member.roles.remove(muteRole, 'Manual unmute');
  }

  await run('DELETE FROM mutes WHERE guildId = ? AND userId = ?', [interaction.guild.id, member.id]);
  const caseId = await createCase(interaction.guild.id, member.id, interaction.user.id, 'UNMUTE', 'Manual unmute');

  await interaction.reply(`Unmuted ${user.tag} | Case #${caseId}`);
  await sendLog(interaction.guild, new EmbedBuilder()
    .setTitle(`Case #${caseId} | UNMUTE`)
    .setColor('Green')
    .addFields(
      { name: 'User', value: `<@${member.id}> (${user.tag})` },
      { name: 'Moderator', value: `<@${interaction.user.id}>` },
    )
    .setTimestamp());
}

async function handleCase(interaction) {
  const id = interaction.options.getInteger('id', true);
  const row = await get(
    'SELECT * FROM cases WHERE guildId = ? AND id = ?',
    [interaction.guild.id, id],
  );

  if (!row) {
    return interaction.reply({ content: 'Case not found.', ephemeral: true });
  }

  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle(`Case #${row.id}`)
        .addFields(
          { name: 'Action', value: row.action },
          { name: 'User', value: `<@${row.userId}>` },
          { name: 'Moderator', value: `<@${row.moderatorId}>` },
          { name: 'Reason', value: row.reason },
        )
        .setTimestamp(row.timestamp),
    ],
  });
}

async function handleModLogs(interaction) {
  if (!hasPermission(interaction, PermissionsBitField.Flags.ModerateMembers)) {
    return interaction.reply({ content: 'No permission.', ephemeral: true });
  }

  const user = interaction.options.getUser('user');
  const action = interaction.options.getString('action');
  const limit = interaction.options.getInteger('limit') || 10;
  const where = ['guildId = ?'];
  const params = [interaction.guild.id];

  if (user) {
    where.push('userId = ?');
    params.push(user.id);
  }

  if (action) {
    where.push('action = ?');
    params.push(action);
  }

  params.push(limit);

  const cases = await all(
    `SELECT * FROM cases
     WHERE ${where.join(' AND ')}
     ORDER BY id DESC
     LIMIT ?`,
    params,
  );

  if (!cases.length) {
    return interaction.reply({ content: 'No moderation logs found.', ephemeral: true });
  }

  const embed = new EmbedBuilder()
    .setTitle(user ? `Moderation Logs for ${user.tag}` : 'Moderation Logs')
    .setColor('Blurple')
    .setFooter({ text: `Showing ${cases.length} latest case(s)` })
    .setTimestamp();

  for (const row of cases) {
    embed.addFields({
      name: `Case #${row.id} | ${row.action} | <t:${Math.floor(row.timestamp / 1000)}:d>`,
      value: [
        `User: <@${row.userId}>`,
        `Issued by: <@${row.moderatorId}>`,
        `Date: <t:${Math.floor(row.timestamp / 1000)}:F>`,
        `Reason: ${truncateText(row.reason)}`,
      ].join('\n'),
    });
  }

  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleClear(interaction) {
  if (!hasPermission(interaction, PermissionsBitField.Flags.ManageMessages)) {
    return interaction.reply({ content: 'No permission.', ephemeral: true });
  }

  const amount = interaction.options.getInteger('amount', true);
  if (amount < 1 || amount > 100) {
    return interaction.reply({ content: 'Choose a number from 1 to 100.', ephemeral: true });
  }

  const deleted = await interaction.channel.bulkDelete(amount, true);
  const caseId = await createCase(
    interaction.guild.id,
    interaction.user.id,
    interaction.user.id,
    'CLEAR',
    `${deleted.size} message(s) deleted in #${interaction.channel.name}`,
  );

  await interaction.reply({ content: `Cleared ${deleted.size} message(s).`, ephemeral: true });
  await sendLog(interaction.guild, new EmbedBuilder()
    .setTitle(`Case #${caseId} | CLEAR`)
    .setColor('Blue')
    .addFields(
      { name: 'Moderator', value: `<@${interaction.user.id}>` },
      { name: 'Amount', value: `${deleted.size}` },
      { name: 'Channel', value: `${interaction.channel}` },
    )
    .setTimestamp());
}

async function handleKick(interaction) {
  if (!hasPermission(interaction, PermissionsBitField.Flags.KickMembers)) {
    return interaction.reply({ content: 'No permission.', ephemeral: true });
  }

  const user = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason') || 'No reason provided';
  const member = await fetchMember(interaction, user.id);
  const moderationError = canModerate(interaction, member);

  if (moderationError) {
    return interaction.reply({ content: moderationError, ephemeral: true });
  }

  await member.kick(reason);
  const caseId = await createCase(interaction.guild.id, user.id, interaction.user.id, 'KICK', reason);

  await interaction.reply(`Kicked ${user.tag} | Case #${caseId}`);
  await sendLog(interaction.guild, new EmbedBuilder()
    .setTitle(`Case #${caseId} | KICK`)
    .setColor('Red')
    .addFields(
      { name: 'User', value: `<@${user.id}> (${user.tag})` },
      { name: 'Moderator', value: `<@${interaction.user.id}>` },
      { name: 'Reason', value: reason },
    )
    .setTimestamp());
}

async function handleBan(interaction) {
  if (!hasPermission(interaction, PermissionsBitField.Flags.BanMembers)) {
    return interaction.reply({ content: 'No permission.', ephemeral: true });
  }

  const user = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason') || 'No reason provided';
  const deleteDays = interaction.options.getInteger('delete_days') || 0;
  const member = await fetchMember(interaction, user.id);

  if (member) {
    const moderationError = canModerate(interaction, member);
    if (moderationError) {
      return interaction.reply({ content: moderationError, ephemeral: true });
    }
  }

  await interaction.guild.members.ban(user.id, {
    deleteMessageSeconds: deleteDays * 24 * 60 * 60,
    reason,
  });

  const caseId = await createCase(interaction.guild.id, user.id, interaction.user.id, 'BAN', reason);

  await interaction.reply(`Banned ${user.tag} | Case #${caseId}`);
  await sendLog(interaction.guild, new EmbedBuilder()
    .setTitle(`Case #${caseId} | BAN`)
    .setColor('DarkRed')
    .addFields(
      { name: 'User', value: `<@${user.id}> (${user.tag})` },
      { name: 'Moderator', value: `<@${interaction.user.id}>` },
      { name: 'Deleted Messages', value: `${deleteDays} day(s)` },
      { name: 'Reason', value: reason },
    )
    .setTimestamp());
}

async function handleUnban(interaction) {
  if (!hasPermission(interaction, PermissionsBitField.Flags.BanMembers)) {
    return interaction.reply({ content: 'No permission.', ephemeral: true });
  }

  const userId = interaction.options.getString('user_id', true);
  const reason = interaction.options.getString('reason') || 'No reason provided';

  await interaction.guild.members.unban(userId, reason);
  const caseId = await createCase(interaction.guild.id, userId, interaction.user.id, 'UNBAN', reason);

  await interaction.reply(`Unbanned <@${userId}> | Case #${caseId}`);
  await sendLog(interaction.guild, new EmbedBuilder()
    .setTitle(`Case #${caseId} | UNBAN`)
    .setColor('Green')
    .addFields(
      { name: 'User ID', value: userId },
      { name: 'Moderator', value: `<@${interaction.user.id}>` },
      { name: 'Reason', value: reason },
    )
    .setTimestamp());
}

async function handleSlowmode(interaction) {
  if (!hasPermission(interaction, PermissionsBitField.Flags.ManageChannels)) {
    return interaction.reply({ content: 'No permission.', ephemeral: true });
  }

  const seconds = interaction.options.getInteger('seconds', true);
  await interaction.channel.setRateLimitPerUser(seconds, `Slowmode changed by ${interaction.user.tag}`);

  const caseId = await createCase(
    interaction.guild.id,
    interaction.user.id,
    interaction.user.id,
    'SLOWMODE',
    `${seconds}s in #${interaction.channel.name}`,
  );

  await interaction.reply(`Slowmode set to ${seconds} second(s). | Case #${caseId}`);
  await sendLog(interaction.guild, new EmbedBuilder()
    .setTitle(`Case #${caseId} | SLOWMODE`)
    .setColor('Blue')
    .addFields(
      { name: 'Moderator', value: `<@${interaction.user.id}>` },
      { name: 'Channel', value: `${interaction.channel}` },
      { name: 'Seconds', value: `${seconds}` },
    )
    .setTimestamp());
}

async function handleLock(interaction) {
  if (!hasPermission(interaction, PermissionsBitField.Flags.ManageChannels)) {
    return interaction.reply({ content: 'No permission.', ephemeral: true });
  }

  await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
    SendMessages: false,
  }, { reason: `Channel locked by ${interaction.user.tag}` });

  const caseId = await createCase(
    interaction.guild.id,
    interaction.user.id,
    interaction.user.id,
    'LOCK',
    `Locked #${interaction.channel.name}`,
  );

  await interaction.reply(`Locked ${interaction.channel}. | Case #${caseId}`);
  await sendLog(interaction.guild, new EmbedBuilder()
    .setTitle(`Case #${caseId} | LOCK`)
    .setColor('DarkGrey')
    .addFields(
      { name: 'Moderator', value: `<@${interaction.user.id}>` },
      { name: 'Channel', value: `${interaction.channel}` },
    )
    .setTimestamp());
}

async function handleUnlock(interaction) {
  if (!hasPermission(interaction, PermissionsBitField.Flags.ManageChannels)) {
    return interaction.reply({ content: 'No permission.', ephemeral: true });
  }

  await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
    SendMessages: null,
  }, { reason: `Channel unlocked by ${interaction.user.tag}` });

  const caseId = await createCase(
    interaction.guild.id,
    interaction.user.id,
    interaction.user.id,
    'UNLOCK',
    `Unlocked #${interaction.channel.name}`,
  );

  await interaction.reply(`Unlocked ${interaction.channel}. | Case #${caseId}`);
  await sendLog(interaction.guild, new EmbedBuilder()
    .setTitle(`Case #${caseId} | UNLOCK`)
    .setColor('Green')
    .addFields(
      { name: 'Moderator', value: `<@${interaction.user.id}>` },
      { name: 'Channel', value: `${interaction.channel}` },
    )
    .setTimestamp());
}

async function handleNick(interaction) {
  if (!hasPermission(interaction, PermissionsBitField.Flags.ManageNicknames)) {
    return interaction.reply({ content: 'No permission.', ephemeral: true });
  }

  const user = interaction.options.getUser('user', true);
  const nickname = interaction.options.getString('nickname');
  const member = await fetchMember(interaction, user.id);
  const moderationError = canModerate(interaction, member);

  if (moderationError) {
    return interaction.reply({ content: moderationError, ephemeral: true });
  }

  await member.setNickname(nickname || null, `Nickname changed by ${interaction.user.tag}`);
  const shownName = nickname || 'server nickname removed';

  await interaction.reply(`Updated ${user.tag}: ${shownName}`);
}

async function handleAvatar(interaction) {
  const user = interaction.options.getUser('user') || interaction.user;
  const avatarUrl = user.displayAvatarURL({ size: 1024, extension: 'png' });

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle(`${user.tag}'s avatar`)
        .setImage(avatarUrl)
        .setColor('Blurple'),
    ],
  });
}

async function handleUserInfo(interaction) {
  const user = interaction.options.getUser('user') || interaction.user;
  const member = await fetchMember(interaction, user.id);

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle(`${user.tag}`)
        .setThumbnail(user.displayAvatarURL({ size: 256 }))
        .setColor('Blurple')
        .addFields(
          { name: 'User ID', value: user.id, inline: true },
          { name: 'Account Created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F>` },
          {
            name: 'Joined Server',
            value: member?.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>` : 'Not in server',
          },
          {
            name: 'Highest Role',
            value: member?.roles.highest ? `${member.roles.highest}` : 'None',
            inline: true,
          },
        ),
    ],
  });
}

async function handleServerInfo(interaction) {
  const { guild } = interaction;
  const owner = await guild.fetchOwner().catch(() => null);

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle(guild.name)
        .setThumbnail(guild.iconURL({ size: 256 }))
        .setColor('Blurple')
        .addFields(
          { name: 'Server ID', value: guild.id, inline: true },
          { name: 'Owner', value: owner ? `<@${owner.id}>` : 'Unknown', inline: true },
          { name: 'Members', value: `${guild.memberCount}`, inline: true },
          { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>` },
          { name: 'Channels', value: `${guild.channels.cache.size}`, inline: true },
          { name: 'Roles', value: `${guild.roles.cache.size}`, inline: true },
        ),
    ],
  });
}

async function handlePing(interaction) {
  const sent = await interaction.reply({ content: 'Checking...', fetchReply: true });
  const latency = sent.createdTimestamp - interaction.createdTimestamp;

  await interaction.editReply(`Pong. Bot latency: **${latency}ms** | API: **${client.ws.ping}ms**.`);
}

async function handleUptime(interaction) {
  const totalSeconds = Math.floor(process.uptime());
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  await interaction.reply(`I have been online for **${days}d ${hours}h ${minutes}m ${seconds}s**.`);
}

async function handlePoll(interaction) {
  if (!hasPermission(interaction, PermissionsBitField.Flags.ManageMessages)) {
    return interaction.reply({ content: 'No permission.', ephemeral: true });
  }

  const question = interaction.options.getString('question', true);
  const first = interaction.options.getString('option1', true);
  const second = interaction.options.getString('option2', true);
  const third = interaction.options.getString('option3');
  const fourth = interaction.options.getString('option4');
  const options = [first, second, third, fourth].filter(Boolean);
  const reactions = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];

  const embed = new EmbedBuilder()
    .setTitle(question)
    .setColor('Blurple')
    .setDescription(options.map((option, index) => `${reactions[index]} ${option}`).join('\n'))
    .setFooter({ text: `Poll by ${interaction.user.tag}` })
    .setTimestamp();

  const message = await interaction.reply({ embeds: [embed], fetchReply: true });

  for (let index = 0; index < options.length; index += 1) {
    await message.react(reactions[index]).catch(console.error);
  }
}

async function handleSay(interaction) {
  if (!hasPermission(interaction, PermissionsBitField.Flags.ManageMessages)) {
    return interaction.reply({ content: 'No permission.', ephemeral: true });
  }

  const text = interaction.options.getString('message', true);
  await interaction.channel.send({ content: text, allowedMentions: { parse: [] } });
  return interaction.reply({ content: 'Sent.', ephemeral: true });
}

async function handleAnnounce(interaction) {
  if (!hasPermission(interaction, PermissionsBitField.Flags.ManageGuild)) {
    return interaction.reply({ content: 'No permission.', ephemeral: true });
  }

  const channel = interaction.options.getChannel('channel', true);
  const title = interaction.options.getString('title', true);
  const message = interaction.options.getString('message', true);

  if (channel.type !== ChannelType.GuildText) {
    return interaction.reply({ content: 'Please choose a normal text channel.', ephemeral: true });
  }

  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setTitle(title)
        .setDescription(message)
        .setColor('Gold')
        .setFooter({ text: `Announcement by ${interaction.user.tag}` })
        .setTimestamp(),
    ],
    allowedMentions: { parse: [] },
  });

  return interaction.reply({ content: `Announcement sent to ${channel}.`, ephemeral: true });
}

async function handleServerIcon(interaction) {
  const iconUrl = interaction.guild.iconURL({ size: 1024, extension: 'png' });

  if (!iconUrl) {
    return interaction.reply({ content: 'This server does not have an icon.', ephemeral: true });
  }

  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle(`${interaction.guild.name}'s icon`)
        .setImage(iconUrl)
        .setColor('Blurple'),
    ],
  });
}

async function handleRoleInfo(interaction) {
  const role = interaction.options.getRole('role', true);

  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle(role.name)
        .setColor(role.color || 'Blurple')
        .addFields(
          { name: 'Role ID', value: role.id, inline: true },
          { name: 'Members', value: `${role.members.size}`, inline: true },
          { name: 'Position', value: `${role.position}`, inline: true },
          { name: 'Mentionable', value: role.mentionable ? 'Yes' : 'No', inline: true },
          { name: 'Created', value: `<t:${Math.floor(role.createdTimestamp / 1000)}:F>` },
        ),
    ],
  });
}

async function handleMemberCount(interaction) {
  await interaction.reply(`This server has **${interaction.guild.memberCount}** member(s).`);
}

async function handleInvite(interaction) {
  await interaction.reply({
    content: `Invite me with this link:\nhttps://discord.com/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands`,
    ephemeral: true,
  });
}

async function handleSuggest(interaction) {
  const suggestion = interaction.options.getString('suggestion', true);
  const configuredChannelId = process.env.SUGGESTIONS_CHANNEL_ID;
  const channel = configuredChannelId
    ? interaction.guild.channels.cache.get(configuredChannelId)
    : interaction.guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name.toLowerCase().includes('suggestions'),
    );

  if (!channel || channel.type !== ChannelType.GuildText) {
    return interaction.reply({
      content: 'I could not find your suggestions channel. Add SUGGESTIONS_CHANNEL_ID to your .env for best results.',
      ephemeral: true,
    });
  }

  const message = await channel.send({
    embeds: [
      new EmbedBuilder()
        .setTitle('New Suggestion')
        .setDescription(suggestion)
        .setColor('Yellow')
        .addFields(
          { name: 'Suggested By', value: `${interaction.user}` },
          { name: 'Status', value: 'Pending' },
        )
        .setFooter({ text: `Suggestion ID: ${interaction.user.id}` })
        .setTimestamp(),
    ],
  });

  await message.react('✅').catch(console.error);
  await message.react('❌').catch(console.error);

  return interaction.reply({ content: `Suggestion sent: ${message.url}`, ephemeral: true });
}

async function handleHelp(interaction) {
  const category = interaction.options.getString('category') || 'moderation';

  return interaction.reply({
    embeds: [buildHelpEmbed(category)],
    components: buildHelpRows(category),
    ephemeral: true,
  });
}

async function updateSuggestionStatus(interaction, status, color) {
  if (!hasPermission(interaction, PermissionsBitField.Flags.ManageGuild)) {
    return interaction.reply({ content: 'No permission.', ephemeral: true });
  }

  const messageId = interaction.options.getString('message_id', true);
  const reason = interaction.options.getString('reason') || 'No reason provided';
  const configuredChannelId = process.env.SUGGESTIONS_CHANNEL_ID;
  const channel = configuredChannelId
    ? interaction.guild.channels.cache.get(configuredChannelId)
    : interaction.guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name.toLowerCase().includes('suggestions'),
    );

  if (!channel || channel.type !== ChannelType.GuildText) {
    return interaction.reply({ content: 'I could not find the suggestions channel.', ephemeral: true });
  }

  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message || !message.embeds.length) {
    return interaction.reply({ content: 'Suggestion message not found.', ephemeral: true });
  }

  const original = message.embeds[0];
  const fields = original.fields.filter((field) => field.name !== 'Status' && field.name !== 'Staff Reason');
  const updatedEmbed = EmbedBuilder.from(original)
    .setTitle(`${status} Suggestion`)
    .setColor(color)
    .setFields(
      ...fields,
      { name: 'Status', value: status },
      { name: 'Staff Reason', value: reason },
    )
    .setFooter({ text: `${status} by ${interaction.user.tag}` })
    .setTimestamp();

  await message.edit({ embeds: [updatedEmbed] });
  return interaction.reply({ content: `Suggestion marked as ${status.toLowerCase()}.`, ephemeral: true });
}

async function handleSuggestAccept(interaction) {
  return updateSuggestionStatus(interaction, 'Accepted', 'Green');
}

async function handleSuggestDeny(interaction) {
  return updateSuggestionStatus(interaction, 'Denied', 'Red');
}

async function handleSuggestConsider(interaction) {
  return updateSuggestionStatus(interaction, 'Considering', 'Orange');
}

async function handleEightBall(interaction) {
  const question = interaction.options.getString('question', true);
  const answers = [
    'Yes.',
    'No.',
    'Definitely.',
    'Absolutely not.',
    'Ask again later.',
    'The signs point to yes.',
    'I would not count on it.',
    'Without a doubt.',
    'Very likely.',
    'Not looking great.',
  ];

  await interaction.reply(`Question: ${question}\n8 Ball: ${randomItem(answers)}`);
}

async function handleCoinFlip(interaction) {
  await interaction.reply(`The coin landed on **${randomItem(['Heads', 'Tails'])}**.`);
}

async function handleRoll(interaction) {
  const sides = interaction.options.getInteger('sides') || 6;
  const result = Math.floor(Math.random() * sides) + 1;

  await interaction.reply(`You rolled **${result}** out of ${sides}.`);
}

async function handleRate(interaction) {
  const thing = interaction.options.getString('thing', true);
  const rating = Math.floor(Math.random() * 101);

  await interaction.reply(`I rate **${thing}** a **${rating}/100**.`);
}

async function handleShip(interaction) {
  const first = interaction.options.getUser('first', true);
  const second = interaction.options.getUser('second', true);
  const score = Math.floor(Math.random() * 101);

  await interaction.reply(`${first} + ${second} = **${score}%** match.`);
}

async function handleJoke(interaction) {
  const jokes = [
    'Why did the computer get cold? It left its Windows open.',
    'I told my code a joke, but it did not react.',
    'Why do programmers prefer dark mode? Because light attracts bugs.',
    'My bot tried stand-up comedy. It had great command presence.',
    'I asked the database for a joke, but it returned null.',
  ];

  await interaction.reply(randomItem(jokes));
}

async function handleCompliment(interaction) {
  const user = interaction.options.getUser('user') || interaction.user;
  const compliments = [
    'has excellent energy today.',
    'is absolutely carrying the server vibe.',
    'has top-tier taste.',
    'is cooler than the other side of the pillow.',
    'deserves a victory lap.',
  ];

  await interaction.reply(`${user} ${randomItem(compliments)}`);
}

async function handleRoast(interaction) {
  const user = interaction.options.getUser('user') || interaction.user;
  const roasts = [
    'has the reaction time of a loading screen.',
    'types like autocorrect gave up halfway.',
    'is built like a low battery warning.',
    'has main character energy from the tutorial level.',
    'could lose a race to a progress bar.',
  ];

  await interaction.reply(`${user} ${randomItem(roasts)}`);
}

async function handleChoose(interaction) {
  const choices = interaction.options.getString('choices', true)
    .split(',')
    .map((choice) => choice.trim())
    .filter(Boolean);

  if (choices.length < 2) {
    return interaction.reply({ content: 'Give me at least two choices separated by commas.', ephemeral: true });
  }

  await interaction.reply(`I choose: **${randomItem(choices)}**`);
}

async function handleReverse(interaction) {
  const text = interaction.options.getString('text', true);
  const reversed = [...text].reverse().join('');

  await interaction.reply(truncateText(reversed, 1900));
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'JabsterBot fun commands',
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json();
}

async function handleMeme(interaction) {
  await interaction.deferReply();

  const data = await fetchJson('https://meme-api.com/gimme');

  return interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle(data.title || 'Random Meme')
        .setURL(data.postLink || null)
        .setImage(data.url)
        .setColor('Random')
        .setFooter({ text: data.subreddit ? `r/${data.subreddit}` : 'Random meme' }),
    ],
  });
}

async function handleCat(interaction) {
  await interaction.deferReply();

  const data = await fetchJson('https://api.thecatapi.com/v1/images/search');
  const imageUrl = data[0]?.url;

  if (!imageUrl) return interaction.editReply('I could not find a cat picture right now.');

  return interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle('Random Cat')
        .setImage(imageUrl)
        .setColor('Blurple'),
    ],
  });
}

async function handleDog(interaction) {
  await interaction.deferReply();

  const data = await fetchJson('https://dog.ceo/api/breeds/image/random');

  return interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle('Random Dog')
        .setImage(data.message)
        .setColor('Blurple'),
    ],
  });
}

async function handleFox(interaction) {
  await interaction.deferReply();

  const data = await fetchJson('https://randomfox.ca/floof/');

  return interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle('Random Fox')
        .setImage(data.image)
        .setColor('Orange'),
    ],
  });
}

async function handleDuck(interaction) {
  await interaction.deferReply();

  const data = await fetchJson('https://random-d.uk/api/random');

  return interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle('Random Duck')
        .setImage(data.url)
        .setColor('Yellow'),
    ],
  });
}

async function handleFact(interaction) {
  await interaction.deferReply();

  const kind = interaction.options.getString('kind') || 'random';
  const urls = {
    cat: 'https://catfact.ninja/fact',
    dog: 'https://dogapi.dog/api/v2/facts',
  };

  if (kind === 'cat') {
    const data = await fetchJson(urls.cat);
    return interaction.editReply(data.fact || 'I could not find a cat fact right now.');
  }

  if (kind === 'dog') {
    const data = await fetchJson(urls.dog);
    return interaction.editReply(data.data?.[0]?.attributes?.body || 'I could not find a dog fact right now.');
  }

  const facts = [
    'Honey never spoils.',
    'Bananas are berries, but strawberries are not.',
    'A day on Venus is longer than a year on Venus.',
    'Octopuses have three hearts.',
    'The first computer bug was an actual moth.',
  ];

  return interaction.editReply(randomItem(facts));
}

async function handleBalance(interaction) {
  const user = interaction.options.getUser('user') || interaction.user;
  const account = await ensureEconomyUser(interaction.guild.id, user.id);

  await interaction.reply(`${user} has **${formatCoins(account.wallet)}**.`);
}

async function handleTransactions(interaction) {
  const user = interaction.options.getUser('user') || interaction.user;
  const limit = interaction.options.getInteger('limit') || 10;
  const rows = await all(
    `SELECT * FROM economy_transactions
     WHERE guildId = ? AND userId = ?
     ORDER BY id DESC
     LIMIT ?`,
    [interaction.guild.id, user.id, limit],
  );

  if (!rows.length) {
    return interaction.reply({ content: `${user} has no economy transactions yet.`, ephemeral: true });
  }

  const lines = rows.map((row) => {
    const sign = row.change > 0 ? '+' : '';
    return [
      `**${sign}${formatCoins(row.change)}** | ${formatCoins(row.balanceBefore)} -> ${formatCoins(row.balanceAfter)}`,
      `${truncateText(row.reason, 120)} | <t:${Math.floor(row.timestamp / 1000)}:R>`,
    ].join('\n');
  });

  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle(`Economy Transactions for ${user.tag}`)
        .setColor('Gold')
        .setDescription(lines.join('\n\n')),
    ],
    ephemeral: true,
  });
}

async function handleDaily(interaction) {
  const account = await ensureEconomyUser(interaction.guild.id, interaction.user.id);
  const now = Date.now();
  const cooldown = 24 * 60 * 60 * 1000;
  const nextDaily = account.dailyAt + cooldown;

  if (now < nextDaily) {
    return interaction.reply({
      content: `You can claim daily again <t:${Math.floor(nextDaily / 1000)}:R>.`,
      ephemeral: true,
    });
  }

  const reward = 500;
  const updated = await addCoins(interaction.guild.id, interaction.user.id, reward, 'Daily reward');
  await run(
    'UPDATE economy SET dailyAt = ? WHERE guildId = ? AND userId = ?',
    [now, interaction.guild.id, interaction.user.id],
  );

  return interaction.reply(`You claimed **${formatCoins(reward)}**. Balance: **${formatCoins(updated.wallet)}**.`);
}

async function handleWork(interaction) {
  const account = await ensureEconomyUser(interaction.guild.id, interaction.user.id);
  const now = Date.now();
  const cooldown = 60 * 60 * 1000;
  const nextWork = account.workAt + cooldown;

  if (now < nextWork) {
    return interaction.reply({
      content: `You can work again <t:${Math.floor(nextWork / 1000)}:R>.`,
      ephemeral: true,
    });
  }

  const jobs = [
    'delivered game passes',
    'cleaned the server chat',
    'tested a Roblox obby',
    'moderated a beach party',
    'found a rare shell',
    'fixed a broken command',
  ];
  const reward = Math.floor(Math.random() * 251) + 150;

  const job = randomItem(jobs);
  const updated = await addCoins(interaction.guild.id, interaction.user.id, reward, `Work: ${job}`);
  await run(
    'UPDATE economy SET workAt = ? WHERE guildId = ? AND userId = ?',
    [now, interaction.guild.id, interaction.user.id],
  );

  return interaction.reply(`You ${job} and earned **${formatCoins(reward)}**. Balance: **${formatCoins(updated.wallet)}**.`);
}

async function handlePay(interaction) {
  const target = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('amount', true);

  if (target.bot) {
    return interaction.reply({ content: 'You cannot pay bots.', ephemeral: true });
  }

  if (target.id === interaction.user.id) {
    return interaction.reply({ content: 'You cannot pay yourself.', ephemeral: true });
  }

  const sender = await ensureEconomyUser(interaction.guild.id, interaction.user.id);
  if (sender.wallet < amount) {
    return interaction.reply({ content: `You only have ${formatCoins(sender.wallet)}.`, ephemeral: true });
  }

  await addCoins(interaction.guild.id, interaction.user.id, -amount, `Paid ${target.tag}`, interaction.user.id);
  const receiver = await addCoins(interaction.guild.id, target.id, amount, `Payment from ${interaction.user.tag}`, interaction.user.id);

  return interaction.reply(`You paid ${target} **${formatCoins(amount)}**. Their balance is now **${formatCoins(receiver.wallet)}**.`);
}

async function handleLeaderboard(interaction) {
  const rows = await all(
    `SELECT userId, wallet FROM economy
     WHERE guildId = ?
     ORDER BY wallet DESC
     LIMIT 10`,
    [interaction.guild.id],
  );

  if (!rows.length) {
    return interaction.reply('No one has any coins yet. Use `/daily` or `/work` to start.');
  }

  const lines = rows.map((row, index) => `${index + 1}. <@${row.userId}> - **${formatCoins(row.wallet)}**`);

  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle('Economy Leaderboard')
        .setColor('Gold')
        .setDescription(lines.join('\n')),
    ],
  });
}

async function handleCoinBet(interaction) {
  const guess = interaction.options.getString('guess', true);
  const amount = interaction.options.getInteger('amount', true);
  const account = await ensureEconomyUser(interaction.guild.id, interaction.user.id);

  if (account.wallet < amount) {
    return interaction.reply({ content: `You only have ${formatCoins(account.wallet)}.`, ephemeral: true });
  }

  const result = randomItem(['heads', 'tails']);
  const won = guess === result;
  const updated = await addCoins(
    interaction.guild.id,
    interaction.user.id,
    won ? amount : -amount,
    `Coinbet ${won ? 'win' : 'loss'} (${guess} vs ${result})`,
  );

  return interaction.reply(`The coin landed on **${result}**. You ${won ? 'won' : 'lost'} **${formatCoins(amount)}**. Balance: **${formatCoins(updated.wallet)}**.`);
}

async function handleEcoAdd(interaction) {
  if (!hasPermission(interaction, PermissionsBitField.Flags.ManageGuild)) {
    return interaction.reply({ content: 'No permission.', ephemeral: true });
  }

  const user = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('amount', true);
  const account = await addCoins(interaction.guild.id, user.id, amount, `Admin add by ${interaction.user.tag}`, interaction.user.id);

  return interaction.reply(`Added **${formatCoins(amount)}** to ${user}. Balance: **${formatCoins(account.wallet)}**.`);
}

async function handleEcoRemove(interaction) {
  if (!hasPermission(interaction, PermissionsBitField.Flags.ManageGuild)) {
    return interaction.reply({ content: 'No permission.', ephemeral: true });
  }

  const user = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('amount', true);
  const account = await addCoins(interaction.guild.id, user.id, -amount, `Admin remove by ${interaction.user.tag}`, interaction.user.id);

  return interaction.reply(`Removed **${formatCoins(amount)}** from ${user}. Balance: **${formatCoins(account.wallet)}**.`);
}

async function handleSlots(interaction) {
  const amount = interaction.options.getInteger('amount', true);
  if (!(await canBet(interaction, amount))) return;

  const symbols = ['7', 'BAR', 'Cherry', 'Lemon', 'Diamond'];
  const result = [randomItem(symbols), randomItem(symbols), randomItem(symbols)];
  const allSame = result.every((symbol) => symbol === result[0]);
  const twoSame = new Set(result).size === 2;
  const payout = allSame ? amount * 5 : twoSame ? amount * 2 : 0;
  const change = payout ? payout - amount : -amount;
  const account = await addCoins(interaction.guild.id, interaction.user.id, change, `Slots: ${result.join(' | ')}`);

  return interaction.reply(
    `Slots: **${result.join(' | ')}**\n`
    + `${payout ? `You won **${formatCoins(payout)}**.` : `You lost **${formatCoins(amount)}**.`} `
    + `Balance: **${formatCoins(account.wallet)}**.`,
  );
}

async function handleDiceBet(interaction) {
  const guess = interaction.options.getInteger('guess', true);
  const amount = interaction.options.getInteger('amount', true);
  if (!(await canBet(interaction, amount))) return;

  const roll = Math.floor(Math.random() * 6) + 1;
  const won = guess === roll;
  const account = await addCoins(
    interaction.guild.id,
    interaction.user.id,
    won ? amount * 5 : -amount,
    `Dicebet ${won ? 'win' : 'loss'} (guessed ${guess}, rolled ${roll})`,
  );

  return interaction.reply(
    `The dice rolled **${roll}**. You ${won ? 'won' : 'lost'} `
    + `**${formatCoins(won ? amount * 5 : amount)}**. Balance: **${formatCoins(account.wallet)}**.`,
  );
}

async function handleRoulette(interaction) {
  const choice = interaction.options.getString('choice', true);
  const amount = interaction.options.getInteger('amount', true);
  if (!(await canBet(interaction, amount))) return;

  const number = Math.floor(Math.random() * 37);
  const color = number === 0 ? 'green' : number % 2 === 0 ? 'black' : 'red';
  const multiplier = choice === 'green' ? 14 : 2;
  const won = choice === color;
  const account = await addCoins(
    interaction.guild.id,
    interaction.user.id,
    won ? amount * (multiplier - 1) : -amount,
    `Roulette ${won ? 'win' : 'loss'} (${choice} vs ${color})`,
  );

  return interaction.reply(
    `Roulette landed on **${number} ${color}**. You ${won ? 'won' : 'lost'} `
    + `**${formatCoins(won ? amount * multiplier : amount)}**. Balance: **${formatCoins(account.wallet)}**.`,
  );
}

async function handleScratch(interaction) {
  const amount = interaction.options.getInteger('amount', true);
  if (!(await canBet(interaction, amount))) return;

  const prizes = [0, 0, 0, 0, amount, amount * 2, amount * 3, amount * 8];
  const prize = randomItem(prizes);
  const account = await addCoins(interaction.guild.id, interaction.user.id, prize - amount, `Scratch card prize: ${prize}`);

  return interaction.reply(
    `Scratch card result: **${prize ? formatCoins(prize) : 'nothing'}**. `
    + `Balance: **${formatCoins(account.wallet)}**.`,
  );
}

async function handleHighLow(interaction) {
  const guess = interaction.options.getString('guess', true);
  const amount = interaction.options.getInteger('amount', true);
  if (!(await canBet(interaction, amount))) return;

  const number = Math.floor(Math.random() * 100) + 1;
  const result = number >= 51 ? 'high' : 'low';
  const won = guess === result;
  const account = await addCoins(
    interaction.guild.id,
    interaction.user.id,
    won ? amount : -amount,
    `Highlow ${won ? 'win' : 'loss'} (${guess} vs ${result})`,
  );

  return interaction.reply(
    `The number was **${number}** (${result}). You ${won ? 'won' : 'lost'} `
    + `**${formatCoins(amount)}**. Balance: **${formatCoins(account.wallet)}**.`,
  );
}

async function handleBeg(interaction) {
  const reward = Math.floor(Math.random() * 91) + 10;
  const account = await addCoins(interaction.guild.id, interaction.user.id, reward, 'Beg reward');

  return interaction.reply(`Someone felt generous and gave you **${formatCoins(reward)}**. Balance: **${formatCoins(account.wallet)}**.`);
}

async function handleCrime(interaction) {
  const account = await ensureEconomyUser(interaction.guild.id, interaction.user.id);
  const success = Math.random() < 0.55;
  const amount = Math.floor(Math.random() * 401) + 100;
  const loss = Math.min(amount, account.wallet);
  const updated = await addCoins(interaction.guild.id, interaction.user.id, success ? amount : -loss, `Crime ${success ? 'success' : 'caught'}`);

  return interaction.reply(
    success
      ? `You pulled it off and earned **${formatCoins(amount)}**. Balance: **${formatCoins(updated.wallet)}**.`
      : `You got caught and paid **${formatCoins(loss)}**. Balance: **${formatCoins(updated.wallet)}**.`,
  );
}

async function handleLottery(interaction) {
  const amount = interaction.options.getInteger('amount', true);
  if (!(await canBet(interaction, amount))) return;

  const won = Math.random() < 0.12;
  const prize = amount * 10;
  const account = await addCoins(interaction.guild.id, interaction.user.id, won ? prize - amount : -amount, `Lottery ${won ? 'jackpot' : 'loss'}`);

  return interaction.reply(
    won
      ? `Jackpot. You won **${formatCoins(prize)}**. Balance: **${formatCoins(account.wallet)}**.`
      : `No jackpot this time. You lost **${formatCoins(amount)}**. Balance: **${formatCoins(account.wallet)}**.`,
  );
}

async function handleFight(interaction) {
  const target = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('amount') || 0;
  const hasWager = amount > 0;

  if (target.id === interaction.user.id) {
    return interaction.reply({ content: 'You cannot fight yourself.', ephemeral: true });
  }

  const challenger = await ensureEconomyUser(interaction.guild.id, interaction.user.id);
  if (hasWager && challenger.wallet < amount) {
    return interaction.reply({ content: `You only have ${formatCoins(challenger.wallet)}.`, ephemeral: true });
  }

  if (target.id === client.user.id) {
    const compliments = [
      'Your power is honestly terrifying. I surrender.',
      'I know greatness when I see it. You win.',
      'I have calculated my odds and chosen survival. You are too mighty.',
      'I surrender immediately. Your confidence alone wins the fight.',
      'No contest. You are clearly the champion here.',
    ];

    return interaction.reply(`${target} waves a tiny white flag.\n${randomItem(compliments)} No coins were taken.`);
  }

  if (target.bot) {
    return interaction.reply({ content: 'You can only wager fights against real users or this bot.', ephemeral: true });
  }

  const opponent = await ensureEconomyUser(interaction.guild.id, target.id);
  if (hasWager && opponent.wallet < amount) {
    return interaction.reply({ content: `${target} only has ${formatCoins(opponent.wallet)}.`, ephemeral: true });
  }

  const challengerWins = Math.random() < 0.5;
  const winner = challengerWins ? interaction.user : target;
  const loser = challengerWins ? target : interaction.user;

  const moves = [
    'landed a dramatic final hit',
    'won with pure confidence',
    'dodged at exactly the right moment',
    'somehow turned the fight around',
    'finished the battle in style',
  ];

  if (!hasWager) {
    return interaction.reply(`${winner} ${randomItem(moves)} and defeated ${loser}. No coins were wagered.`);
  }

  await addCoins(
    interaction.guild.id,
    loser.id,
    -amount,
    `Fight loss against ${winner.tag}`,
    interaction.user.id,
  );
  const winnerAccount = await addCoins(
    interaction.guild.id,
    winner.id,
    amount,
    `Fight win against ${loser.tag}`,
    interaction.user.id,
  );

  return interaction.reply(
    `${winner} ${randomItem(moves)} and won **${formatCoins(amount)}** from ${loser}.\n`
    + `${winner}'s balance is now **${formatCoins(winnerAccount.wallet)}**.`,
  );
}

async function handleModLogRemove(interaction) {
  if (!hasPermission(interaction, PermissionsBitField.Flags.ManageGuild)) {
    return interaction.reply({ content: 'No permission.', ephemeral: true });
  }

  const caseId = interaction.options.getInteger('case_id', true);
  const row = await get(
    'SELECT * FROM cases WHERE guildId = ? AND id = ?',
    [interaction.guild.id, caseId],
  );

  if (!row) {
    return interaction.reply({ content: 'Case not found.', ephemeral: true });
  }

  await run('DELETE FROM cases WHERE guildId = ? AND id = ?', [interaction.guild.id, caseId]);

  if (row.action === 'WARN') {
    await run(
      'UPDATE warns SET count = MAX(count - 1, 0) WHERE guildId = ? AND userId = ?',
      [interaction.guild.id, row.userId],
    );
  }

  await sendLog(interaction.guild, new EmbedBuilder()
    .setTitle(`Case #${caseId} Removed`)
    .setColor('DarkGrey')
    .addFields(
      { name: 'Removed By', value: `<@${interaction.user.id}>` },
      { name: 'Original Action', value: row.action },
      { name: 'Original User', value: `<@${row.userId}>` },
      { name: 'Original Moderator', value: `<@${row.moderatorId}>` },
      { name: 'Original Reason', value: truncateText(row.reason) },
    )
    .setTimestamp());

  return interaction.reply({ content: `Removed case #${caseId} from modlogs.`, ephemeral: true });
}

async function handleSocialAdd(interaction) {
  if (!hasPermission(interaction, PermissionsBitField.Flags.ManageGuild)) {
    return interaction.reply({ content: 'No permission.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const alertType = interaction.options.getString('type', true);
  const source = interaction.options.getString('source', true);
  const channel = interaction.options.getChannel('channel', true);
  const role = interaction.options.getRole('role');

  if (channel.type !== ChannelType.GuildText) {
    return interaction.editReply('Please choose a normal text channel.');
  }

  const result = await run(
    `INSERT INTO social_alerts
     (guildId, alertType, source, discordChannelId, pingRoleId, lastItemKey, enabled)
     VALUES (?, ?, ?, ?, ?, NULL, 1)`,
    [interaction.guild.id, alertType, source, channel.id, role?.id || null],
  );

  const alert = await get('SELECT * FROM social_alerts WHERE id = ?', [result.lastID]);
  let checkResult = 'I will check it on the next scan.';

  try {
    checkResult = await checkSocialAlert(alert, false);
  } catch (err) {
    checkResult = `Saved, but I could not check the feed yet: ${err.message}`;
  }

  return interaction.editReply(`Added social alert #${result.lastID} for ${channel}.\n${checkResult}`);
}

async function handleSocialList(interaction) {
  if (!hasPermission(interaction, PermissionsBitField.Flags.ManageGuild)) {
    return interaction.reply({ content: 'No permission.', ephemeral: true });
  }

  const alerts = await all(
    'SELECT * FROM social_alerts WHERE guildId = ? ORDER BY id ASC',
    [interaction.guild.id],
  );

  if (!alerts.length) {
    return interaction.reply({ content: 'No social alerts configured yet.', ephemeral: true });
  }

  const lines = alerts.map((alert) => [
    `#${alert.id} - **${socialAlertLabel(alert.alertType)}**`,
    `Channel: <#${alert.discordChannelId}>${alert.pingRoleId ? ` | Ping: <@&${alert.pingRoleId}>` : ''}`,
    `Source: ${truncateText(alert.source, 120)}`,
  ].join('\n'));

  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle('Social Alerts')
        .setColor('Blurple')
        .setDescription(lines.join('\n\n')),
    ],
    ephemeral: true,
  });
}

async function handleSocialEdit(interaction) {
  if (!hasPermission(interaction, PermissionsBitField.Flags.ManageGuild)) {
    return interaction.reply({ content: 'No permission.', ephemeral: true });
  }

  const id = interaction.options.getInteger('id', true);
  const source = interaction.options.getString('source');
  const channel = interaction.options.getChannel('channel');
  const role = interaction.options.getRole('role');
  const clearRole = interaction.options.getBoolean('clear_role') || false;
  const status = interaction.options.getString('status');
  const alert = await get(
    'SELECT * FROM social_alerts WHERE guildId = ? AND id = ?',
    [interaction.guild.id, id],
  );

  if (!alert) {
    return interaction.reply({ content: 'Social alert not found.', ephemeral: true });
  }

  if (channel && channel.type !== ChannelType.GuildText) {
    return interaction.reply({ content: 'Please choose a normal text channel.', ephemeral: true });
  }

  const nextSource = source || alert.source;
  const nextChannelId = channel?.id || alert.discordChannelId;
  const nextRoleId = clearRole ? null : role?.id || alert.pingRoleId;
  const nextEnabled = status ? (status === 'enabled' ? 1 : 0) : alert.enabled;

  await run(
    `UPDATE social_alerts
     SET source = ?, discordChannelId = ?, pingRoleId = ?, enabled = ?
     WHERE guildId = ? AND id = ?`,
    [nextSource, nextChannelId, nextRoleId, nextEnabled, interaction.guild.id, id],
  );

  return interaction.reply({
    content: `Updated social alert #${id}.`,
    ephemeral: true,
  });
}

async function handleSocialRemove(interaction) {
  if (!hasPermission(interaction, PermissionsBitField.Flags.ManageGuild)) {
    return interaction.reply({ content: 'No permission.', ephemeral: true });
  }

  const id = interaction.options.getInteger('id', true);
  const result = await run(
    'DELETE FROM social_alerts WHERE guildId = ? AND id = ?',
    [interaction.guild.id, id],
  );

  if (!result.changes) {
    return interaction.reply({ content: 'Social alert not found.', ephemeral: true });
  }

  return interaction.reply({ content: `Removed social alert #${id}.`, ephemeral: true });
}

async function handleSocialCheck(interaction) {
  if (!hasPermission(interaction, PermissionsBitField.Flags.ManageGuild)) {
    return interaction.reply({ content: 'No permission.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const id = interaction.options.getInteger('id', true);
  const alert = await get(
    'SELECT * FROM social_alerts WHERE guildId = ? AND id = ?',
    [interaction.guild.id, id],
  );

  if (!alert) {
    return interaction.editReply('Social alert not found.');
  }

  const result = await checkSocialAlert(alert, true);
  return interaction.editReply(result);
}

const commandHandlers = {
  game: (interaction) => interaction.reply({
    content: 'Play Endless Summer Simulator:\nhttps://www.roblox.com/games/130906696817438/Endless-Summer-Simulator',
  }),
  warn: handleWarn,
  modlogs: handleModLogs,
  mute: handleMute,
  unmute: handleUnmute,
  case: handleCase,
  clear: handleClear,
  kick: handleKick,
  ban: handleBan,
  unban: handleUnban,
  slowmode: handleSlowmode,
  lock: handleLock,
  unlock: handleUnlock,
  nick: handleNick,
  avatar: handleAvatar,
  userinfo: handleUserInfo,
  serverinfo: handleServerInfo,
  ping: handlePing,
  uptime: handleUptime,
  poll: handlePoll,
  say: handleSay,
  announce: handleAnnounce,
  servericon: handleServerIcon,
  roleinfo: handleRoleInfo,
  membercount: handleMemberCount,
  invite: handleInvite,
  help: handleHelp,
  suggest: handleSuggest,
  suggestaccept: handleSuggestAccept,
  suggestdeny: handleSuggestDeny,
  suggestconsider: handleSuggestConsider,
  '8ball': handleEightBall,
  coinflip: handleCoinFlip,
  roll: handleRoll,
  rate: handleRate,
  ship: handleShip,
  joke: handleJoke,
  compliment: handleCompliment,
  roast: handleRoast,
  choose: handleChoose,
  reverse: handleReverse,
  meme: handleMeme,
  cat: handleCat,
  dog: handleDog,
  fox: handleFox,
  duck: handleDuck,
  fact: handleFact,
  balance: handleBalance,
  transactions: handleTransactions,
  daily: handleDaily,
  work: handleWork,
  pay: handlePay,
  leaderboard: handleLeaderboard,
  coinbet: handleCoinBet,
  ecoadd: handleEcoAdd,
  ecoremove: handleEcoRemove,
  slots: handleSlots,
  dicebet: handleDiceBet,
  roulette: handleRoulette,
  scratch: handleScratch,
  highlow: handleHighLow,
  beg: handleBeg,
  crime: handleCrime,
  lottery: handleLottery,
  fight: handleFight,
  modlogremove: handleModLogRemove,
  socialadd: handleSocialAdd,
  socialedit: handleSocialEdit,
  sociallist: handleSocialList,
  socialremove: handleSocialRemove,
  socialcheck: handleSocialCheck,
};

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);

  setInterval(() => {
    handleExpiredMutes().catch(console.error);
  }, 5000);

  setInterval(() => {
    checkSocialAlerts().catch(console.error);
  }, 5 * 60 * 1000);

  checkSocialAlerts().catch(console.error);
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton()) {
    if (!interaction.inGuild()) return;

    const [kind, category] = interaction.customId.split(':');
    if (kind !== 'help') return;

    return interaction.update({
      embeds: [buildHelpEmbed(category)],
      components: buildHelpRows(category),
    });
  }

  if (!interaction.isChatInputCommand() || !interaction.inGuild()) return;

  const handler = commandHandlers[interaction.commandName];
  if (!handler) return;

  try {
    await handler(interaction);
  } catch (err) {
    console.error(err);

    const message = { content: 'Something went wrong while running that command.', ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(message);
    else await interaction.reply(message);
  }
});

async function main() {
  if (!process.env.TOKEN) {
    throw new Error('Missing TOKEN in your .env file.');
  }

  await initDatabase();
  await client.login(process.env.TOKEN);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
