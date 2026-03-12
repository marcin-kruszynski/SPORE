import type {
  OperatorMissionAction,
  OperatorApiAction,
  OperatorApiArtifact,
  OperatorApiMessage,
  OperatorApiThreadDetail,
  OperatorApiThreadSummary,
  OperatorMissionArtifact,
  OperatorMissionDetail,
  OperatorMissionEvidenceItem,
  OperatorMissionInboxAction,
  OperatorMissionMessage,
  OperatorMissionThreadSummary,
} from "../types/operator-chat.js";

function toText(value: unknown, fallback = ""): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function toCount(value: unknown): number {
  const count = Number(value ?? 0);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function humanize(value: unknown, fallback = "Unknown"): string {
  const text = toText(value, fallback);
  return text
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatTimestamp(value: unknown): string {
  const text = toText(value, "");
  if (!text) {
    return "Pending";
  }

  const timestamp = Date.parse(text);
  if (Number.isNaN(timestamp)) {
    return text;
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function adaptArtifact(raw: OperatorApiArtifact | null | undefined): OperatorMissionArtifact | null {
  if (!raw) {
    return null;
  }

  const id = toText(raw.itemId, "");
  const type = toText(raw.itemType, "artifact");
  return {
    id: id || `${type}:${toText(raw.title, "artifact")}`,
    type,
    label: toText(raw.title, id || humanize(type, "Artifact")),
    status: toText(raw.status, "linked"),
  };
}

function adaptChoices(rawChoices: OperatorApiAction["choices"]): OperatorMissionAction["choices"] {
  return (Array.isArray(rawChoices) ? rawChoices : []).map((choice) => ({
    value: toText(choice?.value, "approve"),
    label: toText(choice?.label, humanize(choice?.value, "Action")),
    tone: toText(choice?.tone, "secondary"),
  }));
}

function adaptPendingAction(
  raw: OperatorApiAction,
  threadIdFallback = "",
): OperatorMissionAction {
  const waitingLabel =
    toText(raw.inboxSummary?.waitingLabel, "") ||
    toText(raw.decisionGuidance?.title, "") ||
    humanize(raw.actionKind, "Operator decision");

  return {
    id: toText(raw.id, "pending-action"),
    threadId: toText(raw.threadId, threadIdFallback),
    actionKind: toText(raw.actionKind, "operator-action"),
    status: toText(raw.status, "pending"),
    waitingLabel,
    reason:
      toText(raw.inboxSummary?.reason, "") ||
      toText(raw.decisionGuidance?.why, "") ||
      toText(raw.summary, "Operator review is waiting."),
    urgency: toText(raw.inboxSummary?.urgency, "normal"),
    decisionTitle: toText(raw.decisionGuidance?.title, waitingLabel),
    primaryActionLabel:
      toText(raw.decisionGuidance?.primaryAction, "") ||
      adaptChoices(raw.choices)[0]?.label ||
      "Respond",
    choices: adaptChoices(raw.choices),
  };
}

export function adaptOperatorThreadSummary(
  raw: OperatorApiThreadSummary,
): OperatorMissionThreadSummary {
  const summary = raw.summary ?? null;
  const updatedAtIso = toText(summary?.lastMessageAt, "") || toText(raw.updatedAt, "");

  return {
    id: toText(raw.id, "thread"),
    title:
      toText(raw.title, "") ||
      toText(summary?.objective, "") ||
      toText(raw.id, "Mission"),
    objective: toText(summary?.objective, "Mission objective pending."),
    lastMessageExcerpt: toText(summary?.lastMessageExcerpt, "No mission updates yet."),
    pendingActionCount:
      toCount(raw.pendingActionCount) || toCount(summary?.pendingActionCount),
    status: toText(raw.status, "idle"),
    updatedAtIso: updatedAtIso || null,
    updatedAtLabel: formatTimestamp(updatedAtIso),
  };
}

export function adaptOperatorInboxAction(
  raw: OperatorApiAction,
  threadFallback: OperatorMissionThreadSummary | null = null,
): OperatorMissionInboxAction {
  const pendingAction = adaptPendingAction(raw, threadFallback?.id ?? "");

  return {
    id: pendingAction.id,
    threadId: pendingAction.threadId,
    actionKind: pendingAction.actionKind,
    status: pendingAction.status,
    urgency: pendingAction.urgency,
    title:
      toText(raw.threadSummary?.title, "") ||
      toText(threadFallback?.title, "") ||
      toText(raw.threadId, "Mission"),
    objective:
      toText(raw.threadSummary?.objective, "") ||
      toText(threadFallback?.objective, "Mission objective pending."),
    reason: pendingAction.reason,
    waitingLabel: pendingAction.waitingLabel,
    decisionTitle: pendingAction.decisionTitle,
    primaryActionLabel: pendingAction.primaryActionLabel,
    choices: pendingAction.choices,
  };
}

function adaptEvidenceItems(
  raw: OperatorApiThreadDetail["evidenceSummary"],
): OperatorMissionEvidenceItem[] {
  return Object.entries(raw ?? {}).flatMap(([key, value]) => {
    if (!value || typeof value !== "object") {
      return [];
    }
    const record = value as Record<string, unknown>;
    const id = toText(record.id, key);
    return [
      {
        id,
        key,
        label:
          toText(record.title, "") ||
          toText(record.integrationBranch, "") ||
          toText(record.reason, "") ||
          humanize(key, "Evidence"),
        status: toText(record.status, "linked"),
      },
    ];
  });
}

function adaptMessage(
  raw: OperatorApiMessage,
  actionLookup: Map<string, OperatorMissionAction>,
): OperatorMissionMessage {
  const pendingActionId = toText(raw.payload?.pendingActionId, "");
  const rawArtifacts = Array.isArray(raw.payload?.artifacts)
    ? raw.payload.artifacts
    : [];

  return {
    id: toText(raw.id, "message"),
    role: toText(raw.role, "assistant"),
    kind: toText(raw.kind, "message"),
    content: toText(raw.content, ""),
    timestampLabel: formatTimestamp(raw.createdAt),
    timestampIso: toText(raw.createdAt, "") || null,
    artifacts: rawArtifacts
      .map((artifact) => adaptArtifact(artifact))
      .filter(Boolean) as OperatorMissionArtifact[],
    pendingAction: pendingActionId ? actionLookup.get(pendingActionId) ?? null : null,
  };
}

export function adaptOperatorThreadDetail(
  raw: OperatorApiThreadDetail,
): OperatorMissionDetail {
  const threadSummary = adaptOperatorThreadSummary(raw);
  const rawPendingActions = Array.isArray(raw.pendingActions)
    ? raw.pendingActions
    : [];
  const rawActionHistory = Array.isArray(raw.actionHistory)
    ? raw.actionHistory
    : [];
  const rawProgressStages = Array.isArray(raw.progress?.stages)
    ? raw.progress.stages
    : [];
  const secondaryActions = Array.isArray(raw.decisionGuidance?.secondaryActions)
    ? raw.decisionGuidance.secondaryActions
    : [];
  const quickReplies = Array.isArray(raw.decisionGuidance?.suggestedReplies)
    ? raw.decisionGuidance.suggestedReplies
    : [];
  const rawMessages = Array.isArray(raw.messages) ? raw.messages : [];
  const rawLinkedArtifacts = Array.isArray(raw.context?.linkedArtifacts)
    ? raw.context.linkedArtifacts
    : [];
  const pendingActions = rawPendingActions.map((action) =>
    adaptPendingAction(action, threadSummary.id),
  );
  const actionHistory = rawActionHistory.map((action) =>
    adaptPendingAction(action, threadSummary.id),
  );
  const actionLookup = new Map(
    [...pendingActions, ...actionHistory].map((action) => [action.id, action] as const),
  );
  const execution = raw.metadata?.execution ?? null;

  return {
    id: threadSummary.id,
    title: threadSummary.title,
    status: threadSummary.status,
    updatedAtIso: threadSummary.updatedAtIso,
    updatedAtLabel: threadSummary.updatedAtLabel,
    objective: threadSummary.objective,
    hero: {
      title: toText(raw.hero?.title, threadSummary.title),
      statusLine: toText(raw.hero?.statusLine, threadSummary.lastMessageExcerpt),
      phase: toText(raw.hero?.phase, humanize(raw.progress?.currentStage, "Mission")),
      primaryCtaHint: toText(raw.hero?.primaryCtaHint, ""),
      badges: Object.values(raw.hero?.badges ?? {}).filter(Boolean),
    },
    progress: {
      currentStage: toText(raw.progress?.currentStage, "mission_received"),
      currentState: toText(raw.progress?.currentState, threadSummary.status),
      exceptionState: toText(raw.progress?.exceptionState, "") || null,
      stages: rawProgressStages.map((stage) => ({
        id: toText(stage.id, "stage"),
        title: toText(stage.title, toText(stage.label, humanize(stage.id, "Stage"))),
        status: toText(stage.status, "upcoming"),
      })),
    },
    decisionGuidance: {
      title: toText(raw.decisionGuidance?.title, "No operator decision is pending"),
      why: toText(
        raw.decisionGuidance?.why,
        "The orchestrator is still working or waiting for the next governed transition.",
      ),
      nextIfApproved: toText(
        raw.decisionGuidance?.nextIfApproved,
        "No approval is waiting right now.",
      ),
      riskNote: toText(raw.decisionGuidance?.riskNote, "No extra risk note."),
      primaryAction: toText(raw.decisionGuidance?.primaryAction, "Ask for status"),
      secondaryActions: secondaryActions.filter(Boolean),
    },
    quickReplies: quickReplies.filter(Boolean),
    pendingActions,
    actionHistory,
    messages: rawMessages.map((message) => adaptMessage(message, actionLookup)),
    linkedArtifacts: rawLinkedArtifacts
      .map((artifact) => adaptArtifact(artifact))
      .filter(Boolean) as OperatorMissionArtifact[],
    evidenceItems: adaptEvidenceItems(raw.evidenceSummary),
    context: {
      projectId: toText(execution?.projectId, "spore"),
      runtimeLabel: execution?.stub === false ? "Live runtime" : "Stub runtime",
      safeModeLabel: execution?.safeMode === false ? "Safe mode off" : "Safe mode on",
      autoValidateLabel:
        execution?.autoValidate === false ? "Auto-validate off" : "Auto-validate on",
      quarantineLabel: raw.context?.activeQuarantine
        ? `Quarantine active: ${toText(raw.context.activeQuarantine.reason, toText(raw.context.activeQuarantine.id, "Active"))}`
        : null,
    },
  };
}
