import assert from "node:assert/strict";
import type { SpawnOptionsWithoutStdio } from "node:child_process";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  approveProposalArtifact,
  createWorkItem,
  getProposalByRun,
  getProposalReviewPackage,
  getProposalSummary,
  getSelfBuildWorkItemRun,
  insertProposalArtifact,
  insertWorkItemRun,
  insertWorkspaceAllocation,
  openOrchestratorDatabase,
  reviewProposalArtifact,
  runSelfBuildWorkItem,
} from "../src/index.js";

function run(
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio = {},
) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(stderr || stdout || `${command} failed with code ${code}`),
      );
    });
  });
}

async function makeTempRepo() {
  const repoRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-proposal-lifecycle-"),
  );
  await run("git", ["init", "-b", "main"], { cwd: repoRoot });
  await run("git", ["config", "user.name", "SPORE Test"], { cwd: repoRoot });
  await run("git", ["config", "user.email", "spore-test@example.com"], {
    cwd: repoRoot,
  });
  await fs.writeFile(path.join(repoRoot, "README.md"), "# temp repo\n", "utf8");
  await fs.mkdir(path.join(repoRoot, "docs"), { recursive: true });
  await fs.writeFile(
    path.join(repoRoot, "docs", "guide.md"),
    "# guide\n",
    "utf8",
  );
  await run("git", ["add", "README.md", "docs/guide.md"], { cwd: repoRoot });
  await run("git", ["commit", "-m", "init"], { cwd: repoRoot });
  return repoRoot;
}

function insertProposalFixture({
  dbPath,
  item,
  runId,
  runStatus,
  sourceExecutionId,
  proposalStatus,
  runResult,
  promotion,
}: {
  dbPath: string;
  item: { id: string; kind: string; title: string; goal: string };
  runId: string;
  runStatus: string;
  sourceExecutionId: string | null;
  proposalStatus: string;
  runResult?: Record<string, unknown>;
  promotion?: Record<string, unknown>;
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
      result:
        runResult ?? (sourceExecutionId ? { executionId: sourceExecutionId } : {}),
      metadata: {
        itemKind: item.kind,
        itemStatusBeforeRun: item.kind,
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
        ...(promotion ? { promotion } : {}),
      },
      createdAt: now,
      updatedAt: now,
      reviewedAt: null,
      approvedAt: null,
    });
  } finally {
    db.close();
  }
  return { proposalId, workspaceId };
}

test("held workflow runs do not emit ready-for-review proposals", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-held-proposal-lifecycle-"),
  );
  const repoRoot = await makeTempRepo();
  const dbPath = path.join(tempRoot, "orchestrator.sqlite");
  const sessionDbPath = path.join(tempRoot, "sessions.sqlite");
  const eventLogPath = path.join(tempRoot, "events.ndjson");
  const worktreeRoot = path.join(tempRoot, "worktrees");
  const previousEnv = {
    SPORE_WORKSPACE_REPO_ROOT: process.env.SPORE_WORKSPACE_REPO_ROOT,
    SPORE_WORKTREE_ROOT: process.env.SPORE_WORKTREE_ROOT,
    SPORE_SESSION_DB_PATH: process.env.SPORE_SESSION_DB_PATH,
    SPORE_EVENT_LOG_PATH: process.env.SPORE_EVENT_LOG_PATH,
    SPORE_ORCHESTRATOR_DB_PATH: process.env.SPORE_ORCHESTRATOR_DB_PATH,
  };

  process.env.SPORE_WORKSPACE_REPO_ROOT = repoRoot;
  process.env.SPORE_WORKTREE_ROOT = worktreeRoot;
  process.env.SPORE_SESSION_DB_PATH = sessionDbPath;
  process.env.SPORE_EVENT_LOG_PATH = eventLogPath;
  process.env.SPORE_ORCHESTRATOR_DB_PATH = dbPath;

  try {
    const item = createWorkItem(
      {
        title: "Hold self-build workflow before proposal review",
        kind: "workflow",
        goal: "Verify held work-item runs stay in recovery mode.",
        metadata: {
          workflowPath: "config/workflows/cli-verification-pass.yaml",
          projectPath: "config/projects/spore.yaml",
          domainId: "docs",
          roles: ["lead", "builder", "tester", "reviewer"],
          mutationScope: ["docs"],
          safeMode: true,
        },
      },
      dbPath,
    );

    const result = await runSelfBuildWorkItem(
      item.id,
      {
        wait: true,
        timeout: 30000,
        interval: 500,
        stub: true,
      },
      dbPath,
    );

    assert.ok(result);
    assert.equal(result.run.status, "blocked");
    assert.equal(result.proposal ?? null, null);
    assert.equal(getProposalByRun(result.run.id, dbPath), null);

    const runDetail = getSelfBuildWorkItemRun(result.run.id, dbPath);
    assert.ok(runDetail);
    assert.equal(runDetail.proposal, null);
    assert.equal(runDetail.failure?.code, "work_item_run_blocked");
    assert.ok(
      runDetail.suggestedActions.every(
        (action) => action.action !== "review-proposal",
      ),
    );
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});

