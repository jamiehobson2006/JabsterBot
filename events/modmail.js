const {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits
} = require('discord.js');

const { all, get, run } = require('../database');
const { findCensoredTerm, listCensorTerms } = require('../utils/censor');
const { findRacistTerm } = require('../utils/racismFilter');
const {
  detectPhishing,
  guildPhishingLists
} = require('../utils/phishingProtection');
const { sendModmailLog } = require('../utils/modmail');

const LINK_PATTERN = /\b(?:https?:\/\/|www\.|discord\.gg\/|discord(?:app)?\.com\/invite\/)[^\s<]*/i;

function splitForDiscord(text, maxLength = 1900) {
  const chunks = [];
  let remaining = String(text || '');

  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf('\n', maxLength);
    if (splitAt < Math.floor(maxLength / 2)) splitAt = maxLength;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n+/, '');
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

function attachmentData(message) {
  return [...(message.attachments?.values?.() || [])].map(file => ({
    name: file.name || 'attachment',
    url: file.url,
    contentType: file.contentType || null
  }));
}

function attachmentText(attachments) {
  return attachments.map(file => `[${file.name}](${file.url})`).join('\n');
}

function cleanChannelName(user) {
  return String(user.username || user.id)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 70) || user.id;
}

function saveMessage(threadId, direction, authorId, content, attachments) {
  run(
    `INSERT INTO modmail_messages (
       threadId, direction, authorId, content, attachments, createdAt
     ) VALUES (?, ?, ?, ?, ?, ?)`,
    [threadId, direction, authorId, content || null, JSON.stringify(attachments), Date.now()]
  );
}

async function eligibleSettings(client, userId) {
  const settings = all(
    `SELECT * FROM modmail_settings
     WHERE enabled = 1 AND categoryId IS NOT NULL AND staffRoleId IS NOT NULL`
  );
  const eligible = [];

  for (const setting of settings) {
    const guild = client.guilds.cache.get(setting.guildId);
    if (!guild) continue;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) eligible.push({ setting, guild });
  }
  return eligible;
}

async function resolveDestination(client, userId) {
  const preference = get(
    `SELECT guildId FROM modmail_preferences WHERE userId = ?`,
    [userId]
  );
  const eligible = await eligibleSettings(client, userId);
  if (preference) {
    const selected = eligible.find(item => item.guild.id === preference.guildId);
    if (selected) return { selected, alternatives: eligible.length };
  }
  return {
    selected: eligible.length === 1 ? eligible[0] : null,
    alternatives: eligible.length
  };
}

async function createThread(message, guild, settings) {
  const category = await guild.channels.fetch(settings.categoryId).catch(() => null);
  if (!category || category.type !== ChannelType.GuildCategory) {
    throw new Error('The configured modmail category is unavailable.');
  }

  const channel = await guild.channels.create({
    name: `modmail-${cleanChannelName(message.author)}`,
    type: ChannelType.GuildText,
    parent: category.id,
    topic: `Jabster Studios modmail | user:${message.author.id}`,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: settings.staffRoleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks
        ]
      },
      {
        id: guild.members.me.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.EmbedLinks
        ]
      }
    ],
    reason: `Modmail opened by ${message.author.tag}`
  });

  let thread = null;
  try {
    const result = run(
      `INSERT INTO modmail_threads (guildId, userId, channelId, status, createdAt)
       VALUES (?, ?, ?, 'OPEN', ?)`,
      [guild.id, message.author.id, channel.id, Date.now()]
    );
    thread = get(`SELECT * FROM modmail_threads WHERE id = ?`, [result.lastInsertRowid]);

    await channel.send({
      content: `<@&${settings.staffRoleId}>`,
      embeds: [new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`New Modmail #${thread.id}`)
        .setDescription('Reply normally in this channel to send a DM to the member.')
        .addFields(
          { name: 'Member', value: `${message.author}\n${message.author.tag}`, inline: true },
          { name: 'User ID', value: message.author.id, inline: true }
        )
        .setThumbnail(message.author.displayAvatarURL({ size: 256 }))
        .setTimestamp()],
      allowedMentions: { roles: [settings.staffRoleId], parse: [] }
    });

    await sendModmailLog(guild, settings, new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle(`Modmail #${thread.id} Opened`)
      .addFields(
        { name: 'Member', value: `${message.author} (${message.author.id})` },
        { name: 'Channel', value: `${channel}` }
      )
      .setTimestamp());

    return { thread, channel };
  } catch (error) {
    if (thread) run(`DELETE FROM modmail_threads WHERE id = ?`, [thread.id]);
    await channel.delete('Rolling back failed modmail creation').catch(() => null);
    throw error;
  }
}

