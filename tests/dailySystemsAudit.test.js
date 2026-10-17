const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { Collection, EmbedBuilder, InteractionType, PermissionFlagsBits, PermissionsBitField } = require('discord.js');

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jabster-daily-audit-'));
process.env.DATABASE_PATH = path.join(temporaryDirectory, 'database.db');
const { db, initDatabase, run, get, all } = require('../database');
initDatabase();
const facts = require('../utils/dailyFacts');
const FactService = require('../services/DailyFactService');
const activities = require('../services/DailyInteractionService');
const safety = require('../utils/dailyInteractionSafety');
const delivery = require('../utils/dailyDelivery');
const { reviewChannelId, queueFactReview } = require('../utils/dailyFactReview');
const submitFact = require('../commands/fun/dailyfactsubmit');
const reviewFact = require('../events/dailyFactInteractions');
const activityEvents = require('../events/dailyInteractionInteractions');
const activityCommand = require('../commands/config/dailyinteraction');
const factCommand = require('../commands/config/dailyfact');
const { handleDailyInteractionThreadSafety } = require('../events/messageCreate');

test.beforeEach(() => {
  for (const table of ['delivery_outbox', 'dailyfact_config', 'dailyfact_submissions', 'dailyfact_facts',
    'dailyfact_delivery_history', 'daily_interaction_config', 'daily_interaction_posts',
    'daily_interaction_history', 'daily_interaction_prompts', 'daily_interaction_types',
    'daily_interaction_participants', 'daily_interaction_responses', 'daily_interaction_member_stats',
    'daily_interaction_day_themes', 'censor_words']) db.exec(`DELETE FROM ${table}`);
  for (const table of ['daily_game_turns', 'daily_trivia_attempts', 'daily_engagement_settings',
    'daily_point_events', 'daily_seasons', 'daily_milestone_roles', 'daily_role_grants', 'daily_member_preferences']) db.exec(`DELETE FROM ${table}`);
});
test.after(() => { db.close(); fs.rmSync(temporaryDirectory, { recursive: true, force: true }); });

function sandbox() {
  const channels = new Collection();
  const client = { user: { id: 'bot', tag: 'Jabster Studios' },
    channels: { fetch: async id => {
      if (!channels.has(id)) throw Object.assign(new Error('Unknown Channel'), { code: 10003 });
      return channels.get(id);
    } }, guilds: { cache: new Collection() }, users: { fetch: async userId => ({
      createDM: async () => channels.get(`dm-${userId}`) || channel(`dm-${userId}`)
    }) } };
  const guild = { id: 'guild', name: 'Sandbox', members: { me: { id: 'bot' } }, channels: client.channels };
  client.guilds.cache.set('guild', guild);
  let sequence = 0;
  function channel(id) {
    const messages = new Collection();
    const value = { id, guild, sent: 0, archived: false, locked: false,
      isTextBased: () => true, permissionsFor: () => ({ has: () => true }),
      messages: { fetch: async input => {
        if (input?.message) input = input.message;
        if (typeof input === 'object') return messages;
        if (!messages.has(input)) throw Object.assign(new Error('Unknown Message'), { code: 10008 });
        return messages.get(input);
      } },
      send: async payload => {
        value.sent += 1;
        const message = { id: `message-${++sequence}`, author: client.user, channel: value,
          content: payload.content, components: payload.components || [],
          embeds: (payload.embeds || []).map(embed => EmbedBuilder.from(embed)),
          edit: async update => {
            if (update.embeds) message.embeds = update.embeds.map(embed => EmbedBuilder.from(embed));
            if (update.components) message.components = update.components;
            if (update.content !== undefined) message.content = update.content;
            return message;
          },
          delete: async () => { messages.delete(message.id); },
          startThread: async () => {
            const thread = channel(message.id);
            thread.isThread = () => true;
            thread.setArchived = async state => { thread.archived = state; };
            return thread;
          } };
        messages.set(message.id, message);
        return message;
      } };
    channels.set(id, value);
    return value;
  }
  const main = channel('main');
  const review = channel(reviewChannelId());
  return { client, guild, main, review, channel, channels };
}

