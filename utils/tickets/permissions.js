const {
  PermissionsBitField
} = require('discord.js');

const {
  get
} = require('../../database');

function safeString(value, fallback = null) {
  if (typeof value !== 'string') {
    return fallback;
  }

  const cleaned =
    value.trim();

  return cleaned.length
    ? cleaned
    : fallback;
}

function getTicket(channelId) {
  if (!channelId) {
    return null;
  }

  return get(
    `SELECT *
     FROM tickets
     WHERE channelId = ?`,
    [channelId]
  );
}

function getStaffRole(guildId, type, channelId = null) {
  const ticket =
    getTicket(channelId);

  if (
    ticket?.applicationFormId &&
    ticket.guildId === guildId
  ) {
    const form =
      get(
        `SELECT reviewerRoleId
         FROM application_forms
         WHERE id = ?
         AND guildId = ?`,
        [
          ticket.applicationFormId,
          guildId
        ]
      );

    const reviewerRoleId =
      safeString(form?.reviewerRoleId);

    if (reviewerRoleId) {
      return reviewerRoleId;
    }
  }

  const safeGuildId =
    safeString(guildId);

  const safeType =
    safeString(type);

  if (!safeGuildId || !safeType) {
    return null;
  }

  const settings =
    get(
      `SELECT roleId
       FROM ticket_settings
       WHERE guildId = ?
       AND type = ?`,
      [
        safeGuildId,
        safeType
      ]
    );

  return safeString(settings?.roleId);
}

function hasExplicitTicketStaff(guildId, channelId, userId) {
  if (!guildId || !channelId || !userId) {
    return false;
  }

  return Boolean(
    get(
      `SELECT 1
       FROM ticket_staff
       WHERE guildId = ?
       AND channelId = ?
       AND userId = ?`,
      [
        guildId,
        channelId,
        userId
      ]
    )
  );
}

function hasTicketAccess({
  member,
  guildId,
  type,
  channelId = null
}) {
  try {
    if (!member) {
      return false;
    }

    if (
      member.permissions?.has(
        PermissionsBitField.Flags.Administrator
      )
    ) {
      return true;
    }

    const ticket =
      getTicket(channelId);

    if (ticket?.restricted) {
      return false;
    }

    if (
      hasExplicitTicketStaff(
        guildId,
        channelId,
        member.id
      )
    ) {
      return true;
    }

    const roleId =
      getStaffRole(
        guildId,
        type,
        channelId
      );

    return Boolean(
      roleId &&
      member.roles?.cache?.has(roleId)
    );

  } catch (err) {
    console.error('Ticket permission error:', err);
    return false;
  }
}

function canCloseTicket(options) {
  return hasTicketAccess(options);
}

function canClaimTicket(options) {
  return hasTicketAccess(options);
}

function canReopenTicket(options) {
  return hasTicketAccess(options);
}

function canDeleteTicket(options) {
  return hasTicketAccess(options);
}

module.exports = {
  getStaffRole,
  hasExplicitTicketStaff,
  hasTicketAccess,
  canCloseTicket,
  canClaimTicket,
  canReopenTicket,
  canDeleteTicket
};
