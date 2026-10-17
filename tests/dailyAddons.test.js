const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { Collection, EmbedBuilder, InteractionType, PermissionFlagsBits, PermissionsBitField } = require('discord.js');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'jabster-daily-addons-'));
process.env.DATABASE_PATH = path.join(temp, 'test.db');
const { db, get, all, run, initDatabase } = require('../database');
initDatabase();
const service = require('../services/DailyInteractionService');
const activities = require('../utils/dailyActivities');
const engagement = require('../utils/dailyEngagement');
const delivery = require('../utils/dailyDelivery');
const events = require('../events/dailyInteractionInteractions');
const facts = require('../utils/dailyFacts');
const sources = require('../utils/factSources');
const reviews = require('../utils/dailyFactReview');
const reviewEvents = require('../events/dailyFactInteractions');
const tables = ['delivery_outbox', 'dailyfact_config', 'dailyfact_facts', 'dailyfact_submissions',
  'dailyfact_delivery_history', 'daily_interaction_config', 'daily_interaction_types',
  'daily_interaction_posts', 'daily_interaction_prompts', 'daily_interaction_history',
  'daily_interaction_participants', 'daily_interaction_responses', 'daily_interaction_member_stats',
  'daily_game_turns', 'daily_trivia_attempts', 'daily_prompt_ratings', 'daily_engagement_settings', 'daily_member_preferences',
  'daily_point_events', 'daily_seasons', 'daily_milestone_roles', 'daily_role_grants', 'censor_words'];
test.beforeEach(() => { for (const table of tables) db.exec(`DELETE FROM ${table}`); });
test.after(() => { db.close(); fs.rmSync(temp, { recursive: true, force: true }); });

function sandbox() {
  const channels = new Collection();
  const members = new Collection();
  const roles = new Collection();
  const bot = { id: 'bot', roles: { highest: { position: 100 } }, permissions: new PermissionsBitField(PermissionFlagsBits.ManageRoles) };
  const guild = { id: 'guild', ownerId: 'owner', name: 'Sandbox', members: { me: bot,
    fetch: async id => members.get(id) || { id, roles: { cache: new Collection(), add: async () => {} } } },
    roles: { fetch: async id => roles.get(id) } };
  const client = { user: { id: 'bot', tag: 'Jabster Studios' }, guilds: { cache: new Collection([['guild', guild]]) },
    channels: { fetch: async id => {
      if (!channels.has(id)) throw Object.assign(new Error('Unknown channel'), { code: 10003 });
      return channels.get(id);
    } }, users: { fetch: async id => ({ createDM: async () => channels.get(`dm-${id}`) || channel(`dm-${id}`) }) } };
  guild.channels = client.channels;
  let sequence = 0;
  function channel(id) {
    const messages = new Collection();
    const result = { id, guild, sent: 0, locked: false, archived: false,
      permissionsFor: () => ({ has: () => true }), isTextBased: () => true,
      messages: { fetch: async key => {
        if (key?.message) key = key.message;
        if (typeof key === 'object') return messages;
        if (!messages.has(key)) throw Object.assign(new Error('Unknown message'), { code: 10008 });
        return messages.get(key);
      } }, send: async payload => {
        result.sent++;
        const message = { id: `message-${++sequence}`, author: client.user, channel: result,
          embeds: [], components: [], content: '',
          edit: async update => {
            if (update.embeds) message.embeds = update.embeds.map(embed => EmbedBuilder.from(embed));
            if (update.components) message.components = update.components;
            if (update.content != null) message.content = update.content;
            return message;
          }, startThread: async () => {
            const thread = channel(message.id);
            thread.isThread = () => true;
            thread.setArchived = async value => { thread.archived = value; };
            return thread;
          } };
        await message.edit(payload);
        messages.set(message.id, message);
        return message;
      } };
    channels.set(id, result);
    return result;
  }
  const main = channel('main');
  return { client, guild, channel, channels, members, roles, main };
}

async function postActivity(context, type = 'GAME', random = () => 0) {
  service.updateDailyInteractionConfig('guild', { channelId: 'main', enabled: 1, discussionEnabled: 1, timezone: 'UTC', hour: 0, minute: 0 });
  const result = await service.sendDailyInteraction({ client: context.client,
    config: service.getDailyInteractionConfig('guild'), type, random });
  return get('SELECT * FROM daily_interaction_posts WHERE messageId = ?', [result.message.id]);
}

function request(context, post, userId, answer) {
  return { client: context.client, guild: context.guild, member: { id: userId },
    user: { id: userId, tag: userId, toString: () => `<@${userId}>` },
    customId: `dailyinteraction_answer_${post.messageId}`, inGuild: () => true,
    isButton: () => false, isModalSubmit: () => true,
    fields: { getTextInputValue: () => answer },
    deferReply: async function () { this.deferred = true; },
    editReply: async function (payload) { this.response = payload; },
    reply: async function (payload) { this.response = payload; } };
}

test('custom trivia saves safe answer aliases and explanation, and snapshots them into the posted round', async () => {
  const context = sandbox();
  service.addCustomPrompt({ guildId: 'guild', type: 'TRIVIA', prompt: 'What is the capital city of the UK?',
    answer: 'London', aliases: 'City of London|london', explanation: 'London is the capital of the United Kingdom.', createdBy: 'manager' });
  const post = await postActivity(context, 'TRIVIA', () => 0.9999);
  const activity = activities.activityFor(post);
  assert.deepEqual(activity.answers, ['London', 'City of London']);
  assert.match(activity.explanation, /United Kingdom/);
  assert.equal(require('../utils/dailyInteractionSafety').supportsSubmittedAnswer(post), true);
  const interaction = request(context, post, 'member', 'City of London');
  await events.execute(interaction);
  assert.equal(get('SELECT correct FROM daily_trivia_attempts').correct, 1);
  run('DELETE FROM daily_interaction_prompts');
  assert.deepEqual(activities.activityFor(get('SELECT * FROM daily_interaction_posts')).answers, activity.answers);
});

