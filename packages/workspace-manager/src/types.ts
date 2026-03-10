export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface CommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface BuildWorkspaceBranchNameOptions {
  projectId?: string;
  ownerType?: string;
  ownerId: string;
}

export interface BuildWorkspacePathOptions {
  projectId?: string;
  workspaceId: string;
  worktreeRoot?: string;
}

export interface BuildWorkspaceSnapshotRefOptions {
  projectId?: string;
  executionId?: string | number | null;
  stepId: string | number;
  attemptCount?: string | number;
}

export interface GitWorktreeEntry {
  path: string;
  head: string | null;
  branch: string | null;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
  isCanonicalRoot: boolean;
}

export interface ListGitWorktreesOptions {
  repoRoot?: string;
}

export interface InspectWorkspaceOptions {
  repoRoot?: string;
  worktreePath: string;
  branchName?: string | null;
}

export interface WorkspaceInspection {
  repoRoot: string;
  worktreePath: string;
  exists: boolean;
  registered: boolean;
  clean: boolean;
  statusSummary: string;
  branchName: string | null;
  branchMatches: boolean | null;
  head: string | null;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
  isCanonicalRoot: boolean;
  porcelain: string[];
  issues: string[];
}

export interface WorkspaceAllocation {
  id?: string | null;
  worktreePath?: string;
  branchName?: string | null;
  status?: string | null;
  [key: string]: unknown;
}

export interface DeriveWorkspaceDiagnosticsOptions {
  inspection?: WorkspaceInspection | null;
  allocation?: WorkspaceAllocation | null;
}

export interface WorkspaceDiagnostics {
  state: string;
  healthy: boolean;
  issues: string[];
  recommendedAction: string;
  registered: boolean;
  exists: boolean;
  clean: boolean;
  branchMatches: boolean | null;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
  porcelainCount: number;
}

export interface CreateWorkspaceOptions {
  repoRoot?: string;
  workspaceId: string;
  projectId?: string;
  ownerType?: string;
  ownerId: string;
  baseRef?: string;
  worktreeRoot?: string | null;
  branchName?: string | null;
  mode?: string;
  safeMode?: boolean;
  mutationScope?: string[];
}

export interface WorkspaceRecord {
  id: string;
  repoRoot: string;
  worktreePath: string;
  branchName: string;
  baseRef: string;
  mode: string;
  safeMode: boolean;
  mutationScope: string[];
}

export interface PublishWorkspaceSnapshotOptions {
  repoRoot?: string;
  worktreePath: string;
  snapshotRef: string;
  commitMessage?: string;
  authorName?: string;
  authorEmail?: string;
}

export interface WorkspaceSnapshotPublication {
  repoRoot: string;
  worktreePath: string;
  snapshotRef: string;
  snapshotCommit: string;
  headBefore: string;
  committed: boolean;
  dirtyEntryCount: number;
  createdAt: string;
}

export interface CreateWorkspaceFromSnapshotOptions
  extends Omit<CreateWorkspaceOptions, "baseRef"> {
  snapshotRef?: string | null;
  snapshotCommit?: string | null;
}

export interface SnapshotWorkspaceRecord extends WorkspaceRecord {
  sourceRef: string | null;
  sourceCommit: string | null;
}

export interface RemoveWorkspaceOptions {
  repoRoot?: string;
  worktreePath: string;
  force?: boolean;
  branchName?: string | null;
  keepBranch?: boolean;
}

export interface RemoveWorkspaceResult {
  repoRoot: string;
  worktreePath: string;
  removed: boolean;
  forced: boolean;
  branchName: string | null;
  keepBranch: boolean;
}

export interface ReconcileWorkspaceOptions {
  repoRoot?: string;
  allocation: WorkspaceAllocation;
}

export interface ReconcileWorkspaceResult {
  allocationId: string | null;
  status: string;
  inspection: WorkspaceInspection;
  diagnostics: WorkspaceDiagnostics;
  commandHint: string;
}

export type WorkspaceChangeStatus =
  | "untracked"
  | "renamed"
  | "deleted"
  | "added"
  | "conflicted"
  | "modified";

export interface WorkspaceStatusEntry {
  path: string;
  previousPath: string | null;
  code: string;
  status: WorkspaceChangeStatus;
  untracked: boolean;
  conflicted: boolean;
}

export interface WorkspaceNumstatEntry {
  insertions: number | null;
  deletions: number | null;
}

export interface WorkspaceChangeEntry extends WorkspaceStatusEntry {
  scope: string;
  insertions: number;
  deletions: number;
}

export interface WorkspaceScopeSummary {
  scope: string;
  fileCount: number;
  addedCount: number;
  modifiedCount: number;
  deletedCount: number;
  renamedCount: number;
  untrackedCount: number;
  conflictedCount: number;
  insertionCount: number;
  deletionCount: number;
  files: WorkspaceChangeEntry[];
}

export interface WorkspaceChangeSummary {
  fileCount: number;
  trackedFileCount: number;
  untrackedFileCount: number;
  addedCount: number;
  modifiedCount: number;
  deletedCount: number;
  renamedCount: number;
  conflictedCount: number;
  insertionCount: number;
  deletionCount: number;
  changedFiles: WorkspaceChangeEntry[];
  filesByScope: WorkspaceScopeSummary[];
}

export interface SummarizeWorkspaceChangesOptions {
  worktreePath: string;
  mutationScope?: string[];
}

export interface WriteWorkspacePatchArtifactOptions {
  worktreePath: string;
  outputPath: string;
}

export interface WorkspacePatchArtifact {
  outputPath: string;
  byteLength: number;
}

export interface WorkspaceShellSummaryTarget {
  id?: string | null;
  worktreePath?: string | null;
  branchName?: string | null;
  baseRef?: string | null;
  safeMode?: boolean;
  mutationScope?: string[] | null;
}

export interface ParsedArgs<
  TFlags extends Record<string, string | boolean | undefined>,
> {
  positional: string[];
  flags: TFlags;
}
