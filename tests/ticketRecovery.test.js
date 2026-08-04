const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), 'jabster-studios-ticket-recovery-')
);

process.env.DATABASE_PATH = path.join(tempDir, 'database.db');

const {
  get,
  initDatabase,
  run
} = require('../database');

const {
  findOrRecoverOpenTicket,
  getTicketTopicMetadata
} = require('../utils/tickets/recoverTicket');

function starterMessage() {
  return {
    id: '111111111111111111',
    author: { id: 'bot-1' },
    createdTimestamp: 1_000,
    components: [{
      components: [{ customId: 'ticket_close' }]
    }],
    embeds: [{
      fields: [
        { name: 'Type', value: 'Support' },
        { name: 'Creator', value: '<@123456789012345678>' }
      ],
      footer: { text: 'User ID: 123456789012345678' }
    }]
  };
}

test('missing ticket records are safely recovered from a bot ticket starter message', async () => {
  initDatabase();

  const channel = {
    id: 'ticket-channel',
    name: 'ticket-support-member',
    parentId: 'ticket-category',
    createdTimestamp: 900,
    messages: {
      fetch: async options => {
        if (typeof options === 'string') {
          return options === '111111111111111111' ? starterMessage() : null;
        }

        return new Map([['111111111111111111', starterMessage()]]);
      }
    }
  };

  const ticket = await findOrRecoverOpenTicket({
    guild: { id: 'guild-1' },
    channel,
    client: { user: { id: 'bot-1' } }
  });

  assert.equal(ticket.channelId, 'ticket-channel');
  assert.equal(ticket.userId, '123456789012345678');
  assert.equal(ticket.type, 'support');
  assert.equal(ticket.status, 'OPEN');
  assert.equal(get('SELECT COUNT(*) AS count FROM tickets').count, 1);

  const recoveredAgain = await findOrRecoverOpenTicket({
    guild: { id: 'guild-1' },
    channel,
    client: { user: { id: 'bot-1' } }
  });

  assert.equal(recoveredAgain.id, ticket.id);
  assert.equal(get('SELECT COUNT(*) AS count FROM tickets').count, 1);
});

test('the close button can recover an older ticket from its exact starter message', async () => {
  initDatabase();

  const channel = {
    id: 'older-ticket-channel',
    name: 'ticket-support-member',
    parentId: 'ticket-category',
    createdTimestamp: 900,
    messages: {
      fetch: async options => {
        if (options === '111111111111111111') return starterMessage();
        return new Map();
      }
    }
  };

  const ticket = await findOrRecoverOpenTicket({
    guild: { id: 'guild-older' },
    channel,
    client: { user: { id: 'bot-1' } },
    starterMessageId: '111111111111111111'
  });

  assert.equal(ticket.channelId, 'older-ticket-channel');
  assert.equal(ticket.messageId, '111111111111111111');
});

test('legacy lowercase open ticket statuses remain closable', async () => {
  initDatabase();

  run(
    `INSERT INTO tickets (guildId, channelId, userId, type, status, createdAt)
     VALUES ('guild-2', 'legacy-ticket', 'owner-1', 'support', 'open', 1)`
  );

  const ticket = await findOrRecoverOpenTicket({
    guild: { id: 'guild-2' },
    channel: { id: 'legacy-ticket' },
    client: { user: { id: 'bot-1' } }
  });

  assert.equal(ticket.status, 'open');
});

test('ticket topic metadata recovers busy tickets without fetching their old starter message', async () => {
  initDatabase();

  const channel = {
    id: 'topic-ticket',
    name: 'ticket-application-member',
    topic: 'Jabster Studios ticket | type:application | owner:222222222222222222 | form:12',
    createdTimestamp: 5_000
  };

  assert.deepEqual(getTicketTopicMetadata(channel.topic), {
    type: 'application',
    userId: '222222222222222222',
    applicationFormId: 12
  });

  const ticket = await findOrRecoverOpenTicket({
    guild: { id: 'guild-3' },
    channel,
    client: { user: { id: 'bot-1' } }
  });

  assert.equal(ticket.type, 'application');
  assert.equal(ticket.userId, '222222222222222222');
  assert.equal(ticket.applicationFormId, 12);
});
