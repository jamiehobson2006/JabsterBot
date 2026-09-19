const assert = require('node:assert/strict');
const test = require('node:test');
const { Collection } = require('discord.js');
process.env.DATABASE_PATH = ':memory:';
const { initDatabase, run } = require('../database');

const {
  applicationDecisionFields,
  generateTranscript,
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

test('application transcript generation includes saved answers and delivers a usable archive button', async () => {
  initDatabase();
  run('INSERT INTO guild_settings (guildId, transcriptChannelId) VALUES (?, ?)', ['222222222222222222', 'archive']);
  run(`INSERT INTO application_responses (guildId, formId, channelId, userId, answersJson, submittedAt)
       VALUES (?, ?, ?, ?, ?, ?)`, ['222222222222222222', 1, '111111111111111111', 'applicant', JSON.stringify([{ question: 'Why join?', answer: 'The full saved application response.' }]), Date.now()]);
  const sent = [];
  const edited = [];
  const client = {
    users: { fetch: async id => ({ id, tag: id }) },
    channels: { fetch: async () => ({
      isTextBased: () => true,
      send: async payload => {
        sent.push(payload);
        return {
          attachments: new Collection([['archive', { name: payload.files[0].name, url: 'https://cdn.discordapp.com/attachments/1/2/ticket.html' }]]),
          edit: async payload => edited.push(payload)
        };
      }
    }) }
  };
  const channel = {
    id: '111111111111111111', name: 'application-test', type: 0, client,
    guild: { id: '222222222222222222', name: 'Test server', iconURL: () => null },
    isTextBased: () => true, isDMBased: () => false, isThread: () => false, isVoiceBased: () => false,
    messages: { fetch: async () => new Collection() }
  };
  const result = await generateTranscript({
    client, channel, ticket: {
      id: 1, guildId: channel.guild.id, channelId: channel.id, type: 'application',
      userId: 'applicant', closeReason: 'Finished review', applicationStatus: 'DENIED', applicationDecisionReason: 'Experience needed'
    }, closedBy: { id: 'reviewer', tag: 'Reviewer' }
  });
  assert.equal(result?.archived, true);
  assert.equal(sent.length, 1);
  const html = result.attachment.attachment.toString();
  assert.match(html, /The full saved application response/);
  assert.match(html, /Experience needed/);
  assert.equal(edited[0].components[0].components[0].data.label, 'Open Transcript');
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
