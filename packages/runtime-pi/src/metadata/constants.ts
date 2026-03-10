import path from "node:path";

import { PROJECT_ROOT } from "@spore/core";

export { PROJECT_ROOT };
export const DEFAULT_RUNTIME_CONFIG = path.join(
  PROJECT_ROOT,
  "config/system/runtime.yaml",
);
export const DEFAULT_DOCS_INDEX = path.join(PROJECT_ROOT, "docs/INDEX.md");
