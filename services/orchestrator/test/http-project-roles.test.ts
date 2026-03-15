import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import {
  adoptCoordinatorPlanFromHandoff,
  createExecution,
  openOrchestratorDatabase,
  planFeaturePromotion,
  upsertWorkflowHandoff,
} from "@spore/orchestrator";
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
import { reconcileExecution } from "../../../packages/orchestrator/src/execution/workflow-execution.impl.js";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForPromotionPlan(
  port: number,
  rootExecutionId: string,
  targetBranch: string,
  objective: string,
  timeoutMs = 60000,
) {
  const deadline = Date.now() + timeoutMs;
  let lastResponse: Awaited<ReturnType<typeof postJson>> | null = null;
  while (Date.now() < deadline) {
    const response = await postJson(
      `http://127.0.0.1:${port}/promotions/plan`,
      {
        execution: rootExecutionId,
        targetBranch,
        objective,
      },
    );
    if (response.status === 200) {
      return response;
    }
    lastResponse = response;
    await sleep(250);
  }
  return lastResponse;
}

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
      project: "config/projects/spore.yaml",
      domains: ["backend", "frontend"],
      objective: "Coordinate backend and frontend work for one project.",
      coordinationMode: "brownfield-intake",
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
  assert.equal(
    projectPlan.json.detail.rootInvocation.metadata.invocationMetadata
      .coordinationMode,
    "brownfield-intake",
  );
  assert.equal(projectPlan.json.detail.childInvocations.length, 1);
  assert.equal(
    projectPlan.json.detail.childInvocations[0]?.metadata?.invocationMetadata
      ?.projectLaneType,
    "planner",
  );

  const projectPlanProxy = await postJson(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/projects/plan`,
    {
      project: "config/projects/spore.yaml",
      domains: ["backend", "frontend"],
      objective: "Coordinate backend and frontend work for one project.",
      coordinationMode: "brownfield-intake",
    },
  );
  assert.equal(projectPlanProxy.status, 200);
  assert.ok(projectPlanProxy.json.ok);

  const projectInvoke = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/projects/invoke`,
    {
      project: "config/projects/spore.yaml",
      domains: ["backend", "frontend"],
      objective: "Coordinate backend and frontend work for one project.",
      coordinationMode: "brownfield-intake",
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
  assert.equal(
    rootExecution.json.detail.coordination?.rootExecutionId,
    rootExecutionId,
  );
  assert.equal(
    rootExecution.json.detail.coordination?.coordinationMode,
    "brownfield-intake",
  );

  const db = openOrchestratorDatabase(dbPath);
  try {
    const plannerExecutionId = `${rootExecutionId}-planner`;
    const coordinationPlanHandoff = {
      id: `${rootExecutionId}-coordination-plan`,
      executionId: plannerExecutionId,
      fromStepId: `${plannerExecutionId}:planner`,
      toStepId: `${rootExecutionId}:coordinator`,
      sourceRole: "planner",
      targetRole: "coordinator",
      kind: "coordination_plan",
      status: "ready",
      summary: {
        outcome: "Dispatch backend API work before the frontend shell.",
      },
      payload: {
        version: 1,
        domain_tasks: [
          {
            id: "task-backend-api",
            domainId: "backend",
            summary: "Land the backend API contract.",
            recommended_workflow: "feature-delivery",
          },
          {
            id: "task-frontend-shell",
            domainId: "frontend",
            summary: "Build the frontend shell against the contract.",
            recommended_workflow: "feature-delivery",
          },
        ],
        waves: [
          { id: "wave-1", task_ids: ["task-backend-api"] },
          { id: "wave-2", task_ids: ["task-frontend-shell"] },
        ],
        dependencies: [
          {
            from_task_id: "task-frontend-shell",
            to_task_id: "task-backend-api",
          },
        ],
        shared_contracts: [
          {
            id: "api-contract",
            summary: "Shared API contract",
          },
        ],
        unresolved_questions: [],
      },
      validation: {
        valid: true,
        degraded: false,
        mode: "accept",
        issues: [],
      },
      createdAt: "2026-03-14T12:00:00.000Z",
      updatedAt: "2026-03-14T12:00:00.000Z",
      consumedAt: null,
    };
    upsertWorkflowHandoff(db, coordinationPlanHandoff);
    adoptCoordinatorPlanFromHandoff(db, rootExecutionId, coordinationPlanHandoff);
  } finally {
    db.close();
  }

  await reconcileExecution(rootExecutionId, { dbPath });

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

  const promotionPlan = await planFeaturePromotion({
    projectPath: "config/projects/spore.yaml",
    invocationId: `${rootExecutionId}-integrator`,
    coordinationGroupId: rootExecutionId,
    parentExecutionId: rootExecutionId,
    objective: "Promote reviewed feature outputs into an integration candidate.",
    targetBranch: "main",
    metadata: {
      projectRootExecutionId: rootExecutionId,
      rootExecutionId,
      coordinationMode: "brownfield-intake",
      promotion: {
        status: "blocked",
        targetBranch: "main",
        blockers: [
          {
            code: "awaiting-coordinator",
            reason: "Integrator should wait for coordinator unblock.",
          },
        ],
      },
    },
  });
  createExecution(promotionPlan, dbPath);
  const integratorExecutionId = promotionPlan.invocationId;

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
    integratorExecution.json.detail.execution.topology?.coordinationMode,
    "brownfield-intake",
  );
  assert.equal(
    integratorExecution.json.detail.execution.topology?.kind,
    "promotion-lane",
  );
  assert.ok(
    ["blocked", "running", "promotion_candidate", "completed"].includes(
      integratorExecution.json.detail.execution.promotionStatus,
    ),
  );
  assert.equal(
    integratorExecution.json.detail.execution.promotion?.targetBranch,
    "main",
  );

  const coordinationFamily = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/coordination-families/${encodeURIComponent(rootExecutionId)}`,
  );
  assert.equal(coordinationFamily.status, 200);
  assert.ok(coordinationFamily.json.ok);
  assert.equal(coordinationFamily.json.detail.rootExecutionId, rootExecutionId);
  assert.equal(
    coordinationFamily.json.detail.coordinationMode,
    "brownfield-intake",
  );
  assert.equal(
    coordinationFamily.json.detail.plannerLane?.role,
    "planner",
  );
  assert.ok(coordinationFamily.json.detail.adoptedPlan);
  assert.ok(Array.isArray(coordinationFamily.json.detail.dispatchQueue?.tasks));
  assert.ok(
    coordinationFamily.json.detail.dispatchQueue.tasks.every(
      (task) => task.executionId || ["pending", "blocked"].includes(task.status),
    ),
  );
  assert.ok(Array.isArray(coordinationFamily.json.detail.leadLanes));
  assert.equal(
    coordinationFamily.json.detail.integratorLane?.executionId,
    integratorExecutionId,
  );
  assert.ok(
    coordinationFamily.json.detail.leadLanes.every(
      (lane) => lane.dispatchTaskId && lane.objective !== coordinationFamily.json.detail.objective,
    ),
  );

  const nonRootCoordinationFamily = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/coordination-families/${encodeURIComponent(integratorExecutionId)}`,
  );
  assert.equal(nonRootCoordinationFamily.status, 404);
  assert.equal(nonRootCoordinationFamily.json.ok, false);

  const coordinationLanes = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/coordination-families/${encodeURIComponent(rootExecutionId)}/lanes`,
  );
  assert.equal(coordinationLanes.status, 200);
  assert.ok(coordinationLanes.json.ok);
  assert.deepEqual(coordinationLanes.json.detail.leadLanes.map((lane) => lane.role), [
    "lead",
  ]);
  assert.ok(
    coordinationLanes.json.detail.leadLanes.every(
      (lane) => lane.dispatchTaskId && lane.recommendedWorkflow,
    ),
  );
  assert.equal(
    coordinationLanes.json.detail.dispatchQueue.tasks.some(
      (task) => task.taskId === "task-frontend-shell" && task.status === "pending",
    ),
    true,
  );
  assert.equal(
    coordinationLanes.json.detail.integratorLane?.executionId,
    integratorExecutionId,
  );

  const coordinationReadiness = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/coordination-families/${encodeURIComponent(rootExecutionId)}/readiness`,
  );
  assert.equal(coordinationReadiness.status, 200);
  assert.ok(coordinationReadiness.json.ok);
  assert.equal(
    coordinationReadiness.json.detail.rootExecutionId,
    rootExecutionId,
  );
  assert.equal(
    coordinationReadiness.json.detail.coordinationMode,
    "brownfield-intake",
  );
  assert.equal(
    typeof coordinationReadiness.json.detail.readiness.state,
    "string",
  );
  assert.equal(
    coordinationReadiness.json.detail.readiness.readyForIntegratorPlanning,
    false,
  );
  assert.ok(coordinationReadiness.json.detail.adoptedPlan);
  assert.ok(coordinationReadiness.json.detail.queueStatus);
  assert.ok(Array.isArray(coordinationReadiness.json.detail.replanHistory));
});
