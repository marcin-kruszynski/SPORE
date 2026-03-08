import test from "node:test";
import assert from "node:assert/strict";

import { planWorkflowInvocation } from "../../../packages/orchestrator/src/invocation/plan-workflow-invocation.js";
import {
  createExecution,
  getExecutionDetail,
  spawnExecutionBranches
} from "../../../packages/orchestrator/src/execution/workflow-execution.js";
import { openOrchestratorDatabase, updateStep } from "../../../packages/orchestrator/src/store/execution-store.js";
import { transitionStepRecord } from "../../../packages/orchestrator/src/lifecycle/execution-lifecycle.js";
import { makeTempPaths } from "../../../packages/orchestrator/test/helpers/scenario-fixtures.js";
import { startProcess, waitForHealth } from "./helpers/http-harness.js";

const ORCHESTRATOR_PORT = 8795;
const WEB_PORT = 8796;

test("family governance, audit, and policy diff routes work through HTTP and web proxy", async (t) => {
  const { dbPath, sessionDbPath } = await makeTempPaths("spore-http-governance-");
  const executionId = `http-governance-root-${Date.now()}`;
  const invocation = await planWorkflowInvocation({
    projectPath: "config/projects/example-project.yaml",
    domainId: "frontend",
    roles: ["builder", "tester", "reviewer"],
    invocationId: executionId,
    objective: "HTTP governance test"
  });
  createExecution(invocation, dbPath);

  const spawned = await spawnExecutionBranches(executionId, [
    {
      roles: ["builder", "reviewer"],
      invocationId: `${executionId}-child-a`,
      objective: "Child branch A"
    },
    {
      roles: ["tester", "reviewer"],
      invocationId: `${executionId}-child-b`,
      objective: "Child branch B"
    }
  ], {}, dbPath, sessionDbPath);

  const db = openOrchestratorDatabase(dbPath);
  try {
    for (const child of spawned.created) {
      const detail = getExecutionDetail(child.invocation.invocationId, dbPath, sessionDbPath);
      const reviewer = detail.steps.find((step) => step.role === "reviewer");
      updateStep(db, transitionStepRecord(reviewer, "review_pending", {
        reviewStatus: "pending",
        approvalStatus: "pending"
      }));
    }
  } finally {
    db.close();
  }

  const orchestrator = startProcess("node", ["services/orchestrator/server.js"], {
    SPORE_ORCHESTRATOR_PORT: String(ORCHESTRATOR_PORT),
    SPORE_ORCHESTRATOR_DB_PATH: dbPath,
    SPORE_SESSION_DB_PATH: sessionDbPath
  });
  const web = startProcess("node", ["apps/web/server.js"], {
    SPORE_WEB_PORT: String(WEB_PORT),
    SPORE_ORCHESTRATOR_ORIGIN: `http://127.0.0.1:${ORCHESTRATOR_PORT}`,
    SPORE_GATEWAY_ORIGIN: "http://127.0.0.1:65535"
  });

  t.after(() => {
    orchestrator.kill("SIGTERM");
    web.kill("SIGTERM");
  });

  await waitForHealth(`http://127.0.0.1:${ORCHESTRATOR_PORT}/health`);
  await waitForHealth(`http://127.0.0.1:${WEB_PORT}/`);

  const pauseResponse = await fetch(`http://127.0.0.1:${ORCHESTRATOR_PORT}/executions/${executionId}/tree/pause`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      by: "operator",
      reason: "Pause the whole family before governance."
    })
  });
  assert.equal(pauseResponse.status, 200);
  const paused = await pauseResponse.json();
  assert.deepEqual(
    paused.changedExecutionIds.sort(),
    [executionId, ...spawned.created.map((item) => item.invocation.invocationId)].sort()
  );

  const resumeResponse = await fetch(`http://127.0.0.1:${WEB_PORT}/api/orchestrator/executions/${executionId}/tree/resume`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      by: "operator",
      comments: "Resume the family before governance."
    })
  });
  assert.equal(resumeResponse.status, 200);
  const resumed = await resumeResponse.json();
  assert.equal(resumed.tree.rootExecutionId, executionId);

  const reviewResponse = await fetch(`http://127.0.0.1:${ORCHESTRATOR_PORT}/executions/${executionId}/tree/review`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      status: "approved",
      scope: "all-pending",
      by: "operator",
      comments: "Approve all pending family reviews."
    })
  });
  assert.equal(reviewResponse.status, 200);
  const reviewed = await reviewResponse.json();
  assert.deepEqual(
    reviewed.changedExecutionIds.sort(),
    spawned.created.map((item) => item.invocation.invocationId).sort()
  );

  const approvalResponse = await fetch(`http://127.0.0.1:${WEB_PORT}/api/orchestrator/executions/${executionId}/tree/approval`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      status: "approved",
      scope: "all-pending",
      by: "operator",
      comments: "Approve all pending family approvals."
    })
  });
  assert.equal(approvalResponse.status, 200);
  const approved = await approvalResponse.json();
  assert.deepEqual(
    approved.changedExecutionIds.sort(),
    spawned.created.map((item) => item.invocation.invocationId).sort()
  );

  const auditResponse = await fetch(`http://127.0.0.1:${ORCHESTRATOR_PORT}/executions/${executionId}/audit`);
  assert.equal(auditResponse.status, 200);
  const audit = await auditResponse.json();
  assert.ok(audit.audit.some((item) => item.action === "tree:review"));
  assert.ok(audit.audit.some((item) => item.action === "tree:approval"));

  const policyDiffResponse = await fetch(`http://127.0.0.1:${WEB_PORT}/api/orchestrator/executions/${executionId}/policy-diff`);
  assert.equal(policyDiffResponse.status, 200);
  const policyDiff = await policyDiffResponse.json();
  assert.equal(policyDiff.detail.executionId, executionId);
  assert.equal(policyDiff.detail.steps.length, invocation.launches.length);
  assert.ok(Array.isArray(policyDiff.detail.executionVsPlan));
});
