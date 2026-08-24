const assert = require('node:assert/strict');
const test = require('node:test');

const {
  shouldLogCommand
} = require('../utils/commandAudit');

function interaction(commandName, subcommand = null) {
  return {
    commandName,
    options: {
      getSubcommand: () => subcommand
    }
  };
}

test('command audit logs server-changing commands and ignores normal utility commands', () => {
  assert.equal(shouldLogCommand({}, interaction('help')), false);
  assert.equal(shouldLogCommand({}, interaction('rank')), false);
  assert.equal(shouldLogCommand({}, interaction('warn')), true);
  assert.equal(shouldLogCommand({}, interaction('linkblock', 'whitelist-add')), true);
  assert.equal(shouldLogCommand({}, interaction('censor', 'bypass-channel-list')), false);
  assert.equal(shouldLogCommand({}, interaction('leveling', 'mutechannel')), true);
  assert.equal(shouldLogCommand({}, interaction('leveling', 'settings')), false);
  assert.equal(shouldLogCommand({}, interaction('ticketfeedback', 'list')), false);
  assert.equal(shouldLogCommand({}, interaction('loggingmanager', 'add')), true);
  assert.equal(shouldLogCommand({}, interaction('loggingmanager', 'list')), false);
  assert.equal(shouldLogCommand({}, interaction('freegames', 'setup')), true);
  assert.equal(shouldLogCommand({}, interaction('freegames', 'status')), false);
});

test('commands can explicitly opt in or out of command audit logging', () => {
  assert.equal(shouldLogCommand({ auditLog: true }, interaction('help')), true);
  assert.equal(shouldLogCommand({ auditLog: false }, interaction('warn')), false);
});
