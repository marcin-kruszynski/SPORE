import assert from "node:assert/strict";
import test from "node:test";

import {
  createExecution,
  listSteps,
  planWorkflowInvocation,
  recordWorkflowHandoffConsumption,
  upsertWorkflowHandoff,
  openOrchestratorDatabase,
} from "@spore/orchestrator";
import {
  findFreePort,
  getJson,
  makeTempPaths,
  startProcess,
  stopProcess,
  waitForHealth,
} from "@spore/test-support";

test("orchestrator exposes execution workflow handoff list and detail routes", async (t) => {
  const orchestratorPort = await findFreePort();
  const temp = await makeTempPaths("spore-http-handoffs-");

  const invocation = await planWorkflowInvocation({
    workflowPath: "config/workflows/frontend-ui-pass.yaml",
    projectPath: "config/projects/spore.yaml",
    domainId: "frontend",
    roles: ["lead", "scout", "builder", "tester", "reviewer"],
    objective: "Verify workflow handoff HTTP routes.",
    invocationId: `http-handoffs-${Date.now()}`,
  });
  createExecution(invocation, temp.dbPath);

  const db = openOrchestratorDatabase(temp.dbPath);
  try {
    const builderStep = listSteps(db, invocation.invocationId).find(
      (step) => step.role === "builder",
    );
    assert.ok(builderStep?.id);
    upsertWorkflowHandoff(db, {
      id: "handoff-http-builder-summary",
      executionId: invocation.invocationId,
      fromStepId: builderStep.id,
      toStepId: "",
      sourceRole: "builder",
      targetRole: "tester",
      kind: "implementation_summary",
      status: "ready",
      summary: {
        title: "Builder summary",
        objective: "Verify workflow handoff HTTP routes.",
        outcome: "implemented",
        confidence: "high",
      },
      artifacts: {
        sessionId: builderStep.sessionId,
        transcriptPath: `tmp/sessions/${builderStep.sessionId}.transcript.md`,
        briefPath: `tmp/orchestrator/${invocation.invocationId}/${builderStep.sessionId}.brief.md`,
        handoffPath: `tmp/sessions/${builderStep.sessionId}.handoff.json`,
        workspaceId: null,
        proposalArtifactId: null,
        snapshotRef: null,
        snapshotCommit: null,
      },
      payload: {
        changedPaths: ["apps/web/src/main.ts"],
      },
      validation: {
        valid: true,
        degraded: false,
        mode: "accept",
        issues: [],
      },
      createdAt: "2026-03-12T12:00:00.000Z",
      updatedAt: "2026-03-12T12:00:00.000Z",
      consumedAt: null,
    });
    recordWorkflowHandoffConsumption(db, {
      id: "consumer-http-builder-summary-tester",
      executionId: invocation.invocationId,
      handoffId: "handoff-http-builder-summary",
      consumerStepId: `${invocation.invocationId}:step:4`,
      consumerRole: "tester",
      consumerSessionId: `${invocation.invocationId}-tester`,
      consumedAt: "2026-03-12T12:10:00.000Z",
    });
  } finally {
    db.close();
  }

  const orchestrator = startProcess(
    "node",
    ["services/orchestrator/server.js"],
    {
      SPORE_ORCHESTRATOR_PORT: String(orchestratorPort),
      SPORE_ORCHESTRATOR_DB_PATH: temp.dbPath,
      SPORE_SESSION_DB_PATH: temp.sessionDbPath,
    },
  );
  t.after(async () => {
    await stopProcess(orchestrator);
  });

  await waitForHealth(`http://127.0.0.1:${orchestratorPort}/health`);

  const listResponse = await getJson(
    `http://127.0.0.1:${orchestratorPort}/executions/${encodeURIComponent(invocation.invocationId)}/handoffs`,
  );
  assert.equal(listResponse.status, 200);
  assert.equal(listResponse.json.ok, true);
  assert.equal(listResponse.json.detail.executionId, invocation.invocationId);
  assert.equal(listResponse.json.detail.handoffs.length, 1);
  assert.equal(
    listResponse.json.detail.handoffs[0].kind,
    "implementation_summary",
  );
  assert.equal(listResponse.json.detail.handoffs[0].consumerCount, 1);
  assert.equal(listResponse.json.detail.handoffs[0].validation.valid, true);

  const detailResponse = await getJson(
    `http://127.0.0.1:${orchestratorPort}/executions/${encodeURIComponent(invocation.invocationId)}/handoffs/${encodeURIComponent("handoff-http-builder-summary")}`,
  );
  assert.equal(detailResponse.status, 200);
  assert.equal(detailResponse.json.ok, true);
  assert.equal(detailResponse.json.detail.id, "handoff-http-builder-summary");
  assert.equal(detailResponse.json.detail.sourceRole, "builder");
  assert.equal(detailResponse.json.detail.consumerCount, 1);
  assert.equal(detailResponse.json.detail.consumers[0].consumerRole, "tester");
});
