import type { MissionEvidenceTarget } from "../types/self-build.js";
import { toText } from "./adapter-utils.js";

export function buildEvidenceHref(target: MissionEvidenceTarget): string {
  const base = `/evidence/${encodeURIComponent(target.kind)}/${encodeURIComponent(target.id)}`;
  if (!target.subject) {
    return base;
  }

  const params = new URLSearchParams({ subject: target.subject });
  return `${base}?${params.toString()}`;
}

export function resolveMissionEvidenceTargetFromArtifact(input: {
  itemType?: string | null;
  itemId?: string | null;
}): MissionEvidenceTarget | null {
  const itemType = toText(input.itemType, "");
  const itemId = toText(input.itemId, "");

  if (!itemType || !itemId) {
    return null;
  }

  if (itemType === "proposal") {
    return { kind: "proposal", id: itemId };
  }
  if (itemType === "work-item-run") {
    return { kind: "validation", id: itemId, subject: "run" };
  }
  if (itemType === "workspace") {
    return { kind: "workspace", id: itemId, subject: "workspace" };
  }
  if (itemType === "integration-branch") {
    return { kind: "promotion", id: itemId, subject: "branch" };
  }

  return null;
}

export function resolveMissionEvidenceTargetFromThreadEvidence(
  key: string,
  value: Record<string, unknown>,
): MissionEvidenceTarget | null {
  const id = toText(value.id, "");

  if (key === "proposal" && id) {
    return { kind: "proposal", id };
  }
  if (key === "latestRun" && id) {
    return { kind: "validation", id, subject: "run" };
  }

  if (key === "validation") {
    const targetType = toText(value.targetType, "");
    const targetId = toText(value.targetId, "");
    if (targetType === "work-item-run" && targetId) {
      return { kind: "validation", id: targetId, subject: "run" };
    }
  }

  if (key === "promotion") {
    const branchName = toText(value.integrationBranch, "");
    if (branchName) {
      return { kind: "promotion", id: branchName, subject: "branch" };
    }
  }

  return null;
}
