import type { JsonObject, JsonValue } from "@spore/shared-types";

export interface WorkflowEventOptions {
  executionId: string;
  stepId?: string | null;
  sessionId?: string | null;
  type: string;
  payload?: JsonObject;
}

export interface AuditEventOptions {
  executionId: string;
  stepId?: string | null;
  sessionId?: string | null;
  action: string;
  actor?: string;
  source?: string;
  targetType?: string;
  targetId?: string | null;
  payload?: JsonObject;
  result?: string | JsonObject;
}

export interface AuditContext {
  actor: string;
  source: string;
}

export interface PromotionSummary extends JsonObject {
  status: string | null;
  targetBranch: string | null;
  integrationBranch: string | null;
  sourceCount: number;
  blockers: JsonValue[];
  sourceSummary: JsonValue | null;
  mergeAllowed: boolean;
}

export function asEventPayload(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as JsonObject;
}

export function buildAuditContext(payload: JsonObject = {}): AuditContext {
  return {
    actor:
      String(payload.decidedBy ?? payload.by ?? payload.owner ?? "operator") ||
      "operator",
    source: String(payload.source ?? "orchestrator") || "orchestrator",
  };
}

export function buildEscalationEventPayload(
  escalationId: string,
  targetRole: string | null,
  reason: string,
  payload: JsonObject = {},
): JsonObject {
  return {
    escalationId,
    targetRole,
    reason,
    ...payload,
  };
}

export function normalizePromotionSummary(
  summary: JsonObject = {},
): PromotionSummary {
  const blockers = Array.isArray(summary.blockers) ? summary.blockers : [];
  const sourceCount = Number(summary.sourceCount ?? 0);
  return {
    status: String(summary.status ?? "") || null,
    targetBranch: String(summary.targetBranch ?? "") || null,
    integrationBranch: String(summary.integrationBranch ?? "") || null,
    sourceCount: Number.isFinite(sourceCount) ? sourceCount : 0,
    blockers,
    sourceSummary: (summary.sourceSummary as JsonValue | undefined) ?? null,
    mergeAllowed: summary.mergeAllowed === true,
  };
}
