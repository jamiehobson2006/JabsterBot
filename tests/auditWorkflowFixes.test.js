const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ChannelType, Collection, PermissionFlagsBits, PermissionsBitField } = require('discord.js');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'jabster-audit-workflows-'));
process.env.DATABASE_PATH = path.join(temporary, 'test.db');
const { db, get, all, run, initDatabase } = require('../database');
initDatabase();
test.after(() => { db.close(); fs.rmSync(temporary, { recursive: true, force: true }); });
const administrator = new PermissionsBitField(PermissionFlagsBits.Administrator);

test('setup wizard creates a canonical support configuration recognized by the real panel', async () => {
  const category = { id: 'category', type: ChannelType.GuildCategory, permissionsFor: () => administrator };
  const role = { id: 'staff', position: 1, managed: false };
  const guild = { id: 'wizard', name: 'Wizard guild', members: { me: { id: 'bot', roles: { highest: { position: 100 } } } },
    channels: { cache: new Collection([['category',category]]) }, roles: { everyone: { id: 'wizard' }, cache: new Collection([['staff',role]]) } };
  const wizard = require('../events/setupWizardInteractions');
  const base = { inGuild: () => true, memberPermissions: administrator, guild, user: { id: 'admin' },
    client: { user: { id: 'bot' } }, deferUpdate: async () => {}, editReply: async () => {} };
  await wizard.execute({ ...base, customId: 'setupwizard:set:ticket-category', isChannelSelectMenu: () => true, channels: { first: () => category } });
  await wizard.execute({ ...base, customId: 'setupwizard:set:ticket-role', isChannelSelectMenu: () => false, isRoleSelectMenu: () => true, roles: { first: () => role } });
  assert.equal(get("SELECT type FROM ticket_settings WHERE guildId='wizard'").type, 'support');
  assert.equal(require('../utils/setupWizard').summary('wizard').ticketReady, true);
  let panel;
  await require('../commands/config/ticketpanel').execute({ ...base, channel: { send: async payload => { panel = payload; return { id: 'panel' }; } },
    editReply: async payload => { if (payload.components?.length) panel = payload; } });
  assert.ok(panel?.components?.[0]);
});

