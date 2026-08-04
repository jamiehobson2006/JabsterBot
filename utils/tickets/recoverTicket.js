const {
  all,
  get,
  run
} = require('../../database');

const ticketTypes = require('./ticketTypes');

function isOpenStatus(status) {
  return String(status || '').toUpperCase() === 'OPEN';
}

function collectionValues(collection) {
  if (Array.isArray(collection)) return collection;
  if (typeof collection?.values === 'function') return [...collection.values()];
  return [];
}

function componentCustomId(component) {
  return component?.customId || component?.data?.customId || component?.data?.custom_id || null;
}

function isTicketStarterMessage(message, botId) {
  if (message?.author?.id !== botId || !message.components?.length) {
    return false;
  }

  return message.components.some(row =>
    row.components?.some(component => componentCustomId(component) === 'ticket_close')
  );
}

function getEmbedField(message, fieldName) {
  for (const embed of message?.embeds || []) {
    const field = embed.fields?.find(item => item.name === fieldName);
    if (field?.value) return String(field.value);
  }

  return null;
}

function getTicketTopicMetadata(topic) {
  const match = String(topic || '').match(
    /^Jabster Studios ticket \| type:([a-z]+) \| owner:(\d+)(?: \| form:(\d+))?$/i
  );

  if (!match || !ticketTypes[match[1].toLowerCase()]) {
    return null;
  }

  return {
    type: match[1].toLowerCase(),
    userId: match[2],
    applicationFormId: match[3] ? Number(match[3]) : null
  };
}

function getStarterOwnerId(message) {
  const creator = getEmbedField(message, 'Creator');
  const footer = (message.embeds || [])
    .map(embed => embed.footer?.text || '')
    .find(text => /User ID:\s*\d+/.test(text));
  const match = creator?.match(/<@!?(\d+)>/) || footer?.match(/User ID:\s*(\d+)/);

  return match?.[1] || null;
}

function getTicketType({ guildId, channel, starterMessage }) {
  const typeValue = getEmbedField(starterMessage, 'Type')?.trim().toLowerCase();

  if (typeValue) {
    const type = Object.entries(ticketTypes)
      .find(([id, config]) => id === typeValue || config.name.toLowerCase() === typeValue)?.[0];

    if (type) return type;
  }

  const channelName = String(channel.name || '').toLowerCase();
  const typeFromName = Object.entries(ticketTypes)
    .find(([, config]) => channelName.includes(`-${String(config.channelPrefix).toLowerCase()}-`))?.[0];

  if (typeFromName) return typeFromName;

  const categoryTypes = all(
    `SELECT DISTINCT type
     FROM ticket_settings
     WHERE guildId = ? AND categoryId = ?`,
    [guildId, channel.parentId || null]
  );

  return categoryTypes.length === 1 ? categoryTypes[0].type : null;
}

function getApplicationFormId(guildId, starterMessage, type) {
  if (type !== 'application') return null;

  const formName = getEmbedField(starterMessage, 'Application');
  if (!formName) return null;

  return get(
    `SELECT id
     FROM application_forms
     WHERE guildId = ? AND name = ? COLLATE NOCASE`,
    [guildId, formName]
  )?.id || null;
}

async function findStarterMessage(channel, botId, starterMessageId) {
  if (!channel.messages?.fetch) {
    return null;
  }

  if (starterMessageId) {
    const exactMessage = await channel.messages.fetch(starterMessageId).catch(() => null);

    if (isTicketStarterMessage(exactMessage, botId)) {
      return exactMessage;
    }
  }

  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);

  return collectionValues(messages)
    .find(message => isTicketStarterMessage(message, botId)) || null;
}

async function findOrRecoverOpenTicket({
  guild,
  channel,
  client,
  starterMessageId = null
}) {
  const existing = get(
    `SELECT *
     FROM tickets
     WHERE guildId = ? AND channelId = ?`,
    [guild.id, channel.id]
  );

  if (existing) {
    return isOpenStatus(existing.status) ? existing : null;
  }

  const topicMetadata = getTicketTopicMetadata(channel.topic);

  if (!channel.messages?.fetch && !topicMetadata) {
    return null;
  }

  const starterMessage = await findStarterMessage(
    channel,
    client?.user?.id,
    starterMessageId
  );

  if (!starterMessage && !topicMetadata) return null;

  const userId = topicMetadata?.userId || getStarterOwnerId(starterMessage);
  const type = topicMetadata?.type || getTicketType({ guildId: guild.id, channel, starterMessage });

  if (!userId || !type) return null;

  const applicationFormId = topicMetadata?.applicationFormId ||
    getApplicationFormId(guild.id, starterMessage, type);
  const createdAt = starterMessage?.createdTimestamp || channel.createdTimestamp || Date.now();

  run(
    `INSERT OR IGNORE INTO tickets (
       guildId,
       channelId,
       messageId,
       userId,
       type,
       applicationFormId,
       createdAt,
       status
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN')`,
    [
      guild.id,
      channel.id,
      starterMessage?.id || null,
      userId,
      type,
      applicationFormId,
      createdAt
    ]
  );

  const recovered = get(
    `SELECT *
     FROM tickets
     WHERE guildId = ? AND channelId = ?`,
    [guild.id, channel.id]
  );

  if (recovered && isOpenStatus(recovered.status)) {
    console.warn(`Recovered missing ticket record for ${channel.id}.`);
    return recovered;
  }

  return null;
}

module.exports = {
  findOrRecoverOpenTicket,
  getStarterOwnerId,
  getTicketTopicMetadata,
  getTicketType,
  findStarterMessage,
  isOpenStatus,
  isTicketStarterMessage
};
