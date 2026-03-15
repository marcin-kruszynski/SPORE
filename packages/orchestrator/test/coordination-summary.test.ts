import assert from "node:assert/strict";
import test from "node:test";

import { buildCoordinatorSummary } from "../src/execution/coordination-summary.js";
import {
  adoptCoordinatorPlanFromHandoff,
  buildProjectCoordinationPlan,
  createExecution,
  getCoordinatorFamilySummary,
  reconcileExecution,
} from "../src/execution/workflow-execution.js";
import {
  planFeaturePromotion,
  planWorkflowInvocation,
} from "../src/invocation/plan-workflow-invocation.js";
import { createEscalationRecord, transitionExecutionRecord } from "../src/lifecycle/execution-lifecycle.js";
import {
  getExecution,
  insertEscalation,
  openOrchestratorDatabase,
  upsertWorkflowHandoff,
  updateExecution,
} from "../src/store/execution-store.js";
import { makeTempPaths } from "./helpers/scenario-fixtures.js";

async function createLeadLaneExecution({
  invocationId,
  domainId,
  coordinationMode = "delivery",
  objective,
}) {
  return planWorkflowInvocation({
    projectPath: "config/projects/example-project.yaml",
    domainId,
    maxRoles: 32,
    invocationId: `${invocationId}-${domainId}-lead`,
    objective,
    coordinationGroupId: invocationId,
    parentExecutionId: invocationId,
    branchKey: `domain:${domainId}`,
    metadata: {
      topologyKind: "project-child",
      projectRole: "lead",
      projectLaneType: "lead",
      projectRootExecutionId: invocationId,
      coordinationMode,
      selectedDomainId: domainId,
    },
  });
}

