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
    path.join(os.tmpdir(), 'jabster-studios-ticket-feedback-')
  );

process.env.DATABASE_PATH =
  path.join(tempDir, 'database.db');

const {
  all,
  run,
  initDatabase
} = require('../database');

const {
  createFeedbackRecord,
  getFeedback,
  listFeedback,
  publishFeedback,
  publishPendingFeedback,
  sendFeedbackPrompt,
  submitFeedback
} = require('../utils/ticketFeedback');

test(
  'ticket feedback is retained without a configured feedback channel',
  () => {
    initDatabase();

    const record =
      createFeedbackRecord({
        ticket: {
          id: 15,
          guildId: 'guild-1',
          channelId: 'ticket-1',
          type: 'partnership',
          userId: 'ticket-creator'
        },
        closedBy: {
          id: 'staff-1'
        },
        closeReason: 'The partnership request was completed.'
      });

    assert.equal(record.status, 'PENDING');
    assert.equal(record.rating, null);
    assert.equal(record.closeReason, 'The partnership request was completed.');

    const submitted =
      submitFeedback({
        id: record.id,
        userId: 'ticket-creator',
        rating: 5,
        feedback: 'Very helpful staff.'
      });

    assert.equal(submitted.status, 'SUBMITTED');
    assert.equal(submitted.rating, 5);
    assert.equal(submitted.feedback, 'Very helpful staff.');
    assert.equal(getFeedback(record.id).dmSent, 0);
    assert.equal(listFeedback('guild-1').length, 1);

    assert.throws(
      () => submitFeedback({
        id: record.id,
        userId: 'ticket-creator',
        rating: 4,
        feedback: 'A second response.'
      }),
      /already submitted/i
    );
  }
);

test('every ticket category sends and publishes feedback through the shared feedback system', async () => {
  initDatabase();

  run(
    `INSERT INTO guild_settings (guildId, ticketFeedbackChannelId)
     VALUES ('feedback-guild', 'feedback-channel')
     ON CONFLICT(guildId) DO UPDATE SET ticketFeedbackChannelId = excluded.ticketFeedbackChannelId`
  );

  const directMessages = [];
  const published = [];
  const client = {
    users: {
      fetch: async () => ({
        send: async payload => directMessages.push(payload)
      })
    },
    channels: {
      fetch: async () => ({
        isTextBased: () => true,
        send: async payload => {
          published.push(payload);
          return { id: `feedback-${published.length}` };
        }
      })
    }
  };

  for (const type of ['support', 'bug', 'giveaway', 'partnership', 'application']) {
    const record = createFeedbackRecord({
      ticket: {
        guildId: 'feedback-guild',
        channelId: `ticket-${type}`,
        type,
        userId: `creator-${type}`
      },
      closedBy: { id: 'staff-1' },
      closeReason: `Closed ${type} ticket.`
    });

    assert.equal(await sendFeedbackPrompt({ client, feedback: record }), true);

    const submitted = submitFeedback({
      id: record.id,
      userId: `creator-${type}`,
      rating: 4,
      feedback: `Feedback for ${type}.`
    });

    assert.equal(await publishFeedback(client, submitted), true);
  }

  assert.equal(directMessages.length, 5);
  assert.equal(published.length, 5);

  const feedbackTypes = published.map(payload =>
    payload.embeds[0].data.fields.find(field => field.name === 'Ticket Type').value
  );

  assert.deepEqual(feedbackTypes, ['support', 'bug', 'giveaway', 'partnership', 'application']);
  assert.equal(all('SELECT * FROM ticket_feedback WHERE guildId = ?', ['feedback-guild']).length, 5);
});

test('submitted feedback retries until it is posted once in the feedback channel', async () => {
  initDatabase();

  run(
    `INSERT INTO guild_settings (guildId, ticketFeedbackChannelId)
     VALUES ('retry-guild', 'retry-channel')
     ON CONFLICT(guildId) DO UPDATE SET ticketFeedbackChannelId = excluded.ticketFeedbackChannelId`
  );

  const record = submitFeedback({
    id: createFeedbackRecord({
      ticket: {
        guildId: 'retry-guild',
        channelId: 'retry-ticket',
        type: 'appeal',
        userId: 'retry-user'
      },
      closedBy: { id: 'retry-staff' },
      closeReason: 'Appeal reviewed.'
    }).id,
    userId: 'retry-user',
    rating: 5,
    feedback: 'Thank you for reviewing my appeal.'
  });

  let sends = 0;
  const client = {
    channels: {
      fetch: async () => ({
        isTextBased: () => true,
        send: async () => {
          sends += 1;
          if (sends === 1) throw new Error('Temporary Discord failure');
          return { id: 'published-feedback' };
        }
      })
    }
  };

  await assert.rejects(
    publishFeedback(client, record),
    /temporary discord failure/i
  );

  const failed = getFeedback(record.id);
  assert.equal(failed.publishedMessageId, null);
  assert.equal(failed.publishAttempts, 1);
  assert.match(failed.lastPublishError, /temporary discord failure/i);

  run(
    `UPDATE ticket_feedback
     SET lastPublishAttemptAt = 0
     WHERE id = ?`,
    [record.id]
  );

  const retry = await publishPendingFeedback(client);
  const published = getFeedback(record.id);

  assert.equal(retry.published, 1);
  assert.equal(published.publishedMessageId, 'published-feedback');
  assert.ok(published.publishedAt);

  assert.equal(await publishFeedback(client, published), true);
  assert.equal(sends, 2);
});
