import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  buildWorkspaceSnapshotRef,
  buildWorkspaceBranchName,
  buildWorkspacePath,
  createWorkspace,
  createWorkspaceFromSnapshot,
  deriveWorkspaceDiagnostics,
  inspectWorkspace,
  listGitWorktrees,
  publishWorkspaceSnapshot,
  removeWorkspace,
  reconcileWorkspace,
  resolveCanonicalGitRoot,
  summarizeWorkspaceChanges,
  writeWorkspacePatchArtifact
} from "../src/manager.js";

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"]
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
      reject(new Error(stderr || stdout || `${command} failed with code ${code}`));
    });
  });
}

async function makeTempRepo() {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spore-workspace-test-"));
  await run("git", ["init", "-b", "main"], { cwd: repoRoot });
  await run("git", ["config", "user.name", "SPORE Test"], { cwd: repoRoot });
  await run("git", ["config", "user.email", "spore-test@example.com"], { cwd: repoRoot });
  await fs.writeFile(path.join(repoRoot, "README.md"), "# temp repo\n", "utf8");
  await run("git", ["add", "README.md"], { cwd: repoRoot });
  await run("git", ["commit", "-m", "init"], { cwd: repoRoot });
  return repoRoot;
}

test("workspace manager creates, inspects, patches, and removes a git worktree", async () => {
  const repoRoot = await makeTempRepo();
  const workspaceId = "ws-001";
  const workspace = await createWorkspace({
    repoRoot,
    workspaceId,
    projectId: "spore",
    ownerType: "work-item-run",
    ownerId: "run-001",
    mutationScope: ["docs", "config"]
  });

  assert.equal(await resolveCanonicalGitRoot(repoRoot), repoRoot);
  assert.equal(workspace.branchName, "spore/spore/work-item-run/run-001");
  assert.equal(
    workspace.worktreePath,
    buildWorkspacePath({ projectId: "spore", workspaceId, worktreeRoot: path.join(repoRoot, ".spore", "worktrees") })
  );

  const worktrees = await listGitWorktrees({ repoRoot });
  assert.ok(worktrees.some((entry) => path.resolve(entry.path) === path.resolve(workspace.worktreePath)));

  const inspection = await inspectWorkspace({ repoRoot, worktreePath: workspace.worktreePath, branchName: workspace.branchName });
  assert.equal(inspection.exists, true);
  assert.equal(inspection.registered, true);
  assert.equal(inspection.branchMatches, true);
  assert.equal(inspection.clean, true);

  await fs.writeFile(path.join(workspace.worktreePath, "README.md"), "# temp repo\nworkspace change\n", "utf8");
  const dirtyInspection = await inspectWorkspace({ repoRoot, worktreePath: workspace.worktreePath, branchName: workspace.branchName });
  assert.equal(dirtyInspection.clean, false);
  assert.equal(dirtyInspection.statusSummary, "dirty");

  const patchPath = path.join(repoRoot, "tmp.patch");
  const patch = await writeWorkspacePatchArtifact({ worktreePath: workspace.worktreePath, outputPath: patchPath });
  assert.ok(patch.byteLength > 0);
  const patchContent = await fs.readFile(patchPath, "utf8");
  assert.match(patchContent, /README\.md/);

  await removeWorkspace({ repoRoot, worktreePath: workspace.worktreePath, force: true });
  await assert.rejects(fs.access(workspace.worktreePath));
});

test("workspace branch naming is stable and sanitized", () => {
  const branch = buildWorkspaceBranchName({
    projectId: "spore/ui",
    ownerType: "work-item-run",
    ownerId: "run:123"
  });
  assert.equal(branch, "spore/spore-ui/work-item-run/run-123");
});

test("workspace reconcile surfaces diagnostics for dirty and missing worktrees", async () => {
  const repoRoot = await makeTempRepo();
  const workspace = await createWorkspace({
    repoRoot,
    workspaceId: "ws-002",
    projectId: "spore",
    ownerType: "execution-step",
    ownerId: "step-001"
  });

  await fs.writeFile(path.join(workspace.worktreePath, "README.md"), "# temp repo\ndirty\n", "utf8");
  const dirtyInspection = await inspectWorkspace({
    repoRoot,
    worktreePath: workspace.worktreePath,
    branchName: workspace.branchName
  });
  const dirtyDiagnostics = deriveWorkspaceDiagnostics({
    inspection: dirtyInspection,
    allocation: {
      id: workspace.id,
      status: "active"
    }
  });
  assert.equal(dirtyDiagnostics.state, "dirty");
  assert.equal(dirtyDiagnostics.recommendedAction, "inspect-before-cleanup");

  const reconciledDirty = await reconcileWorkspace({
    repoRoot,
    allocation: {
      id: workspace.id,
      worktreePath: workspace.worktreePath,
      branchName: workspace.branchName,
      status: "active"
    }
  });
  assert.equal(reconciledDirty.diagnostics.state, "dirty");

  await removeWorkspace({ repoRoot, worktreePath: workspace.worktreePath, branchName: workspace.branchName, force: true });
  const reconciledMissing = await reconcileWorkspace({
    repoRoot,
    allocation: {
      id: workspace.id,
      worktreePath: workspace.worktreePath,
      branchName: workspace.branchName,
      status: "active"
    }
  });
  assert.equal(reconciledMissing.diagnostics.state, "missing");
  assert.equal(reconciledMissing.commandHint.includes("git status"), true);
});

