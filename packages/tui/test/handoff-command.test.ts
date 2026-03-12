import assert from "node:assert/strict";
import test from "node:test";

import {
  createExecution,
  listSteps,
  openOrchestratorDatabase,
  planWorkflowInvocation,
  upsertWorkflowHandoff,
} from "@spore/orchestrator";
import {
  findFreePort,
  makeTempPaths,
  runCliScript,
  startProcess,
  stopProcess,
  waitForHealth,
} from "@spore/test-support";

function runCli(args: string[], env: NodeJS.ProcessEnv = {}) {
  return runCliScript("packages/tui/src/cli/spore-ops.ts", args, {
    env,
    timeoutMs: 120_000,
  });
}

test("tui handoffs command exposes list and detail views", async (t) => {
  const orchestratorPort = await findFreePort();
  const temp = await makeTempPaths("spore-tui-handoffs-");
  const invocation = await planWorkflowInvocation({
    workflowPath: "config/workflows/frontend-ui-pass.yaml",
    projectPath: "config/projects/spore.yaml",
    domainId: "frontend",
    roles: ["lead", "scout", "builder", "tester", "reviewer"],
    objective: "Verify TUI handoff command.",
    invocationId: `tui-handoffs-${Date.now()}`,
  });
  createExecution(invocation, temp.dbPath);

  const db = openOrchestratorDatabase(temp.dbPath);
  try {
    const builderStep = listSteps(db, invocation.invocationId).find(
      (step) => step.role === "builder",
    );
    assert.ok(builderStep?.id);
    upsertWorkflowHandoff(db, {
      id: "tui-handoff-builder-summary",
      executionId: invocation.invocationId,
      fromStepId: builderStep.id,
      toStepId: "",
      sourceRole: "builder",
      targetRole: "tester",
      kind: "implementation_summary",
      status: "ready",
      summary: {
        title: "Builder summary",
        outcome: "implemented",
        confidence: "high",
      },
      artifacts: {
        sessionId: builderStep.sessionId,
        transcriptPath: null,
        briefPath: null,
        handoffPath: null,
        workspaceId: null,
        proposalArtifactId: null,
        snapshotRef: null,
        snapshotCommit: null,
      },
      payload: {},
      validation: {
        valid: false,
        degraded: true,
        mode: "review_pending",
        issues: [{ code: "missing_marker", message: "missing marker" }],
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      consumedAt: null,
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
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  t.after(async () => {
    await stopProcess(orchestrator);
  });

  await waitForHealth(`http://127.0.0.1:${orchestratorPort}/health`);

  const listOutput = await runCli([
    "handoffs",
    "--execution",
    invocation.invocationId,
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const listPayload = JSON.parse(listOutput.stdout);
  assert.equal(listPayload.detail.executionId, invocation.invocationId);
  assert.equal(listPayload.detail.handoffs[0]?.kind, "implementation_summary");
  assert.equal(listPayload.detail.handoffs[0]?.validation?.mode, "review_pending");

  const detailOutput = await runCli([
    "handoffs",
    "--execution",
    invocation.invocationId,
    "--handoff",
    "tui-handoff-builder-summary",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const detailPayload = JSON.parse(detailOutput.stdout);
  assert.equal(detailPayload.detail.id, "tui-handoff-builder-summary");
  assert.equal(detailPayload.detail.validation.mode, "review_pending");
});
