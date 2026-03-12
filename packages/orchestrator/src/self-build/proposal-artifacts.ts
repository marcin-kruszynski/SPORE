import fs from "node:fs/promises";
import path from "node:path";
import {
  summarizeWorkspaceChanges,
  writeWorkspacePatchArtifact,
} from "@spore/workspace-manager";
import { PROJECT_ROOT } from "../metadata/constants.js";

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

export function buildChangedFilesByScope(diffSummary = null) {
  if (!diffSummary || !Array.isArray(diffSummary.filesByScope)) {
    return [];
  }
  return diffSummary.filesByScope.map((entry) => ({
    scope: entry.scope,
    fileCount: entry.fileCount,
    addedCount: entry.addedCount,
    modifiedCount: entry.modifiedCount,
    deletedCount: entry.deletedCount,
    renamedCount: entry.renamedCount,
    untrackedCount: entry.untrackedCount,
    conflictedCount: entry.conflictedCount,
    insertionCount: entry.insertionCount,
    deletionCount: entry.deletionCount,
    files: entry.files.map((file) => ({
      path: file.path,
      previousPath: file.previousPath ?? null,
      status: file.status,
      insertions: file.insertions ?? 0,
      deletions: file.deletions ?? 0,
    })),
  }));
}

export async function attachWorkspacePatchArtifact(
  proposal,
  workspace,
  nowIso,
) {
  if (!proposal || !workspace?.worktreePath) {
    return proposal;
  }
  const patchPath = path.join(
    PROJECT_ROOT,
    "artifacts",
    "proposals",
    `${proposal.id}.patch`,
  );
  const [patchArtifact, diffSummary] = await Promise.all([
    writeWorkspacePatchArtifact({
      worktreePath: workspace.worktreePath,
      outputPath: patchPath,
    }),
    summarizeWorkspaceChanges({
      worktreePath: workspace.worktreePath,
      mutationScope: workspace.mutationScope ?? [],
    }),
  ]);
  const patchPreview = await fs
    .readFile(patchArtifact.outputPath, "utf8")
    .then((content) =>
      content.split(/\r?\n/).slice(0, 40).join("\n").slice(0, 4000),
    )
    .catch(() => "");
  return {
    ...proposal,
    artifacts: {
      ...(proposal.artifacts ?? {}),
      proposedFiles:
        Array.isArray(diffSummary?.changedFiles) &&
        diffSummary.changedFiles.length > 0
          ? diffSummary.changedFiles.map((file) => ({
              path: file.path,
              previousPath: file.previousPath ?? null,
              scope: file.scope ?? null,
              status: file.status,
              insertions: file.insertions ?? 0,
              deletions: file.deletions ?? 0,
            }))
          : (proposal.artifacts?.proposedFiles ?? []),
      workspace: {
        workspaceId: workspace.id,
        worktreePath: workspace.worktreePath,
        branchName: workspace.branchName,
        baseRef: workspace.baseRef,
        status: workspace.status,
        mutationScope: workspace.mutationScope ?? [],
      },
      patchArtifact: {
        path: path.relative(PROJECT_ROOT, patchArtifact.outputPath),
        byteLength: patchArtifact.byteLength,
        preview: patchPreview,
      },
      diffSummary,
      changedFilesByScope: buildChangedFilesByScope(diffSummary),
    },
    metadata: {
      ...(proposal.metadata ?? {}),
      workspaceId: workspace.id,
    },
    updatedAt: nowIso(),
  };
}