test('trivia rejects missing or unsafe answer metadata, overly long answers and excessive aliases', () => {
  const base = { guildId: 'guild', type: 'TRIVIA', prompt: 'Which city is the capital of the UK?', createdBy: 'manager' };
  for (const metadata of [{}, { answer: 'London' }, { answer: 'London', explanation: 'Visit https://example.com' },
    { answer: '.fuck', explanation: 'Safe explanation.' }, { answer: 'x'.repeat(101), explanation: 'Explanation.' },
    { answer: 'London', aliases: Array(11).fill('another'), explanation: 'Explanation.' }]) {
    assert.throws(() => service.addCustomPrompt({ ...base, ...metadata }));
  }
  assert.equal(all('SELECT * FROM daily_interaction_prompts').length, 0);
  const id = service.addCustomPrompt({ ...base, answer: 'London', aliases: null, explanation: 'London is the capital city.' });
  assert.deepEqual(JSON.parse(get('SELECT triviaJson FROM daily_interaction_prompts WHERE id = ?', [Number(id)]).triviaJson).answers, ['London']);
});

test('rating controls fit beside all four choice buttons without exceeding Discord row limits', () => {
  const rows = service.buildInteractionComponents({ canSubmitAnswers: true, interaction: { type: 'COMMUNITY_PICK' },
    activity: { mode: 'choice', choices: ['One', 'Two', 'Three', 'Four'] } }).map(row => row.toJSON());
  assert.equal(rows[0].components.length, 5);
  assert.equal(rows[1].components[0].custom_id, 'dailyinteraction_rate');
  assert.equal(rows[1].components[0].options.length, 5);
});

test('ratings persist once per member and queue private feedback into the hardcoded fact-review channel', async () => {
  const context = sandbox();
  context.channel(reviews.reviewChannelId());
  const post = await postActivity(context, 'TRIVIA');
  const { savePromptRating } = require('../utils/dailyPromptRatings');
  const row = savePromptRating(post, 'member', 5);
  assert.equal(row.channelId, reviews.reviewChannelId());
  assert.equal(savePromptRating(post, 'member', 1), null);
  assert.throws(() => savePromptRating(post, 'other', 6));
  assert.throws(() => savePromptRating(post, 'other', 4, post.sentAt + 86400000));
  await delivery.recoverDailyDeliveries(context.client, ['DAILY_PROMPT_RATING']);
  await delivery.recoverDailyDeliveries(context.client, ['DAILY_PROMPT_RATING']);
  assert.equal(context.channels.get(reviews.reviewChannelId()).sent, 1);
  assert.equal(get('SELECT rating FROM daily_prompt_ratings').rating, 5);
  assert.equal(get("SELECT finalizedAt FROM delivery_outbox WHERE type = 'DAILY_PROMPT_RATING'").finalizedAt > 0, true);
});

test('rating interaction rejects copied controls and accepts the original activity', async () => {
  const context = sandbox();
  context.channel(reviews.reviewChannelId());
  const post = await postActivity(context, 'TRIVIA');
  const original = await context.main.messages.fetch(post.messageId);
  const interaction = { ...request(context, post, 'member'), customId: 'dailyinteraction_rate',
    isModalSubmit: () => false, isStringSelectMenu: () => true, message: original, values: ['4'],
    channel: context.main, channelId: 'wrong-channel' };
  await events.execute(interaction);
  assert.match(interaction.response.content, /original/);
  assert.equal(all('SELECT * FROM daily_prompt_ratings').length, 0);
  interaction.channelId = 'main';
  await events.execute(interaction);
  assert.equal(get('SELECT rating FROM daily_prompt_ratings').rating, 4);
});

