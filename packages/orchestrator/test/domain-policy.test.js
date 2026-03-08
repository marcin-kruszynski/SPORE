import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { planWorkflowInvocation } from "../src/invocation/plan-workflow-invocation.js";
import {
  applyExecutionTreeGovernance,
  createExecution,
  getExecutionDetail,
  holdExecution,
  listExecutionChildren,
  listExecutionEscalations,
  listExecutionEvents,
  recordReviewDecision,
  reconcileExecution,
  spawnExecutionBranches
} from "../src/execution/workflow-execution.js";
import { openOrchestratorDatabase, updateStep } from "../src/store/execution-store.js";
import { transitionStepRecord } from "../src/lifecycle/execution-lifecycle.js";

async function makeTempPaths() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'spore-policy-'));
  return {
    root,
    dbPath: path.join(root, 'orchestrator.sqlite'),
    sessionDbPath: path.join(root, 'sessions.sqlite')
  };
}

test('review changes_requested uses policy retry target and resets downstream steps', async () => {
  const { dbPath, sessionDbPath } = await makeTempPaths();
  const invocation = await planWorkflowInvocation({
    projectPath: 'config/projects/example-project.yaml',
    domainId: 'backend',
    roles: ['builder', 'tester', 'reviewer'],
    invocationId: 'review-retry-policy-test'
  });

  createExecution(invocation, dbPath);

  const db = openOrchestratorDatabase(dbPath);
  try {
    const detail = getExecutionDetail(invocation.invocationId, dbPath, sessionDbPath);
    const [builder, tester, reviewer] = detail.steps;

    updateStep(db, transitionStepRecord(builder, 'completed', {
      settledAt: new Date().toISOString(),
      launchedAt: new Date().toISOString()
    }));
    updateStep(db, transitionStepRecord(tester, 'completed', {
      settledAt: new Date().toISOString(),
      launchedAt: new Date().toISOString()
    }));
    updateStep(db, transitionStepRecord(reviewer, 'review_pending', {
      reviewStatus: 'pending',
      approvalStatus: 'pending'
    }));
  } finally {
    db.close();
  }

  const result = await recordReviewDecision(invocation.invocationId, {
    status: 'changes_requested',
    decidedBy: 'tester',
    comments: 'Builder and tester need another pass.'
  }, dbPath, sessionDbPath);

  assert.equal(result.execution.state, 'running');

  const builderStep = result.steps.find((step) => step.role === 'builder');
  const testerStep = result.steps.find((step) => step.role === 'tester');
  const reviewerStep = result.steps.find((step) => step.role === 'reviewer');
  const changeEvent = result.events.find((event) => event.type === 'workflow.review.changes_requested');

  assert.equal(builderStep.state, 'planned');
  assert.equal(builderStep.attemptCount, 2);
  assert.equal(testerStep.state, 'planned');
  assert.equal(testerStep.attemptCount, 2);
  assert.equal(reviewerStep.state, 'planned');
  assert.equal(changeEvent.payload.retryTargetRole, 'builder');
  assert.deepEqual(changeEvent.payload.resetStepIds, [testerStep.id]);
});

test('held executions can record owner, guidance, expiry, and emit escalation on expiry', async () => {
  const { dbPath, sessionDbPath } = await makeTempPaths();
  const invocation = await planWorkflowInvocation({
    projectPath: 'config/projects/example-project.yaml',
    domainId: 'docs',
    roles: ['lead'],
    invocationId: 'hold-expiry-policy-test'
  });

  createExecution(invocation, dbPath);
  const held = holdExecution(invocation.invocationId, {
    decidedBy: 'operator',
    owner: 'doc-steward',
    reason: 'Awaiting documentation policy clarification.',
    guidance: 'Resume after ADR-0003 draft lands.',
    timeoutMs: 5
  }, dbPath, sessionDbPath);

  assert.equal(held.execution.state, 'held');
  assert.equal(held.execution.holdOwner, 'doc-steward');
  assert.equal(held.execution.holdGuidance, 'Resume after ADR-0003 draft lands.');
  assert.ok(held.execution.holdExpiresAt);

  await new Promise((resolve) => setTimeout(resolve, 20));
  const reconciled = await reconcileExecution(invocation.invocationId, { dbPath, sessionDbPath });
  const escalations = listExecutionEscalations(invocation.invocationId, dbPath);
  const events = listExecutionEvents(invocation.invocationId, dbPath);

  assert.equal(reconciled.execution.state, 'held');
  assert.ok(escalations.some((item) => item.reason === 'hold-expired' && item.status === 'open'));
  assert.ok(events.some((item) => item.type === 'workflow.execution.hold_expired'));
});

