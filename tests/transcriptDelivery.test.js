const assert = require('node:assert/strict');
const test = require('node:test');
const { Collection, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { sendTranscriptMessage, transcriptUrl, REFRESH_TRANSCRIPT_ID } = require('../utils/tickets/transcriptDelivery');
const handler = require('../events/transcriptInteractions');

test('transcript delivery adds working attachment links without replacing feedback buttons', async () => {
  const previous = process.env.TRANSCRIPT_VIEWER_URL;
  delete process.env.TRANSCRIPT_VIEWER_URL;
  try {
    const edits = [];
    const attachment = { name: 'ticket-123.html', url: 'https://cdn.discordapp.com/attachments/123/456/ticket-123.html?hm=signed' };
    const feedbackRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('feedback').setLabel('5/5').setStyle(ButtonStyle.Success));
    const message = { attachments: new Collection([['file', attachment]]), edit: async payload => edits.push(payload) };
    const destination = { send: async payload => { assert.deepEqual(payload.allowedMentions, { parse: [] }); return message; } };
    await sendTranscriptMessage(destination, { files: ['transcript'], components: [feedbackRow] });
    assert.equal(edits[0].components.length, 2);
    assert.equal(edits[0].components[0], feedbackRow);
    assert.equal(edits[0].components[1].components[0].data.url, attachment.url);
    assert.equal(edits[0].components[1].components[1].data.custom_id, REFRESH_TRANSCRIPT_ID);
  } finally {
    if (previous === undefined) delete process.env.TRANSCRIPT_VIEWER_URL;
    else process.env.TRANSCRIPT_VIEWER_URL = previous;
  }
});

test('configured viewer URLs preserve the complete signed attachment URL', () => {
  const previous = process.env.TRANSCRIPT_VIEWER_URL;
  process.env.TRANSCRIPT_VIEWER_URL = 'https://viewer.example/transcript';
  try {
    const attachment = 'https://cdn.discordapp.com/attachments/1/2/file.html?ex=one&hm=two';
    const url = new URL(transcriptUrl(attachment));
    assert.equal(url.origin, 'https://viewer.example');
    assert.equal(url.searchParams.get('url'), attachment);
  } finally {
    if (previous === undefined) delete process.env.TRANSCRIPT_VIEWER_URL;
    else process.env.TRANSCRIPT_VIEWER_URL = previous;
  }
});

test('refreshing an old transcript link fetches a new signed URL and preserves feedback controls', async () => {
  const edits = [];
  const replies = [];
  const row = { components: [{ customId: 'rating' }] };
  const message = {
    components: [row, { components: [{ customId: REFRESH_TRANSCRIPT_ID }] }],
    attachments: new Collection([['file', { name: 'ticket-1.html', url: 'https://cdn.discordapp.com/attachments/1/2/ticket-1.html?hm=renewed' }]]),
    fetch: async force => { assert.equal(force, true); return message; },
    edit: async payload => edits.push(payload)
  };
  await handler.execute({
    isButton: () => true, customId: REFRESH_TRANSCRIPT_ID, message,
    deferReply: async () => {}, editReply: async payload => replies.push(payload)
  });
  assert.equal(edits[0].components[0], row);
  assert.match(replies[0].components[0].components[0].data.url, /renewed/);
});
