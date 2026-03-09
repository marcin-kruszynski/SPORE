import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { PROJECT_ROOT } from "../../runtime-pi/src/metadata/constants.js";

export const DEFAULT_WORKTREE_ROOT = path.join(PROJECT_ROOT, ".spore", "worktrees");
const DEFAULT_SNAPSHOT_AUTHOR_NAME = "SPORE Workspace Manager";
const DEFAULT_SNAPSHOT_AUTHOR_EMAIL = "spore-workspace@local.invalid";

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

function sanitizeRefSegment(value, fallback = "unknown") {
  const normalized = String(value ?? "").trim().replace(/[^a-zA-Z0-9._-]/g, "-");
  return normalized || fallback;
}

export function buildWorkspaceSnapshotRef({
  projectId = "default",
  executionId = null,
  stepId,
  attemptCount = 1
}) {
  if (!stepId) {
    throw new Error("stepId is required to build a workspace snapshot ref");
  }
  const segments = [
    "refs",
    "spore",
    "handoffs",
    sanitizeRefSegment(projectId, "default")
  ];
  if (executionId) {
    segments.push(sanitizeRefSegment(executionId));
  }
  segments.push(sanitizeRefSegment(stepId));
  segments.push(`attempt-${sanitizeRefSegment(attemptCount, "1")}`);
  return segments.join("/");
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
  const issues = [];
  if (!exists) {
    issues.push("missing-path");
  }
  if (exists && !matched) {
    issues.push("not-registered");
  }
  if (branchName && branchMatches === false) {
    issues.push("branch-mismatch");
  }
  if (matched?.detached) {
    issues.push("detached-head");
  }
  if (matched?.prunable) {
    issues.push("prunable");
  }
  if (matched?.locked) {
    issues.push("locked");
  }
  if (exists && !clean && porcelain.length > 0) {
    issues.push("dirty");
  }
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
    porcelain,
    issues
  };
}

