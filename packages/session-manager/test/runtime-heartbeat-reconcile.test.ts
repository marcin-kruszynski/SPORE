import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { openSessionDatabase, upsertSession } from "../src/store/session-store.js";

const sessionManagerCli = path.join(
  process.cwd(),
  "packages/session-manager/src/cli/session-manager.ts",
);

async function makeTempPaths() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "spore-runtime-heartbeat-"));
  return {
    root,
    dbPath: path.join(root, "sessions.sqlite"),
    eventsPath: path.join(root, "events.ndjson"),
  };
}

test("reconcile watch does not fail a healthy non-tmux session with fresh runtime heartbeat", async () => {
  const { root, dbPath, eventsPath } = await makeTempPaths();
  const sessionId = `embedded-${Date.now()}`;
  const timestamp = new Date().toISOString();
  const runtimeStatusPath = path.join(root, `${sessionId}.runtime-status.json`);

  await fs.writeFile(
    runtimeStatusPath,
    `${JSON.stringify({
      backendKind: "pi_sdk_embedded",
      state: "active",
      health: "healthy",
      heartbeatAt: timestamp,
      terminalSignal: null,
    }, null, 2)}\n`,
    "utf8",
  );

  const db = openSessionDatabase(dbPath);
  try {
    upsertSession(db, {
      id: sessionId,
      runId: `${sessionId}-run`,
      agentIdentityId: "lead:builder",
      profileId: "lead",
      role: "builder",
      state: "active",
      runtimeAdapter: "pi",
      backendKind: "pi_sdk_embedded",
      transportMode: "embedded",
      sessionMode: "ephemeral",
      projectId: "spore",
      projectName: "SPORE",
      projectType: "application",
      domainId: "backend",
      workflowId: "backend-service-delivery",
      parentSessionId: null,
      contextPath: null,
      transcriptPath: null,
      launcherType: "pi-sdk-embedded",
      launchCommand: null,
      tmuxSession: null,
      runtimeInstanceId: sessionId,
      runtimeCapabilities: { supportsSteer: true },
      runtimeStatusPath,
      runtimeEventsPath: path.join(root, `${sessionId}.runtime-events.jsonl`),
      startedAt: timestamp,
      endedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      artifactRecovery: null,
    });
  } finally {
    db.close();
  }

  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(
    process.execPath,
    ["--import=tsx", sessionManagerCli, "reconcile", "--db", dbPath, "--events", eventsPath, "--grace-ms", "5000", "--session", sessionId],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout) as { ok: boolean; reconciledCount: number; pending: Array<{ reason: string }> };
  assert.equal(parsed.ok, true);
  assert.equal(parsed.reconciledCount, 0);
  assert.equal(parsed.pending[0]?.reason, "runtime-heartbeat-active");
});
