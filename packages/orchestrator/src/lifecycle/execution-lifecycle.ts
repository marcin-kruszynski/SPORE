import crypto from "node:crypto";

type LooseRecord = Record<string, unknown>;

function now() {
  return new Date().toISOString();
}

export function createExecutionRecord(invocation): LooseRecord {
  const timestamp = now();
  return {
    id: invocation.invocationId,
    workflowId: invocation.workflow.id,
    workflowName: invocation.workflow.name,
    workflowPath: invocation.workflow.path,
    projectId: invocation.project.id,
    projectName: invocation.project.name,
    projectPath: invocation.project.path,
    domainId: invocation.domain?.id ?? null,
    coordinationGroupId:
      invocation.coordination?.groupId ?? invocation.invocationId,
    parentExecutionId: invocation.coordination?.parentExecutionId ?? null,
    branchKey: invocation.coordination?.branchKey ?? null,
    policy: invocation.effectivePolicy ?? {},
    metadata:
      invocation.metadata?.invocationMetadata ?? invocation.metadata ?? {},
    objective: invocation.objective ?? "",
    state: "planned",
    reviewStatus: null,
    approvalStatus: null,
    heldFromState: null,
    holdReason: null,
    holdOwner: null,
    holdGuidance: null,
    holdExpiresAt: null,
    pausedAt: null,
    heldAt: null,
    resumedAt: null,
    currentStepIndex: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: null,
    endedAt: null,
  };
}

export function createStepRecord(executionId, launch, sequence): LooseRecord {
  const timestamp = now();
  const isReviewer = launch.role === "reviewer";
  const reviewRequired = launch.reviewRequired ?? isReviewer;
  const approvalRequired = launch.approvalRequired ?? reviewRequired;
  return {
    id: `${executionId}:step:${sequence + 1}`,
    executionId,
    sequence,
    wave: launch.wave ?? sequence,
    waveName: launch.waveName ?? `wave-${(launch.wave ?? sequence) + 1}`,
    role: launch.role,
    requestedProfileId: launch.requestedProfileId,
    profilePath: launch.profilePath,
    sessionId: launch.sessionId,
    parentSessionId: null,
    sessionMode: launch.sessionMode ?? null,
    policy: launch.policy ?? {},
    state: "planned",
    attemptCount: 1,
    maxAttempts: launch.maxAttempts ?? 1,
    lastError: null,
    reviewRequired,
    reviewStatus: reviewRequired ? "pending" : null,
    approvalRequired,
    approvalStatus: approvalRequired ? "pending" : null,
    objective: launch.objective ?? "",
    createdAt: timestamp,
    updatedAt: timestamp,
    launchedAt: null,
    settledAt: null,
  };
}

export function transitionExecutionRecord(
  record: LooseRecord,
  nextState: string,
  overrides: LooseRecord = {},
): LooseRecord {
  const timestamp = now();
  const settled = ["completed", "failed", "rejected", "canceled"].includes(
    nextState,
  );
  const pausedAt = Object.hasOwn(overrides, "pausedAt")
    ? overrides.pausedAt
    : nextState === "paused"
      ? timestamp
      : record.pausedAt;
  const heldAt = Object.hasOwn(overrides, "heldAt")
    ? overrides.heldAt
    : nextState === "held"
      ? timestamp
      : record.heldAt;
  const resumedAt = Object.hasOwn(overrides, "resumedAt")
    ? overrides.resumedAt
    : nextState === "running" &&
        ["paused", "held"].includes(String(record.state ?? ""))
      ? timestamp
      : record.resumedAt;
  const startedAt = Object.hasOwn(overrides, "startedAt")
    ? overrides.startedAt
    : (record.startedAt ??
      (nextState === "running" ? timestamp : record.startedAt));
  const endedAt = Object.hasOwn(overrides, "endedAt")
    ? overrides.endedAt
    : settled
      ? timestamp
      : record.endedAt;
  return {
    ...record,
    ...overrides,
    state: nextState,
    pausedAt,
    heldAt,
    resumedAt,
    startedAt,
    endedAt,
    updatedAt: timestamp,
  };
}

export function transitionStepRecord(
  record: LooseRecord,
  nextState: string,
  overrides: LooseRecord = {},
): LooseRecord {
  const timestamp = now();
  const settled = [
    "completed",
    "failed",
    "stopped",
    "review_pending",
    "approval_pending",
    "rejected",
  ].includes(nextState);
  const launchedAt = Object.hasOwn(overrides, "launchedAt")
    ? overrides.launchedAt
    : (record.launchedAt ??
      (["launching", "active"].includes(nextState)
        ? timestamp
        : record.launchedAt));
  const settledAt = Object.hasOwn(overrides, "settledAt")
    ? overrides.settledAt
    : settled
      ? timestamp
      : record.settledAt;
  return {
    ...record,
    ...overrides,
    state: nextState,
    launchedAt,
    settledAt,
    updatedAt: timestamp,
  };
}

export function createWorkflowEventRecord({
  executionId,
  stepId = null,
  sessionId = null,
  type,
  payload,
}): LooseRecord {
  return {
    id: crypto.randomUUID(),
    executionId,
    stepId,
    sessionId,
    type,
    payload: payload ?? {},
    createdAt: now(),
  };
}

export function createEscalationRecord({
  executionId,
  stepId = null,
  sourceStepId = null,
  targetRole = "lead",
  reason,
  status = "open",
  payload,
}): LooseRecord {
  const timestamp = now();
  return {
    id: crypto.randomUUID(),
    executionId,
    stepId,
    sourceStepId,
    targetRole,
    reason,
    status,
    payload: payload ?? {},
    createdAt: timestamp,
    updatedAt: timestamp,
    resolvedAt: null,
  };
}

export function transitionEscalationRecord(
  record: LooseRecord,
  nextStatus: string,
  overrides: LooseRecord = {},
): LooseRecord {
  const timestamp = now();
  const resolvedAt = Object.hasOwn(overrides, "resolvedAt")
    ? overrides.resolvedAt
    : nextStatus === "resolved"
      ? timestamp
      : record.resolvedAt;
  return {
    ...record,
    ...overrides,
    status: nextStatus,
    updatedAt: timestamp,
    resolvedAt,
  };
}

export function createReviewRecord({
  executionId,
  stepId,
  status,
  decidedBy,
  comments,
}): LooseRecord {
  const timestamp = now();
  return {
    id: crypto.randomUUID(),
    executionId,
    stepId,
    status,
    decidedBy: decidedBy ?? "operator",
    comments: comments ?? "",
    createdAt: timestamp,
    decidedAt: timestamp,
  };
}

export function createApprovalRecord({
  executionId,
  stepId,
  status,
  decidedBy,
  comments,
}): LooseRecord {
  const timestamp = now();
  return {
    id: crypto.randomUUID(),
    executionId,
    stepId,
    status,
    decidedBy: decidedBy ?? "operator",
    comments: comments ?? "",
    createdAt: timestamp,
    decidedAt: timestamp,
  };
}

export function createAuditRecord({
  executionId,
  stepId = null,
  sessionId = null,
  actor = "operator",
  source = "orchestrator",
  targetType = "execution",
  targetId = null,
  action,
  payload,
  result,
}): LooseRecord {
  const timestamp = now();
  return {
    id: crypto.randomUUID(),
    executionId,
    stepId,
    sessionId,
    actor,
    source,
    targetType,
    targetId: targetId ?? executionId,
    action,
    payload: payload ?? {},
    result: result ?? {},
    createdAt: timestamp,
  };
}
