#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

import { PROJECT_ROOT } from "@spore/core";
import type { ParsedArgs, ValidationResult, YamlValue } from "../types.js";
import { loadSchemaForConfig } from "../validate/load-schemas.js";
import { validateAgainstSchema } from "../validate/schema-validator.js";
import { parseYaml } from "../yaml/parse-yaml.js";

const CONFIG_ROOT = path.join(PROJECT_ROOT, "config");

type CliFlags = Record<string, string | boolean | undefined> & {
  json?: boolean;
};

interface WorkflowStepSet {
  name?: string;
  roles?: string[];
}

interface WorkflowLike {
  stepSets?: WorkflowStepSet[];
}

function parseArgs(argv: string[]): ParsedArgs<CliFlags> {
  const positional: string[] = [];
  const flags: CliFlags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (key === "json") {
      flags.json = true;
      continue;
    }
    flags[key] = argv[index + 1];
    index += 1;
  }
  return { positional, flags };
}

async function listYamlFiles(rootPath: string): Promise<string[]> {
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listYamlFiles(absolutePath)));
      continue;
    }
    if (entry.name.endsWith(".yaml")) {
      files.push(absolutePath);
    }
  }
  return files.sort();
}

function toRelative(filePath: string): string {
  return path.relative(PROJECT_ROOT, filePath).split(path.sep).join("/");
}

function asWorkflowLike(value: YamlValue): WorkflowLike {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as WorkflowLike;
}

function validateWorkflowSemantics(
  filePath: string,
  parsed: YamlValue,
): string[] {
  const relativePath = toRelative(filePath);
  if (!relativePath.startsWith("config/workflows/")) {
    return [];
  }
  const workflow = asWorkflowLike(parsed);
  const stepSets = Array.isArray(workflow.stepSets) ? workflow.stepSets : [];
  const errors: string[] = [];
  for (const stepSet of stepSets) {
    const roles = Array.isArray(stepSet?.roles) ? stepSet.roles : [];
    if (roles.includes("builder") && roles.includes("tester")) {
      errors.push(
        `${relativePath}: step set "${stepSet?.name ?? "unnamed"}" cannot mix builder and tester; final verification must be sequential`,
      );
    }
  }
  return errors;
}

async function validateFile(filePath: string): Promise<ValidationResult> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = parseYaml(raw);
  const schema = await loadSchemaForConfig(filePath);
  const errors = [
    ...validateAgainstSchema(schema, parsed),
    ...validateWorkflowSemantics(filePath, parsed),
  ];
  return {
    file: toRelative(filePath),
    valid: errors.length === 0,
    errors,
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const target = positional[0]
    ? path.join(PROJECT_ROOT, positional[0])
    : CONFIG_ROOT;
  const files = (await fs.stat(target)).isDirectory()
    ? await listYamlFiles(target)
    : [target];
  const results: ValidationResult[] = [];
  for (const filePath of files) {
    results.push(await validateFile(filePath));
  }

  const invalid = results.filter((result) => !result.valid);
  if (flags.json) {
    console.log(
      JSON.stringify(
        { ok: invalid.length === 0, fileCount: results.length, results },
        null,
        2,
      ),
    );
    process.exitCode = invalid.length === 0 ? 0 : 1;
    return;
  }

  if (invalid.length === 0) {
    console.log(
      `Validated ${results.length} config files. No schema errors found.`,
    );
    return;
  }

  for (const result of invalid) {
    console.log(result.file);
    for (const error of result.errors) {
      console.log(`  - ${error}`);
    }
  }
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(`spore-config error: ${getErrorMessage(error)}`);
  process.exitCode = 1;
});
