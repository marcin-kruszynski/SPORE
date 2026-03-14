export type RuntimeProviderFamily = "pi";

export type RuntimeBackendKind =
  | "pi_rpc"
  | "pi_sdk_embedded"
  | "pi_sdk_worker";

export type RuntimeControlKind =
  | "steer"
  | "follow_up"
  | "prompt"
  | "abort"
  | "snapshot";

export type RuntimeSessionState =
  | "starting"
  | "active"
  | "waiting_input"
  | "idle"
  | "settling"
  | "completed"
  | "failed"
  | "stopped"
  | "unknown";

export type RuntimeHealth =
  | "healthy"
  | "degraded"
  | "unreachable"
  | "terminated";

export interface RuntimeCapabilities {
  supportsSteer: boolean;
  supportsFollowUp: boolean;
  supportsPrompt: boolean;
  supportsAbort: boolean;
  supportsSnapshot: boolean;
  supportsAttach: boolean;
  supportsRawEvents: boolean;
  supportsTmuxInspection: boolean;
}

export interface RuntimeTerminalSignal {
  settled: boolean;
  exitCode: number | null;
  finishedAt: string | null;
  source: string | null;
}

export interface RuntimeSnapshot {
  sessionId: string;
  backendKind: RuntimeBackendKind;
  state: RuntimeSessionState;
  health: RuntimeHealth;
  startedAt: string | null;
  finishedAt: string | null;
  lastEventAt: string | null;
  terminalSignal: RuntimeTerminalSignal | null;
  rawStateRef: string | null;
}

export interface RuntimeControlCommand {
  requestId: string;
  sessionId: string;
  kind: RuntimeControlKind;
  issuedAt: string;
  payload: Record<string, unknown>;
}

export interface RuntimeControlAck {
  requestId: string;
  sessionId: string;
  accepted: boolean;
  backendRequestId: string | null;
  status: "accepted" | "queued" | "completed" | "rejected";
  message: string | null;
}

export interface RuntimeArtifactManifest {
  transcriptPath: string | null;
  runtimeStatusPath: string | null;
  runtimeEventsPath: string | null;
  rawEventsPath: string | null;
  controlPath: string | null;
  handoffPath: string | null;
  launchContextPath: string | null;
  debugPaths: string[];
}

export interface RuntimeSessionBinding {
  sessionId: string;
  backendKind: RuntimeBackendKind;
  providerFamily: RuntimeProviderFamily;
  runtimeInstanceId: string | null;
  controlEndpoint: string | null;
  protocolVersion: string | null;
  capabilities: RuntimeCapabilities;
  artifacts: RuntimeArtifactManifest;
}

export interface RuntimeEventEnvelope {
  eventId: string;
  sessionId: string;
  backendKind: RuntimeBackendKind;
  sequence: number;
  timestamp: string;
  type: string;
  snapshot: Partial<RuntimeSnapshot> | null;
  payload: Record<string, unknown>;
  rawRef: string | null;
}

export interface RuntimeStartResult {
  binding: RuntimeSessionBinding;
  launchCommand: string | null;
  launcherType: string | null;
}

export interface RuntimeStartRequest {
  sessionId: string;
  runId: string;
  executionId: string | null;
  stepId: string | null;
  providerFamily: RuntimeProviderFamily;
  backendKind: RuntimeBackendKind;
  artifactRoot: string;
  planPath: string | null;
  contextPath: string | null;
  promptPath: string | null;
  cwd: string | null;
  metadata: Record<string, unknown>;
}
