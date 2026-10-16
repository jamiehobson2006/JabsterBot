const { get, run } = require('../database');

const running = new Set();

function errorText(error) {
  return String(error?.message || error || 'Unknown service error').slice(0, 1500);
}

function withTimeout(promise, timeoutMs, name = 'Service') {
  const delay = Math.max(1_000, Number(timeoutMs) || 30_000);
  let timer;

  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${name} timed out after ${delay}ms.`)), delay);
      timer.unref?.();
    })
  ]).finally(() => clearTimeout(timer));
}

function serviceState(name) {
  return get('SELECT * FROM service_health WHERE serviceName = ?', [String(name)]);
}

async function runServiceCycle(name, work, options = {}) {
  const serviceName = String(name);
  if (running.has(serviceName)) return { status: 'SKIPPED', reason: 'already-running' };

  const previous = serviceState(serviceName);
  const now = Date.now();
  if (Number(previous?.circuitOpenUntil) > now) {
    return { status: 'SKIPPED', reason: 'circuit-open', retryAt: previous.circuitOpenUntil };
  }

  running.add(serviceName);
  run(
    `INSERT INTO service_health (serviceName, status, lastStartedAt)
     VALUES (?, 'RUNNING', ?)
     ON CONFLICT(serviceName) DO UPDATE SET status = 'RUNNING', lastStartedAt = excluded.lastStartedAt`,
    [serviceName, now]
  );

  let workSettled = false;
  const workPromise = Promise.resolve().then(work).finally(() => {
    workSettled = true;
    running.delete(serviceName);
  });

  try {
    const result = await withTimeout(
      workPromise,
      options.timeoutMs || 30_000,
      serviceName
    );
    run(
      `UPDATE service_health
       SET status = 'HEALTHY', consecutiveFailures = 0, lastSuccessAt = ?,
           circuitOpenUntil = NULL, lastError = NULL
       WHERE serviceName = ?`,
      [Date.now(), serviceName]
    );
    return { status: 'SUCCESS', result };
  } catch (error) {
    const failures = (Number(previous?.consecutiveFailures) || 0) + 1;
    const threshold = Math.max(1, Number(options.failureThreshold) || 3);
    const circuitOpenUntil = failures >= threshold
      ? Date.now() + Math.max(30_000, Number(options.circuitBreakMs) || 5 * 60_000)
      : null;

    run(
      `UPDATE service_health
       SET status = ?, consecutiveFailures = ?, lastFailureAt = ?,
           circuitOpenUntil = ?, lastError = ?
       WHERE serviceName = ?`,
      [
        circuitOpenUntil ? 'CIRCUIT_OPEN' : 'DEGRADED',
        failures,
        Date.now(),
        circuitOpenUntil,
        errorText(error),
        serviceName
      ]
    );
    throw error;
  } finally {
    if (workSettled) running.delete(serviceName);
  }
}

async function startServiceSafe(name, starter, options = {}) {
  try {
    const result = await withTimeout(
      Promise.resolve().then(starter),
      options.timeoutMs || 30_000,
      `${name} startup`
    );
    console.log(`[service] ${name} started`);
    return { name, ok: true, result };
  } catch (error) {
    console.error(`[service] ${name} failed to start:`, error);
    return { name, ok: false, error };
  }
}

function startManagedLoop(name, work, intervalMs, options = {}) {
  const interval = Math.max(5_000, Number(intervalMs) || 60_000);
  const execute = () => runServiceCycle(name, work, options)
    .catch(error => console.error(`[service] ${name} cycle failed:`, error));

  if (options.immediate !== false) void execute();
  const timer = setInterval(execute, interval);
  timer.unref?.();
  return timer;
}

module.exports = {
  runServiceCycle,
  serviceState,
  startManagedLoop,
  startServiceSafe,
  withTimeout
};
