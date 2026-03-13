import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseYaml } from "@spore/config-schema";
import { openSessionDatabase, upsertSession } from "@spore/session-manager";
import {
  createExecution,
  createWorkItem,
  getProposalReviewPackage,
  getProposalSummary,
  getExecutionDetail,
  insertProposalArtifact,
  insertWorkItemRun,
  insertWorkspaceAllocation,
  openOrchestratorDatabase,
  planWorkflowInvocation,
  recordReviewDecision,
  resumeExecution,
  reconcileExecution,
  transitionExecutionRecord,
  transitionStepRecord,
  upsertWorkflowHandoff,
  updateExecution,
  updateStep,
} from "../src/index.js";
import { buildExpectedHandoff } from "../src/execution/handoff-context.js";
import { publishWorkflowStepHandoffs } from "../src/execution/workflow-handoffs.js";
import { PROJECT_ROOT } from "../src/metadata/constants.js";

type LooseRecord = Record<string, unknown>;

async function readYamlConfig(relativePath: string): Promise<LooseRecord> {
  const raw = await fs.readFile(path.join(PROJECT_ROOT, relativePath), "utf8");
  return parseYaml(raw) as LooseRecord;
}

async function readPrompt(relativePath: string) {
  return fs.readFile(path.join(PROJECT_ROOT, relativePath), "utf8");
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => String(entry)) : [];
}

function insertProposalFixture({
  dbPath,
  item,
  runId,
  runStatus,
  sourceExecutionId,
  proposalStatus,
}: {
  dbPath: string;
  item: { id: string; kind: string; title: string; goal: string };
  runId: string;
  runStatus: string;
  sourceExecutionId: string;
  proposalStatus: string;
}) {
  const workspaceId = `workspace-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const proposalId = `proposal-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const now = new Date().toISOString();
  const db = openOrchestratorDatabase(dbPath);
  try {
    insertWorkItemRun(db, {
      id: runId,
      workItemId: item.id,
      status: runStatus,
      triggerSource: "test",
      requestedBy: "test-runner",
      result: {
        executionId: sourceExecutionId,
        status: runStatus,
      },
      metadata: {
        itemKind: item.kind,
      },
      createdAt: now,
      startedAt: now,
      endedAt: now,
    });
    insertWorkspaceAllocation(db, {
      id: workspaceId,
      projectId: "spore",
      ownerType: "work-item-run",
      ownerId: runId,
      executionId: sourceExecutionId,
      stepId: null,
      workItemId: item.id,
      workItemRunId: runId,
      proposalArtifactId: proposalId,
      worktreePath: path.join(dbPath, workspaceId),
      branchName: `spore/test/${workspaceId}`,
      baseRef: "HEAD",
      integrationBranch: null,
      mode: "git-worktree",
      safeMode: true,
      mutationScope: ["docs"],
      status: runStatus === "completed" ? "settled" : "active",
      metadata: {
        source: "test",
      },
      createdAt: now,
      updatedAt: now,
      cleanedAt: null,
    });
    insertProposalArtifact(db, {
      id: proposalId,
      workItemRunId: runId,
      workItemId: item.id,
      status: proposalStatus,
      kind: item.kind,
      summary: {
        title: `${item.title} proposal`,
        goal: item.goal,
        runStatus,
        safeMode: true,
      },
      artifacts: {
        changeSummary: item.goal,
        proposedFiles: [],
        diffSummary: {
          fileCount: 0,
          trackedFileCount: 0,
          untrackedFileCount: 0,
          addedCount: 0,
          modifiedCount: 0,
          deletedCount: 0,
          renamedCount: 0,
          conflictedCount: 0,
          insertionCount: 0,
          deletionCount: 0,
        },
        changedFilesByScope: [],
        patchArtifact: {
          path: `artifacts/proposals/${proposalId}.patch`,
          byteLength: 0,
          preview: "",
        },
        workspace: {
          id: workspaceId,
          workspaceId,
          worktreePath: path.join(dbPath, workspaceId),
          branchName: `spore/test/${workspaceId}`,
          baseRef: "HEAD",
          status: runStatus === "completed" ? "settled" : "active",
          mutationScope: ["docs"],
        },
        reviewNotes: {
          requiredReview: true,
          requiredApproval: true,
          safeMode: true,
        },
        testSummary: {
          validationStatus: "pending",
          scenarioRunIds: [],
          regressionRunIds: [],
        },
        docImpact: {
          relatedDocs: [],
          relatedScenarios: [],
          relatedRegressions: [],
        },
      },
      metadata: {
        source: "test",
        workspaceId,
      },
      createdAt: now,
      updatedAt: now,
      reviewedAt: null,
      approvedAt: null,
    });
  } finally {
    db.close();
  }
  return { proposalId };
}

