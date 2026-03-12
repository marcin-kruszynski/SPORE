import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  openSessionDatabase,
  upsertSession,
} from "../../session-manager/src/store/session-store.js";
import {
  applyExecutionTreeGovernance,
  createExecution,
  getExecutionDetail,
  holdExecution,
  listExecutionChildren,
  listExecutionEscalations,
  listExecutionEvents,
  reconcileExecution,
  recordReviewDecision,
  spawnExecutionBranches,
} from "../src/execution/workflow-execution.js";
import { planWorkflowInvocation } from "../src/invocation/plan-workflow-invocation.js";
import {
  transitionExecutionRecord,
  transitionStepRecord,
} from "../src/lifecycle/execution-lifecycle.js";
import {
  openOrchestratorDatabase,
  updateExecution,
  updateStep,
} from "../src/store/execution-store.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function makeTempPaths() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "spore-policy-"));
  return {
    root,
    dbPath: path.join(root, "orchestrator.sqlite"),
    sessionDbPath: path.join(root, "sessions.sqlite"),
  };
}

test("review changes_requested uses policy retry target and resets downstream steps", async () => {
  const { dbPath, sessionDbPath } = await makeTempPaths();
  const invocation = await planWorkflowInvocation({
    projectPath: "config/projects/example-project.yaml",
    domainId: "backend",
    roles: ["builder", "tester", "reviewer"],
    invocationId: "review-retry-policy-test",
  });

  createExecution(invocation, dbPath);

  const db = openOrchestratorDatabase(dbPath);
  try {
    const detail = getExecutionDetail(
      invocation.invocationId,
      dbPath,
      sessionDbPath,
    );
    const [builder, tester, reviewer] = detail.steps;

    updateStep(
      db,
      transitionStepRecord(builder, "completed", {
        settledAt: new Date().toISOString(),
        launchedAt: new Date().toISOString(),
      }),
    );
    updateStep(
      db,
      transitionStepRecord(tester, "completed", {
        settledAt: new Date().toISOString(),
        launchedAt: new Date().toISOString(),
      }),
    );
    updateStep(
      db,
      transitionStepRecord(reviewer, "review_pending", {
        reviewStatus: "pending",
        approvalStatus: "pending",
      }),
    );
  } finally {
    db.close();
  }

  const result = await recordReviewDecision(
    invocation.invocationId,
    {
      status: "changes_requested",
      decidedBy: "tester",
      comments: "Builder and tester need another pass.",
    },
    dbPath,
    sessionDbPath,
  );

  assert.equal(result.execution.state, "running");

  const builderStep = result.steps.find((step) => step.role === "builder");
  const testerStep = result.steps.find((step) => step.role === "tester");
  const reviewerStep = result.steps.find((step) => step.role === "reviewer");
  const changeEvent = result.events.find(
    (event) => event.type === "workflow.review.changes_requested",
  );

  assert.equal(builderStep.state, "planned");
  assert.equal(builderStep.attemptCount, 2);
  assert.equal(testerStep.state, "planned");
  assert.equal(testerStep.attemptCount, 2);
  assert.equal(reviewerStep.state, "planned");
  assert.equal(changeEvent.payload.retryTargetRole, "builder");
  assert.deepEqual(changeEvent.payload.resetStepIds, [testerStep.id]);
});

test("held executions can record owner, guidance, expiry, and emit escalation on expiry", async () => {
  const { dbPath, sessionDbPath } = await makeTempPaths();
  const invocation = await planWorkflowInvocation({
    projectPath: "config/projects/example-project.yaml",
    domainId: "docs",
    roles: ["lead"],
    invocationId: "hold-expiry-policy-test",
  });

  createExecution(invocation, dbPath);
  const held = holdExecution(
    invocation.invocationId,
    {
      decidedBy: "operator",
      owner: "doc-steward",
      reason: "Awaiting documentation policy clarification.",
      guidance: "Resume after ADR-0003 draft lands.",
      timeoutMs: 5,
    },
    dbPath,
    sessionDbPath,
  );

  assert.equal(held.execution.state, "held");
  assert.equal(held.execution.holdOwner, "doc-steward");
  assert.equal(
    held.execution.holdGuidance,
    "Resume after ADR-0003 draft lands.",
  );
  assert.ok(held.execution.holdExpiresAt);

  await new Promise((resolve) => setTimeout(resolve, 20));
  const reconciled = await reconcileExecution(invocation.invocationId, {
    dbPath,
    sessionDbPath,
  });
  const escalations = listExecutionEscalations(invocation.invocationId, dbPath);
  const events = listExecutionEvents(invocation.invocationId, dbPath);

  assert.equal(reconciled.execution.state, "held");
  assert.ok(
    escalations.some(
      (item) => item.reason === "hold-expired" && item.status === "open",
    ),
  );
  assert.ok(
    events.some((item) => item.type === "workflow.execution.hold_expired"),
  );
});

