const assert = require('node:assert/strict');
const test = require('node:test');

const {
  describeDeletedMessage
} = require('../utils/deletedMessageSummary');

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
