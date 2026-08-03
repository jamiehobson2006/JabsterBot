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
  initDatabase
} = require('../database');

const {
  createFeedbackRecord,
  getFeedback,
  listFeedback,
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
