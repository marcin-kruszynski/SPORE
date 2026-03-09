import assert from "node:assert/strict";
import test from "node:test";

import {
  getControlHistory,
  getControlStatus,
  getLiveSession,
  getSessionStatusFromCli,
  launchGatewayControlledSession,
  postJson,
  readGatewayArtifactSummary,
  readGatewayArtifacts,
  startGatewayServer,
  waitForControlArtifact,
  waitForGatewayEvent,
  waitForLiveControlHistory,
  waitForGatewaySessionState
} from "./helpers/gateway-harness.js";

function shouldRunControlE2E() {
  return process.env.SPORE_RUN_PI_CONTROL_E2E === "1";
}

test("gateway steer and stop scaffolding works with a real PI session", async (t) => {
  if (!shouldRunControlE2E()) {
    t.skip("set SPORE_RUN_PI_CONTROL_E2E=1 to run real gateway control E2E");
    return;
  }

  const harness = await startGatewayServer(t);
  if (!harness) {
    return;
  }

  const launched = await launchGatewayControlledSession(harness);
  const active = await waitForGatewaySessionState(
    harness.baseUrl,
    launched.sessionId,
    ["active", "completed", "failed", "stopped"],
    { timeoutMs: 45000, intervalMs: 500 }
  );

  if (active.session.state !== "active") {
    t.skip(`session settled before steer window (${active.session.state})`);
    return;
  }

  const initialLive = await getLiveSession(harness.baseUrl, launched.sessionId, { limit: 20 });
  assert.equal(initialLive.status, 200);
  assert.equal(initialLive.json?.session?.id, launched.sessionId);
  assert.ok(Array.isArray(initialLive.json?.events));
  assert.equal(initialLive.json?.launcher?.runId, launched.runId);
  assert.equal(initialLive.json?.launcher?.launcherType, "pi-rpc");
  assert.ok(Array.isArray(initialLive.json?.controlHistory));

  const steer = await postJson(
    harness.baseUrl,
    `/sessions/${encodeURIComponent(launched.sessionId)}/actions/steer`,
    {
      message: "Please acknowledge this steering message with the token SPORE_STEER_OK.",
      mode: "follow_up",
      idempotencyKey: `${launched.sessionId}-steer`
    },
    {
      "x-idempotency-key": `${launched.sessionId}-steer`
    }
  );

  assert.equal(steer.status, 200);
  assert.equal(steer.json?.ok, true);
  assert.equal(steer.json?.action, "steer");
  assert.ok(steer.json?.request?.id);
  assert.equal(steer.json?.request?.ackStatus, "accepted");

  const steerEvent = await waitForGatewayEvent(
    harness.baseUrl,
    { session: launched.sessionId, type: "session.steer", limit: "20" },
    (event) => event?.payload?.message?.includes("SPORE_STEER_OK"),
    { timeoutMs: 15000, intervalMs: 400 }
  );
  assert.equal(steerEvent.type, "session.steer");

  const liveAfterSteer = await waitForLiveControlHistory(
    harness.baseUrl,
    launched.sessionId,
    (entry) => JSON.stringify(entry).includes("SPORE_STEER_OK"),
    { timeoutMs: 15000, intervalMs: 400, limit: 30 }
  );
  assert.equal(liveAfterSteer.session.id, launched.sessionId);
  assert.ok(liveAfterSteer.controlHistory.length >= 1);

  const steerHistory = await getControlHistory(harness.baseUrl, launched.sessionId, { limit: 10 });
  assert.equal(steerHistory.status, 200);
  assert.ok(Array.isArray(steerHistory.json?.controlHistory));
  assert.ok(steerHistory.json.controlHistory.some((entry) => entry.id === steer.json.request.id));

  const steerStatus = await getControlStatus(harness.baseUrl, launched.sessionId, steer.json.request.id);
  assert.equal(steerStatus.status, 200);
  assert.equal(steerStatus.json?.request?.id, steer.json.request.id);
  assert.equal(steerStatus.json?.request?.ackStatus, "accepted");

  const controlArtifactPath = await waitForControlArtifact(launched.sessionId, {
    timeoutMs: 15000,
    intervalMs: 400
  });
  assert.ok(controlArtifactPath);

  const liveSnapshotAfterSteer = await getLiveSession(harness.baseUrl, launched.sessionId, { limit: 30 });
  assert.equal(liveSnapshotAfterSteer.status, 200);
  assert.equal(liveSnapshotAfterSteer.json?.ok, true);
  assert.ok(Array.isArray(liveSnapshotAfterSteer.json?.controlHistory));
  assert.ok(liveSnapshotAfterSteer.json?.diagnostics);

  const stop = await postJson(
    harness.baseUrl,
    `/sessions/${encodeURIComponent(launched.sessionId)}/actions/stop`,
    {
      reason: "test requested stop",
      idempotencyKey: `${launched.sessionId}-stop`
    },
    {
      "x-idempotency-key": `${launched.sessionId}-stop`
    }
  );
  assert.equal(stop.status, 200);
  assert.equal(stop.json?.ok, true);
  assert.equal(stop.json?.action, "stop");
  assert.equal(stop.json?.request?.ackStatus, "completed");
  assert.equal(stop.json?.request?.status, "completed");

  const stopped = await waitForGatewaySessionState(
    harness.baseUrl,
    launched.sessionId,
    ["stopped"],
    { timeoutMs: 30000, intervalMs: 500 }
  );
  assert.equal(stopped.session.state, "stopped");

  const liveStopped = await getLiveSession(harness.baseUrl, launched.sessionId, { limit: 30 });
  assert.equal(liveStopped.status, 200);
  assert.equal(liveStopped.json?.session?.state, "stopped");
  assert.ok(Array.isArray(liveStopped.json?.controlHistory));
  assert.ok(
    liveStopped.json.controlHistory.some((entry) =>
      JSON.stringify(entry).includes("test requested stop")
    )
  );

  const summary = await readGatewayArtifactSummary(harness.baseUrl, launched.sessionId);
  assert.equal(summary?.ok, true);
  assert.ok(summary?.artifacts?.transcript);

  const controlArtifact = await readGatewayArtifacts(harness.baseUrl, launched.sessionId, "control");
  assert.equal(controlArtifact?.ok, true);
  assert.ok(Array.isArray(controlArtifact.content));

  const liveStoppedDiagnostics = await getLiveSession(harness.baseUrl, launched.sessionId, { limit: 30 });
  assert.equal(liveStoppedDiagnostics.status, 200);
  assert.equal(liveStoppedDiagnostics.json?.diagnostics?.status, "settled");
});