test("frontend review changes_requested can branch rework into a child execution", async () => {
  const { dbPath, sessionDbPath } = await makeTempPaths();
  const invocation = await planWorkflowInvocation({
    projectPath: "config/projects/example-project.yaml",
    domainId: "frontend",
    roles: ["builder", "tester", "reviewer"],
    invocationId: "branch-rework-policy-test",
  });

  createExecution(invocation, dbPath);

  const db = openOrchestratorDatabase(dbPath);
  try {
    const detail = getExecutionDetail(
      invocation.invocationId,
      dbPath,
      sessionDbPath,
    );
    const [builder, tester, reviewer] = detail.steps;

    updateStep(
      db,
      transitionStepRecord(builder, "completed", {
        settledAt: new Date().toISOString(),
        launchedAt: new Date().toISOString(),
      }),
    );
    updateStep(
      db,
      transitionStepRecord(tester, "completed", {
        settledAt: new Date().toISOString(),
        launchedAt: new Date().toISOString(),
      }),
    );
    updateStep(
      db,
      transitionStepRecord(reviewer, "review_pending", {
        reviewStatus: "pending",
        approvalStatus: "pending",
      }),
    );
  } finally {
    db.close();
  }

  const result = await recordReviewDecision(
    invocation.invocationId,
    {
      status: "changes_requested",
      decidedBy: "reviewer",
      comments: "Branch the rework path.",
    },
    dbPath,
    sessionDbPath,
  );

  const children = listExecutionChildren(invocation.invocationId, dbPath);
  const branchEvent = result.events.find(
    (event) => event.type === "workflow.review.branch_requested",
  );
  const childPlanned = result.events.find(
    (event) => event.type === "workflow.execution.child_planned",
  );

  assert.equal(result.execution.state, "held");
  assert.equal(result.execution.holdReason, "waiting_for_child_executions");
  assert.equal(children.length, 1);
  assert.equal(children[0].parentExecutionId, invocation.invocationId);
  assert.equal(children[0].coordinationGroupId, invocation.invocationId);
  assert.ok(branchEvent);
  assert.deepEqual(branchEvent.payload.branchRoles, [
    "builder",
    "tester",
    "reviewer",
  ]);
  assert.ok(childPlanned);
});

test("parallel workflow waves launch multiple steps inside one execution wave", async () => {
  const { dbPath, sessionDbPath } = await makeTempPaths();
  const invocationId = `parallel-wave-policy-test-${Date.now()}`;
  const invocation = await planWorkflowInvocation({
    workflowPath: "config/workflows/parallel-investigation.yaml",
    projectPath: "config/projects/example-project.yaml",
    domainId: "backend",
    roles: ["lead", "scout", "builder", "reviewer"],
    invocationId,
  });

  createExecution(invocation, dbPath);

  let detail = await reconcileExecution(invocation.invocationId, {
    dbPath,
    sessionDbPath,
    stub: true,
    launcher: "stub",
    noMonitor: true,
  });
  await sleep(50);
  let activeSteps = detail.steps.filter((step) => step.state === "active");
  assert.equal(activeSteps.length, 1);
  assert.equal(activeSteps[0].role, "lead");
  assert.equal(activeSteps[0].wave, 0);

  const db = openOrchestratorDatabase(dbPath);
  try {
    updateStep(
      db,
      transitionStepRecord(activeSteps[0], "completed", {
        settledAt: new Date().toISOString(),
        launchedAt: activeSteps[0].launchedAt ?? new Date().toISOString(),
      }),
    );
  } finally {
    db.close();
  }

  detail = await reconcileExecution(invocation.invocationId, {
    dbPath,
    sessionDbPath,
    stub: true,
    launcher: "stub",
    noMonitor: true,
  });
  await sleep(50);
  activeSteps = detail.steps.filter((step) => step.state === "active");
  const activeRoles = activeSteps.map((step) => step.role).sort();

  assert.deepEqual(activeRoles, ["builder", "scout"]);
  assert.ok(activeSteps.every((step) => step.wave === 1));
});

