export interface OperatorSubmissionRequest {
  path: string;
  method: "POST";
  body: Record<string, string>;
}

export interface MissionFocusState {
  selectedThreadId: string | null;
  highlightedActionId: string | null;
  missionFocusSource: string | null;
}

export interface OperatorActionProjection {
  id?: string;
  threadId?: string;
  actionKind?: string;
  summary?: string;
  status?: string;
  threadSummary?: {
    title?: string;
    objective?: string;
  } | null;
  inboxSummary?: {
    urgency?: string;
    reason?: string;
    waitingLabel?: string;
  } | null;
  decisionGuidance?: {
    title?: string;
    why?: string;
    primaryAction?: string;
  } | null;
  choices?: Array<{
    value?: string;
    label?: string;
    tone?: string;
  }>;
}

export interface OperatorThreadFallback {
  title?: string;
  summary?: {
    objective?: string;
  } | null;
}

export interface InboxRowContent {
  title: string;
  objective: string;
  reason: string;
  waitingLabel: string;
  urgency: string;
  decisionTitle: string;
  primaryAction: string;
}

interface ThreadEventProjection {
  id?: string;
  status?: string;
  progress?: {
    currentStage?: string;
    currentState?: string;
    exceptionState?: string | null;
  } | null;
  inboxSummary?: {
    urgency?: string;
    reason?: string;
    waitingLabel?: string;
  } | null;
  decisionGuidance?: {
    title?: string;
    primaryAction?: string;
  } | null;
  hero?: {
    phase?: string;
    statusLine?: string;
  } | null;
  pendingActions?: Array<{
    id?: string;
    status?: string;
  }>;
}

function toText(value: unknown, fallback = ""): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizePendingActions(detail: ThreadEventProjection | null | undefined) {
  return Array.isArray(detail?.pendingActions)
    ? detail.pendingActions.map((action) => ({
        id: toText(action?.id, ""),
        status: toText(action?.status, "pending"),
      }))
    : [];
}

function eventRefreshSignature(detail: ThreadEventProjection | null | undefined) {
  if (!detail) {
    return null;
  }

  return JSON.stringify({
    id: toText(detail.id, ""),
    status: toText(detail.status, ""),
    currentStage: toText(detail.progress?.currentStage, ""),
    currentState: toText(detail.progress?.currentState, ""),
    exceptionState: toText(detail.progress?.exceptionState, ""),
    urgency: toText(detail.inboxSummary?.urgency, ""),
    reason: toText(detail.inboxSummary?.reason, ""),
    waitingLabel: toText(detail.inboxSummary?.waitingLabel, ""),
    decisionTitle: toText(detail.decisionGuidance?.title, ""),
    primaryAction: toText(detail.decisionGuidance?.primaryAction, ""),
    phase: toText(detail.hero?.phase, ""),
    statusLine: toText(detail.hero?.statusLine, ""),
    pendingActions: normalizePendingActions(detail),
  });
}

export function buildQuickReplySubmission(
  threadId: string,
  reply: string,
): OperatorSubmissionRequest {
  return {
    path: `/operator/threads/${encodeURIComponent(threadId)}/messages`,
    method: "POST",
    body: {
      message: reply,
      by: "web-operator",
      source: "web-operator-chat",
    },
  };
}

export function buildInboxActionSubmission(
  actionId: string,
  choice: string,
): OperatorSubmissionRequest {
  return {
    path: `/operator/actions/${encodeURIComponent(actionId)}/resolve`,
    method: "POST",
    body: {
      choice,
      by: "web-operator",
      source: "web-operator-chat",
    },
  };
}

export function deriveMissionFocusState(
  currentState: MissionFocusState,
  action: Pick<OperatorActionProjection, "id" | "threadId">,
): MissionFocusState {
  return {
    selectedThreadId: toText(action.threadId, currentState.selectedThreadId ?? "") || null,
    highlightedActionId: toText(action.id, "") || null,
    missionFocusSource: "inbox",
  };
}

export function resolveInboxRowContent(
  action: OperatorActionProjection,
  threadFallback: OperatorThreadFallback | null = null,
): InboxRowContent {
  const firstChoice = Array.isArray(action.choices) ? action.choices[0] : null;
  const projectionTitle = toText(action.threadSummary?.title, "");
  const fallbackObjective = toText(threadFallback?.summary?.objective, "");
  const waitingLabel =
    toText(action.inboxSummary?.waitingLabel, "") ||
    toText(action.decisionGuidance?.title, "") ||
    toText(action.actionKind, "Pending operator decision");

  return {
    title:
      projectionTitle ||
      toText(threadFallback?.title, "") ||
      fallbackObjective ||
      toText(action.threadId, "Mission"),
    objective:
      toText(action.threadSummary?.objective, "") || fallbackObjective,
    reason:
      toText(action.inboxSummary?.reason, "") ||
      toText(action.decisionGuidance?.why, "") ||
      toText(action.summary, "Operator decision required."),
    waitingLabel,
    urgency: toText(action.inboxSummary?.urgency, "normal"),
    decisionTitle:
      toText(action.decisionGuidance?.title, "") || waitingLabel,
    primaryAction:
      toText(action.decisionGuidance?.primaryAction, "") ||
      toText(firstChoice?.label, "") ||
      toText(firstChoice?.value, ""),
  };
}

export function shouldRefreshInboxFromThreadEvent(
  previous: ThreadEventProjection | null | undefined,
  next: ThreadEventProjection | null | undefined,
): boolean {
  return eventRefreshSignature(previous) !== eventRefreshSignature(next);
}
