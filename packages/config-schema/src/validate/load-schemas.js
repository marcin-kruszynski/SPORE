import fs from "node:fs/promises";
import path from "node:path";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../../../..");

function relativeToProject(filePath) {
  return path.relative(PROJECT_ROOT, filePath).split(path.sep).join("/");
}

const schemaDirectoryMap = new Map([
  ["profiles", "profile"],
  ["workflows", "workflow"],
  ["teams", "team"],
  ["projects", "project"],
  ["domains", "domain"],
  ["system", "system"]
]);

export async function loadSchemaForConfig(filePath) {
  const relativePath = relativeToProject(filePath);
  const parts = relativePath.split("/");
  const section = parts[1];
  const schemaName = schemaDirectoryMap.get(section);
  if (!schemaName) {
    throw new Error(`no schema mapping for ${relativePath}`);
  }
  const schemaPath = path.join(PROJECT_ROOT, "schemas", schemaName, `${schemaName}.schema.json`);
  const raw = await fs.readFile(schemaPath, "utf8");
  return JSON.parse(raw);
}
