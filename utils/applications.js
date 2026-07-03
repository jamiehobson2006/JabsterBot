const {
  all,
  get,
  run
} = require('../database');

const MAX_APPLICATION_QUESTIONS =
  5;

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

  return run(
    `INSERT INTO application_forms (
       guildId,
       name,
       normalizedName,
       description,
       enabled,
       createdBy,
       createdAt,
       updatedAt
     )
     VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
    [
      guildId,
      cleanedName,
      normalizedName,
      description || null,
      createdBy,
      now,
      now
    ]
  );
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

  return run(
    `UPDATE application_forms
     SET ${updates.join(', ')}
     WHERE id = ?`,
    params
  );
}

function deleteForm(
  formId
) {
  run(
    `DELETE FROM application_questions
     WHERE formId = ?`,
    [formId]
  );

  return run(
    `DELETE FROM application_forms
     WHERE id = ?`,
    [formId]
  );
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

  return run(
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

  return question;
}

module.exports = {
  MAX_APPLICATION_QUESTIONS,
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
  removeQuestion
};
