const assert = require('node:assert/strict');
const test = require('node:test');

const {
  describeDeletedMessage
} = require('../utils/deletedMessageSummary');

const {
  buildDeletedMessageCopy,
  serialiseDeletedMessage
} = require('../utils/deletedMessageCopy');

test('deleted embed messages have a readable audit-log summary', () => {
  const summary = describeDeletedMessage({
    content: '',
    embeds: [{
      title: 'Server Update',
      description: 'A new update is ready.',
      fields: [{ name: 'Version', value: '3.0' }],
      footer: { text: 'Jabster Studios' }
    }],
    attachments: new Map()
  });

  assert.match(summary, /Embed 1/);
  assert.match(summary, /Title: Server Update/);
  assert.match(summary, /Description: A new update is ready/);
  assert.match(summary, /Version: 3.0/);
  assert.doesNotMatch(summary, /No text content/);
});

test('deleted-message snapshots preserve embeds, files, stickers, and custom emoji content', async () => {
  const source = {
    id: 'message-1',
    guild: { id: 'guild-1' },
    channel: { id: 'channel-1' },
    author: { id: 'user-1', tag: 'User#0001' },
    content: 'Hello <:jabster:123456789012345678>',
    embeds: [{ title: 'A copied embed', description: 'Still readable after deletion.' }],
    attachments: [{ name: 'image.png', url: 'https://cdn.example.test/image.png', size: 9_000_000 }],
    stickers: [{ name: 'wave', url: 'https://cdn.example.test/wave.png' }]
  };

  const snapshot = serialiseDeletedMessage(source);
  const copy = await buildDeletedMessageCopy({
    ...snapshot,
    stickers: []
  });

  assert.equal(snapshot.attachments[0].name, 'image.png');
  assert.equal(snapshot.stickers[0].name, 'wave');
  assert.match(copy.content, /<:jabster:123456789012345678>/);
  assert.equal(copy.embeds[0].title, 'A copied embed');
});

test('deleted-message snapshots safely preserve Discord ISO embed timestamps', () => {
  const timestamp = '2026-09-19T00:54:49.522000+00:00';
  const baseMessage = {
    id: 'message-with-timestamp',
    guild: { id: 'guild-1' },
    channel: { id: 'channel-1' },
    author: { id: 'user-1', tag: 'User#0001' },
    content: ''
  };

  const snapshot = serialiseDeletedMessage({
    ...baseMessage,
    embeds: [{ title: 'Timestamped embed', timestamp }]
  });
  assert.equal(snapshot.embeds[0].timestamp, new Date(timestamp).toISOString());

  const malformed = serialiseDeletedMessage({
    ...baseMessage,
    embeds: [{ title: 'Malformed timestamp', timestamp: 'not-a-date' }]
  });
  assert.equal(malformed.embeds[0].timestamp, undefined);
});
