import assert from "node:assert/strict";
import test from "node:test";

import {
  getSessionStatusFromCli,
  launchGatewayControlledSession,
  postJson,
  readGatewayArtifactSummary,
  readGatewayArtifacts,
  startGatewayServer,
  waitForControlArtifact,
  waitForGatewayEvent,
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

  const steer = await postJson(
    harness.baseUrl,
    `/sessions/${encodeURIComponent(launched.sessionId)}/actions/steer`,
    {
      message: "Please acknowledge this steering message with the token SPORE_STEER_OK.",
      mode: "follow_up"
    }
  );

  assert.equal(steer.status, 200);
  assert.equal(steer.json?.ok, true);
  assert.equal(steer.json?.action, "steer");

  const steerEvent = await waitForGatewayEvent(
    harness.baseUrl,
    { session: launched.sessionId, type: "session.steer", limit: "20" },
    (event) => event?.payload?.message?.includes("SPORE_STEER_OK"),
    { timeoutMs: 15000, intervalMs: 400 }
  );
  assert.equal(steerEvent.type, "session.steer");

  const controlArtifactPath = await waitForControlArtifact(launched.sessionId, {
    timeoutMs: 15000,
    intervalMs: 400
  });
  assert.ok(controlArtifactPath);

  const stop = await postJson(
    harness.baseUrl,
    `/sessions/${encodeURIComponent(launched.sessionId)}/actions/stop`,
    {
      reason: "test requested stop"
    }
  );
  assert.equal(stop.status, 200);
  assert.equal(stop.json?.ok, true);
  assert.equal(stop.json?.action, "stop");

  const stopped = await waitForGatewaySessionState(
    harness.baseUrl,
    launched.sessionId,
    ["stopped"],
    { timeoutMs: 30000, intervalMs: 500 }
  );
  assert.equal(stopped.session.state, "stopped");

  const summary = await readGatewayArtifactSummary(harness.baseUrl, launched.sessionId);
  assert.equal(summary?.ok, true);
  assert.ok(summary?.artifacts?.transcript);

  const controlArtifact = await readGatewayArtifacts(harness.baseUrl, launched.sessionId, "control");
  assert.equal(controlArtifact?.ok, true);
  assert.ok(Array.isArray(controlArtifact.content));
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

  const markComplete = await postJson(
    harness.baseUrl,
    `/sessions/${encodeURIComponent(launched.sessionId)}/actions/mark-complete`,
    {
      reason: "test requested completion"
    }
  );
  assert.equal(markComplete.status, 200);
  assert.equal(markComplete.json?.ok, true);
  assert.equal(markComplete.json?.action, "mark-complete");

  const completed = await waitForGatewaySessionState(
    harness.baseUrl,
    launched.sessionId,
    ["completed"],
    { timeoutMs: 30000, intervalMs: 500 }
  );
  assert.equal(completed.session.state, "completed");

  const exitArtifact = await readGatewayArtifacts(harness.baseUrl, launched.sessionId, "exit");
  assert.equal(exitArtifact?.ok, true);
  assert.equal(exitArtifact.content?.exitCode, 0);

  const status = await getSessionStatusFromCli(harness.env);
  assert.ok(status.byState.completed >= 1);
});