test("family-level governance can review and approve all pending child executions", async () => {
  const { dbPath, sessionDbPath } = await makeTempPaths();
  const rootInvocationId = `family-governance-root-test-${Date.now()}`;
  const rootInvocation = await planWorkflowInvocation({
    projectPath: "config/projects/example-project.yaml",
    domainId: "frontend",
    roles: ["builder", "tester", "reviewer"],
    invocationId: rootInvocationId,
  });

  createExecution(rootInvocation, dbPath);
  await spawnExecutionBranches(
    rootInvocation.invocationId,
    [
      {
        roles: ["builder", "reviewer"],
        invocationId: `${rootInvocationId}-child-a`,
      },
      {
        roles: ["tester", "reviewer"],
        invocationId: `${rootInvocationId}-child-b`,
      },
    ],
    {},
    dbPath,
    sessionDbPath,
  );

  const children = listExecutionChildren(rootInvocation.invocationId, dbPath);
  const db = openOrchestratorDatabase(dbPath);
  try {
    for (const child of children) {
      const detail = getExecutionDetail(child.id, dbPath, sessionDbPath);
      const reviewer = detail.steps.find((step) => step.role === "reviewer");
      updateStep(
        db,
        transitionStepRecord(reviewer, "review_pending", {
          reviewStatus: "pending",
          approvalStatus: "pending",
        }),
      );
    }
  } finally {
    db.close();
  }

  const reviewed = await applyExecutionTreeGovernance(
    rootInvocation.invocationId,
    "review",
    {
      status: "approved",
      decidedBy: "operator",
      comments: "Approve all pending child reviews.",
    },
    dbPath,
    sessionDbPath,
  );
  assert.deepEqual(
    reviewed.changedExecutionIds.sort(),
    children.map((child) => child.id).sort(),
  );

  const approved = await applyExecutionTreeGovernance(
    rootInvocation.invocationId,
    "approval",
    {
      status: "approved",
      decidedBy: "operator",
      comments: "Approve all pending child approvals.",
    },
    dbPath,
    sessionDbPath,
  );
  assert.deepEqual(
    approved.changedExecutionIds.sort(),
    children.map((child) => child.id).sort(),
  );
});

test("wave gate any can unlock the next wave before all prior-wave steps settle", async () => {
  const { dbPath, sessionDbPath } = await makeTempPaths();
  const invocationId = `parallel-any-wave-policy-test-${Date.now()}`;
  const invocation = await planWorkflowInvocation({
    workflowPath: "config/workflows/parallel-any-investigation.yaml",
    projectPath: "config/projects/example-project.yaml",
    domainId: "backend",
    roles: ["lead", "scout", "builder", "reviewer"],
    invocationId,
  });

  createExecution(invocation, dbPath);

  let detail = await reconcileExecution(invocation.invocationId, {
    dbPath,
    sessionDbPath,
    stub: true,
    launcher: "stub",
    noMonitor: true,
  });
  await sleep(50);

  const db = openOrchestratorDatabase(dbPath);
  try {
    const lead = detail.steps.find((step) => step.role === "lead");
    updateStep(
      db,
      transitionStepRecord(lead, "completed", {
        settledAt: new Date().toISOString(),
        launchedAt: lead.launchedAt ?? new Date().toISOString(),
      }),
    );
  } finally {
    db.close();
  }

  detail = await reconcileExecution(invocation.invocationId, {
    dbPath,
    sessionDbPath,
    stub: true,
    launcher: "stub",
    noMonitor: true,
  });
  await sleep(50);

  const waveOne = detail.steps.filter((step) => step.wave === 1);
  const scout = waveOne.find((step) => step.role === "scout");
  const reviewer = detail.steps.find((step) => step.role === "reviewer");

  const db2 = openOrchestratorDatabase(dbPath);
  try {
    updateStep(
      db2,
      transitionStepRecord(scout, "completed", {
        settledAt: new Date().toISOString(),
        launchedAt: scout.launchedAt ?? new Date().toISOString(),
      }),
    );
  } finally {
    db2.close();
  }

  detail = await reconcileExecution(invocation.invocationId, {
    dbPath,
    sessionDbPath,
    stub: true,
    launcher: "stub",
    noMonitor: true,
  });
  await sleep(50);

  const refreshedReviewer = detail.steps.find(
    (step) => step.id === reviewer.id,
  );
  assert.equal(refreshedReviewer.state, "active");
});

