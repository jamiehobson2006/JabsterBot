const assert = require('node:assert/strict');
const test = require('node:test');

const {
  PermissionFlagsBits
} = require('discord.js');

const {
  canManageApplications
} = require('../utils/applicationAccess');

function member({ administrator = false, roles = [] } = {}) {
  return {
    permissions: {
      has: permission => administrator && permission === PermissionFlagsBits.Administrator
    },
    roles: {
      cache: new Set(roles)
    }
  };
}

test('configured application managers can create and edit application forms', () => {
  assert.equal(canManageApplications(member({ roles: ['application-team'] }), 'application-team'), true);
  assert.equal(canManageApplications(member({ roles: ['application-team'] }), 'different-role'), false);
  assert.equal(canManageApplications(member({ administrator: true }), null), true);
});
