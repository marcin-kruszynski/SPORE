import assert from "node:assert/strict";
import test from "node:test";

import {
  decorateExecution,
  getExecutionAdoptedPlan,
  getExecutionCoordinationMode,
  getExecutionCurrentWaveId,
  getExecutionDispatchTask,
  getExecutionDispatchQueue,
  getExecutionDispatchQueueStatus,
  getExecutionFamilyKey,
  getExecutionLatestReplan,
  getExecutionReplanHistory,
  getExecutionRootExecutionId,
} from "../src/execution/execution-metadata.js";

test("coordinator family metadata uses rootExecutionId as the canonical identifier and familyKey as optional grouping metadata", () => {
  const root = {
    id: "coord-root-42",
    coordinationGroupId: "family-42",
    metadata: {
      topologyKind: "project-root",
      projectRole: "coordinator",
      familyKey: "family-42",
      coordinationMode: "delivery",
    },
  };
  const lead = {
    id: "lead-backend-42",
    parentExecutionId: root.id,
    coordinationGroupId: root.coordinationGroupId,
    metadata: {
      topologyKind: "project-child",
      projectRootExecutionId: root.id,
      projectLaneType: "lead",
    },
  };

  assert.equal(getExecutionRootExecutionId(root), root.id);
  assert.equal(getExecutionRootExecutionId(lead), root.id);
  assert.equal(getExecutionFamilyKey(root), "family-42");
  assert.equal(getExecutionFamilyKey(lead), "family-42");
  assert.equal(getExecutionCoordinationMode(root), "delivery");
});

test("decorateExecution surfaces canonical family identity alongside legacy topology metadata", () => {
  const decorated = decorateExecution({
    id: "coord-root-99",
    coordinationGroupId: "family-99",
    metadata: {
      topologyKind: "project-root",
      projectRole: "coordinator",
      projectLaneType: "coordinator",
      familyKey: "family-99",
      coordinationMode: "project-breakdown",
    },
  });

  assert.equal(decorated?.topology.projectRootExecutionId, "coord-root-99");
  assert.equal(decorated?.topology.rootExecutionId, "coord-root-99");
  assert.equal(decorated?.topology.familyKey, "family-99");
  assert.equal(decorated?.topology.coordinationMode, "project-breakdown");
});

test("execution metadata normalizes adopted plan details, current wave, and queue status projection", () => {
  const execution = {
    id: "coord-root-queue-99",
    coordinationGroupId: "family-queue-99",
    metadata: {
      topologyKind: "project-root",
      projectRole: "coordinator",
      projectLaneType: "coordinator",
      coordinationMode: "delivery",
      adoptedPlan: {
        status: "adopted",
        handoffId: "plan-v3",
        version: 3,
      },
      dispatchQueue: {
        currentWaveId: "wave-2",
        tasks: [
          {
            taskId: "task-backend-api",
            status: "completed",
            waveId: "wave-1",
            dependencyTaskIds: [],
            sharedContractRefs: [],
            recommendedWorkflow: "feature-delivery",
          },
          {
            taskId: "task-frontend-shell",
            status: "blocked",
            waveId: "wave-2",
            dependencyTaskIds: ["task-backend-api"],
            sharedContractRefs: [{ id: "api-contract", summary: "Shared API contract" }],
            recommendedWorkflow: "frontend-ui-pass",
          },
          {
            taskId: "task-docs-rollout",
            status: "dispatched",
            waveId: "wave-2",
            dependencyTaskIds: [],
            sharedContractRefs: [],
            recommendedWorkflow: "documentation-pass",
          },
        ],
      },
    },
  };

  assert.deepEqual(getExecutionAdoptedPlan(execution), {
    status: "adopted",
    handoffId: "plan-v3",
    version: 3,
  });
  assert.equal(getExecutionCurrentWaveId(execution), "wave-2");
  assert.deepEqual(
    getExecutionDispatchQueue(execution)?.tasks.map((task) => task.status),
    ["completed", "blocked", "dispatched"],
  );
  assert.deepEqual(getExecutionDispatchQueue(execution)?.tasks[1], {
    taskId: "task-frontend-shell",
    domainId: null,
    summary: null,
    waveId: "wave-2",
    status: "blocked",
    executionId: null,
    dependencyTaskIds: ["task-backend-api"],
    sharedContractRefs: [
      {
        id: "api-contract",
        summary: "Shared API contract",
      },
    ],
    recommendedWorkflow: "frontend-ui-pass",
  });
  assert.deepEqual(getExecutionDispatchQueueStatus(execution), {
    pending: 0,
    dispatched: 1,
    in_progress: 0,
    blocked: 1,
    completed: 1,
    failed: 0,
  });

  const decorated = decorateExecution(execution);
  assert.equal(decorated?.coordination?.adoptedPlan?.handoffId, "plan-v3");
  assert.equal(decorated?.coordination?.currentWaveId, "wave-2");
  assert.equal(decorated?.coordination?.queueStatus.blocked, 1);
});

test("execution metadata normalizes lead dispatch packages and durable replan history", () => {
  const execution = {
    id: "lead-backend-queue-99",
    parentExecutionId: "coord-root-queue-99",
    coordinationGroupId: "family-queue-99",
    metadata: {
      topologyKind: "project-child",
      projectLaneType: "lead",
      projectRootExecutionId: "coord-root-queue-99",
      coordinationMode: "delivery",
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
      replan: {
        status: "requested",
        reason: "hidden_dependency",
        latestPlanVersion: 4,
        requiresOperatorReview: true,
      },
      replanHistory: [
        {
          requestId: "replan-1",
          reason: "hidden_dependency",
          requestedByExecutionId: "lead-backend-queue-99",
          latestPlanVersion: 4,
          requiresOperatorReview: true,
        },
      ],
    },
  };

  assert.deepEqual(getExecutionDispatchTask(execution), {
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
  });
  assert.deepEqual(getExecutionLatestReplan(execution), {
    status: "requested",
    reason: "hidden_dependency",
    latestPlanVersion: 4,
    requiresOperatorReview: true,
  });
  assert.deepEqual(getExecutionReplanHistory(execution), [
    {
      requestId: "replan-1",
      reason: "hidden_dependency",
      requestedByExecutionId: "lead-backend-queue-99",
      latestPlanVersion: 4,
      requiresOperatorReview: true,
    },
  ]);

  const decorated = decorateExecution(execution);
  assert.equal(decorated?.coordination?.dispatchTask?.taskId, "task-backend-api");
  assert.equal(decorated?.coordination?.replan?.reason, "hidden_dependency");
  assert.equal(decorated?.coordination?.replanHistory[0]?.requestId, "replan-1");
});
