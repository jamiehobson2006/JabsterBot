const crypto = require('node:crypto');

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, stableValue(value[key])])
    );
  }
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
}

function ticketFingerprint({ guildId, userId, type, formId = null, answers = null, requestId = null, reason = null }) {
  const directIdentity = answers
    ? { guildId, userId, type, formId, answers: stableValue(answers) }
    : reason?.trim() ? { guildId,userId,type,reason:stableValue(reason).toLowerCase() } : { guildId, userId, type, requestId };

  return crypto
    .createHash('sha256')
    .update(JSON.stringify(directIdentity))
    .digest('hex');
}

module.exports = {
  stableValue,
  ticketFingerprint
};
