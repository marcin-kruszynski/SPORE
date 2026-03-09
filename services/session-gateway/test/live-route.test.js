import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { appendEvent } from "../../../packages/session-manager/src/events/event-log.js";
import { PROJECT_ROOT } from "../../../packages/session-manager/src/metadata/constants.js";
import { openSessionDatabase, upsertSession } from "../../../packages/session-manager/src/store/session-store.js";
import { makeTempPaths } from "../../../packages/orchestrator/test/helpers/scenario-fixtures.js";
import { getJson, startProcess, waitForHealth } from "../../orchestrator/test/helpers/http-harness.js";

const GATEWAY_PORT = 8799;

test("session live route returns diagnostics and control guidance", async (t) => {
  const temp = await makeTempPaths("spore-gateway-live-");
  const eventLogPath = path.join(temp.root, "events.ndjson");
  const sessionId = `live-route-${Date.now()}`;
  const sessionDb = openSessionDatabase(temp.sessionDbPath);
  try {
    upsertSession(sessionDb, {
      id: sessionId,
      runId: `${sessionId}-run`,
      agentIdentityId: "builder:builder",
      profileId: "builder",
      role: "builder",
      state: "active",
      runtimeAdapter: "runtime-pi",
      transportMode: "tmux",
      sessionMode: "ephemeral",
      projectId: "example-project",
      projectName: "Example Project",
      projectType: "service",
      domainId: "backend",
      workflowId: "backend-service-delivery",
      parentSessionId: null,
      contextPath: `tmp/sessions/${sessionId}.context.json`,
      transcriptPath: `tmp/sessions/${sessionId}.transcript.md`,
      launcherType: "pi-rpc",
      launchCommand: `tmp/sessions/${sessionId}.launch.sh`,
      tmuxSession: `${sessionId}-tmux`,
      startedAt: new Date(Date.now() - 90_000).toISOString(),
      endedAt: null,
      createdAt: new Date(Date.now() - 90_000).toISOString(),
      updatedAt: new Date(Date.now() - 90_000).toISOString()
    });
  } finally {
    sessionDb.close();
  }

  await appendEvent(eventLogPath, {
    id: `${sessionId}-event`,
    type: "session.active",
    timestamp: new Date(Date.now() - 60_000).toISOString(),
    runId: `${sessionId}-run`,
    sessionId,
    projectId: "example-project",
    domainId: "backend",
    workflowId: "backend-service-delivery",
    agentIdentityId: "builder:builder",
    payload: {
      source: "test"
    }
  });

  const base = path.join(PROJECT_ROOT, "tmp", "sessions", sessionId);
  await fs.mkdir(path.dirname(base), { recursive: true });
  await Promise.all([
    fs.writeFile(`${base}.transcript.md`, "builder transcript\n", "utf8"),
    fs.writeFile(`${base}.rpc-status.json`, `${JSON.stringify({ ok: true }, null, 2)}\n`, "utf8"),
    fs.writeFile(
      `${base}.control.ndjson`,
      `${JSON.stringify({ id: `${sessionId}-control`, action: "steer", message: "finish soon" })}\n`,
      "utf8"
    )
  ]);

  const gateway = startProcess("node", ["services/session-gateway/server.js"], {
    SPORE_GATEWAY_PORT: String(GATEWAY_PORT),
    SPORE_SESSION_DB_PATH: temp.sessionDbPath,
    SPORE_EVENT_LOG_PATH: eventLogPath
  });
  t.after(async () => {
    gateway.kill("SIGTERM");
    await fs.rm(`${base}.transcript.md`, { force: true });
    await fs.rm(`${base}.rpc-status.json`, { force: true });
    await fs.rm(`${base}.control.ndjson`, { force: true });
  });

  await waitForHealth(`http://127.0.0.1:${GATEWAY_PORT}/health`);

  const response = await getJson(`http://127.0.0.1:${GATEWAY_PORT}/sessions/${encodeURIComponent(sessionId)}/live`);
  assert.equal(response.status, 200);
  assert.equal(response.json.ok, true);
  assert.equal(response.json.session.id, sessionId);
  assert.equal(response.json.diagnostics.status, "stuck_active");
  assert.equal(response.json.diagnostics.supportsRpcControl, true);
  assert.ok(Array.isArray(response.json.diagnostics.suggestions));
  assert.ok(response.json.diagnostics.suggestions.some((item) => item.action === "steer"));
  assert.ok(response.json.diagnostics.suggestions.some((item) => item.action === "stop"));
  assert.equal(response.json.artifacts.transcript.exists, true);
  assert.equal(response.json.artifacts.rpcStatus.exists, true);
  assert.equal(response.json.controlHistory.length, 1);
});