function addApproved() {
  return facts.saveApprovedFact({ fact: 'A reliable audit fixture is available to every server.',
    category: 'science', userId: 'author', reviewerId: 'owner', submissionId: 999 });
}
function configureFacts() {
  run(`INSERT INTO dailyfact_config (guildId, enabled, channelId, hour, minute, timezone)
    VALUES ('guild', 1, 'main', 0, 0, 'UTC')`);
  return get('SELECT * FROM dailyfact_config WHERE guildId = ?', ['guild']);
}
function configureActivities() {
  activities.updateDailyInteractionConfig('guild', { channelId: 'main', enabled: 1,
    discussionEnabled: 1, hour: 0, minute: 0, timezone: 'UTC' });
  return activities.getDailyInteractionConfig('guild');
}
function drainRetryDelays() { run('UPDATE delivery_outbox SET nextAttemptAt = 0, leaseUntil = NULL'); }
function reviewInteraction(context, submission, action = 'approve') {
  const message = context.review.messages.fetch(submission.reviewMessageId);
  return message.then(source => ({ client: context.client, guild: context.guild,
    guildId: context.guild.id, channelId: reviewChannelId(), user: { id: 'owner', tag: 'Owner' },
    message: source, customId: `dailyfact_${action}_${submission.id}`, type: InteractionType.MessageComponent,
    isButton: () => true, deferred: false,
    deferUpdate: async function () { this.deferred = true; },
    reply: async function (payload) { this.response = payload; },
    followUp: async function (payload) { this.response = payload; } }));
}

test('trailing symbols, repeated profanity, and full-message bypasses remain blocked', () => {
  for (const answer of ['fuck!', 'shit!', 'ass!', 'f u c k!', 'fuckfuck', 'assss', 'biiitch',
    'A normal beginning followed by shit!', '.fuck', '/shit', 'n.i.g.g.e.r!']) {
    assert.equal(safety.validateDailyInteractionContent({ answer }).valid, false, answer);
  }
  for (const answer of ['Amazing news!', 'Our assignment went well.', 'A classic grape variety.']) {
    assert.equal(safety.validateDailyInteractionContent({ answer }).valid, true, answer);
  }
});

test('malformed game prefixes and altered trivia do not enable unverified answers', () => {
  for (const prompt of ['Word chain: whatever you want.', 'Alphabet challenge: nonsense.',
    'Rhyme round: name one word that rhymes with moon.']) {
    const post = { type: 'GAME', prompt };
    assert.equal(safety.supportsSubmittedAnswer(post), false);
    assert.equal(safety.validateDailyInteractionAnswer({ post, answer: 'night' }).valid, false);
  }
  assert.equal(safety.supportsSubmittedAnswer({ type: 'TRIVIA',
    prompt: 'Trivia: Say anything about the largest planet.' }), false);
});

test('emoji rounds count graphemes, flags, modifiers, and joined emoji correctly', () => {
  const post = { type: 'GAME', prompt: 'Emoji story: describe your day using exactly five emojis.' };
  const five = '\u{1F600}\u{1F1EC}\u{1F1E7}\u{1F44D}\u{1F3FD}\u{1F468}\u200D\u{1F469}\u200D\u{1F467}1\uFE0F\u20E3';
  assert.equal(safety.validateDailyInteractionAnswer({ post, answer: five }).valid, true);
  assert.equal(safety.validateDailyInteractionAnswer({ post, answer: five + '\u{1F600}' }).valid, false);
  assert.equal(safety.validateDailyInteractionContent({ answer: 'he\u200bllo' }).valid, false);
});

test('all built-in verifiable activities have a supported rule', () => {
  for (const type of ['GAME', 'TRIVIA', 'WOULD_YOU_RATHER', 'THIS_OR_THAT', 'COMMUNITY_PICK']) {
    for (const prompt of activities.DAILY_INTERACTION_TYPES[type].prompts) {
      assert.equal(safety.supportsSubmittedAnswer({ type, prompt }), true, prompt);
    }
  }
});

test('fact keys remain stable across coded and community sources and honor old history', () => {
  const coded = facts.getFactsForCategory('science')[0];
  facts.saveApprovedFact({ fact: coded.fact, category: 'science', userId: 'author' });
  const community = facts.getFactsForCategory('science').find(row => row.fact === coded.fact);
  assert.equal(community.source, 'community');
  assert.equal(community.factKey, coded.factKey);
  run('INSERT INTO dailyfact_delivery_history VALUES (?, ?, ?)',
    ['guild', `coded:${facts.normalizeFact(coded.fact)}`, Date.now()]);
  assert.equal(FactService.eligibleFacts({ guildId: 'guild', category: 'science' })
    .some(row => row.fact === coded.fact), false);
});

