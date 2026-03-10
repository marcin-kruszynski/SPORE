export type CliFlags = Record<string, string | undefined>;

export interface RuntimeAdapterConfig {
  id: string;
  package?: string;
  sessionTransport?: string;
}

export interface RuntimeConfig {
  runtimeAdapters?: RuntimeAdapterConfig[];
  sessionDefaults?: {
    mode?: string;
    captureTranscript?: boolean;
    storeRoot?: string;
  };
}

export interface RuntimeProfile {
  id: string;
  name?: string;
  role: string;
  runtime: string;
  sessionMode?: string;
  systemPromptRef?: string;
  skills?: unknown[];
  tools?: unknown[];
  permissions?: unknown[];
  docsPolicy?: Record<string, unknown>;
  telemetryPolicy?: Record<string, unknown>;
  handoffPolicy?: Record<string, unknown>;
  reviewPolicy?: Record<string, unknown>;
}

export interface RuntimeProjectConfig {
  id: string;
  name?: string;
  type?: string;
  docsLocation?: string;
  workflowDefaults?: unknown[];
}

export interface SessionWorkspace {
  id: string | null;
  branchName: string | null;
  baseRef: string | null;
  cwd: string | null;
  purpose: string | null;
  sourceWorkspaceId: string | null;
  sourceRef: string | null;
  sourceCommit: string | null;
}

export interface SessionPlan {
  version: number;
  runtime: "pi";
  adapterId: string;
  adapterPackage?: string;
  sessionTransport?: string;
  session: {
    id: string;
    runId: string;
    role: string;
    domainId: string | null;
    workflowId: string | null;
    profileId: string;
    profileName?: string;
    sessionMode: string | null;
    transportMode: string;
    transcriptCapture: boolean;
    storeRoot: string;
    cwd: string | null;
  };
  project: {
    id: string;
    name?: string;
    type?: string;
    docsLocation?: string;
    workflowDefaults: unknown[];
  } | null;
  pi: {
    systemPromptRef?: string;
    contextFiles: string[];
    skills: unknown[];
    tools: unknown[];
    permissions: unknown[];
    docsPolicy: Record<string, unknown>;
    telemetryPolicy: Record<string, unknown>;
    handoffPolicy: Record<string, unknown>;
    reviewPolicy: Record<string, unknown>;
  };
  retrieval: {
    query: string | null;
    queryTerms: string[];
    limit: number;
  };
  metadata: {
    generatedAt: string;
    workspace: SessionWorkspace | null;
    sourceFiles: {
      profile: string;
      runtime: string;
      project: string | null;
    };
  };
}

export interface LaunchAssets {
  promptPath: string;
  launchScriptPath: string;
  transcriptPath: string;
  exitPath: string;
  piEventsPath: string;
  stderrPath: string;
  piSessionPath: string;
  controlPath: string;
  rpcStatusPath: string;
  launchContextPath: string;
}

export interface ProcessResult {
  stdout: string;
  stderr: string;
  code?: number;
  ok?: boolean;
}

export interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
}
