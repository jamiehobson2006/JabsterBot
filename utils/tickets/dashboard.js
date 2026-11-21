const { randomUUID } = require('node:crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType,
  EmbedBuilder, ModalBuilder, RoleSelectMenuBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { get, run } = require('../../database');
const panels = require('./panels');
const types = require('./ticketTypes');
const LIFETIME = 60 * 60 * 1000;
const PAGE_SIZE = 20;

function createSession(guildId, userId) {
  run('DELETE FROM ticket_dashboard_sessions WHERE expiresAt<?', [Date.now()]);
  const id = randomUUID();
  run('INSERT INTO ticket_dashboard_sessions(id,guildId,userId,stateJson,expiresAt) VALUES(?,?,?,?,?)',
    [id, guildId, userId, JSON.stringify({ view: 'home', page: 0 }), Date.now() + LIFETIME]);
  return session(id);
}
function session(id) {
  const row = get('SELECT * FROM ticket_dashboard_sessions WHERE id=?', [id]);
  return row ? { ...row, state: JSON.parse(row.stateJson) } : null;
}
function save(row, state) {
  const changed = run('UPDATE ticket_dashboard_sessions SET stateJson=?,revision=revision+1,expiresAt=? WHERE id=? AND revision=?',
    [JSON.stringify(state), Date.now() + LIFETIME, row.id, row.revision]);
  if (!changed.changes) throw new Error('This dashboard changed. Use its latest controls.');
  return session(row.id);
}
function identity(customId) {
  const match = String(customId || '').match(/^td:([a-f0-9-]{36}):(\d+):([a-z-]+)$/);
  return match ? { id: match[1], revision: Number(match[2]), action: match[3] } : null;
}
function authorizeSession(interaction, parsed) {
  const row = session(parsed.id);
  if (!row || row.guildId !== interaction.guild?.id || row.userId !== interaction.user.id || row.expiresAt <= Date.now()) {
    throw new Error('This ticket dashboard expired or belongs to another administrator. Open /ticket dashboard again.');
  }
  if (row.revision !== parsed.revision) throw new Error('These controls are out of date. Use the latest ticket dashboard message.');
  return row;
}
function id(row, action) { return `td:${row.id}:${row.revision}:${action}`; }
function button(row, action, label, style = ButtonStyle.Secondary, disabled = false) {
  return new ButtonBuilder().setCustomId(id(row, action)).setLabel(label).setStyle(style).setDisabled(disabled);
}
function buttons(...items) { return new ActionRowBuilder().addComponents(items); }
function channelMenu(row, action, placeholder, category = false, clearable = false) {
  return new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId(id(row, action)).setPlaceholder(placeholder)
    .setChannelTypes(...(category ? [ChannelType.GuildCategory] : [ChannelType.GuildText, ChannelType.GuildAnnouncement]))
    .setMinValues(clearable ? 0 : 1).setMaxValues(1));
}
function panelFor(row) {
  const panel = row.state.panelId ? panels.byId(row.guildId, row.state.panelId) : null;
  if (row.state.panelId && !panel) throw new Error('This panel is no longer available. Open the dashboard again.');
  return panel;
}
function routeRows(row) {
  return row.state.panelId ? panels.routes(row.guildId, row.state.panelId) : require('../../database').all('SELECT * FROM ticket_settings WHERE guildId=? ORDER BY type', [row.guildId]);
}
function typeMenu(row) {
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(id(row, 'type')).setPlaceholder('Choose a ticket type')
    .addOptions(Object.entries(types).map(([value, type]) => ({ label: type.name, value, default: row.state.type === value }))));
}
function payload(row) {
  const state = row.state, embed = new EmbedBuilder().setColor(0x5865F2).setTitle('Ticket Dashboard')
    .setFooter({ text: 'Jabster Studios | Administrator settings' });
  let components;
  if (state.view === 'home') {
    const records = panels.list(row.guildId), pages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
    const page = Math.max(0, Math.min(state.page || 0, pages - 1));
    const options = [{ label: 'Default server-wide panel', value: 'default', description: 'Original ticket setup settings' },
      ...records.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(panel => ({ label: panel.name, value: panel.id,
        description: `${panel.enabled ? 'Enabled' : 'Disabled'} | ${panels.routes(row.guildId, panel.id).filter(route => route.enabled).length} ticket types` }))];
    embed.setDescription(`**${records.length} named panels**\nPage ${page + 1}/${pages}`);
    components = [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(id(row, 'panel')).setPlaceholder('Choose a panel').addOptions(options)),
      buttons(button(row, 'new', 'New panel', ButtonStyle.Primary), button(row, 'previous', 'Previous', ButtonStyle.Secondary, page === 0),
        button(row, 'next', 'Next', ButtonStyle.Secondary, page === pages - 1), button(row, 'shared', 'Shared settings'), button(row, 'refresh', 'Refresh'))];
  } else if (state.view === 'settings') {
    const settings = get('SELECT * FROM guild_settings WHERE guildId=?', [row.guildId]) || {};
    const limits = get('SELECT * FROM ticket_limits WHERE guildId=?', [row.guildId]) || { maxPerWindow: 3, windowMinutes: 10, cooldownSeconds: 15 };
    const location = value => value ? `<#${value}>` : 'Not set';
    embed.setTitle('Shared Ticket Settings').addFields(
      { name: 'Ticket transcripts', value: location(settings.transcriptChannelId) },
      { name: 'Application transcripts', value: location(settings.applicationTranscriptChannelId) },
      { name: 'Ticket feedback', value: location(settings.ticketFeedbackChannelId) },
      { name: 'Creation limits', value: `${limits.maxPerWindow} tickets per ${limits.windowMinutes} minutes | ${limits.cooldownSeconds}s cooldown` });
    components = [channelMenu(row, 'transcripts', 'Ticket transcript channel (clear to unset)', false, true),
      channelMenu(row, 'app-transcripts', 'Application transcript channel (clear to unset)', false, true),
      channelMenu(row, 'feedback', 'Feedback channel (clear to unset)', false, true),
      buttons(button(row, 'limits', 'Edit creation limits'), button(row, 'home', 'Panels'), button(row, 'refresh', 'Refresh'))];
  } else {
    const panel = panelFor(row), name = panel?.name || 'Default server-wide panel';
    embed.setTitle(`Tickets | ${name}`);
    if (state.view === 'route' || state.view === 'remove') {
      if (!Object.hasOwn(types, state.type)) throw new Error('Choose a valid ticket type.');
      embed.setDescription(`**${types[state.type].name}**`).addFields(
        { name: 'Destination category', value: state.categoryId ? `<#${state.categoryId}>` : 'Not selected', inline: true },
        { name: 'Staff role', value: state.roleId ? `<@&${state.roleId}>` : 'Not selected', inline: true },
        { name: 'Enabled', value: state.routeEnabled ? 'Yes' : 'No', inline: true });
      if (state.view === 'remove') components = [buttons(button(row, 'confirm-remove', 'Confirm removal', ButtonStyle.Danger), button(row, 'cancel-remove', 'Cancel'))];
      else components = [typeMenu(row), channelMenu(row, 'category', 'Choose destination category', true),
        new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId(id(row, 'role')).setPlaceholder('Choose staff role').setMinValues(1).setMaxValues(1)),
        buttons(button(row, 'save-route', 'Save ticket type', ButtonStyle.Success, !state.categoryId || !state.roleId),
          button(row, 'toggle-route', state.routeEnabled ? 'Disable on save' : 'Enable on save'),
          button(row, 'remove', 'Remove type', ButtonStyle.Danger), button(row, 'back', 'Back'))];
    } else if (state.view === 'publish') {
      embed.addFields({ name: 'Post panel in', value: state.postChannelId ? `<#${state.postChannelId}>` : 'Choose a text channel below' });
      if (state.lastPost) embed.addFields({ name: 'Last post', value: `[Open panel](https://discord.com/channels/${row.guildId}/${state.lastPost.channelId}/${state.lastPost.id})` });
      if (state.postWarnings?.length) embed.addFields({ name: 'Invalid ticket types omitted', value: state.postWarnings.join(', ') });
      components = [channelMenu(row, 'post-channel', 'Choose where this panel is posted'), buttons(
        button(row, 'preview', 'Preview'), button(row, 'post', state.posted ? 'Panel posted' : 'Post new panel', ButtonStyle.Success, !state.postChannelId || Boolean(state.posted)),
        button(row, 'back', 'Back'))];
    } else {
      const records = routeRows(row);
      embed.setDescription(panel?.description || 'Server-wide ticket configuration.').addFields(
        { name: 'Panel status', value: panel ? panel.enabled ? 'Enabled' : 'Disabled' : 'Default panel' },
        { name: 'Ticket types', value: records.map(route => `${types[route.type]?.name || route.type}: ${route.enabled ? 'Enabled' : 'Disabled'}\n${route.categoryId ? `<#${route.categoryId}>` : 'No category'} | ${route.roleId ? `<@&${route.roleId}>` : 'No staff role'}`).join('\n\n') || 'No ticket types added yet.' });
      if (panel?.postChannelId) embed.addFields({ name: 'Saved posting channel', value: `<#${panel.postChannelId}>` });
      components = [typeMenu(row), buttons(button(row, 'edit', 'Edit panel text', ButtonStyle.Secondary, !panel),
        button(row, 'toggle-panel', panel?.enabled ? 'Disable panel' : 'Enable panel', ButtonStyle.Secondary, !panel),
        button(row, 'publish', 'Post panel', ButtonStyle.Primary, Boolean(panel && !panel.enabled) || !records.some(route => route.enabled)), button(row, 'home', 'Panels'), button(row, 'refresh', 'Refresh'))];
    }
  }
  return { content: null, embeds: [embed], components, allowedMentions: { parse: [] } };
}

function modal(row, action) {
  const form = new ModalBuilder().setCustomId(id(row, `${action}-save`));
  const field = (key, label, maximum, value = '', required = true, paragraph = false) => {
    const input = new TextInputBuilder().setCustomId(key).setLabel(label).setMaxLength(maximum).setRequired(required)
      .setStyle(paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short);
    if (value) input.setValue(String(value));
    form.addComponents(new ActionRowBuilder().addComponents(input));
  };
  if (action === 'limits') {
    const limits = get('SELECT * FROM ticket_limits WHERE guildId=?', [row.guildId]) || { maxPerWindow: 3, windowMinutes: 10, cooldownSeconds: 15 };
    form.setTitle('Ticket Creation Limits');
    field('maximum', 'Tickets per member (1-25)', 2, limits.maxPerWindow);
    field('window', 'Rolling window in minutes (1-1440)', 4, limits.windowMinutes);
    field('cooldown', 'Cooldown in seconds (1-300)', 3, limits.cooldownSeconds);
  } else {
    const panel = action === 'edit' ? panelFor(row) : null;
    if (action === 'edit' && !panel) throw new Error('Create a named panel to customize its text.');
    form.setTitle(panel ? 'Edit Ticket Panel' : 'Create Ticket Panel');
    if (!panel) field('name', 'Panel name (letters, numbers, hyphens)', 32);
    field('title', 'Panel title', 150, panel?.title || 'Support Center');
    field('description', 'Panel description', 1500, panel?.description || '', false, true);
  }
  return form;
}

function selectType(row, type) {
  if (!Object.hasOwn(types, type)) throw new Error('Invalid ticket type.');
  const previous = routeRows(row).find(route => route.type === type) || get('SELECT * FROM ticket_settings WHERE guildId=? AND type=?', [row.guildId, type]) || {};
  return { ...row.state, view: 'route', type, categoryId: previous.categoryId || null, roleId: previous.roleId || null, routeEnabled: Boolean(previous.enabled ?? true) };
}

module.exports = { LIFETIME, PAGE_SIZE, authorizeSession, createSession, identity, modal, panelFor, payload, routeRows, save, selectType, session };
