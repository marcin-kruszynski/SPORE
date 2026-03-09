import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { PROJECT_ROOT } from "../../runtime-pi/src/metadata/constants.js";

export const DEFAULT_WORKTREE_ROOT = path.join(PROJECT_ROOT, ".spore", "worktrees");

function resolveWorktreeRoot(repoRoot, explicitRoot = null) {
  if (explicitRoot) {
    return path.isAbsolute(explicitRoot) ? explicitRoot : path.join(repoRoot, explicitRoot);
  }
  return path.join(repoRoot, ".spore", "worktrees");
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? PROJECT_ROOT,
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
        resolve({ stdout, stderr, code });
        return;
      }
      const message = stderr || stdout || `${command} failed with code ${code}`;
      reject(new Error(message.trim()));
    });
  });
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export async function resolveCanonicalGitRoot(startPath = PROJECT_ROOT) {
  const resolved = path.resolve(startPath);
  const result = await run("git", ["rev-parse", "--show-toplevel"], { cwd: resolved });
  return result.stdout.trim();
}

export function buildWorkspaceBranchName({ projectId = "default", ownerType = "work-item-run", ownerId }) {
  if (!ownerId) {
    throw new Error("ownerId is required to build a workspace branch name");
  }
  const normalizedProject = String(projectId).trim().replace(/[^a-zA-Z0-9._-]/g, "-") || "default";
  const normalizedType = String(ownerType).trim().replace(/[^a-zA-Z0-9._-]/g, "-") || "work-item-run";
  const normalizedOwner = String(ownerId).trim().replace(/[^a-zA-Z0-9._-]/g, "-");
  return `spore/${normalizedProject}/${normalizedType}/${normalizedOwner}`;
}

export function buildWorkspacePath({ projectId = "default", workspaceId, worktreeRoot = DEFAULT_WORKTREE_ROOT }) {
  if (!workspaceId) {
    throw new Error("workspaceId is required to build a workspace path");
  }
  const normalizedProject = String(projectId).trim().replace(/[^a-zA-Z0-9._-]/g, "-") || "default";
  return path.join(worktreeRoot, normalizedProject, workspaceId);
}