export function deriveWorkspaceDiagnostics({ inspection, allocation = null } = {}) {
  const issues = Array.isArray(inspection?.issues) ? inspection.issues : [];
  const allocationStatus = allocation?.status ?? null;
  const state =
    allocationStatus === "cleaned"
      ? "cleaned"
      : !inspection?.exists
        ? "missing"
        : !inspection?.registered
          ? "orphaned"
          : issues.includes("branch-mismatch")
            ? "branch-mismatch"
            : issues.includes("detached-head")
              ? "detached"
              : issues.includes("dirty")
                ? "dirty"
                : allocationStatus === "failed"
                  ? "failed"
                  : "healthy";
  const healthy = ["healthy", "cleaned"].includes(state);
  const recommendedAction =
    state === "missing" || state === "orphaned"
      ? "reconcile-or-cleanup"
      : state === "dirty"
        ? "inspect-before-cleanup"
        : state === "branch-mismatch" || state === "detached"
          ? "inspect-and-reconcile"
          : state === "failed"
            ? "inspect-failure"
            : "none";
  return {
    state,
    healthy,
    issues,
    recommendedAction,
    registered: inspection?.registered ?? false,
    exists: inspection?.exists ?? false,
    clean: inspection?.clean ?? false,
    branchMatches: inspection?.branchMatches ?? null,
    detached: inspection?.detached ?? false,
    locked: inspection?.locked ?? false,
    prunable: inspection?.prunable ?? false,
    porcelainCount: Array.isArray(inspection?.porcelain) ? inspection.porcelain.length : 0
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

async function getWorkspaceHead({ worktreePath }) {
  const result = await run("git", ["rev-parse", "HEAD"], { cwd: worktreePath });
  return result.stdout.trim();
}

export async function publishWorkspaceSnapshot({
  repoRoot = PROJECT_ROOT,
  worktreePath,
  snapshotRef,
  commitMessage = "chore: publish workspace snapshot",
  authorName = DEFAULT_SNAPSHOT_AUTHOR_NAME,
  authorEmail = DEFAULT_SNAPSHOT_AUTHOR_EMAIL
} = {}) {
  if (!worktreePath) {
    throw new Error("worktreePath is required to publish a workspace snapshot");
  }
  if (!snapshotRef) {
    throw new Error("snapshotRef is required to publish a workspace snapshot");
  }

  const canonicalRoot = await resolveCanonicalGitRoot(repoRoot);
  const statusResult = await run("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: worktreePath
  });
  const dirtyEntries = parseWorkspaceStatusLines(statusResult.stdout);
  const headBefore = await getWorkspaceHead({ worktreePath });
  let snapshotCommit = headBefore;
  let committed = false;

  if (dirtyEntries.length > 0) {
    await run("git", ["add", "--all"], { cwd: worktreePath });
    await run(
      "git",
      [
        "-c",
        `user.name=${authorName}`,
        "-c",
        `user.email=${authorEmail}`,
        "commit",
        "-m",
        commitMessage
      ],
      { cwd: worktreePath }
    );
    snapshotCommit = await getWorkspaceHead({ worktreePath });
    committed = true;
  }

  await run("git", ["update-ref", snapshotRef, snapshotCommit], { cwd: canonicalRoot });
  return {
    repoRoot: canonicalRoot,
    worktreePath: path.resolve(worktreePath),
    snapshotRef,
    snapshotCommit,
    headBefore,
    committed,
    dirtyEntryCount: dirtyEntries.length,
    createdAt: new Date().toISOString()
  };
}

export async function createWorkspaceFromSnapshot({
  repoRoot = PROJECT_ROOT,
  workspaceId,
  projectId = "default",
  ownerType = "execution-step",
  ownerId,
  snapshotRef = null,
  snapshotCommit = null,
  worktreeRoot = null,
  branchName = null,
  mode = "git-worktree",
  safeMode = true,
  mutationScope = []
} = {}) {
  const baseRef = snapshotCommit ?? snapshotRef;
  if (!baseRef) {
    throw new Error("snapshotRef or snapshotCommit is required to create a workspace from snapshot");
  }
  const workspace = await createWorkspace({
    repoRoot,
    workspaceId,
    projectId,
    ownerType,
    ownerId,
    baseRef,
    worktreeRoot,
    branchName,
    mode,
    safeMode,
    mutationScope
  });
  return {
    ...workspace,
    sourceRef: snapshotRef ?? null,
    sourceCommit: snapshotCommit ?? null
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
  const diagnostics = deriveWorkspaceDiagnostics({ inspection, allocation });
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
    inspection,
    diagnostics,
    commandHint: workspaceCommandHint({
      ...allocation,
      worktreePath: inspection.worktreePath
    })
  };
}

function classifyWorkspaceChange(code = "") {
  if (code === "??") return "untracked";
  if (code.includes("R")) return "renamed";
  if (code.includes("D")) return "deleted";
  if (code.includes("A")) return "added";
  if (code.includes("U")) return "conflicted";
  return "modified";
}

function matchMutationScope(filePath, mutationScope = []) {
  const normalizedPath = String(filePath ?? "").replace(/\\/g, "/");
  const scopes = Array.isArray(mutationScope) ? mutationScope.filter(Boolean) : [];
  for (const scope of scopes) {
    const normalizedScope = String(scope).replace(/\\/g, "/").replace(/\/+$/, "");
    if (!normalizedScope) {
      continue;
    }
    if (
      normalizedPath === normalizedScope ||
      normalizedPath.startsWith(`${normalizedScope}/`)
    ) {
      return normalizedScope;
    }
  }
  const rootSegment = normalizedPath.split("/")[0] ?? "unscoped";
  return rootSegment || "unscoped";
}

function parseWorkspaceStatusLines(output = "") {
  const entries = [];
  for (const rawLine of String(output).split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) {
      continue;
    }
    const code = line.slice(0, 2);
    const rawPath = line.slice(3).trim();
    const renameParts = rawPath.includes(" -> ") ? rawPath.split(" -> ") : null;
    const previousPath = renameParts ? renameParts[0] : null;
    const filePath = renameParts ? renameParts.at(-1) : rawPath;
    entries.push({
      path: filePath,
      previousPath,
      code,
      status: classifyWorkspaceChange(code),
      untracked: code === "??",
      conflicted: code.includes("U")
    });
  }
  return entries;
}

