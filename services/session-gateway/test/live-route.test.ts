import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  appendEvent,
  insertSessionControlRequest,
  openSessionDatabase,
  PROJECT_ROOT,
  upsertSession,
} from "@spore/session-manager";
import {
  getJson,
  makeTempPaths,
  startProcess,
  stopProcess,
  waitForHealth,
} from "@spore/test-support";

async function findFreePort(): Promise<number> {
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port ?? 0);
      });
    });
  });
}

test("session live route returns diagnostics and control guidance", async (t) => {
  const gatewayPort = await findFreePort();
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
      updatedAt: new Date(Date.now() - 90_000).toISOString(),
    });
    insertSessionControlRequest(sessionDb, {
      id: `${sessionId}-request`,
      sessionId,
      action: "steer",
      idempotencyKey: `${sessionId}-steer`,
      requestPayload: { message: "finish soon" },
      ackStatus: "accepted",
      status: "queued",
      result: { ok: true, action: "steer" },
      acceptedAt: new Date(Date.now() - 30_000).toISOString(),
      completedAt: null,
      createdAt: new Date(Date.now() - 30_000).toISOString(),
      updatedAt: new Date(Date.now() - 30_000).toISOString(),
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
      source: "test",
    },
  });

  const base = path.join(PROJECT_ROOT, "tmp", "sessions", sessionId);
  await fs.mkdir(path.dirname(base), { recursive: true });
  await Promise.all([
    fs.writeFile(`${base}.transcript.md`, "builder transcript\n", "utf8"),
    fs.writeFile(
      `${base}.handoff.json`,
      `${JSON.stringify(
        {
          sessionId,
          primary: {
            kind: "implementation_summary",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
    fs.writeFile(
      `${base}.rpc-status.json`,
      `${JSON.stringify({ ok: true }, null, 2)}\n`,
      "utf8",
    ),
    fs.writeFile(
      `${base}.launch-context.json`,
      `${JSON.stringify(
        {
          cwd: ".spore/worktrees/spore/ws-live",
          launcherType: "pi-rpc",
          workspaceId: "ws-live",
          branchName: "spore/spore/execution-step/step-live",
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
    fs.writeFile(
      `${base}.plan.json`,
      `${JSON.stringify(
        {
          session: {
            id: sessionId,
            cwd: ".spore/worktrees/spore/ws-live",
          },
          metadata: {
            workspace: {
              id: "ws-live",
              branchName: "spore/spore/execution-step/step-live",
              baseRef: "HEAD",
              cwd: ".spore/worktrees/spore/ws-live",
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
    fs.writeFile(
      `${base}.control.ndjson`,
      `${JSON.stringify({ id: `${sessionId}-control`, action: "steer", message: "finish soon" })}\n`,
      "utf8",
    ),
  ]);

  const gateway = startProcess("node", ["services/session-gateway/server.js"], {
    SPORE_GATEWAY_PORT: String(gatewayPort),
    SPORE_SESSION_DB_PATH: temp.sessionDbPath,
    SPORE_EVENT_LOG_PATH: eventLogPath,
  });
  t.after(async () => {
    await stopProcess(gateway);
    await fs.rm(`${base}.handoff.json`, { force: true });
    await fs.rm(`${base}.transcript.md`, { force: true });
    await fs.rm(`${base}.rpc-status.json`, { force: true });
    await fs.rm(`${base}.launch-context.json`, { force: true });
    await fs.rm(`${base}.plan.json`, { force: true });
    await fs.rm(`${base}.control.ndjson`, { force: true });
  });

  await waitForHealth(`http://127.0.0.1:${gatewayPort}/health`);

  const response = await getJson(
    `http://127.0.0.1:${gatewayPort}/sessions/${encodeURIComponent(sessionId)}/live`,
  );
  assert.equal(response.status, 200);
  assert.equal(response.json.ok, true);
  assert.equal(response.json.session.id, sessionId);
  assert.equal(response.json.diagnostics.status, "stuck_active");
  assert.equal(response.json.diagnostics.supportsRpcControl, true);
  assert.equal(response.json.diagnostics.staleSession, true);
  assert.equal(response.json.diagnostics.operatorUrgency, "high");
  assert.ok(typeof response.json.diagnostics.settleLagMs === "number");
  assert.ok(Array.isArray(response.json.diagnostics.suggestions));
  assert.ok(
    response.json.diagnostics.suggestions.some(
      (item) => item.action === "steer",
    ),
  );
  assert.ok(
    response.json.diagnostics.suggestions.some(
      (item) => item.action === "stop",
    ),
  );
  assert.ok(
    response.json.diagnostics.suggestions.every(
      (item) =>
        typeof item.expectedOutcome === "string" &&
        typeof item.commandHint === "string" &&
        typeof item.httpHint === "string",
    ),
  );
  assert.equal(response.json.artifacts.transcript.exists, true);
  assert.equal(response.json.artifacts.handoff.exists, true);
  assert.equal(response.json.artifacts.rpcStatus.exists, true);
  assert.equal(response.json.controlHistory.length, 1);
  assert.equal(response.json.launcherMetadata.launcherType, "pi-rpc");
  assert.equal(response.json.launcherMetadata.runtimeAdapter, "runtime-pi");
  assert.equal(
    response.json.launcherMetadata.cwd,
    ".spore/worktrees/spore/ws-live",
  );
  assert.equal(
    response.json.launchContext.cwd,
    ".spore/worktrees/spore/ws-live",
  );
  assert.equal(response.json.workspace.id, "ws-live");
  assert.ok(response.json.launcherMetadata.rpcStatus);
  assert.equal(response.json.controlAck.requestId, `${sessionId}-request`);

  const historyResponse = await getJson(
    `http://127.0.0.1:${gatewayPort}/sessions/${encodeURIComponent(sessionId)}/control-history`,
  );
  assert.equal(historyResponse.status, 200);
  assert.equal(
    historyResponse.json.controlHistory[0].id,
    `${sessionId}-request`,
  );

  const statusResponse = await getJson(
    `http://127.0.0.1:${gatewayPort}/sessions/${encodeURIComponent(sessionId)}/control-status/${encodeURIComponent(`${sessionId}-request`)}`,
  );
  assert.equal(statusResponse.status, 200);
  assert.equal(statusResponse.json.request.id, `${sessionId}-request`);
});

test("session live route falls back to launch-context workspace metadata when the plan artifact is missing", async (t) => {
  const gatewayPort = await findFreePort();
  const temp = await makeTempPaths("spore-gateway-live-fallback-");
  const eventLogPath = path.join(temp.root, "events.ndjson");
  const sessionId = `live-fallback-${Date.now()}`;
  const sessionDb = openSessionDatabase(temp.sessionDbPath);
  try {
    upsertSession(sessionDb, {
      id: sessionId,
      runId: `${sessionId}-run`,
      agentIdentityId: "tester:tester",
      profileId: "tester",
      role: "tester",
      state: "active",
      runtimeAdapter: "runtime-pi",
      transportMode: "tmux",
      sessionMode: "ephemeral",
      projectId: "example-project",
      projectName: "Example Project",
      projectType: "service",
      domainId: "cli",
      workflowId: "cli-verification-pass",
      parentSessionId: null,
      contextPath: `tmp/sessions/${sessionId}.context.json`,
      transcriptPath: `tmp/sessions/${sessionId}.transcript.md`,
      launcherType: "pi-rpc",
      launchCommand: `tmp/sessions/${sessionId}.launch.sh`,
      tmuxSession: `${sessionId}-tmux`,
      startedAt: new Date(Date.now() - 20_000).toISOString(),
      endedAt: null,
      createdAt: new Date(Date.now() - 20_000).toISOString(),
      updatedAt: new Date(Date.now() - 10_000).toISOString(),
    });
  } finally {
    sessionDb.close();
  }

  const base = path.join(PROJECT_ROOT, "tmp", "sessions", sessionId);
  await fs.mkdir(path.dirname(base), { recursive: true });
  await Promise.all([
    fs.writeFile(
      `${base}.launch-context.json`,
      `${JSON.stringify(
        {
          cwd: ".spore/worktrees/spore/ws-fallback",
          launcherType: "pi-rpc",
          workspaceId: "ws-fallback",
          branchName: "spore/spore/execution-step/tester-fallback",
          baseRef: "refs/heads/main",
          purpose: "verification",
          sourceWorkspaceId: "ws-builder",
          sourceRef: "refs/spore/spore/exec-builder/r1",
          sourceCommit: "abc123def456",
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
    fs.writeFile(
      `${base}.rpc-status.json`,
      `${JSON.stringify({ ok: true }, null, 2)}\n`,
      "utf8",
    ),
  ]);

  const gateway = startProcess("node", ["services/session-gateway/server.js"], {
    SPORE_GATEWAY_PORT: String(gatewayPort),
    SPORE_SESSION_DB_PATH: temp.sessionDbPath,
    SPORE_EVENT_LOG_PATH: eventLogPath,
  });
  t.after(async () => {
    await stopProcess(gateway);
    await fs.rm(`${base}.launch-context.json`, { force: true });
    await fs.rm(`${base}.rpc-status.json`, { force: true });
  });

  await waitForHealth(`http://127.0.0.1:${gatewayPort}/health`);

  const response = await getJson(
    `http://127.0.0.1:${gatewayPort}/sessions/${encodeURIComponent(sessionId)}/live`,
  );
  assert.equal(response.status, 200);
  assert.equal(response.json.ok, true);
  assert.equal(response.json.workspace.id, "ws-fallback");
  assert.equal(response.json.workspace.purpose, "verification");
  assert.equal(response.json.workspace.sourceWorkspaceId, "ws-builder");
  assert.equal(
    response.json.workspace.sourceRef,
    "refs/spore/spore/exec-builder/r1",
  );
  assert.equal(response.json.workspace.sourceCommit, "abc123def456");
  assert.equal(
    response.json.launcherMetadata.cwd,
    ".spore/worktrees/spore/ws-fallback",
  );
});
