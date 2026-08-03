const assert =
  require('node:assert/strict');

const fs =
  require('node:fs');

const os =
  require('node:os');

const path =
  require('node:path');

const test =
  require('node:test');

const tempDir =
  fs.mkdtempSync(
    path.join(os.tmpdir(), 'jabster-studios-applications-')
  );

process.env.DATABASE_PATH =
  path.join(tempDir, 'database.db');

const {
  initDatabase
} = require('../database');

const {
  addQuestion,
  createDraft,
  createForm,
  getDraft,
  getFormByName,
  getQuestions,
  saveDraft
} = require('../utils/applications');

test(
  'applications support multiple modal pages and remember their reviewer role',
  () => {
    initDatabase();

    createForm({
      guildId: 'guild-1',
      name: 'Moderator Application',
      description: 'Apply to moderate the server.',
      reviewerRoleId: 'reviewer-role',
      createdBy: 'admin-1'
    });

    const form =
      getFormByName('guild-1', 'Moderator Application');

    assert.equal(form.reviewerRoleId, 'reviewer-role');

    for (let number = 1; number <= 6; number++) {
      addQuestion({
        guildId: 'guild-1',
        formId: form.id,
        question: `Question number ${number}?`,
        required: true
      });
    }

    const questions =
      getQuestions(form.id);

    assert.equal(questions.length, 6);

    const draft =
      createDraft({
        guildId: 'guild-1',
        formId: form.id,
        userId: 'applicant-1'
      });

    saveDraft({
      id: draft.id,
      answers: questions.slice(0, 5).map(question => ({
        questionId: question.id,
        answer: `Answer for ${question.id}`
      })),
      nextQuestionIndex: 5
    });

    const resumed =
      getDraft(draft.id);

    assert.equal(resumed.nextQuestionIndex, 5);
    assert.equal(resumed.answers.length, 5);
  }
);
