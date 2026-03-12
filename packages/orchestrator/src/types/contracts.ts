import type { JsonObject, JsonValue } from "@spore/shared-types";

export interface FailureDescriptor {
  code: string;
  label: string;
  reason: string;
  source: string;
  finalState: string | null;
  infrastructure: boolean;
  recoverable: boolean;
  severity: string;
  failed: boolean;
}

export interface SuggestedAction {
  action: string;
  targetType: string | null;
  targetId: string | null;
  priority: string;
  reason: string;
  expectedOutcome: string | null;
  commandHint: string | null;
  httpHint: string | null;
}

export interface DependencyBlocker extends JsonObject {
  id?: string;
  reasonCode?: string | null;
  reason?: string | null;
  dependencyItemId?: string | null;
  strictness?: string | null;
}

export interface DependencyTransitionEntry extends JsonObject {
  id?: string;
  type?: string;
  timestamp?: string;
  state?: string | null;
  reasonCode?: string | null;
  reason?: string | null;
  itemId?: string | null;
  dependencyItemId?: string | null;
  blockerId?: string | null;
  strictness?: string | null;
  nextActionHint?: string | null;
  notes?: string | null;
}

export interface DependencyStatePayload extends JsonObject {
  state?: string | null;
  reasonCode?: string | null;
  reason?: string | null;
  nextActionHint?: string | null;
  blockerIds?: string[];
  blockers?: DependencyBlocker[];
  advisoryWarnings?: JsonValue[];
  incomingEdges?: JsonValue[];
  outgoingEdges?: JsonValue[];
  readyToRun?: boolean;
  transition?: DependencyTransitionEntry;
  status?: string;
  updatedAt?: string;
}

export interface PolicyContainer extends JsonObject {
  workflowPolicy: {
    maxAttemptsByRole?: Record<string, JsonValue>;
    defaultRoles?: JsonValue;
    reworkStrategy?: JsonValue;
    reworkRoles?: JsonValue;
    [key: string]: JsonValue | undefined;
  };
  runtimePolicy: {
    sessionModeByRole?: Record<string, JsonValue>;
    workspace?: JsonValue;
    [key: string]: JsonValue | undefined;
  };
  docsKbPolicy: {
    queryTerms?: string[];
    resultLimit?: JsonValue;
    queryTemplate?: JsonValue;
    [key: string]: JsonValue | undefined;
  };
  coordinationPolicy: {
    [key: string]: JsonValue | undefined;
  };
}

export interface PolicyPackReference extends JsonObject {
  id: string;
  path: string;
  config: JsonObject;
}

export interface WorkspaceAllocationListOptions extends JsonObject {
  status?: string;
  ownerType?: string;
  workItemId?: string;
  workItemRunId?: string;
  executionId?: string;
  stepId?: string;
  limit?: number | string;
}

export interface WorkflowHandoffListOptions extends JsonObject {
  executionId?: string;
  fromStepId?: string;
  toStepId?: string;
  sourceRole?: string;
  targetRole?: string;
  kind?: string;
  status?: string;
  limit?: number | string;
}

export interface WorkflowHandoffConsumerListOptions extends JsonObject {
  executionId?: string;
  handoffId?: string;
  consumerStepId?: string;
  consumerRole?: string;
  limit?: number | string;
}

export interface HandoffValidationIssue extends JsonObject {
  code: string;
  message: string;
  section?: string | null;
}

export interface HandoffValidationResult extends JsonObject {
  valid: boolean;
  degraded: boolean;
  mode?: string | null;
  issues: HandoffValidationIssue[];
}

export interface WorkspaceCleanupPolicy extends JsonObject {
  eligible: boolean;
  reason: string;
  blockedBy: string[];
  requiresForce: boolean;
}

export interface WorkspaceCleanupResult extends JsonObject {
  removed: boolean;
  skipped?: boolean;
  reason?: string;
}

export interface SelfBuildDecisionListOptions extends JsonObject {
  state?: string;
  targetType?: string;
  targetId?: string;
  limit?: number | string;
}

export interface OperatorThreadListOptions extends JsonObject {
  status?: string;
  projectId?: string;
  limit?: number | string;
}

export interface OperatorThreadActionListOptions extends JsonObject {
  threadId?: string;
  status?: string;
  actionKind?: string;
  targetType?: string;
  targetId?: string;
  limit?: number | string;
}

export interface QuarantineRecordListOptions extends JsonObject {
  status?: string;
  targetType?: string;
  limit?: number | string;
}

export interface RollbackRecordListOptions extends JsonObject {
  status?: string;
  targetType?: string;
  limit?: number | string;
}

export interface DocSuggestionRecordListOptions extends JsonObject {
  status?: string;
  workItemId?: string;
  workItemRunId?: string;
  proposalArtifactId?: string;
  kind?: string;
  limit?: number | string;
}

export interface SelfBuildIntakeListOptions extends JsonObject {
  status?: string;
  sourceType?: string;
  kind?: string;
  priority?: string;
  projectId?: string;
  limit?: number | string;
}

export interface SelfBuildOverrideListOptions extends JsonObject {
  status?: string;
  targetType?: string;
  targetId?: string;
  kind?: string;
  limit?: number | string;
}

export interface PolicyRecommendationReviewListOptions extends JsonObject {
  status?: string;
  recommendationId?: string;
  limit?: number | string;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function asJsonObject(
  value: unknown,
  fallback: JsonObject = {},
): JsonObject {
  return isJsonObject(value) ? value : fallback;
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
}
