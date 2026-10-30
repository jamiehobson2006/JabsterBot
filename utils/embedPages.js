const { EmbedBuilder } = require('discord.js');

function fieldPages(base, fields, budget = 5600) {
  const pages = [];
  let embed = EmbedBuilder.from(base);
  embed.setFields([]);
  for (const field of fields) {
    if ((embed.data.fields?.length || 0) >= 25 || embed.length + field.name.length + field.value.length > budget) {
      pages.push(embed);
      embed = EmbedBuilder.from(base).setFields([]);
    }
    embed.addFields(field);
  }
  pages.push(embed);
  if (pages.length > 1) pages.forEach((page, index) => page.setFooter({
    ...(page.data.footer || {}), text: `${page.data.footer?.text || 'Staff dashboard'} | Page ${index + 1}/${pages.length}`
  }));
  return pages;
}

function messageIds(json, legacyId) {
  let ids;
  try { ids = JSON.parse(json || '[]'); } catch { ids = []; }
  return Array.isArray(ids) && ids.length ? ids.filter(id => typeof id === 'string') : legacyId ? [legacyId] : [];
}

async function syncEmbedPages({ channel, embeds, ids, save, botId }) {
  const saved = [...ids];
  for (let index = 0; index < embeds.length; index += 1) {
    let message = saved[index] ? await channel.messages.fetch(saved[index]).catch(error => {
      if (Number(error.code) === 10008) return null;
      throw error;
    }) : null;
    if (message && message.author?.id !== botId) throw new Error('A saved dashboard message is not owned by this bot.');
    const payload = { embeds: [embeds[index]], allowedMentions: { parse: [] } };
    message = message ? await message.edit(payload) : await channel.send(payload);
    saved[index] = message.id;
    save(saved);
  }
  for (const id of saved.slice(embeds.length)) {
    const message = await channel.messages.fetch(id).catch(error => {
      if (Number(error.code) === 10008) return null;
      throw error;
    });
    if (message?.author?.id === botId) await message.delete();
  }
  save(saved.slice(0, embeds.length));
  return saved.slice(0, embeds.length);
}

async function removeEmbedPages(channel, ids, botId) {
  if (!channel) return;
  for (const id of ids) {
    const message = await channel.messages.fetch(id).catch(error => {
      if (Number(error.code) === 10008) return null;
      throw error;
    });
    if (message?.author?.id === botId) await message.delete();
  }
}

module.exports = { fieldPages, messageIds, syncEmbedPages, removeEmbedPages };
