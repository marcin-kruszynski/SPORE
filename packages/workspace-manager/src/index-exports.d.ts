declare module "@spore/workspace-manager" {
  export type {
    CreateWorkspaceOptions,
    RemoveWorkspaceOptions,
  } from "./types.js";
  export {
    buildWorkspaceBranchName,
    buildWorkspaceSnapshotRef,
    createWorkspace,
    createWorkspaceFromSnapshot,
    deriveWorkspaceDiagnostics,
    inspectWorkspace,
    publishWorkspaceSnapshot,
    reconcileWorkspace,
    removeWorkspace,
    summarizeWorkspaceChanges,
    writeWorkspacePatchArtifact,
  } from "./manager.js";
}
