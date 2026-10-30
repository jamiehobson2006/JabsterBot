const { cleanDailyFooter } = require('./dailyFooter');

function embedShape(input) {
  const embed = input.toJSON ? input.toJSON() : input.data || input;
  return { title: embed.title || '', description: embed.description || '', url: embed.url || '',
    color: embed.color ?? null, timestamp: embed.timestamp ? new Date(embed.timestamp).getTime() : null,
    footer: embed.footer ? cleanDailyFooter(embed.footer).text : '',
    fields: (embed.fields || []).map(field => ({ name: field.name, value: field.value, inline: Boolean(field.inline) })),
    image: embed.image?.url || '', thumbnail: embed.thumbnail?.url || '', author: embed.author?.name || '' };
}

function sameMessage(message, payload) {
  return String(message.content || '') === String(payload.content || '') &&
    JSON.stringify((message.embeds || []).map(embedShape)) === JSON.stringify((payload.embeds || []).map(embedShape)) &&
    (!payload.components?.length || JSON.stringify((message.components || []).map(componentShape)) ===
      JSON.stringify(payload.components.map(componentShape)));
}

function componentShape(input) {
  const item = input.toJSON ? input.toJSON() : input.data || input;
  return { type: item.type, custom_id: item.custom_id || '', label: item.label || '',
    style: item.style || 0, url: item.url || '', disabled: Boolean(item.disabled),
    components: (item.components || []).map(componentShape) };
}

function isRecentDelivery(message, row) {
  const created = Number(message.createdTimestamp) || (message.id && /^\d{17,20}$/.test(message.id)
    ? Number((BigInt(message.id) >> 22n) + 1420070400000n) : 0);
  return created >= Number(row.createdAt) - 1000;
}

module.exports = { embedShape, sameMessage, isRecentDelivery };
