import assert from "node:assert/strict";
import type { SpawnOptionsWithoutStdio } from "node:child_process";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
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
    path.join(os.tmpdir(), "spore-self-build-workspace-"),
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

async function importFreshModules() {
  const cacheKey = Date.now();
  return Promise.all([
    import(`../src/execution/history.js?test=${cacheKey}`),
    import(`../src/self-build/self-build.js?test=${cacheKey}`),
    import(`../src/work-items/work-items.js?test=${cacheKey}`),
  ]);
}

test("self-build workflow handoff reuses the provisioned work-item workspace", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-self-build-allocation-"),
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
    const [
      { getExecutionDetail },
      { runSelfBuildWorkItem },
      { createWorkItem },
    ] = await importFreshModules();

    const item = createWorkItem(
      {
        title: "Repair CLI workflow workspace handoff",
        kind: "workflow",
        goal: "Run a builder-led workflow inside the provisioned self-build workspace.",
        metadata: {
          workflowPath: "config/workflows/cli-verification-pass.yaml",
          projectPath: "config/projects/spore.yaml",
          domainId: "cli",
          roles: ["builder", "tester"],
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
        sessionDbPath,
      },
      dbPath,
    );

    assert.ok(result);
    assert.equal(result.error ?? null, null);
    assert.ok(result.run);
    assert.ok(result.run.result?.executionId);
    assert.ok(result.run.metadata?.workspaceId);

    const detail = getExecutionDetail(
      result.run.result.executionId,
      dbPath,
      sessionDbPath,
    );
    const builderStep = detail.steps.find((step) => step.role === "builder");
    const testerStep = detail.steps.find((step) => step.role === "tester");
    assert.ok(builderStep);
    assert.ok(testerStep);

    const db = openOrchestratorDatabase(dbPath);
    const workspaces = listWorkspaceAllocations(db, {
      executionId: detail.execution.id,
      limit: 10,
    });
    db.close();

    assert.equal(workspaces.length, 2);
    const builderWorkspace = workspaces.find(
      (workspace) => workspace.stepId === builderStep.id,
    );
    const testerWorkspace = workspaces.find(
      (workspace) => workspace.stepId === testerStep.id,
    );

    assert.ok(builderWorkspace);
    assert.ok(testerWorkspace);
    assert.equal(builderWorkspace.id, result.run.metadata.workspaceId);
    assert.equal(builderWorkspace.ownerType, "work-item-run");
    assert.equal(builderWorkspace.workItemRunId, result.run.id);
    assert.equal(
      testerWorkspace.metadata.sourceWorkspaceId,
      builderWorkspace.id,
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

test("builder authoring reuse stays anchored to the work-item workspace after lead isolation", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-self-build-authoring-reuse-"),
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
    const [
      { getExecutionDetail },
      { runSelfBuildWorkItem },
      { createWorkItem },
    ] = await importFreshModules();

    const item = createWorkItem(
      {
        title: "Keep builder reuse anchored to work-item workspace",
        kind: "workflow",
        goal: "Run lead in an isolated workspace without breaking builder reuse.",
        metadata: {
          workflowPath: "config/workflows/cli-verification-pass.yaml",
          projectPath: "config/projects/spore.yaml",
          domainId: "cli",
          roles: ["lead", "builder"],
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
        sessionDbPath,
      },
      dbPath,
    );

    assert.ok(result);
    assert.equal(result.error ?? null, null);
    assert.notEqual(result.run?.status, "failed");
    assert.ok(result.run?.result?.executionId);
    assert.ok(result.run?.metadata?.workspaceId);

    const detail = getExecutionDetail(
      result.run.result.executionId,
      dbPath,
      sessionDbPath,
    );
    const leadStep = detail.steps.find((step) => step.role === "lead");
    const builderStep = detail.steps.find((step) => step.role === "builder");
    assert.ok(leadStep);
    assert.ok(builderStep);
    assert.equal(leadStep.state, "completed");
    assert.equal(builderStep.state, "completed");

    const db = openOrchestratorDatabase(dbPath);
    const workspaces = listWorkspaceAllocations(db, {
      executionId: detail.execution.id,
      limit: 10,
    });
    db.close();

    assert.equal(workspaces.length, 2);
    const leadWorkspace = workspaces.find(
      (workspace) => workspace.stepId === leadStep.id,
    );
    const builderWorkspace = workspaces.find(
      (workspace) => workspace.stepId === builderStep.id,
    );

    assert.ok(leadWorkspace);
    assert.ok(builderWorkspace);
    assert.equal(leadWorkspace.ownerType, "execution-step");
    assert.equal(builderWorkspace.ownerType, "work-item-run");
    assert.equal(builderWorkspace.id, result.run.metadata.workspaceId);
    assert.equal(builderWorkspace.workItemRunId, result.run.id);
    assert.equal(builderWorkspace.metadata.reusedWorkspace, true);
    assert.equal(
      builderWorkspace.metadata.reusedFromAllocationId,
      builderWorkspace.id,
    );
    assert.notEqual(builderWorkspace.worktreePath, leadWorkspace.worktreePath);
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