test('custom trivia, ratings and queued feedback survive a fresh bot process', async () => {
  const context = sandbox();
  const id = service.addCustomPrompt({ guildId: 'guild', type: 'TRIVIA', prompt: 'Which planet do humans live on?',
    answer: 'Earth', aliases: 'the Earth', explanation: 'Humans live on Earth.', createdBy: 'manager' });
  const post = await postActivity(context, 'TRIVIA', () => 0.9999);
  require('../utils/dailyPromptRatings').savePromptRating(post, 'member', 5);
  const script = `const {initDatabase,get,db}=require('./database');initDatabase();
    const prompt=get('SELECT triviaJson FROM daily_interaction_prompts WHERE id=?',[${Number(id)}]);
    if(JSON.parse(prompt.triviaJson).answers[0]!=='Earth')process.exit(2);
    if(get('SELECT rating FROM daily_prompt_ratings').rating!==5)process.exit(3);
    if(get("SELECT status FROM delivery_outbox WHERE type='DAILY_PROMPT_RATING'").status!=='PENDING')process.exit(4);db.close();`;
  const child = spawnSync(process.execPath, ['-e', script], { cwd: path.resolve(__dirname, '..'), env: { ...process.env }, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
});

test('retired and superseded queued built-in facts are cancelled before delivery', async () => {
  const context = sandbox();
  const catalogue = require('../data/dailyFacts.json');
  for (const [index, item] of require('../data/dailyFactReview.json').entries.filter(row => row.status === 'RETIRED' || row.replacement).entries()) {
    const original = catalogue[item.category].find(row => typeof row === 'string' && row.startsWith(item.startsWith));
    const queued = delivery.queueDailyDelivery({ deliveryKey: `old-fact:${index}`, type: 'DAILY_FACT_POST',
      guildId: 'guild', channelId: 'main', metadata: { selection: { source: 'coded', category: item.category, fact: original } },
      message: { embeds: [new EmbedBuilder().setDescription(original)] } });
    const result = await delivery.attemptDailyDelivery(context.client, queued);
    assert.equal(result.status, 'CANCELLED', item.startsWith);
  }
  assert.equal(context.main.sent, 0);
});

test('corrected built-in facts keep their cooldown even when an approved community copy wins deduplication', () => {
  const item = require('../data/dailyFactReview.json').entries.find(row => row.replacement);
  const original = require('../data/dailyFacts.json')[item.category].find(row => typeof row === 'string' && row.startsWith(item.startsWith));
  facts.saveApprovedFact({ fact: item.replacement, category: item.category });
  const row = facts.getFactsForCategory(item.category).find(row => row.fact === item.replacement);
  assert.equal(row.source, 'community');
  assert.ok(row.legacyFactKeys.includes(`fact:${facts.normalizeFact(original)}`));
  const now = Date.now();
  run('INSERT INTO dailyfact_delivery_history (guildId, factKey, deliveredAt) VALUES (?, ?, ?)',
    ['guild', `fact:${facts.normalizeFact(original)}`, now - 86400000]);
  const eligible = require('../services/DailyFactService').eligibleFacts({ guildId: 'guild', category: item.category, now });
  assert.equal(eligible.some(entry => entry.fact === item.replacement), false);
});

test('legacy fact review decisions resolve uniquely, remove retired claims and preserve corrected cooldown aliases', () => {
  const catalogue = require('../data/dailyFacts.json');
  const review = require('../data/dailyFactReview.json');
  const pool = facts.buildDailyFactPools().all;
  for (const item of review.entries) {
    const matches = catalogue[item.category].filter(entry => (typeof entry === 'string' ? entry : entry.fact).startsWith(item.startsWith));
    assert.equal(matches.length, 1, item.startsWith);
    const original = typeof matches[0] === 'string' ? matches[0] : matches[0].fact;
    if (item.status === 'RETIRED') assert.equal(pool.some(row => row.fact === original), false, item.startsWith);
    else {
      const row = pool.find(row => row.fact === (item.replacement || original));
      assert.ok(row?.verifiedAt, item.startsWith);
      assert.equal(row.sourceUrl, item.sourceUrl);
      assert.ok(row.legacyFactKeys.includes(`fact:${facts.normalizeFact(original)}`));
    }
  }
  assert.ok(pool.some(row => row.reviewStatus === 'UNVERIFIED' && !row.verifiedAt));
});

test('source URLs accept public HTTPS pages and reject unsafe schemes and credentials', () => {
  assert.equal(sources.validateSourceUrl('https://science.nasa.gov/jupiter/'), 'https://science.nasa.gov/jupiter/');
  for (const url of ['javascript:alert(1)', 'http://example.com', 'https://a:b@example.com',
    'https://127.0.0.1/', 'https://localhost/', 'https://example.local/', 'https://example.com:8443/']) {
    assert.throws(() => sources.validateSourceUrl(url));
  }
});

test('approved source metadata reaches every server pool without claiming unverified facts are verified', () => {
  const fact = facts.saveApprovedFact({ fact: 'A verified fixture has a persistent authoritative source.', category: 'science',
    sourceUrl: 'https://science.nasa.gov/', verifiedAt: 123456000, verifiedBy: 'reviewer', verificationNote: 'Checked primary source.' });
  const pooled = facts.getFactsForCategory('random').find(row => row.id === fact.id);
  assert.equal(pooled.sourceUrl, fact.sourceUrl);
  assert.equal(pooled.verifiedAt, 123456000);
  assert.match(sources.sourceFields(pooled)[1].value, /Reviewed/);
  assert.match(sources.sourceFields({})[0].value, /Not source-verified/);
  const before = all('SELECT * FROM dailyfact_facts').length;
  assert.throws(() => facts.saveApprovedFact({ fact: 'An unsafe source must not create a partial fact row.', sourceUrl: 'http://localhost/' }));
  assert.equal(all('SELECT * FROM dailyfact_facts').length, before);
});

test('Verify & Approve records the source, reviewer, date, and checklist completion', async () => {
  const context = sandbox();
  const review = context.channel(reviews.reviewChannelId());
  const result = run(`INSERT INTO dailyfact_submissions (guildId, userId, fact, category, submittedAt)
    VALUES ('guild', 'author', 'A reviewed example with a source and verification checklist.', 'science', ?)`, [Date.now()]);
  const submission = get('SELECT * FROM dailyfact_submissions WHERE id = ?', [result.lastInsertRowid]);
  await delivery.attemptDailyDelivery(context.client, reviews.queueFactReview(submission));
  const saved = get('SELECT * FROM dailyfact_submissions WHERE id = ?', [submission.id]);
  const interaction = { client: context.client, guild: context.guild, channelId: reviews.reviewChannelId(),
    message: await review.messages.fetch(saved.reviewMessageId), user: { id: 'owner', tag: 'Owner' },
    customId: `dailyfact_verifymodal_${submission.id}`, type: InteractionType.ModalSubmit, isButton: () => false,
    fields: { getTextInputValue: name => ({ fact: submission.fact, source: 'https://science.nasa.gov/', checklist: 'CHECKED', note: 'Verified context and date.' })[name] },
    deferUpdate: async () => {}, followUp: async function (payload) { this.response = payload; } };
  await reviewEvents.execute(interaction);
  const approved = get('SELECT * FROM dailyfact_facts');
  assert.equal(approved.verifiedBy, 'owner');
  assert.ok(approved.verifiedAt > 0);
  assert.equal(approved.verificationNote, 'Verified context and date.');
  assert.equal(get('SELECT status FROM dailyfact_submissions').status, 'APPROVED');
});

test('word chains progress from the latest word, reject repeats, and require alternating players', async () => {
  const context = sandbox();
  const post = await postActivity(context);
  await events.execute(request(context, post, 'one', 'earth'));
  const wrong = request(context, post, 'two', 'eagle');
  await events.execute(wrong);
  assert.match(wrong.response.content, /letter H/);
  const same = request(context, post, 'one', 'house');
  await events.execute(same);
  assert.match(same.response.content, /another member/);
  await events.execute(request(context, post, 'two', 'house'));
  const repeat = request(context, post, 'one', 'earth');
  await events.execute(repeat);
  assert.match(repeat.response.content, /already been used/);
  assert.equal(activities.gameState(post).lastWord, 'house');
  assert.equal(activities.gameState(post).version, 2);
  const source = await context.main.messages.fetch(post.messageId);
  assert.match(source.embeds[0].data.fields.find(field => field.name === 'Current Game').value, /house/);
});

test('concurrent game turns cannot both advance from the same old word', async () => {
  const context = sandbox();
  const post = await postActivity(context);
  const one = request(context, post, 'one', 'earth');
  const two = request(context, post, 'two', 'eagle');
  await Promise.all([events.execute(one), events.execute(two)]);
  assert.equal(activities.gameState(post).version, 1);
  assert.match(two.response.content, /letter H/);
});

test('extra turns do not farm response points or overwrite earlier turn messages', async () => {
  const context = sandbox();
  const post = await postActivity(context);
  await events.execute(request(context, post, 'one', 'earth'));
  await events.execute(request(context, post, 'two', 'house'));
  await events.execute(request(context, post, 'one', 'eagle'));
  assert.equal(context.channels.get(post.messageId).sent, 3);
  assert.equal(get("SELECT SUM(points) AS score FROM daily_point_events WHERE userId = 'one'").score, 3);
  assert.equal(service.getMemberEngagementStats('guild', 'one').totalResponses, 1);
});

test('one-word stories accumulate validated turns rather than replacing each member answer', async () => {
  const context = sandbox();
  const post = await postActivity(context, 'GAME', () => 0.45);
  assert.equal(activities.activityFor(post).mode, 'story');
  await events.execute(request(context, post, 'one', 'Once'));
  await events.execute(request(context, post, 'two', 'upon'));
  await events.execute(request(context, post, 'one', 'time'));
  assert.equal(activities.gameState(post).story, 'Once upon time');
  const unsafe = request(context, post, 'two', '.fuck');
  await events.execute(unsafe);
  assert.equal(activities.gameState(post).version, 3);
  assert.match(unsafe.response.content, /family-friendly/);
});

test('failed game turns reserve the next turn and advance only after confirmed delivery', async t => {
  const context = sandbox();
  const post = await postActivity(context);
  const source = await context.main.messages.fetch(post.messageId);
  const thread = await service.getOrCreateDiscussionThread({ guild: context.guild, message: source, post });
  const send = thread.send;
  thread.send = async () => { throw new Error('temporary'); };
  t.mock.method(console, 'error', () => {});
  await events.execute(request(context, post, 'one', 'earth'));
  assert.equal(activities.gameState(post).version, 0);
  const blocked = request(context, post, 'two', 'eagle');
  await events.execute(blocked);
  assert.match(blocked.response.content, /previous turn/);
  thread.send = send;
  run('UPDATE delivery_outbox SET nextAttemptAt = 0');
  await delivery.recoverDailyDeliveries(context.client);
  assert.equal(activities.gameState(post).lastWord, 'earth');
  await delivery.recoverDailyDeliveries(context.client);
  assert.equal(thread.sent, 1);
});

test('trivia accepts one private first attempt and reveals only after its persisted closing time', async () => {
  const context = sandbox();
  engagement.configureEngagement('guild', { triviaMinutes: 1 });
  const post = await postActivity(context, 'TRIVIA');
  const right = request(context, post, 'one', 'Jupiter');
  const wrong = request(context, post, 'two', 'Mars');
  await events.execute(right);
  await events.execute(wrong);
  assert.equal(right.response.content, wrong.response.content);
  assert.equal(all('SELECT * FROM daily_trivia_attempts').length, 2);
  assert.equal(all('SELECT * FROM daily_interaction_responses').length, 0);
  assert.equal(context.channels.size, 1);
  await events.execute(request(context, post, 'two', 'Jupiter'));
  assert.equal(get("SELECT correct FROM daily_trivia_attempts WHERE userId = 'two'").correct, 0);
  const source = await context.main.messages.fetch(post.messageId);
  await activities.maintainActivities(context.client, post.sentAt + 30_000);
  assert.equal(source.embeds[0].data.fields.some(field => field.name === 'Trivia Result'), false);
  await activities.maintainActivities(context.client, post.sentAt + 61_000);
  assert.match(source.embeds[0].data.fields.find(field => field.name === 'Trivia Result').value, /1 correct out of 2/);
  assert.equal(source.components.length, 0);
  assert.ok(get('SELECT triviaRevealedAt FROM daily_interaction_posts').triviaRevealedAt);
});

test('closed trivia cannot accept a late modal even before its buttons are refreshed', async () => {
  const context = sandbox();
  engagement.configureEngagement('guild', { triviaMinutes: 1 });
  const post = await postActivity(context, 'TRIVIA');
  run('UPDATE daily_interaction_posts SET sentAt = ?', [Date.now() - 61_000]);
  const late = request(context, post, 'one', 'Jupiter');
  await events.execute(late);
  assert.match(late.response.content, /closed/);
  assert.equal(all('SELECT * FROM daily_trivia_attempts').length, 0);
});

test('simple choices use buttons and can change votes without farming points or leaving a stale tally', async () => {
  const context = sandbox();
  const post = await postActivity(context, 'THIS_OR_THAT');
  const source = await context.main.messages.fetch(post.messageId);
  const components = source.components.flatMap(row => (row.toJSON?.() || row).components);
  assert.equal(components.some(component => component.custom_id === 'dailyinteraction_choice_0'), true);
  assert.equal(components.some(component => component.custom_id === 'dailyinteraction_answer'), false);
  for (const index of [0, 1, 0, 1, 0]) {
    const click = request(context, post, 'one');
    Object.assign(click, { customId: `dailyinteraction_choice_${index}`, message: source,
      isButton: () => true, isModalSubmit: () => false });
    await events.execute(click);
    const field = source.embeds[0].data.fields.find(field => field.name === 'Choice Results');
    const choices = activities.activityFor(post).choices;
    assert.ok(field.value.includes(`**${choices[index]}**: 1`), field.value);
  }
  assert.equal(context.channels.get(post.messageId).sent, 1);
  assert.equal(get('SELECT SUM(points) AS points FROM daily_point_events').points, 3);
});

test('larger choices use a dropdown and reject forged or unavailable indexes', async () => {
  const context = sandbox();
  const post = await postActivity(context, 'THIS_OR_THAT');
  const source = await context.main.messages.fetch(post.messageId);
  const forged = request(context, post, 'one');
  Object.assign(forged, { customId: 'dailyinteraction_choice_999', message: source, isButton: () => true, isModalSubmit: () => false });
  await events.execute(forged);
  assert.match(forged.response.content, /no longer available/);
  assert.equal(all('SELECT * FROM daily_interaction_participants').length, 0);
  const builder = service.buildInteractionComponents;
  assert.equal(typeof builder, 'function');
  const rows = builder({ canSubmitAnswers: true, interaction: { type: 'COMMUNITY_PICK', prompt: 'Pick: A, B, C, D, or E.' },
    activity: { mode: 'choice', choices: ['A', 'B', 'C', 'D', 'E'] } });
  assert.equal(rows[1].toJSON().components[0].type, 3);
});

test('quiet days use the configured timezone and cancel queued automatic posts', async () => {
  const context = sandbox();
  const post = await postActivity(context);
  const now = Date.now();
  const local = service.getDateParts(new Date(now), 'UTC');
  engagement.setQuietDay('guild', local.dayOfWeek, true);
  assert.equal(engagement.isQuietDay('guild', now), true);
  const row = delivery.queueDailyDelivery({ deliveryKey: 'quiet', type: 'DAILY_INTERACTION_POST', guildId: 'guild', channelId: 'main',
    message: { content: 'Must not send' }, metadata: { dateKey: local.dateKey } });
  assert.equal((await delivery.attemptDailyDelivery(context.client, row)).status, 'CANCELLED');
  assert.equal(context.main.sent, 1);
  engagement.setQuietDay('guild', local.dayOfWeek, false);
  assert.equal(engagement.isQuietDay('guild', now), false);
  assert.ok(post);
});

test('reminders require server enablement and user opt-in, then deliver once', async () => {
  const context = sandbox();
  const post = await postActivity(context);
  run('UPDATE daily_interaction_posts SET sentAt = ?', [Date.now() - 10 * 60_000]);
  engagement.configureEngagement('guild', { remindersEnabled: 1, reminderDelayMinutes: 5 });
  await engagement.sendReminders(context.client);
  assert.equal(context.channels.has('dm-one'), false);
  engagement.setReminderPreference('guild', 'one', true);
  await engagement.sendReminders(context.client);
  await engagement.sendReminders(context.client);
  assert.equal(context.channels.get('dm-one').sent, 1);
  assert.match((await context.channels.get('dm-one').messages.fetch({})).first().content, new RegExp(post.messageId));
});

test('joined members and members without source-channel access do not get reminder DMs', async () => {
  const context = sandbox();
  const post = await postActivity(context);
  run('UPDATE daily_interaction_posts SET sentAt = ?', [Date.now() - 10 * 60_000]);
  engagement.configureEngagement('guild', { remindersEnabled: 1, reminderDelayMinutes: 5 });
  for (const id of ['joined', 'removed']) engagement.setReminderPreference('guild', id, true);
  run('INSERT INTO daily_interaction_participants (messageId, userId, joinedAt) VALUES (?, ?, ?)', [post.messageId, 'joined', Date.now()]);
  context.main.permissionsFor = () => ({ has: () => false });
  await engagement.sendReminders(context.client);
  assert.equal(context.channels.has('dm-joined'), false);
  assert.equal(context.channels.has('dm-removed'), false);
});

test('opting out cancels reminder retries across restarts', async () => {
  const context = sandbox();
  const post = await postActivity(context);
  engagement.configureEngagement('guild', { remindersEnabled: 1 });
  engagement.setReminderPreference('guild', 'one', true);
  delivery.queueDailyDelivery({ deliveryKey: 'reminder-pending', type: 'DAILY_REMINDER', guildId: 'guild',
    message: { content: 'Must not send' }, metadata: { postId: post.messageId, userId: 'one' } });
  engagement.setReminderPreference('guild', 'one', false);
  await delivery.recoverDailyDeliveries(context.client);
  assert.equal(context.channels.has('dm-one'), false);
  assert.equal(get("SELECT status FROM delivery_outbox WHERE deliveryKey = 'reminder-pending'").status, 'CANCELLED');
});

test('seasonal points respect a daily cap, prevent duplicate awards, and preserve old seasons', () => {
  engagement.configureEngagement('guild', { dailyPointCap: 4 });
  const dateKey = '2026-10-17';
  const event = { guildId: 'guild', userId: 'one', messageId: 'one', dateKey, joined: true, responded: true };
  engagement.creditParticipation(event);
  engagement.creditParticipation(event);
  engagement.creditParticipation({ ...event, messageId: 'two' });
  assert.equal(engagement.seasonLeaderboard('guild')[0].points, 4);
  const oldSeason = engagement.engagementSettings('guild').seasonId;
  const newSeason = engagement.startSeason('guild', 'Winter Season');
  engagement.creditParticipation({ ...event, messageId: 'three' });
  assert.equal(engagement.seasonLeaderboard('guild').length, 0);
  assert.equal(engagement.seasonLeaderboard('guild', oldSeason)[0].points, 4);
  engagement.creditParticipation({ ...event, messageId: 'four', dateKey: '2026-10-18' });
  assert.equal(engagement.seasonLeaderboard('guild', newSeason)[0].points, 3);
});

test('milestone roles reject staff privileges and recheck safety before granting', async () => {
  const context = sandbox();
  const actor = { id: 'owner' };
  const role = { id: 'reward', position: 10, permissions: new PermissionsBitField(0n), managed: false };
  context.roles.set(role.id, role);
  engagement.addMilestone(context.guild, role, 3, actor);
  engagement.creditParticipation({ guildId: 'guild', userId: 'one', messageId: 'one', dateKey: '2026-10-17', joined: true, responded: true });
  role.permissions = new PermissionsBitField(PermissionFlagsBits.ManageMessages);
  await engagement.applyMilestones(context.client);
  assert.equal(get('SELECT status FROM daily_role_grants').status, 'CANCELLED');
  assert.throws(() => engagement.addMilestone(context.guild, role, 3, actor), /staff permissions/);
});

test('milestone grant retries do not award the same role twice and removing rewards cancels pending work', async () => {
  const context = sandbox();
  const role = { id: 'reward', position: 10, permissions: new PermissionsBitField(0n), managed: false };
  context.roles.set(role.id, role);
  let assigned = 0;
  const cache = new Collection();
  context.members.set('one', { id: 'one', roles: { cache, add: async () => { assigned++; cache.set(role.id, role); } } });
  engagement.addMilestone(context.guild, role, 3, { id: 'owner' });
  engagement.creditParticipation({ guildId: 'guild', userId: 'one', messageId: 'one', dateKey: '2026-10-17', joined: true, responded: true });
  await engagement.applyMilestones(context.client);
  await engagement.applyMilestones(context.client);
  assert.equal(assigned, 1);
  assert.equal(get('SELECT status FROM daily_role_grants').status, 'GRANTED');
  engagement.creditParticipation({ guildId: 'guild', userId: 'two', messageId: 'two', dateKey: '2026-10-17', joined: true, responded: true });
  engagement.removeMilestone('guild', 'reward');
  await engagement.applyMilestones(context.client);
  assert.equal(assigned, 1);
});

test('new command definitions serialize and configuration enforces runtime permissions', async () => {
  const config = require('../commands/config/dailysettings');
  for (const module of [config, require('../commands/fun/daily'), require('../commands/fun/dailyfactsource')]) {
    const definition = module.data.toJSON();
    assert.ok(definition.name);
    assert.ok(definition.options.length <= 25);
  }
  const interaction = { memberPermissions: new PermissionsBitField(0n), editReply: async function (payload) { this.response = payload; } };
  await config.execute(interaction);
  assert.match(interaction.response.content, /Manage Server/);
});

test('game turns, private attempts, opt-ins, settings, scores, and sources survive a fresh process', async () => {
  const context = sandbox();
  const post = await postActivity(context);
  await events.execute(request(context, post, 'one', 'earth'));
  engagement.configureEngagement('guild', { remindersEnabled: 1, triviaMinutes: 15 });
  engagement.setReminderPreference('guild', 'one', true);
  engagement.setQuietDay('guild', 2, true);
  facts.saveApprovedFact({ fact: 'A sourced fact should retain its source after a restart.', sourceUrl: 'https://science.nasa.gov/', verifiedAt: 1, verifiedBy: 'owner' });
  const trivia = await postActivity(context, 'TRIVIA');
  await events.execute(request(context, trivia, 'one', 'Jupiter'));
  const child = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict'); const {initDatabase, get, db} = require('./database'); initDatabase();
    const games = require('./utils/dailyActivities'); const settings = require('./utils/dailyEngagement');
    const post = get('SELECT * FROM daily_interaction_posts WHERE messageId = ?', [${JSON.stringify(post.messageId)}]);
    assert.equal(games.gameState(post).lastWord, 'earth');
    assert.equal(settings.engagementSettings('guild').triviaMinutes, 15);
    assert.equal(get('SELECT reminders FROM daily_member_preferences').reminders, 1);
    assert.equal(get('SELECT correct FROM daily_trivia_attempts').correct, 1);
    assert.ok(get('SELECT sourceUrl FROM dailyfact_facts').sourceUrl);
    assert.ok(settings.seasonLeaderboard('guild')[0].points > 0); db.close();
  `], { cwd: path.resolve(__dirname, '..'), env: { ...process.env }, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});

test('stale Discord message objects cannot erase the latest game state during a later join', async () => {
  const context = sandbox();
  const post = await postActivity(context);
  const fetch = context.main.messages.fetch;
  context.main.messages.fetch = async key => {
    const canonical = await fetch(key);
    if (!canonical.id) return canonical;
    const snapshot = { ...canonical, embeds: canonical.embeds.map(embed => EmbedBuilder.from(embed)) };
    snapshot.edit = async update => { await canonical.edit(update); return { ...canonical }; };
    return snapshot;
  };
  const stale = await context.main.messages.fetch(post.messageId);
  await events.execute(request(context, post, 'one', 'earth'));
  await events.execute(request(context, post, 'two', 'house'));
  const join = request(context, post, 'three');
  Object.assign(join, { message: stale, customId: 'dailyinteraction_join', isButton: () => true, isModalSubmit: () => false });
  await events.execute(join);
  const latest = await context.main.messages.fetch(post.messageId);
  assert.match(latest.embeds[0].data.fields.find(field => field.name === 'Current Game').value, /house/);
  assert.equal(latest.embeds[0].data.fields.find(field => field.name === 'Participants').value, '3');
});

test('dropdown submissions use the same safe persisted voting flow as buttons', async () => {
  const context = sandbox();
  const post = await postActivity(context, 'COMMUNITY_PICK');
  const choices = ['Apples', 'Bananas', 'Cherries', 'Dates', 'Grapes'];
  run('UPDATE daily_interaction_posts SET prompt = ?, activityJson = ? WHERE messageId = ?',
    ['Pick a snack: Apples, Bananas, Cherries, Dates, or Grapes.', JSON.stringify({ mode: 'choice', choices }), post.messageId]);
  const menu = request(context, post, 'one');
  Object.assign(menu, { message: await context.main.messages.fetch(post.messageId), customId: 'dailyinteraction_choice',
    isModalSubmit: () => false, isStringSelectMenu: () => true, values: ['1'] });
  await events.execute(menu);
  assert.equal(get('SELECT response FROM daily_interaction_responses').response, 'Bananas');
  assert.equal(get('SELECT SUM(points) AS score FROM daily_point_events').score, 3);
});

test('a lost game-send response recovers the same turn and awards points only once', async t => {
  const context = sandbox();
  const post = await postActivity(context);
  const source = await context.main.messages.fetch(post.messageId);
  const thread = await service.getOrCreateDiscussionThread({ guild: context.guild, message: source, post });
  const send = thread.send;
  let loseResponse = true;
  thread.send = async payload => {
    const message = await send(payload);
    if (loseResponse) { loseResponse = false; throw new Error('Response lost after send'); }
    return message;
  };
  t.mock.method(console, 'error', () => {});
  await events.execute(request(context, post, 'one', 'earth'));
  assert.equal(activities.gameState(post).version, 0);
  run('UPDATE delivery_outbox SET nextAttemptAt = 0');
  await delivery.recoverDailyDeliveries(context.client);
  assert.equal(thread.sent, 1);
  assert.equal(activities.gameState(post).version, 1);
  assert.equal(get('SELECT SUM(points) AS score FROM daily_point_events').score, 3);
});

test('failed trivia reveals retry the same message and survive participant-count repair', async t => {
  const context = sandbox();
  engagement.configureEngagement('guild', { triviaMinutes: 1 });
  const post = await postActivity(context, 'TRIVIA');
  await events.execute(request(context, post, 'one', 'Jupiter'));
  const source = await context.main.messages.fetch(post.messageId);
  const edit = source.edit;
  let fail = true;
  source.edit = async payload => {
    const message = await edit(payload);
    if (fail) { fail = false; throw new Error('Lost edit response'); }
    return message;
  };
  t.mock.method(console, 'error', () => {});
  const now = Date.now();
  run('UPDATE daily_interaction_posts SET sentAt = ?, displayedParticipantCount = 0', [now - 61_000]);
  await activities.maintainActivities(context.client, now);
  run('UPDATE delivery_outbox SET nextAttemptAt = 0');
  await delivery.recoverDailyDeliveries(context.client);
  await service.refreshDailyPosts(context.client, now);
  assert.equal(context.main.sent, 1);
  assert.equal(source.embeds[0].data.fields.filter(field => field.name === 'Trivia Result').length, 1);
  assert.equal(source.embeds[0].data.fields.find(field => field.name === 'Status').value, 'Closed');
  assert.equal(source.components.length, 0);
});

test('multiple manual posts do not create multiple reminders for one member on the same day', async () => {
  const context = sandbox();
  await postActivity(context);
  run('UPDATE daily_interaction_posts SET sentAt = ?', [Date.now() - 600_000]);
  engagement.configureEngagement('guild', { remindersEnabled: 1, reminderDelayMinutes: 5 });
  engagement.setReminderPreference('guild', 'one', true);
  await engagement.sendReminders(context.client);
  await postActivity(context);
  run('UPDATE daily_interaction_posts SET sentAt = ?', [Date.now() - 600_000]);
  await engagement.sendReminders(context.client);
  assert.equal(context.channels.get('dm-one').sent, 1);
});

test('quiet weekdays protect streaks without protecting a missed active day', () => {
  service.updateDailyInteractionConfig('guild', { timezone: 'UTC' });
  engagement.setQuietDay('guild', 6, true);
  engagement.setQuietDay('guild', 0, true);
  service.recordMemberEngagement({ guildId: 'guild', userId: 'one', dateKey: '2026-10-16', joined: true,
    now: Date.parse('2026-10-16T12:00Z') });
  assert.equal(service.getMemberEngagementStats('guild', 'one', { now: Date.parse('2026-10-19T12:00Z') }).currentStreak, 1);
  service.recordMemberEngagement({ guildId: 'guild', userId: 'one', dateKey: '2026-10-19', joined: true,
    now: Date.parse('2026-10-19T12:00Z') });
  assert.equal(get('SELECT currentStreak FROM daily_interaction_member_stats').currentStreak, 2);
  assert.equal(service.getMemberEngagementStats('guild', 'one', { now: Date.parse('2026-10-21T12:00Z') }).currentStreak, 0);
});

test('removing a reward while its member is being fetched prevents the grant', async () => {
  const context = sandbox();
  const role = { id: 'reward', position: 10, permissions: new PermissionsBitField(0n), managed: false };
  context.roles.set(role.id, role);
  engagement.addMilestone(context.guild, role, 3, { id: 'owner' });
  engagement.creditParticipation({ guildId: 'guild', userId: 'one', messageId: 'one', dateKey: '2026-10-17', joined: true, responded: true });
  let granted = false;
  context.guild.members.fetch = async () => {
    engagement.removeMilestone('guild', 'reward');
    return { roles: { cache: new Collection(), add: async () => { granted = true; } } };
  };
  await engagement.applyMilestones(context.client);
  assert.equal(granted, false);
});

test('private trivia responses contribute to aggregate answer analytics', async () => {
  const context = sandbox();
  const post = await postActivity(context, 'TRIVIA');
  await events.execute(request(context, post, 'one', 'Jupiter'));
  assert.equal(service.getDailyInteractionAnalytics('guild').responses, 1);
});

test('every stored fact group gains ten unique sourced facts and all additions enter the delivery pool', () => {
  const catalogue = require('../data/dailyFacts.json');
  const oldFacts = new Set(Object.values(catalogue).flat().filter(entry => typeof entry === 'string').map(facts.normalizeFact));
  const added = new Set();
  for (const entries of Object.values(catalogue)) {
    assert.equal(entries.length, 60);
    assert.equal(entries.filter(entry => typeof entry === 'string').length, 50);
    const additions = entries.filter(entry => typeof entry === 'object');
    assert.equal(additions.length, 10);
    for (const entry of additions) {
      const normalized = facts.normalizeFact(entry.fact);
      assert.equal(oldFacts.has(normalized), false, entry.fact);
      assert.equal(added.has(normalized), false, entry.fact);
      added.add(normalized);
      assert.equal(sources.validateSourceUrl(entry.sourceUrl), entry.sourceUrl);
      assert.ok(Number.isFinite(Date.parse(entry.checkedAt)));
    }
  }
  const delivered = facts.getFactsForCategory('random').filter(entry => added.has(facts.normalizeFact(entry.fact)));
  assert.equal(delivered.length, 100);
  assert.equal(delivered.every(entry => entry.sourceUrl && entry.verifiedAt), true);
  for (const { value } of facts.FACT_CATEGORIES) {
    assert.equal(facts.getFactsForCategory(value).filter(entry => added.has(facts.normalizeFact(entry.fact))).length, 10);
  }
});

test('Daily Dilemma replaces server-planning polls with twenty safely answerable scenarios', () => {
  const definition = service.DAILY_INTERACTION_TYPES.COMMUNITY_PICK;
  assert.equal(definition.label, 'Daily Dilemma');
  assert.equal(definition.prompts.length, 20);
  const safety = require('../utils/dailyInteractionSafety');
  for (const prompt of definition.prompts) {
    assert.doesNotMatch(prompt, /future event time|event style|dream server|community reward/i);
    const post = { type: 'COMMUNITY_PICK', prompt };
    assert.equal(safety.validateDailyInteractionPrompt({ prompt }).valid, true, prompt);
    const activity = activities.createActivity(post, engagement.engagementSettings('guild'));
    assert.equal(activity.mode, 'choice');
    assert.equal(activity.choices.length, 4, prompt);
    for (const answer of activity.choices) assert.equal(safety.validateDailyInteractionAnswer({ post, answer }).valid, true, answer);
  }
});

test('footer cleanup preserves its label, icon, and first reference without growing on repeated edits', () => {
  const { cleanDailyFooter } = require('../utils/dailyFooter');
  const first = 'Ref: 123456789012345678901234';
  const second = 'Ref: abcdefabcdefabcdefabcdef';
  let footer = { text: `Daily Interactions | ${first} | ${second}`, icon_url: 'https://example.com/icon.png' };
  for (let index = 0; index < 50; index++) footer = cleanDailyFooter(footer);
  assert.equal(footer.text, `Daily Interactions | ${first}`);
  assert.equal(footer.icon_url, 'https://example.com/icon.png');
  assert.ok(cleanDailyFooter({ text: 'x'.repeat(3000) }, first).text.length <= 2048);
});

test('repeated choice changes keep exactly one stable delivery reference in the live footer', async () => {
  const context = sandbox();
  const post = await postActivity(context, 'COMMUNITY_PICK');
  const source = await context.main.messages.fetch(post.messageId);
  const { dailyReference } = require('../utils/dailyFooter');
  const initial = dailyReference(source.embeds[0].data.footer.text);
  for (const index of [0, 1, 2, 3, 0, 2, 1]) {
    const click = request(context, post, 'one');
    Object.assign(click, { message: source, customId: `dailyinteraction_choice_${index}`, isButton: () => true, isModalSubmit: () => false });
    await events.execute(click);
    assert.equal(source.embeds[0].data.footer.text.match(/Ref:/g).length, 1);
    assert.equal(dailyReference(source.embeds[0].data.footer.text), initial);
  }
});

test('maintenance repairs stacked legacy footers once without changing votes or progress', async () => {
  const context = sandbox();
  const post = await postActivity(context, 'COMMUNITY_PICK');
  const source = await context.main.messages.fetch(post.messageId);
  const first = source.embeds[0].data.footer.text;
  source.embeds[0].setFooter({ text: `${first} | Ref: abcdefabcdefabcdefabcdef | Ref: 123456789012345678901234` });
  run('UPDATE daily_interaction_posts SET footerNormalizedAt = NULL');
  await service.refreshDailyPosts(context.client);
  assert.equal(source.embeds[0].data.footer.text, first);
  assert.ok(get('SELECT footerNormalizedAt FROM daily_interaction_posts').footerNormalizedAt);
  assert.equal(all('SELECT * FROM daily_interaction_participants').length, 0);
  const fetch = context.main.messages.fetch;
  let fetches = 0;
  context.main.messages.fetch = async key => { fetches++; return fetch(key); };
  await service.refreshDailyPosts(context.client);
  assert.equal(fetches, 0);
});

test('a deleted active post does not become an endless footer-repair job', async () => {
  const context = sandbox();
  await postActivity(context);
  run('UPDATE daily_interaction_posts SET footerNormalizedAt = NULL');
  let fetches = 0;
  context.main.messages.fetch = async () => { fetches++; throw Object.assign(new Error('Deleted'), { code: 10008 }); };
  await service.refreshDailyPosts(context.client);
  await service.refreshDailyPosts(context.client);
  assert.equal(fetches, 1);
  assert.ok(get('SELECT footerNormalizedAt FROM daily_interaction_posts').footerNormalizedAt);
});
