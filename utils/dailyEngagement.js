const crypto = require('node:crypto');
const { all, get, run, transaction } = require('../database');
const { automaticRoleSafetyError } = require('./roleSafety');
const { PermissionFlagsBits } = require('discord.js');

function rewardRoleError(guild, role) {
  const base = automaticRoleSafetyError(guild, role);
  if (base) return base;
  const extra = ['ManageMessages', 'ManageThreads', 'ManageNicknames', 'ManageEvents',
    'ManageGuildExpressions', 'ViewAuditLog', 'MuteMembers', 'DeafenMembers', 'MoveMembers'];
  return extra.some(name => PermissionFlagsBits[name] && role.permissions.has(PermissionFlagsBits[name]))
    ? 'Roles with staff permissions cannot be milestone rewards.' : null;
}

function engagementSettings(guildId) {
  run('INSERT OR IGNORE INTO daily_engagement_settings (guildId) VALUES (?)', [guildId]);
  const settings = get('SELECT * FROM daily_engagement_settings WHERE guildId = ?', [guildId]);
  run(`INSERT OR IGNORE INTO daily_seasons (guildId, seasonId, name, startedAt) VALUES (?, ?, ?, ?)`,
    [guildId, settings.seasonId, settings.seasonName, settings.seasonStartedAt]);
  return settings;
}

function isQuietDay(guildId, now = Date.now()) {
  const settings = engagementSettings(guildId);
  const config = get('SELECT timezone FROM daily_interaction_config WHERE guildId = ?', [guildId]);
  const local = require('../services/DailyInteractionService').getDateParts(new Date(now), config?.timezone);
  return JSON.parse(settings.quietDays).includes(local.dayOfWeek);
}

function configureEngagement(guildId, values) {
  engagementSettings(guildId);
  const rules = { remindersEnabled: [0, 1], reminderDelayMinutes: [5, 1380], dailyPointCap: [1, 100], triviaMinutes: [1, 1440] };
  const entries = Object.entries(values);
  if (!entries.length || entries.some(([name, value]) => !rules[name] || !Number.isInteger(value) ||
      value < rules[name][0] || value > rules[name][1])) throw new Error('Invalid daily engagement setting.');
  run(`UPDATE daily_engagement_settings SET ${entries.map(([name]) => `${name} = ?`).join(', ')} WHERE guildId = ?`,
    [...entries.map(([, value]) => value), guildId]);
  return engagementSettings(guildId);
}

function setQuietDay(guildId, day, quiet) {
  if (!Number.isInteger(day) || day < 0 || day > 6) throw new Error('Choose a valid weekday.');
  const days = new Set(JSON.parse(engagementSettings(guildId).quietDays));
  if (quiet) days.add(day); else days.delete(day);
  run('UPDATE daily_engagement_settings SET quietDays = ? WHERE guildId = ?', [JSON.stringify([...days].sort()), guildId]);
}

function startSeason(guildId, name, now = Date.now()) {
  const validation = require('./dailyInteractionSafety').validateDailyInteractionContent({ answer: name, maxLength: 60 });
  if (!validation.valid) throw new Error(validation.message);
  const id = crypto.randomUUID();
  transaction(() => {
    const current = engagementSettings(guildId);
    run('UPDATE daily_seasons SET endedAt = ? WHERE guildId = ? AND seasonId = ?', [now, guildId, current.seasonId]);
    run('INSERT INTO daily_seasons (guildId, seasonId, name, startedAt) VALUES (?, ?, ?, ?)', [guildId, id, validation.answer, now]);
    run('UPDATE daily_engagement_settings SET seasonId = ?, seasonName = ?, seasonStartedAt = ? WHERE guildId = ?',
      [id, validation.answer, now, guildId]);
    run(`UPDATE daily_role_grants SET status = 'CANCELLED' WHERE guildId = ? AND status = 'PENDING'`, [guildId]);
  });
  return id;
}

function seasonLeaderboard(guildId, seasonId = engagementSettings(guildId).seasonId) {
  return all(`SELECT userId, SUM(points) AS points FROM daily_point_events WHERE guildId = ? AND seasonId = ?
    GROUP BY userId HAVING SUM(points) > 0 ORDER BY points DESC, userId LIMIT 20`, [guildId, seasonId]);
}

