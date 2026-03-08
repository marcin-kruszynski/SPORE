import path from "node:path";

export const PROJECT_ROOT = path.resolve(import.meta.dirname, "../../../..");
export const DEFAULT_SESSION_DB_PATH = path.join(
  PROJECT_ROOT,
  "data",
  "state",
  "spore-sessions.sqlite"
);
export const DEFAULT_EVENT_LOG_PATH = path.join(
  PROJECT_ROOT,
  "data",
  "state",
  "events.ndjson"
);
