const {
  all,
  get,
  run,
  checkpointDatabase
} = require('../database');
const {transaction}=require('../database');

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
  required = true,
  answerType = 'TEXT',
  choices = []
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
  if (!['TEXT','YES_NO','CHOICE','NUMBER'].includes(answerType)) throw new Error('Invalid answer type.');
  const options = [...new Set(choices.map(value => String(value).replace(/\s+/g,' ').trim()).filter(Boolean))];
  if (answerType === 'CHOICE' && (options.length < 2 || options.length > 10 || options.some(value => value.length > 80))) {
    throw new Error('Choice questions need 2-10 unique options of up to 80 characters.');
  }

  const result = run(
    `INSERT INTO application_questions (
       guildId,
       formId,
       question,
       position,
       required,
       createdAt, answerType, choicesJson
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      guildId,
      formId,
      cleaned,
      existing.length + 1,
      required ? 1 : 0,
      Date.now(), answerType, JSON.stringify(options)
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
  const existingRow = get(
    `SELECT id
     FROM application_drafts
     WHERE guildId = ? AND formId = ? AND userId = ?
     ORDER BY updatedAt DESC, createdAt DESC
     LIMIT 1`,
    [guildId, formId, userId]
  );

  if (existingRow) {
    const existing = getDraft(existingRow.id);
    if (existing?.submissionStatus === 'SUBMITTED') deleteDraft(existing.id);
    else if (existing) {
      const now = Date.now();
      run(
        `UPDATE application_drafts
         SET expiresAt = ?, updatedAt = ?
         WHERE id = ?`,
        [now + DRAFT_LIFETIME_MS, now, existing.id]
      );
      checkpointDatabase();
      return {
        ...getDraft(existing.id),
        resumed: true
      };
    }
  }

  const now = Date.now();
  const id = crypto.randomUUID();

  run(
    `INSERT INTO application_drafts (
       id,
       guildId,
       formId,
       userId,
       answersJson,
       questionsJson,
       nextQuestionIndex,
       createdAt,
       updatedAt,
       expiresAt
     ) VALUES (?, ?, ?, ?, '[]', ?, 0, ?, ?, ?)`,
    [
      id,
      guildId,
      formId,
      userId,
      JSON.stringify(getQuestions(formId)),
      now,
      now,
      now + DRAFT_LIFETIME_MS
    ]
  );

  checkpointDatabase();
  return {
    ...getDraft(id),
    resumed: false
  };
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

  const answers = parseDraftAnswers(draft.answersJson);
  if (!draft.questionsJson) {
    const current = getQuestions(draft.formId);
    const answeredIds = new Set(answers.map(answer => answer.questionId));
    const questions = [...answers.map((answer, index) => current.find(question => question.id === answer.questionId) || {
      id: answer.questionId, question: answer.question || 'Previously answered question', position: index + 1, required: Boolean(answer.required)
    }), ...current.filter(question => !answeredIds.has(question.id))];
    draft.questionsJson = JSON.stringify(questions);
    draft.nextQuestionIndex = answers.length;
    run('UPDATE application_drafts SET questionsJson=?,nextQuestionIndex=? WHERE id=?', [draft.questionsJson,draft.nextQuestionIndex,id]);
  }

  return {
    ...draft,
    answers,
    questions: parseDraftAnswers(draft.questionsJson)
  };
}

function saveDraft({
  id,
  answers,
  nextQuestionIndex,
  expectedVersion = null
}) {
  const expiresAt =
    Date.now() + DRAFT_LIFETIME_MS;

  const result = run(
    `UPDATE application_drafts
     SET answersJson = ?,
         nextQuestionIndex = ?,
         expiresAt = ?,
         updatedAt = ?, questionVersion = questionVersion + 1
     WHERE id = ? AND submissionStatus NOT IN ('SUBMITTING','SUBMITTED')
       AND (? IS NULL OR questionVersion = ?)`,
    [
      JSON.stringify(answers || []),
      nextQuestionIndex,
      expiresAt,
      Date.now(),
      id, expectedVersion, expectedVersion
    ]
  );
  if (!result.changes) throw new Error('This answer form is out of date. Resume from the latest application message.');

  checkpointDatabase();

  return getDraft(id);
}

function setDraftMessage(id, dmMessageId) {
  run(
    `UPDATE application_drafts
     SET dmMessageId = ?, updatedAt = ?
     WHERE id = ?`,
    [dmMessageId || null, Date.now(), id]
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

function editQuestion(formId,position,fields) {
  const before=get('SELECT * FROM application_questions WHERE formId=? AND position=?',[formId,position]);
  if(!before) throw new Error('Question not found.');
  const row={...before,...fields};
  row.question=cleanQuestion(row.question);
  if(row.question.length<3 || !['TEXT','YES_NO','CHOICE','NUMBER'].includes(row.answerType)) throw new Error('Choose valid question text and answer type.');
  const choices=fields.choices ?? JSON.parse(before.choicesJson || '[]');
  const normalized=[...new Set(choices.map(value=>String(value).trim()).filter(Boolean))];
  if(row.answerType==='CHOICE' && (normalized.length<2 || normalized.length>10 || normalized.some(value=>value.length>80))) throw new Error('Choice questions need 2-10 options of up to 80 characters.');
  run('UPDATE application_questions SET question=?,required=?,answerType=?,choicesJson=? WHERE id=? AND formId=?',
    [row.question,Number(Boolean(row.required)),row.answerType,JSON.stringify(row.answerType==='CHOICE'?normalized:[]),before.id,formId]);
  checkpointDatabase();return get('SELECT * FROM application_questions WHERE id=?',[before.id]);
}

function moveQuestion(formId,from,to) {
  return transaction(()=>{
    const rows=getQuestions(formId);
    if(!Number.isInteger(from) || !Number.isInteger(to) || from<1 || to<1 || from>rows.length || to>rows.length) throw new Error('Choose existing question positions.');
    const [moved]=rows.splice(from-1,1);rows.splice(to-1,0,moved);
    for(const row of rows)run('UPDATE application_questions SET position=? WHERE id=? AND formId=?',[-row.id,row.id,formId]);
    rows.forEach((row,index)=>run('UPDATE application_questions SET position=? WHERE id=? AND formId=?',[index+1,row.id,formId]));
    return getQuestions(formId);
  });
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
  editQuestion,
  moveQuestion,
  createDraft,
  getDraft,
  saveDraft,
  setDraftMessage,
  deleteDraft
};
