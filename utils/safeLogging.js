const SECRET_NAME = /token|secret|password|authorization|api[_-]?key|cookie/i;

function redactText(value) {
  let text = String(value);
  for (const [name, secret] of Object.entries(process.env)) {
    if (SECRET_NAME.test(name) && secret?.length >= 6) text = text.split(secret).join('[REDACTED]');
  }
  return text
    .replace(/(https?:\/\/[^\s?]+)\?[^\s]*/gi, '$1?[REDACTED]')
    .replace(/(\/interactions\/\d+\/)[^/\s]+/gi, '$1[REDACTED]')
    .replace(/(\/webhooks\/\d+\/)[^/\s]+/gi, '$1[REDACTED]')
    .replace(/\bBearer\s+[^\s,;"']+/gi, 'Bearer [REDACTED]')
    .replace(/((?:client_secret|access_token|refresh_token|api[_-]?key|password)\s*[=:]\s*)[^\s,;&"']+/gi, '$1[REDACTED]');
}

function safeLogValue(value, seen = new WeakSet(), depth = 0) {
  if (typeof value === 'string') return redactText(value);
  if (value == null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  if (depth > 5) return '[Object]';
  seen.add(value);
  if (value instanceof Error) {
    const result = { name: value.name, message: redactText(value.message),
      code: value.code, status: value.status || value.response?.status };
    if (value.stack) result.stack = redactText(value.stack);
    if (value.cause) result.cause = safeLogValue(value.cause, seen, depth + 1);
    return result;
  }
  if (Array.isArray(value)) return value.map(item => safeLogValue(item, seen, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    SECRET_NAME.test(key) || ['request', 'config', 'requestBody'].includes(key)
      ? '[REDACTED]' : safeLogValue(item, seen, depth + 1)]));
}

function installSafeLogging() {
  if (console.__jabsterSafeLogging) return;
  Object.defineProperty(console, '__jabsterSafeLogging', { value: true });
  for (const method of ['log', 'warn', 'error', 'info', 'debug']) {
    const original = console[method].bind(console);
    console[method] = (...args) => original(...args.map(value => safeLogValue(value)));
  }
}

module.exports = { installSafeLogging, safeLogValue, redactText };
