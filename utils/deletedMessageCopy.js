const fetch = require('node-fetch');

const {
  AttachmentBuilder,
  EmbedBuilder
} = require('discord.js');

const MAX_CONTENT_LENGTH = 2000;
const MAX_LOG_FILE_BYTES = 8 * 1024 * 1024;

function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()];
  return [];
}

function truncateContent(value) {
  const content = String(value || '');
  if (content.length <= MAX_CONTENT_LENGTH) return content;
  return `${content.slice(0, MAX_CONTENT_LENGTH - 3)}...`;
}

function cleanFileName(value, fallback) {
  const name = String(value || fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .trim();

  return name.slice(0, 180) || fallback;
}

function fileNameFromUrl(url, fallback) {
  try {
    const pathname = new URL(url).pathname;
    const name = pathname.split('/').pop();
    return cleanFileName(name, fallback);
  } catch {
    return fallback;
  }
}

function isTrustedDiscordMediaUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return host === 'discord.com' ||
      host.endsWith('.discord.com') ||
      host === 'discordapp.com' ||
      host.endsWith('.discordapp.com') ||
      host === 'discordapp.net' ||
      host.endsWith('.discordapp.net');
  } catch {
    return false;
  }
}

function sourceEmbed(embed) {
  const raw = typeof embed?.toJSON === 'function'
    ? embed.toJSON()
    : embed || {};

  const copied = new EmbedBuilder();

  if (raw.color !== undefined && raw.color !== null) copied.setColor(raw.color);
  if (raw.title) copied.setTitle(String(raw.title).slice(0, 256));
  if (raw.description) copied.setDescription(String(raw.description).slice(0, 4096));
  if (raw.url) copied.setURL(raw.url);
  if (raw.timestamp) copied.setTimestamp(raw.timestamp);

  if (raw.author?.name) {
    copied.setAuthor({
      name: String(raw.author.name).slice(0, 256),
      url: raw.author.url || undefined,
      iconURL: raw.author.icon_url || raw.author.iconURL || undefined
    });
  }

  if (raw.footer?.text) {
    copied.setFooter({
      text: String(raw.footer.text).slice(0, 2048),
      iconURL: raw.footer.icon_url || raw.footer.iconURL || undefined
    });
  }

  if (raw.thumbnail?.url) copied.setThumbnail(raw.thumbnail.url);
  if (raw.image?.url) copied.setImage(raw.image.url);

  if (Array.isArray(raw.fields) && raw.fields.length) {
    copied.addFields(raw.fields.slice(0, 25).map(field => ({
      name: String(field.name || 'Untitled').slice(0, 256),
      value: String(field.value || '\u200b').slice(0, 1024),
      inline: Boolean(field.inline)
    })));
  }

  return copied.toJSON();
}

function serialiseDeletedMessage(message) {
  return {
    messageId: message.id || null,
    guildId: message.guild?.id || message.guildId || null,
    channelId: message.channel?.id || message.channelId || null,
    authorId: message.author?.id || message.authorId || null,
    authorTag: message.author?.tag || message.authorTag || 'Unknown',
    content: String(message.content || ''),
    embeds: valuesOf(message.embeds).map(sourceEmbed),
    attachments: valuesOf(message.attachments).map(attachment => ({
      id: attachment.id || null,
      name: attachment.name || null,
      url: attachment.url || attachment.proxyURL || null,
      contentType: attachment.contentType || null,
      size: Number(attachment.size) || null,
      spoiler: Boolean(attachment.spoiler)
    })).filter(attachment => attachment.url),
    stickers: valuesOf(message.stickers).map(sticker => ({
      id: sticker.id || null,
      name: sticker.name || null,
      url: sticker.url || null,
      format: sticker.format || null
    })).filter(sticker => sticker.url)
  };
}

function snapshotMessage(snapshot) {
  if (!snapshot) return null;

  return {
    id: snapshot.messageId,
    guildId: snapshot.guildId,
    channelId: snapshot.channelId,
    channel: snapshot.channelId ? { id: snapshot.channelId } : null,
    author: {
      id: snapshot.authorId,
      tag: snapshot.authorTag
    },
    content: snapshot.content,
    embeds: Array.isArray(snapshot.embeds) ? snapshot.embeds : [],
    attachments: Array.isArray(snapshot.attachments) ? snapshot.attachments : [],
    stickers: Array.isArray(snapshot.stickers) ? snapshot.stickers : []
  };
}

