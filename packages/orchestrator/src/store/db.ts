import { openOrchestratorDatabase } from "./execution-store.impl.js";

function sleep(ms) {
  if (ms <= 0) {
    return;
  }
  const lock = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(lock, 0, 0, ms);
}

export { openOrchestratorDatabase };

type RetryOptions = {
  attempts?: number;
  delayMs?: number;
};

export function isOrchestratorDatabaseLocked(error) {
  return String(error?.message ?? "")
    .toLowerCase()
    .includes("database is locked");
}

export function withRetriedOrchestratorDatabase(
  dbPath,
  fn,
  options: RetryOptions = {},
) {
  const attempts = Number.isFinite(Number(options.attempts))
    ? Math.max(1, Number(options.attempts))
    : 5;
  const delayMs = Number.isFinite(Number(options.delayMs))
    ? Math.max(0, Number(options.delayMs))
    : 250;
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let db = null;
    try {
      db = openOrchestratorDatabase(dbPath);
      return fn(db);
    } catch (error) {
      if (!isOrchestratorDatabaseLocked(error) || attempt >= attempts - 1) {
        throw error;
      }
      lastError = error;
    } finally {
      db?.close();
    }
    sleep(delayMs);
  }
  throw (
    lastError ??
    new Error(`database remained locked after ${attempts} attempts`)
  );
}