test("workspace change summary groups changed files by mutation scope", async () => {
  const repoRoot = await makeTempRepo();
  const workspace = await createWorkspace({
    repoRoot,
    workspaceId: "ws-003",
    projectId: "spore",
    ownerType: "work-item-run",
    ownerId: "run-003",
    mutationScope: ["docs", "apps/web"]
  });

  await fs.mkdir(path.join(workspace.worktreePath, "docs"), { recursive: true });
  await fs.mkdir(path.join(workspace.worktreePath, "apps", "web"), { recursive: true });
  await fs.writeFile(path.join(workspace.worktreePath, "docs", "guide.md"), "# guide\n", "utf8");
  await fs.writeFile(path.join(workspace.worktreePath, "apps", "web", "panel.js"), "console.log('panel');\n", "utf8");
  await fs.writeFile(path.join(workspace.worktreePath, "README.md"), "# temp repo\nchanged\n", "utf8");

  const summary = await summarizeWorkspaceChanges({
    worktreePath: workspace.worktreePath,
    mutationScope: ["docs", "apps/web"]
  });

  assert.equal(summary.fileCount, 3);
  assert.ok(summary.untrackedFileCount >= 2);
  assert.ok(summary.changedFiles.some((file) => file.scope === "docs"));
  assert.ok(summary.changedFiles.some((file) => file.scope === "apps/web"));
  assert.ok(summary.changedFiles.some((file) => file.path === "README.md"));
  assert.ok(summary.filesByScope.some((entry) => entry.scope === "docs" && entry.fileCount === 1));
  assert.ok(summary.filesByScope.some((entry) => entry.scope === "apps/web" && entry.fileCount === 1));

  await removeWorkspace({ repoRoot, worktreePath: workspace.worktreePath, branchName: workspace.branchName, force: true });
});

test("workspace manager publishes a builder snapshot and provisions a separate verification workspace from it", async () => {
  const repoRoot = await makeTempRepo();
  const authoringWorkspace = await createWorkspace({
    repoRoot,
    workspaceId: "ws-authoring",
    projectId: "spore",
    ownerType: "execution-step",
    ownerId: "step-builder-001",
    mutationScope: ["docs"]
  });

  await fs.writeFile(path.join(authoringWorkspace.worktreePath, "README.md"), "# temp repo\nbuilder authored change\n", "utf8");
  const snapshot = await publishWorkspaceSnapshot({
    repoRoot,
    worktreePath: authoringWorkspace.worktreePath,
    snapshotRef: buildWorkspaceSnapshotRef({
      projectId: "spore",
      executionId: "execution-001",
      stepId: "step-builder-001",
      attemptCount: 1
    }),
    commitMessage: "chore: publish builder snapshot"
  });

  assert.equal(snapshot.committed, true);
  assert.ok(snapshot.snapshotCommit);
  assert.match(snapshot.snapshotRef, /^refs\/spore\/handoffs\//);

  const verificationWorkspace = await createWorkspaceFromSnapshot({
    repoRoot,
    workspaceId: "ws-verification",
    projectId: "spore",
    ownerType: "execution-step",
    ownerId: "step-tester-001",
    snapshotRef: snapshot.snapshotRef,
    snapshotCommit: snapshot.snapshotCommit,
    mutationScope: ["docs"]
  });

  assert.notEqual(verificationWorkspace.worktreePath, authoringWorkspace.worktreePath);
  const verificationReadme = await fs.readFile(path.join(verificationWorkspace.worktreePath, "README.md"), "utf8");
  assert.match(verificationReadme, /builder authored change/);

  await fs.writeFile(path.join(authoringWorkspace.worktreePath, "README.md"), "# temp repo\nbuilder changed again\n", "utf8");
  const verificationReadmeAfterBuilderEdit = await fs.readFile(path.join(verificationWorkspace.worktreePath, "README.md"), "utf8");
  assert.match(verificationReadmeAfterBuilderEdit, /builder authored change/);
  assert.doesNotMatch(verificationReadmeAfterBuilderEdit, /builder changed again/);

  await removeWorkspace({
    repoRoot,
    worktreePath: verificationWorkspace.worktreePath,
    branchName: verificationWorkspace.branchName,
    force: true
  });
  await removeWorkspace({
    repoRoot,
    worktreePath: authoringWorkspace.worktreePath,
    branchName: authoringWorkspace.branchName,
    force: true
  });
});
