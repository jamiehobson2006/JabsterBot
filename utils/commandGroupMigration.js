const { LEGACY_PATHS } = require('./commandLayout');

function migrateCommandGroups(run, all, get) {
  run('CREATE TABLE IF NOT EXISTS command_group_migrations(version INTEGER PRIMARY KEY,appliedAt INTEGER NOT NULL)');
  if (get('SELECT 1 FROM command_group_migrations WHERE version=1')) return;
  for (const [source, destination] of Object.entries(LEGACY_PATHS)) {
    const controls = all('SELECT * FROM command_controls WHERE commandName=?', [source]);
    const bypasses = all('SELECT * FROM command_control_bypasses WHERE commandName=?', [source]);
    const guildIds = new Set([...controls, ...bypasses].map(row => row.guildId));
    for (const guildId of guildIds) {
      const before = controls.find(row => row.guildId === guildId);
      const target = get('SELECT * FROM command_controls WHERE guildId=? AND commandName=?', [guildId,destination]);
      const collision = Boolean(target || get('SELECT 1 FROM command_control_bypasses WHERE guildId=? AND commandName=?', [guildId,destination]));
      if (before) run(`INSERT INTO command_controls(guildId,commandName,enabled,reason,updatedBy,updatedAt) VALUES(?,?,?,?,?,?)
        ON CONFLICT(guildId,commandName) DO UPDATE SET enabled=MIN(command_controls.enabled,excluded.enabled),
        reason=COALESCE(command_controls.reason,excluded.reason)`,
      [guildId,destination,before.enabled,before.reason,before.updatedBy,before.updatedAt]);
      if (collision) {
        // Conflicting allowlists cannot safely be merged with OR semantics.
        run('DELETE FROM command_control_bypasses WHERE guildId=? AND commandName=?', [guildId,destination]);
        console.warn(`Command-control migration kept the stricter restriction for /${destination}; review its bypass list.`);
      } else for (const bypass of bypasses.filter(row => row.guildId === guildId)) {
        run(`INSERT OR IGNORE INTO command_control_bypasses(guildId,commandName,type,valueId,addedBy,addedAt) VALUES(?,?,?,?,?,?)`,
          [guildId,destination,bypass.type,bypass.valueId,bypass.addedBy,bypass.addedAt]);
      }
      run('DELETE FROM command_control_bypasses WHERE guildId=? AND commandName=?', [guildId,source]);
      run('DELETE FROM command_controls WHERE guildId=? AND commandName=?', [guildId,source]);
    }
  }
  // Pre-grouping previews use old command-control keys and must be regenerated.
  run('DELETE FROM configuration_plans WHERE appliedAt IS NULL');
  run('INSERT INTO command_group_migrations VALUES(1,?)', [Date.now()]);
}

module.exports = { migrateCommandGroups };
