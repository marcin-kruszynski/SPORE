import type { JsonObject, JsonValue } from "@spore/shared-types";

interface ProposalLike extends JsonObject {
  id: string;
  status?: string;
  metadata?: JsonObject & {
    promotion?: JsonObject & {
      status?: JsonValue;
    };
  };
}

interface LearningLike extends JsonObject {
  id: string;
}

interface WorkspaceLike extends JsonObject {
  id: string;
  worktreePath?: string;
}

export function proposalLinks(artifactId: string) {
  return {
    self: `/proposal-artifacts/${encodeURIComponent(artifactId)}`,
    reviewPackage: `/proposal-artifacts/${encodeURIComponent(artifactId)}/review-package`,
    review: `/proposal-artifacts/${encodeURIComponent(artifactId)}/review`,
    approval: `/proposal-artifacts/${encodeURIComponent(artifactId)}/approval`,
    promotionPlan: `/proposal-artifacts/${encodeURIComponent(artifactId)}/promotion-plan`,
    promotionInvoke: `/proposal-artifacts/${encodeURIComponent(artifactId)}/promotion-invoke`,
  };
}

export function workspaceLinks(workspaceId: string) {
  return {
    self: `/workspaces/${encodeURIComponent(workspaceId)}`,
  };
}

export function buildProposalSummary<T extends ProposalLike | null>(
  artifact: T,
) {
  if (!artifact) {
    return null;
  }
  const promotion = artifact.metadata?.promotion ?? null;
  return {
    ...artifact,
    promotionStatus: promotion?.status ?? null,
    promotion,
    reworkHistory: Array.isArray(artifact.metadata?.reworkHistory)
      ? artifact.metadata.reworkHistory
      : [],
    links: proposalLinks(artifact.id),
  };
}

export function getProposalPromotionState(
  proposal: ProposalLike | null | undefined,
) {
  return proposal?.metadata?.promotion?.status ?? null;
}

export function isProposalPromotionPending(
  proposal: ProposalLike | null | undefined,
) {
  const promotionState = String(getProposalPromotionState(proposal) ?? "");
  if (!proposal) {
    return false;
  }
  if (proposal.status === "approved" && !promotionState) {
    return true;
  }
  return [
    "ready_for_promotion",
    "promotion_candidate",
    "blocked",
    "policy_waiting_approval",
  ].includes(promotionState);
}

export function buildLearningSummary<T extends LearningLike | null>(record: T) {
  return record
    ? {
        ...record,
        links: {
          self: `/learning-records/${encodeURIComponent(record.id)}`,
        },
      }
    : null;
}

export function buildWorkspaceSummary<T extends WorkspaceLike | null>(
  allocation: T,
) {
  return allocation
    ? {
        ...allocation,
        links: workspaceLinks(allocation.id),
        commandHint: `cd '${allocation.worktreePath}' && git status --short && git branch --show-current`,
      }
    : null;
}
