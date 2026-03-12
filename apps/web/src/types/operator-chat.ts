export interface ApiEnvelope<TDetail> {
  ok: boolean;
  detail: TDetail;
  error?: string;
  message?: string;
}

export interface OperatorApiArtifact {
  itemType?: string | null;
  itemId?: string | null;
  title?: string | null;
  status?: string | null;
}

export interface OperatorApiChoice {
  value?: string | null;
  label?: string | null;
  tone?: string | null;
}

export interface OperatorApiDecisionGuidance {
  title?: string | null;
  why?: string | null;
  nextIfApproved?: string | null;
  riskNote?: string | null;
  primaryAction?: string | null;
  secondaryActions?: string[] | null;
  suggestedReplies?: string[] | null;
}

export interface OperatorApiInboxSummary {
  urgency?: string | null;
  reason?: string | null;
  waitingLabel?: string | null;
}

export interface OperatorApiThreadSummary {
  id?: string | null;
  title?: string | null;
  status?: string | null;
  updatedAt?: string | null;
  summary?: {
    objective?: string | null;
    lastMessageExcerpt?: string | null;
    pendingActionCount?: number | null;
    lastMessageAt?: string | null;
  } | null;
  pendingActionCount?: number | null;
}

export interface OperatorApiAction {
  id?: string | null;
  threadId?: string | null;
  status?: string | null;
  actionKind?: string | null;
  summary?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  requestedAt?: string | null;
  decisionGuidance?: OperatorApiDecisionGuidance | null;
  inboxSummary?: OperatorApiInboxSummary | null;
  threadSummary?: {
    title?: string | null;
    objective?: string | null;
  } | null;
  choices?: OperatorApiChoice[] | null;
}

export interface OperatorApiMessage {
  id?: string | null;
  role?: string | null;
  kind?: string | null;
  content?: string | null;
  createdAt?: string | null;
  payload?: {
    pendingActionId?: string | null;
    artifacts?: OperatorApiArtifact[] | null;
  } | null;
}

export interface OperatorApiProgressStage {
  id?: string | null;
  title?: string | null;
  label?: string | null;
  status?: string | null;
}

export interface OperatorApiThreadDetail {
  id?: string | null;
  title?: string | null;
  status?: string | null;
  updatedAt?: string | null;
  summary?: OperatorApiThreadSummary["summary"];
  hero?: {
    title?: string | null;
    statusLine?: string | null;
    phase?: string | null;
    primaryCtaHint?: string | null;
    badges?: Record<string, string> | null;
  } | null;
  progress?: {
    currentStage?: string | null;
    currentState?: string | null;
    exceptionState?: string | null;
    stages?: OperatorApiProgressStage[] | null;
  } | null;
  decisionGuidance?: OperatorApiDecisionGuidance | null;
  pendingActions?: OperatorApiAction[] | null;
  actionHistory?: OperatorApiAction[] | null;
  messages?: OperatorApiMessage[] | null;
  context?: {
    linkedArtifacts?: OperatorApiArtifact[] | null;
    activeQuarantine?: {
      id?: string | null;
      targetType?: string | null;
      targetId?: string | null;
      reason?: string | null;
      status?: string | null;
    } | null;
  } | null;
  evidenceSummary?: Record<string, Record<string, unknown> | null> | null;
  metadata?: {
    execution?: {
      projectId?: string | null;
      safeMode?: boolean | null;
      autoValidate?: boolean | null;
      stub?: boolean | null;
    } | null;
  } | null;
}

export interface OperatorThreadStreamPayload {
  ok: boolean;
  detail?: OperatorApiThreadDetail;
  message?: string;
  error?: string;
}

export interface CreateOperatorMissionInput {
  message: string;
  projectId?: string;
  safeMode?: boolean;
  autoValidate?: boolean;
  stub?: boolean;
  title?: string;
  by: string;
  source: string;
}

export interface SendOperatorMessageInput {
  message: string;
  by: string;
  source: string;
}

export interface ResolveOperatorActionInput {
  choice: string;
  by: string;
  source: string;
}

export interface OperatorMissionChoice {
  value: string;
  label: string;
  tone: string;
}

export interface OperatorMissionThreadSummary {
  id: string;
  title: string;
  objective: string;
  lastMessageExcerpt: string;
  pendingActionCount: number;
  status: string;
  updatedAtIso: string | null;
  updatedAtLabel: string;
}

export interface OperatorMissionInboxAction {
  id: string;
  threadId: string;
  actionKind: string;
  status: string;
  urgency: string;
  title: string;
  objective: string;
  reason: string;
  waitingLabel: string;
  decisionTitle: string;
  primaryActionLabel: string;
  choices: OperatorMissionChoice[];
}

export interface OperatorMissionArtifact {
  id: string;
  type: string;
  label: string;
  status: string;
}

export interface OperatorMissionEvidenceItem {
  id: string;
  key: string;
  label: string;
  status: string;
}

export interface OperatorMissionPendingAction {
  id: string;
  threadId: string;
  actionKind: string;
  status: string;
  waitingLabel: string;
  reason: string;
  urgency: string;
  decisionTitle: string;
  primaryActionLabel: string;
  choices: OperatorMissionChoice[];
}

export interface OperatorMissionAction extends OperatorMissionPendingAction {}

export interface OperatorMissionMessage {
  id: string;
  role: string;
  kind: string;
  content: string;
  timestampLabel: string;
  timestampIso: string | null;
  artifacts: OperatorMissionArtifact[];
  pendingAction: OperatorMissionAction | null;
}

export interface OperatorMissionDetail {
  id: string;
  title: string;
  status: string;
  updatedAtIso: string | null;
  updatedAtLabel: string;
  objective: string;
  hero: {
    title: string;
    statusLine: string;
    phase: string;
    primaryCtaHint: string;
    badges: string[];
  };
  progress: {
    currentStage: string;
    currentState: string;
    exceptionState: string | null;
    stages: Array<{
      id: string;
      title: string;
      status: string;
    }>;
  };
  decisionGuidance: {
    title: string;
    why: string;
    nextIfApproved: string;
    riskNote: string;
    primaryAction: string;
    secondaryActions: string[];
  };
  quickReplies: string[];
  pendingActions: OperatorMissionAction[];
  actionHistory: OperatorMissionAction[];
  messages: OperatorMissionMessage[];
  linkedArtifacts: OperatorMissionArtifact[];
  evidenceItems: OperatorMissionEvidenceItem[];
  context: {
    projectId: string;
    runtimeLabel: string;
    safeModeLabel: string;
    autoValidateLabel: string;
    quarantineLabel: string | null;
  };
}

export interface CreateMissionFormValues {
  objective: string;
  projectId: string;
  safeMode: boolean;
  autoValidate: boolean;
  useStubRuntime: boolean;
}
