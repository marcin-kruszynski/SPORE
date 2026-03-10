import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import { makeTempPaths } from "@spore/test-support";
import {
  findFreePort,
  getJson,
  postJson,
  startProcess,
  stopProcess,
  waitForHealth,
  withEventLogPath,
} from "./helpers/http-harness.js";

test("project coordination and promotion routes expose coordinator and integrator lanes", async (t) => {
  const ORCHESTRATOR_PORT = await findFreePort();
  const WEB_PORT = await findFreePort();
  const { dbPath, sessionDbPath, eventLogPath } = withEventLogPath(
    await makeTempPaths("spore-http-project-roles-"),
  );
  const worktreeRoot = `${dbPath}.worktrees`;

  const orchestrator = startProcess(
    "node",
    ["services/orchestrator/server.js"],
    {
      SPORE_ORCHESTRATOR_PORT: String(ORCHESTRATOR_PORT),
      SPORE_ORCHESTRATOR_DB_PATH: dbPath,
      SPORE_SESSION_DB_PATH: sessionDbPath,
      SPORE_EVENT_LOG_PATH: eventLogPath,
      SPORE_WORKTREE_ROOT: worktreeRoot,
    },
  );
  const web = startProcess("node", ["apps/web/server.js"], {
    SPORE_WEB_PORT: String(WEB_PORT),
    SPORE_ORCHESTRATOR_ORIGIN: `http://127.0.0.1:${ORCHESTRATOR_PORT}`,
    SPORE_GATEWAY_ORIGIN: "http://127.0.0.1:65535",
  });

  t.after(async () => {
    await Promise.all([stopProcess(orchestrator), stopProcess(web)]);
  });
  t.after(async () => {
    await fs.rm(worktreeRoot, { recursive: true, force: true });
  });

  await waitForHealth(`http://127.0.0.1:${ORCHESTRATOR_PORT}/health`);
  await waitForHealth(`http://127.0.0.1:${WEB_PORT}/`);

  const projectPlan = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/projects/plan`,
    {
      project: "config/projects/example-project.yaml",
      domains: ["backend", "frontend"],
      objective: "Coordinate backend and frontend work for one project.",
    },
  );
  assert.equal(projectPlan.status, 200);
  assert.ok(projectPlan.json.ok);
  assert.equal(
    projectPlan.json.detail.rootInvocation.metadata.invocationMetadata
      .projectRole,
    "coordinator",
  );
  assert.equal(
    projectPlan.json.detail.rootInvocation.metadata.invocationMetadata
      .projectLaneType,
    "coordinator",
  );
  assert.deepEqual(projectPlan.json.detail.selectedDomains, [
    "backend",
    "frontend",
  ]);
  assert.equal(projectPlan.json.detail.childInvocations.length, 2);

  const projectPlanProxy = await postJson(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/projects/plan`,
    {
      project: "config/projects/example-project.yaml",
      domains: ["backend", "frontend"],
      objective: "Coordinate backend and frontend work for one project.",
    },
  );
  assert.equal(projectPlanProxy.status, 200);
  assert.ok(projectPlanProxy.json.ok);

  const projectInvoke = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/projects/invoke`,
    {
      project: "config/projects/example-project.yaml",
      domains: ["backend", "frontend"],
      objective: "Coordinate backend and frontend work for one project.",
      wait: true,
      stub: true,
      timeout: 20000,
      interval: 250,
    },
  );
  assert.equal(projectInvoke.status, 200);
  assert.ok(projectInvoke.json.ok);

  const rootExecutionId =
    projectInvoke.json.detail?.created?.root?.execution?.id ??
    projectInvoke.json.detail?.plan?.rootInvocation?.invocationId;
  assert.ok(rootExecutionId);

  const rootExecution = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/executions/${encodeURIComponent(rootExecutionId)}`,
  );
  assert.equal(rootExecution.status, 200);
  assert.ok(rootExecution.json.ok);
  assert.equal(rootExecution.json.detail.execution.projectRole, "coordinator");
  assert.equal(
    rootExecution.json.detail.execution.topology?.kind,
    "project-root",
  );

  const treeReview = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/executions/${encodeURIComponent(rootExecutionId)}/tree/review`,
    {
      status: "approved",
      scope: "all-pending",
      by: "test-runner",
      comments: "Approve project lanes for promotion.",
    },
  );
  assert.equal(treeReview.status, 200);
  assert.ok(treeReview.json.ok);

  const treeApproval = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/executions/${encodeURIComponent(rootExecutionId)}/tree/approval`,
    {
      status: "approved",
      scope: "all-pending",
      by: "test-runner",
      comments: "Approve project lanes for promotion.",
    },
  );
  assert.equal(treeApproval.status, 200);
  assert.ok(treeApproval.json.ok);

  const promotionPlan = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/promotions/plan`,
    {
      execution: rootExecutionId,
      targetBranch: "main",
      objective:
        "Promote reviewed feature outputs into an integration candidate.",
    },
  );
  assert.equal(promotionPlan.status, 200);
  assert.ok(promotionPlan.json.ok);
  assert.equal(
    promotionPlan.json.detail.invocation.metadata.invocationMetadata
      .projectRole,
    "integrator",
  );
  assert.equal(
    promotionPlan.json.detail.invocation.metadata.invocationMetadata
      .projectLaneType,
    "integrator",
  );
  assert.equal(
    promotionPlan.json.detail.invocation.metadata.invocationMetadata
      .topologyKind,
    "promotion-lane",
  );
  assert.equal(
    promotionPlan.json.detail.invocation.metadata.invocationMetadata.promotion
      .targetBranch,
    "main",
  );

  const promotionInvoke = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/promotions/invoke`,
    {
      execution: rootExecutionId,
      targetBranch: "main",
      objective:
        "Promote reviewed feature outputs into an integration candidate.",
      wait: true,
      stub: true,
      timeout: 20000,
      interval: 250,
    },
  );
  assert.equal(promotionInvoke.status, 200);
  assert.ok(promotionInvoke.json.ok);

  const integratorExecutionId =
    promotionInvoke.json.detail?.created?.execution?.id ??
    promotionInvoke.json.detail?.plan?.invocation?.invocationId;
  assert.ok(integratorExecutionId);

  const integratorExecution = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/executions/${encodeURIComponent(integratorExecutionId)}`,
  );
  assert.equal(integratorExecution.status, 200);
  assert.ok(integratorExecution.json.ok);
  assert.equal(
    integratorExecution.json.detail.execution.projectRole,
    "integrator",
  );
  assert.equal(
    integratorExecution.json.detail.execution.topology?.kind,
    "promotion-lane",
  );
  assert.ok(
    ["running", "promotion_candidate", "completed"].includes(
      integratorExecution.json.detail.execution.promotionStatus,
    ),
  );
  assert.equal(
    integratorExecution.json.detail.execution.promotion?.targetBranch,
    "main",
  );

  const integratorWorkspaces = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/executions/${encodeURIComponent(integratorExecutionId)}/workspaces`,
  );
  assert.equal(integratorWorkspaces.status, 200);
  assert.ok(integratorWorkspaces.json.ok);
  assert.ok(Array.isArray(integratorWorkspaces.json.detail.workspaces));
  assert.ok(integratorWorkspaces.json.detail.workspaces.length >= 1);
  assert.ok(
    integratorWorkspaces.json.detail.workspaces.some(
      (workspace) => workspace.metadata?.workspacePurpose === "integration",
    ),
  );

  const promotionPlanProxy = await postJson(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/promotions/plan`,
    {
      execution: rootExecutionId,
      targetBranch: "main",
    },
  );
  assert.equal(promotionPlanProxy.status, 200);
  assert.ok(promotionPlanProxy.json.ok);
});
