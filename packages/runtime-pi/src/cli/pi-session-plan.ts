#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { PROJECT_ROOT } from "../metadata/constants.js";
import { buildSessionPlan } from "../planner/build-session-plan.js";
import type { CliFlags } from "../types.js";

function parseArgs(argv: string[]): CliFlags {
  const flags: CliFlags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = "true";
      continue;
    }
    flags[key] = next;
    index += 1;
  }
  return flags;
}

function resolveOutputPath(filePath?: string): string | null {
  if (!filePath) {
    return null;
  }
  return path.isAbsolute(filePath)
    ? filePath
    : path.join(PROJECT_ROOT, filePath);
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const profilePath = flags.profile;
  if (!profilePath) {
    throw new Error("use --profile <config/profiles/*.yaml>");
  }

  const plan = await buildSessionPlan({
    profilePath,
    runtimeConfigPath: flags.runtime,
    projectPath: flags.project,
    domainId: flags.domain ?? null,
    workflowId: flags.workflow ?? null,
    sessionId: flags["session-id"] ?? null,
    runId: flags["run-id"] ?? null,
    sessionMode: flags["session-mode"] ?? null,
    contextQuery: flags["context-query"] ?? null,
    contextQueryTerms: flags["context-query-terms"]
      ? String(flags["context-query-terms"])
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : null,
    contextLimit: flags["context-limit"] ?? null,
  });

  const outputPath = resolveOutputPath(flags.write);
  if (outputPath) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(
      outputPath,
      `${JSON.stringify(plan, null, 2)}\n`,
      "utf8",
    );
  }

  console.log(JSON.stringify(plan, null, 2));
}

main().catch((error) => {
  console.error(`runtime-pi error: ${error.message}`);
  process.exitCode = 1;
});
