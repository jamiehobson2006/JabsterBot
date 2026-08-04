function compact(text, maxLength = 700) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();

  if (!value) return '';
  if (value.length <= maxLength) return value;

  return `${value.slice(0, maxLength - 3)}...`;
}

function summarizeEmbed(embed, index) {
  const parts = [];
  const label = `Embed ${index + 1}`;

  if (embed.author?.name) parts.push(`Author: ${compact(embed.author.name, 180)}`);
  if (embed.title) parts.push(`Title: ${compact(embed.title, 250)}`);
  if (embed.description) parts.push(`Description: ${compact(embed.description, 500)}`);

  if (embed.fields?.length) {
    const fields = embed.fields
      .slice(0, 5)
      .map(field => `${compact(field.name, 120)}: ${compact(field.value, 220)}`)
      .join(' | ');

    if (fields) parts.push(`Fields: ${fields}`);
    if (embed.fields.length > 5) parts.push(`Fields: +${embed.fields.length - 5} more`);
  }

  if (embed.footer?.text) parts.push(`Footer: ${compact(embed.footer.text, 180)}`);
  if (embed.url) parts.push(`URL: ${embed.url}`);
  if (embed.image?.url) parts.push('Image attached to embed');
  if (embed.thumbnail?.url) parts.push('Thumbnail attached to embed');

  return parts.length ? `${label}\n${parts.join('\n')}` : `${label}\nEmpty embed`;
}

function describeDeletedMessage(message) {
  const parts = [];
  const content = compact(message.content, 1200);

  if (content) parts.push(content);

  const embeds = [...(message.embeds?.values?.() || message.embeds || [])];
  if (embeds.length) {
    parts.push(embeds.map(summarizeEmbed).join('\n\n'));
  }

  if (message.attachments?.size) {
    parts.push(`Attachments: ${message.attachments.size}`);
  }

  return parts.join('\n\n') || 'No text, embeds, or attachments.';
}

module.exports = {
  describeDeletedMessage,
  summarizeEmbed
};
