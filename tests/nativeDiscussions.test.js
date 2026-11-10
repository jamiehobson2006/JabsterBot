const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { Collection, EmbedBuilder } = require('discord.js');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'jabster-native-discussion-'));
process.env.DATABASE_PATH = path.join(temp, 'db.sqlite');
const { db, get, all, run, initDatabase } = require('../database');
initDatabase();
const service = require('../services/DailyInteractionService');
const interactions = require('../events/dailyInteractionInteractions');
const { handleDailyInteractionThreadSafety } = require('../events/messageCreate');
const { cleanupPublicReferences } = require('../utils/publicMessageCleanup');
const games = require('../utils/freeGames');
test.beforeEach(() => {
  for (const name of ['daily_interaction_posts','daily_interaction_responses','daily_interaction_participants',
    'daily_interaction_member_stats','daily_point_events','daily_game_turns','daily_interaction_config',
    'delivery_outbox','free_game_announcements','free_game_settings','censor_words']) db.exec(`DELETE FROM ${name}`);
});
test.after(() => { db.close(); fs.rmSync(temp, { recursive: true, force: true }); });

function sandbox() {
  const channels = new Collection();
  const sent = [];
  const guild = { id: 'guild', members: { me: { id: 'bot' }, fetch: async id => ({ id }) } };
  const client = { user: { id: 'bot' }, channels: { fetch: async id => channels.get(id) } };
  guild.channels = client.channels;
  const messages = new Collection();
  const parent = { id: 'parent', guild, permissionsFor: () => ({ has: () => true }), isTextBased: () => true,
    messages: { fetch: async arg => typeof arg === 'object' && !arg.message ? messages : messages.get(arg.message || arg) } };
  const thread = { id: 'thread', guild, isThread: () => true, archived: false, locked: false,
    send: async payload => { sent.push(payload); return { delete: async () => {} }; } };
  const source = { id: 'post', createdTimestamp: Date.now(), author: client.user, channel: parent,
    embeds: [new EmbedBuilder().setTitle('Question').setDescription('What is a favourite memory?')
      .setFooter({ text: 'Jabster Studios | Ref: 123456789012345678901234' })],
    components: [], startThread: async () => thread,
    edit: async payload => { if (payload.embeds) source.embeds = payload.embeds;
      if (payload.content != null) source.content = payload.content; return source; } };
  channels.set('parent', parent); channels.set('thread', thread); messages.set('post', source);
  service.updateDailyInteractionConfig('guild', { channelId: 'parent', enabled: 1, discussionEnabled: 1, timezone: 'UTC' });
  run(`INSERT INTO daily_interaction_posts (messageId,guildId,channelId,type,promptKey,prompt,sentAt,threadId)
    VALUES ('post','guild','parent','QUESTION','question-fixture','What is a favourite memory?',?,'thread')`, [Date.now()]);
  return { guild, client, parent, thread, source, sent, messages, channels };
}

test('safe question replies remain authored by members and create no bot relay delivery', async () => {
  const f = sandbox();
  let deleted = false;
  const message = { id: 'native-one', guild: f.guild, channel: f.thread, author: { id: 'member', tag: 'Member' },
    content: 'My favourite memory is a day at the beach.', delete: async () => { deleted = true; } };
  assert.equal(await handleDailyInteractionThreadSafety(message, f.client), false);
  assert.equal(deleted, false); assert.equal(f.sent.length, 0);
  assert.equal(get('SELECT threadMessageId FROM daily_interaction_responses').threadMessageId, 'native-one');
  assert.equal(all("SELECT * FROM delivery_outbox WHERE type='DAILY_INTERACTION_RESPONSE'").length, 0);
});

