import fs from "node:fs/promises";
import path from "node:path";

import type { SimpleSchema } from "../types.js";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../../../..");

function relativeToProject(filePath: string): string {
  return path.relative(PROJECT_ROOT, filePath).split(path.sep).join("/");
}

const schemaDirectoryMap = new Map<string, string>([
  ["profiles", "profile"],
  ["workflows", "workflow"],
  ["teams", "team"],
  ["projects", "project"],
  ["domains", "domain"],
  ["scenarios", "scenario"],
  ["regressions", "regression"],
  ["validation-bundles", "validation-bundle"],
  ["work-item-templates", "work-item-template"],
  ["policy-packs", "policy-pack"],
  ["system", "system"],
]);

export async function loadSchemaForConfig(
  filePath: string,
): Promise<SimpleSchema> {
  const relativePath = relativeToProject(filePath);
  const parts = relativePath.split("/");
  const section = parts[1];
  const schemaName = section ? schemaDirectoryMap.get(section) : null;
  if (!schemaName) {
    throw new Error(`no schema mapping for ${relativePath}`);
  }
  const schemaPath = path.join(
    PROJECT_ROOT,
    "schemas",
    schemaName,
    `${schemaName}.schema.json`,
  );
  const raw = await fs.readFile(schemaPath, "utf8");
  return JSON.parse(raw) as SimpleSchema;
}