test("feature delivery keeps lead governance coordination-only and builder as the only writer", async () => {
  const [workflow, lead, scout, builder, tester, reviewer] = await Promise.all([
    readYamlConfig("config/workflows/feature-delivery.yaml"),
    readYamlConfig("config/profiles/lead.yaml"),
    readYamlConfig("config/profiles/scout.yaml"),
    readYamlConfig("config/profiles/builder.yaml"),
    readYamlConfig("config/profiles/tester.yaml"),
    readYamlConfig("config/profiles/reviewer.yaml"),
  ]);

  assert.deepEqual(workflow.roleSequence, [
    "orchestrator",
    "lead",
    "scout",
    "builder",
    "tester",
    "reviewer",
  ]);
  assert.deepEqual(workflow.reviewStep, {
    required: true,
    approvalRequired: true,
  });
  assert.ok(
    Array.isArray(workflow.completionRequirements) &&
      workflow.completionRequirements.includes("lead-governance-complete"),
  );
  assert.ok(Array.isArray(lead.skills) && lead.skills.includes("governance"));

  const leadPermissions = asStringArray(lead.permissions);
  const scoutPermissions = asStringArray(scout.permissions);
  const builderPermissions = asStringArray(builder.permissions);
  const testerPermissions = asStringArray(tester.permissions);
  const reviewerPermissions = asStringArray(reviewer.permissions);

  assert.ok(!leadPermissions.includes("workspace-write"));
  assert.ok(!leadPermissions.includes("file-edit"));
  assert.ok(!scoutPermissions.includes("workspace-write"));
  assert.ok(builderPermissions.includes("workspace-write"));
  assert.ok(!testerPermissions.includes("workspace-write"));
  assert.ok(!reviewerPermissions.includes("workspace-write"));
});

test("feature delivery plans the specialist chain as lead-governed without operator approvals", async () => {
  const invocation = await planWorkflowInvocation({
    workflowPath: "config/workflows/feature-delivery.yaml",
    projectPath: "config/projects/spore.yaml",
    domainId: "frontend",
    roles: ["orchestrator", "lead", "scout", "builder", "tester", "reviewer"],
    objective: "Verify lead-governed specialist planning.",
    invocationId: `lead-governed-plan-${Date.now()}`,
  });

  const specialistRoles = ["scout", "builder", "tester", "reviewer"];
  for (const role of specialistRoles) {
    const launch = invocation.launches.find((entry) => entry.role === role);
    assert.ok(launch, `expected launch for role ${role}`);
    assert.equal(launch?.reviewRequired, true);
    assert.equal(launch?.approvalRequired, false);
    assert.equal(launch?.policy?.governance?.model, "lead-governed");
    assert.equal(launch?.policy?.governance?.governedByRole, "lead");
    assert.equal(launch?.policy?.governance?.operatorVisible, false);
    assert.equal(launch?.policy?.governance?.operatorReviewRequired, false);
    assert.equal(launch?.policy?.governance?.operatorApprovalRequired, false);
  }

  const leadLaunch = invocation.launches.find((entry) => entry.role === "lead");
  assert.ok(leadLaunch);
  assert.equal(leadLaunch?.policy?.governance?.model, "lead-governed");
  assert.equal(leadLaunch?.policy?.governance?.governedByRole, null);
  assert.equal(leadLaunch?.policy?.governance?.operatorVisible, false);
});

