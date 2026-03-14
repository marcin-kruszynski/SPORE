import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildTsxEntrypointArgs } from "@spore/core";
import { PROJECT_ROOT } from "@spore/runtime-pi";

function runNode(
  args: string[],
  env: NodeJS.ProcessEnv = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr || stdout || `node exited with code ${code}`));
    });
  });
}

for (const backendKind of ["pi_sdk_embedded", "pi_sdk_worker"] as const) {
  test(`stub smoke: ${backendKind} writes generic runtime artifacts`, async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), `spore-${backendKind}-`));
    const sessionDbPath = path.join(tempRoot, "sessions.sqlite");
    const eventLogPath = path.join(tempRoot, "events.ndjson");
    const sessionId = `${backendKind}-${Date.now()}`;
    const artifactsBase = path.join(PROJECT_ROOT, "tmp", "sessions", sessionId);

    try {
      const result = await runNode(
        buildTsxEntrypointArgs("packages/runtime-pi/src/cli/run-session-plan.ts", [
          "--profile",
          "config/profiles/builder.yaml",
          "--project",
          "config/projects/spore.yaml",
          "--session-id",
          sessionId,
          "--run-id",
          `${sessionId}-run`,
          "--backend-kind",
          backendKind,
          "--stub",
          "--stub-seconds",
          "0",
          "--wait",
          "--no-monitor",
        ]),
        {
          SPORE_SESSION_DB_PATH: sessionDbPath,
          SPORE_EVENT_LOG_PATH: eventLogPath,
        },
      );

      const payload = JSON.parse(result.stdout) as {
        ok: boolean;
        backendKind: string;
        runtimeStatusPath: string;
        runtimeEventsPath: string;
      };
      assert.equal(payload.ok, true);
      assert.equal(payload.backendKind, backendKind);

      const runtimeStatus = JSON.parse(
        await fs.readFile(path.join(PROJECT_ROOT, payload.runtimeStatusPath), "utf8"),
      ) as { backendKind: string; terminalSignal?: { settled?: boolean } | null };
      const runtimeEvents = (await fs.readFile(
        path.join(PROJECT_ROOT, payload.runtimeEventsPath),
        "utf8",
      ))
        .trim()
        .split("\n")
        .filter(Boolean);

      assert.equal(runtimeStatus.backendKind, backendKind);
      assert.equal(runtimeStatus.terminalSignal?.settled, true);
      assert.ok(runtimeEvents.length >= 2);
    } finally {
      await Promise.all([
        fs.rm(sessionDbPath, { force: true }),
        fs.rm(eventLogPath, { force: true }),
        fs.rm(`${artifactsBase}.plan.json`, { force: true }),
        fs.rm(`${artifactsBase}.context.json`, { force: true }),
        fs.rm(`${artifactsBase}.prompt.md`, { force: true }),
        fs.rm(`${artifactsBase}.transcript.md`, { force: true }),
        fs.rm(`${artifactsBase}.runtime-status.json`, { force: true }),
        fs.rm(`${artifactsBase}.runtime-events.jsonl`, { force: true }),
        fs.rm(`${artifactsBase}.launch-context.json`, { force: true }),
        fs.rm(`${artifactsBase}.control.ndjson`, { force: true }),
      ]);
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
}
