import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  buildWorkspaceBranchName,
  buildWorkspacePath,
  createWorkspace,
  inspectWorkspace,
  listGitWorktrees,
  removeWorkspace,
  resolveCanonicalGitRoot,
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
