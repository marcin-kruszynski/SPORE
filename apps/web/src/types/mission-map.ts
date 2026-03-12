import type {
  OperatorApiArtifact,
  OperatorApiThreadDetail,
  OperatorApiThreadSummary,
} from "./operator-chat.js";

export type MissionMapNodeState =
  | "running"
  | "completed"
  | "idle"
  | "waiting"
  | "blocked"
  | "error"
  | "active";

export type MissionMapNodeKind = "mission" | "execution" | "session";

export type MissionMapSourceKey =
  | "thread"
  | "execution"
  | "tree"
  | "coordination"
  | "sessions";

export type MissionMapSourceStatusKind =
  | "ready"
  | "partial"
  | "missing"
  | "error";

export interface MissionMapSourceState {
  key: MissionMapSourceKey;
  status: MissionMapSourceStatusKind;
  detail: string;
}

export interface MissionMapNode {
  id: string;
  kind: MissionMapNodeKind;
  label: string;
  task: string;
  state: MissionMapNodeState;
  progress?: number;
  output?: string;
  badges: string[];
  source: MissionMapSourceKey;
  children: MissionMapNode[];
}

export interface MissionMapMission {
  threadId: string;
  title: string;
  status: string;
  objective: string;
  subtitle: string;
  linkedExecutionId: string | null;
  linkedCoordinationGroupId: string | null;
  rootNodes: MissionMapNode[];
  warnings: string[];
  sourceState: Record<MissionMapSourceKey, MissionMapSourceState>;
}

export interface MissionMapExecutionLink {
  executionId: string | null;
  coordinationGroupId: string | null;
  strategy: "detail" | "tree" | "thread-metadata" | "thread-context" | "derived" | "none";
  detail: string;
}

export interface MissionMapApiThreadExecutionMetadata {
  projectId?: string | null;
  safeMode?: boolean | null;
  autoValidate?: boolean | null;
  stub?: boolean | null;
  executionId?: string | null;
  rootExecutionId?: string | null;
  selectedExecutionId?: string | null;
  coordinationGroupId?: string | null;
  sessionIds?: string[] | null;
}

export interface MissionMapApiThreadContext {
  linkedArtifacts?: OperatorApiArtifact[] | null;
  activeQuarantine?: OperatorApiThreadDetail["context"] extends { activeQuarantine?: infer T }
    ? T
    : Record<string, unknown> | null;
  goalPlan?: Record<string, unknown> | null;
  group?: Record<string, unknown> | null;
  proposal?: Record<string, unknown> | null;
  latestRun?: Record<string, unknown> | null;
}

export interface MissionMapApiThreadDetail
  extends Omit<OperatorApiThreadDetail, "metadata" | "context"> {
  metadata?: {
    execution?: MissionMapApiThreadExecutionMetadata | null;
  } | null;
  context?: MissionMapApiThreadContext | null;
}

export type MissionMapApiThreadSummary = OperatorApiThreadSummary;

export interface MissionMapApiExecutionRecord {
  id?: string | null;
  state?: string | null;
  objective?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  projectPath?: string | null;
  workflowId?: string | null;
  workflowName?: string | null;
  workflowPath?: string | null;
  domainId?: string | null;
  branchKey?: string | null;
  coordinationGroupId?: string | null;
  parentExecutionId?: string | null;
  updatedAt?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  projectRole?: string | null;
  reviewStatus?: string | null;
  approvalStatus?: string | null;
  promotionStatus?: string | null;
  topology?: {
    kind?: string | null;
    rootRole?: string | null;
    projectRootExecutionId?: string | null;
    projectLaneType?: string | null;
  } | null;
  metadata?: Record<string, unknown> | null;
}

export interface MissionMapApiExecutionStepSummary {
  count?: number | null;
  byState?: Record<string, number> | null;
}

export interface MissionMapApiExecutionTreeNode {
  execution?: MissionMapApiExecutionRecord | null;
  stepSummary?: MissionMapApiExecutionStepSummary | null;
  children?: MissionMapApiExecutionTreeNode[] | null;
}

export interface MissionMapApiExecutionTree {
  selectedExecutionId?: string | null;
  rootExecutionId?: string | null;
  coordinationGroupId?: string | null;
  executionCount?: number | null;
  root?: MissionMapApiExecutionTreeNode | null;
}

export interface MissionMapApiExecutionStep {
  id?: string | null;
  role?: string | null;
  state?: string | null;
  sessionId?: string | null;
  sequence?: number | null;
  wave?: number | null;
  waveName?: string | null;
}

export interface MissionMapApiSessionRecord {
  id?: string | null;
  state?: string | null;
  role?: string | null;
  projectName?: string | null;
  runtimeAdapter?: string | null;
  transportMode?: string | null;
  launcherType?: string | null;
  startedAt?: string | null;
  updatedAt?: string | null;
}

export interface MissionMapApiExecutionDetail {
  execution?: MissionMapApiExecutionRecord | null;
  steps?: MissionMapApiExecutionStep[] | null;
  childExecutions?: MissionMapApiExecutionRecord[] | null;
  coordinationGroup?: MissionMapApiExecutionRecord[] | null;
  sessions?: Array<{
    sessionId?: string | null;
    session?: MissionMapApiSessionRecord | null;
  }> | null;
}

export interface MissionMapApiCoordinationGroupSummary {
  groupId?: string | null;
  executionCount?: number | null;
  byState?: Record<string, number> | null;
  rootExecutionIds?: string[] | null;
  childExecutionIds?: string[] | null;
  activeExecutionIds?: string[] | null;
  heldExecutionIds?: string[] | null;
  executions?: MissionMapApiExecutionRecord[] | null;
}

export interface MissionMapApiSessionLive {
  ok?: boolean;
  session?: MissionMapApiSessionRecord | null;
  diagnostics?: {
    status?: string | null;
    operatorUrgency?: string | null;
    staleSession?: boolean | null;
    staleReason?: string | null;
    suggestions?: Array<Record<string, unknown>> | null;
    lastEventType?: string | null;
    lastEventAt?: string | null;
  } | null;
  workspace?: {
    id?: string | null;
    purpose?: string | null;
    sourceWorkspaceId?: string | null;
    sourceRef?: string | null;
    sourceCommit?: string | null;
  } | null;
  launcherMetadata?: {
    cwd?: string | null;
    launcherType?: string | null;
    runtimeAdapter?: string | null;
    transportMode?: string | null;
    mode?: string | null;
  } | null;
  controlHistory?: Array<Record<string, unknown>> | null;
  controlAck?: Record<string, unknown> | null;
}

export interface MissionMapAdapterInput {
  threadSummary?: MissionMapApiThreadSummary | null;
  threadDetail?: MissionMapApiThreadDetail | null;
  threadError?: string | null;
  coordinationGroups?: MissionMapApiCoordinationGroupSummary[] | null;
  coordinationGroupsError?: string | null;
  executionLink?: MissionMapExecutionLink | null;
  executionDetail?: MissionMapApiExecutionDetail | null;
  executionError?: string | null;
  executionTree?: MissionMapApiExecutionTree | null;
  treeError?: string | null;
  sessionLives?: Record<string, MissionMapApiSessionLive>;
  sessionErrors?: Record<string, string>;
}