function mediaSources(message) {
  const attachments = valuesOf(message.attachments).map(attachment => ({
    url: attachment.url || attachment.proxyURL,
    name: attachment.name,
    fallback: 'attachment',
    size: Number(attachment.size) || null,
    contentType: attachment.contentType || null
  }));
  const stickers = valuesOf(message.stickers).map(sticker => ({
    url: sticker.url,
    name: sticker.name ? `${sticker.name}.png` : null,
    fallback: 'sticker.png',
    size: null,
    contentType: 'image/png'
  }));

  const embedMedia = valuesOf(message.embeds).flatMap((embed, index) => {
    const raw = typeof embed?.toJSON === 'function' ? embed.toJSON() : embed || {};
    return [
      { url: raw.image?.url, name: `embed-${index + 1}-image`, fallback: 'embed-image.png' },
      { url: raw.thumbnail?.url, name: `embed-${index + 1}-thumbnail`, fallback: 'embed-thumbnail.png' },
      { url: raw.author?.icon_url || raw.author?.iconURL, name: `embed-${index + 1}-author`, fallback: 'embed-author.png' },
      { url: raw.footer?.icon_url || raw.footer?.iconURL, name: `embed-${index + 1}-footer`, fallback: 'embed-footer.png' }
    ].map(item => ({ ...item, size: null, contentType: null }));
  });

  const emojiMedia = [...String(message.content || '').matchAll(/<a?:[a-zA-Z0-9_]+:(\d+)>/g)]
    .map((match, index) => ({
      url: `https://cdn.discordapp.com/emojis/${match[1]}.${match[0].startsWith('<a:') ? 'gif' : 'png'}?size=128&quality=lossless`,
      name: `emoji-${index + 1}-${match[1]}`,
      fallback: `emoji-${match[1]}.png`,
      size: null,
      contentType: match[0].startsWith('<a:') ? 'image/gif' : 'image/png'
    }));

  return [...attachments, ...stickers, ...embedMedia, ...emojiMedia]
    .filter(media => media.url);
}

function mediaPreviewEmbed(message) {
  const media = mediaSources(message);
  if (!media.length) return null;

  const preview = new EmbedBuilder()
    .setTitle('Deleted media')
    .setDescription(media
      .slice(0, 10)
      .map(item => `[${cleanFileName(item.name, item.fallback)}](${item.url})`)
      .join('\n')
      .slice(0, 4096));

  const visualMedia = media.find(item =>
    item.contentType?.startsWith('image/') ||
    /\.(?:apng|gif|jpe?g|png|webp)(?:$|[?#])/iu.test(item.url)
  );

  if (visualMedia) preview.setImage(visualMedia.url);
  return preview.toJSON();
}

async function copyMediaFiles(messages, { maxFiles = 10 } = {}) {
  const media = messages.flatMap(mediaSources).slice(0, maxFiles);
  const files = [];
  const usedNames = new Set();

  for (const item of media) {
    if (item.size && item.size > MAX_LOG_FILE_BYTES) continue;
    if (!isTrustedDiscordMediaUrl(item.url)) continue;

    try {
      const response = await fetch(item.url, {
        timeout: 8000,
        size: MAX_LOG_FILE_BYTES
      });
      const length = Number(response.headers.get('content-length'));
      if (!response.ok || (length && length > MAX_LOG_FILE_BYTES)) continue;

      const data = await response.buffer();
      if (!data.length || data.length > MAX_LOG_FILE_BYTES) continue;

      let name = cleanFileName(item.name, fileNameFromUrl(item.url, item.fallback));
      let suffix = 2;
      while (usedNames.has(name)) {
        const dot = name.lastIndexOf('.');
        const base = dot > 0 ? name.slice(0, dot) : name;
        const extension = dot > 0 ? name.slice(dot) : '';
        name = `${base}-${suffix}${extension}`;
        suffix += 1;
      }

      usedNames.add(name);
      files.push(new AttachmentBuilder(data, { name }));
    } catch {
      // Discord may remove an attachment from its CDN before the delete event.
    }
  }

  return files;
}

async function buildDeletedMessageCopy(message) {
  const source = serialiseDeletedMessage(message);
  const embeds = source.embeds.slice(0, 10);
  const preview = embeds.length ? null : mediaPreviewEmbed(source);
  if (preview) embeds.push(preview);
  const files = await copyMediaFiles([source]);
  const content = truncateContent(source.content);

  if (!content && !embeds.length && !files.length) return null;

  return {
    ...(content ? { content } : {}),
    ...(embeds.length ? { embeds } : {}),
    ...(files.length ? { files } : {}),
    allowedMentions: { parse: [] }
  };
}

module.exports = {
  buildDeletedMessageCopy,
  copyMediaFiles,
  mediaPreviewEmbed,
  isTrustedDiscordMediaUrl,
  serialiseDeletedMessage,
  snapshotMessage,
  sourceEmbed,
  valuesOf
};
