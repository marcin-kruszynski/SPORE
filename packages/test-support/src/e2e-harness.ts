import assert from "node:assert/strict";
import { type StdioOptions, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { buildTsxEntrypointArgs, PROJECT_ROOT } from "@spore/core";
import { resolveCommandBinary } from "@spore/runtime-pi";

export const TEST_OUTPUT_ROOT = path.join(PROJECT_ROOT, "tmp", "test-runs");

export async function makeTestRoot(prefix: string) {
  await fs.mkdir(TEST_OUTPUT_ROOT, { recursive: true });
  return fs.mkdtemp(path.join(TEST_OUTPUT_ROOT, `${prefix}-`));
}

export function buildIsolatedStateEnv(
  root: string,
  overrides: Record<string, string> = {},
) {
  const stateRoot = path.join(root, "state");
  return {
    ...overrides,
    SPORE_ORCHESTRATOR_DB_PATH:
      overrides.SPORE_ORCHESTRATOR_DB_PATH ??
      path.join(stateRoot, "orchestrator.sqlite"),
    SPORE_SESSION_DB_PATH:
      overrides.SPORE_SESSION_DB_PATH ??
      path.join(stateRoot, "sessions.sqlite"),
    SPORE_EVENT_LOG_PATH:
      overrides.SPORE_EVENT_LOG_PATH ?? path.join(stateRoot, "events.ndjson"),
  };
}

export async function writeBrief(
  root: string,
  fileName: string,
  lines: string[],
) {
  const briefPath = path.join(root, fileName);
  await fs.mkdir(path.dirname(briefPath), { recursive: true });
  await fs.writeFile(briefPath, `${lines.join("\n")}\n`, "utf8");
  return briefPath;
}

export async function readJson(filePath: string) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}
export async function readJsonLines(filePath: string) {
  const raw = await fs.readFile(filePath, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
export async function waitFor<T>(
  fn: () => Promise<T | null | false> | T | null | false,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const timeoutMs = Number.parseInt(String(options.timeoutMs ?? "30000"), 10);
  const intervalMs = Number.parseInt(String(options.intervalMs ?? "250"), 10);
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value as T;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  if (lastError) throw lastError;
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}
export function runProcess(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; stdio?: StdioOptions } = {},
) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd ?? PROJECT_ROOT,
        env: { ...process.env, ...(options.env ?? {}) },
        stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) {
          resolve({ code, stdout, stderr });
          return;
        }
        reject(
          new Error(
            stderr ||
              stdout ||
              `command failed (${command} ${args.join(" ")}), exit=${String(code)}`,
          ),
        );
      });
    },
  );
}

type TestHook = {
  skip: (message: string) => void;
  after: (callback: () => Promise<void> | void) => void;
};
export async function runNodeScript(
  scriptPath: string,
  args: string[] = [],
  options: { env?: NodeJS.ProcessEnv } = {},
) {
  return runProcess(
    process.execPath,
    buildTsxEntrypointArgs(scriptPath, args),
    options,
  );
}
export async function ensureRealPiContext(
  t: TestHook,
  options: {
    prefix?: string;
    env?: Record<string, string>;
    keepRoot?: boolean;
  } = {},
) {
  if (process.env.SPORE_RUN_PI_E2E !== "1") {
    t.skip("set SPORE_RUN_PI_E2E=1 to enable real PI E2E scaffolding");
    return null;
  }
  const piBinary = await resolveCommandBinary("pi");
  if (!piBinary) {
    t.skip("pi binary not available in current shell");
    return null;
  }
  const root = await makeTestRoot(options.prefix ?? "pi-e2e");
  const env = buildIsolatedStateEnv(root, {
    SPORE_PI_BIN: piBinary,
    ...(options.env ?? {}),
  });
  t.after(async () => {
    if (options.keepRoot === true) return;
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, env, piBinary };
}

type LaunchRealPiSessionArgs = {
  env: NodeJS.ProcessEnv;
  sessionId: string;
  runId: string;
  briefPath: string;
  profile?: string;
  project?: string;
  launcher?: string;
  extraArgs?: string[];
};

export async function readRuntimeArtifacts(sessionId: string) {
  const base = path.join(PROJECT_ROOT, "tmp", "sessions", sessionId);
  const files = {
    transcript: `${base}.transcript.md`,
    piEvents: `${base}.pi-events.jsonl`,
    piSession: `${base}.pi-session.jsonl`,
    control: `${base}.control.ndjson`,
    exit: `${base}.exit.json`,
    rpcStatus: `${base}.rpc-status.json`,
    launchContext: `${base}.launch-context.json`,
  };
  const result: Record<string, string | null> = {};
  for (const [name, filePath] of Object.entries(files)) {
    try {
      await fs.access(filePath);
      result[name] = filePath;
    } catch {
      result[name] = null;
    }
  }
  return result;
}
export function uniqueSessionId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}
export async function launchRealPiSession({
  env,
  sessionId,
  runId,
  briefPath,
  profile = "config/profiles/lead.yaml",
  project = "config/projects/example-project.yaml",
  launcher = "pi-rpc",
  extraArgs = [] as string[],
}: LaunchRealPiSessionArgs) {
  assert.ok(
    env?.SPORE_PI_BIN,
    "launchRealPiSession requires SPORE_PI_BIN in env",
  );
  const result = await runNodeScript(
    "packages/runtime-pi/src/cli/run-session-plan.ts",
    [
      "--profile",
      profile,
      "--project",
      project,
      "--session-id",
      sessionId,
      "--run-id",
      runId,
      "--launcher",
      launcher,
      "--brief",
      briefPath,
      ...extraArgs,
    ],
    { env },
  );
  return JSON.parse(result.stdout);
}
