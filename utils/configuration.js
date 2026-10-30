const { createHash, randomUUID } = require('node:crypto');
const { all, get, run, transaction } = require('../database');
const { configurationSpecs } = require('./configurationTables');
const { validateSourceUrl } = require('./factSources');
const { ChannelType } = require('discord.js');

const MAX_BYTES = 1_000_000;
const plain = value => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;
const canonical = value => JSON.stringify(value, (_,v) => plain(v)
  ? Object.fromEntries(Object.entries(v).sort(([a],[b]) => a.localeCompare(b))) : v);

function exportConfiguration(guildId) {
  const tables = {};
  for (const spec of configurationSpecs(all)) {
    tables[spec.table] = all(`SELECT ${spec.columns.map(c => c.name).join(',')} FROM ${spec.table}
      WHERE guildId=? ORDER BY ${spec.keys.join(',')}`, [guildId]);
  }
  return { version: 1, sourceGuildId: guildId, tables };
}

function configurationHash(guildId) {
  return createHash('sha256').update(canonical(exportConfiguration(guildId))).digest('hex');
}

function rowKey(spec, row) { return spec.keys.map(key => row[key]); }
function getRow(spec, row) {
  return get(`SELECT ${spec.columns.map(c => c.name).join(',')} FROM ${spec.table}
    WHERE ${spec.keys.map(key => `${key}=?`).join(' AND ')}`, rowKey(spec,row)) || null;
}

function resourceKind(column, row) {
  if (column === 'valueId') return row.type === 'ROLE' ? 'role' : row.type === 'CATEGORY' ? 'category' : 'channel';
  if (/RoleIds?$|^roleId$/.test(column) || column === 'ignoredRoles') return 'role';
  if (/CategoryIds?$|^categoryId$/.test(column)) return 'category';
  if (/ChannelIds?$|^channelId$/.test(column) || column === 'ignoredChannels') return 'channel';
  return null;
}

function validateResource(id, kind, guild, column) {
  const resource = kind === 'role' ? guild.roles.cache.get(id) : guild.channels.cache.get(id);
  if (!resource) throw new Error(`${column}: ${id} does not exist in this server. Provide an ID mapping.`);
  if (kind === 'category' && resource.type !== ChannelType.GuildCategory) throw new Error(`${column} must reference a category.`);
  if (kind === 'channel' && resource.type === ChannelType.GuildCategory) throw new Error(`${column} cannot reference a category.`);
  if (kind === 'role' && (resource.managed || id === guild.id)) throw new Error(`${column} requires a normal server role.`);
  if (kind === 'role' && ['verifiedRoleId','unverifiedRoleId'].includes(column)) {
    const problem = require('./roleSafety').automaticRoleSafetyError(guild, resource);
    if (problem) throw new Error(`${column}: ${problem}`);
  }
}

function validateRow(spec, input, guild, mapping = {}, {partial=false} = {}) {
  if (!plain(input)) throw new Error(`${spec.table}: expected an object.`);
  const output = {};
  for (const [column, value] of Object.entries(input)) {
    const definition = spec.columns.find(c => c.name === column);
    if (!definition) throw new Error(`${spec.table}.${column} is not an importable setting.`);
    if (column === 'guildId') { output.guildId = guild.id; continue; }
    if (value !== null && (definition.type === 'INTEGER' ? !Number.isSafeInteger(value) : typeof value !== 'string')) {
      throw new Error(`${spec.table}.${column} has the wrong type.`);
    }
    if (typeof value === 'string' && value.length > 8000) throw new Error(`${column} exceeds the setting size limit.`);
    if (value === null && definition.notnull) throw new Error(`${column} cannot be null.`);
    if (/^(enabled|.*Enabled|ping|discussionEnabled)$/.test(column) && value !== null && ![0,1].includes(value)) throw new Error(`${column} must be 0 or 1.`);
    if (column === 'hour' && (value < 0 || value > 23) || column === 'minute' && (value < 0 || value > 59)) throw new Error(`Invalid ${column}.`);
    if (column === 'timezone') { try { new Intl.DateTimeFormat('en',{ timeZone: value }); } catch { throw new Error('Invalid timezone.'); } }
    if ((column.endsWith('Url') || column==='url') && value) validateSourceUrl(value);
    const kind = resourceKind(column,input);
    if (kind && value) {
      const list = /Ids$/.test(column) || column.startsWith('ignored');
      let ids = list ? require('./contentFilterWhitelist').parseIdList(value) : [value];
      ids = ids.map(id => mapping[id] || id);
      for (const id of ids) validateResource(id,kind,guild,column);
      output[column] = list ? JSON.stringify(ids) : ids[0];
    } else output[column] = value;
  }
  output.guildId = guild.id;
  if (spec.keys.some(key => output[key] === undefined || output[key] === null)) throw new Error(`${spec.table}: missing row key.`);
  validateValues(spec.table,output,{partial});
  if(spec.table==='leveling_rewards' && output.roleId) {
    const problem=require('./roleSafety').automaticRoleSafetyError(guild,guild.roles.cache.get(output.roleId));
    if(problem) throw new Error(problem);
  }
  return output;
}