function parseWorktreeList(output = "") {
  const lines = String(output).split(/\r?\n/);
  const entries = [];
  let current = null;
  for (const line of lines) {
    if (!line.trim()) {
      if (current) {
        entries.push(current);
        current = null;
      }
      continue;
    }
    const [key, ...rest] = line.split(" ");
    const value = rest.join(" ").trim();
    if (key === "worktree") {
      if (current) {
        entries.push(current);
      }
      current = {
        path: value,
        head: null,
        branch: null,
        bare: false,
        detached: false,
        locked: false,
        prunable: false
      };
      continue;
    }
    if (!current) {
      continue;
    }
    if (key === "HEAD") {
      current.head = value;
    } else if (key === "branch") {
      current.branch = value.replace(/^refs\/heads\//, "");
    } else if (key === "detached") {
      current.detached = true;
    } else if (key === "locked") {
      current.locked = true;
    } else if (key === "prunable") {
      current.prunable = true;
    } else if (key === "bare") {
      current.bare = true;
    }
  }
  if (current) {
    entries.push(current);
  }
  return entries;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function listGitWorktrees({ repoRoot = PROJECT_ROOT } = {}) {
  const canonicalRoot = await resolveCanonicalGitRoot(repoRoot);
  const result = await run("git", ["worktree", "list", "--porcelain"], { cwd: canonicalRoot });
  return parseWorktreeList(result.stdout).map((entry) => ({
    ...entry,
    isCanonicalRoot: path.resolve(entry.path) === path.resolve(canonicalRoot)
  }));
}

export async function inspectWorkspace({ repoRoot = PROJECT_ROOT, worktreePath, branchName = null } = {}) {
  if (!worktreePath) {
    throw new Error("worktreePath is required");
  }
  const canonicalRoot = await resolveCanonicalGitRoot(repoRoot);
  const normalizedPath = path.resolve(worktreePath);
  const worktrees = await listGitWorktrees({ repoRoot: canonicalRoot });
  const matched = worktrees.find((entry) => path.resolve(entry.path) === normalizedPath) ?? null;
  const exists = await pathExists(normalizedPath);
  let porcelain = [];
  let statusSummary = "missing";
  let clean = false;

  if (exists) {
    try {
      const result = await run("git", ["status", "--short"], { cwd: normalizedPath });
      porcelain = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      clean = porcelain.length === 0;
      statusSummary = clean ? "clean" : "dirty";
    } catch {
      statusSummary = "unavailable";
    }
  }

  const branchMatches = branchName ? matched?.branch === branchName : null;
  return {
    repoRoot: canonicalRoot,
    worktreePath: normalizedPath,
    exists,
    registered: Boolean(matched),
    clean,
    statusSummary,
    branchName: matched?.branch ?? branchName ?? null,
    branchMatches,
    head: matched?.head ?? null,
    detached: matched?.detached ?? false,
    locked: matched?.locked ?? false,
    prunable: matched?.prunable ?? false,
    isCanonicalRoot: matched?.isCanonicalRoot ?? false,
    porcelain
  };
}

export async function createWorkspace({
  repoRoot = PROJECT_ROOT,
  workspaceId,
  projectId = "default",
  ownerType = "work-item-run",
  ownerId,
  baseRef = "HEAD",
  worktreeRoot = null,
  branchName = null,
  mode = "git-worktree",
  safeMode = true,
  mutationScope = []
} = {}) {
  if (!workspaceId) {
    throw new Error("workspaceId is required");
  }
  if (!ownerId) {
    throw new Error("ownerId is required");
  }
  const canonicalRoot = await resolveCanonicalGitRoot(repoRoot);
  const effectiveWorktreeRoot = resolveWorktreeRoot(canonicalRoot, worktreeRoot);
  const effectiveBranchName = branchName ?? buildWorkspaceBranchName({ projectId, ownerType, ownerId });
  const worktreePath = buildWorkspacePath({ projectId, workspaceId, worktreeRoot: effectiveWorktreeRoot });

  if (await pathExists(worktreePath)) {
    throw new Error(`workspace path already exists: ${worktreePath}`);
  }

  const existing = await listGitWorktrees({ repoRoot: canonicalRoot });
  if (existing.some((entry) => entry.branch === effectiveBranchName)) {
    throw new Error(`workspace branch already exists: ${effectiveBranchName}`);
  }

  await fs.mkdir(path.dirname(worktreePath), { recursive: true });
  await run("git", ["worktree", "add", "-b", effectiveBranchName, worktreePath, baseRef], {
    cwd: canonicalRoot
  });

  return {
    id: workspaceId,
    repoRoot: canonicalRoot,
    worktreePath,
    branchName: effectiveBranchName,
    baseRef,
    mode,
    safeMode,
    mutationScope: Array.isArray(mutationScope) ? mutationScope : []
  };
}

export async function removeWorkspace({ repoRoot = PROJECT_ROOT, worktreePath, force = false, branchName = null, keepBranch = false } = {}) {
  if (!worktreePath) {
    throw new Error("worktreePath is required");
  }
  const canonicalRoot = await resolveCanonicalGitRoot(repoRoot);
  const args = ["worktree", "remove"];
  if (force) {
    args.push("--force");
  }
  args.push(path.resolve(worktreePath));
  await run("git", args, { cwd: canonicalRoot });
  if (branchName && !keepBranch) {
    try {
      await run("git", ["branch", "-D", branchName], { cwd: canonicalRoot });
    } catch {
      // branch deletion is best-effort; cleanup should still succeed if the branch is already gone
    }
  }
  return {
    repoRoot: canonicalRoot,
    worktreePath: path.resolve(worktreePath),
    removed: true,
    forced: force,
    branchName,
    keepBranch
  };
}

export async function reconcileWorkspace({ repoRoot = PROJECT_ROOT, allocation = null } = {}) {
  if (!allocation?.worktreePath) {
    throw new Error("allocation with worktreePath is required");
  }
  const inspection = await inspectWorkspace({
    repoRoot,
    worktreePath: allocation.worktreePath,
    branchName: allocation.branchName ?? null
  });
  const status = !inspection.exists
    ? "orphaned"
    : !inspection.registered
      ? "orphaned"
      : inspection.clean
        ? "settled"
        : "active";
  return {
    allocationId: allocation.id ?? null,
    status,
    inspection
  };
}

export async function writeWorkspacePatchArtifact({ worktreePath, outputPath } = {}) {
  if (!worktreePath || !outputPath) {
    throw new Error("worktreePath and outputPath are required to write a workspace patch artifact");
  }
  const result = await run("git", ["diff", "--binary"], { cwd: worktreePath });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, result.stdout, "utf8");
  return {
    outputPath,
    byteLength: Buffer.byteLength(result.stdout, "utf8")
  };
}

export function renderWorkspaceShellSummary(workspace) {
  return [
    `workspaceId: ${workspace.id ?? "unknown"}`,
    `worktreePath: ${workspace.worktreePath ?? "unknown"}`,
    `branchName: ${workspace.branchName ?? "unknown"}`,
    `baseRef: ${workspace.baseRef ?? "unknown"}`,
    `safeMode: ${workspace.safeMode === false ? "false" : "true"}`,
    `mutationScope: ${(workspace.mutationScope ?? []).join(", ") || "(none)"}`
  ].join("\n");
}

export function workspaceCommandHint(workspace) {
  return [
    `cd ${shellEscape(workspace.worktreePath ?? "")}`,
    `git status --short`,
    `git branch --show-current`
  ].join(" && ");
}
