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

interface FocusableDecisionTarget {
  scrollIntoView?: (options?: ScrollIntoViewOptions) => void;
  focus?: (options?: FocusOptions) => void;
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

export function focusCurrentDecisionCard(
  target: FocusableDecisionTarget | null | undefined,
): boolean {
  if (!target) {
    return false;
  }

  target.scrollIntoView?.({
    behavior: "smooth",
    block: "start",
    inline: "nearest",
  });
  target.focus?.({ preventScroll: true });
  return true;
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
  void previous;
  return Boolean(next);
}