function validateValues(table,row,{partial=false}={}) {
  const ranges={hour:[0,23],minute:[0,59],dayOfWeek:[0,6],color:[0,0xFFFFFF],weight:[1,100],
    xpMin:[1,1000],xpMax:[1,1000],cooldown:[0,86400],minimumAccountAgeDays:[0,365],userLimit:[0,99],
    maxMessages:[2,25],intervalSeconds:[2,120],duplicateLimit:[2,10],duplicateWindowSeconds:[5,600],
    mentionLimit:[0,50],timeoutSeconds:[0,2419200]};
  for(const [key,[min,max]]of Object.entries(ranges)) if(row[key]!==undefined && row[key]!==null &&
    (row[key]<min || row[key]>max)) throw new Error(`${table}.${key} must be between ${min} and ${max}.`);
  if(row.xpMin!==undefined && row.xpMax!==undefined && row.xpMax<row.xpMin) throw new Error('Maximum XP cannot be below minimum XP.');
  for(const [key,limit]of Object.entries({title:256,titlePrefix:120,description:4096,footer:2048,buttonLabel:80,customMessage:4000,levelMessage:2000})) {
    if(typeof row[key]==='string' && row[key].length>limit) throw new Error(`${table}.${key} exceeds ${limit} characters.`);
  }
  const enums={censorMatchMode:['STRICT','FLEXIBLE','AGGRESSIVE'],censorAction:['DELETE','DELETE_WARN','TIMEOUT'],
    style:['DEFAULT','BRANDED','COMPACT'],steamCountry:['GB','US','CA','AU','DE']};
  for(const [key,values]of Object.entries(enums)) if(row[key]!=null && !values.includes(row[key])) throw new Error(`Invalid ${table}.${key}.`);
  if(table==='ticket_settings' && !Object.hasOwn(require('./tickets/ticketTypes'),row.type)) throw new Error('Unknown ticket type.');
  if(table==='dailyfact_config' && row.category!=null && row.category!=='random' && !require('./dailyFacts').isRealCategory(row.category)) throw new Error('Unknown Daily Fact category.');
  if(['command_control_bypasses','antispam_bypasses'].includes(table) && !['ROLE','CHANNEL','CATEGORY'].includes(row.type)) throw new Error('Invalid bypass type.');
  if(!partial && row.enabled===1 && ['dailyfact_config','daily_interaction_config','free_game_settings','verification_settings','staff_rota_settings'].includes(table) && !row.channelId) throw new Error(`${table} needs a channel before it can be enabled.`);
  if(!partial && table==='verification_settings' && row.enabled===1 && !row.verifiedRoleId) throw new Error('Verification requires a verified role.');
}

function makePlan(guildId, actorId, operations) {
  if (!operations.length) throw new Error('No configuration changes are needed.');
  const id = randomUUID();
  const now = Date.now();
  run('DELETE FROM configuration_plans WHERE expiresAt<?',[now-86_400_000]);
  run(`INSERT INTO configuration_plans(id,guildId,actorId,baseHash,operationsJson,createdAt,expiresAt)
    VALUES(?,?,?,?,?,?,?)`,[id,guildId,actorId,configurationHash(guildId),JSON.stringify(operations),now,now+15*60_000]);
  return { id, operations, expiresAt: now+15*60_000 };
}

function planImport(document, guild, actorId, mapping = {}) {
  if (!plain(document) || document.version !== 1 || !plain(document.tables) || !plain(mapping)) throw new Error('Invalid configuration or mapping format.');
  if (Buffer.byteLength(JSON.stringify(document)) > MAX_BYTES) throw new Error('Configuration exceeds 1 MB.');
  if (Object.keys(document).some(key => !['version','sourceGuildId','tables'].includes(key))) throw new Error('Unknown configuration fields.');
  const specs = configurationSpecs(all);
  const operations = [];
  const seen = new Set();
  let count = 0;
  for (const [table,rows] of Object.entries(document.tables)) {
    const spec = specs.find(s => s.table === table);
    if (!spec || !Array.isArray(rows)) throw new Error(`Unknown configuration section: ${table}.`);
    for (const input of rows) {
      if (++count > 2000) throw new Error('Import exceeds 2,000 settings rows.');
      const validated = validateRow(spec,input,guild,mapping,{partial:true});
      const key = `${table}:${canonical(rowKey(spec,validated))}`;
      if (seen.has(key)) throw new Error('Duplicate configuration row.');
      seen.add(key);
      const before = getRow(spec,validated);
      const defaults=before ? null : get(`SELECT ${spec.columns.map(column=>`${column.dflt_value||'NULL'} AS ${column.name}`).join(',')}`);
      const after = validateRow(spec,{ ...defaults, ...before, ...validated },guild);
      if (canonical(before) !== canonical(after)) operations.push({ table,before,after });
    }
  }
  return makePlan(guild.id,actorId,operations);
}

