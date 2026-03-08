import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { resolveCommandBinary } from "../../src/launchers/resolve-binary.js";
import { PROJECT_ROOT } from "../../src/metadata/constants.js";

export const TEST_OUTPUT_ROOT = path.join(PROJECT_ROOT, "tmp", "test-runs");

export async function makeTestRoot(prefix) {
  await fs.mkdir(TEST_OUTPUT_ROOT, { recursive: true });
  return fs.mkdtemp(path.join(TEST_OUTPUT_ROOT, `${prefix}-`));
}

export function buildIsolatedStateEnv(root, overrides = {}) {
  const stateRoot = path.join(root, "state");
  return {
    ...overrides,
    SPORE_ORCHESTRATOR_DB_PATH:
      overrides.SPORE_ORCHESTRATOR_DB_PATH ?? path.join(stateRoot, "orchestrator.sqlite"),
    SPORE_SESSION_DB_PATH:
      overrides.SPORE_SESSION_DB_PATH ?? path.join(stateRoot, "sessions.sqlite"),
    SPORE_EVENT_LOG_PATH:
      overrides.SPORE_EVENT_LOG_PATH ?? path.join(stateRoot, "events.ndjson")
  };
}

export async function writeBrief(root, fileName, lines) {
  const briefPath = path.join(root, fileName);
  await fs.mkdir(path.dirname(briefPath), { recursive: true });
  await fs.writeFile(briefPath, `${lines.join("\n")}\n`, "utf8");
  return briefPath;
}

export async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

export async function readJsonLines(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitFor(fn, options = {}) {
  const timeoutMs = Number.parseInt(String(options.timeoutMs ?? "30000"), 10);
  const intervalMs = Number.parseInt(String(options.intervalMs ?? "250"), 10);
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }

  if (lastError) {
    throw lastError;
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

export function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? PROJECT_ROOT,
      env: {
        ...process.env,
        ...(options.env ?? {})
      },
      stdio: options.stdio ?? ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }

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
            `command failed (${command} ${args.join(" ")}), exit=${String(code)}`
        )
      );
    });
  });
}

export async function runNodeScript(scriptPath, args = [], options = {}) {
  return runProcess(process.execPath, [scriptPath, ...args], options);
}

export async function ensureRealPiContext(t, options = {}) {
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
    ...(options.env ?? {})
  });

  t.after(async () => {
    if (options.keepRoot === true) {
      return;
    }
    await fs.rm(root, { recursive: true, force: true });
  });

  return {
    root,
    env,
    piBinary
  };
}

export async function readRuntimeArtifacts(sessionId) {
  const base = path.join(PROJECT_ROOT, "tmp", "sessions", sessionId);
  const files = {
    transcript: `${base}.transcript.md`,
    piEvents: `${base}.pi-events.jsonl`,
    piSession: `${base}.pi-session.jsonl`,
    control: `${base}.control.ndjson`,
    exit: `${base}.exit.json`,
    rpcStatus: `${base}.rpc-status.json`
  };

  const result = {};
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

export function uniqueSessionId(prefix) {
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
  extraArgs = []
}) {
  assert.ok(env?.SPORE_PI_BIN, "launchRealPiSession requires SPORE_PI_BIN in env");
  const result = await runNodeScript(
    "packages/runtime-pi/src/cli/run-session-plan.js",
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
      ...extraArgs
    ],
    {
      env
    }
  );
  return JSON.parse(result.stdout);
}
