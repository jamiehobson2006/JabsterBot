const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applicationDecisionFields,
  getTranscriptChannelId
} = require('../utils/tickets/transcript');

test('application transcripts prefer their separate archive channel', () => {
  const settings = {
    transcriptChannelId: 'ticket-transcripts',
    applicationTranscriptChannelId: 'application-transcripts'
  };

  assert.equal(
    getTranscriptChannelId(settings, { type: 'application' }),
    'application-transcripts'
  );
  assert.equal(
    getTranscriptChannelId(settings, { type: 'support' }),
    'ticket-transcripts'
  );
});

test('application transcript metadata includes the decision and review reason', () => {
  const fields = applicationDecisionFields({
    applicationFormId: 24,
    applicationStatus: 'ACCEPTED',
    applicationReviewedBy: 'reviewer-1',
    applicationReviewedAt: 1_790_000_000_000,
    applicationDecisionReason: 'Strong application and relevant experience.'
  }, { name: 'Staff Team' });

  assert.equal(fields.find(field => field.name === 'Application Form').value, 'Staff Team');
  assert.equal(fields.find(field => field.name === 'Application Result').value, 'Accepted');
  assert.equal(
    fields.find(field => field.name === 'Decision Reason').value,
    'Strong application and relevant experience.'
  );
});
