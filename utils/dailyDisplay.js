const locks = new Map();

function withDailyDisplayLock(messageId, operation) {
  const previous = locks.get(messageId) || Promise.resolve();
  const current = previous.catch(() => null).then(operation);
  locks.set(messageId, current);
  return current.finally(() => { if (locks.get(messageId) === current) locks.delete(messageId); });
}

function fetchDailyMessage(channel, messageId) {
  return channel.messages.fetch({ message: messageId, force: true });
}

module.exports = { fetchDailyMessage, withDailyDisplayLock };
