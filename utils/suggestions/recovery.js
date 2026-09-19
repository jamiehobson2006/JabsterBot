const { run } = require('../../database');

const REVIEW_TIMEOUT_MS = 10 * 60 * 1000;

function recoverStaleSuggestionReviews({ messageId = null, now = Date.now() } = {}) {
  const params = [now - REVIEW_TIMEOUT_MS];
  let messageClause = '';

  if (messageId) {
    messageClause = ' AND messageId = ?';
    params.push(messageId);
  }

  return run(
    `UPDATE suggestions
     SET status = 'PENDING',
         moderatorId = NULL,
         reason = NULL,
         decisionAt = NULL,
         reviewStartedAt = NULL,
         decisionDeliveryError = 'Recovered after an interrupted review'
     WHERE status = 'REVIEWING'
       AND COALESCE(reviewStartedAt, decisionAt, 0) <= ?${messageClause}`,
    params
  ).changes;
}

module.exports = {
  REVIEW_TIMEOUT_MS,
  recoverStaleSuggestionReviews
};
