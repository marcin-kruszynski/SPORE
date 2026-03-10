import path from "node:path";

import { PROJECT_ROOT } from "@spore/core";

export { PROJECT_ROOT };

function resolveStatePath(
  envValue: string | undefined,
  fallbackSegments: string[],
): string {
  if (envValue) {
    return path.isAbsolute(envValue)
      ? envValue
      : path.join(PROJECT_ROOT, envValue);
  }
  return path.join(PROJECT_ROOT, ...fallbackSegments);
}

export const DEFAULT_SESSION_DB_PATH = resolveStatePath(
  process.env.SPORE_SESSION_DB_PATH,
  ["data", "state", "spore-sessions.sqlite"],
);
export const DEFAULT_EVENT_LOG_PATH = resolveStatePath(
  process.env.SPORE_EVENT_LOG_PATH,
  ["data", "state", "events.ndjson"],
);
