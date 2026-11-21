const { randomUUID } = require('node:crypto');
const { MessageFlags, PermissionFlagsBits: P } = require('discord.js');
const { get, run } = require('../database');
const dashboard = require('../utils/tickets/dashboard');
const panels = require('../utils/tickets/panels');

const VIEWS = {
  panel: ['home'], new: ['home'], 'new-save': ['home'], previous: ['home'], next: ['home'],
  type: ['panel', 'route'], edit: ['panel'], 'edit-save': ['panel'], 'toggle-panel': ['panel'], publish: ['panel'],
  category: ['route'], role: ['route'], 'save-route': ['route'], 'toggle-route': ['route'], remove: ['route'],
  'confirm-remove': ['remove'], 'cancel-remove': ['remove'],
  'post-channel': ['publish'], preview: ['publish'], post: ['publish'],
  transcripts: ['settings'], 'app-transcripts': ['settings'], feedback: ['settings'], limits: ['settings'], 'limits-save': ['settings']
};

async function requireAdmin(interaction) {
  const member = await interaction.guild.members.fetch({ user: interaction.user.id, force: true });
  if (!member.permissions.has(P.Administrator)) throw new Error('Administrator permission is required.');
}
function assertView(row, action) {
  if (VIEWS[action] && !VIEWS[action].includes(row.state.view)) throw new Error('That control is not available in the current dashboard view.');
}
async function destination(guild, channelId) {
  const channel = await guild.channels.fetch(channelId, { force: true });
  await guild.members.fetchMe({ force: true });
  return require('../utils/destinationValidation').assertDestination(guild, channel);
}
async function audit(interaction, row, action, state) {
  await require('../utils/logger').logAudit(interaction.client, row.guildId, {
    action: 'TICKET_DASHBOARD_UPDATED', type: 'COMMANDS', executorId: interaction.user.id,
    metadata: { setting: action, panelId: state.panelId || null, ticketType: state.type || null,
      categoryId: state.categoryId || null, staffRoleId: state.roleId || null, postingChannelId: state.postChannelId || null }
  }).catch(error => console.error('Ticket dashboard audit:', error.message));
}
async function errorReply(interaction, error) {
  const message = { content: String(error.message || error).slice(0, 1800), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
  if (interaction.deferred || interaction.replied) return interaction.followUp(message);
  return interaction.reply(message);
}

module.exports = { name: 'interactionCreate', async execute(interaction) {
  const parsed = dashboard.identity(interaction.customId);
  if (!parsed) return;
  try {
    let row = dashboard.authorizeSession(interaction, parsed);
    assertView(row, parsed.action);
    if (['new', 'edit', 'limits'].includes(parsed.action)) {
      if (!interaction.isButton?.()) throw new Error('Use a dashboard button to open this form.');
      await requireAdmin(interaction);
      row = dashboard.authorizeSession(interaction, parsed);
      return interaction.showModal(dashboard.modal(row, parsed.action));
    }
    if (parsed.action.endsWith('-save') && !interaction.isModalSubmit?.()) throw new Error('Submit the dashboard form to save these settings.');
    await interaction.deferUpdate();
    return await require('../utils/workLeases').withWorkLease(`ticket-dashboard:${row.id}`, async assertOwned => {
      await requireAdmin(interaction);
      row = dashboard.authorizeSession(interaction, parsed);
      assertView(row, parsed.action);
      let state = { ...row.state }, changed = false;
      const action = parsed.action, value = interaction.values?.[0];
      const panel = () => dashboard.panelFor(row);
      const read = key => interaction.fields.getTextInputValue(key);
      assertOwned();
      if (action === 'home') state = { view: 'home', page: 0 };
      else if (action === 'shared') state = { view: 'settings' };
      else if (action === 'previous' || action === 'next') state.page = Math.max(0, Math.min(
        Math.ceil(panels.list(row.guildId).length / dashboard.PAGE_SIZE) - 1, (state.page || 0) + (action === 'next' ? 1 : -1)));
      else if (action === 'panel') {
        if (value !== 'default' && !panels.byId(row.guildId, value)) throw new Error('Panel not found in this server.');
        state = { view: 'panel', panelId: value === 'default' ? null : value };
      } else if (action === 'new-save') {
        const created = panels.create(row.guildId, interaction.user.id, { name: read('name'), title: read('title'), description: read('description') });
        state = { view: 'panel', panelId: created.id }; changed = true;
      } else if (action === 'edit-save') {
        const selected = panel(); if (!selected) throw new Error('Select a named panel first.');
        panels.edit(row.guildId, selected.name, { title: read('title'), description: read('description') || 'Select the ticket type you need below.' }); changed = true;
      } else if (action === 'toggle-panel') {
        const selected = panel(); if (!selected) throw new Error('Select a named panel first.');
        panels.edit(row.guildId, selected.name, { enabled: !selected.enabled }); changed = true;
      } else if (action === 'type') state = dashboard.selectType(row, value);
      else if (action === 'category') {
        const category = await require('../utils/tickets/configuration').fetchCategory(interaction.guild, value);
        if (!category) throw new Error('Choose an existing category in this server.');
        state.categoryId = category.id;
      } else if (action === 'role') {
        const role = await require('../utils/tickets/configuration').fetchStaffRole(interaction.guild, value);
        if (!role) throw new Error('Choose a normal staff role in this server.');
        state.roleId = role.id;
      } else if (action === 'toggle-route') state.routeEnabled = !state.routeEnabled;
      else if (action === 'save-route') {
        const selected = panel();
        if (selected) await panels.setRoute(interaction.guild, selected.name, state.type, {
          categoryId: state.categoryId, roleId: state.roleId, enabled: state.routeEnabled }, assertOwned);
        else {
          await require('../utils/tickets/configuration').resolveConfiguration(interaction.guild, { categoryId: state.categoryId, roleId: state.roleId });
          assertOwned();
          run(`INSERT INTO ticket_settings(guildId,type,categoryId,roleId,enabled) VALUES(?,?,?,?,?)
            ON CONFLICT(guildId,type) DO UPDATE SET categoryId=excluded.categoryId,roleId=excluded.roleId,enabled=excluded.enabled`,
            [row.guildId, state.type, state.categoryId, state.roleId, Number(state.routeEnabled)]);
        }
        state.view = 'panel'; changed = true;
      } else if (action === 'remove') state.view = 'remove';
      else if (action === 'cancel-remove') state.view = 'route';
      else if (action === 'confirm-remove') {
        const selected = panel();
        if (selected) panels.removeRoute(row.guildId, selected.name, state.type);
        else run('UPDATE ticket_settings SET enabled=0 WHERE guildId=? AND type=?', [row.guildId, state.type]);
        state.view = 'panel'; changed = true;
      } else if (action === 'back') state = { view: 'panel', panelId: state.panelId || null };
      else if (action === 'publish') {
        const selected = panel();
        if (selected && !selected.enabled) throw new Error('Enable this panel before posting it.');
        state = { view: 'publish', panelId: selected?.id || null, postChannelId: selected?.postChannelId || null,
          publicationToken: randomUUID(), lastPost: selected?.postChannelId && selected.postMessageId ? { channelId: selected.postChannelId, id: selected.postMessageId } : null };
      } else if (action === 'post-channel') {
        const channel = await destination(interaction.guild, value);
        if (state.postChannelId !== channel.id || !state.publicationToken) {
          state.postChannelId = channel.id; state.publicationToken = randomUUID(); state.posted = false;
        }
      } else if (action === 'preview') {
        const built = await require('../utils/tickets/panelPresentation').buildPanel(interaction.guild, state.panelId);
        return interaction.followUp({ content: 'Panel preview' + (built.invalidTypes.length ? ` | Invalid types omitted: ${built.invalidTypes.join(', ')}` : ''),
          embeds: built.payload.embeds, components: [], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      } else if (action === 'post') {
        if (!state.postChannelId || !state.publicationToken) throw new Error('Choose a posting channel first.');
        const channel = await destination(interaction.guild, state.postChannelId);
        const result = await require('../utils/tickets/panelPresentation').publishPanel({ guild: interaction.guild, destination: channel,
          panelId: state.panelId, deliveryKey: `ticket-panel-dashboard:${row.id}:${state.publicationToken}`, assertOwned });
        assertOwned();
        state.lastPost = { id: result.id, channelId: result.channelId }; state.posted = true;
        state.postWarnings = result.invalidTypes;
        if (state.panelId) run('UPDATE ticket_panels SET postChannelId=?,postMessageId=? WHERE guildId=? AND id=?',
          [result.channelId, result.id, row.guildId, state.panelId]);
        changed = true;
      } else if (['transcripts', 'app-transcripts', 'feedback'].includes(action)) {
        if (value) await destination(interaction.guild, value);
        const column = { transcripts: 'transcriptChannelId', 'app-transcripts': 'applicationTranscriptChannelId', feedback: 'ticketFeedbackChannelId' }[action];
        assertOwned();
        run(`INSERT INTO guild_settings(guildId,${column}) VALUES(?,?) ON CONFLICT(guildId) DO UPDATE SET ${column}=excluded.${column}`, [row.guildId, value || null]);
        changed = true;
      } else if (action === 'limits-save') {
        const fields = [['maximum', 1, 25], ['window', 1, 1440], ['cooldown', 1, 300]];
        const numbers = fields.map(([key, minimum, maximum]) => {
          const value = read(key).trim();
          if (!/^\d+$/.test(value) || Number(value) < minimum || Number(value) > maximum) throw new Error(`${key} must be a whole number from ${minimum} to ${maximum}.`);
          return Number(value);
        });
        run(`INSERT INTO ticket_limits(guildId,maxPerWindow,windowMinutes,cooldownSeconds) VALUES(?,?,?,?)
          ON CONFLICT(guildId) DO UPDATE SET maxPerWindow=excluded.maxPerWindow,windowMinutes=excluded.windowMinutes,cooldownSeconds=excluded.cooldownSeconds`, [row.guildId, ...numbers]);
        changed = true;
      } else if (action === 'refresh') {
        if (state.view === 'route') state = dashboard.selectType(row, state.type);
      } else throw new Error('Unknown dashboard action. Open /ticket dashboard again.');
      assertOwned();
      const updated = dashboard.save(row, state);
      if (changed) await audit(interaction, row, action, state);
      return interaction.editReply(dashboard.payload(updated));
    });
  } catch (error) {
    return errorReply(interaction, error).catch(replyError => console.error('Ticket dashboard reply:', replyError.message));
  }
} };
