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

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function launchContextPath(sessionId) {
  return path.join(
    process.cwd(),
    "tmp",
    "sessions",
    `${sessionId}.launch-context.json`,
  );
}

async function importFreshSelfBuildModules() {
  const cacheKey = Date.now();
  return Promise.all([
    import(`../src/execution/history.js?test=${cacheKey}`),
    import(`../src/self-build/self-build.js?test=${cacheKey}`),
    import(`../src/work-items/work-items.js?test=${cacheKey}`),
  ]);
}

async function assertIsolatedSelfBuildRoles({
  createWorkItem,
  getExecutionDetail,
  runSelfBuildWorkItem,
  dbPath,
  sessionDbPath,
  repoRoot,
  worktreeRoot,
  workflowPath,
  domainId,
  roles,
  mutationScope,
  launchContexts,
  title,
  goal,
}) {
  const item = createWorkItem(
    {
      title,
      kind: "workflow",
      goal,
      metadata: {
        workflowPath,
        projectPath: "config/projects/spore.yaml",
        domainId,
        roles,
        mutationScope,
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
  assert.ok(result.run?.result?.executionId);

  const detail = getExecutionDetail(
    result.run.result.executionId,
    dbPath,
    sessionDbPath,
  );
  const db = openOrchestratorDatabase(dbPath);
  const workspaces = listWorkspaceAllocations(db, { limit: 50 });
  db.close();

  for (const role of roles) {
    const step = detail.steps.find((candidate) => candidate.role === role);
    assert.ok(step, `missing ${role} step`);
    assert.ok(step.sessionId, `missing ${role} session id`);
    const workspace = workspaces.find((candidate) => candidate.stepId === step.id);
    assert.ok(workspace, `missing ${role} workspace`);
    assert.notEqual(workspace.worktreePath, repoRoot);
    assert.ok(
      workspace.worktreePath.startsWith(worktreeRoot),
      `${role} workspace should be provisioned under the isolated worktree root`,
    );
    const contextPath = launchContextPath(step.sessionId);
    launchContexts.push(contextPath);
    const launchContext = await readJson(contextPath);
    assert.equal(launchContext.cwd, workspace.worktreePath);
  }
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

    assert.equal(workspaces.length, 4);
    const leadWorkspace = workspaces.find((workspace) => workspace.stepId === detail.steps.find((step) => step.role === "lead")?.id);
    const reviewerWorkspace = workspaces.find((workspace) => workspace.stepId === detail.steps.find((step) => step.role === "reviewer")?.id);
    const authoringWorkspace = workspaces.find(
      (workspace) => workspace.stepId === builderStep.id,
    );
    const verificationWorkspace = workspaces.find(
      (workspace) => workspace.stepId === testerStep.id,
    );

    assert.ok(leadWorkspace);
    assert.ok(authoringWorkspace);
    assert.ok(verificationWorkspace);
    assert.ok(reviewerWorkspace);
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

test("work-item-driven frontend execution isolates lead scout and reviewer cwd", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-work-item-role-workspaces-"),
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
    const [{ getExecutionDetail }, { runSelfBuildWorkItem }, { createWorkItem }] =
      await importFreshSelfBuildModules();

    await assertIsolatedSelfBuildRoles({
      createWorkItem,
      getExecutionDetail,
      runSelfBuildWorkItem,
      dbPath,
      sessionDbPath,
      repoRoot,
      worktreeRoot,
      workflowPath: "config/workflows/frontend-ui-pass.yaml",
      domainId: "frontend",
      roles: ["lead", "scout"],
      mutationScope: ["docs"],
      launchContexts,
      title: "Run lead and scout in isolated workspaces",
      goal: "Keep lead and scout inside dedicated self-build workspaces.",
    });
    await assertIsolatedSelfBuildRoles({
      createWorkItem,
      getExecutionDetail,
      runSelfBuildWorkItem,
      dbPath,
      sessionDbPath,
      repoRoot,
      worktreeRoot,
      workflowPath: "config/workflows/frontend-ui-pass.yaml",
      domainId: "frontend",
      roles: ["reviewer"],
      mutationScope: ["docs"],
      launchContexts,
      title: "Run reviewer in an isolated workspace",
      goal: "Keep reviewer inside a dedicated self-build workspace.",
    });
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

test("work-item-driven cli executions isolate non-builder roles", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-work-item-cli-workspaces-"),
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
    const [{ getExecutionDetail }, { runSelfBuildWorkItem }, { createWorkItem }] =
      await importFreshSelfBuildModules();

    await assertIsolatedSelfBuildRoles({
      createWorkItem,
      getExecutionDetail,
      runSelfBuildWorkItem,
      dbPath,
      sessionDbPath,
      repoRoot,
      worktreeRoot,
      workflowPath: "config/workflows/cli-verification-pass.yaml",
      domainId: "cli",
      roles: ["lead"],
      mutationScope: ["docs"],
      launchContexts,
      title: "Run CLI lead in an isolated workspace",
      goal: "Keep the CLI lead inside a dedicated self-build workspace.",
    });
    await assertIsolatedSelfBuildRoles({
      createWorkItem,
      getExecutionDetail,
      runSelfBuildWorkItem,
      dbPath,
      sessionDbPath,
      repoRoot,
      worktreeRoot,
      workflowPath: "config/workflows/cli-verification-pass.yaml",
      domainId: "cli",
      roles: ["reviewer"],
      mutationScope: ["docs"],
      launchContexts,
      title: "Run CLI reviewer in an isolated workspace",
      goal: "Keep the CLI reviewer inside a dedicated self-build workspace.",
    });
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

test("work-item-driven backend executions isolate non-builder roles", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-work-item-backend-workspaces-"),
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
    const [{ getExecutionDetail }, { runSelfBuildWorkItem }, { createWorkItem }] =
      await importFreshSelfBuildModules();

    await assertIsolatedSelfBuildRoles({
      createWorkItem,
      getExecutionDetail,
      runSelfBuildWorkItem,
      dbPath,
      sessionDbPath,
      repoRoot,
      worktreeRoot,
      workflowPath: "config/workflows/backend-service-delivery.yaml",
      domainId: "backend",
      roles: ["lead"],
      mutationScope: ["docs"],
      launchContexts,
      title: "Run backend lead in an isolated workspace",
      goal: "Keep the backend lead inside a dedicated self-build workspace.",
    });
    await assertIsolatedSelfBuildRoles({
      createWorkItem,
      getExecutionDetail,
      runSelfBuildWorkItem,
      dbPath,
      sessionDbPath,
      repoRoot,
      worktreeRoot,
      workflowPath: "config/workflows/backend-service-delivery.yaml",
      domainId: "backend",
      roles: ["reviewer"],
      mutationScope: ["docs"],
      launchContexts,
      title: "Run backend reviewer in an isolated workspace",
      goal: "Keep the backend reviewer inside a dedicated self-build workspace.",
    });
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

test("work-item-driven docs executions isolate non-builder roles", async () => {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "spore-work-item-docs-workspaces-"),
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
    const [{ getExecutionDetail }, { runSelfBuildWorkItem }, { createWorkItem }] =
      await importFreshSelfBuildModules();

    await assertIsolatedSelfBuildRoles({
      createWorkItem,
      getExecutionDetail,
      runSelfBuildWorkItem,
      dbPath,
      sessionDbPath,
      repoRoot,
      worktreeRoot,
      workflowPath: "config/workflows/docs-adr-pass.yaml",
      domainId: "docs",
      roles: ["lead", "scout"],
      mutationScope: ["docs"],
      launchContexts,
      title: "Run docs lead and scout in isolated workspaces",
      goal: "Keep the docs lead and scout inside dedicated self-build workspaces.",
    });
    await assertIsolatedSelfBuildRoles({
      createWorkItem,
      getExecutionDetail,
      runSelfBuildWorkItem,
      dbPath,
      sessionDbPath,
      repoRoot,
      worktreeRoot,
      workflowPath: "config/workflows/docs-adr-pass.yaml",
      domainId: "docs",
      roles: ["reviewer"],
      mutationScope: ["docs"],
      launchContexts,
      title: "Run docs reviewer in an isolated workspace",
      goal: "Keep the docs reviewer inside a dedicated self-build workspace.",
    });
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
