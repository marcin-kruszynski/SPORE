import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";

import { ensureRealPiContext } from "./helpers/e2e-harness.js";
import { startProcess, waitForHealth, postJson, getJson } from "../../../services/orchestrator/test/helpers/http-harness.js";

async function startOrchestratorForPi(t, prefix) {
  const context = await ensureRealPiContext(t, { prefix });
  if (!context) {
    return null;
  }

  await Promise.all([
    fs.mkdir(path.dirname(context.env.SPORE_ORCHESTRATOR_DB_PATH), { recursive: true }),
    fs.mkdir(path.dirname(context.env.SPORE_SESSION_DB_PATH), { recursive: true }),
    fs.mkdir(path.dirname(context.env.SPORE_EVENT_LOG_PATH), { recursive: true })
  ]);

  const port = 8801 + Math.floor(Math.random() * 100);
  const child = startProcess("node", ["services/orchestrator/server.js"], {
    ...context.env,
    SPORE_ORCHESTRATOR_PORT: String(port)
  });
  t.after(() => child.kill("SIGTERM"));
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(`${baseUrl}/health`);
  return {
    ...context,
    baseUrl,
    port,
    process: child
  };
}

async function runCanonicalScenario(t, scenarioId) {
  const harness = await startOrchestratorForPi(t, `pi-canonical-${scenarioId}`);
  if (!harness) {
    return null;
  }

  const response = await postJson(`${harness.baseUrl}/scenarios/${scenarioId}/run`, {
    launcher: "pi-rpc",
    wait: true,
    by: "pi-e2e",
    source: "pi-e2e"
  });
  assert.equal(response.status, 200);
  assert.equal(response.json?.run?.scenarioId, scenarioId);
  assert.ok(["completed", "waiting_review", "waiting_approval", "held"].includes(response.json?.run?.status));

  const summary = await getJson(`${harness.baseUrl}/scenarios/${scenarioId}`);
  assert.equal(summary.status, 200);
  assert.equal(summary.json?.scenario?.id, scenarioId);

  const runs = await getJson(`${harness.baseUrl}/scenarios/${scenarioId}/runs`);
  assert.equal(runs.status, 200);
  assert.ok(runs.json?.detail?.runs?.some((item) => item.id === response.json.run.id));

  const artifacts = await getJson(
    `${harness.baseUrl}/scenarios/${scenarioId}/runs/${encodeURIComponent(response.json.run.id)}/artifacts`
  );
  assert.equal(artifacts.status, 200);
  assert.ok(Array.isArray(artifacts.json?.detail?.executions));
  assert.ok(artifacts.json.detail.executions.length >= 1);
  assert.ok(
    artifacts.json.detail.executions.some((entry) =>
      Array.isArray(entry.artifacts) ? entry.artifacts.length >= 1 : true
    )
  );

  const executionId = response.json?.execution?.execution?.id;
  assert.ok(executionId);
  const history = await getJson(
    `${harness.baseUrl}/executions/${encodeURIComponent(executionId)}/history`
  );
  assert.equal(history.status, 200);
  assert.equal(history.json?.detail?.execution?.id, executionId);
  if (response.json?.run?.status === "held") {
    assert.ok(Array.isArray(response.json?.execution?.escalations));
    assert.ok(response.json.execution.escalations.length >= 1);
    assert.equal(response.json?.execution?.execution?.state, "held");
  }

  return response.json;
}

test("real pi-rpc backend canonical scenario settles and records artifacts", async (t) => {
  const result = await runCanonicalScenario(t, "backend-service-delivery");
  if (!result) {
    return;
  }
  assert.ok(result.execution?.execution?.id);
  assert.ok(result.execution?.sessions?.length >= 1);
});

test("real pi-rpc frontend canonical scenario settles and records artifacts", async (t) => {
  const result = await runCanonicalScenario(t, "frontend-ui-pass");
  if (!result) {
    return;
  }
  assert.ok(result.execution?.execution?.id);
  assert.ok(result.execution?.steps?.length >= 1);
});

test("real pi-rpc docs canonical scenario settles and records artifacts", async (t) => {
  const result = await runCanonicalScenario(t, "docs-adr-pass");
  if (!result) {
    return;
  }
  assert.ok(result.execution?.execution?.id);
  assert.ok(["completed", "waiting_review", "waiting_approval", "held", "failed"].includes(result.run?.status));
  assert.ok((result.execution?.sessions?.length ?? 0) >= 1);
});
