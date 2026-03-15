import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createExecution } from "../src/execution/workflow-execution.js";
import { planWorkflowInvocation } from "../src/invocation/plan-workflow-invocation.js";
import {
  getExecution,
  listSteps,
  openOrchestratorDatabase,
} from "../src/store/execution-store.js";

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function buildExpectedDocsQuery({
  role,
  domainId,
  workflow,
  project,
  queryTerms,
}) {
  return unique([
    role,
    domainId,
    workflow.id,
    workflow.name,
    project.type,
    ...asArray(queryTerms),
  ]).join(" ");
}

test("backend domain policy propagates from planner into execution store records", async (t) => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-orchestrator-policy-"),
  );
  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const invocation = await planWorkflowInvocation({
    workflowPath: "config/workflows/backend-service-delivery.yaml",
    projectPath: "config/projects/example-project.yaml",
    domainId: "backend",
    roles: ["builder", "reviewer"],
    invocationId: "test-domain-policy-propagation",
    objective: "Verify policy propagation",
  });
  const workflow = invocation.workflow;
  const project = invocation.project;

  assert.equal(
    invocation.effectivePolicy.workflowPolicy.stepSoftTimeoutMs,
    30000,
  );
  assert.equal(
    invocation.effectivePolicy.workflowPolicy.stepHardTimeoutMs,
    120000,
  );
  assert.equal(invocation.effectivePolicy.workflowPolicy.defaultMaxAttempts, 3);
  assert.equal(
    invocation.effectivePolicy.workflowPolicy.retryTargetRole,
    "builder",
  );
  assert.equal(
    invocation.effectivePolicy.workflowPolicy.resetDescendantSteps,
    true,
  );
  assert.deepEqual(invocation.effectivePolicy.workflowPolicy.defaultRoles, [
    "lead",
    "builder",
    "tester",
    "reviewer",
  ]);
  assert.deepEqual(invocation.effectivePolicy.policyPackIds, [
    "service-core",
    "platform-backend",
  ]);
  assert.equal(
    invocation.effectivePolicy.runtimePolicy.sessionModeByRole.builder,
    "ephemeral",
  );
  assert.equal(
    invocation.effectivePolicy.runtimePolicy.sessionModeByRole.reviewer,
    "persistent",
  );
  assert.equal(invocation.effectivePolicy.docsKbPolicy.resultLimit, 7);
  assert.deepEqual(
    invocation.metadata.policyPacks.map((pack) => pack.id),
    ["service-core", "platform-backend"],
  );

  const launchesByRole = new Map(
    invocation.launches.map((launch) => [launch.role, launch]),
  );
  const builderLaunch = launchesByRole.get("builder");
  const reviewerLaunch = launchesByRole.get("reviewer");

  assert.ok(builderLaunch);
  assert.ok(reviewerLaunch);

  assert.equal(builderLaunch.maxAttempts, 5);
  assert.equal(builderLaunch.sessionMode, "ephemeral");
  assert.deepEqual(builderLaunch.policy, {
    workflowPolicy: {
      stepSoftTimeoutMs: 30000,
      stepHardTimeoutMs: 120000,
      maxAttempts: 5,
      waveGate: {
        mode: "all",
      },
      wavePolicy: {
        maxActiveMs: 90000,
        onTimeout: "open_escalation",
        onFailure: "open_escalation",
        blockNextWaveOnOpenEscalation: true,
      },
    },
    runtimePolicy: {
      providerFamily: "pi",
      backendKind: "pi_rpc",
      sessionMode: "ephemeral",
      workspace: {
        enabled: true,
        enabledRoles: ["builder", "tester"],
      },
    },
    docsKbPolicy: {
      resultLimit: 7,
      query: buildExpectedDocsQuery({
        role: "builder",
        domainId: invocation.domain.id,
        workflow,
        project,
        queryTerms: invocation.effectivePolicy.docsKbPolicy.queryTerms,
      }),
      queryTerms: unique([
        "builder",
        invocation.domain.id,
        workflow.id,
        ...invocation.effectivePolicy.docsKbPolicy.queryTerms,
      ]),
    },
    governance: {
      model: "default",
      governedByRole: null,
      operatorVisible: true,
      reviewRequired: true,
      approvalRequired: true,
      operatorReviewRequired: true,
      operatorApprovalRequired: true,
    },
  });

  assert.equal(reviewerLaunch.maxAttempts, 3);
  assert.equal(reviewerLaunch.sessionMode, "persistent");
  assert.equal(reviewerLaunch.reviewRequired, true);
  assert.equal(reviewerLaunch.approvalRequired, true);
  assert.equal(reviewerLaunch.policy.workflowPolicy.maxAttempts, 3);
  assert.equal(
    reviewerLaunch.policy.docsKbPolicy.query,
    buildExpectedDocsQuery({
      role: "reviewer",
      domainId: invocation.domain.id,
      workflow,
      project,
      queryTerms: invocation.effectivePolicy.docsKbPolicy.queryTerms,
    }),
  );

  const dbPath = path.join(tempRoot, "orchestrator.sqlite");
  createExecution(invocation, dbPath);

  const db = openOrchestratorDatabase(dbPath);
  try {
    const execution = getExecution(db, invocation.invocationId);
    const steps = listSteps(db, invocation.invocationId);
    const stepsByRole = new Map<string, Record<string, unknown>>(
      steps.map((step) => [step.role, step as Record<string, unknown>]),
    );

    assert.ok(execution);
    assert.deepEqual(execution.policy, invocation.effectivePolicy);

    assert.equal(steps.length, invocation.launches.length);
    assert.deepEqual(stepsByRole.get("builder")?.policy, builderLaunch.policy);
    assert.equal(
      stepsByRole.get("builder")?.sessionMode,
      builderLaunch.sessionMode,
    );
    assert.deepEqual(
      stepsByRole.get("reviewer")?.policy,
      reviewerLaunch.policy,
    );
    assert.equal(
      stepsByRole.get("reviewer")?.sessionMode,
      reviewerLaunch.sessionMode,
    );
  } finally {
    db.close();
  }
});