test('frontend review changes_requested can branch rework into a child execution', async () => {
  const { dbPath, sessionDbPath } = await makeTempPaths();
  const invocation = await planWorkflowInvocation({
    projectPath: 'config/projects/example-project.yaml',
    domainId: 'frontend',
    roles: ['builder', 'tester', 'reviewer'],
    invocationId: 'branch-rework-policy-test'
  });

  createExecution(invocation, dbPath);

  const db = openOrchestratorDatabase(dbPath);
  try {
    const detail = getExecutionDetail(invocation.invocationId, dbPath, sessionDbPath);
    const [builder, tester, reviewer] = detail.steps;

    updateStep(db, transitionStepRecord(builder, 'completed', {
      settledAt: new Date().toISOString(),
      launchedAt: new Date().toISOString()
    }));
    updateStep(db, transitionStepRecord(tester, 'completed', {
      settledAt: new Date().toISOString(),
      launchedAt: new Date().toISOString()
    }));
    updateStep(db, transitionStepRecord(reviewer, 'review_pending', {
      reviewStatus: 'pending',
      approvalStatus: 'pending'
    }));
  } finally {
    db.close();
  }

  const result = await recordReviewDecision(invocation.invocationId, {
    status: 'changes_requested',
    decidedBy: 'reviewer',
    comments: 'Branch the rework path.'
  }, dbPath, sessionDbPath);

  const children = listExecutionChildren(invocation.invocationId, dbPath);
  const branchEvent = result.events.find((event) => event.type === 'workflow.review.branch_requested');
  const childPlanned = result.events.find((event) => event.type === 'workflow.execution.child_planned');

  assert.equal(result.execution.state, 'held');
  assert.equal(result.execution.holdReason, 'waiting_for_child_executions');
  assert.equal(children.length, 1);
  assert.equal(children[0].parentExecutionId, invocation.invocationId);
  assert.equal(children[0].coordinationGroupId, invocation.invocationId);
  assert.ok(branchEvent);
  assert.deepEqual(branchEvent.payload.branchRoles, ['builder', 'tester', 'reviewer']);
  assert.ok(childPlanned);
});

test('parallel workflow waves launch multiple steps inside one execution wave', async () => {
  const { dbPath, sessionDbPath } = await makeTempPaths();
  const invocation = await planWorkflowInvocation({
    workflowPath: 'config/workflows/parallel-investigation.yaml',
    projectPath: 'config/projects/example-project.yaml',
    domainId: 'backend',
    roles: ['lead', 'scout', 'builder', 'reviewer'],
    invocationId: 'parallel-wave-policy-test'
  });

  createExecution(invocation, dbPath);

  let detail = await reconcileExecution(invocation.invocationId, {
    dbPath,
    sessionDbPath,
    stub: true,
    launcher: 'stub',
    noMonitor: true
  });
  let activeSteps = detail.steps.filter((step) => step.state === 'active');
  assert.equal(activeSteps.length, 1);
  assert.equal(activeSteps[0].role, 'lead');
  assert.equal(activeSteps[0].wave, 0);

  const db = openOrchestratorDatabase(dbPath);
  try {
    updateStep(db, transitionStepRecord(activeSteps[0], 'completed', {
      settledAt: new Date().toISOString(),
      launchedAt: activeSteps[0].launchedAt ?? new Date().toISOString()
    }));
  } finally {
    db.close();
  }

  detail = await reconcileExecution(invocation.invocationId, {
    dbPath,
    sessionDbPath,
    stub: true,
    launcher: 'stub',
    noMonitor: true
  });
  activeSteps = detail.steps.filter((step) => step.state === 'active');
  const activeRoles = activeSteps.map((step) => step.role).sort();

  assert.deepEqual(activeRoles, ['builder', 'scout']);
  assert.ok(activeSteps.every((step) => step.wave === 1));
});