function activeDayGap(guildId, previous, current) {
  if (!previous || !current) return null;
  const start = Date.parse(`${previous}T00:00:00Z`);
  const end = Date.parse(`${current}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const distance = Math.round((end - start) / 86_400_000);
  if (distance <= 0) return distance;
  const quietDays = new Set(JSON.parse(get('SELECT quietDays FROM daily_engagement_settings WHERE guildId = ?', [guildId])?.quietDays || '[]'));
  let active = Math.floor(distance / 7) * (7 - quietDays.size);
  const startDay = new Date(start).getUTCDay();
  for (let index = 1; index <= distance % 7; index++) if (!quietDays.has((startDay + index) % 7)) active++;
  return active;
}

function queueMilestoneRoles(guildId, userId, seasonId) {
  run(`INSERT OR IGNORE INTO daily_role_grants (guildId, userId, roleId, seasonId)
    SELECT guildId, ?, roleId, ? FROM daily_milestone_roles WHERE guildId = ? AND points <=
      (SELECT COALESCE(SUM(points), 0) FROM daily_point_events WHERE guildId = ? AND userId = ? AND seasonId = ?)`,
  [userId, seasonId, guildId, guildId, userId, seasonId]);
}

function creditParticipation({ guildId, userId, messageId, dateKey, joined, responded, now = Date.now() }) {
  if (!messageId || !dateKey) return;
  return transaction(() => {
    const settings = engagementSettings(guildId);
    for (const [kind, requested] of [['JOIN', joined ? 1 : 0], ['ANSWER', responded ? 2 : 0]]) {
      if (!requested) continue;
      const spent = get(`SELECT COALESCE(SUM(points), 0) AS points FROM daily_point_events
        WHERE guildId = ? AND userId = ? AND dateKey = ?`, [guildId, userId, dateKey]).points;
      const points = Math.min(requested, Math.max(0, settings.dailyPointCap - spent));
      run(`INSERT OR IGNORE INTO daily_point_events
        (guildId, userId, seasonId, dateKey, messageId, kind, points, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [guildId, userId, settings.seasonId, dateKey, messageId, kind, points, now]);
    }
    queueMilestoneRoles(guildId, userId, settings.seasonId);
  });
}

function setReminderPreference(guildId, userId, enabled) {
  run(`INSERT INTO daily_member_preferences (guildId, userId, reminders) VALUES (?, ?, ?)
    ON CONFLICT(guildId, userId) DO UPDATE SET reminders = excluded.reminders`, [guildId, userId, enabled ? 1 : 0]);
  if (!enabled) run(`UPDATE delivery_outbox SET status = 'CANCELLED', finalizedAt = ?
    WHERE guildId = ? AND type = 'DAILY_REMINDER' AND status IN ('PENDING', 'FAILED')
    AND json_extract(payload, '$.daily.userId') = ?`, [Date.now(), guildId, userId]);
}

function addMilestone(guild, role, points, actor) {
  const error = rewardRoleError(guild, role);
  if (error) throw new Error(error);
  if (actor?.id !== guild.ownerId && !actor?.roles?.highest) throw new Error('Could not verify your highest role.');
  if (actor?.id !== guild.ownerId && role.position >= actor?.roles.highest.position) {
    throw new Error('Choose a reward role below your highest role.');
  }
  if (!Number.isInteger(points) || points < 1 || points > 100000) throw new Error('Choose a point threshold from 1 to 100000.');
  run(`INSERT INTO daily_milestone_roles (guildId, roleId, points) VALUES (?, ?, ?)
    ON CONFLICT(guildId, roleId) DO UPDATE SET points = excluded.points`, [guild.id, role.id, points]);
  const settings = engagementSettings(guild.id);
  run(`DELETE FROM daily_role_grants WHERE guildId = ? AND roleId = ? AND status != 'GRANTED'`, [guild.id, role.id]);
  for (const row of all(`SELECT DISTINCT userId FROM daily_point_events WHERE guildId = ? AND seasonId = ?`,
    [guild.id, settings.seasonId])) queueMilestoneRoles(guild.id, row.userId, settings.seasonId);
}

function removeMilestone(guildId, roleId) {
  run('DELETE FROM daily_milestone_roles WHERE guildId = ? AND roleId = ?', [guildId, roleId]);
  run(`UPDATE daily_role_grants SET status = 'CANCELLED' WHERE guildId = ? AND roleId = ? AND status = 'PENDING'`, [guildId, roleId]);
}

