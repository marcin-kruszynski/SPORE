export type AgentLaneState =
  | "running"
  | "waiting"
  | "blocked"
  | "completed"
  | "error"
  | "unknown";

export type AgentAttentionKind =
  | "approval"
  | "review"
  | "validation-running"
  | "validation-required"
  | "promotion-ready"
  | "promotion-blocked"
  | "lane-blocked"
  | "lane-error";

export type AgentArtifactType = "proposal" | "validation" | "promotion" | "workspace";

export interface RecentArtifactViewModel {
  dedupeKey: string;
  type: AgentArtifactType;
  id: string;
  label: string;
  status: string;
  href: string | null;
  lastSeenAt: string | null;
  freshnessLabel: string;
  degraded: boolean;
}

export interface AttentionItemViewModel {
  id: string;
  targetKey: string;
  laneId: string | null;
  kind: AgentAttentionKind;
  title: string;
  summary: string;
  href: string | null;
  lastSeenAt: string | null;
  repeatCount: number;
  priority: number;
}

export interface AgentLaneCardViewModel {
  id: string;
  label: string;
  roleLabel: string;
  sessionId: string | null;
  state: AgentLaneState;
  stageLabel: string | null;
  latestSummary: string | null;
  lastActivityAt: string | null;
  freshnessLabel: string;
  missionId: string | null;
  missionTitle: string | null;
  missionHref: string;
  executionId: string | null;
  threadId: string | null;
  detailHref: string | null;
  inspectionLimited: boolean;
  inspectionSummary: string | null;
  sessionHref: string | null;
  artifactLinks: RecentArtifactViewModel[];
  attention: AttentionItemViewModel[];
  degraded: boolean;
}

export interface AgentSessionDetailViewModel {
  laneId: string;
  label: string;
  sessionId: string | null;
  state: AgentLaneState;
  stageLabel: string | null;
  summary: string | null;
  latestSummary: string | null;
  lastActivityAt: string | null;
  freshnessLabel: string;
  requestPrompt: {
    title: string;
    content: string | null;
    source: string | null;
  };
  returnedHandoff: {
    title: string;
    content: string | null;
    valid: boolean | null;
    issues: string[];
  };
  mission: {
    kind: "confirmed" | "partial" | "unknown";
    title: string | null;
    href: string | null;
    summary: string;
  };
  execution: {
    kind: "confirmed" | "partial" | "unknown";
    id: string | null;
    href: string | null;
    summary: string;
  };
  sessionHealth: {
    kind: "live" | "degraded" | "reconnecting" | "unavailable";
    label: string;
    message: string;
  };
  sessionHref: string | null;
  recentUpdates: Array<{
    id: string;
    summary: string;
    source: "thread" | "session";
    timestamp: string | null;
    freshnessLabel: string;
  }>;
  lastVisibleOutputs: Array<{
    id: string;
    summary: string;
    source: "thread" | "session";
    timestamp: string | null;
    freshnessLabel: string;
  }>;
  sessionEvents: Array<{
    id: string;
    type: string;
    summary: string;
    timestamp: string | null;
    freshnessLabel: string;
  }>;
  transcriptPreview: {
    content: string | null;
    path: string | null;
    truncated: boolean;
  };
  inspection: {
    tmuxSession: string | null;
    transcriptPath: string | null;
    launchCommand: string | null;
    cwd: string | null;
    workspaceId: string | null;
    workspacePurpose: string | null;
    branchName: string | null;
    runtimeAdapter: string | null;
    transportMode: string | null;
    launcherType: string | null;
    lastEventType: string | null;
    lastEventAt: string | null;
  };
  artifacts: RecentArtifactViewModel[];
  attention: AttentionItemViewModel[];
  degraded: boolean;
  unavailable: {
    routeLaneId: string;
    reason: string;
    label: string | null;
    sessionId: string | null;
    missionTitle: string | null;
    missionHref: string | null;
  } | null;
}

export interface AgentCockpitViewModel {
  lanes: AgentLaneCardViewModel[];
  attention: AttentionItemViewModel[];
  recentArtifacts: RecentArtifactViewModel[];
  isDegraded: boolean;
  degradedReasons: string[];
}
