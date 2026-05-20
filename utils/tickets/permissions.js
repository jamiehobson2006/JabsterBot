const {
  PermissionsBitField
} = require('discord.js');

const {
  get
} = require('../../database');

// ==================================================
// 🧠 SAFE STRING
// ==================================================
function safeString(
  value,
  fallback = null
) {

  if (
    typeof value !== 'string'
  ) {

    return fallback;
  }

  const cleaned =
    value.trim();

  return cleaned.length
    ? cleaned
    : fallback;
}

// ==================================================
// 👮 GET STAFF ROLE
// ==================================================
function getStaffRole(
  guildId,
  type
) {

  const safeGuildId =
    safeString(guildId);

  const safeType =
    safeString(type);

  if (
    !safeGuildId ||
    !safeType
  ) {

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

  return safeString(
    settings?.roleId
  );
}

// ==================================================
// 🔐 STAFF ACCESS CHECK
// ==================================================
function hasTicketAccess({

  member,

  guildId,

  type
}) {

  try {

    // ==========================================
    // 🚫 INVALID MEMBER
    // ==========================================
    if (
      !member
    ) {

      return false;
    }

    // ==========================================
    // 👑 ADMIN BYPASS
    // ==========================================
    if (

      member.permissions?.has(

        PermissionsBitField.Flags.Administrator
      )
    ) {

      return true;
    }

    // ==========================================
    // 👮 STAFF ROLE
    // ==========================================
    const roleId =
      getStaffRole(
        guildId,
        type
      );

    if (
      !roleId
    ) {

      return false;
    }

    // ==========================================
    // 🚫 NO ROLE CACHE
    // ==========================================
    if (
      !member.roles?.cache
    ) {

      return false;
    }

    return member.roles.cache.has(
      roleId
    );

  } catch (err) {

    console.error(
      'Ticket permission error:',
      err
    );

    return false;
  }
}

// ==================================================
// 🔒 CLOSE PERMISSION
// ==================================================
function canCloseTicket({

  member,

  guildId,

  type
}) {

  return hasTicketAccess({

    member,

    guildId,

    type
  });
}

// ==================================================
// 👮 CLAIM PERMISSION
// ==================================================
function canClaimTicket({

  member,

  guildId,

  type
}) {

  return hasTicketAccess({

    member,

    guildId,

    type
  });
}

// ==================================================
// 🔓 REOPEN PERMISSION
// ==================================================
function canReopenTicket({

  member,

  guildId,

  type
}) {

  return hasTicketAccess({

    member,

    guildId,

    type
  });
}

// ==================================================
// 🗑 DELETE PERMISSION
// ==================================================
function canDeleteTicket({

  member,

  guildId,

  type
}) {

  return hasTicketAccess({

    member,

    guildId,

    type
  });
}

// ==================================================
// 📦 EXPORTS
// ==================================================
module.exports = {

  getStaffRole,

  hasTicketAccess,

  canCloseTicket,

  canClaimTicket,

  canReopenTicket,

  canDeleteTicket
};