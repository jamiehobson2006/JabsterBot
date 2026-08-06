const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), 'jabster-studios-restart-')
);
const databasePath = path.join(tempDir, 'database.db');

function runBotProcess(source) {
  const result = spawnSync(process.execPath, ['-e', source], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DATABASE_PATH: databasePath
    },
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim().split(/\r?\n/).at(-1);
}

test('application forms and in-progress drafts survive a fresh bot process', () => {
  runBotProcess(`
    const { get, initDatabase } = require('./database');
    const { createForm, createDraft, addQuestion } = require('./utils/applications');
    initDatabase();
    const result = createForm({
      guildId: 'restart-guild',
      name: 'Restart-safe Application',
      createdBy: 'admin'
    });
    addQuestion({
      guildId: 'restart-guild',
      formId: Number(result.lastInsertRowid),
      question: 'What makes this application restart-safe?'
    });
    createDraft({
      guildId: 'restart-guild',
      formId: Number(result.lastInsertRowid),
      userId: 'applicant'
    });
  `);

  const output = runBotProcess(`
    const { get, initDatabase } = require('./database');
    const { getDraft, getFormByName, getQuestions } = require('./utils/applications');
    initDatabase();
    const form = getFormByName('restart-guild', 'Restart-safe Application');
    const draft = getDraft(
      get(
        'SELECT id FROM application_drafts WHERE guildId = ? AND userId = ?',
        ['restart-guild', 'applicant']
      ).id
    );
    console.log(JSON.stringify({
      formName: form?.name,
      questionCount: form ? getQuestions(form.id).length : 0,
      draftUserId: draft?.userId
    }));
  `);

  assert.deepEqual(JSON.parse(output), {
    formName: 'Restart-safe Application',
    questionCount: 1,
    draftUserId: 'applicant'
  });
});

test('Daily Fact rotation history survives a fresh bot process', () => {
  runBotProcess(`
    const { get, initDatabase, run } = require('./database');
    const { saveApprovedFact } = require('./utils/dailyFacts');
    const DailyFactService = require('./services/DailyFactService');
    initDatabase();
    saveApprovedFact({
      submissionId: 10,
      userId: 'fact-user',
      reviewerId: 'fact-reviewer',
      fact: 'The Moon is slowly moving away from Earth.',
      category: 'space'
    });
    run(
      "INSERT INTO dailyfact_config (guildId, channelId) VALUES (?, ?)",
      ['dailyfact-restart-guild', 'dailyfact-channel']
    );
    const config = get(
      'SELECT * FROM dailyfact_config WHERE guildId = ?',
      ['dailyfact-restart-guild']
    );
    DailyFactService.sendFact({
      client: {
        channels: {
          fetch: async () => ({
            isTextBased: () => true,
            send: async () => null
          })
        }
      },
      config,
      onlyCommunity: true,
      now: 1000
    }).then(result => console.log(result.status));
  `);

  const output = runBotProcess(`
    const { get, initDatabase } = require('./database');
    const DailyFactService = require('./services/DailyFactService');
    initDatabase();
    const config = get(
      'SELECT * FROM dailyfact_config WHERE guildId = ?',
      ['dailyfact-restart-guild']
    );
    DailyFactService.sendFact({
      client: {
        channels: {
          fetch: async () => ({
            isTextBased: () => true,
            send: async () => null
          })
        }
      },
      config,
      onlyCommunity: true,
      now: 2000
    }).then(result => console.log(result.status));
  `);

  assert.equal(output, 'no-eligible-facts');
});