test('family-level governance can review and approve all pending child executions', async () => {
  const { dbPath, sessionDbPath } = await makeTempPaths();
  const rootInvocation = await planWorkflowInvocation({
    projectPath: 'config/projects/example-project.yaml',
    domainId: 'frontend',
    roles: ['builder', 'tester', 'reviewer'],
    invocationId: 'family-governance-root-test'
  });

  createExecution(rootInvocation, dbPath);
  await spawnExecutionBranches(rootInvocation.invocationId, [
    { roles: ['builder', 'reviewer'], invocationId: 'family-governance-child-a' },
    { roles: ['tester', 'reviewer'], invocationId: 'family-governance-child-b' }
  ], {}, dbPath, sessionDbPath);

  const children = listExecutionChildren(rootInvocation.invocationId, dbPath);
  const db = openOrchestratorDatabase(dbPath);
  try {
    for (const child of children) {
      const detail = getExecutionDetail(child.id, dbPath, sessionDbPath);
      const reviewer = detail.steps.find((step) => step.role === 'reviewer');
      updateStep(db, transitionStepRecord(reviewer, 'review_pending', {
        reviewStatus: 'pending',
        approvalStatus: 'pending'
      }));
    }
  } finally {
    db.close();
  }

  const reviewed = await applyExecutionTreeGovernance(rootInvocation.invocationId, 'review', {
    status: 'approved',
    decidedBy: 'operator',
    comments: 'Approve all pending child reviews.'
  }, dbPath, sessionDbPath);
  assert.deepEqual(reviewed.changedExecutionIds.sort(), children.map((child) => child.id).sort());

  const approved = await applyExecutionTreeGovernance(rootInvocation.invocationId, 'approval', {
    status: 'approved',
    decidedBy: 'operator',
    comments: 'Approve all pending child approvals.'
  }, dbPath, sessionDbPath);
  assert.deepEqual(approved.changedExecutionIds.sort(), children.map((child) => child.id).sort());
});

test('wave gate any can unlock the next wave before all prior-wave steps settle', async () => {
  const { dbPath, sessionDbPath } = await makeTempPaths();
  const invocation = await planWorkflowInvocation({
    workflowPath: 'config/workflows/parallel-any-investigation.yaml',
    projectPath: 'config/projects/example-project.yaml',
    domainId: 'backend',
    roles: ['lead', 'scout', 'builder', 'reviewer'],
    invocationId: 'parallel-any-wave-policy-test'
  });

  createExecution(invocation, dbPath);

  let detail = await reconcileExecution(invocation.invocationId, {
    dbPath,
    sessionDbPath,
    stub: true,
    launcher: 'stub',
    noMonitor: true
  });

  const db = openOrchestratorDatabase(dbPath);
  try {
    const lead = detail.steps.find((step) => step.role === 'lead');
    updateStep(db, transitionStepRecord(lead, 'completed', {
      settledAt: new Date().toISOString(),
      launchedAt: lead.launchedAt ?? new Date().toISOString()
    }));
  } finally {
    db.close();
  }

  detail = await reconcileExecution(invocation.invocationId, {
    dbPath,
    sessionDbPath,
    stub: true,
    launcher: 'stub',
    noMonitor: true
  });

  const waveOne = detail.steps.filter((step) => step.wave === 1);
  const scout = waveOne.find((step) => step.role === 'scout');
  const reviewer = detail.steps.find((step) => step.role === 'reviewer');

  const db2 = openOrchestratorDatabase(dbPath);
  try {
    updateStep(db2, transitionStepRecord(scout, 'completed', {
      settledAt: new Date().toISOString(),
      launchedAt: scout.launchedAt ?? new Date().toISOString()
    }));
  } finally {
    db2.close();
  }

  detail = await reconcileExecution(invocation.invocationId, {
    dbPath,
    sessionDbPath,
    stub: true,
    launcher: 'stub',
    noMonitor: true
  });

  const refreshedReviewer = detail.steps.find((step) => step.id === reviewer.id);
  assert.equal(refreshedReviewer.state, 'active');
});