test('whole-message safety checks block punctuation bypasses, unsafe suffixes and links without echoing them', async () => {
  const f = sandbox();
  for (const text of ['.fuck', 'a friendly beginning and then /shit', 'ass', 'Visit https://example.com']) {
    let deleted = false;
    const message = { id: `unsafe-${f.sent.length}`, guild: f.guild, channel: f.thread,
      author: { id: 'member', tag: 'Member' }, content: text, delete: async () => { deleted = true; } };
    assert.equal(await handleDailyInteractionThreadSafety(message, f.client), true);
    assert.equal(deleted, true);
    assert.ok(f.sent.every(payload => !payload.content.includes(text)));
  }
  assert.equal(all('SELECT * FROM daily_interaction_responses').length, 0);
});

test('direct reply edits are checked again and ordinary parent chat remains unaffected', async () => {
  const f = sandbox();
  const message = { id: 'native', guild: f.guild, channel: f.thread, author: { id: 'member' }, content: 'A safe memory.', delete: async () => {} };
  assert.equal(await handleDailyInteractionThreadSafety(message, f.client), false);
  message.content = '.fuck';
  assert.equal(await handleDailyInteractionThreadSafety(message, f.client), true);
  message.channel = f.parent;
  message.delete = async () => { throw new Error('Parent chat must not be deleted'); };
  assert.equal(await handleDailyInteractionThreadSafety(message, f.client), false);
});

test('open discussion and legacy answer controls return a thread without reading or relaying answer text', async () => {
  const f = sandbox();
  for (const customId of ['dailyinteraction_discuss', 'dailyinteraction_answer']) {
    const interaction = { customId, guild: f.guild, client: f.client, channelId: 'parent', message: f.source,
      user: { id: 'member' }, member: { id: 'member' }, inGuild: () => true,
      isButton: () => true, isModalSubmit: () => false, deferReply: async function () { this.deferred = true; },
      fields: { getTextInputValue: () => { throw new Error('Never read an open-ended answer for relay'); } },
      editReply: async function (payload) { this.response = payload; }, reply: async function (payload) { this.response = payload; } };
    await interactions.execute(interaction);
    assert.match(interaction.response.content, /<#thread>/);
  }
  assert.equal(f.sent.length, 0);
});

test('existing daily messages have references removed without changing their content', async () => {
  const f = sandbox();
  run(`INSERT INTO delivery_outbox (deliveryKey,type,guildId,channelId,status,messageId,createdAt,updatedAt,sentAt)
    VALUES ('old','DAILY_FACT_POST','guild','parent','SENT','post',1,1,1)`);
  await cleanupPublicReferences(f.client);
  assert.equal(f.source.embeds[0].data.footer.text, 'Jabster Studios');
  assert.equal(f.source.embeds[0].data.description, 'What is a favourite memory?');
  assert.ok(get('SELECT publicCleanedAt FROM delivery_outbox').publicCleanedAt);
});

test('free-game alerts have no visible recovery code and lost-response recovery does not repost', async () => {
  const f = sandbox();
  const offer = { key: 'steam:game', source: 'STEAM', title: 'A Free Game', url: 'https://store.steampowered.com/app/123/' };
  const settings = { guildId: 'guild', channelId: 'parent' };
  games.saveFreeGameSettings({...settings,epicEnabled:true,steamEnabled:true,updatedBy:'admin'});
  let sends = 0;
  f.parent.send = async payload => {
    sends++;
    assert.doesNotMatch(payload.content || '', /free-game:|Ref:/);
    const message = { id: 'free-game', author: f.client.user, createdTimestamp: Date.now(), ...payload };
    f.messages.set(message.id, message);
    throw new Error('Lost response after Discord accepted the post');
  };
  const originalError = console.error; console.error = () => {};
  try {
    assert.equal(await games.announceOffer(f.client, settings, offer), 'failed');
    assert.ok(get('SELECT * FROM free_game_announcements'));
    assert.equal(await games.announceOffer(f.client, settings, offer), 'already-announced');
    assert.equal(sends, 1);
  } finally { console.error = originalError; }
});
