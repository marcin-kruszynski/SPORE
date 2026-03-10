import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildTsxEntrypointArgs } from "@spore/core";
import { resolveCommandBinary } from "@spore/runtime-pi";

function runNode(
  args: string[],
  env: NodeJS.ProcessEnv = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
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
      reject(
        new Error(stderr || stdout || `command failed: ${args.join(" ")}`),
      );
    });
  });
}

test("pi-rpc smoke run completes and writes runtime artifacts", async (t) => {
  if (process.env.SPORE_RUN_PI_E2E !== "1") {
    t.skip("set SPORE_RUN_PI_E2E=1 to run the real pi-rpc smoke test");
    return;
  }

  const piBinary = await resolveCommandBinary("pi");
  if (!piBinary) {
    t.skip("pi binary not available");
    return;
  }

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "spore-pi-rpc-"));
  const briefPath = path.join(root, "brief.md");
  const sessionId = `pi-rpc-smoke-${Date.now()}`;
  const runId = `${sessionId}-run`;

  await fs.writeFile(
    briefPath,
    `${[
      "# SPORE PI RPC Smoke",
      "",
      "- Return exactly one short sentence.",
      "- Include the token `SPORE_PI_RPC_SMOKE_OK`.",
      "- Stop immediately after the sentence.",
    ].join("\n")}\n`,
    "utf8",
  );

  const result = await runNode(
    buildTsxEntrypointArgs("packages/runtime-pi/src/cli/run-session-plan.ts", [
      "--profile",
      "config/profiles/lead.yaml",
      "--project",
      "config/projects/example-project.yaml",
      "--session-id",
      sessionId,
      "--run-id",
      runId,
      "--brief",
      briefPath,
      "--launcher",
      "pi-rpc",
      "--wait",
      "--timeout",
      "120000",
      "--no-monitor",
    ]),
    {
      SPORE_PI_BIN: piBinary,
    },
  );

  const payload = JSON.parse(result.stdout);
  const transcriptPath = path.join(
    process.cwd(),
    "tmp",
    "sessions",
    `${sessionId}.transcript.md`,
  );
  const eventsPath = path.join(
    process.cwd(),
    "tmp",
    "sessions",
    `${sessionId}.pi-events.jsonl`,
  );
  const statusPath = path.join(
    process.cwd(),
    "tmp",
    "sessions",
    `${sessionId}.rpc-status.json`,
  );

  const [transcript, eventsRaw, statusRaw] = await Promise.all([
    fs.readFile(transcriptPath, "utf8"),
    fs.readFile(eventsPath, "utf8"),
    fs.readFile(statusPath, "utf8"),
  ]);
  const status = JSON.parse(statusRaw);
  const finalResult = payload.sessionFinal ?? payload.finalResult ?? null;

  assert.equal(payload.ok, true);
  assert.ok(finalResult?.ok ?? finalResult?.skippedTransition ?? false);
  assert.match(
    transcript,
    /(SPORE_PI_RPC_SMOKE_OK|smoke run completed successfully)/i,
  );
  assert.ok(eventsRaw.trim().length > 0);
  assert.ok(["completed", "finished"].includes(status.status));
});
