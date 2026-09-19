const { generateFromMessages } = require('discord-html-transcripts');
const { parse, parseFragment, serialize } = require('parse5');
const fetch = require('node-fetch');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function values(collection) {
  return [...(collection?.values?.() || collection || [])];
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function link(url, label) {
  const safe = safeUrl(url);
  return safe
    ? `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label || safe)}</a>`
    : escapeHtml(label || 'Unavailable link');
}

function image(url, name) {
  const safe = safeUrl(url);
  return safe ? `<img src="${escapeHtml(safe)}" alt="${escapeHtml(name)}" loading="lazy">` : '';
}

function paragraph(value) {
  return `<p class="archive-text">${escapeHtml(value)}</p>`;
}

function componentHtml(component) {
  const raw = component.toJSON?.() || component;
  const parts = [];
  if (raw.content) parts.push(paragraph(raw.content));
  if (raw.label) parts.push(paragraph(raw.label));
  if (raw.placeholder) parts.push(paragraph(raw.placeholder));
  if (raw.url) parts.push(link(raw.url, raw.label || 'Link'));
  for (const option of raw.options || []) {
    parts.push(paragraph(`${option.label}${option.description ? `: ${option.description}` : ''}`));
  }
  for (const item of raw.items || []) {
    parts.push(image(item.media?.url, item.description || 'Gallery image'));
    if (item.description) parts.push(paragraph(item.description));
  }
  if (raw.media?.url) parts.push(image(raw.media.url, raw.description || 'Media'));
  if (raw.file?.url) parts.push(link(raw.file.url, 'Attached file'));
  for (const child of raw.components || []) parts.push(componentHtml(child));
  if (raw.accessory) parts.push(componentHtml(raw.accessory));
  return parts.join('');
}

function extraMessageHtml(message, depth = 0) {
  const parts = [];
  for (const sticker of values(message.stickers)) {
    parts.push(`<figure>${image(sticker.url, sticker.name)}<figcaption>${link(sticker.url, `Sticker: ${sticker.name}`)}</figcaption></figure>`);
  }
  if (message.poll) {
    parts.push(`<h3>${escapeHtml(message.poll.question?.text || 'Poll')}</h3>`);
    for (const answer of values(message.poll.answers)) {
      parts.push(paragraph(`${answer.text || answer.emoji?.name || 'Option'}: ${answer.voteCount || 0} vote(s)`));
    }
  }
  for (const component of message.components || []) {
    if (component.type !== 1 || component.components?.some(child => child.type !== 2)) {
      parts.push(componentHtml(component));
    }
  }
  if (depth < 3) {
    for (const snapshot of values(message.messageSnapshots)) {
      parts.push(`<blockquote><h3>Forwarded message</h3>${paragraph(snapshot.content || '')}`);
      for (const embed of snapshot.embeds || []) {
        parts.push(paragraph(embed.title || ''), paragraph(embed.description || ''));
        for (const field of embed.fields || []) parts.push(paragraph(`${field.name}\n${field.value}`));
        parts.push(image(embed.image?.url, 'Forwarded image'));
      }
      for (const attachment of values(snapshot.attachments)) parts.push(link(attachment.url, attachment.name));
      parts.push(extraMessageHtml(snapshot, depth + 1), '</blockquote>');
    }
  }
  return parts.length ? `<section class="archive-extra">${parts.join('')}</section>` : '';
}

async function fetchTranscriptMessages(channel) {
  const messages = new Map();
  let before;
  while (true) {
    const page = await channel.messages.fetch({ limit: 100, cache: false, ...(before ? { before } : {}) });
    if (!page.size) break;
    for (const message of page.values()) messages.set(message.id, message);
    const next = page.lastKey();
    if (next === before) throw new Error('Transcript message pagination stopped advancing.');
    before = next;
    if (page.size < 100) break;
  }
  return [...messages.values()].sort((left, right) => {
    const a = BigInt(left.id);
    const b = BigInt(right.id);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function walk(node, visitor) {
  visitor(node);
  for (const child of node.childNodes || []) walk(child, visitor);
}

function appendHtml(node, html, prepend = false) {
  const fragment = parseFragment(html);
  for (const child of fragment.childNodes) child.parentNode = node;
  if (prepend) node.childNodes.unshift(...fragment.childNodes);
  else node.childNodes.push(...fragment.childNodes);
}

function timestamp(value) {
  return Number(value) > 0 ? new Date(Number(value)).toISOString().replace('T', ' ').replace('.000Z', ' UTC') : 'Unknown';
}

function metadataHtml({ channel, ticket, closedBy, applicationForm, answers, count }) {
  const details = [
    ['Server', `${channel.guild.name} (${channel.guild.id})`],
    ['Ticket', `${channel.name} (${channel.id})`],
    ['Type', ticket.type],
    ['Status', ticket.status || 'CLOSED'],
    ['Creator', ticket.userId],
    ['Closed by', `${closedBy.tag || closedBy.username || closedBy.id} (${closedBy.id})`],
    ['Claimed by', ticket.claimedBy || 'Not claimed'],
    ['Created', timestamp(ticket.createdAt)],
    ['Closed', timestamp(ticket.closedAt)],
    ['Messages', count],
    ['Close reason', ticket.closeReason || 'No reason recorded']
  ];
  if (String(ticket.type).toLowerCase() === 'application') {
    details.push(
      ['Application', applicationForm?.name || `Form ${ticket.applicationFormId || 'unknown'}`],
      ['Decision', ticket.applicationStatus || 'PENDING'],
      ['Reviewer', ticket.applicationReviewedBy || 'Not reviewed'],
      ['Reviewed', timestamp(ticket.applicationReviewedAt)],
      ['Decision reason', ticket.applicationDecisionReason || 'No decision recorded']
    );
  }
  const questions = answers.map((answer, index) =>
    `<article><h3>${index + 1}. ${escapeHtml(answer.question || 'Question')}</h3>${paragraph(answer.answer || 'No answer provided')}</article>`
  ).join('');
  return `<header class="archive-summary"><p>Jabster Studios</p><h1>${escapeHtml(channel.name)} transcript</h1>
    <dl>${details.map(([name, value]) => `<div><dt>${escapeHtml(name)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>
    ${questions ? `<details open><summary>Full application answers</summary>${questions}</details>` : ''}</header>`;
}

const ARCHIVE_STYLE = `<style>
  body { background:#313338; color:#f2f3f5; font-family:Arial,sans-serif; margin:0; overflow-wrap:anywhere; }
  .archive-summary,.archive-notes { padding:24px; border-bottom:1px solid #555; }
  .archive-summary h1 { font-size:24px; margin:8px 0 24px; }
  .archive-summary dl { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:16px; }
  .archive-summary dt { color:#b5bac1; font-size:12px; margin-bottom:5px; }
  .archive-summary dd { margin:0; white-space:pre-wrap; }
  .archive-summary summary { cursor:pointer; font-weight:bold; margin:24px 0; }
  .archive-summary h3,.archive-extra h3 { font-size:15px; }
  .archive-text { white-space:pre-wrap; overflow-wrap:anywhere; }
  .archive-extra { padding:12px; border-left:3px solid #6fbfa2; margin:8px 0; }
  .archive-extra img { max-width:100%; max-height:420px; object-fit:contain; }
  .archive-extra figure { margin:8px 0; }
  .archive-extra a,.archive-notes a { color:#8acbff; }
  discord-embed-description,discord-embed-field { overflow-wrap:anywhere; }
  @media print { details { display:block; } .archive-summary { break-after:avoid; } }
</style>`;

function isDiscordAsset(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      (!url.port || url.port === '443') &&
      ['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname);
  } catch {
    return false;
  }
}

async function preserveAssets(document, { fetchAsset = fetch, budget = 6 * 1024 * 1024, timeoutMs = 30000 } = {}) {
  const targets = new Map();
  walk(document, node => {
    for (const attr of node.attrs || []) {
      if (!['src', 'href', 'url', 'image', 'thumbnail', 'poster', 'avatar'].includes(attr.name)) continue;
      if (!isDiscordAsset(attr.value)) continue;
      if (!targets.has(attr.value)) targets.set(attr.value, []);
      targets.get(attr.value).push(attr);
    }
  });
  let saved = 0;
  let remaining = budget;
  const deadline = Date.now() + timeoutMs;
  for (const [url, attributes] of targets) {
    if (remaining <= 0 || Date.now() >= deadline) break;
    try {
      const maxBytes = Math.min(remaining, 5 * 1024 * 1024);
      const response = await fetchAsset(url, {
        redirect: 'error', timeout: Math.max(1, Math.min(5000, deadline - Date.now())), size: maxBytes
      });
      const mime = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
      if (!response.ok || !mime || !/^(?:image\/(?:png|jpeg|gif|webp|avif|apng)|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+|application\/(?:pdf|octet-stream))$/.test(mime)) continue;
      if (Number(response.headers.get('content-length')) > maxBytes) continue;
      const bytes = await response.buffer();
      if (!bytes.length || bytes.length > maxBytes) continue;
      const data = `data:${mime};base64,${bytes.toString('base64')}`;
      const encodedSize = Buffer.byteLength(data) * attributes.length;
      if (encodedSize > remaining) continue;
      remaining -= encodedSize;
      for (const attribute of attributes) attribute.value = data;
      saved += 1;
    } catch {
      // Keep the original link visible when Discord no longer serves the file.
    }
  }
  return { saved, linked: targets.size - saved };
}

async function buildTranscriptDocument({ channel, ticket, closedBy, applicationForm, answers = [], assetOptions }) {
  const messages = await fetchTranscriptMessages(channel);
  // The installed renderer supports action rows; newer containers are added below.
  const renderable = messages.map(message => {
    const copy = Object.create(message);
    Object.defineProperty(copy, 'components', { value: (message.components || []).filter(component => component.type === 1) });
    return copy;
  });
  const html = await generateFromMessages(renderable, channel, {
    returnType: 'string',
    saveImages: false,
    hydrate: true,
    poweredBy: false,
    footerText: 'Exported {number} messages | Jabster Studios'
  });
  const document = parse(html);
  const nodes = new Map();
  let head;
  let body;
  walk(document, node => {
    if (node.tagName === 'head') head = node;
    if (node.tagName === 'body') body = node;
    const id = node.attrs?.find(attr => attr.name === 'id')?.value;
    if (id) nodes.set(id, node);
  });
  if (!head || !body) throw new Error('The transcript renderer returned an incomplete document.');
  appendHtml(head, ARCHIVE_STYLE + '<meta name="referrer" content="no-referrer">');
  appendHtml(body, metadataHtml({ channel, ticket, closedBy, applicationForm, answers, count: messages.length }), true);
  for (const message of messages) {
    const extra = extraMessageHtml(message);
    if (extra) appendHtml(nodes.get(`m-${message.id}`) || body, extra);
  }
  const assets = await preserveAssets(document, assetOptions);
  appendHtml(body, `<footer class="archive-notes">${paragraph(
    `${messages.length} messages archived. ${assets.saved} media files embedded. ` +
    (assets.linked ? `${assets.linked} Discord media links could not be embedded (size limit, timeout, or unavailable file). ` : '') +
    'External media and download links require an internet connection and may expire. Messages deleted before export and private ephemeral replies are not supplied by Discord.'
  )}</footer>`);
  return { html: serialize(document), messageCount: messages.length, assets };
}

module.exports = { buildTranscriptDocument, extraMessageHtml, fetchTranscriptMessages, isDiscordAsset, metadataHtml, preserveAssets };