function parseNumstatLines(output = "") {
  const byPath = new Map();
  for (const rawLine of String(output).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const parts = line.split("\t");
    if (parts.length < 3) {
      continue;
    }
    const [insertionsRaw, deletionsRaw, ...pathParts] = parts;
    const filePath = pathParts.join("\t").trim();
    byPath.set(filePath, {
      insertions: insertionsRaw === "-" ? null : Number.parseInt(insertionsRaw, 10) || 0,
      deletions: deletionsRaw === "-" ? null : Number.parseInt(deletionsRaw, 10) || 0
    });
  }
  return byPath;
}

export async function summarizeWorkspaceChanges({ worktreePath, mutationScope = [] } = {}) {
  if (!worktreePath) {
    throw new Error("worktreePath is required to summarize workspace changes");
  }

  const [statusResult, numstatResult] = await Promise.all([
    run("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: worktreePath }),
    run("git", ["diff", "--numstat", "--find-renames", "HEAD"], { cwd: worktreePath }).catch(() => ({
      stdout: "",
      stderr: "",
      code: 0
    }))
  ]);

  const statusEntries = parseWorkspaceStatusLines(statusResult.stdout);
  const numstatByPath = parseNumstatLines(numstatResult.stdout);
  const files = statusEntries.map((entry) => {
    const numstat =
      numstatByPath.get(entry.path) ??
      (entry.previousPath ? numstatByPath.get(`${entry.previousPath} => ${entry.path}`) : null) ??
      null;
    const scope = matchMutationScope(entry.path, mutationScope);
    return {
      path: entry.path,
      previousPath: entry.previousPath,
      status: entry.status,
      code: entry.code,
      scope,
      insertions: numstat?.insertions ?? 0,
      deletions: numstat?.deletions ?? 0,
      untracked: entry.untracked,
      conflicted: entry.conflicted
    };
  });

  const byScope = new Map();
  const summary = {
    fileCount: files.length,
    trackedFileCount: files.filter((file) => !file.untracked).length,
    untrackedFileCount: files.filter((file) => file.untracked).length,
    addedCount: files.filter((file) => file.status === "added").length,
    modifiedCount: files.filter((file) => file.status === "modified").length,
    deletedCount: files.filter((file) => file.status === "deleted").length,
    renamedCount: files.filter((file) => file.status === "renamed").length,
    conflictedCount: files.filter((file) => file.conflicted).length,
    insertionCount: files.reduce((total, file) => total + (file.insertions ?? 0), 0),
    deletionCount: files.reduce((total, file) => total + (file.deletions ?? 0), 0)
  };

  for (const file of files) {
    const existing = byScope.get(file.scope) ?? {
      scope: file.scope,
      fileCount: 0,
      addedCount: 0,
      modifiedCount: 0,
      deletedCount: 0,
      renamedCount: 0,
      untrackedCount: 0,
      conflictedCount: 0,
      insertionCount: 0,
      deletionCount: 0,
      files: []
    };
    existing.fileCount += 1;
    existing.addedCount += file.status === "added" ? 1 : 0;
    existing.modifiedCount += file.status === "modified" ? 1 : 0;
    existing.deletedCount += file.status === "deleted" ? 1 : 0;
    existing.renamedCount += file.status === "renamed" ? 1 : 0;
    existing.untrackedCount += file.untracked ? 1 : 0;
    existing.conflictedCount += file.conflicted ? 1 : 0;
    existing.insertionCount += file.insertions ?? 0;
    existing.deletionCount += file.deletions ?? 0;
    existing.files.push(file);
    byScope.set(file.scope, existing);
  }

  return {
    ...summary,
    changedFiles: files,
    filesByScope: [...byScope.values()].sort((left, right) => left.scope.localeCompare(right.scope))
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