test("specialist handoff contracts stay role-pure and evidence-driven", async () => {
  const [lead, scout, builder, tester, reviewer] = await Promise.all([
    buildExpectedHandoff({ profilePath: "config/profiles/lead.yaml" }),
    buildExpectedHandoff({ profilePath: "config/profiles/scout.yaml" }),
    buildExpectedHandoff({ profilePath: "config/profiles/builder.yaml" }),
    buildExpectedHandoff({ profilePath: "config/profiles/tester.yaml" }),
    buildExpectedHandoff({ profilePath: "config/profiles/reviewer.yaml" }),
  ]);

  assert.deepEqual(lead?.requiredSections, [
    "summary",
    "next_role",
    "scope",
    "blockers",
    "risks",
  ]);
  assert.deepEqual(scout?.requiredSections, [
    "summary",
    "findings",
    "recommendations",
    "risks",
    "evidence",
    "scope",
    "next_role",
  ]);
  assert.deepEqual(builder?.requiredSections, [
    "summary",
    "changed_paths",
    "tests_run",
    "open_risks",
  ]);
  assert.deepEqual(tester?.requiredSections, [
    "summary",
    "verdict",
    "tests_run",
    "blockers",
    "confidence",
    "evidence",
  ]);
  assert.equal(reviewer?.enforcementMode, "blocked");
  assert.deepEqual(reviewer?.requiredSections, [
    "summary",
    "verdict",
    "rationale",
    "blockers",
    "confidence",
    "evidence",
  ]);
});

test("role overlays keep lead governance, scout planning, builder implementation, tester evidence, and reviewer gating explicit", async () => {
  const [leadPrompt, scoutPrompt, builderPrompt, testerPrompt, reviewerPrompt] =
    await Promise.all([
      readPrompt(".pi/prompts/lead.md"),
      readPrompt(".pi/prompts/scout.md"),
      readPrompt(".pi/prompts/builder.md"),
      readPrompt(".pi/prompts/tester.md"),
      readPrompt(".pi/prompts/reviewer.md"),
    ]);

  assert.match(leadPrompt, /cannot edit files|cannot write/i);
  assert.match(leadPrompt, /approve|reject|rework/i);
  assert.match(scoutPrompt, /planning only|does not implement/i);
  assert.match(scoutPrompt, /files|affected paths/i);
  assert.match(builderPrompt, /implementation only|do not plan/i);
  assert.match(builderPrompt, /changed paths/i);
  assert.match(testerPrompt, /targeted tests/i);
  assert.match(testerPrompt, /browser/i);
  assert.match(testerPrompt, /evidence/i);
  assert.match(reviewerPrompt, /quality gate/i);
  assert.match(reviewerPrompt, /correctness/i);
  assert.match(reviewerPrompt, /test evidence/i);
});

