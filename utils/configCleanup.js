const { all, db, get, run } = require('../database');
const { parseIdList, serializeIdList } = require('./contentFilterWhitelist');

function removeFromGuildLists(guildId, id, columns) {
  const row = get(
    `SELECT ${columns.join(', ')} FROM guild_settings WHERE guildId = ?`,
    [guildId]
  );
  if (!row) return;

  for (const column of columns) {
    const current = parseIdList(row[column]);
    const next = current.filter(value => value !== id);
    if (next.length !== current.length) {
      run(`UPDATE guild_settings SET ${column} = ? WHERE guildId = ?`, [serializeIdList(next), guildId]);
    }
  }
}

function cleanupDeletedChannel(channel) {
  const guildId = channel.guild.id;
  const channelId = channel.id;
  const cleanup = db.transaction(() => {
    const guildChannelColumns = [
      'modlogChannelId', 'suggestionChannelId', 'acceptedSuggestionChannelId',
      'deniedSuggestionChannelId', 'transcriptChannelId', 'applicationTranscriptChannelId',
      'ticketFeedbackChannelId', 'staffListChannelId', 'inviteChannelId',
      'giveawayChannelId', 'messageLogChannelId', 'commandLogChannelId',
      'memberLogChannelId', 'serverLogChannelId', 'voiceLogChannelId',
      'ticketLogChannelId', 'suggestionLogChannelId', 'reactionLogChannelId',
      'supportCategoryId', 'applicationCategoryId', 'giveawayCategoryId', 'bugCategoryId'
    ];

    for (const column of guildChannelColumns) {
      run(
        `UPDATE guild_settings
         SET ${column} = NULL${column === 'staffListChannelId' ? ', staffListMessageId = NULL' : ''}
         WHERE guildId = ? AND ${column} = ?`,
        [guildId, channelId]
      );
    }
    removeFromGuildLists(guildId, channelId, [
      'linkBypassChannelIds', 'linkBypassCategoryIds',
      'censorBypassChannelIds', 'censorBypassCategoryIds'
    ]);

    run(`DELETE FROM log_settings WHERE guildId = ? AND channelId = ?`, [guildId, channelId]);
    run(
      `UPDATE ticket_settings SET enabled = 0, categoryId = NULL
       WHERE guildId = ? AND categoryId = ?`,
      [guildId, channelId]
    );
    run(`DELETE FROM ticket_staff WHERE guildId = ? AND channelId = ?`, [guildId, channelId]);
    run(`DELETE FROM ticket_guests WHERE guildId = ? AND channelId = ?`, [guildId, channelId]);
    run(`DELETE FROM ticket_sla_alerts WHERE guildId = ? AND channelId = ?`, [guildId, channelId]);
    run(
      `UPDATE tickets SET status = 'DELETED', deletedAt = COALESCE(deletedAt, ?), deleteAfter = NULL
       WHERE guildId = ? AND channelId = ? AND UPPER(status) <> 'DELETED'`,
      [Date.now(), guildId, channelId]
    );
    run(
      `UPDATE ticket_sla_settings SET enabled = 0, alertChannelId = NULL
       WHERE guildId = ? AND alertChannelId = ?`,
      [guildId, channelId]
    );
    run(`DELETE FROM ticket_targets WHERE guildId = ? AND alertChannelId = ?`, [guildId, channelId]);
    run(
      `UPDATE verification_settings SET enabled = 0, channelId = NULL, messageId = NULL
       WHERE guildId = ? AND channelId = ?`,
      [guildId, channelId]
    );

    const panels = all(
      `SELECT messageId FROM reaction_role_panels WHERE guildId = ? AND channelId = ?`,
      [guildId, channelId]
    );
    for (const panel of panels) {
      run(`DELETE FROM reaction_role_mappings WHERE messageId = ?`, [panel.messageId]);
    }
    run(`DELETE FROM reaction_role_panels WHERE guildId = ? AND channelId = ?`, [guildId, channelId]);

    run(
      `UPDATE greeting_settings SET enabled = 0, channelId = NULL
       WHERE guildId = ? AND channelId = ?`,
      [guildId, channelId]
    );
    run(
      `UPDATE temp_voice_settings
       SET enabled = CASE WHEN lobbyChannelId = ? THEN 0 ELSE enabled END,
           lobbyChannelId = CASE WHEN lobbyChannelId = ? THEN NULL ELSE lobbyChannelId END,
           categoryId = CASE WHEN categoryId = ? THEN NULL ELSE categoryId END
       WHERE guildId = ?`,
      [channelId, channelId, channelId, guildId]
    );
    run(`DELETE FROM temp_voice_rooms WHERE channelId = ?`, [channelId]);
    run(
      `UPDATE changelog_settings
       SET publishChannelId = CASE WHEN publishChannelId = ? THEN NULL ELSE publishChannelId END,
           reviewChannelId = CASE WHEN reviewChannelId = ? THEN NULL ELSE reviewChannelId END
       WHERE guildId = ?`,
      [channelId, channelId, guildId]
    );
    run(`DELETE FROM social_channels WHERE guildId = ? AND targetChannelId = ?`, [guildId, channelId]);
    run(
      `UPDATE free_game_settings SET enabled = 0, channelId = NULL
       WHERE guildId = ? AND channelId = ?`,
      [guildId, channelId]
    );
    run(
      `UPDATE daily_interaction_config SET enabled = 0, channelId = NULL
       WHERE guildId = ? AND channelId = ?`,
      [guildId, channelId]
    );
    run(
      `UPDATE leveling_config SET levelChannelId = NULL
       WHERE guildId = ? AND levelChannelId = ?`,
      [guildId, channelId]
    );
    run(
      `UPDATE dailyfact_config SET enabled = 0, channelId = NULL
       WHERE guildId = ? AND channelId = ?`,
      [guildId, channelId]
    );
    run(
      `UPDATE phishing_settings SET alertChannelId = NULL
       WHERE guildId = ? AND alertChannelId = ?`,
      [guildId, channelId]
    );
    run(
      `UPDATE modmail_settings
       SET enabled = CASE WHEN categoryId = ? THEN 0 ELSE enabled END,
           categoryId = CASE WHEN categoryId = ? THEN NULL ELSE categoryId END,
           logChannelId = CASE WHEN logChannelId = ? THEN NULL ELSE logChannelId END
       WHERE guildId = ?`,
      [channelId, channelId, channelId, guildId]
    );
    run(
      `UPDATE modmail_threads
       SET status = 'CLOSED', closedAt = COALESCE(closedAt, ?), closeReason = COALESCE(closeReason, 'Channel deleted')
       WHERE guildId = ? AND channelId = ? AND status = 'OPEN'`,
      [Date.now(), guildId, channelId]
    );
    run(
      `UPDATE staff_rota_settings SET enabled = 0, channelId = NULL, messageId = NULL
       WHERE guildId = ? AND channelId = ?`,
      [guildId, channelId]
    );
  });

  cleanup();
}

