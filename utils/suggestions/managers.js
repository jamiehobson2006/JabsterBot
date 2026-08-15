const {
  all,
  run
} = require('../../database');

function listSuggestionManagerRoles(guildId) {

  return all(
    `SELECT roleId, addedBy, addedAt
     FROM suggestion_manager_roles
     WHERE guildId = ?
     ORDER BY addedAt ASC`,
    [guildId]
  );
}

function addSuggestionManagerRole({
  guildId,
  roleId,
  addedBy
}) {

  return run(
    `INSERT OR IGNORE INTO suggestion_manager_roles (
       guildId,
       roleId,
       addedBy,
       addedAt
     )
     VALUES (?, ?, ?, ?)`,
    [guildId, roleId, addedBy, Date.now()]
  );
}

function removeSuggestionManagerRole({
  guildId,
  roleId
}) {

  return run(
    `DELETE FROM suggestion_manager_roles
     WHERE guildId = ?
     AND roleId = ?`,
    [guildId, roleId]
  );
}

function memberCanManageSuggestions(
  member,
  guildId
) {

  if (!member?.roles?.cache) {

    return false;
  }

  return listSuggestionManagerRoles(guildId)
    .some(manager =>
      member.roles.cache.has(manager.roleId)
    );
}

module.exports = {
  addSuggestionManagerRole,
  listSuggestionManagerRoles,
  memberCanManageSuggestions,
  removeSuggestionManagerRole
};