async function forwardUserMessage(message, client) {
  const destination = await resolveDestination(client, message.author.id);
  if (!destination.selected) {
    if (!destination.alternatives) {
      return message.reply('You do not share a server with me that has modmail enabled.');
    }
    return message.reply(
      'More than one shared server has modmail enabled. Run `/modmail contact` in the server you want to contact, then DM me again.'
    );
  }

  const { guild, setting } = destination.selected;
  const content = String(message.content || '').trim();
  const attachments = attachmentData(message);
  if (!content && !attachments.length) return;

  if (
    findRacistTerm(content) ||
    findCensoredTerm(content, listCensorTerms(guild.id)) ||
    detectPhishing(content, guildPhishingLists(guild.id))
  ) {
    return message.reply('That message contains blocked or unsafe content and was not forwarded.');
  }

  let thread = get(
    `SELECT * FROM modmail_threads
     WHERE guildId = ? AND userId = ? AND status = 'OPEN'
     ORDER BY id DESC LIMIT 1`,
    [guild.id, message.author.id]
  );
  let channel = thread
    ? await guild.channels.fetch(thread.channelId).catch(() => null)
    : null;

  if (thread && !channel) {
    run(
      `UPDATE modmail_threads SET status = 'CLOSED', closedAt = ?, closeReason = ? WHERE id = ?`,
      [Date.now(), 'Channel was removed', thread.id]
    );
    thread = null;
  }
  if (!thread) ({ thread, channel } = await createThread(message, guild, setting));

  const description = [content || '*No text content*', attachmentText(attachments)]
    .filter(Boolean).join('\n\n').slice(0, 4096);
  await channel.send({
    embeds: [new EmbedBuilder()
      .setColor(0x5865F2)
      .setAuthor({
        name: `${message.author.tag} (${message.author.id})`,
        iconURL: message.author.displayAvatarURL({ size: 128 })
      })
      .setDescription(description)
      .setFooter({ text: 'Member to Staff' })
      .setTimestamp(message.createdTimestamp)],
    allowedMentions: { parse: [] }
  });
  saveMessage(thread.id, 'INBOUND', message.author.id, content, attachments);
  await message.react('\u2705').catch(() => null);
}

async function forwardStaffMessage(message, client) {
  const thread = get(
    `SELECT * FROM modmail_threads WHERE channelId = ? AND status = 'OPEN'`,
    [message.channel.id]
  );
  if (!thread) return false;

  const settings = get(`SELECT * FROM modmail_settings WHERE guildId = ?`, [message.guild.id]);
  const allowed = message.member?.permissions.has(PermissionFlagsBits.Administrator) ||
    message.member?.roles.cache.has(settings?.staffRoleId);
  if (!allowed) return true;

  const content = String(message.content || '').trim();
  const attachments = attachmentData(message);
  if (!content && !attachments.length) return true;

  const guildSettings = get(
    `SELECT linkBlockEnabled FROM guild_settings WHERE guildId = ?`,
    [message.guild.id]
  );
  if (
    findRacistTerm(content) ||
    findCensoredTerm(content, listCensorTerms(message.guild.id)) ||
    detectPhishing(content, guildPhishingLists(message.guild.id)) ||
    (Number(guildSettings?.linkBlockEnabled) === 1 && LINK_PATTERN.test(content))
  ) {
    await message.reply('That reply contains blocked or unsafe content and was not forwarded.');
    return true;
  }

  const user = await client.users.fetch(thread.userId).catch(() => null);
  if (!user) {
    await message.reply('I could not find that user.');
    return true;
  }

  const dmText = [
    `**Staff reply from ${message.guild.name}**`,
    content || '*No text content*',
    attachmentText(attachments)
  ].filter(Boolean).join('\n\n');

  try {
    const chunks = splitForDiscord(dmText);
    for (const chunk of chunks) {
      await user.send({ content: chunk, allowedMentions: { parse: [] } });
    }
    saveMessage(thread.id, 'OUTBOUND', message.author.id, content, attachments);
    await message.react('\u2705').catch(() => null);
  } catch {
    await message.reply('I could not DM that member. They may have blocked DMs from the bot.');
  }
  return true;
}

module.exports = {
  name: 'messageCreate',
  async execute(message, client) {
    if (message.author?.bot) return;
    try {
      if (!message.guild) {
        await forwardUserMessage(message, client);
        return;
      }
      await forwardStaffMessage(message, client);
    } catch (error) {
      console.error('Modmail error:', error);
      await message.reply('I could not deliver that modmail message. Please try again shortly.')
        .catch(() => null);
    }
  }
};
