import path from "node:path";

import { PROJECT_ROOT } from "@spore/core";

export { PROJECT_ROOT };
export const DEFAULT_DOCS_ROOT = path.join(PROJECT_ROOT, "docs");
export const DEFAULT_INDEX_PATH = path.join(
  PROJECT_ROOT,
  "data",
  "docs-index",
  "spore-docs.sqlite",
);

export const SUPPORTED_EXTENSIONS = new Set<string>([".md", ".qmd"]);
export const MAX_CHUNK_CHARS = 1200;
export const TARGET_CHUNK_CHARS = 900;
