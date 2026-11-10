const {
  all,
  get,
  run
} = require('../database');

const BYPASS_TYPES = new Set([
  'ROLE',
  'CHANNEL',
  'CATEGORY'
]);

function normalizeCommandName(value) {
  return require('./commandLayout').normalizePath(value);
}

function interactionCommandPath(interaction) {
  const root = normalizeCommandName(interaction.commandName);
  if (root.includes(' ')) return root;
  let group = null, subcommand = null;
  try { group = interaction.options?.getSubcommandGroup?.(false); } catch {}
  try { subcommand = interaction.options?.getSubcommand?.(false); } catch {}
  return [root,group,subcommand].filter(Boolean).join(' ');
}

function getCommandControl(guildId, commandName) {
  return get(
    `SELECT *
     FROM command_controls
     WHERE guildId = ?
     AND commandName = ?`,
    [guildId, normalizeCommandName(commandName)]
  );
}

function listCommandControls(guildId) {
  return all(
    `SELECT *
     FROM command_controls
     WHERE guildId = ?
     ORDER BY enabled ASC, commandName ASC`,
    [guildId]
  );
}

function setCommandEnabled({
  guildId,
  commandName,
  enabled,
  reason = null,
  updatedBy
}) {
  const name = normalizeCommandName(commandName);

  return run(
    `INSERT INTO command_controls (
       guildId,
       commandName,
       enabled,
       reason,
       updatedBy,
       updatedAt
     )
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(guildId, commandName)
     DO UPDATE SET enabled = excluded.enabled,
                   reason = excluded.reason,
                   updatedBy = excluded.updatedBy,
                   updatedAt = excluded.updatedAt`,
    [
      guildId,
      name,
      enabled ? 1 : 0,
      reason || null,
      updatedBy,
      Date.now()
    ]
  );
}

function resetCommandControl(guildId, commandName) {
  const name = normalizeCommandName(commandName);

  run(
    `DELETE FROM command_control_bypasses
     WHERE guildId = ?
     AND commandName = ?`,
    [guildId, name]
  );

  return run(
    `DELETE FROM command_controls
     WHERE guildId = ?
     AND commandName = ?`,
    [guildId, name]
  );
}

function listCommandBypasses(guildId, commandName, type = null) {
  const name = normalizeCommandName(commandName);

  if (type) {
    return all(
      `SELECT *
       FROM command_control_bypasses
       WHERE guildId = ?
       AND commandName = ?
       AND type = ?
       ORDER BY addedAt ASC`,
      [guildId, name, type]
    );
  }

  return all(
    `SELECT *
     FROM command_control_bypasses
     WHERE guildId = ?
     AND commandName = ?
     ORDER BY type ASC, addedAt ASC`,
    [guildId, name]
  );
}

function addCommandBypass({
  guildId,
  commandName,
  type,
  valueId,
  addedBy
}) {
  const normalizedType = String(type || '').toUpperCase();

  if (!BYPASS_TYPES.has(normalizedType)) {
    throw new Error('Invalid command bypass type.');
  }

  return run(
    `INSERT OR IGNORE INTO command_control_bypasses (
       guildId,
       commandName,
       type,
       valueId,
       addedBy,
       addedAt
     )
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      guildId,
      normalizeCommandName(commandName),
      normalizedType,
      valueId,
      addedBy,
      Date.now()
    ]
  );
}

function removeCommandBypass({
  guildId,
  commandName,
  type,
  valueId
}) {
  return run(
    `DELETE FROM command_control_bypasses
     WHERE guildId = ?
     AND commandName = ?
     AND type = ?
     AND valueId = ?`,
    [
      guildId,
      normalizeCommandName(commandName),
      String(type || '').toUpperCase(),
      valueId
    ]
  );
}

function hasCommandBypass(interaction, commandName) {
  const bypasses = listCommandBypasses(
    interaction.guild.id,
    commandName
  );

  return bypasses.some(bypass => {
    if (bypass.type === 'ROLE') {
      return interaction.member?.roles?.cache?.has(bypass.valueId);
    }

    if (bypass.type === 'CHANNEL') {
      return interaction.channelId === bypass.valueId;
    }

    return interaction.channel?.parentId === bypass.valueId;
  });
}

function getCommandAvailability(interaction) {
  const commandName = interactionCommandPath(interaction);

  if (commandName.split(' ')[0] === 'commandcontrol') {
    return { allowed: true, reason: null };
  }

  const parts = commandName.split(' ');
  for (let length = 1; length <= parts.length; length++) {
    const scope = parts.slice(0,length).join(' ');
    const control = getCommandControl(interaction.guild.id,scope);
    if (control && Number(control.enabled) !== 1 && !hasCommandBypass(interaction,scope)) {
      return { allowed: false, reason: control.reason || null };
    }
  }
  return { allowed: true, reason: null };
}

module.exports = {
  BYPASS_TYPES,
  addCommandBypass,
  getCommandAvailability,
  getCommandControl,
  interactionCommandPath,
  hasCommandBypass,
  listCommandBypasses,
  listCommandControls,
  normalizeCommandName,
  removeCommandBypass,
  resetCommandControl,
  setCommandEnabled
};
