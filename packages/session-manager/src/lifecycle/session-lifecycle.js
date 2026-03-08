import crypto from "node:crypto";

function eventId() {
  return crypto.randomUUID();
}

export function createSessionRecordFromPlan(plan, options = {}) {
  const now = new Date().toISOString();
  return {
    id: plan.session.id,
    runId: plan.session.runId,
    agentIdentityId: `${plan.session.profileId}:${plan.session.role}`,
    profileId: plan.session.profileId,
    role: plan.session.role,
    state: options.state ?? "planned",
    runtimeAdapter: plan.adapterId,
    transportMode: plan.session.transportMode,
    sessionMode: plan.session.sessionMode,
    projectId: plan.project?.id ?? null,
    projectName: plan.project?.name ?? null,
    projectType: plan.project?.type ?? null,
    domainId: options.domainId ?? null,
    workflowId: options.workflowId ?? (plan.project?.workflowDefaults?.[0] ?? null),
    parentSessionId: options.parentSessionId ?? null,
    contextPath: options.contextPath ?? null,
    transcriptPath: options.transcriptPath ?? null,
    launcherType: options.launcherType ?? null,
    launchCommand: options.launchCommand ?? null,
    tmuxSession: options.tmuxSession ?? null,
    startedAt: options.state === "active" ? now : null,
    endedAt: null,
    createdAt: now,
    updatedAt: now
  };
}

export function transitionSessionRecord(sessionRecord, nextState) {
  const now = new Date().toISOString();
  return {
    ...sessionRecord,
    state: nextState,
    startedAt: sessionRecord.startedAt ?? (nextState === "active" ? now : null),
    endedAt:
      nextState === "completed" || nextState === "failed" || nextState === "stopped"
        ? now
        : sessionRecord.endedAt,
    updatedAt: now
  };
}

export function createSessionEvent(sessionRecord, type, payload = {}) {
  return {
    id: eventId(),
    type,
    timestamp: new Date().toISOString(),
    runId: sessionRecord.runId,
    sessionId: sessionRecord.id,
    projectId: sessionRecord.projectId,
    domainId: sessionRecord.domainId,
    workflowId: sessionRecord.workflowId,
    agentIdentityId: sessionRecord.agentIdentityId,
    payload
  };
}

export function createLifecycleEvent(sessionRecord, type, payload = {}) {
  return createSessionEvent(sessionRecord, type, payload);
}
