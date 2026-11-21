const { randomUUID } = require('node:crypto');
const { all, get, run } = require('../../database');
const { safeText, slug } = require('../communityAccess');
const ticketTypes = require('./ticketTypes');

function migrateTicketPanels(rawRun, ensureColumn) {
  rawRun(`CREATE TABLE IF NOT EXISTS ticket_panels (
    id TEXT PRIMARY KEY, guildId TEXT NOT NULL, name TEXT NOT NULL, title TEXT NOT NULL,
    description TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
    createdBy TEXT NOT NULL, createdAt INTEGER NOT NULL, UNIQUE(guildId,name))`);
  rawRun(`CREATE TABLE IF NOT EXISTS ticket_panel_routes (
    panelId TEXT NOT NULL, guildId TEXT NOT NULL, type TEXT NOT NULL, categoryId TEXT NOT NULL,
    roleId TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(panelId,type))`);
  ensureColumn('tickets', 'ticketPanelId', 'TEXT');
  ensureColumn('application_drafts', 'ticketPanelId', 'TEXT');
  ensureColumn('ticket_panels', 'postChannelId', 'TEXT');
  ensureColumn('ticket_panels', 'postMessageId', 'TEXT');
  rawRun(`CREATE TABLE IF NOT EXISTS ticket_dashboard_sessions (
    id TEXT PRIMARY KEY,guildId TEXT NOT NULL,userId TEXT NOT NULL,stateJson TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,expiresAt INTEGER NOT NULL)`);
}

function byName(guildId, name) {
  return get('SELECT * FROM ticket_panels WHERE guildId=? AND name=?', [guildId, slug(name)]);
}
function byId(guildId, id) {
  return get('SELECT * FROM ticket_panels WHERE guildId=? AND id=?', [guildId, id]);
}
function list(guildId) {
  return all('SELECT * FROM ticket_panels WHERE guildId=? ORDER BY name', [guildId]);
}
function routes(guildId, panelId) {
  return all('SELECT * FROM ticket_panel_routes WHERE guildId=? AND panelId=? ORDER BY type', [guildId, panelId]);
}
function create(guildId, actorId, { name, title, description }) {
  name = slug(name);
  if (byName(guildId, name)) throw new Error('A panel with this name already exists. Use edit to update it.');
  if (list(guildId).length >= 50) throw new Error('This server has reached 50 named panels. Reuse an existing panel.');
  const id = randomUUID();
  run('INSERT INTO ticket_panels(id,guildId,name,title,description,createdBy,createdAt) VALUES(?,?,?,?,?,?,?)',
    [id, guildId, name, safeText(title || 'Support Center', 150),
      safeText(description || 'Select the ticket type you need below.', 1500), actorId, Date.now()]);
  return byId(guildId, id);
}
function edit(guildId, name, values) {
  const panel = byName(guildId, name);
  if (!panel) throw new Error('Panel not found in this server.');
  run('UPDATE ticket_panels SET title=?,description=?,enabled=? WHERE guildId=? AND id=?',
    [safeText(values.title ?? panel.title, 150), safeText(values.description ?? panel.description, 1500),
      Number(values.enabled ?? panel.enabled), guildId, panel.id]);
  return byId(guildId, panel.id);
}

function routing(guildId, type, panelId = null) {
  if (!Object.hasOwn(ticketTypes, type)) throw new Error('Invalid ticket type.');
  let settings, panel = null;
  if (panelId) {
    panel = byId(guildId, panelId);
    if (!panel?.enabled) throw new Error('This ticket panel is disabled or no longer available.');
    settings = get('SELECT * FROM ticket_panel_routes WHERE guildId=? AND panelId=? AND type=?', [guildId, panelId, type]);
  } else settings = get('SELECT * FROM ticket_settings WHERE guildId=? AND type=?', [guildId, type]);
  if (!settings?.enabled || !settings.categoryId || !settings.roleId) {
    throw new Error('This ticket type is no longer available on this panel. Ask an administrator to update the panel.');
  }
  return { ...settings, ticketPanelId: panelId, panelName: panel?.name || null };
}

async function setRoute(guild, panelName, type, values, assertOwned = () => {}) {
  const panel = byName(guild.id, panelName);
  if (!panel) throw new Error('Create this panel first with /ticket panels create.');
  if (!Object.hasOwn(ticketTypes, type)) throw new Error('Invalid ticket type.');
  const previous = get('SELECT * FROM ticket_panel_routes WHERE guildId=? AND panelId=? AND type=?', [guild.id, panel.id, type]);
  const defaults = get('SELECT * FROM ticket_settings WHERE guildId=? AND type=?', [guild.id, type]);
  const categoryId = values.categoryId ?? previous?.categoryId ?? defaults?.categoryId;
  const roleId = values.roleId ?? previous?.roleId ?? defaults?.roleId;
  if (!categoryId || !roleId) throw new Error('Choose both a category and staff role for this panel entry.');
  await require('./configuration').resolveConfiguration(guild, { categoryId, roleId });
  assertOwned();
  run(`INSERT INTO ticket_panel_routes(panelId,guildId,type,categoryId,roleId,enabled) VALUES(?,?,?,?,?,?)
    ON CONFLICT(panelId,type) DO UPDATE SET categoryId=excluded.categoryId,roleId=excluded.roleId,enabled=excluded.enabled`,
    [panel.id, guild.id, type, categoryId, roleId, Number(values.enabled ?? previous?.enabled ?? true)]);
  return get('SELECT * FROM ticket_panel_routes WHERE guildId=? AND panelId=? AND type=?', [guild.id, panel.id, type]);
}

function removeRoute(guildId, panelName, type) {
  const panel = byName(guildId, panelName);
  if (!panel) throw new Error('Panel not found in this server.');
  return run('DELETE FROM ticket_panel_routes WHERE guildId=? AND panelId=? AND type=?', [guildId, panel.id, type]);
}

module.exports = { byId, byName, create, edit, list, migrateTicketPanels, removeRoute, routes, routing, setRoute };
