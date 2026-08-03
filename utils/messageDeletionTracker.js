const suppressedDeletes = new Set();

function suppressMessageDelete(messageId) {
  if (!messageId) return;

  suppressedDeletes.add(messageId);

  const timer = setTimeout(() => {
    suppressedDeletes.delete(messageId);
  }, 30000);

  timer.unref?.();
}

function unsuppressMessageDelete(messageId) {
  suppressedDeletes.delete(messageId);
}

function consumeSuppressedMessageDelete(messageId) {
  if (!suppressedDeletes.has(messageId)) {
    return false;
  }

  suppressedDeletes.delete(messageId);
  return true;
}

module.exports = {
  consumeSuppressedMessageDelete,
  suppressMessageDelete,
  unsuppressMessageDelete
};