test("completed retry sessions can unblock held executions and launch the next wave", async () => {
  const { dbPath, sessionDbPath } = await makeTempPaths();
  const invocationId = `held-retry-reconcile-${Date.now()}`;
  const invocation = await planWorkflowInvocation({
    workflowPath: "config/workflows/frontend-ui-pass.yaml",
    projectPath: "config/projects/spore.yaml",
    domainId: "frontend",
    roles: ["lead", "scout", "builder", "tester", "reviewer"],
    invocationId,
    objective: "Recover a held execution after a successful retry session.",
  });

  createExecution(invocation, dbPath);

  const initial = getExecutionDetail(
    invocation.invocationId,
    dbPath,
    sessionDbPath,
  );
  const lead = initial.steps.find((step) => step.role === "lead");
  const scout = initial.steps.find((step) => step.role === "scout");

  assert.ok(lead);
  assert.ok(scout);

  const retriedSessionId = `${invocation.invocationId}-frontend-lead-1-r2`;
  const timestamp = new Date().toISOString();
  const db = openOrchestratorDatabase(dbPath);
  try {
    updateStep(
      db,
      transitionStepRecord(lead, "active", {
        attemptCount: 2,
        sessionId: retriedSessionId,
        launchedAt: timestamp,
        lastError: "failed",
      }),
    );
    updateStep(
      db,
      transitionStepRecord(scout, "completed", {
        launchedAt: timestamp,
        settledAt: timestamp,
      }),
    );
    updateExecution(
      db,
      transitionExecutionRecord(initial.execution, "held", {
        heldFromState: "running",
        holdReason: "wave-0-blocked",
        heldAt: timestamp,
      }),
    );
  } finally {
    db.close();
  }

  const sessionDb = openSessionDatabase(sessionDbPath);
  try {
    upsertSession(sessionDb, {
      id: retriedSessionId,
      runId: `${invocation.invocationId}-1`,
      agentIdentityId: "lead:lead",
      profileId: "lead",
      role: "lead",
      state: "completed",
      runtimeAdapter: "pi",
      transportMode: "rpc",
      sessionMode: "persistent",
      projectId: "spore",
      projectName: "SPORE",
      projectType: "application",
      domainId: "frontend",
      workflowId: "frontend-ui-pass",
      parentSessionId: null,
      contextPath: null,
      transcriptPath: "tmp/sessions/held-retry-reconcile.transcript.md",
      launcherType: "tmux",
      launchCommand: "fake",
      tmuxSession: null,
      startedAt: timestamp,
      endedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  } finally {
    sessionDb.close();
  }

  const detail = await reconcileExecution(invocation.invocationId, {
    dbPath,
    sessionDbPath,
    stub: true,
    launcher: "stub",
    noMonitor: true,
  });

  const refreshedLead = detail.steps.find((step) => step.role === "lead");
  const builder = detail.steps.find((step) => step.role === "builder");

  assert.equal(refreshedLead.state, "completed");
  assert.equal(detail.execution.state, "running");
  assert.equal(detail.execution.holdReason, null);
  assert.equal(builder.state, "active");
});

test("completed retry sessions can unblock held executions into waiting_review", async () => {
  const { dbPath, sessionDbPath } = await makeTempPaths();
  const invocationId = `held-retry-review-${Date.now()}`;
  const invocation = await planWorkflowInvocation({
    projectPath: "config/projects/example-project.yaml",
    domainId: "backend",
    roles: ["reviewer"],
    invocationId,
    objective: "Recover a held review gate after a successful retry session.",
  });

  createExecution(invocation, dbPath);

  const initial = getExecutionDetail(
    invocation.invocationId,
    dbPath,
    sessionDbPath,
  );
  const reviewer = initial.steps.find((step) => step.role === "reviewer");

  assert.ok(reviewer);

  const retriedSessionId = `${invocation.invocationId}-backend-reviewer-1-r2`;
  const timestamp = new Date().toISOString();
  const db = openOrchestratorDatabase(dbPath);
  try {
    updateStep(
      db,
      transitionStepRecord(reviewer, "active", {
        attemptCount: 2,
        sessionId: retriedSessionId,
        launchedAt: timestamp,
        lastError: "failed",
      }),
    );
    updateExecution(
      db,
      transitionExecutionRecord(initial.execution, "held", {
        heldFromState: "running",
        holdReason: "wave-0-blocked",
        heldAt: timestamp,
      }),
    );
  } finally {
    db.close();
  }

  const sessionDb = openSessionDatabase(sessionDbPath);
  try {
    upsertSession(sessionDb, {
      id: retriedSessionId,
      runId: `${invocation.invocationId}-1`,
      agentIdentityId: "reviewer:reviewer",
      profileId: "reviewer",
      role: "reviewer",
      state: "completed",
      runtimeAdapter: "pi",
      transportMode: "rpc",
      sessionMode: "persistent",
      projectId: "example-project",
      projectName: "Example Project",
      projectType: "application",
      domainId: "backend",
      workflowId: invocation.workflow.id,
      parentSessionId: null,
      contextPath: null,
      transcriptPath: "tmp/sessions/held-retry-review.transcript.md",
      launcherType: "tmux",
      launchCommand: "fake",
      tmuxSession: null,
      startedAt: timestamp,
      endedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  } finally {
    sessionDb.close();
  }

  const detail = await reconcileExecution(invocation.invocationId, {
    dbPath,
    sessionDbPath,
  });

  const refreshedReviewer = detail.steps.find(
    (step) => step.role === "reviewer",
  );

  assert.equal(refreshedReviewer.state, "review_pending");
  assert.equal(detail.execution.state, "waiting_review");
  assert.equal(detail.execution.holdReason, null);
});

test("exit artifacts can reconcile stale active sessions and unblock the next wave", async () => {
  const { root, dbPath, sessionDbPath } = await makeTempPaths();
  const invocationId = `artifact-session-reconcile-${Date.now()}`;
  const invocation = await planWorkflowInvocation({
    workflowPath: "config/workflows/frontend-ui-pass.yaml",
    projectPath: "config/projects/spore.yaml",
    domainId: "frontend",
    roles: ["lead", "scout", "builder", "tester", "reviewer"],
    invocationId,
    objective:
      "Recover a held execution from stale session state using exit artifacts.",
  });

  createExecution(invocation, dbPath);

  const initial = getExecutionDetail(
    invocation.invocationId,
    dbPath,
    sessionDbPath,
  );
  const lead = initial.steps.find((step) => step.role === "lead");
  const scout = initial.steps.find((step) => step.role === "scout");

  assert.ok(lead);
  assert.ok(scout);

  const timestamp = new Date().toISOString();
  const db = openOrchestratorDatabase(dbPath);
  try {
    updateStep(
      db,
      transitionStepRecord(lead, "completed", {
        launchedAt: timestamp,
        settledAt: timestamp,
      }),
    );
    updateStep(
      db,
      transitionStepRecord(scout, "active", {
        launchedAt: timestamp,
      }),
    );
    updateExecution(
      db,
      transitionExecutionRecord(initial.execution, "held", {
        heldFromState: "running",
        holdReason: "wave-0-blocked",
        heldAt: timestamp,
      }),
    );
  } finally {
    db.close();
  }

  const launchScriptPath = path.join(root, `${scout.sessionId}.launch.sh`);
  const exitPath = launchScriptPath.replace(/\.launch\.sh$/, ".exit.json");
  await fs.writeFile(launchScriptPath, "#!/usr/bin/env bash\n", "utf8");
  await fs.writeFile(exitPath, '{"exitCode":0}\n', "utf8");

  const sessionDb = openSessionDatabase(sessionDbPath);
  try {
    upsertSession(sessionDb, {
      id: scout.sessionId,
      runId: `${invocation.invocationId}-2`,
      agentIdentityId: "scout:scout",
      profileId: "scout",
      role: "scout",
      state: "active",
      runtimeAdapter: "pi",
      transportMode: "rpc",
      sessionMode: "ephemeral",
      projectId: "spore",
      projectName: "SPORE",
      projectType: "application",
      domainId: "frontend",
      workflowId: "frontend-ui-pass",
      parentSessionId: lead.sessionId,
      contextPath: null,
      transcriptPath: path.join(root, `${scout.sessionId}.transcript.md`),
      launcherType: "pi-rpc",
      launchCommand: launchScriptPath,
      tmuxSession: `tmux-${scout.sessionId}`,
      startedAt: timestamp,
      endedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  } finally {
    sessionDb.close();
  }

  const detail = await reconcileExecution(invocation.invocationId, {
    dbPath,
    sessionDbPath,
    stub: true,
    launcher: "stub",
    noMonitor: true,
  });

  const refreshedScout = detail.steps.find((step) => step.role === "scout");
  const builder = detail.steps.find((step) => step.role === "builder");

  assert.equal(refreshedScout.state, "completed");
  assert.equal(detail.execution.state, "running");
  assert.equal(detail.execution.holdReason, null);
  assert.equal(builder.state, "active");
});

test("final rpc-status artifacts can reconcile stale active sessions and unblock the next wave", async () => {
  const { root, dbPath, sessionDbPath } = await makeTempPaths();
  const invocationId = `artifact-rpc-status-reconcile-${Date.now()}`;
  const invocation = await planWorkflowInvocation({
    workflowPath: "config/workflows/frontend-ui-pass.yaml",
    projectPath: "config/projects/spore.yaml",
    domainId: "frontend",
    roles: ["lead", "scout", "builder", "tester", "reviewer"],
    invocationId,
    objective:
      "Recover a held execution from stale session state using rpc-status artifacts.",
  });

  createExecution(invocation, dbPath);

  const initial = getExecutionDetail(
    invocation.invocationId,
    dbPath,
    sessionDbPath,
  );
  const lead = initial.steps.find((step) => step.role === "lead");
  const scout = initial.steps.find((step) => step.role === "scout");

  assert.ok(lead);
  assert.ok(scout);

  const timestamp = new Date().toISOString();
  const db = openOrchestratorDatabase(dbPath);
  try {
    updateStep(
      db,
      transitionStepRecord(lead, "completed", {
        launchedAt: timestamp,
        settledAt: timestamp,
      }),
    );
    updateStep(
      db,
      transitionStepRecord(scout, "active", {
        launchedAt: timestamp,
      }),
    );
    updateExecution(
      db,
      transitionExecutionRecord(initial.execution, "held", {
        heldFromState: "running",
        holdReason: "wave-0-blocked",
        heldAt: timestamp,
      }),
    );
  } finally {
    db.close();
  }

  const launchScriptPath = path.join(root, `${scout.sessionId}.launch.sh`);
  const rpcStatusPath = launchScriptPath.replace(
    /\.launch\.sh$/,
    ".rpc-status.json",
  );
  await fs.writeFile(launchScriptPath, "#!/usr/bin/env bash\n", "utf8");
  await fs.writeFile(
    rpcStatusPath,
    `${JSON.stringify(
      {
        runner: "pi-rpc-runner",
        status: "completed",
        terminalSignal: {
          settled: true,
          exitCode: 0,
          finishedAt: timestamp,
          source: "runner-finalize",
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const sessionDb = openSessionDatabase(sessionDbPath);
  try {
    upsertSession(sessionDb, {
      id: scout.sessionId,
      runId: `${invocation.invocationId}-2`,
      agentIdentityId: "scout:scout",
      profileId: "scout",
      role: "scout",
      state: "active",
      runtimeAdapter: "pi",
      transportMode: "rpc",
      sessionMode: "ephemeral",
      projectId: "spore",
      projectName: "SPORE",
      projectType: "application",
      domainId: "frontend",
      workflowId: "frontend-ui-pass",
      parentSessionId: lead.sessionId,
      contextPath: null,
      transcriptPath: path.join(root, `${scout.sessionId}.transcript.md`),
      launcherType: "pi-rpc",
      launchCommand: launchScriptPath,
      tmuxSession: `tmux-${scout.sessionId}`,
      startedAt: timestamp,
      endedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  } finally {
    sessionDb.close();
  }

  const detail = await reconcileExecution(invocation.invocationId, {
    dbPath,
    sessionDbPath,
    stub: true,
    launcher: "stub",
    noMonitor: true,
  });

  const refreshedScout = detail.steps.find((step) => step.role === "scout");
  const builder = detail.steps.find((step) => step.role === "builder");

  assert.equal(refreshedScout.state, "completed");
  assert.equal(detail.execution.state, "running");
  assert.equal(detail.execution.holdReason, null);
  assert.equal(builder.state, "active");
});

test("persisted artifact recovery remains visible when session-manager settles before orchestrator reconcile", async () => {
  const { root, dbPath, sessionDbPath } = await makeTempPaths();
  const invocationId = `persisted-artifact-recovery-${Date.now()}`;
  const invocation = await planWorkflowInvocation({
    workflowPath: "config/workflows/frontend-ui-pass.yaml",
    projectPath: "config/projects/spore.yaml",
    domainId: "frontend",
    roles: ["lead", "scout", "builder", "tester", "reviewer"],
    invocationId,
    objective:
      "Keep artifact recovery visible when the session manager heals before orchestrator reconcile.",
  });

  createExecution(invocation, dbPath);

  const initial = getExecutionDetail(
    invocation.invocationId,
    dbPath,
    sessionDbPath,
  );
  const lead = initial.steps.find((step) => step.role === "lead");
  const scout = initial.steps.find((step) => step.role === "scout");

  assert.ok(lead);
  assert.ok(scout);

  const timestamp = new Date().toISOString();
  const rpcStatusPath = path.join(root, `${scout.sessionId}.rpc-status.json`);
  const db = openOrchestratorDatabase(dbPath);
  try {
    updateStep(
      db,
      transitionStepRecord(lead, "completed", {
        launchedAt: timestamp,
        settledAt: timestamp,
      }),
    );
    updateStep(
      db,
      transitionStepRecord(scout, "active", {
        launchedAt: timestamp,
      }),
    );
    updateExecution(
      db,
      transitionExecutionRecord(initial.execution, "held", {
        heldFromState: "running",
        holdReason: "wave-0-blocked",
        heldAt: timestamp,
      }),
    );
  } finally {
    db.close();
  }

  const sessionDb = openSessionDatabase(sessionDbPath);
  try {
    upsertSession(sessionDb, {
      id: scout.sessionId,
      runId: `${invocation.invocationId}-2`,
      agentIdentityId: "scout:scout",
      profileId: "scout",
      role: "scout",
      state: "completed",
      runtimeAdapter: "pi",
      transportMode: "rpc",
      sessionMode: "ephemeral",
      projectId: "spore",
      projectName: "SPORE",
      projectType: "application",
      domainId: "frontend",
      workflowId: "frontend-ui-pass",
      parentSessionId: lead.sessionId,
      contextPath: null,
      transcriptPath: path.join(root, `${scout.sessionId}.transcript.md`),
      launcherType: "pi-rpc",
      launchCommand: path.join(root, `${scout.sessionId}.launch.sh`),
      tmuxSession: `tmux-${scout.sessionId}`,
      startedAt: timestamp,
      endedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
      artifactRecovery: {
        recovered: true,
        signalSource: "rpc-status",
        terminalSignalSource: "runner-finalize",
        fallbackReason: "exit-file-missing",
        artifactPath: rpcStatusPath,
        exitCode: 0,
        nextState: "completed",
        finishedAt: timestamp,
        status: "completed",
        artifactRecoveryCount: 1,
      },
    });
  } finally {
    sessionDb.close();
  }

  const detail = await reconcileExecution(invocation.invocationId, {
    dbPath,
    sessionDbPath,
    stub: true,
    launcher: "stub",
    noMonitor: true,
  });

  const refreshedScout = detail.steps.find((step) => step.role === "scout");
  const builder = detail.steps.find((step) => step.role === "builder");

  assert.equal(refreshedScout.state, "completed");
  assert.equal(detail.execution.state, "running");
  assert.equal(detail.execution.holdReason, null);
  assert.equal(builder.state, "active");
  assert.equal(detail.artifactRecovery.count, 1);
  assert.equal(detail.artifactRecovery.events[0].signalSource, "rpc-status");
  assert.equal(
    detail.artifactRecovery.events[0].fallbackReason,
    "exit-file-missing",
  );
});
