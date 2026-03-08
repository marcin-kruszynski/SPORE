import crypto from "node:crypto";

function now() {
  return new Date().toISOString();
}

export function createExecutionRecord(invocation) {
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
    coordinationGroupId: invocation.coordination?.groupId ?? invocation.invocationId,
    parentExecutionId: invocation.coordination?.parentExecutionId ?? null,
    branchKey: invocation.coordination?.branchKey ?? null,
    policy: invocation.effectivePolicy ?? {},
    objective: invocation.objective ?? "",
    state: "planned",
    reviewStatus: null,
    approvalStatus: null,
    heldFromState: null,
    holdReason: null,
    pausedAt: null,
    heldAt: null,
    resumedAt: null,
    currentStepIndex: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: null,
    endedAt: null
  };
}

export function createStepRecord(executionId, launch, sequence) {
  const timestamp = now();
  const isReviewer = launch.role === "reviewer";
  const reviewRequired = launch.reviewRequired ?? isReviewer;
  const approvalRequired = launch.approvalRequired ?? reviewRequired;
  return {
    id: `${executionId}:step:${sequence + 1}`,
    executionId,
    sequence,
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
    settledAt: null
  };
}

export function transitionExecutionRecord(record, nextState, overrides = {}) {
  const timestamp = now();
  const settled = ["completed", "failed", "rejected", "canceled"].includes(nextState);
  const pausedAt = Object.prototype.hasOwnProperty.call(overrides, "pausedAt")
    ? overrides.pausedAt
    : nextState === "paused"
      ? timestamp
      : record.pausedAt;
  const heldAt = Object.prototype.hasOwnProperty.call(overrides, "heldAt")
    ? overrides.heldAt
    : nextState === "held"
      ? timestamp
      : record.heldAt;
  const resumedAt = Object.prototype.hasOwnProperty.call(overrides, "resumedAt")
    ? overrides.resumedAt
    : nextState === "running" && ["paused", "held"].includes(record.state)
      ? timestamp
      : record.resumedAt;
  const startedAt = Object.prototype.hasOwnProperty.call(overrides, "startedAt")
    ? overrides.startedAt
    : record.startedAt ?? (nextState === "running" ? timestamp : record.startedAt);
  const endedAt = Object.prototype.hasOwnProperty.call(overrides, "endedAt")
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
    updatedAt: timestamp
  };
}

export function transitionStepRecord(record, nextState, overrides = {}) {
  const timestamp = now();
  const settled = ["completed", "failed", "stopped", "review_pending", "approval_pending", "rejected"].includes(nextState);
  const launchedAt = Object.prototype.hasOwnProperty.call(overrides, "launchedAt")
    ? overrides.launchedAt
    : record.launchedAt ?? (["launching", "active"].includes(nextState) ? timestamp : record.launchedAt);
  const settledAt = Object.prototype.hasOwnProperty.call(overrides, "settledAt")
    ? overrides.settledAt
    : settled ? timestamp : record.settledAt;
  return {
    ...record,
    ...overrides,
    state: nextState,
    launchedAt,
    settledAt,
    updatedAt: timestamp
  };
}

export function createWorkflowEventRecord({
  executionId,
  stepId = null,
  sessionId = null,
  type,
  payload
}) {
  return {
    id: crypto.randomUUID(),
    executionId,
    stepId,
    sessionId,
    type,
    payload: payload ?? {},
    createdAt: now()
  };
}

export function createEscalationRecord({
  executionId,
  stepId = null,
  sourceStepId = null,
  targetRole = "lead",
  reason,
  status = "open",
  payload
}) {
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
    resolvedAt: null
  };
}

export function transitionEscalationRecord(record, nextStatus, overrides = {}) {
  const timestamp = now();
  const resolvedAt = Object.prototype.hasOwnProperty.call(overrides, "resolvedAt")
    ? overrides.resolvedAt
    : nextStatus === "resolved"
      ? timestamp
      : record.resolvedAt;
  return {
    ...record,
    ...overrides,
    status: nextStatus,
    updatedAt: timestamp,
    resolvedAt
  };
}

export function createReviewRecord({ executionId, stepId, status, decidedBy, comments }) {
  const timestamp = now();
  return {
    id: crypto.randomUUID(),
    executionId,
    stepId,
    status,
    decidedBy: decidedBy ?? "operator",
    comments: comments ?? "",
    createdAt: timestamp,
    decidedAt: timestamp
  };
}

export function createApprovalRecord({ executionId, stepId, status, decidedBy, comments }) {
  const timestamp = now();
  return {
    id: crypto.randomUUID(),
    executionId,
    stepId,
    status,
    decidedBy: decidedBy ?? "operator",
    comments: comments ?? "",
    createdAt: timestamp,
    decidedAt: timestamp
  };
}