async function applyMilestones(client, now = Date.now()) {
  for (const grant of all(`SELECT * FROM daily_role_grants WHERE status = 'PENDING' AND nextAttemptAt <= ? LIMIT 50`, [now])) {
    try {
      const guild = client.guilds.cache.get(grant.guildId);
      if (!guild) {
        run(`UPDATE daily_role_grants SET nextAttemptAt = ? WHERE guildId = ? AND userId = ? AND roleId = ? AND seasonId = ?`,
          [now + 3600_000, grant.guildId, grant.userId, grant.roleId, grant.seasonId]);
        continue;
      }
      await guild.members.fetchMe?.();
      const settings = engagementSettings(guild.id);
      const reward = get('SELECT points FROM daily_milestone_roles WHERE guildId = ? AND roleId = ?', [guild.id, grant.roleId]);
      const score = get(`SELECT COALESCE(SUM(points), 0) AS points FROM daily_point_events
        WHERE guildId = ? AND userId = ? AND seasonId = ?`, [guild.id, grant.userId, settings.seasonId]).points;
      let role = await guild.roles.fetch(grant.roleId, { force: true });
      const unsafe = rewardRoleError(guild, role);
      if (!reward || score < reward.points || settings.seasonId !== grant.seasonId || unsafe) {
        run(`UPDATE daily_role_grants SET status = 'CANCELLED', lastError = ? WHERE guildId = ? AND userId = ? AND roleId = ? AND seasonId = ?`,
          [unsafe || 'Reward configuration changed.', guild.id, grant.userId, grant.roleId, grant.seasonId]);
        continue;
      }
      const member = await guild.members.fetch(grant.userId);
      role = await guild.roles.fetch(grant.roleId, { force: true });
      const currentGrant = get(`SELECT status FROM daily_role_grants WHERE guildId = ? AND userId = ? AND roleId = ? AND seasonId = ?`,
        [guild.id, grant.userId, grant.roleId, grant.seasonId]);
      if (currentGrant?.status !== 'PENDING' || engagementSettings(guild.id).seasonId !== grant.seasonId ||
          !get('SELECT 1 FROM daily_milestone_roles WHERE guildId = ? AND roleId = ? AND points <= ?', [guild.id, grant.roleId, score]) ||
          rewardRoleError(guild, role)) continue;
      if (!member.roles.cache.has(role.id)) await member.roles.add(role, `Daily engagement milestone: ${reward.points} seasonal points`);
      run(`UPDATE daily_role_grants SET status = 'GRANTED', grantedAt = ?, lastError = NULL
        WHERE guildId = ? AND userId = ? AND roleId = ? AND seasonId = ?`, [now, guild.id, grant.userId, role.id, grant.seasonId]);
    } catch (error) {
      run(`UPDATE daily_role_grants SET attempts = attempts + 1, lastError = ?, nextAttemptAt = ?
        WHERE guildId = ? AND userId = ? AND roleId = ? AND seasonId = ?`,
      [String(error.message).slice(0, 500), now + 15 * 60_000, grant.guildId, grant.userId, grant.roleId, grant.seasonId]);
    }
  }
}

async function sendReminders(client, now = Date.now()) {
  const { queueDailyDelivery, attemptDailyDelivery } = require('./dailyDelivery');
  const settingsList = all(`SELECT settings.*, config.timezone FROM daily_engagement_settings settings
    JOIN daily_interaction_config config ON config.guildId = settings.guildId
    WHERE settings.remindersEnabled = 1 AND config.enabled = 1`);
  for (const settings of settingsList) {
    if (isQuietDay(settings.guildId, now)) continue;
    const reminderDateKey = require('../services/DailyInteractionService').getDateParts(new Date(now), settings.timezone).dateKey;
    const candidates = all(`SELECT * FROM (SELECT post.*, pref.userId,
        ROW_NUMBER() OVER (PARTITION BY pref.userId ORDER BY post.sentAt DESC, post.messageId DESC) AS priority
      FROM daily_interaction_posts post
      JOIN daily_member_preferences pref ON pref.guildId = post.guildId AND pref.reminders = 1
      WHERE post.guildId = ? AND post.sentAt + ? * 60000 <= ? AND post.sentAt > ?
      AND (post.type != 'TRIVIA' OR post.activityJson IS NULL OR
        post.sentAt + json_extract(post.activityJson, '$.minutes') * 60000 > ?)
      AND NOT EXISTS (SELECT 1 FROM daily_interaction_participants p WHERE p.messageId = post.messageId AND p.userId = pref.userId)
      AND NOT EXISTS (SELECT 1 FROM delivery_outbox o
        WHERE o.deliveryKey = 'daily-reminder:' || post.guildId || ':' || ? || ':' || pref.userId)
      ) WHERE priority = 1 ORDER BY sentAt DESC LIMIT 50`,
    [settings.guildId, settings.reminderDelayMinutes, now, now - 86_400_000, now, reminderDateKey]);
    for (const post of candidates) {
      if (isQuietDay(post.guildId, now) || !require('./dailyActivities').activityOpen(post, now)) continue;
      try {
        const row = queueDailyDelivery({ deliveryKey: `daily-reminder:${post.guildId}:${reminderDateKey}:${post.userId}`, type: 'DAILY_REMINDER',
          guildId: post.guildId, metadata: { postId: post.messageId, userId: post.userId, reminderDateKey },
          message: { content: `Your opted-in daily activity reminder:\nhttps://discord.com/channels/${post.guildId}/${post.channelId}/${post.messageId}`,
            allowedMentions: { parse: [] } } });
        await attemptDailyDelivery(client, row);
      } catch (error) { console.error('Daily reminder queued for retry:', error.message); }
    }
  }
}

module.exports = { activeDayGap, addMilestone, applyMilestones, configureEngagement, creditParticipation,
  engagementSettings, isQuietDay, removeMilestone, seasonLeaderboard, sendReminders, setQuietDay,
  setReminderPreference, startSeason };