test('fact normalization rejects Unicode duplicate disguises', () => {
  addApproved();
  assert.ok(facts.findDuplicateFact('Ａ reliable audit fixture is available to every ser\u200bver.'));
});

test('a fact becomes eligible exactly after its 30-day cooldown', () => {
  addApproved();
  const fact = facts.getFactsForCategory('science').find(row => row.source === 'community');
  const now = Date.now();
  run('INSERT INTO dailyfact_delivery_history VALUES (?, ?, ?)',
    ['guild', fact.factKey, now - FactService.DELIVERY_COOLDOWN_MS]);
  assert.ok(FactService.eligibleFacts({ guildId: 'guild', onlyCommunity: true, now }).length);
});

test('scheduled facts resume and finalize without posting a second message', async () => {
  const context = sandbox();
  configureFacts();
  await FactService.tick(context.client);
  assert.equal(context.main.sent, 1);
  run('UPDATE delivery_outbox SET finalizedAt = NULL');
  run('DELETE FROM dailyfact_delivery_history');
  run('UPDATE dailyfact_config SET lastSent = NULL');
  await FactService.tick(context.client);
  assert.equal(context.main.sent, 1);
  assert.equal(all('SELECT * FROM dailyfact_delivery_history').length, 1);
  assert.equal(get('SELECT lastSent FROM dailyfact_config').lastSent,
    FactService.getDateParts(new Date(), 'UTC').dateKey);
});

test('a lost Discord send response is recovered by its footer rather than an unavailable nonce', async t => {
  const context = sandbox();
  const config = configureFacts();
  addApproved();
  const actualSend = context.main.send;
  t.mock.method(context.main, 'send', async payload => {
    await actualSend(payload);
    throw new Error('Connection lost after Discord accepted the message');
  });
  await assert.rejects(FactService.sendFact({ client: context.client, config, onlyCommunity: true }), /Connection lost/);
  drainRetryDelays();
  await delivery.recoverDailyDeliveries(context.client);
  assert.equal(context.main.sent, 1);
  assert.equal(get('SELECT status FROM delivery_outbox').status, 'SENT');
  assert.equal(all('SELECT * FROM dailyfact_delivery_history').length, 1);
});

