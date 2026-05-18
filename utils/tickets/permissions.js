const {
  PermissionsBitField
} = require('discord.js');

const {
  get
} = require('../../database');

// ==================================================
// 👮 GET STAFF ROLE
// ==================================================
function getStaffRole(
  guildId,
  type
) {

  const settings = get(

    `SELECT roleId
     FROM ticket_settings
     WHERE guildId = ?
     AND type = ?`,

    [
      guildId,
      type
    ]
  );

  return settings?.roleId || null;
}

// ==================================================
// 🔐 STAFF CHECK
// ==================================================
function hasTicketAccess({

  member,

  guildId,

  type
}) {

  // ==============================================
  // 👑 ADMIN BYPASS
  // ==============================================
  if (

    member.permissions.has(
      PermissionsBitField.Flags.Administrator
    )
  ) {

    return true;
  }

  // ==============================================
  // 👮 STAFF ROLE
  // ==============================================
  const roleId =
    getStaffRole(
      guildId,
      type
    );

  if (!roleId) {

    return false;
  }

  return member.roles.cache.has(
    roleId
  );
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

module.exports = {

  getStaffRole,

  hasTicketAccess,

  canCloseTicket,

  canClaimTicket,

  canReopenTicket,

  canDeleteTicket
};