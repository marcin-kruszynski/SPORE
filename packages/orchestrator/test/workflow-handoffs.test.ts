import assert from "node:assert/strict";
import type { SpawnOptionsWithoutStdio } from "node:child_process";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createExecution,
  driveExecution,
} from "../src/execution/workflow-execution.js";
import { planWorkflowInvocation } from "../src/invocation/plan-workflow-invocation.js";
import {
  getWorkflowHandoff,
  listWorkflowHandoffs,
  markWorkflowHandoffConsumed,
  openOrchestratorDatabase,
  upsertWorkflowHandoff,
} from "../src/store/execution-store.js";

function run(command: string, args: string[], options: SpawnOptionsWithoutStdio = {}) {
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
    path.join(os.tmpdir(), "spore-workflow-handoffs-repo-"),
  );
  await run("git", ["init", "-b", "main"], { cwd: repoRoot });
  await run("git", ["config", "user.name", "SPORE Test"], { cwd: repoRoot });
  await run("git", ["config", "user.email", "spore-test@example.com"], {
    cwd: repoRoot,
  });
  await fs.writeFile(path.join(repoRoot, "README.md"), "# temp repo\n", "utf8");
  await fs.mkdir(path.join(repoRoot, "apps", "web"), { recursive: true });
  await fs.writeFile(
    path.join(repoRoot, "apps", "web", "index.tsx"),
    "export const ui = true;\n",
    "utf8",
  );
  await fs.mkdir(path.join(repoRoot, "docs"), { recursive: true });
  await fs.writeFile(path.join(repoRoot, "docs", "guide.md"), "# guide\n", "utf8");
  await run("git", ["add", "."], { cwd: repoRoot });
  await run("git", ["commit", "-m", "init"], { cwd: repoRoot });
  return repoRoot;
}

function sessionArtifactPath(sessionId: string, suffix: string) {
  return path.join(process.cwd(), "tmp", "sessions", `${sessionId}.${suffix}`);
}

test("workflow handoffs persist ready and consumed records by execution order", async (t) => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-workflow-handoffs-"),
  );
  t.after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const dbPath = path.join(tempRoot, "orchestrator.sqlite");
  const db = openOrchestratorDatabase(dbPath);
  try {
    upsertWorkflowHandoff(db, {
      id: "handoff-builder-summary",
      executionId: "execution-1",
      fromStepId: "step-builder",
      toStepId: "step-tester",
      sourceRole: "builder",
      targetRole: "tester",
      kind: "implementation_summary",
      status: "ready",
      summary: {
        title: "Builder summary",
        objective: "Ship workflow handoffs",
        outcome: "implemented",
        confidence: "high",
      },
      artifacts: {
        sessionId: "session-builder",
        transcriptPath: "tmp/sessions/session-builder.transcript.md",
        briefPath: "tmp/orchestrator/execution-1/session-builder.brief.md",
        handoffPath: "tmp/sessions/session-builder.handoff.json",
        workspaceId: "workspace-builder",
        proposalArtifactId: null,
        snapshotRef: null,
        snapshotCommit: null,
      },
      payload: {
        changedPaths: ["packages/orchestrator/src/execution/workflow-execution.impl.ts"],
      },
      createdAt: "2026-03-12T10:00:00.000Z",
      updatedAt: "2026-03-12T10:00:00.000Z",
      consumedAt: null,
    });

    upsertWorkflowHandoff(db, {
      id: "handoff-builder-snapshot",
      executionId: "execution-1",
      fromStepId: "step-builder",
      toStepId: "step-tester",
      sourceRole: "builder",
      targetRole: "tester",
      kind: "workspace_snapshot",
      status: "ready",
      summary: {
        title: "Builder snapshot",
        objective: "Ship workflow handoffs",
        outcome: "snapshot-published",
        confidence: "high",
      },
      artifacts: {
        sessionId: "session-builder",
        transcriptPath: "tmp/sessions/session-builder.transcript.md",
        briefPath: "tmp/orchestrator/execution-1/session-builder.brief.md",
        handoffPath: "tmp/sessions/session-builder.handoff.json",
        workspaceId: "workspace-builder",
        proposalArtifactId: null,
        snapshotRef: "refs/spore/handoffs/execution-1/step-builder",
        snapshotCommit: "abc123",
      },
      payload: {
        workspacePurpose: "authoring",
      },
      createdAt: "2026-03-12T10:00:01.000Z",
      updatedAt: "2026-03-12T10:00:01.000Z",
      consumedAt: null,
    });

    markWorkflowHandoffConsumed(
      db,
      "handoff-builder-summary",
      "2026-03-12T10:05:00.000Z",
    );

    const allHandoffs = listWorkflowHandoffs(db, {
      executionId: "execution-1",
      limit: 10,
    });
    assert.equal(allHandoffs.length, 2);
    assert.deepEqual(
      allHandoffs.map((record) => record.kind),
      ["implementation_summary", "workspace_snapshot"],
    );

    const consumedHandoff = getWorkflowHandoff(db, "handoff-builder-summary");
    assert.equal(consumedHandoff?.status, "consumed");
    assert.equal(
      consumedHandoff?.consumedAt,
      "2026-03-12T10:05:00.000Z",
    );

    const readyOnly = listWorkflowHandoffs(db, {
      executionId: "execution-1",
      status: "ready",
      limit: 10,
    });
    assert.equal(readyOnly.length, 1);
    assert.equal(readyOnly[0]?.kind, "workspace_snapshot");
  } finally {
    db.close();
  }
});

