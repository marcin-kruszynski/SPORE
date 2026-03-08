import test from 'node:test';
import assert from 'node:assert/strict';

import { reconcileExecution, listExecutionEscalations, listExecutionEvents, getExecutionDetail } from '../src/execution/workflow-execution.js';
import { openOrchestratorDatabase, updateExecution, updateStep } from '../src/store/execution-store.js';
import { transitionExecutionRecord, transitionStepRecord } from '../src/lifecycle/execution-lifecycle.js';
import { createFamilyScenario, makeTempPaths } from './helpers/scenario-fixtures.js';

function pastIso(msAgo) {
  return new Date(Date.now() - msAgo).toISOString();
}

test('coordination policy auto-holds parent on open child work and auto-resumes when children settle', async () => {
  const { dbPath, sessionDbPath } = await makeTempPaths('spore-family-');
  const executionId = `family-coordination-root-${Date.now()}`;
  const { branched } = await createFamilyScenario({
    rootRoles: ['builder', 'tester', 'reviewer'],
    childBranches: [
      { roles: ['builder', 'reviewer'], invocationId: `${executionId}-child-a` },
      { roles: ['tester', 'reviewer'], invocationId: `${executionId}-child-b` }
    ],
    domainId: 'backend',
    invocationId: executionId,
    objective: 'Verify family coordination policy.',
    dbPath,
    sessionDbPath
  });

  let detail = await reconcileExecution(executionId, { dbPath, sessionDbPath });
  assert.equal(detail.execution.state, 'held');
  assert.equal(detail.execution.holdReason, 'waiting_for_child_executions');

  const db = openOrchestratorDatabase(dbPath);
  try {
    const rootDetail = getExecutionDetail(executionId, dbPath, sessionDbPath);
    for (const step of rootDetail.steps) {
      updateStep(db, transitionStepRecord(step, 'completed', {
        settledAt: new Date().toISOString(),
        launchedAt: step.launchedAt ?? new Date().toISOString()
      }));
    }
    for (const child of branched.created) {
      const childDetail = getExecutionDetail(child.invocation.invocationId, dbPath, sessionDbPath);
      updateExecution(db, transitionExecutionRecord(childDetail.execution, 'completed', {
        settledAt: new Date().toISOString()
      }));
    }
  } finally {
    db.close();
  }

  detail = await reconcileExecution(executionId, { dbPath, sessionDbPath });
  const events = listExecutionEvents(executionId, dbPath);
  assert.notEqual(detail.execution.state, 'held');
  assert.ok(events.some((event) => event.type === 'workflow.execution.held'));
  assert.ok(events.some((event) => event.type === 'workflow.family.resumed'));
});

test('coordination policy opens a family timeout escalation when held family exceeds maxHeldMs', async () => {
  const { dbPath, sessionDbPath } = await makeTempPaths('spore-family-timeout-');
  const executionId = `family-timeout-root-${Date.now()}`;
  await createFamilyScenario({
    rootRoles: ['builder', 'tester', 'reviewer'],
    childBranches: [
      { roles: ['builder', 'reviewer'], invocationId: `${executionId}-child-a` }
    ],
    domainId: 'backend',
    invocationId: executionId,
    objective: 'Verify family timeout escalation.',
    dbPath,
    sessionDbPath
  });

  let detail = await reconcileExecution(executionId, { dbPath, sessionDbPath });
  assert.equal(detail.execution.state, 'held');

  const db = openOrchestratorDatabase(dbPath);
  try {
    updateExecution(db, {
      ...detail.execution,
      heldAt: pastIso(5 * 60 * 1000),
      updatedAt: pastIso(5 * 60 * 1000)
    });
  } finally {
    db.close();
  }

  detail = await reconcileExecution(executionId, { dbPath, sessionDbPath });
  const escalations = listExecutionEscalations(executionId, dbPath);
  const events = listExecutionEvents(executionId, dbPath);

  assert.equal(detail.execution.state, 'held');
  assert.ok(escalations.some((item) => item.reason === 'family-held-timeout' && item.status === 'open'));
  assert.ok(events.some((event) => event.type === 'workflow.family.stalled'));
});
