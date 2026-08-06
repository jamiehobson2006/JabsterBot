const {
  all,
  get,
  run,
  checkpointDatabase
} = require('../database');

const crypto =
  require('node:crypto');

const MAX_APPLICATION_QUESTIONS =
  25;

const QUESTIONS_PER_MODAL =
  1;

const DRAFT_LIFETIME_MS =
  30 * 60 * 1000;

function cleanName(name) {
  return String(name || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function normalizeName(name) {
  return cleanName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function cleanQuestion(question) {
  return String(question || '')
    .replace(/@everyone|@here/g, '[mention removed]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 250);
}

function getFormByName(
  guildId,
  name
) {
  const normalized =
    normalizeName(name);

  if (!guildId || !normalized) {
    return null;
  }

  return get(
    `SELECT *
     FROM application_forms
     WHERE guildId = ?
     AND normalizedName = ?`,
    [
      guildId,
      normalized
    ]
  );
}

function getFormById(
  guildId,
  formId
) {
  return get(
    `SELECT *
     FROM application_forms
     WHERE guildId = ?
     AND id = ?`,
    [
      guildId,
      formId
    ]
  );
}

function listForms(
  guildId,
  {
    enabledOnly = false
  } = {}
) {
  return all(
    `SELECT *
     FROM application_forms
     WHERE guildId = ?
     ${enabledOnly ? 'AND enabled = 1' : ''}
     ORDER BY name COLLATE NOCASE ASC`,
    [guildId]
  );
}

function getQuestions(
  formId
) {
  return all(
    `SELECT *
     FROM application_questions
     WHERE formId = ?
     ORDER BY position ASC, id ASC`,
    [formId]
  );
}

function createForm({
  guildId,
  name,
  description = null,
  reviewerRoleId = null,
  createdBy
}) {
  const cleanedName =
    cleanName(name);

  const normalizedName =
    normalizeName(cleanedName);

  if (!normalizedName) {
    throw new Error('Application name cannot be empty.');
  }

  const now =
    Date.now();

  const result = run(
    `INSERT INTO application_forms (
       guildId,
       name,
       normalizedName,
       description,
       reviewerRoleId,
       enabled,
       createdBy,
       createdAt,
       updatedAt
     )
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    [
      guildId,
      cleanedName,
      normalizedName,
      description || null,
      reviewerRoleId || null,
      createdBy,
      now,
      now
    ]
  );

  checkpointDatabase();
  return result;
}

function updateForm(
  formId,
  fields
) {
  const updates = [];
  const params = [];

  if (fields.name !== undefined) {
    const name =
      cleanName(fields.name);

    const normalized =
      normalizeName(name);

    if (!normalized) {
      throw new Error('Application name cannot be empty.');
    }

    updates.push('name = ?');
    params.push(name);
    updates.push('normalizedName = ?');
    params.push(normalized);
  }

  if (fields.description !== undefined) {
    updates.push('description = ?');
    params.push(fields.description || null);
  }

  if (fields.reviewerRoleId !== undefined) {
    updates.push('reviewerRoleId = ?');
    params.push(fields.reviewerRoleId || null);
  }

  if (fields.enabled !== undefined) {
    updates.push('enabled = ?');
    params.push(fields.enabled ? 1 : 0);
  }

  if (!updates.length) {
    return null;
  }

  updates.push('updatedAt = ?');
  params.push(Date.now());
  params.push(formId);

  const result = run(
    `UPDATE application_forms
     SET ${updates.join(', ')}
     WHERE id = ?`,
    params
  );

  checkpointDatabase();
  return result;
}

function deleteForm(
  formId
) {
  run(
    `DELETE FROM application_questions
     WHERE formId = ?`,
    [formId]
  );

  const result = run(
    `DELETE FROM application_forms
     WHERE id = ?`,
    [formId]
  );

  checkpointDatabase();
  return result;
}

function addQuestion({
  guildId,
  formId,
  question,
  required = true
}) {
  const existing =
    getQuestions(formId);

  if (existing.length >= MAX_APPLICATION_QUESTIONS) {
    throw new Error(
      `Applications can have up to ${MAX_APPLICATION_QUESTIONS} questions.`
    );
  }

  const cleaned =
    cleanQuestion(question);

  if (cleaned.length < 3) {
    throw new Error('Question is too short.');
  }

  const result = run(
    `INSERT INTO application_questions (
       guildId,
       formId,
       question,
       position,
       required,
       createdAt
     )
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      guildId,
      formId,
      cleaned,
      existing.length + 1,
      required ? 1 : 0,
      Date.now()
    ]
  );

  checkpointDatabase();
  return result;
}

function parseDraftAnswers(
  answersJson
) {
  try {
    const parsed =
      JSON.parse(answersJson || '[]');

    return Array.isArray(parsed)
      ? parsed
      : [];

  } catch {
    return [];
  }
}

function createDraft({
  guildId,
  formId,
  userId
}) {
  const now =
    Date.now();

  run(
    `DELETE FROM application_drafts
     WHERE guildId = ?
     AND formId = ?
     AND userId = ?`,
    [
      guildId,
      formId,
      userId
    ]
  );

  const id =
    crypto.randomUUID();

  run(
    `INSERT INTO application_drafts (
       id,
       guildId,
       formId,
       userId,
       answersJson,
       nextQuestionIndex,
       createdAt,
       expiresAt
     )
     VALUES (?, ?, ?, ?, '[]', 0, ?, ?)`,
    [
      id,
      guildId,
      formId,
      userId,
      now,
      now + DRAFT_LIFETIME_MS
    ]
  );

  checkpointDatabase();

  return getDraft(id);
}

function getDraft(
  id
) {
  const draft =
    get(
      `SELECT *
       FROM application_drafts
       WHERE id = ?`,
      [id]
    );

  if (!draft) {
    return null;
  }

  if (Number(draft.expiresAt) <= Date.now()) {
    deleteDraft(id);
    return null;
  }

  return {
    ...draft,
    answers: parseDraftAnswers(draft.answersJson)
  };
}

function saveDraft({
  id,
  answers,
  nextQuestionIndex
}) {
  const expiresAt =
    Date.now() + DRAFT_LIFETIME_MS;

  run(
    `UPDATE application_drafts
     SET answersJson = ?,
         nextQuestionIndex = ?,
         expiresAt = ?
     WHERE id = ?`,
    [
      JSON.stringify(answers || []),
      nextQuestionIndex,
      expiresAt,
      id
    ]
  );

  checkpointDatabase();

  return getDraft(id);
}

function deleteDraft(
  id
) {
  const result = run(
    `DELETE FROM application_drafts
     WHERE id = ?`,
    [id]
  );

  checkpointDatabase();
  return result;
}

function removeQuestion(
  formId,
  position
) {
  const question =
    get(
      `SELECT *
       FROM application_questions
       WHERE formId = ?
       AND position = ?`,
      [
        formId,
        position
      ]
    );

  if (!question) {
    return null;
  }

  run(
    `DELETE FROM application_questions
     WHERE id = ?`,
    [question.id]
  );

  const remaining =
    getQuestions(formId);

  remaining.forEach((item, index) => {
    run(
      `UPDATE application_questions
       SET position = ?
       WHERE id = ?`,
      [
        index + 1,
        item.id
      ]
    );
  });

  checkpointDatabase();

  return question;
}

module.exports = {
  MAX_APPLICATION_QUESTIONS,
  QUESTIONS_PER_MODAL,
  cleanName,
  normalizeName,
  cleanQuestion,
  getFormByName,
  getFormById,
  listForms,
  getQuestions,
  createForm,
  updateForm,
  deleteForm,
  addQuestion,
  removeQuestion,
  createDraft,
  getDraft,
  saveDraft,
  deleteDraft
};