test('legacy uppercase ticket settings migrate across restart without replacing a canonical configuration', () => {
  run("INSERT INTO ticket_settings VALUES('legacy-only','SUPPORT',1,'old-category','old-role')");
  run("INSERT INTO ticket_settings VALUES('conflict','SUPPORT',1,'old-category','old-role')");
  run("INSERT INTO ticket_settings VALUES('conflict','support',0,'new-category','new-role')");
  run("INSERT INTO free_game_announcements(guildId,offerKey,source,title,announcedAt) VALUES('legacy-only','steam:987','STEAM','Older promotion',?)", [Date.now()-100*86_400_000]);
  run('DELETE FROM schema_migrations WHERE version=2');
  run("INSERT INTO delivery_outbox(deliveryKey,type,status,attempts,createdAt,updatedAt) VALUES('legacy-failed','SOCIAL','FAILED',1,?,?)", [Date.now()-600_000,Date.now()-600_000]);
  const result = spawnSync(process.execPath, ['-e', "const d=require('./database');d.initDatabase();d.db.close();"],
    { cwd: path.resolve(__dirname,'..'), env: { ...process.env }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(get("SELECT enabled,categoryId,roleId FROM ticket_settings WHERE guildId='legacy-only' AND type='support'"),
    { enabled: 1, categoryId: 'old-category', roleId: 'old-role' });
  assert.deepEqual(get("SELECT enabled,categoryId,roleId FROM ticket_settings WHERE guildId='conflict' AND type='support'"),
    { enabled: 0, categoryId: 'new-category', roleId: 'new-role' });
  assert.equal(get("SELECT COUNT(*) AS total FROM ticket_settings_legacy WHERE guildId IN ('legacy-only','conflict')").total, 2);
  assert.equal(get("SELECT receiptKey FROM free_game_observations WHERE offerKey='GB:steam:987'").receiptKey, 'steam:987');
  assert.ok(get("SELECT uncertainSince FROM delivery_outbox WHERE deliveryKey='legacy-failed'").uncertainSince);
});

test('failed suggestion sends return an error and immediately restore reviewability', async () => {
  const event = require('../events/suggestionInteractions');
  run("INSERT INTO guild_settings(guildId,acceptedSuggestionChannelId) VALUES('suggestions','accepted')");
  run("INSERT INTO suggestions(guildId,messageId,userId,content,timestamp) VALUES('suggestions','source','member','My suggestion',?)", [Date.now()]);
  let fail = true;
  let errorReplies = 0;
  const interaction = { customId: 'suggest_decision_accept_source', isButton: () => false, isModalSubmit: () => true,
    guild: { id: 'suggestions' }, memberPermissions: administrator, user: { id: 'reviewer', tag: 'Reviewer', toString: () => '<@reviewer>' },
    fields: { getTextInputValue: () => 'Approved' },
    client: { user: { id: 'bot' }, channels: { fetch: async () => ({ id: 'accepted', isTextBased: () => true,
      messages: { fetch: async () => new Collection() }, send: async () => { if (fail) throw new Error('Mock send failure'); return { id: 'decision' }; } }) } },
    deferReply: async function () { this.deferred = true; }, followUp: async () => { errorReplies += 1; }, editReply: async () => {} };
  await event.execute(interaction);
  assert.equal(get("SELECT status FROM suggestions WHERE messageId='source'").status, 'PENDING');
  assert.equal(errorReplies, 1);
  fail = false;
  await event.execute(interaction);
  assert.equal(get("SELECT status FROM suggestions WHERE messageId='source'").status, 'ACCEPTED');
});

test('a delayed active poll refresh cannot restore ended controls or block final display repair', async () => {
  const polls = require('../utils/polls');
  polls.createPoll({ messageId: 'race', guildId: 'guild', channelId: 'channel', creatorId: 'staff', question: 'Choose?', options: ['A','B'] });
  let release;
  let entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  let fetches = 0;
  const edits = [];
  const message = { edit: async payload => { edits.push(payload); return message; } };
  const client = { channels: { fetch: async () => ({ isTextBased: () => true, messages: { fetch: async () => {
    if (++fetches === 1) { entered(); await gate; }
    return message;
  } } }) } };
  const refresh = polls.refreshPollMessage(client, 'race');
  await started;
  const ended = polls.endPoll(client, 'race');
  release();
  await Promise.all([refresh,ended]);
  assert.equal(get("SELECT active FROM polls WHERE messageId='race'").active, 0);
  assert.ok(edits.every(payload => payload.components.length === 0));
  assert.ok(get("SELECT endedMessageUpdatedAt FROM polls WHERE messageId='race'").endedMessageUpdatedAt);
});

test('unconfigured and unavailable feedback routes do not starve working destinations', async () => {
  for (let index = 0; index < 51; index += 1) {
    run(`INSERT INTO ticket_feedback(id,guildId,channelId,ticketType,userId,closedBy,closeReason,rating,status,createdAt,completedAt)
      VALUES(?,?,?,'support','user','staff','done',5,'SUBMITTED',?,?)`,
    [`feedback-${index}`,index < 25 ? 'unconfigured' : index < 50 ? 'unavailable' : 'working',`ticket-${index}`,index+1,index+1]);
  }
  run("INSERT INTO guild_settings(guildId,ticketFeedbackChannelId) VALUES('unavailable','missing'),('working','working-channel')");
  let sent = 0;
  const client = { user: { id: 'bot' }, channels: { fetch: async id => id === 'missing' ? null : {
    isTextBased: () => true, send: async () => { sent += 1; return { id: 'feedback-message' }; }
  } } };
  const publisher = require('../utils/ticketFeedback');
  await publisher.publishPendingFeedback(client);
  const second = await publisher.publishPendingFeedback(client);
  assert.equal(second.published, 1);
  assert.equal(sent, 1);
  assert.equal(get("SELECT publishedMessageId FROM ticket_feedback WHERE guildId='working'").publishedMessageId, 'feedback-message');
  assert.equal(get("SELECT COUNT(*) AS total FROM ticket_feedback WHERE guildId='unconfigured'").total, 25);
});

test('application drafts keep an immutable question snapshot through edits and restarts', () => {
  const applications = require('../utils/applications');
  const formId = Number(applications.createForm({ guildId: 'applications', name: 'Staff', createdBy: 'admin' }).lastInsertRowid);
  applications.addQuestion({ guildId: 'applications', formId, question: 'First required question?', required: true });
  applications.addQuestion({ guildId: 'applications', formId, question: 'Second required question?', required: true });
  const original = applications.getQuestions(formId);
  const draft = applications.createDraft({ guildId: 'applications', formId, userId: 'applicant' });
  applications.saveDraft({ id: draft.id, answers: [{ questionId: original[0].id, question: original[0].question, answer: 'First answer' }], nextQuestionIndex: 1 });
  applications.removeQuestion(formId, 1);
  applications.addQuestion({ guildId: 'applications', formId, question: 'New question for new applicants?', required: true });
  const child = spawnSync(process.execPath, ['-e', "const d=require('./database');d.initDatabase();const a=require('./utils/applications');console.log(JSON.stringify(a.getDraft(process.argv[1]).questions));d.db.close();", draft.id],
    { cwd: path.resolve(__dirname,'..'), env: { ...process.env }, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const resumed = JSON.parse(child.stdout.trim().split(/\r?\n/).at(-1));
  assert.deepEqual(resumed.map(question => question.id), original.map(question => question.id));
  assert.equal(applications.getDraft(draft.id).nextQuestionIndex, 1);
});

test('failed final applications remain retryable, validate all required answers, and create one linked ticket', async () => {
  const applications = require('../utils/applications');
  const event = require('../events/applicationTickets');
  const formId = Number(applications.createForm({ guildId: 'submission', name: 'Builder', createdBy: 'admin' }).lastInsertRowid);
  applications.addQuestion({ guildId: 'submission', formId, question: 'Why do you want to join?', required: true });
  const draft = applications.createDraft({ guildId: 'submission', formId, userId: 'applicant' });
  const replies = [];
  const interaction = { user: { id: 'applicant' }, guild: null, client: { guilds: { fetch: async () => { throw new Error('Temporary server failure'); } } },
    deferReply: async function () { this.deferred = true; }, editReply: async payload => { replies.push(payload); } };
  await event.submitApplication(interaction, draft.id);
  assert.match(replies.at(-1).content, /complete every required/);
  applications.saveDraft({ id: draft.id, answers: [{ questionId: draft.questions[0].id, answer: 'My complete answer' }], nextQuestionIndex: 1 });
  await event.submitApplication(interaction, draft.id);
  assert.equal(applications.getDraft(draft.id).submissionStatus, 'READY');
  assert.equal(replies.at(-1).components[0].components[0].data.custom_id, `application_submit_${draft.id}`);
  run(`INSERT INTO tickets(guildId,channelId,userId,type,createdAt,applicationDraftId) VALUES('submission','created-ticket','applicant','application',?,?)`, [Date.now(),draft.id]);
  interaction.client.guilds.fetch = async () => ({ id: 'submission', members: { fetch: async () => ({ id: 'applicant' }) }, channels: { fetch: async () => ({ id: 'created-ticket', toString: () => '<#created-ticket>' }) } });
  await event.submitApplication(interaction, draft.id);
  assert.equal(applications.getDraft(draft.id).submissionStatus, 'SUBMITTED');
  await event.submitApplication(interaction, draft.id);
  assert.match(replies.at(-1).content, /already submitted/);
  assert.equal(get('SELECT COUNT(*) AS total FROM tickets WHERE applicationDraftId=?', [draft.id]).total, 1);
});

test('two concurrent member DMs open one modmail channel and forward both messages', async () => {
  const event = require('../events/modmail');
  run("INSERT INTO modmail_settings(guildId,enabled,categoryId,staffRoleId,updatedAt) VALUES('modmail',1,'category','staff',?)", [Date.now()]);
  let release;
  let entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  let creations = 0;
  const sent = [];
  const channel = { id: 'conversation', send: async payload => { sent.push(payload); return { id: 'message' }; }, delete: async () => {} };
  const guild = { id: 'modmail', members: { me: { id: 'bot' }, fetch: async () => ({ id: 'member' }) }, roles: { everyone: { id: 'modmail' } },
    channels: { fetch: async id => id === 'category' ? { id, type: ChannelType.GuildCategory } : channel,
      create: async () => { creations += 1; entered(); await gate; return channel; } } };
  const client = { guilds: { cache: new Collection([['modmail',guild]]) } };
  const message = content => ({ content, author: { id: 'member', username: 'Member', tag: 'Member', bot: false, displayAvatarURL: () => 'https://example.com/avatar.png' },
    attachments: new Collection(), createdTimestamp: Date.now(), react: async () => {}, reply: async () => {} });
  const first = event.execute(message('First message'),client);
  await started;
  const second = event.execute(message('Second message'),client);
  release(); await Promise.all([first,second]);
  assert.equal(creations, 1);
  assert.equal(all("SELECT * FROM modmail_threads WHERE guildId='modmail' AND status='OPEN'").length, 1);
  assert.equal(all("SELECT * FROM modmail_messages WHERE direction='INBOUND'").length, 2);
  assert.ok(sent.some(payload => payload.embeds?.[0]?.data.description === 'First message'));
  assert.ok(sent.some(payload => payload.embeds?.[0]?.data.description === 'Second message'));
});
