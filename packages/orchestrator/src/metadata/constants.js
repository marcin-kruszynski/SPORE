import path from "node:path";

import { PROJECT_ROOT } from "../../../runtime-pi/src/metadata/constants.js";

export { PROJECT_ROOT };

export const DEFAULT_ORCHESTRATOR_DB_PATH = path.join(
  PROJECT_ROOT,
  "data",
  "state",
  "spore-orchestrator.sqlite"
);
