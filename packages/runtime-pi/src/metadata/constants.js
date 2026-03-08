import path from "node:path";

export const PROJECT_ROOT = path.resolve(import.meta.dirname, "../../../..");
export const DEFAULT_RUNTIME_CONFIG = path.join(PROJECT_ROOT, "config/system/runtime.yaml");
export const DEFAULT_DOCS_INDEX = path.join(PROJECT_ROOT, "docs/INDEX.md");