test("completed steps publish normalized workflow handoff artifacts", async (t) => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-workflow-handoffs-execution-"),
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

  t.after(async () => {
    process.env.SPORE_WORKSPACE_REPO_ROOT = previousEnv.SPORE_WORKSPACE_REPO_ROOT;
    process.env.SPORE_WORKTREE_ROOT = previousEnv.SPORE_WORKTREE_ROOT;
    process.env.SPORE_SESSION_DB_PATH = previousEnv.SPORE_SESSION_DB_PATH;
    process.env.SPORE_EVENT_LOG_PATH = previousEnv.SPORE_EVENT_LOG_PATH;
    process.env.SPORE_ORCHESTRATOR_DB_PATH = previousEnv.SPORE_ORCHESTRATOR_DB_PATH;
    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.rm(repoRoot, { recursive: true, force: true });
  });

  const invocation = await planWorkflowInvocation({
    workflowPath: "config/workflows/frontend-ui-pass.yaml",
    projectPath: "config/projects/spore.yaml",
    domainId: "frontend",
    roles: ["lead", "scout", "builder", "tester", "reviewer"],
    objective: "Validate workflow handoff publication and consumption.",
    invocationId: `workflow-handoffs-${Date.now()}`,
  });

  const created = createExecution(invocation, dbPath);
  const detail = await driveExecution(created.execution.id, {
    wait: true,
    timeoutMs: 30000,
    intervalMs: 500,
    stub: true,
    dbPath,
    sessionDbPath,
  });

  const db = openOrchestratorDatabase(dbPath);
  try {
    const handoffs = listWorkflowHandoffs(db, {
      executionId: created.execution.id,
      limit: 20,
    });
    const handoffKinds = handoffs.map((record) => record.kind).sort();
    assert.deepEqual(handoffKinds, [
      "implementation_summary",
      "review_summary",
      "scout_findings",
      "task_brief",
      "verification_summary",
      "workspace_snapshot",
    ]);

    const leadStep = detail.steps.find((step) => step.role === "lead");
    const scoutStep = detail.steps.find((step) => step.role === "scout");
    assert.ok(leadStep?.sessionId);
    assert.ok(scoutStep?.sessionId);

    const [leadHandoffRaw, scoutHandoffRaw] = await Promise.all([
      fs.readFile(sessionArtifactPath(leadStep.sessionId, "handoff.json"), "utf8"),
      fs.readFile(sessionArtifactPath(scoutStep.sessionId, "handoff.json"), "utf8"),
    ]);
    const leadHandoff = JSON.parse(leadHandoffRaw);
    const scoutHandoff = JSON.parse(scoutHandoffRaw);

    assert.equal(leadHandoff.primary.kind, "task_brief");
    assert.equal(scoutHandoff.primary.kind, "scout_findings");
  } finally {
    db.close();
  }
});

test("downstream sessions receive curated inbound workflow handoffs", async (t) => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-workflow-handoffs-context-"),
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

  t.after(async () => {
    process.env.SPORE_WORKSPACE_REPO_ROOT = previousEnv.SPORE_WORKSPACE_REPO_ROOT;
    process.env.SPORE_WORKTREE_ROOT = previousEnv.SPORE_WORKTREE_ROOT;
    process.env.SPORE_SESSION_DB_PATH = previousEnv.SPORE_SESSION_DB_PATH;
    process.env.SPORE_EVENT_LOG_PATH = previousEnv.SPORE_EVENT_LOG_PATH;
    process.env.SPORE_ORCHESTRATOR_DB_PATH = previousEnv.SPORE_ORCHESTRATOR_DB_PATH;
    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.rm(repoRoot, { recursive: true, force: true });
  });

  const invocation = await planWorkflowInvocation({
    workflowPath: "config/workflows/frontend-ui-pass.yaml",
    projectPath: "config/projects/spore.yaml",
    domainId: "frontend",
    roles: ["lead", "scout", "builder", "tester", "reviewer"],
    objective: "Validate workflow handoff publication and consumption.",
    invocationId: `workflow-handoffs-context-${Date.now()}`,
  });

  const created = createExecution(invocation, dbPath);
  const detail = await driveExecution(created.execution.id, {
    wait: true,
    timeoutMs: 30000,
    intervalMs: 500,
    stub: true,
    dbPath,
    sessionDbPath,
  });

  const builderStep = detail.steps.find((step) => step.role === "builder");
  const testerStep = detail.steps.find((step) => step.role === "tester");
  assert.ok(builderStep?.sessionId);
  assert.ok(testerStep?.sessionId);

  const [builderPlanRaw, testerPlanRaw] = await Promise.all([
    fs.readFile(sessionArtifactPath(builderStep.sessionId, "plan.json"), "utf8"),
    fs.readFile(sessionArtifactPath(testerStep.sessionId, "plan.json"), "utf8"),
  ]);
  const builderPlan = JSON.parse(builderPlanRaw);
  const testerPlan = JSON.parse(testerPlanRaw);

  assert.deepEqual(
    builderPlan.metadata.inboundHandoffs.map((record) => record.kind).sort(),
    ["scout_findings", "task_brief"],
  );
  assert.equal(
    builderPlan.metadata.expectedHandoff.kind,
    "implementation_summary",
  );
  assert.deepEqual(
    testerPlan.metadata.inboundHandoffs.map((record) => record.kind).sort(),
    ["implementation_summary", "workspace_snapshot"],
  );
  assert.equal(
    testerPlan.metadata.expectedHandoff.kind,
    "verification_summary",
  );
});
