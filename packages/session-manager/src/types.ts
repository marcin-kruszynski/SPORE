export type SessionState =
  | "planned"
  | "starting"
  | "active"
  | "completed"
  | "failed"
  | "stopped"
  | "canceled"
  | (string & {});

export interface SessionRecord {
  id: string;
  runId: string;
  agentIdentityId: string;
  profileId: string;
  role: string;
  state: SessionState;
  runtimeAdapter: string;
  transportMode: string | null;
  sessionMode: string | null;
  projectId: string | null;
  projectName: string | null;
  projectType: string | null;
  domainId: string | null;
  workflowId: string | null;
  parentSessionId: string | null;
  contextPath: string | null;
  transcriptPath: string | null;
  launcherType: string | null;
  launchCommand: string | null;
  tmuxSession: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
  artifactRecovery?: SessionArtifactRecoveryTelemetry | null;
}

export interface SessionSummary {
  id: string;
  runId: string;
  profileId: string;
  role: string;
  state: SessionState;
  projectId: string | null;
  domainId: string | null;
  workflowId: string | null;
  parentSessionId: string | null;
  tmuxSession: string | null;
  updatedAt: string;
}

export type SessionEventPayload = Record<string, unknown>;

export type SessionArtifactSignalSource = "exit-file" | "rpc-status";

export type SessionArtifactFallbackReason =
  | "exit-file-missing"
  | "exit-file-invalid";

export interface SessionArtifactRecoveryTelemetry {
  recovered: true;
  signalSource: SessionArtifactSignalSource;
  terminalSignalSource: string | null;
  fallbackReason: SessionArtifactFallbackReason | null;
  artifactPath: string;
  exitCode: number;
  nextState: "completed" | "failed";
  finishedAt: string | null;
  status: string | null;
  artifactRecoveryCount: number;
}

export interface SessionEvent<
  TPayload extends SessionEventPayload = SessionEventPayload,
> {
  id: string;
  type: string;
  timestamp: string;
  runId: string;
  sessionId: string;
  projectId: string | null;
  domainId: string | null;
  workflowId: string | null;
  agentIdentityId: string;
  payload: TPayload;
}

export interface SessionProjectPlan {
  id?: string | null;
  name?: string | null;
  type?: string | null;
  workflowDefaults?: string[] | null;
}

export interface SessionPlan {
  adapterId: string;
  session: {
    id: string;
    runId: string;
    profileId: string;
    role: string;
    transportMode?: string | null;
    sessionMode?: string | null;
  };
  project?: SessionProjectPlan | null;
}

export interface SessionRecordOverrides {
  transcriptPath?: string | null;
  contextPath?: string | null;
  launcherType?: string | null;
  launchCommand?: string | null;
  tmuxSession?: string | null;
}

export interface CreateSessionRecordOptions extends SessionRecordOverrides {
  state?: SessionState;
  domainId?: string | null;
  workflowId?: string | null;
  parentSessionId?: string | null;
}

export interface AppendSessionEventRecordOptions {
  dbPath?: string;
  eventLogPath?: string;
  sessionId: string;
  type: string;
  payload?: SessionEventPayload;
}

export interface TransitionSessionStateOptions {
  dbPath?: string;
  eventLogPath?: string;
  sessionId: string;
  nextState: SessionState;
  overrides?: SessionRecordOverrides;
  payload?: SessionEventPayload;
}

export interface SessionControlRequestInput {
  id: string;
  sessionId: string;
  action: string;
  idempotencyKey?: string | null;
  requestPayload?: Record<string, unknown>;
  ackStatus: string;
  status: string;
  result?: Record<string, unknown>;
  acceptedAt: string;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionControlRequestRecord {
  id: string;
  sessionId: string;
  action: string;
  idempotencyKey: string | null;
  requestPayload: Record<string, unknown>;
  ackStatus: string;
  status: string;
  result: Record<string, unknown>;
  acceptedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionEventFilters {
  limit?: string | number | boolean;
  session?: string | boolean;
  run?: string | boolean;
  type?: string | boolean;
  since?: string | boolean;
  [key: string]: string | number | boolean | undefined;
}

export interface ParsedArgs<
  TFlags extends Record<string, string | boolean | undefined>,
> {
  positional: string[];
  flags: TFlags;
}
