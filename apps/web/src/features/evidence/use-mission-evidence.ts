import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { ApiError } from "../../lib/api/http.js";
import { getIntegrationBranch } from "../../lib/api/integration-branches.js";
import {
  getProposalArtifact,
  getProposalReviewPackage,
} from "../../lib/api/proposal-artifacts.js";
import {
  getRegressionReport,
  getRegressionRun,
  getScenarioRun,
  getWorkItemRun,
  getWorkItemRunProposal,
  getWorkItemRunWorkspace,
} from "../../lib/api/validation-runs.js";
import { getWorkspace } from "../../lib/api/workspaces.js";
import {
  adaptMissionEvidenceDetail,
  buildEvidenceHref,
  resolveMissionEvidenceTargetFromArtifact,
  resolveMissionEvidenceTargetFromThreadEvidence,
} from "../../adapters/self-build.js";
import type {
  MissionEvidenceKind,
  MissionEvidenceSubject,
  MissionEvidenceTarget,
} from "../../types/self-build.js";

function toText(value: unknown, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function resolveRunId(input: {
  run?: { id?: string | null } | null;
  proposalReviewPackage?: { workItemRun?: Record<string, unknown> | null } | null;
}) {
  return (
    toText(input.run?.id, "") ||
    toText(asRecord(input.proposalReviewPackage?.workItemRun).id, "") ||
    ""
  );
}

function resolveWorkspaceId(input: {
  workspace?: { id?: string | null } | null;
  run?: { workspace?: { id?: string | null } | null } | null;
  proposalReviewPackage?: { workspace?: Record<string, unknown> | null } | null;
}) {
  return (
    toText(input.workspace?.id, "") ||
    toText(input.run?.workspace?.id, "") ||
    toText(asRecord(input.proposalReviewPackage?.workspace).id, "") ||
    ""
  );
}

function resolveProposalId(input: {
  proposal?: { id?: string | null } | null;
  run?: { proposal?: { id?: string | null } | null } | null;
  workspace?: { proposalArtifactId?: string | null } | null;
  proposalReviewPackage?: { proposal?: { id?: string | null } | null } | null;
}) {
  return (
    toText(input.proposal?.id, "") ||
    toText(input.run?.proposal?.id, "") ||
    toText(input.workspace?.proposalArtifactId, "") ||
    toText(input.proposalReviewPackage?.proposal?.id, "") ||
    ""
  );
}

async function optional<T>(loader: () => Promise<T>) {
  try {
    return await loader();
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Evidence is unavailable.";
}

export async function loadProposalBackedContext(options: {
  proposalId?: string | null;
  proposal?: Awaited<ReturnType<typeof getProposalArtifact>> | null;
  proposalReviewPackage?: Awaited<ReturnType<typeof getProposalReviewPackage>> | null;
  integrationBranch?: Awaited<ReturnType<typeof getIntegrationBranch>> | null;
  run?: Awaited<ReturnType<typeof getWorkItemRun>> | null;
  workspace?: Awaited<ReturnType<typeof getWorkspace>> | null;
}) {
  let proposal = options.proposal;
  let proposalReviewPackage = options.proposalReviewPackage;
  let run = options.run;
  let workspace = options.workspace;
  let integrationBranch = options.integrationBranch;

  for (;;) {
    let progressed = false;

    const proposalId = toText(
      options.proposalId,
      resolveProposalId({
        proposal,
        run,
        workspace,
        proposalReviewPackage,
      }),
    );

    if (proposal === undefined && proposalId) {
      proposal = await optional(() => getProposalArtifact(proposalId));
      progressed = true;
    }

    if (proposalReviewPackage === undefined && proposalId) {
      proposalReviewPackage = await optional(() => getProposalReviewPackage(proposalId));
      progressed = true;
    }

    const runId = resolveRunId({
      run,
      proposalReviewPackage,
    });

    if (run === undefined && runId) {
      run = await optional(() => getWorkItemRun(runId));
      progressed = true;
    }

    const workspaceId = resolveWorkspaceId({
      workspace,
      run,
      proposalReviewPackage,
    });

    if (workspace === undefined && workspaceId) {
      workspace = await optional(() => getWorkspace(workspaceId));
      progressed = true;
    }

    const branchName =
      toText(integrationBranch?.name, "") ||
      toText(proposalReviewPackage?.promotion?.integrationBranch, "");

    if (integrationBranch === undefined && branchName) {
      integrationBranch = await optional(() => getIntegrationBranch(branchName));
      progressed = true;
    }

    if (!progressed) {
      break;
    }
  }

  return {
    proposal: proposal ?? null,
    proposalReviewPackage: proposalReviewPackage ?? null,
    run: run ?? null,
    workspace: workspace ?? null,
    integrationBranch: integrationBranch ?? null,
  };
}

async function loadMissionEvidence(target: MissionEvidenceTarget) {
  if (target.kind === "proposal") {
    const context = await loadProposalBackedContext({
      proposalId: target.id,
    });

    return adaptMissionEvidenceDetail({
      kind: "proposal",
      id: target.id,
      subject: target.subject,
      ...context,
    });
  }

  if (target.kind === "validation") {
    const run = await getWorkItemRun(target.id);
    const scenarioRunId =
      run.relationSummary?.scenarioRunId ??
      run.validation?.scenarioRunIds?.[0] ??
      null;
    const regressionRunId =
      run.relationSummary?.regressionRunId ??
      run.validation?.regressionRunIds?.[0] ??
      null;

    const [proposalFromRun, workspaceFromRun, scenarioRun, regressionRun, regressionReport] =
      await Promise.all([
        optional(() => getWorkItemRunProposal(target.id)),
        optional(() => getWorkItemRunWorkspace(target.id)),
        scenarioRunId ? optional(() => getScenarioRun(scenarioRunId)) : Promise.resolve(null),
        regressionRunId ? optional(() => getRegressionRun(regressionRunId)) : Promise.resolve(null),
        regressionRunId
          ? optional(() => getRegressionReport(regressionRunId))
          : Promise.resolve(null),
      ]);

    const context = await loadProposalBackedContext({
      run,
      proposal: proposalFromRun ?? undefined,
      workspace: workspaceFromRun ?? undefined,
      proposalReviewPackage: run.proposal?.id
        ? await optional(() => getProposalReviewPackage(String(run.proposal?.id ?? "")))
        : undefined,
    });

    return adaptMissionEvidenceDetail({
      kind: "validation",
      id: target.id,
      subject: target.subject,
      run,
      proposal: context.proposal,
      proposalReviewPackage: context.proposalReviewPackage,
      workspace: context.workspace,
      integrationBranch: context.integrationBranch,
      scenarioRun,
      regressionRun,
      regressionReport,
    });
  }

  if (target.kind === "promotion") {
    const integrationBranch = await getIntegrationBranch(target.id);
    const context = await loadProposalBackedContext({
      proposalId: toText(integrationBranch.proposalArtifactId, ""),
      integrationBranch,
    });

    return adaptMissionEvidenceDetail({
      kind: "promotion",
      id: target.id,
      subject: target.subject,
      ...context,
    });
  }

  const workspace = await getWorkspace(target.id);
  const run = workspace.workItemRunId
    ? await optional(() => getWorkItemRun(String(workspace.workItemRunId ?? "")))
    : null;
  const fallbackProposal =
    run || !workspace.workItemRunId
      ? undefined
      : await optional(() => getWorkItemRunProposal(String(workspace.workItemRunId ?? "")));
  const context = await loadProposalBackedContext({
    workspace,
    run,
    proposal: fallbackProposal,
  });

  return adaptMissionEvidenceDetail({
    kind: "workspace",
    id: target.id,
    subject: target.subject,
    ...context,
  });
}

export function useMissionEvidence(target: MissionEvidenceTarget | null) {
  const query = useQuery({
    queryKey: ["mission-evidence", target?.kind ?? "none", target?.id ?? "", target?.subject ?? ""],
    enabled: Boolean(target?.id),
    queryFn: () => loadMissionEvidence(target as MissionEvidenceTarget),
  });

  const detail = useMemo(() => query.data ?? null, [query.data]);

  return {
    detail,
    isLoading: query.isLoading,
    errorMessage: query.error ? getErrorMessage(query.error) : null,
    retry: () => query.refetch(),
  };
}

export {
  buildEvidenceHref,
  resolveMissionEvidenceTargetFromArtifact,
  resolveMissionEvidenceTargetFromThreadEvidence,
};

export function toMissionEvidenceTarget(
  kind: string | undefined,
  id: string | undefined,
  subject?: string | null,
): MissionEvidenceTarget | null {
  const normalizedKind = String(kind ?? "").trim() as MissionEvidenceKind;
  const normalizedId = String(id ?? "").trim();
  const normalizedSubject = String(subject ?? "").trim() as MissionEvidenceSubject;

  if (!normalizedId) {
    return null;
  }

  if (!["proposal", "validation", "promotion", "workspace"].includes(normalizedKind)) {
    return null;
  }

  if (normalizedKind === "promotion" && normalizedSubject !== "branch") {
    return null;
  }

  return {
    kind: normalizedKind,
    id: normalizedId,
    subject: normalizedSubject || undefined,
  };
}