test("gateway mark-complete scaffolding works with a real PI session", async (t) => {
  if (!shouldRunControlE2E()) {
    t.skip("set SPORE_RUN_PI_CONTROL_E2E=1 to run real gateway control E2E");
    return;
  }

  const harness = await startGatewayServer(t);
  if (!harness) {
    return;
  }

  const launched = await launchGatewayControlledSession(harness, {
    extraArgs: ["--no-monitor"]
  });
  const active = await waitForGatewaySessionState(
    harness.baseUrl,
    launched.sessionId,
    ["active", "completed", "failed", "stopped"],
    { timeoutMs: 45000, intervalMs: 500 }
  );

  if (active.session.state !== "active") {
    t.skip(`session settled before mark-complete window (${active.session.state})`);
    return;
  }

  const initialLive = await getLiveSession(harness.baseUrl, launched.sessionId, { limit: 20 });
  assert.equal(initialLive.status, 200);
  assert.equal(initialLive.json?.session?.state, "active");
  assert.equal(initialLive.json?.launcher?.launcherType, "pi-rpc");

  const markComplete = await postJson(
    harness.baseUrl,
    `/sessions/${encodeURIComponent(launched.sessionId)}/actions/mark-complete`,
    {
      reason: "test requested completion",
      idempotencyKey: `${launched.sessionId}-complete`
    },
    {
      "x-idempotency-key": `${launched.sessionId}-complete`
    }
  );
  assert.equal(markComplete.status, 200);
  assert.equal(markComplete.json?.ok, true);
  assert.equal(markComplete.json?.action, "mark-complete");
  assert.equal(markComplete.json?.request?.ackStatus, "completed");
  assert.equal(markComplete.json?.request?.status, "completed");

  const completed = await waitForGatewaySessionState(
    harness.baseUrl,
    launched.sessionId,
    ["completed"],
    { timeoutMs: 30000, intervalMs: 500 }
  );
  assert.equal(completed.session.state, "completed");

  const completeRequested = await waitForGatewayEvent(
    harness.baseUrl,
    { session: launched.sessionId, type: "session.complete_requested", limit: "20" },
    (event) => event?.payload?.reason === "test requested completion",
    { timeoutMs: 15000, intervalMs: 400 }
  );
  assert.equal(completeRequested.type, "session.complete_requested");

  const exitArtifact = await readGatewayArtifacts(harness.baseUrl, launched.sessionId, "exit");
  assert.equal(exitArtifact?.ok, true);
  assert.equal(exitArtifact.content?.exitCode, 0);

  const liveCompletedDiagnostics = await getLiveSession(harness.baseUrl, launched.sessionId, { limit: 30 });
  assert.equal(liveCompletedDiagnostics.status, 200);
  assert.equal(liveCompletedDiagnostics.json?.diagnostics?.status, "settled");

  const status = await getSessionStatusFromCli(harness.env);
  assert.ok(status.byState.completed >= 1);
});
