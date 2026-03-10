import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CORE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

export const PROJECT_ROOT = CORE_ROOT;
export type SporeIdentifier = string;
export type IsoTimestamp = string;
export interface TimestampedRecord {
  createdAt?: IsoTimestamp;
  updatedAt?: IsoTimestamp;
}

export function resolveRepoScriptPath(scriptPath: string): string {
  const absolutePath = path.isAbsolute(scriptPath)
    ? scriptPath
    : path.join(PROJECT_ROOT, scriptPath);

  if (fs.existsSync(absolutePath)) {
    return absolutePath;
  }

  if (absolutePath.endsWith(".js")) {
    const tsCandidate = absolutePath.replace(/\.js$/, ".ts");
    if (fs.existsSync(tsCandidate)) {
      return tsCandidate;
    }
  }

  return absolutePath;
}

export function buildTsxEntrypointArgs(
  scriptPath: string,
  args: string[] = [],
): string[] {
  return ["--import=tsx", resolveRepoScriptPath(scriptPath), ...args];
}
