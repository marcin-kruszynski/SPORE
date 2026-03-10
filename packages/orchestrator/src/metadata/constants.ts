import path from "node:path";

import { PROJECT_ROOT } from "@spore/core";

export { PROJECT_ROOT };

function resolveStatePath(envValue, fallbackSegments) {
  if (envValue) {
    return path.isAbsolute(envValue)
      ? envValue
      : path.join(PROJECT_ROOT, envValue);
  }
  return path.join(PROJECT_ROOT, ...fallbackSegments);
}

export const DEFAULT_ORCHESTRATOR_DB_PATH = resolveStatePath(
  process.env.SPORE_ORCHESTRATOR_DB_PATH,
  ["data", "state", "spore-orchestrator.sqlite"],
);