test("held workflow proposals stay out of review when the source run never reached governance success", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-held-source-run-governance-"),
  );
  const dbPath = path.join(tempRoot, "orchestrator.sqlite");

  try {
    const item = createWorkItem(
      {
        title: "Held workflow proposal",
        kind: "workflow",
        goal: "Keep non-governance-held runs out of review.",
        metadata: {
          projectPath: "config/projects/spore.yaml",
          domainId: "docs",
          mutationScope: ["docs"],
          safeMode: true,
        },
      },
      dbPath,
    );

    const runId = `work-item-run-${Date.now()}`;
    const sourceExecutionId = `execution-${Date.now()}`;
    const { proposalId } = insertProposalFixture({
      dbPath,
      item,
      runId,
      runStatus: "blocked",
      sourceExecutionId,
      proposalStatus: "ready_for_review",
      runResult: {
        executionId: sourceExecutionId,
        status: "held",
      },
    });

    const proposalByRun = getProposalByRun(runId, dbPath);
    assert.ok(proposalByRun);
    assert.equal(proposalByRun.status, "rework_required");
    assert.equal(proposalByRun.links.review ?? null, null);

    const runDetail = getSelfBuildWorkItemRun(runId, dbPath);
    assert.ok(runDetail);
    assert.equal(runDetail.proposal?.status, "rework_required");
    assert.ok(
      runDetail.suggestedActions.every(
        (action) => action.action !== "review-proposal",
      ),
    );

    const reviewPackage = getProposalReviewPackage(proposalId, dbPath);
    assert.ok(reviewPackage);
    assert.equal(reviewPackage.governance.ready, false);
    assert.ok(
      reviewPackage.governance.blockers.some(
        (blocker) => blocker.code === "invalid_proposal_source_run",
      ),
    );
    assert.ok(
      reviewPackage.suggestedActions.every(
        (action) => action.action !== "review-proposal",
      ),
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("workflow proposals remain reviewable when the source run is waiting for review", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-waiting-review-source-run-"),
  );
  const dbPath = path.join(tempRoot, "orchestrator.sqlite");

  try {
    const item = createWorkItem(
      {
        title: "Waiting-review workflow proposal",
        kind: "workflow",
        goal: "Allow governance-held successful runs to surface proposal review.",
        metadata: {
          projectPath: "config/projects/spore.yaml",
          domainId: "docs",
          mutationScope: ["docs"],
          safeMode: true,
        },
      },
      dbPath,
    );

    const runId = `work-item-run-${Date.now()}`;
    const sourceExecutionId = `execution-${Date.now()}`;
    const { proposalId } = insertProposalFixture({
      dbPath,
      item,
      runId,
      runStatus: "blocked",
      sourceExecutionId,
      proposalStatus: "ready_for_review",
      runResult: {
        executionId: sourceExecutionId,
        status: "waiting_review",
      },
    });

    const proposalByRun = getProposalByRun(runId, dbPath);
    assert.ok(proposalByRun);
    assert.equal(proposalByRun.status, "ready_for_review");
    assert.ok(proposalByRun.links.review);

    const runDetail = getSelfBuildWorkItemRun(runId, dbPath);
    assert.ok(runDetail);
    assert.equal(runDetail.proposal?.status, "ready_for_review");
    assert.ok(
      runDetail.suggestedActions.some(
        (action) => action.action === "review-proposal",
      ),
    );

    const reviewPackage = getProposalReviewPackage(proposalId, dbPath);
    assert.ok(reviewPackage);
    assert.equal(reviewPackage.governance.ready, true);
    assert.equal(reviewPackage.promotion.sourceExecutionId, sourceExecutionId);
    assert.ok(
      reviewPackage.governance.blockers.every(
        (blocker) => blocker.code !== "invalid_proposal_source_run",
      ),
    );
    assert.ok(
      reviewPackage.suggestedActions.some(
        (action) => action.action === "review-proposal",
      ),
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("proposal promotion context uses durable source execution without reusing workspace branches", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-promotion-context-"),
  );
  const dbPath = path.join(tempRoot, "orchestrator.sqlite");

  try {
    const item = createWorkItem(
      {
        title: "Create durable source execution context",
        kind: "workflow",
        goal: "Verify proposal promotion source execution semantics.",
        metadata: {
          projectPath: "config/projects/spore.yaml",
          domainId: "docs",
          mutationScope: ["docs"],
          safeMode: true,
        },
      },
      dbPath,
    );

    const runId = `work-item-run-${Date.now()}`;
    const sourceExecutionId = `execution-${Date.now()}`;

    const { proposalId } = insertProposalFixture({
      dbPath,
      item,
      runId,
      runStatus: "completed",
      sourceExecutionId,
      proposalStatus: "ready_for_review",
      promotion: {
        sourceExecutionId: "execution-stale-metadata",
      },
    });

    const reviewPackage = getProposalReviewPackage(proposalId, dbPath);
    assert.ok(reviewPackage);
    assert.equal(reviewPackage.promotion.sourceExecutionId, sourceExecutionId);
    assert.equal(reviewPackage.promotion.integrationBranch ?? null, null);

    const approved = await approveProposalArtifact(
      proposalId,
      {
        status: "approved",
        by: "test-runner",
        targetBranch: "main",
      },
      dbPath,
    );

    assert.ok(approved);
    assert.equal(approved.promotion.sourceExecutionId, sourceExecutionId);
    assert.equal(approved.promotion.integrationBranch ?? null, null);
    assert.ok(
      approved.promotion.blockers.every(
        (blocker) => blocker.code !== "missing_promotion_source_execution",
      ),
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("legacy blocked-run proposals are forced into recovery instead of review or approval", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-invalid-governance-proposal-"),
  );
  const dbPath = path.join(tempRoot, "orchestrator.sqlite");

  try {
    const item = createWorkItem(
      {
        title: "Legacy blocked proposal",
        kind: "workflow",
        goal: "Keep invalid proposals out of governance.",
        metadata: {
          projectPath: "config/projects/spore.yaml",
          domainId: "docs",
          mutationScope: ["docs"],
          safeMode: true,
        },
      },
      dbPath,
    );

    const runId = `work-item-run-${Date.now()}`;
    const { proposalId } = insertProposalFixture({
      dbPath,
      item,
      runId,
      runStatus: "blocked",
      sourceExecutionId: null,
      proposalStatus: "ready_for_review",
      promotion: {
        sourceExecutionId: "execution-stale-metadata",
      },
    });

    const reviewPackage = getProposalReviewPackage(proposalId, dbPath);
    assert.ok(reviewPackage);
    assert.equal(reviewPackage.promotion.sourceExecutionId, null);
    assert.ok(
      reviewPackage.promotion.blockers.some(
        (blocker) => blocker.code === "missing_promotion_source_execution",
      ),
    );
    assert.ok(
      reviewPackage.suggestedActions.every(
        (action) => action.action !== "review-proposal",
      ),
    );

    const proposalSummary = getProposalSummary(proposalId, dbPath);
    assert.ok(proposalSummary);
    assert.equal(proposalSummary.status, "rework_required");
    assert.equal(proposalSummary.links.review ?? null, null);
    assert.equal(proposalSummary.links.approval ?? null, null);

    const proposalByRun = getProposalByRun(runId, dbPath);
    assert.ok(proposalByRun);
    assert.equal(proposalByRun.status, "rework_required");
    assert.equal(proposalByRun.links.review ?? null, null);
    assert.equal(proposalByRun.links.approval ?? null, null);

    const reviewed = await reviewProposalArtifact(
      proposalId,
      {
        status: "reviewed",
        by: "test-runner",
      },
      dbPath,
    );
    assert.ok(reviewed);
    assert.equal(reviewed.status, "rework_required");

    const approved = await approveProposalArtifact(
      proposalId,
      {
        status: "approved",
        by: "test-runner",
        targetBranch: "main",
      },
      dbPath,
    );
    assert.ok(approved);
    assert.equal(approved.status, "rework_required");
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