test("buildCoordinatorSummary projects coordinator family lanes, blockers, readiness, and routing summary", () => {
  const rootExecutionId = "coord-root-1";
  const summary = buildCoordinatorSummary({
    rootExecution: {
      id: rootExecutionId,
      coordinationGroupId: "family-alpha",
      projectId: "spore",
      objective: "Coordinate delivery across backend and frontend lanes.",
      state: "held",
      metadata: {
        topologyKind: "project-root",
        projectRole: "coordinator",
        projectLaneType: "coordinator",
        familyKey: "family-alpha",
        coordinationMode: "delivery",
      },
    },
    familyExecutions: [
      {
        id: rootExecutionId,
        coordinationGroupId: "family-alpha",
        projectId: "spore",
        objective: "Coordinate delivery across backend and frontend lanes.",
        state: "held",
        metadata: {
          topologyKind: "project-root",
          projectRole: "coordinator",
          projectLaneType: "coordinator",
          familyKey: "family-alpha",
          coordinationMode: "delivery",
        },
      },
      {
        id: "planner-1",
        parentExecutionId: rootExecutionId,
        coordinationGroupId: "family-alpha",
        projectId: "spore",
        state: "completed",
        metadata: {
          topologyKind: "project-child",
          projectRole: "planner",
          projectLaneType: "planner",
          projectRootExecutionId: rootExecutionId,
        },
      },
      {
        id: "lead-backend",
        parentExecutionId: rootExecutionId,
        coordinationGroupId: "family-alpha",
        domainId: "backend",
        state: "running",
        metadata: {
          topologyKind: "project-child",
          projectLaneType: "lead",
          projectRootExecutionId: rootExecutionId,
        },
      },
      {
        id: "lead-frontend",
        parentExecutionId: rootExecutionId,
        coordinationGroupId: "family-alpha",
        domainId: "frontend",
        state: "waiting_review",
        reviewStatus: "pending",
        metadata: {
          topologyKind: "project-child",
          projectLaneType: "lead",
          projectRootExecutionId: rootExecutionId,
        },
      },
      {
        id: "integrator-1",
        parentExecutionId: rootExecutionId,
        coordinationGroupId: "family-alpha",
        projectId: "spore",
        state: "held",
        metadata: {
          topologyKind: "promotion-lane",
          projectRole: "integrator",
          projectLaneType: "integrator",
          projectRootExecutionId: rootExecutionId,
          promotion: {
            status: "blocked",
            blockers: [
              {
                code: "merge-conflict",
                reason: "Integration branch has unresolved conflicts.",
              },
            ],
          },
        },
      },
    ],
    familyEscalations: [
      {
        id: "esc-1",
        executionId: "lead-backend",
        reason: "lead-blocked",
        status: "open",
        targetRole: "coordinator",
        payload: {
          summary: "Backend lane is blocked on API schema review.",
        },
      },
    ],
    familyHandoffs: [
      {
        id: "handoff-plan-old",
        executionId: rootExecutionId,
        kind: "coordination_plan",
        summary: {
          outcome: "Older plan version.",
        },
        payload: {
          affected_domains: ["backend"],
          waves: [{ id: "wave-1" }],
        },
        updatedAt: "2026-03-14T08:30:00.000Z",
      },
      {
        id: "handoff-old",
        executionId: rootExecutionId,
        kind: "routing_summary",
        summary: {
          outcome: "Older routing summary.",
        },
        payload: {
          summary: "Older routing summary.",
        },
        updatedAt: "2026-03-14T09:00:00.000Z",
      },
      {
        id: "handoff-plan-new",
        executionId: "planner-1",
        kind: "coordination_plan",
        summary: {
          outcome: "Dispatch backend before frontend after API contract review.",
        },
        payload: {
          affected_domains: ["backend", "frontend"],
          domain_tasks: [
            {
              id: "task-backend-api",
              domainId: "backend",
            },
            {
              id: "task-frontend-shell",
              domainId: "frontend",
            },
          ],
          waves: [
            {
              id: "wave-1",
              task_ids: ["task-backend-api"],
            },
            {
              id: "wave-2",
              task_ids: ["task-frontend-shell"],
            },
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
          unresolved_questions: ["Should frontend mock the API contract?"],
        },
        updatedAt: "2026-03-14T09:30:00.000Z",
      },
      {
        id: "handoff-new",
        executionId: rootExecutionId,
        kind: "routing_summary",
        summary: {
          outcome: "Route backend blocker to coordinator follow-up.",
        },
        payload: {
          next_actions: ["Escalate API schema review", "Hold promotion planning"],
        },
        updatedAt: "2026-03-14T10:00:00.000Z",
      },
    ],
  });

  assert.equal(summary.rootExecutionId, rootExecutionId);
  assert.equal(summary.familyKey, "family-alpha");
  assert.equal(summary.projectId, "spore");
  assert.equal(
    summary.objective,
    "Coordinate delivery across backend and frontend lanes.",
  );
  assert.equal(summary.coordinationMode, "delivery");
  assert.equal(summary.status, "held");
  assert.deepEqual(
    summary.leadLanes.map((lane) => lane.executionId),
    ["lead-backend", "lead-frontend"],
  );
  assert.equal(summary.integratorLane?.executionId, "integrator-1");
  assert.equal(summary.blockers.length, 2);
  assert.deepEqual(
    summary.blockers.map((blocker) => blocker.kind),
    ["escalation", "promotion"],
  );
  assert.deepEqual(summary.pendingDecisions, [
    {
      executionId: "lead-frontend",
      kind: "review",
      laneRole: "lead",
      state: "waiting_review",
    },
  ]);
  assert.equal(summary.readiness.state, "blocked");
  assert.equal(summary.readiness.readyForIntegratorPlanning, false);
  assert.equal(summary.readiness.activeLeadLaneCount, 2);
  assert.equal(summary.readiness.pendingReviewCount, 1);
  assert.equal(summary.readiness.pendingApprovalCount, 0);
  assert.equal(summary.readiness.blockerCount, 2);
  assert.equal(summary.latestRoutingSummary?.handoffId, "handoff-new");
  assert.equal(
    summary.latestRoutingSummary?.summary.outcome,
    "Route backend blocker to coordinator follow-up.",
  );
  assert.equal(summary.latestCoordinationPlan?.handoffId, "handoff-plan-new");
  assert.deepEqual(summary.latestCoordinationPlan?.payload.affected_domains, [
    "backend",
    "frontend",
  ]);
});

test("getCoordinatorFamilySummary keeps coordinator readiness waiting on active lead lanes", async () => {
  const { dbPath } = await makeTempPaths("spore-coordinator-readiness-");
  const invocationId = `coord-family-active-${Date.now()}`;
  const plan = await buildProjectCoordinationPlan({
    projectPath: "config/projects/example-project.yaml",
    domains: ["backend", "frontend"],
    invocationId,
    objective: "Track readiness while lead lanes are still executing.",
  });

  createExecution(plan.rootInvocation, dbPath);
  for (const childPlan of plan.childInvocations) {
    createExecution(childPlan, dbPath);
  }
  for (const domainId of ["backend", "frontend"]) {
    createExecution(
      await createLeadLaneExecution({
        invocationId,
        domainId,
        objective: plan.rootInvocation.objective,
      }),
      dbPath,
    );
  }

  const db = openOrchestratorDatabase(dbPath);
  try {
    for (const childPlan of plan.childInvocations) {
      const child = getExecution(db, childPlan.invocationId);
      updateExecution(db, transitionExecutionRecord(child, "running", {}));
    }
  } finally {
    db.close();
  }

  const summary = getCoordinatorFamilySummary(invocationId, dbPath);
  assert.equal(summary?.readiness.state, "waiting_for_project_leads");
  assert.equal(summary?.readiness.readyForIntegratorPlanning, false);
  assert.equal(summary?.readiness.activeLeadLaneCount, 2);
  assert.equal(summary?.readiness.pendingReviewCount, 0);
  assert.equal(summary?.readiness.pendingApprovalCount, 0);
  assert.equal(summary?.blockers.length, 0);
});

test("getCoordinatorFamilySummary surfaces durable review and approval decisions before integrator planning", async () => {
  const { dbPath } = await makeTempPaths("spore-coordinator-decisions-");
  const invocationId = `coord-family-decisions-${Date.now()}`;
  const plan = await buildProjectCoordinationPlan({
    projectPath: "config/projects/example-project.yaml",
    domains: ["backend", "frontend"],
    invocationId,
    objective: "Track readiness while governance decisions are pending.",
  });

  createExecution(plan.rootInvocation, dbPath);
  for (const childPlan of plan.childInvocations) {
    createExecution(childPlan, dbPath);
  }
  for (const domainId of ["backend", "frontend"]) {
    createExecution(
      await createLeadLaneExecution({
        invocationId,
        domainId,
        objective: plan.rootInvocation.objective,
      }),
      dbPath,
    );
  }

  const db = openOrchestratorDatabase(dbPath);
  try {
    const backend = getExecution(db, `${invocationId}-backend-lead`);
    const frontend = getExecution(db, `${invocationId}-frontend-lead`);
    updateExecution(
      db,
      transitionExecutionRecord(backend, "waiting_review", {
        reviewStatus: "pending",
      }),
    );
    updateExecution(
      db,
      transitionExecutionRecord(frontend, "waiting_approval", {
        approvalStatus: "pending",
      }),
    );
  } finally {
    db.close();
  }

  const summary = getCoordinatorFamilySummary(invocationId, dbPath);
  assert.equal(summary?.readiness.state, "waiting_approval");
  assert.equal(summary?.readiness.readyForIntegratorPlanning, false);
  assert.equal(summary?.readiness.pendingReviewCount, 1);
  assert.equal(summary?.readiness.pendingApprovalCount, 1);
  assert.deepEqual(summary?.pendingDecisions, [
    {
      executionId: `${invocationId}-backend-lead`,
      kind: "review",
      laneRole: "lead",
      state: "waiting_review",
    },
    {
      executionId: `${invocationId}-frontend-lead`,
      kind: "approval",
      laneRole: "lead",
      state: "waiting_approval",
    },
  ]);
});

test("getCoordinatorFamilySummary falls back to parent lineage when rootExecutionId metadata is stale", async () => {
  const { dbPath } = await makeTempPaths("spore-coordinator-stale-root-");
  const invocationId = `coord-family-stale-root-${Date.now()}`;
  const plan = await buildProjectCoordinationPlan({
    projectPath: "config/projects/example-project.yaml",
    domains: ["backend"],
    invocationId,
    objective: "Keep coordinator summary working when child metadata points to a stale root id.",
  });

  createExecution(plan.rootInvocation, dbPath);
  for (const childPlan of plan.childInvocations) {
    createExecution(childPlan, dbPath);
  }
  createExecution(
    await createLeadLaneExecution({
      invocationId,
      domainId: "backend",
      objective: plan.rootInvocation.objective,
    }),
    dbPath,
  );

  const db = openOrchestratorDatabase(dbPath);
  try {
    const child = getExecution(db, `${invocationId}-backend-lead`);
    updateExecution(db, {
      ...child,
      metadata: {
        ...(child.metadata ?? {}),
        rootExecutionId: "missing-root-execution",
      },
    });
  } finally {
    db.close();
  }

  const summary = getCoordinatorFamilySummary(`${invocationId}-backend-lead`, dbPath);
  assert.equal(summary?.rootExecutionId, invocationId);
  assert.equal(summary?.leadLanes.length, 1);
});

test("getCoordinatorFamilySummary keeps latest routing summary even with many newer non-routing handoffs", async () => {
  const { dbPath } = await makeTempPaths("spore-coordinator-routing-summary-");
  const invocationId = `coord-family-routing-${Date.now()}`;
  const plan = await buildProjectCoordinationPlan({
    projectPath: "config/projects/example-project.yaml",
    domains: ["backend"],
    invocationId,
    objective: "Select latest routing summary from routing-only handoff stream.",
  });

  createExecution(plan.rootInvocation, dbPath);

  const db = openOrchestratorDatabase(dbPath);
  try {
    upsertWorkflowHandoff(db, {
      id: `handoff-routing-${invocationId}`,
      executionId: invocationId,
      fromStepId: `${invocationId}:coordinator`,
      toStepId: `${invocationId}:operator`,
      sourceRole: "coordinator",
      targetRole: "operator",
      kind: "routing_summary",
      status: "available",
      summary: {
        outcome: "Coordinator routed the backend lane.",
      },
      payload: {
        next_actions: ["Wait for backend lead review"],
      },
      validation: {},
      createdAt: "2026-03-14T10:00:00.000Z",
      updatedAt: "2026-03-14T10:00:00.000Z",
    });
    for (let index = 0; index < 240; index += 1) {
      upsertWorkflowHandoff(db, {
        id: `handoff-task-${invocationId}-${index}`,
        executionId: invocationId,
        fromStepId: `${invocationId}:coordinator:${index}`,
        toStepId: `${invocationId}:lead:${index}`,
        sourceRole: "coordinator",
        targetRole: "lead",
        kind: "task_brief",
        status: "available",
        summary: {
          index,
        },
        payload: {},
        validation: {},
        createdAt: `2026-03-14T10:${String(index % 60).padStart(2, "0")}:00.000Z`,
        updatedAt: `2026-03-14T11:${String(index % 60).padStart(2, "0")}:00.000Z`,
      });
    }
  } finally {
    db.close();
  }

  const summary = getCoordinatorFamilySummary(invocationId, dbPath);
  assert.equal(
    summary?.latestRoutingSummary?.summary.outcome,
    "Coordinator routed the backend lane.",
  );
});

test("getCoordinatorFamilySummary aggregates open escalations and promotion blockers from durable family state", async () => {
  const { dbPath } = await makeTempPaths("spore-coordinator-blockers-");
  const invocationId = `coord-family-blockers-${Date.now()}`;
  const plan = await buildProjectCoordinationPlan({
    projectPath: "config/projects/example-project.yaml",
    domains: ["backend"],
    invocationId,
    objective: "Aggregate family blockers from durable execution state.",
  });

  createExecution(plan.rootInvocation, dbPath);
  for (const childPlan of plan.childInvocations) {
    createExecution(childPlan, dbPath);
  }
  createExecution(
    await createLeadLaneExecution({
      invocationId,
      domainId: "backend",
      objective: plan.rootInvocation.objective,
    }),
    dbPath,
  );

  const promotionPlan = await planFeaturePromotion({
    projectPath: "config/projects/example-project.yaml",
    objective: plan.rootInvocation.objective,
    invocationId: `${invocationId}-promotion`,
    coordinationGroupId: invocationId,
    parentExecutionId: invocationId,
    branchKey: "promotion:backend",
    metadata: {
      projectRootExecutionId: invocationId,
    },
  });
  createExecution(promotionPlan, dbPath);

  const db = openOrchestratorDatabase(dbPath);
  try {
    const lead = getExecution(db, `${invocationId}-backend-lead`);
    insertEscalation(
      db,
      createEscalationRecord({
        executionId: lead.id,
        targetRole: "coordinator",
        reason: "lead-blocked",
        payload: {
          summary: "Backend delivery is blocked on API schema approval.",
        },
      }),
    );

    const integrator = getExecution(db, `${invocationId}-promotion`);
    updateExecution(db, {
      ...integrator,
      metadata: {
        ...(integrator.metadata ?? {}),
        promotion: {
          status: "blocked",
          blockers: [
            {
              code: "merge-conflict",
              reason: "Integration branch has unresolved conflicts.",
            },
          ],
        },
      },
    });
  } finally {
    db.close();
  }

  const summary = getCoordinatorFamilySummary(invocationId, dbPath);
  assert.equal(summary?.readiness.state, "blocked");
  assert.equal(summary?.readiness.readyForIntegratorPlanning, false);
  assert.deepEqual(
    summary?.blockers.map((blocker) => blocker.kind),
    ["escalation", "promotion"],
  );
  assert.deepEqual(
    summary?.blockers.map((blocker) => blocker.code),
    ["lead-blocked", "merge-conflict"],
  );
});

test("buildCoordinatorSummary shows adopted plan metadata, current wave, queue state, and dependency readiness", () => {
  const summary = buildCoordinatorSummary({
    rootExecution: {
      id: "coord-root-queue-1",
      coordinationGroupId: "family-queue-1",
      projectId: "spore",
      objective: "Coordinate queue materialization from an adopted plan.",
      state: "held",
      metadata: {
        topologyKind: "project-root",
        projectRole: "coordinator",
        projectLaneType: "coordinator",
        coordinationMode: "delivery",
        adoptedPlan: {
          status: "adopted",
          handoffId: "plan-v2",
          version: 2,
        },
        dispatchQueue: {
          currentWaveId: "wave-2",
          tasks: [
            {
              taskId: "task-backend-api",
              domainId: "backend",
              summary: "Land the backend API contract.",
              waveId: "wave-1",
              status: "completed",
            },
            {
              taskId: "task-frontend-shell",
              domainId: "frontend",
              summary: "Build the frontend shell against the contract.",
              waveId: "wave-2",
              status: "blocked",
            },
            {
              taskId: "task-docs-rollout",
              domainId: "backend",
              summary: "Prepare rollout notes.",
              waveId: "wave-2",
              status: "dispatched",
            },
          ],
        },
      },
    },
    familyExecutions: [
      {
        id: "coord-root-queue-1",
        coordinationGroupId: "family-queue-1",
        projectId: "spore",
        objective: "Coordinate queue materialization from an adopted plan.",
        state: "held",
        metadata: {
          topologyKind: "project-root",
          projectRole: "coordinator",
          projectLaneType: "coordinator",
          coordinationMode: "delivery",
          adoptedPlan: {
            status: "adopted",
            handoffId: "plan-v2",
            version: 2,
          },
          dispatchQueue: {
            currentWaveId: "wave-2",
            tasks: [
              {
                taskId: "task-backend-api",
                domainId: "backend",
                summary: "Land the backend API contract.",
                waveId: "wave-1",
                status: "completed",
              },
              {
                taskId: "task-frontend-shell",
                domainId: "frontend",
                summary: "Build the frontend shell against the contract.",
                waveId: "wave-2",
                status: "blocked",
              },
              {
                taskId: "task-docs-rollout",
                domainId: "backend",
                summary: "Prepare rollout notes.",
                waveId: "wave-2",
                status: "dispatched",
              },
            ],
          },
        },
      },
      {
        id: "planner-queue-1",
        parentExecutionId: "coord-root-queue-1",
        coordinationGroupId: "family-queue-1",
        projectId: "spore",
        state: "completed",
        metadata: {
          topologyKind: "project-child",
          projectRole: "planner",
          projectLaneType: "planner",
          projectRootExecutionId: "coord-root-queue-1",
        },
      },
    ],
    familyHandoffs: [
      {
        id: "plan-v2",
        executionId: "planner-queue-1",
        kind: "coordination_plan",
        summary: {
          outcome: "Dispatch backend work before frontend shell tasks.",
        },
        payload: {
          version: 2,
          domain_tasks: [
            {
              id: "task-backend-api",
              domainId: "backend",
              summary: "Land the backend API contract.",
            },
            {
              id: "task-frontend-shell",
              domainId: "frontend",
              summary: "Build the frontend shell against the contract.",
            },
            {
              id: "task-docs-rollout",
              domainId: "backend",
              summary: "Prepare rollout notes.",
            },
          ],
          waves: [
            {
              id: "wave-1",
              task_ids: ["task-backend-api"],
            },
            {
              id: "wave-2",
              task_ids: ["task-frontend-shell", "task-docs-rollout"],
            },
          ],
          dependencies: [
            {
              from_task_id: "task-frontend-shell",
              to_task_id: "task-backend-api",
            },
          ],
        },
        updatedAt: "2026-03-14T12:00:00.000Z",
      },
    ],
  });

  assert.equal(summary.adoptedPlan?.handoffId, "plan-v2");
  assert.equal(summary.adoptedPlan?.version, 2);
  assert.equal(summary.currentWaveId, "wave-2");
  assert.equal(summary.plannerLane?.executionId, "planner-queue-1");
  assert.deepEqual(
    summary.dispatchQueue.tasks.map((task) => [task.taskId, task.status]),
    [
      ["task-backend-api", "completed"],
      ["task-docs-rollout", "dispatched"],
      ["task-frontend-shell", "blocked"],
    ],
  );
  assert.deepEqual(summary.dependencies, [
    {
      fromTaskId: "task-frontend-shell",
      toTaskId: "task-backend-api",
      satisfied: true,
    },
  ]);
});

test("getCoordinatorFamilySummary derives an adopted plan and pending dispatch queue before any lead lanes exist", async () => {
  const { dbPath } = await makeTempPaths("spore-coordinator-plan-adoption-");
  const invocationId = `coord-family-plan-${Date.now()}`;
  const plan = await buildProjectCoordinationPlan({
    projectPath: "config/projects/example-project.yaml",
    domains: ["backend", "frontend"],
    invocationId,
    objective: "Adopt a planner output before dispatching domain leads.",
  });

  createExecution(plan.rootInvocation, dbPath);
  createExecution(plan.childInvocations[0], dbPath);

  const db = openOrchestratorDatabase(dbPath);
  try {
    upsertWorkflowHandoff(db, {
      id: `handoff-plan-${invocationId}`,
      executionId: `${invocationId}-planner`,
      fromStepId: `${invocationId}-planner:planner`,
      toStepId: `${invocationId}:coordinator`,
      sourceRole: "planner",
      targetRole: "coordinator",
      kind: "coordination_plan",
      status: "available",
      summary: {
        outcome: "Dispatch backend planning before frontend implementation.",
      },
      payload: {
        version: 3,
        domain_tasks: [
          {
            id: "task-backend-api",
            domainId: "backend",
            summary: "Land the backend API contract.",
          },
          {
            id: "task-frontend-shell",
            domainId: "frontend",
            summary: "Build the frontend shell.",
          },
        ],
        waves: [
          {
            id: "wave-1",
            task_ids: ["task-backend-api"],
          },
          {
            id: "wave-2",
            task_ids: ["task-frontend-shell"],
          },
        ],
        dependencies: [
          {
            from_task_id: "task-frontend-shell",
            to_task_id: "task-backend-api",
          },
        ],
      },
      validation: {},
      createdAt: "2026-03-14T12:00:00.000Z",
      updatedAt: "2026-03-14T12:00:00.000Z",
    });
    const root = getExecution(db, invocationId);
    updateExecution(db, {
      ...root,
      metadata: {
        ...(root.metadata ?? {}),
        adoptedPlan: {
          status: "adopted",
          handoffId: `handoff-plan-${invocationId}`,
          version: 3,
        },
        dispatchQueue: {
          currentWaveId: "wave-1",
          tasks: [
            {
              taskId: "task-backend-api",
              domainId: "backend",
              summary: "Land the backend API contract.",
              waveId: "wave-1",
              status: "pending",
            },
            {
              taskId: "task-frontend-shell",
              domainId: "frontend",
              summary: "Build the frontend shell.",
              waveId: "wave-2",
              status: "pending",
            },
          ],
        },
      },
    });
  } finally {
    db.close();
  }

  const summary = getCoordinatorFamilySummary(invocationId, dbPath);
  assert.equal(summary?.plannerLane?.executionId, `${invocationId}-planner`);
  assert.equal(summary?.leadLanes.length, 0);
  assert.equal(summary?.adoptedPlan?.handoffId, `handoff-plan-${invocationId}`);
  assert.equal(summary?.adoptedPlan?.version, 3);
  assert.equal(summary?.currentWaveId, "wave-1");
  assert.deepEqual(
    summary?.dispatchQueue.tasks.map((task) => [task.taskId, task.status]),
    [
      ["task-backend-api", "pending"],
      ["task-frontend-shell", "pending"],
    ],
  );
});

test("buildCoordinatorSummary keeps adopted plan details stable when a newer draft exists", () => {
  const summary = buildCoordinatorSummary({
    rootExecution: {
      id: "coord-root-adopted-stable",
      coordinationGroupId: "family-adopted-stable",
      projectId: "spore",
      objective: "Keep adopted plan details stable.",
      state: "held",
      metadata: {
        topologyKind: "project-root",
        projectRole: "coordinator",
        projectLaneType: "coordinator",
        adoptedPlan: {
          status: "adopted",
          handoffId: "plan-v1",
          version: 1,
        },
        dispatchQueue: {
          currentWaveId: "wave-1",
          tasks: [
            {
              taskId: "task-backend",
              waveId: "wave-1",
              status: "completed",
            },
          ],
        },
      },
    },
    familyExecutions: [
      {
        id: "coord-root-adopted-stable",
        coordinationGroupId: "family-adopted-stable",
        projectId: "spore",
        objective: "Keep adopted plan details stable.",
        state: "held",
        metadata: {
          topologyKind: "project-root",
          projectRole: "coordinator",
          projectLaneType: "coordinator",
          adoptedPlan: {
            status: "adopted",
            handoffId: "plan-v1",
            version: 1,
          },
          dispatchQueue: {
            currentWaveId: "wave-1",
            tasks: [
              {
                taskId: "task-backend",
                waveId: "wave-1",
                status: "completed",
              },
            ],
          },
        },
      },
    ],
    familyHandoffs: [
      {
        id: "plan-v1",
        executionId: "planner-1",
        kind: "coordination_plan",
        summary: { outcome: "Adopted plan." },
        payload: {
          version: 1,
          domain_tasks: [{ id: "task-backend", domainId: "backend" }],
          waves: [{ id: "wave-1", task_ids: ["task-backend"] }],
          dependencies: [],
        },
        updatedAt: "2026-03-14T12:00:00.000Z",
      },
      {
        id: "plan-v2-draft",
        executionId: "planner-1",
        kind: "coordination_plan",
        summary: { outcome: "Newer draft plan." },
        payload: {
          version: 2,
          domain_tasks: [{ id: "task-frontend", domainId: "frontend" }],
          waves: [{ id: "wave-2", task_ids: ["task-frontend"] }],
          dependencies: [],
        },
        updatedAt: "2026-03-14T13:00:00.000Z",
      },
    ],
  });

  assert.equal(summary.adoptedPlan?.handoffId, "plan-v1");
  assert.equal(summary.adoptedPlan?.version, 1);
  assert.deepEqual(summary.adoptedPlan?.payload.domain_tasks, [
    { id: "task-backend", domainId: "backend" },
  ]);
  assert.deepEqual(summary.dispatchQueue.tasks.map((task) => task.taskId), [
    "task-backend",
  ]);
  assert.equal(summary.latestCoordinationPlan?.handoffId, "plan-v2-draft");
});

test("adoptCoordinatorPlanFromHandoff preserves queue progress for unchanged tasks", async () => {
  const { dbPath } = await makeTempPaths("spore-plan-adopt-preserve-");
  const invocationId = `coord-plan-preserve-${Date.now()}`;
  const plan = await buildProjectCoordinationPlan({
    projectPath: "config/projects/example-project.yaml",
    domains: ["backend", "frontend"],
    invocationId,
    objective: "Preserve queue progress while adopting a newer planner output.",
  });

  createExecution(plan.rootInvocation, dbPath);

  const db = openOrchestratorDatabase(dbPath);
  try {
    const root = getExecution(db, invocationId);
    updateExecution(db, {
      ...root,
      metadata: {
        ...(root.metadata ?? {}),
        adoptedPlan: {
          status: "adopted",
          handoffId: "plan-v1",
          version: 1,
        },
        dispatchQueue: {
          currentWaveId: "wave-2",
          tasks: [
            {
              taskId: "task-backend-api",
              domainId: "backend",
              summary: "Land the backend API contract.",
              waveId: "wave-1",
              status: "completed",
            },
            {
              taskId: "task-frontend-shell",
              domainId: "frontend",
              summary: "Build the frontend shell.",
              waveId: "wave-2",
              status: "dispatched",
            },
          ],
        },
      },
    });

    adoptCoordinatorPlanFromHandoff(db, invocationId, {
      id: "plan-v2",
      payload: {
        version: 2,
        domain_tasks: [
          {
            id: "task-backend-api",
            domainId: "backend",
            summary: "Land the backend API contract.",
          },
          {
            id: "task-frontend-shell",
            domainId: "frontend",
            summary: "Build the frontend shell.",
          },
          {
            id: "task-docs-rollout",
            domainId: "frontend",
            summary: "Write rollout notes.",
          },
        ],
        waves: [
          {
            id: "wave-1",
            task_ids: ["task-backend-api"],
          },
          {
            id: "wave-2",
            task_ids: ["task-frontend-shell", "task-docs-rollout"],
          },
        ],
        dependencies: [],
      },
      summary: {},
    });
  } finally {
    db.close();
  }

  const summary = getCoordinatorFamilySummary(invocationId, dbPath);
  assert.equal(summary?.adoptedPlan?.handoffId, "plan-v2");
  assert.deepEqual(
    summary?.dispatchQueue.tasks.map((task) => [task.taskId, task.status]),
    [
      ["task-backend-api", "completed"],
      ["task-docs-rollout", "pending"],
      ["task-frontend-shell", "dispatched"],
    ],
  );
});

test("adoptCoordinatorPlanFromHandoff resets preserved lane state when a task is reassigned to a different domain", async () => {
  const { dbPath } = await makeTempPaths("spore-plan-adopt-reassign-");
  const invocationId = `coord-plan-reassign-${Date.now()}`;
  const plan = await buildProjectCoordinationPlan({
    projectPath: "config/projects/example-project.yaml",
    domains: ["backend", "frontend"],
    invocationId,
    objective: "Reset queue ownership when a task moves to another domain.",
  });

  createExecution(plan.rootInvocation, dbPath);

  const db = openOrchestratorDatabase(dbPath);
  try {
    const root = getExecution(db, invocationId);
    const lead = getExecution(db, `${invocationId}-backend-lead`);
    updateExecution(db, {
      ...root,
      metadata: {
        ...(root.metadata ?? {}),
        adoptedPlan: {
          status: "adopted",
          handoffId: "plan-v1",
          version: 1,
        },
        dispatchQueue: {
          currentWaveId: "wave-1",
          tasks: [
            {
              taskId: "task-shared",
              domainId: "backend",
              summary: "Backend owns the shared task in v1.",
              waveId: "wave-1",
              status: "completed",
              executionId: `${invocationId}-backend-task-shared-lead`,
            },
          ],
        },
      },
    });

    adoptCoordinatorPlanFromHandoff(db, invocationId, {
      id: "plan-v2",
      payload: {
        version: 2,
        domain_tasks: [
          {
            id: "task-shared",
            domainId: "frontend",
            summary: "Frontend now owns the shared task.",
          },
        ],
        waves: [{ id: "wave-1", task_ids: ["task-shared"] }],
        dependencies: [],
      },
      summary: {},
    });
  } finally {
    db.close();
  }

  const summary = getCoordinatorFamilySummary(invocationId, dbPath);
  assert.deepEqual(summary?.dispatchQueue.tasks, [
    {
      taskId: "task-shared",
      domainId: "frontend",
      summary: "Frontend now owns the shared task.",
      waveId: "wave-1",
      status: "pending",
      executionId: null,
      dependencyTaskIds: [],
      blockedByTaskIds: [],
    },
  ]);
});

test("adoptCoordinatorPlanFromHandoff resolves active replan state and supersedes removed lead lanes", async () => {
  const { dbPath } = await makeTempPaths("spore-plan-adopt-resolve-");
  const invocationId = `coord-plan-resolve-${Date.now()}`;
  const plan = await buildProjectCoordinationPlan({
    projectPath: "config/projects/example-project.yaml",
    domains: ["backend", "frontend"],
    invocationId,
    objective: "Resolve replan state and retire superseded lanes.",
  });

  createExecution(plan.rootInvocation, dbPath);
  createExecution(
    await createLeadLaneExecution({
      invocationId,
      domainId: "backend",
      objective: "Old backend task.",
    }),
    dbPath,
  );

  const db = openOrchestratorDatabase(dbPath);
  try {
    const root = getExecution(db, invocationId);
    const lead = getExecution(db, `${invocationId}-backend-lead`);
    updateExecution(db, {
      ...root,
      metadata: {
        ...(root.metadata ?? {}),
        replan: {
          status: "requested",
          reason: "wrong_domain_assignment",
          latestPlanVersion: 1,
          requiresOperatorReview: true,
        },
        replanHistory: [
          {
            requestId: "replan-1",
            reason: "wrong_domain_assignment",
            requestedByExecutionId: `${invocationId}-backend-lead`,
            latestPlanVersion: 1,
            requiresOperatorReview: true,
          },
        ],
        adoptedPlan: {
          status: "adopted",
          handoffId: "plan-v1",
          version: 1,
        },
        dispatchQueue: {
          currentWaveId: "wave-1",
          tasks: [
            {
              taskId: "task-backend-api",
              domainId: "backend",
              summary: "Old backend task.",
              waveId: "wave-1",
              status: "dispatched",
              executionId: `${invocationId}-backend-lead`,
            },
          ],
        },
      },
    });
    updateExecution(db, {
      ...lead,
      metadata: {
        ...(lead.metadata ?? {}),
        dispatchTask: {
          taskId: "task-backend-api",
          domainId: "backend",
          summary: "Old backend task.",
        },
      },
    });

    adoptCoordinatorPlanFromHandoff(db, invocationId, {
      id: "plan-v2",
      payload: {
        version: 2,
        domain_tasks: [
          {
            id: "task-frontend-shell",
            domainId: "frontend",
            summary: "New frontend task.",
          },
        ],
        waves: [{ id: "wave-1", task_ids: ["task-frontend-shell"] }],
        dependencies: [],
      },
      summary: {},
    });
  } finally {
    db.close();
  }

  const summary = getCoordinatorFamilySummary(invocationId, dbPath);
  assert.equal(summary?.replan, null);
  assert.equal(summary?.replanHistory.length, 1);
  assert.deepEqual(summary?.leadLanes, []);
});

test("adoptCoordinatorPlanFromHandoff rejects semantically invalid plans with an explicit replan request", async () => {
  const { dbPath } = await makeTempPaths("spore-plan-invalid-adoption-");
  const invocationId = `coord-plan-invalid-${Date.now()}`;
  const plan = await buildProjectCoordinationPlan({
    projectPath: "config/projects/example-project.yaml",
    domains: ["backend"],
    invocationId,
    objective: "Reject invalid coordination plans loudly.",
  });

  createExecution(plan.rootInvocation, dbPath);

  const db = openOrchestratorDatabase(dbPath);
  try {
    adoptCoordinatorPlanFromHandoff(db, invocationId, {
      id: "plan-invalid",
      executionId: `${invocationId}-planner`,
      payload: {
        version: 2,
        domain_tasks: [
          {
            id: "task-backend-api",
            domainId: "backend",
            summary: "Land backend API.",
          },
          {
            id: "task-frontend-shell",
            domainId: "frontend",
            summary: "Frontend should not be here.",
          },
        ],
        waves: [{ id: "wave-1", task_ids: ["task-backend-api"] }],
        dependencies: [],
      },
      summary: {},
    });
  } finally {
    db.close();
  }

  const summary = getCoordinatorFamilySummary(invocationId, dbPath);
  assert.equal(summary?.adoptedPlan?.handoffId, null);
  assert.equal(summary?.replan?.reason, "invalid_coordination_plan");
  assert.equal(summary?.replanHistory.length, 1);
});

test("adoptCoordinatorPlanFromHandoff resets stale currentWaveId when the adopted plan reshapes waves", async () => {
  const { dbPath } = await makeTempPaths("spore-plan-adopt-wave-reset-");
  const invocationId = `coord-plan-wave-reset-${Date.now()}`;
  const plan = await buildProjectCoordinationPlan({
    projectPath: "config/projects/example-project.yaml",
    domains: ["backend", "frontend"],
    invocationId,
    objective: "Reset stale wave ids when a planner re-adoption changes the queue shape.",
  });

  createExecution(plan.rootInvocation, dbPath);

  const db = openOrchestratorDatabase(dbPath);
  try {
    const root = getExecution(db, invocationId);
    const lead = getExecution(db, `${invocationId}-frontend-lead`);
    updateExecution(db, {
      ...root,
      metadata: {
        ...(root.metadata ?? {}),
        adoptedPlan: {
          status: "adopted",
          handoffId: "plan-v1",
          version: 1,
        },
        dispatchQueue: {
          currentWaveId: "wave-9",
          tasks: [
            {
              taskId: "task-backend-api",
              domainId: "backend",
              summary: "Land the backend API contract.",
              waveId: "wave-9",
              status: "completed",
            },
          ],
        },
      },
    });

    adoptCoordinatorPlanFromHandoff(db, invocationId, {
      id: "plan-v2",
      payload: {
        version: 2,
        domain_tasks: [
          {
            id: "task-backend-api",
            domainId: "backend",
            summary: "Land the backend API contract.",
          },
          {
            id: "task-frontend-shell",
            domainId: "frontend",
            summary: "Build the frontend shell.",
          },
        ],
        waves: [
          { id: "wave-1", task_ids: ["task-backend-api"] },
          { id: "wave-2", task_ids: ["task-frontend-shell"] },
        ],
        dependencies: [],
      },
      summary: {},
    });
  } finally {
    db.close();
  }

  const summary = getCoordinatorFamilySummary(invocationId, dbPath);
  assert.equal(summary?.currentWaveId, "wave-1");
});

test("reconcileExecution records replan history from durable lead_progress handoffs", async () => {
  const { dbPath, sessionDbPath } = await makeTempPaths("spore-replan-history-");
  const invocationId = `coord-replan-${Date.now()}`;
  const rootPlan = await buildProjectCoordinationPlan({
    projectPath: "config/projects/example-project.yaml",
    domains: ["frontend"],
    invocationId,
    objective: "Record replanning requests from lead progress.",
  });
  const leadPlan = await createLeadLaneExecution({
    invocationId,
    domainId: "frontend",
    objective: "Build the frontend shell against the contract.",
  });

  createExecution(rootPlan.rootInvocation, dbPath);
  createExecution(leadPlan, dbPath);

  const db = openOrchestratorDatabase(dbPath);
  try {
    const root = getExecution(db, invocationId);
    const lead = getExecution(db, `${invocationId}-frontend-lead`);
    updateExecution(db, {
      ...root,
      metadata: {
        ...(root.metadata ?? {}),
        adoptedPlan: {
          status: "adopted",
          handoffId: "plan-v1",
          version: 1,
        },
        dispatchQueue: {
          currentWaveId: "wave-1",
          tasks: [
            {
              taskId: "task-frontend-shell",
              domainId: "frontend",
              summary: "Build the frontend shell against the contract.",
              waveId: "wave-1",
              status: "dispatched",
              executionId: `${invocationId}-frontend-lead`,
            },
          ],
        },
      },
    });
    updateExecution(db, {
      ...lead,
      state: "running",
    });
    upsertWorkflowHandoff(db, {
      id: `lead-progress-${invocationId}`,
      executionId: `${invocationId}-frontend-lead`,
      fromStepId: `${invocationId}-frontend-lead:lead`,
      toStepId: `${invocationId}:coordinator`,
      sourceRole: "lead",
      targetRole: "coordinator",
      kind: "lead_progress",
      status: "ready",
      summary: {
        outcome: "Frontend lane found a hidden dependency requiring replanning.",
      },
      payload: {
        task_id: "task-frontend-shell",
        active_task_id: "task-frontend-shell",
        status: "blocked",
        blocked_on_task_ids: ["task-backend-api"],
        replan_reason: "hidden_dependency",
      },
      validation: {
        valid: true,
        degraded: false,
        mode: "accept",
        issues: [],
      },
      createdAt: "2026-03-14T14:00:00.000Z",
      updatedAt: "2026-03-14T14:00:00.000Z",
      consumedAt: null,
    });
  } finally {
    db.close();
  }

  await reconcileExecution(`${invocationId}-frontend-lead`, {
    dbPath,
    sessionDbPath,
  });

  await reconcileExecution(`${invocationId}-frontend-lead`, {
    dbPath,
    sessionDbPath,
  });

  const summary = getCoordinatorFamilySummary(invocationId, dbPath);
  assert.equal(summary?.replan?.reason, "hidden_dependency");
  assert.equal(summary?.replanHistory.length, 1);
  assert.equal(summary?.replanHistory[0]?.requestedByExecutionId, `${invocationId}-frontend-lead`);
});

test("buildCoordinatorSummary projects lead task packages, upward progress, and durable replanning state", () => {
  const summary = buildCoordinatorSummary({
    rootExecution: {
      id: "coord-root-progress-1",
      coordinationGroupId: "family-progress-1",
      projectId: "spore",
      objective: "Coordinate planner-driven backend and frontend work.",
      state: "held",
      metadata: {
        topologyKind: "project-root",
        projectRole: "coordinator",
        projectLaneType: "coordinator",
        coordinationMode: "delivery",
        adoptedPlan: {
          status: "adopted",
          handoffId: "plan-v4",
          version: 4,
        },
        dispatchQueue: {
          currentWaveId: "wave-2",
          tasks: [
            {
              taskId: "task-backend-api",
              domainId: "backend",
              summary: "Land the backend API contract.",
              waveId: "wave-1",
              status: "completed",
              executionId: "lead-backend-progress-1",
            },
            {
              taskId: "task-frontend-shell",
              domainId: "frontend",
              summary: "Build the frontend shell against the contract.",
              waveId: "wave-2",
              status: "in_progress",
              executionId: "lead-frontend-progress-1",
            },
          ],
        },
        replan: {
          status: "requested",
          reason: "hidden_dependency",
          latestPlanVersion: 4,
          requiresOperatorReview: true,
        },
        replanHistory: [
          {
            requestId: "replan-1",
            reason: "wrong_domain_assignment",
            requestedByExecutionId: "lead-frontend-progress-1",
            latestPlanVersion: 3,
            requiresOperatorReview: false,
          },
          {
            requestId: "replan-2",
            reason: "hidden_dependency",
            requestedByExecutionId: "lead-frontend-progress-1",
            latestPlanVersion: 4,
            requiresOperatorReview: true,
          },
        ],
      },
    },
    familyExecutions: [
      {
        id: "coord-root-progress-1",
        coordinationGroupId: "family-progress-1",
        projectId: "spore",
        objective: "Coordinate planner-driven backend and frontend work.",
        state: "held",
        metadata: {
          topologyKind: "project-root",
          projectRole: "coordinator",
          projectLaneType: "coordinator",
          coordinationMode: "delivery",
        },
      },
      {
        id: "planner-progress-1",
        parentExecutionId: "coord-root-progress-1",
        coordinationGroupId: "family-progress-1",
        projectId: "spore",
        state: "completed",
        metadata: {
          topologyKind: "project-child",
          projectRole: "planner",
          projectLaneType: "planner",
          projectRootExecutionId: "coord-root-progress-1",
        },
      },
      {
        id: "lead-backend-progress-1",
        parentExecutionId: "coord-root-progress-1",
        coordinationGroupId: "family-progress-1",
        projectId: "spore",
        domainId: "backend",
        objective: "Land the backend API contract.",
        state: "completed",
        metadata: {
          topologyKind: "project-child",
          projectLaneType: "lead",
          projectRootExecutionId: "coord-root-progress-1",
          dispatchTask: {
            taskId: "task-backend-api",
            domainId: "backend",
            summary: "Land the backend API contract.",
            waveId: "wave-1",
            dependencyTaskIds: [],
            sharedContractRefs: [
              {
                id: "api-contract",
                summary: "Shared API contract",
              },
            ],
            recommendedWorkflow: "feature-delivery",
          },
        },
      },
      {
        id: "lead-frontend-progress-1",
        parentExecutionId: "coord-root-progress-1",
        coordinationGroupId: "family-progress-1",
        projectId: "spore",
        domainId: "frontend",
        objective: "Build the frontend shell against the contract.",
        state: "running",
        metadata: {
          topologyKind: "project-child",
          projectLaneType: "lead",
          projectRootExecutionId: "coord-root-progress-1",
          dispatchTask: {
            taskId: "task-frontend-shell",
            domainId: "frontend",
            summary: "Build the frontend shell against the contract.",
            waveId: "wave-2",
            dependencyTaskIds: ["task-backend-api"],
            sharedContractRefs: [
              {
                id: "api-contract",
                summary: "Shared API contract",
              },
            ],
            recommendedWorkflow: "feature-delivery",
          },
        },
      },
    ],
    familyHandoffs: [
      {
        id: "plan-v4",
        executionId: "planner-progress-1",
        kind: "coordination_plan",
        summary: {
          outcome: "Backend API first, then frontend shell.",
        },
        payload: {
          version: 4,
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
            {
              id: "wave-1",
              task_ids: ["task-backend-api"],
            },
            {
              id: "wave-2",
              task_ids: ["task-frontend-shell"],
            },
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
        },
        updatedAt: "2026-03-14T12:00:00.000Z",
      },
      {
        id: "lead-progress-frontend",
        executionId: "lead-frontend-progress-1",
        kind: "lead_progress",
        summary: {
          outcome: "Frontend lane is implementing the shell while blocked on a hidden dependency.",
        },
        payload: {
          task_id: "task-frontend-shell",
          active_task_id: "task-frontend-shell",
          status: "blocked",
          blocked_on_task_ids: ["task-backend-api"],
          replan_reason: "hidden_dependency",
        },
        updatedAt: "2026-03-14T12:30:00.000Z",
      },
    ],
  });

  assert.equal(summary.leadLanes[0]?.dispatchTaskId, "task-backend-api");
  assert.equal(summary.leadLanes[1]?.dispatchTaskId, "task-frontend-shell");
  assert.equal(summary.leadLanes[1]?.recommendedWorkflow, "feature-delivery");
  assert.equal(summary.leadLanes[1]?.activeTaskId, "task-frontend-shell");
  assert.deepEqual(summary.leadLanes[1]?.blockedOnTaskIds, ["task-backend-api"]);
  assert.equal(summary.dispatchQueue.tasks[1]?.executionId, "lead-frontend-progress-1");
  assert.equal(summary.dispatchQueue.tasks[1]?.status, "blocked");
  assert.equal(summary.queueStatus.blocked, 1);
  assert.equal(summary.replan?.reason, "hidden_dependency");
  assert.equal(summary.replan?.latestPlanVersion, 4);
  assert.equal(summary.replanHistory.length, 2);
});

test("buildCoordinatorSummary prefers terminal lead state over stale blocked progress", () => {
  const summary = buildCoordinatorSummary({
    rootExecution: {
      id: "coord-root-terminal-progress",
      projectId: "spore",
      objective: "Prefer terminal state over stale blocked progress.",
      state: "held",
      metadata: {
        topologyKind: "project-root",
        projectRole: "coordinator",
        projectLaneType: "coordinator",
        dispatchQueue: {
          currentWaveId: "wave-1",
          tasks: [
            {
              taskId: "task-frontend-shell",
              domainId: "frontend",
              summary: "Build the frontend shell.",
              waveId: "wave-1",
              status: "blocked",
              executionId: "lead-terminal-progress",
            },
          ],
        },
      },
    },
    familyExecutions: [
      {
        id: "coord-root-terminal-progress",
        projectId: "spore",
        objective: "Prefer terminal state over stale blocked progress.",
        state: "held",
        metadata: {
          topologyKind: "project-root",
          projectRole: "coordinator",
          projectLaneType: "coordinator",
          dispatchQueue: {
            currentWaveId: "wave-1",
            tasks: [
              {
                taskId: "task-frontend-shell",
                domainId: "frontend",
                summary: "Build the frontend shell.",
                waveId: "wave-1",
                status: "blocked",
                executionId: "lead-terminal-progress",
              },
            ],
          },
        },
      },
      {
        id: "lead-terminal-progress",
        parentExecutionId: "coord-root-terminal-progress",
        domainId: "frontend",
        state: "completed",
        metadata: {
          topologyKind: "project-child",
          projectRole: "lead",
          projectLaneType: "lead",
          dispatchTask: {
            taskId: "task-frontend-shell",
            domainId: "frontend",
            summary: "Build the frontend shell.",
          },
        },
      },
    ],
    familyHandoffs: [
      {
        id: "lead-progress-terminal",
        executionId: "lead-terminal-progress",
        kind: "lead_progress",
        summary: {
          outcome: "This lane used to be blocked.",
        },
        payload: {
          task_id: "task-frontend-shell",
          active_task_id: "task-frontend-shell",
          status: "blocked",
          blocked_on_task_ids: ["task-backend-api"],
        },
        updatedAt: "2026-03-14T15:00:00.000Z",
      },
    ],
  });

  assert.equal(summary.leadLanes[0]?.state, "completed");
  assert.deepEqual(summary.leadLanes[0]?.blockedOnTaskIds, []);
  assert.equal(summary.dispatchQueue.tasks[0]?.status, "completed");
});

test("reconcileExecution dispatches distinct lead lanes for multiple tasks in the same domain", async () => {
  const { dbPath, sessionDbPath } = await makeTempPaths("spore-same-domain-dispatch-");
  const invocationId = `coord-same-domain-${Date.now()}`;
  const rootPlan = await buildProjectCoordinationPlan({
    projectPath: "config/projects/example-project.yaml",
    domains: ["frontend"],
    invocationId,
    objective: "Dispatch two frontend tasks without execution id collisions.",
  });
  createExecution(rootPlan.rootInvocation, dbPath);

  const db = openOrchestratorDatabase(dbPath);
  try {
    const root = getExecution(db, invocationId);
    updateExecution(db, {
      ...root,
      metadata: {
        ...(root.metadata ?? {}),
        adoptedPlan: {
          status: "adopted",
          handoffId: "plan-v1",
          version: 1,
        },
        dispatchQueue: {
          currentWaveId: "wave-1",
          tasks: [
            {
              taskId: "task-frontend-shell",
              domainId: "frontend",
              summary: "Build the frontend shell.",
              waveId: "wave-1",
              status: "pending",
            },
            {
              taskId: "task-frontend-accessibility",
              domainId: "frontend",
              summary: "Audit accessibility states.",
              waveId: "wave-1",
              status: "pending",
            },
          ],
        },
      },
    });
    upsertWorkflowHandoff(db, {
      id: "plan-v1",
      executionId: `${invocationId}-planner`,
      fromStepId: `${invocationId}-planner:planner`,
      toStepId: `${invocationId}:coordinator`,
      sourceRole: "planner",
      targetRole: "coordinator",
      kind: "coordination_plan",
      status: "ready",
      summary: {
        outcome: "Dispatch two frontend tasks in the same wave.",
      },
      payload: {
        version: 1,
        domain_tasks: [
          {
            id: "task-frontend-shell",
            domainId: "frontend",
            summary: "Build the frontend shell.",
          },
          {
            id: "task-frontend-accessibility",
            domainId: "frontend",
            summary: "Audit accessibility states.",
          },
        ],
        waves: [
          {
            id: "wave-1",
            task_ids: ["task-frontend-shell", "task-frontend-accessibility"],
          },
        ],
        dependencies: [],
      },
      validation: {
        valid: true,
        degraded: false,
        mode: "accept",
        issues: [],
      },
      createdAt: "2026-03-14T15:00:00.000Z",
      updatedAt: "2026-03-14T15:00:00.000Z",
      consumedAt: null,
    });
  } finally {
    db.close();
  }

  await reconcileExecution(invocationId, { dbPath, sessionDbPath });
  const family = getCoordinatorFamilySummary(invocationId, dbPath);
  assert.equal(family?.leadLanes.length, 2);
  assert.deepEqual(
    family?.leadLanes.map((lane) => lane.executionId).sort(),
    [
      `${invocationId}-frontend-task-frontend-accessibility-lead`,
      `${invocationId}-frontend-task-frontend-shell-lead`,
    ],
  );
});