function planRollback(revisionId, guild, actorId) {
  const rows = all('SELECT * FROM configuration_changes WHERE guildId=? AND revisionId=? ORDER BY id',[guild.id,revisionId]);
  if (!rows.length) throw new Error('Revision not found in this server.');
  const merged = new Map();
  const specs = configurationSpecs(all);
  for (const row of rows) {
    const spec = specs.find(s => s.table === row.tableName);
    if (!spec) throw new Error('This historical section is no longer importable.');
    const before = JSON.parse(row.beforeJson);
    const after = JSON.parse(row.afterJson);
    const key = `${spec.table}:${canonical(rowKey(spec,after||before))}`;
    const existing = merged.get(key);
    merged.set(key,{ table:spec.table, before:existing ? existing.before : before, after });
  }
  const operations = [];
  for (const change of merged.values()) {
    const spec = specs.find(s => s.table === change.table);
    const current = getRow(spec,change.after||change.before);
    let restore=change.before;
    if (change.before && change.after && current) {
      const changed=spec.columns.map(c=>c.name).filter(key=>canonical(change.before[key])!==canonical(change.after[key]));
      if (changed.some(key=>canonical(current[key])!==canonical(change.after[key]))) throw new Error('A setting changed after this revision. Restore newer revisions first.');
      restore={...current,...Object.fromEntries(changed.map(key=>[key,change.before[key]]))};
    } else if (canonical(current)!==canonical(change.after)) throw new Error('A setting changed after this revision. Restore newer revisions first.');
    if (restore) validateRow(spec,restore,guild);
    if (canonical(current)!==canonical(restore)) operations.push({ table:change.table,before:current,after:restore });
  }
  return makePlan(guild.id,actorId,operations);
}

function applyPlan(id, guild, actorId) {
  return transaction(() => {
    const plan = get('SELECT * FROM configuration_plans WHERE id=? AND guildId=? AND actorId=?',[id,guild.id,actorId]);
    if (!plan || plan.appliedAt || plan.expiresAt < Date.now()) throw new Error('This preview expired, was applied, or belongs to another administrator.');
    if (plan.baseHash !== configurationHash(guild.id)) throw new Error('Configuration changed after the preview. Generate a fresh preview.');
    const specs = configurationSpecs(all);
    const operations = JSON.parse(plan.operationsJson);
    for (const { table,before,after } of operations) {
      const spec = specs.find(s => s.table === table);
      if (!spec) throw new Error('Configuration format changed. Generate a fresh preview.');
      if (after) {
        const row = validateRow(spec,after,guild);
        const insert = { ...row };
        for (const column of spec.schema) {
          if (column.name === 'updatedBy' || column.name === 'addedBy') insert[column.name] = actorId;
          if (column.name === 'updatedAt' || column.name === 'addedAt') insert[column.name] = Date.now();
          if (column.notnull && column.dflt_value === null && insert[column.name] === undefined) throw new Error(`${table}: required non-configuration field ${column.name} cannot be imported.`);
        }
        const columns = Object.keys(insert);
        const updates = columns.filter(column => !spec.keys.includes(column));
        run(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})
          ON CONFLICT(${spec.keys.join(',')}) DO ${updates.length ? `UPDATE SET ${updates.map(c=>`${c}=excluded.${c}`).join(',')}` : 'NOTHING'}`,Object.values(insert));
      } else run(`DELETE FROM ${table} WHERE ${spec.keys.map(key=>`${key}=?`).join(' AND ')}`,rowKey(spec,before));
    }
    run('UPDATE configuration_plans SET appliedAt=? WHERE id=?',[Date.now(),id]);
    return operations.length;
  });
}

function history(guildId, limit=15) {
  return all(`SELECT revisionId,actorId,MAX(changedAt) AS changedAt,COUNT(*) AS changes
    FROM configuration_changes WHERE guildId=? GROUP BY revisionId ORDER BY MAX(id) DESC LIMIT ?`,[guildId,limit]);
}

module.exports = { MAX_BYTES, applyPlan, exportConfiguration, history, planImport, planRollback, validateRow };