test('queued fact payloads survive a fresh process and retain their chosen fact', async () => {
  const context = sandbox();
  const config = configureFacts();
  addApproved();
  context.main.send = async () => { throw new Error('Offline'); };
  await assert.rejects(FactService.sendFact({ client: context.client, config, onlyCommunity: true }), /Offline/);
  drainRetryDelays();
  const child = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const { db, initDatabase, get } = require('./database'); initDatabase();
    const { recoverDailyDeliveries } = require('./utils/dailyDelivery');
    recoverDailyDeliveries({ user: { id: 'bot' }, channels: { fetch: async () => ({
      isTextBased: () => true, send: async payload => {
        assert.match(payload.embeds[0].description, /reliable audit fixture/);
        return { id: 'recovered' };
      }
    }) } }).then(() => {
      assert.equal(get('SELECT COUNT(*) AS count FROM dailyfact_delivery_history').count, 1); db.close();
    }).catch(error => { console.error(error); process.exitCode = 1; });
  `], { cwd: path.join(__dirname, '..'), env: process.env, encoding: 'utf8', timeout: 15000 });
  assert.equal(child.status, 0, child.stderr || child.stdout);
});

test('disabled schedules cancel a queued post instead of publishing after disable', async () => {
  const context = sandbox();
  const config = configureFacts();
  const dateKey = FactService.getDateParts(new Date(), 'UTC').dateKey;
  const queued = delivery.queueDailyDelivery({ deliveryKey: 'disabled', type: 'DAILY_FACT_POST',
    guildId: 'guild', channelId: 'main', message: { content: 'Queued' }, metadata: { dateKey } });
  run('UPDATE dailyfact_config SET enabled = 0');
  assert.equal((await delivery.attemptDailyDelivery(context.client, queued)).status, 'CANCELLED');
  assert.equal(context.main.sent, 0);
});

test('fact submissions are retained when the review channel is temporarily unavailable', async t => {
  const context = sandbox();
  context.channels.delete(reviewChannelId());
  t.mock.method(console, 'error', () => {});
  const interaction = { client: context.client, guild: context.guild, user: { id: 'submitter' },
    options: { getString: name => name === 'category' ? 'science' : name === 'fact' ? 'A unique submitted fact is retained when delivery fails.' : null },
    editReply: async function (value) { this.response = value; } };
  await submitFact.execute(interaction);
  assert.equal(all('SELECT * FROM dailyfact_submissions').length, 1);
  assert.match(interaction.response.content, /queued for retry/);
  context.channel(reviewChannelId());
  drainRetryDelays();
  await delivery.recoverDailyDeliveries(context.client);
  assert.ok(get('SELECT reviewMessageId FROM dailyfact_submissions').reviewMessageId);
});

test('concurrent identical submissions reserve only one review record', async () => {
  const context = sandbox();
  const make = userId => ({ client: context.client, guild: context.guild, user: { id: userId },
    options: { getString: name => name === 'category' ? 'science' : name === 'fact' ? 'An identical fact should only reserve one review record.' : null },
    editReply: async () => {} });
  await Promise.all([submitFact.execute(make('one')), submitFact.execute(make('two'))]);
  assert.equal(all('SELECT * FROM dailyfact_submissions').length, 1);
  assert.equal(context.review.sent, 1);
});

async function pendingReview(context) {
  const inserted = run(`INSERT INTO dailyfact_submissions (guildId, userId, fact, category, submittedAt)
    VALUES ('guild', 'submitter', 'An approved community fixture becomes available to every server.', 'science', ?)`, [Date.now()]);
  const submission = get('SELECT * FROM dailyfact_submissions WHERE id = ?', [inserted.lastInsertRowid]);
  await delivery.attemptDailyDelivery(context.client, queueFactReview(submission));
  return get('SELECT * FROM dailyfact_submissions WHERE id = ?', [submission.id]);
}

test('review requires the configured channel and original bot message', async () => {
  const context = sandbox();
  const submission = await pendingReview(context);
  const interaction = await reviewInteraction(context, submission);
  interaction.channelId = 'main';
  await reviewFact.execute(interaction);
  assert.match(interaction.response.content, /original message/);
  assert.equal(get('SELECT status FROM dailyfact_submissions').status, 'PENDING');
});

test('approval commits globally once even when the submitter has closed DMs', async t => {
  const context = sandbox();
  context.client.users.fetch = async () => ({ createDM: async () => {
    throw Object.assign(new Error('Cannot send messages to this user'), { code: 50007 });
  } });
  const submission = await pendingReview(context);
  await reviewFact.execute(await reviewInteraction(context, submission));
  assert.equal(get('SELECT status FROM dailyfact_submissions').status, 'APPROVED');
  assert.equal(all('SELECT * FROM dailyfact_facts').length, 1);
  assert.ok(facts.getFactsForCategory('random').some(row => row.fact === submission.fact));
  await reviewFact.execute(await reviewInteraction(context, submission));
  assert.equal(all('SELECT * FROM dailyfact_facts').length, 1);
});

test('denial DMs persist through a temporary fetch error and are delivered once', async t => {
  const context = sandbox();
  const submission = await pendingReview(context);
  const fetchUser = context.client.users.fetch;
  context.client.users.fetch = async () => { throw new Error('Temporary network error'); };
  t.mock.method(console, 'error', () => {});
  await reviewFact.execute(await reviewInteraction(context, submission, 'deny'));
  assert.equal(get('SELECT status FROM dailyfact_submissions').status, 'DENIED');
  context.client.users.fetch = fetchUser;
  drainRetryDelays();
  await delivery.recoverDailyDeliveries(context.client);
  await delivery.recoverDailyDeliveries(context.client);
  assert.equal(context.channels.get('dm-submitter').sent, 1);
});

test('unrelated interactions do not run Daily Fact recovery or receive review errors', async () => {
  run(`INSERT INTO dailyfact_submissions (guildId, userId, fact, status, submittedAt, decisionAt)
    VALUES ('guild', 'user', 'An unrelated review fixture.', 'REVIEWING', 1, 1)`);
  await reviewFact.execute({ isButton: () => true, customId: 'giveaway_join',
    reply: async () => { throw new Error('Must not reply'); } });
  assert.equal(get('SELECT status FROM dailyfact_submissions').status, 'REVIEWING');
});

test('interaction previews do not ping, create participation records, or consume history', async () => {
  const context = sandbox();
  const config = configureActivities();
  config.pingRoleId = 'community-role';
  const result = await activities.sendDailyInteraction({ client: context.client, config,
    type: 'GAME', trackHistory: false, random: () => 0 });
  const preview = await context.main.messages.fetch(result.message.id);
  assert.equal(preview.content, undefined);
  assert.deepEqual(preview.components, []);
  assert.equal(all('SELECT * FROM daily_interaction_posts').length, 0);
  assert.equal(all('SELECT * FROM daily_interaction_history').length, 0);
});

test('scheduled activities recover their post record and do not duplicate across retries', async () => {
  const context = sandbox();
  configureActivities();
  await activities.DailyInteractionService.tick(context.client);
  run('UPDATE delivery_outbox SET finalizedAt = NULL');
  run('DELETE FROM daily_interaction_posts');
  run('UPDATE daily_interaction_config SET lastDateKey = NULL');
  await activities.DailyInteractionService.tick(context.client);
  assert.equal(context.main.sent, 1);
  assert.equal(all('SELECT * FROM daily_interaction_posts').length, 1);
});

test('participant displays recover failed edits and expired posts lose their buttons', async () => {
  const context = sandbox();
  const config = configureActivities();
  const result = await activities.sendDailyInteraction({ client: context.client, config, type: 'GAME' });
  run('INSERT INTO daily_interaction_participants VALUES (?, ?, ?)', [result.message.id, 'member', Date.now()]);
  await activities.refreshDailyPosts(context.client);
  const message = await context.main.messages.fetch(result.message.id);
  assert.equal(message.embeds[0].data.fields.find(field => field.name === 'Participants').value, '1');
  await activities.refreshDailyPosts(context.client, Date.now() + 25 * 60 * 60 * 1000);
  assert.deepEqual(message.components, []);
  assert.equal(message.embeds[0].data.fields.find(field => field.name === 'Status').value, 'Closed');
});

test('thread recovery reuses a thread created before its database write was interrupted', async () => {
  const context = sandbox();
  const config = configureActivities();
  const posted = await activities.sendDailyInteraction({ client: context.client, config, type: 'GAME' });
  const source = await context.main.messages.fetch(posted.message.id);
  const created = await source.startThread();
  const post = get('SELECT * FROM daily_interaction_posts WHERE messageId = ?', [source.id]);
  source.startThread = async () => { throw new Error('Must reuse existing thread'); };
  assert.equal((await activities.getOrCreateDiscussionThread({ guild: context.guild, message: source, post })).id, created.id);
  assert.equal(get('SELECT threadId FROM daily_interaction_posts').threadId, created.id);
});

test('a transient thread fetch error does not start a duplicate thread', async () => {
  const post = { messageId: 'source', threadId: 'existing' };
  await assert.rejects(activities.getOrCreateDiscussionThread({ post,
    guild: { channels: { fetch: async () => { throw new Error('Network error'); } } },
    message: { startThread: async () => { throw new Error('Must not create'); } } }), /Network error/);
});

test('streaks expire in the configured timezone without rewriting lifetime statistics', () => {
  configureActivities();
  activities.recordMemberEngagement({ guildId: 'guild', userId: 'user', joined: true,
    dateKey: '2026-08-01', now: Date.UTC(2026, 7, 1) });
  assert.equal(activities.getMemberEngagementStats('guild', 'user', { now: Date.UTC(2026, 7, 2) }).currentStreak, 1);
  const expired = activities.getMemberEngagementStats('guild', 'user', { now: Date.UTC(2026, 7, 3) });
  assert.equal(expired.currentStreak, 0);
  assert.equal(expired.longestStreak, 1);
  assert.equal(expired.totalJoins, 1);
});

test('black is preserved as a valid configured embed colour', () => {
  assert.equal(activities.buildInteractionEmbed({ guildId: 'guild', color: 0 },
    { type: 'TRIVIA', prompt: 'Trivia: What is the largest planet in our solar system?' }).data.color, 0);
});

test('long prompt lists are paginated within embed limits', async () => {
  configureActivities();
  for (let index = 0; index < 40; index++) activities.addCustomPrompt({ guildId: 'guild', type: 'QUESTION',
    prompt: `Question ${index}: ${'A friendly community question. '.repeat(14)}`, createdBy: 'owner' });
  const interaction = { guild: { id: 'guild' }, user: { id: 'owner' },
    memberPermissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild),
    options: { getSubcommand: () => 'prompt-list', getString: () => null, getInteger: () => 3 },
    editReply: async function (payload) { this.response = payload; } };
  await activityCommand.execute(interaction);
  const embed = interaction.response.embeds[0].toJSON();
  assert.ok(embed.description.length <= 4096);
  assert.match(embed.footer.text, /Page 3\/4/);
  assert.equal(activityCommand.data.toJSON().options.find(option => option.name === 'prompt-list')
    .options.some(option => option.name === 'page'), true);
});

test('Daily Fact configuration enforces runtime permissions', async () => {
  const interaction = { memberPermissions: new PermissionsBitField(),
    editReply: async function (payload) { this.response = payload; } };
  await factCommand.execute(interaction);
  assert.match(interaction.response.content, /Manage Server/);
});

test('ordinary parent-channel messages remain outside daily thread restrictions', async () => {
  const context = sandbox();
  const message = { guild: context.guild, channel: context.main, author: { id: 'user' },
    delete: async () => { throw new Error('Must not delete general chat'); } };
  assert.equal(await handleDailyInteractionThreadSafety(message, context.client), false);
});

async function activityPost(context) {
  const config = configureActivities();
  const sent = await activities.sendDailyInteraction({ client: context.client, config, type: 'GAME', random: () => 0 });
  return { source: await context.main.messages.fetch(sent.message.id),
    post: get('SELECT * FROM daily_interaction_posts WHERE messageId = ?', [sent.message.id]) };
}
function answerRequest(context, post, userId = 'member', answer = 'eagle') {
  return { client: context.client, guild: context.guild, member: { id: userId },
    user: { id: userId, tag: userId, toString: () => `<@${userId}>` },
    customId: `dailyinteraction_answer_${post.messageId}`,
    inGuild: () => true, isButton: () => false, isModalSubmit: () => true,
    fields: { getTextInputValue: () => answer },
    deferReply: async function () { this.deferred = true; },
    editReply: async function (payload) { this.response = payload; },
    reply: async function (payload) { this.response = payload; } };
}

test('legacy concurrent answer updates edit one response and award participation once', async () => {
  const context = sandbox();
  const { post } = await activityPost(context);
  run('UPDATE daily_interaction_posts SET activityJson = NULL WHERE messageId = ?', [post.messageId]);
  const first = answerRequest(context, post);
  const second = answerRequest(context, post, 'member', 'earth');
  await Promise.all([activityEvents.execute(first), activityEvents.execute(second)]);
  assert.equal(all('SELECT * FROM daily_interaction_responses').length, 1);
  assert.equal(get('SELECT response FROM daily_interaction_responses').response, 'earth');
  const stats = activities.getMemberEngagementStats('guild', 'member');
  assert.equal(stats.totalJoins, 1);
  assert.equal(stats.totalResponses, 1);
  assert.equal(context.channels.get(post.messageId).sent, 1);
});

test('concurrent joins keep the final participant display and totals consistent', async () => {
  const context = sandbox();
  const { source, post } = await activityPost(context);
  const requests = Array.from({ length: 12 }, (_, index) => {
    const request = answerRequest(context, post, `member-${index}`);
    request.isButton = () => true;
    request.isModalSubmit = () => false;
    request.customId = 'dailyinteraction_join';
    request.message = source;
    return request;
  });
  await Promise.all(requests.map(request => activityEvents.execute(request)));
  assert.equal(all('SELECT * FROM daily_interaction_participants').length, 12);
  assert.equal(source.embeds[0].data.fields.find(field => field.name === 'Participants').value, '12');
  assert.equal(get('SELECT displayedParticipantCount FROM daily_interaction_posts').displayedParticipantCount, 12);
});

test('failed answers retry from storage and award points only after delivery', async t => {
  const context = sandbox();
  const { source, post } = await activityPost(context);
  const thread = await activities.getOrCreateDiscussionThread({ guild: context.guild, message: source, post });
  const send = thread.send;
  thread.send = async () => { throw new Error('Temporary outage'); };
  t.mock.method(console, 'error', () => {});
  const request = answerRequest(context, post);
  await activityEvents.execute(request);
  assert.match(request.response.content, /queued for delivery/);
  assert.equal(all('SELECT * FROM daily_interaction_participants').length, 0);
  thread.send = send;
  drainRetryDelays();
  await delivery.recoverDailyDeliveries(context.client);
  assert.equal(all('SELECT * FROM daily_interaction_responses').length, 1);
  assert.equal(activities.getMemberEngagementStats('guild', 'member').totalResponses, 1);
  await activities.refreshDailyPosts(context.client);
  assert.equal(source.embeds[0].data.fields.find(field => field.name === 'Participants').value, '1');
});

test('new censor terms are checked again before a queued answer is posted', async t => {
  const context = sandbox();
  const { source, post } = await activityPost(context);
  const thread = await activities.getOrCreateDiscussionThread({ guild: context.guild, message: source, post });
  thread.send = async () => { throw new Error('Temporary outage'); };
  t.mock.method(console, 'error', () => {});
  await activityEvents.execute(answerRequest(context, post));
  require('../utils/censor').addCensorTerm({ guildId: 'guild', word: 'eagle', addedBy: 'owner' });
  drainRetryDelays();
  await delivery.recoverDailyDeliveries(context.client);
  assert.equal(all('SELECT * FROM daily_interaction_responses').length, 0);
  assert.equal(get("SELECT status FROM delivery_outbox WHERE type = 'DAILY_INTERACTION_RESPONSE'").status, 'CANCELLED');
  run('DELETE FROM censor_words WHERE guildId = ?', ['guild']);
});

test('answer errors are caught inside the interaction handler after deferral', async t => {
  const context = sandbox();
  const { source, post } = await activityPost(context);
  source.startThread = async () => { throw new Error('Missing thread permission'); };
  t.mock.method(console, 'error', () => {});
  const request = answerRequest(context, post);
  await activityEvents.execute(request);
  assert.match(request.response.content, /could not complete/);
  assert.equal(request.deferred, true);
});

test('stale answer buttons and modals respect disabled answer submission', async () => {
  const context = sandbox();
  const { post } = await activityPost(context);
  activities.updateDailyInteractionConfig('guild', { discussionEnabled: 0 });
  const request = answerRequest(context, post);
  await activityEvents.execute(request);
  assert.match(request.response.content, /disabled/);
  assert.equal(all('SELECT * FROM daily_interaction_responses').length, 0);
});

test('legacy approved submissions without normalization enter the global library on migration', () => {
  run(`INSERT INTO dailyfact_submissions (guildId, userId, fact, status, category, submittedAt)
    VALUES ('legacy', 'user', 'An approved legacy fact with no normalized column value.', 'APPROVED', 'history', 1)`);
  for (let attempt = 0; attempt < 2; attempt++) {
    const child = spawnSync(process.execPath, ['-e', "const {db,initDatabase}=require('./database');initDatabase();db.close();"],
      { cwd: path.join(__dirname, '..'), env: process.env, encoding: 'utf8', timeout: 15000 });
    assert.equal(child.status, 0, child.stderr || child.stdout);
  }
  assert.equal(all('SELECT * FROM dailyfact_facts').length, 1);
  assert.ok(facts.getFactsForCategory('random').some(row => row.fact.includes('approved legacy fact')));
});

test('backdated engagement recovery cannot rewind a newer streak', () => {
  configureActivities();
  activities.recordMemberEngagement({ guildId: 'guild', userId: 'user', joined: true,
    dateKey: '2026-08-02', now: Date.UTC(2026, 7, 2) });
  activities.recordMemberEngagement({ guildId: 'guild', userId: 'user', joined: true,
    dateKey: '2026-08-01', now: Date.UTC(2026, 7, 1) });
  const stats = get('SELECT * FROM daily_interaction_member_stats');
  assert.equal(stats.lastDateKey, '2026-08-02');
  assert.equal(stats.lastParticipatedAt, Date.UTC(2026, 7, 2));
});

test('random selection skips activity types whose prompts are all blocked', () => {
  configureActivities();
  for (const type of activities.getInteractionTypes('guild')) {
    activities.updateInteractionType({ guildId: 'guild', type: type.type, enabled: ['TRIVIA', 'GAME'].includes(type.type) });
  }
  for (const prompt of activities.DAILY_INTERACTION_TYPES.GAME.prompts) {
    require('../utils/censor').addCensorTerm({ guildId: 'guild', word: prompt, addedBy: 'owner' });
  }
  assert.equal(activities.chooseInteraction({ guildId: 'guild', random: () => 0 }).type, 'TRIVIA');
  run('DELETE FROM censor_words WHERE guildId = ?', ['guild']);
});

test('built-in and duplicate custom prompts share repeat protection', () => {
  configureActivities();
  const first = activities.chooseInteraction({ guildId: 'guild', type: 'GAME', random: () => 0 });
  activities.addCustomPrompt({ guildId: 'guild', type: 'GAME', prompt: first.prompt, createdBy: 'owner' });
  run('INSERT INTO daily_interaction_history VALUES (?, ?, ?)', ['guild', first.key, Date.now()]);
  const next = activities.chooseInteraction({ guildId: 'guild', type: 'GAME', random: () => 0 });
  assert.notEqual(next.key, first.key);
});

test('Daily Fact dates and interaction dates agree across DST changes', () => {
  for (const input of ['2026-03-29T00:59:00Z', '2026-03-29T01:01:00Z',
    '2026-10-25T00:59:00Z', '2026-10-25T01:01:00Z']) {
    const date = new Date(input);
    const fact = FactService.getDateParts(date, 'Europe/London');
    const activity = activities.getDateParts(date, 'Europe/London');
    assert.equal(activity.dateKey, fact.dateKey);
    assert.equal(activity.hour, fact.hour);
    assert.equal(activity.minute, fact.minute);
  }
});

test('legacy orphan reviews recover the existing bot review message instead of reposting', async () => {
  const context = sandbox();
  const inserted = run(`INSERT INTO dailyfact_submissions (guildId, userId, fact, category, submittedAt)
    VALUES ('guild', 'submitter', 'A recoverable legacy review with no saved message identifier.', 'science', ?)`, [Date.now()]);
  const existing = await context.review.send({ embeds: [new EmbedBuilder().setTitle('Daily Fact Submission')
    .addFields({ name: 'Submission ID', value: `#${inserted.lastInsertRowid}` })] });
  await FactService.tick(context.client);
  assert.equal(context.review.sent, 1);
  assert.equal(get('SELECT reviewMessageId FROM dailyfact_submissions').reviewMessageId, existing.id);
});

