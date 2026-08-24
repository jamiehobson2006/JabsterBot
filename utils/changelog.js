const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');

const {
  all,
  get,
  run
} = require('../database');

const VERSION_ONE_CONTENT = [
  '**Jabster Studios Bot Version 1.0**',
  '',
  '**Moderation and safety**',
  'Warnings, mutes, bans, kicks, cases, moderation history, message purges, link blocking, censoring, anti-spam protection, configurable bypasses, and detailed audit logs.',
  '',
  '**Tickets and applications**',
  'Support, bug report, giveaway, partnership, appeal, and application tickets; staff claims, transcripts, feedback, configurable panels, service targets, application questions, and ticket statistics.',
  '',
  '**Server management**',
  'Role tools, verification panels, reaction roles, custom greetings, member milestones, staff lists, temporary voice rooms, command controls, channel controls, and configurable logging.',
  '',
  '**Community tools**',
  'Suggestions with team review, polls, giveaways, daily facts, social alerts, invite tracking, leveling, server and user information, avatars, games, and the Jabster Studios Endless Summer Simulator link.',
  '',
  '**Built to grow**',
  'Every configuration is stored per server so it persists through bot restarts. Administrators can tailor features, roles, channels, filters, and visibility to their community.'
].join('\n');

function getChangelogSettings(guildId) {
  return get(
    `SELECT *
     FROM changelog_settings
     WHERE guildId = ?`,
    [guildId]
  );
}

function setChangelogSettings({
  guildId,
  publishChannelId,
  reviewChannelId,
  reviewerRoleId,
  updatedBy
}) {
  return run(
    `INSERT INTO changelog_settings (
       guildId, publishChannelId, reviewChannelId,
       reviewerRoleId, updatedBy, updatedAt
     )
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(guildId)
     DO UPDATE SET publishChannelId = excluded.publishChannelId,
                   reviewChannelId = excluded.reviewChannelId,
                   reviewerRoleId = excluded.reviewerRoleId,
                   updatedBy = excluded.updatedBy,
                   updatedAt = excluded.updatedAt`,
    [
      guildId,
      publishChannelId || null,
      reviewChannelId || null,
      reviewerRoleId || null,
      updatedBy,
      Date.now()
    ]
  );
}

function createChangelogEntry({ guildId, version, title, content, createdBy }) {
  return run(
    `INSERT INTO changelog_entries (
       guildId, version, title, content, status, createdBy, createdAt
     )
     VALUES (?, ?, ?, ?, 'DRAFT', ?, ?)`,
    [guildId, version.trim(), title.trim(), content.trim(), createdBy, Date.now()]
  ).lastInsertRowid;
}

function getChangelogEntry(guildId, id) {
  return get(
    `SELECT *
     FROM changelog_entries
     WHERE guildId = ?
     AND id = ?`,
    [guildId, id]
  );
}

function listChangelogEntries(guildId, status) {
  const normalizedStatus = String(status || 'ALL').toUpperCase();

  return normalizedStatus === 'ALL'
    ? all(
      `SELECT *
       FROM changelog_entries
       WHERE guildId = ?
       ORDER BY id DESC
       LIMIT 25`,
      [guildId]
    )
    : all(
      `SELECT *
       FROM changelog_entries
       WHERE guildId = ?
       AND status = ?
       ORDER BY id DESC
       LIMIT 25`,
      [guildId, normalizedStatus]
    );
}

function buildChangelogEmbed(entry, { review = false } = {}) {
  const status = String(entry.status || 'DRAFT').toUpperCase();
  const colors = {
    DRAFT: 0x99AAB5,
    PENDING: 0xFEE75C,
    APPROVED: 0x57F287,
    DENIED: 0xED4245,
    PUBLISHED: 0x5865F2
  };

  const embed = new EmbedBuilder()
    .setColor(colors[status] || 0x5865F2)
    .setTitle(`${entry.version} | ${entry.title}`)
    .setDescription(String(entry.content || 'No change notes provided.').slice(0, 4096))
    .addFields(
      { name: 'Status', value: status, inline: true },
      { name: 'Created By', value: `<@${entry.createdBy}>`, inline: true },
      { name: 'Created', value: `<t:${Math.floor(entry.createdAt / 1000)}:F>`, inline: true }
    )
    .setFooter({ text: `Jabster Studios Changelog #${entry.id}` });

  if (entry.reviewReason) {
    embed.addFields({ name: 'Review Note', value: String(entry.reviewReason).slice(0, 1024) });
  }

  if (review) {
    embed.setAuthor({ name: 'Changelog Review Required' });
  }

  return embed;
}

function buildReviewComponents(id, disabled = false) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`changelog_approve_${id}`)
      .setLabel('Approve')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`changelog_deny_${id}`)
      .setLabel('Deny')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  )];
}

function markChangelogReviewed({ id, status, reviewerId, reason }) {
  return run(
    `UPDATE changelog_entries
     SET status = ?,
         reviewedBy = ?,
         reviewedAt = ?,
         reviewReason = ?
     WHERE id = ?
     AND status = 'PENDING'`,
    [status, reviewerId, Date.now(), reason || null, id]
  );
}

function markChangelogSubmitted(id, reviewMessageId) {
  return run(
    `UPDATE changelog_entries
     SET status = 'PENDING',
         reviewMessageId = ?
     WHERE id = ?
     AND status = 'DRAFT'`,
    [reviewMessageId, id]
  );
}

function markChangelogPublished(id, publisherId, messageId) {
  return run(
    `UPDATE changelog_entries
     SET status = 'PUBLISHED',
         publishedBy = ?,
         publishedAt = ?,
         publishedMessageId = ?
     WHERE id = ?
     AND status = 'APPROVED'`,
    [publisherId, Date.now(), messageId, id]
  );
}

module.exports = {
  VERSION_ONE_CONTENT,
  buildChangelogEmbed,
  buildReviewComponents,
  createChangelogEntry,
  getChangelogEntry,
  getChangelogSettings,
  listChangelogEntries,
  markChangelogPublished,
  markChangelogReviewed,
  markChangelogSubmitted,
  setChangelogSettings
};
