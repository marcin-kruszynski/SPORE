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
  listWorkspaceAllocations,
  openOrchestratorDatabase,
} from "../src/store/execution-store.js";

function run(command, args, options: SpawnOptionsWithoutStdio = {}) {
  return new Promise((resolve, reject) => {
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
    path.join(os.tmpdir(), "spore-builder-tester-"),
  );
  await run("git", ["init", "-b", "main"], { cwd: repoRoot });
  await run("git", ["config", "user.name", "SPORE Test"], { cwd: repoRoot });
  await run("git", ["config", "user.email", "spore-test@example.com"], {
    cwd: repoRoot,
  });
  await fs.writeFile(path.join(repoRoot, "README.md"), "# temp repo\n", "utf8");
  await run("git", ["add", "README.md"], { cwd: repoRoot });
  await run("git", ["commit", "-m", "init"], { cwd: repoRoot });
  return repoRoot;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

test("builder handoff snapshot provisions a separate tester verification workspace", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-builder-tester-flow-"),
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

  const launchContexts = [];
  try {
    const invocation = await planWorkflowInvocation({
      workflowPath: "config/workflows/cli-verification-pass.yaml",
      projectPath: "config/projects/spore.yaml",
      domainId: "cli",
      roles: ["lead", "builder", "tester", "reviewer"],
      objective: "Validate sequential builder to tester verification handoff.",
      invocationId: `builder-tester-${Date.now()}`,
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

    assert.equal(detail.execution.state, "waiting_review");
    const builderStep = detail.steps.find((step) => step.role === "builder");
    const testerStep = detail.steps.find((step) => step.role === "tester");
    assert.ok(builderStep);
    assert.ok(testerStep);
    assert.equal(builderStep.state, "completed");
    assert.equal(testerStep.state, "completed");

    const db = openOrchestratorDatabase(dbPath);
    const workspaces = listWorkspaceAllocations(db, {
      executionId: created.execution.id,
      limit: 10,
    });
    db.close();

    assert.equal(workspaces.length, 2);
    const authoringWorkspace = workspaces.find(
      (workspace) => workspace.stepId === builderStep.id,
    );
    const verificationWorkspace = workspaces.find(
      (workspace) => workspace.stepId === testerStep.id,
    );

    assert.ok(authoringWorkspace);
    assert.ok(verificationWorkspace);
    assert.equal(authoringWorkspace.metadata.workspacePurpose, "authoring");
    assert.equal(
      verificationWorkspace.metadata.workspacePurpose,
      "verification",
    );
    assert.notEqual(
      authoringWorkspace.worktreePath,
      verificationWorkspace.worktreePath,
    );
    assert.equal(
      verificationWorkspace.metadata.sourceWorkspaceId,
      authoringWorkspace.id,
    );
    assert.equal(verificationWorkspace.metadata.sourceStepId, builderStep.id);
    assert.equal(verificationWorkspace.metadata.handoffStatus, "ready");
    assert.ok(authoringWorkspace.metadata.handoff?.snapshotCommit);
    assert.ok(authoringWorkspace.metadata.handoff?.snapshotRef);
    assert.equal(
      verificationWorkspace.metadata.sourceCommit,
      authoringWorkspace.metadata.handoff.snapshotCommit,
    );
    assert.equal(
      verificationWorkspace.metadata.sourceRef,
      authoringWorkspace.metadata.handoff.snapshotRef,
    );

    const builderReadme = await fs.readFile(
      path.join(authoringWorkspace.worktreePath, "README.md"),
      "utf8",
    );
    const testerReadme = await fs.readFile(
      path.join(verificationWorkspace.worktreePath, "README.md"),
      "utf8",
    );
    assert.equal(builderReadme, testerReadme);

    launchContexts.push(
      path.join(
        process.cwd(),
        "tmp",
        "sessions",
        `${builderStep.sessionId}.launch-context.json`,
      ),
    );
    launchContexts.push(
      path.join(
        process.cwd(),
        "tmp",
        "sessions",
        `${testerStep.sessionId}.launch-context.json`,
      ),
    );
    const builderLaunch = await readJson(launchContexts[0]);
    const testerLaunch = await readJson(launchContexts[1]);
    assert.equal(builderLaunch.cwd, authoringWorkspace.worktreePath);
    assert.equal(testerLaunch.cwd, verificationWorkspace.worktreePath);
    assert.equal(testerLaunch.purpose, "verification");
    assert.equal(testerLaunch.sourceWorkspaceId, authoringWorkspace.id);
    assert.equal(
      testerLaunch.sourceCommit,
      authoringWorkspace.metadata.handoff.snapshotCommit,
    );
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await Promise.all(
      launchContexts.map((filePath) =>
        fs.rm(filePath, { force: true }).catch(() => {}),
      ),
    );
    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});
