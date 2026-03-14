import assert from "node:assert/strict";
import test from "node:test";

import { buildCoordinatorSummary } from "../src/execution/coordination-summary.js";
import {
  createExecution,
  getCoordinatorFamilySummary,
} from "../src/execution/workflow-execution.js";
import { planFeaturePromotion } from "../src/invocation/plan-workflow-invocation.js";
import { buildProjectCoordinationPlan } from "../src/execution/workflow-execution.js";
import { createEscalationRecord, transitionExecutionRecord } from "../src/lifecycle/execution-lifecycle.js";
import {
  getExecution,
  insertEscalation,
  openOrchestratorDatabase,
  upsertWorkflowHandoff,
  updateExecution,
} from "../src/store/execution-store.js";
import { makeTempPaths } from "./helpers/scenario-fixtures.js";

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