export function buildProposalArtifacts(
  item,
  validation = null,
  workspace = null,
  workItemKindRequiresProposal,
) {
  const changeSummary = item.goal || `Proposal generated for ${item.title}`;
  const mutationScope = asArray(item.metadata?.mutationScope);
  const diffSummary = workspace?.metadata?.diffSummary ?? null;
  return {
    changeSummary,
    proposedFiles:
      Array.isArray(diffSummary?.changedFiles) &&
      diffSummary.changedFiles.length > 0
        ? diffSummary.changedFiles.map((file) => ({
            path: file.path,
            previousPath: file.previousPath ?? null,
            scope: file.scope ?? null,
            status: file.status,
            insertions: file.insertions ?? 0,
            deletions: file.deletions ?? 0,
          }))
        : mutationScope.map((scope) => ({ scope, status: "planned" })),
    diffSummary: diffSummary
      ? {
          fileCount: diffSummary.fileCount,
          trackedFileCount: diffSummary.trackedFileCount,
          untrackedFileCount: diffSummary.untrackedFileCount,
          addedCount: diffSummary.addedCount,
          modifiedCount: diffSummary.modifiedCount,
          deletedCount: diffSummary.deletedCount,
          renamedCount: diffSummary.renamedCount,
          conflictedCount: diffSummary.conflictedCount,
          insertionCount: diffSummary.insertionCount,
          deletionCount: diffSummary.deletionCount,
        }
      : {
          fileCount: 0,
          trackedFileCount: 0,
          untrackedFileCount: 0,
          addedCount: 0,
          modifiedCount: 0,
          deletedCount: 0,
          renamedCount: 0,
          conflictedCount: 0,
          insertionCount: 0,
          deletionCount: 0,
        },
    changedFilesByScope:
      Array.isArray(diffSummary?.filesByScope) &&
      diffSummary.filesByScope.length > 0
        ? buildChangedFilesByScope(diffSummary)
        : mutationScope.map((scope) => ({
            scope,
            fileCount: 0,
            addedCount: 0,
            modifiedCount: 0,
            deletedCount: 0,
            renamedCount: 0,
            untrackedCount: 0,
            conflictedCount: 0,
            insertionCount: 0,
            deletionCount: 0,
            files: [],
          })),
    testSummary: validation
      ? {
          validationStatus: validation.status ?? null,
          scenarioRunIds: validation.scenarioRunIds ?? [],
          regressionRunIds: validation.regressionRunIds ?? [],
        }
      : {
          validationStatus: "pending",
          scenarioRunIds: [],
          regressionRunIds: [],
        },
    reviewNotes: {
      requiredReview: true,
      requiredApproval:
        item.metadata?.requiresHumanApproval ??
        workItemKindRequiresProposal(item),
      safeMode: item.metadata?.safeMode !== false,
    },
    handoffSnapshot: workspace?.metadata?.handoff
      ? {
          snapshotRef: workspace.metadata.handoff.snapshotRef ?? null,
          snapshotCommit: workspace.metadata.handoff.snapshotCommit ?? null,
          publishedAt: workspace.metadata.handoff.publishedAt ?? null,
          committed: workspace.metadata.handoff.committed ?? null,
        }
      : null,
    docImpact: {
      relatedDocs: item.relatedDocs ?? [],
      relatedScenarios: item.relatedScenarios ?? [],
      relatedRegressions: item.relatedRegressions ?? [],
    },
  };
}

export function buildWorkflowHandoffRefs(handoffs = []) {
  return asArray(handoffs).map((handoff) => ({
    id: handoff.id,
    kind: handoff.kind,
    status: handoff.status,
    sourceRole: handoff.sourceRole,
    targetRole: handoff.targetRole ?? null,
    fromStepId: handoff.fromStepId,
    toStepId: handoff.toStepId ?? null,
    summary:
      handoff.summary && typeof handoff.summary === "object"
        ? handoff.summary
        : {},
    artifacts:
      handoff.artifacts && typeof handoff.artifacts === "object"
        ? handoff.artifacts
        : {},
    updatedAt: handoff.updatedAt ?? null,
  }));
}

export function buildDocSuggestions(item, run, proposal = null) {
  const suggestions = [];
  if (
    (item.relatedDocs ?? []).length > 0 ||
    item.metadata?.mutationScope?.includes("docs")
  ) {
    suggestions.push({
      kind: "runbook-update",
      targetPath: "docs/runbooks/local-dev.md",
      summary: `Update operator instructions after work item ${item.id}.`,
    });
  }
  if (proposal) {
    suggestions.push({
      kind: "readme-update",
      targetPath: "README.md",
      summary: `Review README impact for proposal artifact ${proposal.id}.`,
    });
    suggestions.push({
      kind: "docs-index-update",
      targetPath: "docs/INDEX.md",
      summary: `Update docs navigation after proposal artifact ${proposal.id}.`,
    });
  }
  if (run.status === "failed") {
    suggestions.push({
      kind: "adr-candidate",
      targetPath: "docs/decisions/",
      summary: `Capture failure pattern from work item run ${run.id}.`,
    });
  }
  return suggestions;
}