function cleanupDeletedRole(role) {
  const guildId = role.guild.id;
  const roleId = role.id;
  const cleanup = db.transaction(() => {
    for (const column of [
      'staffListRoleId', 'applicationCreatorRoleId', 'staffRoleId',
      'adminRoleId', 'giveawayRoleId', 'linkBypassRoleId', 'censorRoleId'
    ]) {
      run(`UPDATE guild_settings SET ${column} = NULL WHERE guildId = ? AND ${column} = ?`, [guildId, roleId]);
    }
    removeFromGuildLists(guildId, roleId, ['linkBypassRoleIds', 'censorBypassRoleIds']);

    run(`DELETE FROM self_roles WHERE guildId = ? AND roleId = ?`, [guildId, roleId]);
    run(`DELETE FROM logging_manager_roles WHERE guildId = ? AND roleId = ?`, [guildId, roleId]);
    run(
      `UPDATE ticket_settings SET enabled = 0, roleId = NULL
       WHERE guildId = ? AND roleId = ?`,
      [guildId, roleId]
    );
    run(`DELETE FROM suggestion_manager_roles WHERE guildId = ? AND roleId = ?`, [guildId, roleId]);
    run(
      `UPDATE verification_settings
       SET enabled = 0,
           verifiedRoleId = CASE WHEN verifiedRoleId = ? THEN NULL ELSE verifiedRoleId END,
           unverifiedRoleId = CASE WHEN unverifiedRoleId = ? THEN NULL ELSE unverifiedRoleId END
       WHERE guildId = ? AND (verifiedRoleId = ? OR unverifiedRoleId = ?)`,
      [roleId, roleId, guildId, roleId, roleId]
    );
    run(
      `DELETE FROM reaction_role_mappings
       WHERE roleId = ?
         AND messageId IN (
           SELECT messageId FROM reaction_role_panels WHERE guildId = ?
         )`,
      [roleId, guildId]
    );
    run(
      `UPDATE antispam_settings SET managerRoleId = NULL
       WHERE guildId = ? AND managerRoleId = ?`,
      [guildId, roleId]
    );
    run(`DELETE FROM antispam_bypasses WHERE guildId = ? AND type = 'ROLE' AND valueId = ?`, [guildId, roleId]);
    run(`UPDATE ticket_sla_settings SET pingRoleId = NULL WHERE guildId = ? AND pingRoleId = ?`, [guildId, roleId]);
    run(`UPDATE ticket_targets SET alertRoleId = NULL WHERE guildId = ? AND alertRoleId = ?`, [guildId, roleId]);
    run(`UPDATE changelog_settings SET reviewerRoleId = NULL WHERE guildId = ? AND reviewerRoleId = ?`, [guildId, roleId]);
    run(`UPDATE social_channels SET pingRoleId = NULL WHERE guildId = ? AND pingRoleId = ?`, [guildId, roleId]);
    run(`UPDATE free_game_settings SET pingRoleId = NULL WHERE guildId = ? AND pingRoleId = ?`, [guildId, roleId]);
    run(`UPDATE daily_interaction_config SET pingRoleId = NULL WHERE guildId = ? AND pingRoleId = ?`, [guildId, roleId]);
    run(`DELETE FROM leveling_rewards WHERE guildId = ? AND roleId = ?`, [guildId, roleId]);
    run(
      `UPDATE leveling_reward_grants SET status = 'CANCELLED', lastError = 'Reward role deleted'
       WHERE guildId = ? AND roleId = ? AND status = 'PENDING'`,
      [guildId, roleId]
    );
    run(`UPDATE application_forms SET reviewerRoleId = NULL WHERE guildId = ? AND reviewerRoleId = ?`, [guildId, roleId]);
    run(
      `UPDATE modmail_settings SET enabled = 0, staffRoleId = NULL
       WHERE guildId = ? AND staffRoleId = ?`,
      [guildId, roleId]
    );
    run(
      `UPDATE staff_rota_settings SET enabled = 0, staffRoleId = NULL, messageId = NULL
       WHERE guildId = ? AND staffRoleId = ?`,
      [guildId, roleId]
    );
  });

  cleanup();
}

module.exports = {
  cleanupDeletedChannel,
  cleanupDeletedRole
};
