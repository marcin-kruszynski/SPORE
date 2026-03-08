import path from "node:path";

export const PROJECT_ROOT = path.resolve(import.meta.dirname, "../../../..");
export const DEFAULT_DOCS_ROOT = path.join(PROJECT_ROOT, "docs");
export const DEFAULT_INDEX_PATH = path.join(
  PROJECT_ROOT,
  "data",
  "docs-index",
  "spore-docs.sqlite"
);

export const SUPPORTED_EXTENSIONS = new Set([".md", ".qmd"]);
export const MAX_CHUNK_CHARS = 1200;
export const TARGET_CHUNK_CHARS = 900;