test("invalid specialist handoffs hold execution before the next specialist can launch", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-lead-governance-runtime-"),
  );
  const dbPath = path.join(tempRoot, "orchestrator.sqlite");
  const sessionDbPath = path.join(tempRoot, "sessions.sqlite");
  const transcriptPath = path.join(tempRoot, "builder.transcript.md");
  const timestamp = new Date().toISOString();

  await fs.writeFile(
    transcriptPath,
    [
      "[stub:agent-output:start]",
      "Builder completed work without a structured handoff.",
      "[stub:agent-output:end]",
      "",
    ].join("\n"),
    "utf8",
  );

  try {
    const invocation = await planWorkflowInvocation({
      workflowPath: "config/workflows/feature-delivery.yaml",
      projectPath: "config/projects/spore.yaml",
      domainId: "frontend",
      roles: ["lead", "scout", "builder", "tester", "reviewer"],
      objective: "Verify blocked internal progression for invalid builder handoffs.",
      invocationId: `lead-governed-runtime-${Date.now()}`,
    });

    createExecution(invocation, dbPath);
    const initial = getExecutionDetail(invocation.invocationId, dbPath, sessionDbPath);
    assert.ok(initial);

    const leadStep = initial?.steps.find((step) => step.role === "lead");
    const scoutStep = initial?.steps.find((step) => step.role === "scout");
    const builderStep = initial?.steps.find((step) => step.role === "builder");
    const testerStep = initial?.steps.find((step) => step.role === "tester");
    assert.ok(leadStep?.id);
    assert.ok(scoutStep?.id);
    assert.ok(builderStep?.id);
    assert.ok(testerStep?.id);

    const db = openOrchestratorDatabase(dbPath);
    try {
      updateStep(db, transitionStepRecord(leadStep, "completed", { settledAt: timestamp }));
      updateStep(db, transitionStepRecord(scoutStep, "completed", { settledAt: timestamp }));
      updateStep(
        db,
        transitionStepRecord(builderStep, "active", {
          launchedAt: timestamp,
          updatedAt: timestamp,
        }),
      );
      updateExecution(
        db,
        transitionExecutionRecord(initial?.execution, "running", {
          currentStepIndex: builderStep.sequence,
          startedAt: timestamp,
        }),
      );
    } finally {
      db.close();
    }

    const sessionDb = openSessionDatabase(sessionDbPath);
    try {
      upsertSession(sessionDb, {
        id: builderStep.sessionId,
        runId: `${invocation.invocationId}-builder`,
        agentIdentityId: "builder:builder",
        profileId: "builder",
        role: "builder",
        state: "completed",
        runtimeAdapter: "pi",
        transportMode: "rpc",
        sessionMode: "ephemeral",
        projectId: "spore",
        projectName: "SPORE",
        projectType: "orchestration-platform",
        domainId: "frontend",
        workflowId: invocation.workflow.id,
        parentSessionId: null,
        contextPath: null,
        transcriptPath,
        launcherType: "stub",
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

    const refreshedBuilder = detail.steps.find((step) => step.role === "builder");
    const refreshedTester = detail.steps.find((step) => step.role === "tester");

    assert.equal(refreshedBuilder?.state, "review_pending");
    assert.equal(refreshedBuilder?.reviewRequired, true);
    assert.equal(detail.execution.state, "held");
    assert.equal(detail.execution.holdOwner, "lead");
    assert.equal(detail.execution.holdReason, "internal-governance-pending");
    assert.equal(refreshedTester?.state, "planned");
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("operator cannot resume internally lead-governed executions", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-lead-governance-resume-block-"),
  );
  const dbPath = path.join(tempRoot, "orchestrator.sqlite");
  const sessionDbPath = path.join(tempRoot, "sessions.sqlite");

  try {
    const invocation = await planWorkflowInvocation({
      workflowPath: "config/workflows/feature-delivery.yaml",
      projectPath: "config/projects/spore.yaml",
      domainId: "frontend",
      roles: ["lead", "scout", "builder", "tester", "reviewer"],
      objective: "Verify operator cannot resume a lead-owned internal hold.",
      invocationId: `lead-governance-resume-block-${Date.now()}`,
    });

    createExecution(invocation, dbPath);
    const initial = getExecutionDetail(invocation.invocationId, dbPath, sessionDbPath);
    assert.ok(initial);

    const db = openOrchestratorDatabase(dbPath);
    try {
      updateExecution(
        db,
        transitionExecutionRecord(initial.execution, "held", {
          holdOwner: "lead",
          holdReason: "internal-governance-pending",
          holdGuidance: "Await internal governance by lead.",
        }),
      );
    } finally {
      db.close();
    }

    assert.throws(
      () =>
        resumeExecution(
          invocation.invocationId,
          {
            decidedBy: "operator",
          },
          dbPath,
          sessionDbPath,
        ),
      /governed internally by lead/i,
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("invalid specialist handoffs stop proposal governance before operator review", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-lead-governance-proposal-"),
  );
  const dbPath = path.join(tempRoot, "orchestrator.sqlite");

  try {
    const item = createWorkItem(
      {
        title: "Invalid builder handoff proposal",
        kind: "workflow",
        goal: "Keep invalid specialist handoffs out of proposal review.",
      },
      dbPath,
    );
    const invocation = await planWorkflowInvocation({
      workflowPath: "config/workflows/feature-delivery.yaml",
      projectPath: "config/projects/spore.yaml",
      domainId: "frontend",
      roles: ["orchestrator", "lead", "scout", "builder", "tester", "reviewer"],
      objective: item.goal,
      invocationId: `lead-governance-${Date.now()}`,
    });
    const created = createExecution(invocation, dbPath);
    const builderStep = created.steps.find((step) => step.role === "builder");
    const testerStep = created.steps.find((step) => step.role === "tester");
    assert.ok(builderStep?.id);
    assert.ok(testerStep?.id);

    const db = openOrchestratorDatabase(dbPath);
    try {
      upsertWorkflowHandoff(db, {
        id: "invalid-builder-handoff",
        executionId: created.execution.id,
        fromStepId: builderStep.id,
        toStepId: testerStep.id,
        sourceRole: "builder",
        targetRole: "tester",
        kind: "implementation_summary",
        status: "ready",
        summary: {
          title: "Builder implementation summary",
          objective: item.goal,
          outcome: "missing changed paths and test evidence",
          confidence: "low",
        },
        validation: {
          valid: false,
          degraded: true,
          issues: [
            {
              code: "missing_required_section",
              section: "changed_paths",
              message:
                "The structured handoff is missing the required section 'changed_paths'.",
            },
          ],
          mode: "blocked",
        },
        artifacts: {
          sessionId: builderStep.sessionId,
          transcriptPath: `tmp/sessions/${builderStep.sessionId}.transcript.md`,
          briefPath: `tmp/orchestrator/${created.execution.id}/${builderStep.sessionId}.brief.md`,
          handoffPath: `tmp/sessions/${builderStep.sessionId}.handoff.json`,
          workspaceId: `workspace-${builderStep.id}`,
          proposalArtifactId: null,
          snapshotRef: null,
          snapshotCommit: null,
        },
        payload: {
          summary: "bad builder payload",
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        consumedAt: null,
      });
    } finally {
      db.close();
    }

    const runId = `work-item-run-${Date.now()}`;
    const { proposalId } = insertProposalFixture({
      dbPath,
      item,
      runId,
      runStatus: "waiting_review",
      sourceExecutionId: created.execution.id,
      proposalStatus: "ready_for_review",
    });

    const proposalSummary = getProposalSummary(proposalId, dbPath);
    assert.ok(proposalSummary);
    assert.equal(proposalSummary.status, "rework_required");
    assert.equal(proposalSummary.links.review ?? null, null);

    const reviewPackage = getProposalReviewPackage(proposalId, dbPath);
    assert.ok(reviewPackage);
    assert.equal(reviewPackage.governance.ready, false);
    assert.ok(
      reviewPackage.governance.blockers.some(
        (blocker) => blocker.code === "invalid_workflow_handoff",
      ),
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("valid specialist handoffs still wait for explicit lead approval before the next specialist launches", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-lead-governance-valid-runtime-"),
  );
  const dbPath = path.join(tempRoot, "orchestrator.sqlite");
  const sessionDbPath = path.join(tempRoot, "sessions.sqlite");
  const transcriptPath = path.join(tempRoot, "scout.transcript.md");
  const timestamp = new Date().toISOString();

  await fs.writeFile(
    transcriptPath,
    [
      "[stub:agent-output:start]",
      "[SPORE_HANDOFF_JSON_BEGIN]",
      JSON.stringify(
        {
          summary: {
            title: "Scout findings",
            objective: "Verify valid scout handoff behavior.",
            outcome: "Builder should wait for lead approval.",
            confidence: "high",
          },
          findings: ["use the sidebar header area"],
          recommendations: ["builder adds a dedicated toggle"],
          risks: ["visual regression"],
          evidence: ["apps/web/src/components/dashboard/PageHeader.tsx"],
          scope: "apps/web",
          next_role: "builder",
        },
        null,
        2,
      ),
      "[SPORE_HANDOFF_JSON_END]",
      "[stub:agent-output:end]",
      "",
    ].join("\n"),
    "utf8",
  );

  try {
    const invocation = await planWorkflowInvocation({
      workflowPath: "config/workflows/feature-delivery.yaml",
      projectPath: "config/projects/spore.yaml",
      domainId: "frontend",
      roles: ["lead", "scout", "builder", "tester", "reviewer"],
      objective: "Verify valid scout output still waits for lead approval.",
      invocationId: `lead-governance-valid-${Date.now()}`,
    });

    createExecution(invocation, dbPath);
    const initial = getExecutionDetail(invocation.invocationId, dbPath, sessionDbPath);
    assert.ok(initial);

    const leadStep = initial?.steps.find((step) => step.role === "lead");
    const scoutStep = initial?.steps.find((step) => step.role === "scout");
    const builderStep = initial?.steps.find((step) => step.role === "builder");
    assert.ok(leadStep?.id);
    assert.ok(scoutStep?.id);
    assert.ok(builderStep?.id);

    const db = openOrchestratorDatabase(dbPath);
    try {
      updateStep(db, transitionStepRecord(leadStep, "completed", { settledAt: timestamp }));
      updateStep(
        db,
        transitionStepRecord(scoutStep, "active", {
          launchedAt: timestamp,
          updatedAt: timestamp,
        }),
      );
      updateExecution(
        db,
        transitionExecutionRecord(initial?.execution, "running", {
          currentStepIndex: scoutStep.sequence,
          startedAt: timestamp,
        }),
      );

      const published = await publishWorkflowStepHandoffs({
        db,
        execution: initial?.execution,
        step: transitionStepRecord(scoutStep, "completed", {
          settledAt: timestamp,
          updatedAt: timestamp,
        }),
        session: {
          id: scoutStep.sessionId,
          transcriptPath,
        },
        steps: initial?.steps,
      });
      assert.equal(published.length >= 1, true);
    } finally {
      db.close();
    }

    const sessionDb = openSessionDatabase(sessionDbPath);
    try {
      upsertSession(sessionDb, {
        id: scoutStep.sessionId,
        runId: `${invocation.invocationId}-scout`,
        agentIdentityId: "scout:scout",
        profileId: "scout",
        role: "scout",
        state: "completed",
        runtimeAdapter: "pi",
        transportMode: "rpc",
        sessionMode: "ephemeral",
        projectId: "spore",
        projectName: "SPORE",
        projectType: "orchestration-platform",
        domainId: "frontend",
        workflowId: invocation.workflow.id,
        parentSessionId: null,
        contextPath: null,
        transcriptPath,
        launcherType: "stub",
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

    const refreshedScout = detail.steps.find((step) => step.role === "scout");
    const refreshedBuilder = detail.steps.find((step) => step.role === "builder");

    assert.equal(refreshedScout?.state, "review_pending");
    assert.equal(detail.execution.state, "held");
    assert.equal(detail.execution.holdOwner, "lead");
    assert.equal(detail.execution.holdReason, "internal-governance-pending");
    assert.equal(refreshedBuilder?.state, "planned");
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("lead approval clears internal-governance hold metadata before execution resumes", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-lead-governance-resume-"),
  );
  const dbPath = path.join(tempRoot, "orchestrator.sqlite");
  const sessionDbPath = path.join(tempRoot, "sessions.sqlite");
  const timestamp = new Date().toISOString();

  try {
    const invocation = await planWorkflowInvocation({
      workflowPath: "config/workflows/feature-delivery.yaml",
      projectPath: "config/projects/spore.yaml",
      domainId: "frontend",
      roles: ["lead", "scout", "builder", "tester", "reviewer"],
      objective: "Verify lead approval clears the internal hold.",
      invocationId: `lead-governance-resume-${Date.now()}`,
    });

    createExecution(invocation, dbPath);
    const initial = getExecutionDetail(invocation.invocationId, dbPath, sessionDbPath);
    assert.ok(initial);

    const builderStep = initial?.steps.find((step) => step.role === "builder");
    assert.ok(builderStep?.id);

    const db = openOrchestratorDatabase(dbPath);
    try {
      updateStep(
        db,
        transitionStepRecord(builderStep, "review_pending", {
          reviewStatus: "pending",
          approvalStatus: null,
          updatedAt: timestamp,
        }),
      );
      updateExecution(
        db,
        transitionExecutionRecord(initial?.execution, "held", {
          holdOwner: "lead",
          holdReason: "internal-governance-pending",
          holdGuidance: "Await internal governance by lead.",
        }),
      );
    } finally {
      db.close();
    }

    const reviewed = await recordReviewDecision(
      invocation.invocationId,
      {
        status: "approved",
        decidedBy: "lead",
        comments: "Lead approves the builder output.",
      },
      dbPath,
      sessionDbPath,
    );

    const refreshedBuilder = reviewed.steps.find((step) => step.role === "builder");
    assert.equal(reviewed.execution.state, "running");
    assert.equal(reviewed.execution.holdOwner, null);
    assert.equal(reviewed.execution.holdReason, null);
    assert.equal(refreshedBuilder?.reviewStatus, "approved");
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("operator cannot approve internally lead-governed specialist holds", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-lead-governance-review-"),
  );
  const dbPath = path.join(tempRoot, "orchestrator.sqlite");
  const sessionDbPath = path.join(tempRoot, "sessions.sqlite");
  const timestamp = new Date().toISOString();

  try {
    const invocation = await planWorkflowInvocation({
      workflowPath: "config/workflows/feature-delivery.yaml",
      projectPath: "config/projects/spore.yaml",
      domainId: "frontend",
      roles: ["lead", "scout", "builder", "tester", "reviewer"],
      objective: "Verify operator cannot resolve lead-owned internal governance.",
      invocationId: `lead-governance-review-${Date.now()}`,
    });

    createExecution(invocation, dbPath);
    const initial = getExecutionDetail(invocation.invocationId, dbPath, sessionDbPath);
    assert.ok(initial);

    const builderStep = initial?.steps.find((step) => step.role === "builder");
    const testerStep = initial?.steps.find((step) => step.role === "tester");
    assert.ok(builderStep?.id);
    assert.ok(testerStep?.id);

    const db = openOrchestratorDatabase(dbPath);
    try {
      updateStep(
        db,
        transitionStepRecord(builderStep, "review_pending", {
          reviewStatus: "pending",
          approvalStatus: null,
          updatedAt: timestamp,
        }),
      );
      updateExecution(
        db,
        transitionExecutionRecord(initial?.execution, "held", {
          holdOwner: "lead",
          holdReason: "internal-governance-pending",
          holdGuidance: "Await internal governance by lead.",
        }),
      );
    } finally {
      db.close();
    }

    await assert.rejects(
      () =>
        recordReviewDecision(
          invocation.invocationId,
          {
            status: "approved",
            decidedBy: "operator",
            comments: "operator should not approve internal specialist holds",
          },
          dbPath,
          sessionDbPath,
        ),
      /governed internally by lead/i,
    );

    const detail = getExecutionDetail(invocation.invocationId, dbPath, sessionDbPath);
    assert.equal(detail.execution.state, "held");
    assert.equal(detail.execution.holdOwner, "lead");
    assert.equal(
      detail.steps.find((step) => step.role === "builder")?.state,
      "review_pending",
    );
    assert.equal(
      detail.steps.find((step) => step.role === "tester")?.state,
      "planned",
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
