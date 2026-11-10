const fs = require('node:fs');
const path = require('node:path');
const { CommandInteractionOptionResolver, PermissionsBitField } = require('discord.js');
const { GROUPS, LEGACY_PATHS, normalizePath } = require('./commandLayout');
const { permissionDefaults } = require('./commandPermissions');
const { validateGlobalCommands } = require('./commandValidation');

function definitionData(json) {
  return { name: json.name, description: json.description, toJSON: () => structuredClone(json) };
}

function sourcePermission(command) {
  const json = command.data.toJSON();
  return permissionDefaults[json.name]?.toString() ?? json.default_member_permissions ?? null;
}

function adaptInteraction(interaction, route) {
  const original = interaction.options;
  const options = new CommandInteractionOptionResolver(interaction.client,
    original.data?.[0]?.options || [], original.resolved);
  return new Proxy(interaction, {
    get(target, key) {
      if (key === 'commandName') return route.sourceName;
      if (key === 'options') return options;
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

function buildGroup(group, sources) {
  const routes = new Map();
  const options = [];
  for (const [action, sourceName] of Object.entries(group.entries)) {
    const source = sources.get(sourceName);
    if (!source) throw new Error(`Cannot build /${group.name}: handler /${sourceName} is missing.`);
    const json = source.data.toJSON();
    if (json.options?.some(option => option.type === 2)) {
      throw new Error(`/${sourceName} already has nested groups; it cannot be nested another level.`);
    }
    const isGroup = Boolean(json.options?.some(option => option.type === 1));
    const node = { type: isGroup ? 2 : 1, name: action, description: json.description,
      options: json.options || [] };
    options.push(node);
    routes.set(action, { sourceName, command: source, isGroup, permission: sourcePermission(source),
      path: `${group.name} ${action}`, category: group.category });
  }
  const permissions = new Set([...routes.values()].map(route => route.permission));
  const json = { name: group.name, type: 1, description: group.description, dm_permission: false,
    default_member_permissions: permissions.size === 1 ? [...permissions][0] : null, options };
  const command = {
    data: definitionData(json), category: group.category, grouped: true, routes,
    resolve(interaction) {
      let action, selectedGroup;
      try { selectedGroup = interaction.options.getSubcommandGroup(false); action = selectedGroup || interaction.options.getSubcommand(false); }
      catch { action = null; }
      const route = routes.get(action);
      if (!route) throw new Error(`This command now uses subcommands. Open /help to see the /${group.name} actions.`);
      if (Boolean(selectedGroup) !== route.isGroup) throw new Error('This command syntax has changed. Refresh the command list or open /help.');
      // Refuse fabricated combinations of a subcommand and a group from different handlers.
      const subcommand = interaction.options.getSubcommand(false);
      if (route.isGroup && !route.command.data.toJSON().options.some(option => option.name === subcommand)) {
        throw new Error('This subcommand is not available. Refresh the command list and try again.');
      }
      return { ...route, interaction: adaptInteraction(interaction, route) };
    },
    async execute(interaction, client) {
      const resolved = command.resolve(interaction);
      if (resolved.permission !== null && !interaction.memberPermissions?.has(BigInt(resolved.permission) || require('discord.js').PermissionFlagsBits.Administrator)) {
        const required = new PermissionsBitField(BigInt(resolved.permission)).toArray().join(', ') || 'Administrator';
        return interaction.editReply({ content: `You need ${required} to use /${resolved.path}.`, allowedMentions: { parse: [] } });
      }
      return resolved.command.execute(resolved.interaction, client);
    }
  };
  return command;
}

function loadCommandRegistry({ root = path.join(__dirname, '..', 'commands'), fresh = false } = {}) {
  const sources = new Map();
  for (const directory of fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).sort((a,b) => a.name.localeCompare(b.name))) {
    const folder = path.join(root, directory.name);
    for (const filename of fs.readdirSync(folder).filter(name => name.endsWith('.js')).sort()) {
      const file = path.join(folder, filename);
      if (fresh) delete require.cache[require.resolve(file)];
      const command = require(file);
      if (!command?.data?.toJSON || typeof command.execute !== 'function') throw new Error(`Invalid command module: ${file}`);
      const json = require('./commandAutocomplete').markOptions(command.data.toJSON(),command.data.name);
      if (sources.has(json.name)) throw new Error(`Duplicate command handler: /${json.name}`);
      const permission = sourcePermission(command);
      sources.set(json.name, { ...command, category: command.category || directory.name,
        data: definitionData({ ...json, default_member_permissions: permission,
          ...(command.dmPermission === false ? { dm_permission: false } : {}) }) });
    }
  }
  const commands = new Map([...sources].filter(([name]) => !Object.hasOwn(LEGACY_PATHS, name)));
  for (const group of GROUPS) {
    if (commands.has(group.name)) throw new Error(`Command group /${group.name} conflicts with an existing command.`);
    commands.set(group.name, buildGroup(group, sources));
  }
  const definitions = [...commands.values()].map(command => command.data.toJSON());
  validateGlobalCommands(definitions);
  return { commands, definitions, sources };
}

function resolveInvocation(command, interaction) {
  return command.resolve ? command.resolve(interaction) : { command, interaction, sourceName: interaction.commandName };
}

function commandNode(commands, input) {
  let name = normalizePath(input);
  let parts = name.split(' ');
  if (!commands.has(parts[0]) && LEGACY_PATHS[parts[0]]) {
    name = [LEGACY_PATHS[parts[0]], ...parts.slice(1)].join(' ');
    parts = name.split(' ');
  }
  const command = commands.get(parts[0]);
  if (!command) return null;
  let node = command.data.toJSON();
  for (const part of parts.slice(1)) {
    node = node.options?.find(option => option.type <= 2 && option.name === part);
    if (!node) return null;
  }
  const route = command.routes?.get(parts[1]);
  return { name, command, node, route };
}

function commandEntries(commands) {
  const entries = [];
  for (const command of commands.values()) {
    const walk = (node, parts) => {
      const nested = (node.options || []).filter(option => option.type <= 2);
      if (nested.length) for (const child of nested) walk(child, [...parts, child.name]);
      else {
        const route = command.routes?.get(parts[1]);
        entries.push({ path: parts.join(' '), description: node.description, options: node.options || [],
          category: route?.category || command.category, sourceName: route?.sourceName || parts[0] });
      }
    };
    walk(command.data.toJSON(), [command.data.name]);
  }
  return entries.sort((a,b) => a.path.localeCompare(b.path));
}

module.exports = { adaptInteraction, buildGroup, commandEntries, commandNode, loadCommandRegistry, resolveInvocation };
