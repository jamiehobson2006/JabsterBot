const { createHash } = require('node:crypto');
const { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder } = require('discord.js');
const { all, get } = require('../../database');
const panels = require('./panels');
const ticketTypes = require('./ticketTypes');
const validation = require('./configuration');

function configuration(guildId, panelId = null) {
  const panel = panelId ? panels.byId(guildId, panelId) : null;
  if (panelId && !panel) throw new Error('Named panel not found.');
  if (panel && !panel.enabled) throw new Error('This panel is disabled. Enable it before posting.');
  const rows = panel ? panels.routes(guildId, panelId) : all('SELECT * FROM ticket_settings WHERE guildId=? ORDER BY type', [guildId]);
  return { panel, rows: rows.filter(row => row.enabled && row.categoryId && row.roleId) };
}

function signature(guildId, panelId) {
  return createHash('sha256').update(JSON.stringify(configuration(guildId, panelId))).digest('hex');
}

async function buildPanel(guild, panelId = null) {
  const { panel, rows } = configuration(guild.id, panelId);
  const snapshot = signature(guild.id, panelId), options = [], invalidTypes = [];
  for (const row of rows) {
    const type = ticketTypes[row.type];
    if (!type) continue;
    const category = await validation.fetchCategory(guild, row.categoryId);
    const role = await validation.fetchStaffRole(guild, row.roleId);
    if (!category || !role) { invalidTypes.push(type.name); continue; }
    options.push({ label: type.name, value: row.type, emoji: type.emoji,
      description: row.type === 'application' ? 'Choose an application to see its staff response estimate' :
        `Average first reply: ${require('./responseTimes').responseEstimate(guild.id, row.type, row.roleId).label}` });
  }
  if (!options.length) throw new Error('No valid enabled ticket types are configured for this panel.');
  if (options.length > 25) throw new Error('A panel can contain at most 25 ticket types.');
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(panel?.title || 'Support Center')
    .setDescription(panel?.description || 'Select a ticket type below and our staff team will assist you.')
    .setFooter({ text: `${guild.name} | Jabster Studios Tickets` }).setTimestamp();
  let text = '';
  for (const option of options) {
    const block = `${option.emoji} **${option.label}**\n${option.description}`;
    if (text && text.length + block.length > 950) { embed.addFields({ name: 'Available Ticket Types', value: text }); text = ''; }
    text += (text ? '\n\n' : '') + block;
  }
  if (text) embed.addFields({ name: 'Available Ticket Types', value: text });
  const menu = new StringSelectMenuBuilder().setCustomId(panelId ? `ticket_create:${panelId}` : 'ticket_create')
    .setPlaceholder('Select a ticket type').addOptions(options);
  return { payload: { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)], allowedMentions: { parse: [] } },
    invalidTypes, signature: snapshot };
}

async function publishPanel({ guild, destination, panelId = null, deliveryKey = null, assertOwned = () => {} }) {
  if (deliveryKey) {
    const sent = get("SELECT * FROM delivery_outbox WHERE deliveryKey=? AND status='SENT'", [deliveryKey]);
    if (sent) return { id: sent.messageId, channelId: JSON.parse(sent.payload).destinationId, invalidTypes: [] };
  }
  await guild.members.fetchMe({ force: true });
  require('../destinationValidation').assertDestination(guild, destination);
  const built = await buildPanel(guild, panelId);
  const beforeSend = () => {
    assertOwned();
    if (signature(guild.id, panelId) !== built.signature) throw new Error('Panel settings changed while preparing this post. Review the panel and try again.');
  };
  if (!deliveryKey) { beforeSend(); return { ...await destination.send(built.payload), channelId: destination.id, invalidTypes: built.invalidTypes }; }
  const outbox = require('../deliveryOutbox');
  // This interactive action owns retries; the generic channel worker must not publish stale panel settings.
  outbox.enqueueDelivery({ deliveryKey, type: 'TICKET_PANEL_POST', guildId: guild.id,
    payload: { message: built.payload, panelId, destinationId: destination.id, signature: built.signature } });
  const receipt = await outbox.deliverOnce(deliveryKey, claimed => outbox.sendQueuedMessage(destination, claimed, built.payload, { beforeSend: () => {
    beforeSend();
    if (claimed.parsedPayload.destinationId !== destination.id || claimed.parsedPayload.signature !== signature(guild.id, panelId)) {
      throw new Error('This pending post belongs to older settings. Review its delivery before creating a replacement.');
    }
  } }));
  if (receipt?.status !== 'SENT' || !receipt.messageId) throw new Error('Panel delivery is pending or needs review. Retry this same posting action.');
  return { id: receipt.messageId, channelId: destination.id, invalidTypes: built.invalidTypes };
}

module.exports = { buildPanel, configuration, publishPanel, signature };