test('answer publication respects a staff-locked discussion', async () => {
  const context = sandbox();
  const { source, post } = await activityPost(context);
  const thread = await activities.getOrCreateDiscussionThread({ guild: context.guild, message: source, post });
  thread.locked = true;
  const request = answerRequest(context, post);
  await activityEvents.execute(request);
  assert.match(request.response.content, /locked/);
  assert.equal(thread.sent, 0);
  assert.equal(all('SELECT * FROM daily_interaction_responses').length, 0);
});

test('only active, non-future posts can accept participation', () => {
  const now = Date.now();
  assert.equal(activities.isDailyInteractionOpen({ sentAt: now + 1000 }, now), false);
  assert.equal(activities.isDailyInteractionOpen({ sentAt: now - 24 * 60 * 60 * 1000 }, now), false);
  assert.equal(activities.isDailyInteractionOpen({ sentAt: now - 1000 }, now), true);
});

test('missing protection permissions prevent an answer button from being advertised', async () => {
  const context = sandbox();
  const config = configureActivities();
  const permissions = new PermissionsBitField([PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.SendMessagesInThreads]);
  context.main.permissionsFor = () => permissions;
  const sent = await activities.sendDailyInteraction({ client: context.client, config, type: 'GAME' });
  const message = await context.main.messages.fetch(sent.message.id);
  assert.equal(message.components[0].components.some(button => button.custom_id === 'dailyinteraction_answer'), false);
  assert.match(message.embeds[0].data.fields.find(field => field.name === 'How to Join').value, /does not accept/);
});
