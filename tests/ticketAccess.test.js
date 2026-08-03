const assert =
  require('node:assert/strict');

const fs =
  require('node:fs');

const os =
  require('node:os');

const path =
  require('node:path');

const test =
  require('node:test');

const tempDir =
  fs.mkdtempSync(
    path.join(os.tmpdir(), 'jabster-studios-ticket-access-')
  );

process.env.DATABASE_PATH =
  path.join(tempDir, 'database.db');

const {
  get,
  initDatabase,
  run
} = require('../database');

const {
  createForm
} = require('../utils/applications');

const {
  hasTicketAccess
} = require('../utils/tickets/permissions');

function member(userId, roleIds = [], administrator = false) {
  return {
    id: userId,
    permissions: {
      has: () => administrator
    },
    roles: {
      cache: {
        has: roleId => roleIds.includes(roleId)
      }
    }
  };
}

test(
  'application reviewer roles and explicitly added ticket staff can manage tickets',
  () => {
    initDatabase();

    createForm({
      guildId: 'guild-1',
      name: 'Developer Application',
      reviewerRoleId: 'developer-reviewers',
      createdBy: 'admin-1'
    });

    const form =
      get(
        `SELECT *
         FROM application_forms
         WHERE guildId = ?`,
        ['guild-1']
      );

    run(
      `INSERT INTO ticket_settings (
         guildId,
         type,
         enabled,
         roleId
       )
       VALUES (?, ?, 1, ?)`,
      [
        'guild-1',
        'application',
        'general-staff'
      ]
    );

    run(
      `INSERT INTO tickets (
         guildId,
         channelId,
         userId,
         type,
         applicationFormId,
         status,
         createdAt
       )
       VALUES (?, ?, ?, ?, ?, 'OPEN', ?)`,
      [
        'guild-1',
        'ticket-channel',
        'opener-1',
        'application',
        form.id,
        Date.now()
      ]
    );

    const baseOptions = {
      guildId: 'guild-1',
      type: 'application',
      channelId: 'ticket-channel'
    };

    assert.equal(
      hasTicketAccess({
        ...baseOptions,
        member: member('reviewer-1', ['developer-reviewers'])
      }),
      true
    );

    assert.equal(
      hasTicketAccess({
        ...baseOptions,
        member: member('general-staff-1', ['general-staff'])
      }),
      false
    );

    run(
      `INSERT INTO ticket_staff (
         guildId,
         channelId,
         userId,
         addedBy,
         addedAt
       )
       VALUES (?, ?, ?, ?, ?)`,
      [
        'guild-1',
        'ticket-channel',
        'assigned-staff-1',
        'reviewer-1',
        Date.now()
      ]
    );

    assert.equal(
      hasTicketAccess({
        ...baseOptions,
        member: member('assigned-staff-1')
      }),
      true
    );

    run(
      `UPDATE tickets
       SET restricted = 1
       WHERE channelId = ?`,
      ['ticket-channel']
    );

    assert.equal(
      hasTicketAccess({
        ...baseOptions,
        member: member('assigned-staff-1')
      }),
      false
    );

    assert.equal(
      hasTicketAccess({
        ...baseOptions,
        member: member('admin-1', [], true)
      }),
      true
    );
  }
);
