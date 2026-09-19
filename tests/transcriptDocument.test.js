const assert = require('node:assert/strict');
const test = require('node:test');
const { Collection, Embed } = require('discord.js');
const { parse, serialize } = require('parse5');
const {
  buildTranscriptDocument,
  fetchTranscriptMessages,
  preserveAssets
} = require('../utils/tickets/transcriptDocument');

const IMAGE_URL = 'https://cdn.discordapp.com/attachments/123/456/example.png';
const IMAGE_BYTES = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMioAAAAASUVORK5CYII=', 'base64');

function fixture() {
  const channel = {
    id: '111111111111111111', name: 'application-test', type: 0,
    guild: { id: '222222222222222222', name: 'Test server', iconURL: () => null },
    isTextBased: () => true, isDMBased: () => false, isThread: () => false, isVoiceBased: () => false,
    client: { channels: { fetch: async () => null }, users: { fetch: async () => null } }
  };
  channel.guild.roles = { fetch: async () => null };
  const message = {
    id: '333333333333333333', channel, guild: channel.guild,
    author: { id: '444444444444444444', displayName: 'Applicant', bot: false, displayAvatarURL: () => null },
    member: null, createdAt: new Date('2026-09-16T12:00:00Z'), editedAt: null,
    mentions: { everyone: false }, content: 'Full message with **formatting** and <script>alert(1)</script>',
    attachments: new Collection([['image', { id: 'image', name: 'example.png', url: IMAGE_URL, contentType: 'image/png', size: IMAGE_BYTES.length }]]),
    embeds: [new Embed({ title: 'Application answers', description: 'Complete embed body', fields: [{ name: 'Question', value: 'Complete response' }], image: { url: IMAGE_URL } })],
    components: [{ type: 17, components: [{ type: 10, content: 'Modern component content' }] }],
    stickers: new Collection([['sticker', { name: 'Welcome', url: IMAGE_URL }]]),
    poll: { question: { text: 'Which option?' }, answers: new Collection([['a', { text: 'Choice A', voteCount: 3 }]]) },
    reactions: { cache: new Collection() }
  };
  channel.messages = { fetch: async () => new Collection([[message.id, message]]) };
  return { channel, message };
}

test('transcripts fetch all history pages and sort them chronologically', async () => {
  const requests = [];
  const channel = { messages: { fetch: async options => {
    requests.push(options);
    const ids = options.before ? [1] : Array.from({ length: 100 }, (_, index) => 101 - index);
    return new Collection(ids.map(id => [String(id), { id: String(id) }]));
  } } };
  const messages = await fetchTranscriptMessages(channel);
  assert.equal(messages.length, 101);
  assert.equal(messages[0].id, '1');
  assert.equal(messages.at(-1).id, '101');
  assert.equal(requests[1].before, '2');
  assert.equal(requests[0].cache, false);
});

test('transcript history failure propagates rather than returning an incomplete archive', async () => {
  await assert.rejects(fetchTranscriptMessages({ messages: { fetch: async () => { throw new Error('Missing access'); } } }), /Missing access/);
});

test('the real renderer produces styled HTML with full answers, embeds, media, stickers, and modern content', async () => {
  const { channel } = fixture();
  const downloads = [];
  const longAnswer = 'Full response '.repeat(550) + 'END OF RESPONSE';
  const document = await buildTranscriptDocument({
    channel,
    ticket: { type: 'application', userId: '444444444444444444', createdAt: Date.now(), closedAt: Date.now(), closeReason: 'Reviewed everything', applicationStatus: 'ACCEPTED', applicationDecisionReason: 'Strong experience' },
    closedBy: { id: '555555555555555555', tag: 'Reviewer' },
    applicationForm: { name: 'Staff team' },
    answers: [{ question: 'A long question '.repeat(100), answer: longAnswer }],
    assetOptions: { fetchAsset: async url => {
      downloads.push(url);
      return { ok: true, headers: new Map([['content-type', 'image/png']]), buffer: async () => IMAGE_BYTES };
    } }
  });
  assert.equal(document.messageCount, 1);
  assert.equal(downloads.filter(url => url === IMAGE_URL).length, 1);
  assert.equal(document.assets.saved, new Set(downloads).size);
  for (const content of ['Complete embed body', 'Complete response', 'Modern component content', 'Sticker: Welcome', 'Choice A: 3 vote(s)', 'ACCEPTED', 'Strong experience', longAnswer]) {
    assert.ok(document.html.includes(content), `Missing: ${content.slice(0, 50)}`);
  }
  assert.match(document.html, /data:image\/png;base64,/);
  assert.match(document.html, /<style/);
  assert.doesNotMatch(document.html, /src="https:\/\/cdn.jsdelivr.net/);
  assert.doesNotMatch(document.html, /<script>alert\(1\)<\/script>/);
  if (process.env.TRANSCRIPT_TEST_OUTPUT) require('node:fs').writeFileSync(process.env.TRANSCRIPT_TEST_OUTPUT, document.html);
});

test('asset capture avoids external requests, deduplicates media, and retains unavailable links', async () => {
  const document = parse(`<html><body><img src="${IMAGE_URL}"><a href="${IMAGE_URL}">file</a><img src="http://127.0.0.1/private"><img src="https://cdn.discordapp.com.evil.example/file.png"></body></html>`);
  const urls = [];
  const assets = await preserveAssets(document, { fetchAsset: async (url, options) => {
    urls.push(url);
    assert.equal(options.redirect, 'error');
    throw new Error('File unavailable');
  } });
  assert.deepEqual(urls, [IMAGE_URL]);
  assert.deepEqual(assets, { saved: 0, linked: 1 });
  assert.ok(serialize(document).includes(IMAGE_URL));
});
