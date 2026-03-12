import {
  asArray,
  formatRelativeTimestamp,
  humanize,
  isLater,
  maxTimestamp,
  parseTimestamp,
  slugify,
  toText,
} from "./adapter-utils.js";
import { buildEvidenceHref, resolveMissionEvidenceTargetFromArtifact } from "./evidence-links.js";
import type {
  AgentCockpitViewModel,
  AgentLaneCardViewModel,
  AgentLaneState,
  AttentionItemViewModel,
  RecentArtifactViewModel,
} from "../types/agent-cockpit.js";
import type { MissionMapApiExecutionDetail, MissionMapApiSessionLive, MissionMapApiThreadDetail, MissionMapApiThreadSummary } from "../types/mission-map.js";
import type { OperatorApiAction, OperatorApiArtifact, OperatorApiMessage } from "../types/operator-chat.js";
import type {
  SelfBuildApiDashboard,
  SelfBuildApiIntegrationBranchSummary,
  SelfBuildApiProposalQueueEntry,
  SelfBuildApiRecentRunSummary,
  SelfBuildApiSummary,
  SelfBuildApiWorkspaceSummary,
} from "../types/self-build.js";

export interface AgentCockpitAdapterInput {
  threads?: MissionMapApiThreadSummary[] | null;
  threadDetails?: Record<string, MissionMapApiThreadDetail | null>;
  actions?: OperatorApiAction[] | null;
  executionDetails?: Record<string, MissionMapApiExecutionDetail | null>;
  sessionLives?: Record<string, MissionMapApiSessionLive | null>;
  selfBuildSummary?: SelfBuildApiSummary | null;
  selfBuildDashboard?: SelfBuildApiDashboard | null;
  degradedThreadIds?: string[] | null;
  degradedExecutionIds?: string[] | null;
  degradedSessionIds?: string[] | null;
  degradedReasons?: string[] | null;
}

interface ArtifactRecord {
  type: RecentArtifactViewModel["type"];
  id: string;
  label: string | null;
  fallbackLabel: string;
  status: string;
  href: string | null;
  lastSeenAt: string | null;
  labelRank: number;
  degraded: boolean;
  threadId: string | null;
}

interface AttentionCandidate {
  id: string;
  targetKey: string;
  laneId: string | null;
  threadId: string | null;
  kind: AttentionItemViewModel["kind"];
  title: string;
  summary: string;
  href: string | null;
  lastSeenAt: string | null;
  repeatCount: number;
  priority: number;
}

interface LaneDraft {
  id: string;
  duplicateIdentitySeed: string | null;
  detailRouteId: string | null;
  inspectionLimited: boolean;
  inspectionSummary: string | null;
  label: string;
  roleLabel: string;
  sessionId: string | null;
  missionId: string | null;
  missionTitle: string | null;
  executionId: string | null;
  threadId: string | null;
  stageLabel: string | null;
  latestSummary: string | null;
  lastActivityAt: string | null;
  state: AgentLaneState;
  degraded: boolean;
}

function mapRawState(value: unknown): AgentLaneState | null {
  const normalized = toText(value, "").toLowerCase();
  if (!normalized) {
    return null;
  }
  if (
    normalized.includes("error") ||
    normalized.includes("failed") ||
    normalized.includes("exception")
  ) {
    return "error";
  }
  if (
    normalized.includes("block") ||
    normalized.includes("quarantine") ||
    normalized.includes("stalled")
  ) {
    return "blocked";
  }
  if (
    normalized.includes("complete") ||
    normalized.includes("success") ||
    normalized.includes("done")
  ) {
    return "completed";
  }
  if (
    normalized.includes("wait") ||
    normalized.includes("pending") ||
    normalized.includes("held") ||
    normalized.includes("review") ||
    normalized.includes("approval")
  ) {
    return "waiting";
  }
  if (
    normalized.includes("run") ||
    normalized.includes("active") ||
    normalized.includes("progress") ||
    normalized.includes("validating")
  ) {
    return "running";
  }
  return null;
}

function normalizeLaneState(values: Array<unknown>) {
  for (const value of values) {
    const mapped = mapRawState(value);
    if (mapped) {
      return mapped;
    }
  }
  return "unknown";
}

function normalizeArtifactType(itemType: unknown): RecentArtifactViewModel["type"] | null {
  const text = toText(itemType, "");
  if (text === "proposal") {
    return "proposal";
  }
  if (text === "work-item-run") {
    return "validation";
  }
  if (text === "workspace") {
    return "workspace";
  }
  if (text === "integration-branch") {
    return "promotion";
  }
  return null;
}

function fallbackArtifactLabel(type: RecentArtifactViewModel["type"], id: string) {
  return `${humanize(type)} ${id}`;
}

function toArtifactRecordFromOperatorArtifact(input: {
  artifact: OperatorApiArtifact;
  lastSeenAt: string | null;
  threadId: string | null;
}): ArtifactRecord | null {
  const target = resolveMissionEvidenceTargetFromArtifact({
    itemType: input.artifact.itemType,
    itemId: input.artifact.itemId,
  });
  if (!target) {
    return null;
  }

  const type = normalizeArtifactType(input.artifact.itemType);
  const id = target.id;
  if (!type || !id) {
    return null;
  }

  const label = toText(input.artifact.title, "") || null;
  return {
    type,
    id,
    label,
    fallbackLabel: fallbackArtifactLabel(type, id),
    status: toText(input.artifact.status, "unknown"),
    href: buildEvidenceHref(target),
    lastSeenAt: input.lastSeenAt,
    labelRank: label ? 1 : 0,
    degraded: !label,
    threadId: input.threadId,
  };
}

function toArtifactRecordFromProposalEntry(
  entry: SelfBuildApiProposalQueueEntry,
  kind: "proposal" | "promotion",
): ArtifactRecord | null {
  const id = toText(entry.id, "");
  if (!id) {
    return null;
  }

  const target =
    kind === "proposal"
      ? { kind: "proposal" as const, id }
      : null;

  return {
    type: "proposal",
    id,
    label: toText(entry.title, "") || null,
    fallbackLabel: fallbackArtifactLabel("proposal", id),
    status: toText(entry.promotionStatus, toText(entry.status, "unknown")),
    href: target ? buildEvidenceHref(target) : null,
    lastSeenAt: null,
    labelRank: toText(entry.title, "") ? 2 : 0,
    degraded: !toText(entry.title, ""),
    threadId: null,
  };
}

function toArtifactRecordFromRunSummary(run: SelfBuildApiRecentRunSummary): ArtifactRecord | null {
  const id = toText(run.id, "");
  if (!id) {
    return null;
  }

  return {
    type: "validation",
    id,
    label: toText(run.itemTitle, "") || null,
    fallbackLabel: fallbackArtifactLabel("validation", id),
    status: toText(run.validationStatus, toText(run.status, "unknown")),
    href: buildEvidenceHref({ kind: "validation", id, subject: "run" }),
    lastSeenAt: null,
    labelRank: toText(run.itemTitle, "") ? 2 : 0,
    degraded: !toText(run.itemTitle, ""),
    threadId: null,
  };
}

function toArtifactRecordFromWorkspace(workspace: SelfBuildApiWorkspaceSummary): ArtifactRecord | null {
  const id = toText(workspace.id, "");
  if (!id) {
    return null;
  }
  const label = toText(workspace.branchName, "") || null;
  return {
    type: "workspace",
    id,
    label,
    fallbackLabel: fallbackArtifactLabel("workspace", id),
    status: toText(workspace.status, "unknown"),
    href: buildEvidenceHref({ kind: "workspace", id, subject: "workspace" }),
    lastSeenAt: null,
    labelRank: label ? 2 : 0,
    degraded: !label,
    threadId: null,
  };
}

function toArtifactRecordFromBranch(branch: SelfBuildApiIntegrationBranchSummary): ArtifactRecord | null {
  const id = toText(branch.name, "");
  if (!id) {
    return null;
  }
  const label = toText(branch.name, "") || null;
  return {
    type: "promotion",
    id,
    label,
    fallbackLabel: fallbackArtifactLabel("promotion", id),
    status: toText(branch.status, "unknown"),
    href: buildEvidenceHref({ kind: "promotion", id, subject: "branch" }),
    lastSeenAt: null,
    labelRank: label ? 2 : 0,
    degraded: !label,
    threadId: null,
  };
}

function buildArtifactModel(record: ArtifactRecord): RecentArtifactViewModel {
  const label = record.label || record.fallbackLabel;
  return {
    dedupeKey: `${record.type}:${record.id}`,
    type: record.type,
    id: record.id,
    label,
    status: record.status,
    href: record.href,
    lastSeenAt: record.lastSeenAt,
    freshnessLabel: formatRelativeTimestamp(record.lastSeenAt),
    degraded: record.degraded || label === record.fallbackLabel,
  };
}

function buildAttentionFromMessage(input: {
  message: OperatorApiMessage;
  threadId: string;
}): AttentionCandidate | null {
  const content = toText(input.message.content, "");
  if (!content) {
    return null;
  }

  const artifacts = asArray(input.message.payload?.artifacts);
  const proposalArtifact = artifacts.find(
    (artifact) => normalizeArtifactType(artifact.itemType) === "proposal",
  );
  const proposalId = toText(proposalArtifact?.itemId, "");
  const proposalTargetKey = proposalId ? `proposal:${proposalId}` : null;
  const proposalHref = proposalId ? buildEvidenceHref({ kind: "proposal", id: proposalId }) : null;

  if (/needs validation/i.test(content) && /running the configured validation flow/i.test(content)) {
    return {
      id: `validation-running:${proposalTargetKey ?? input.threadId}`,
      targetKey: proposalTargetKey ?? `thread:${input.threadId}`,
      laneId: null,
      threadId: input.threadId,
      kind: "validation-running",
      title: proposalId ? `Proposal ${proposalId} is validating` : "Validation is running",
      summary: content,
      href: proposalHref,
      lastSeenAt: toText(input.message.createdAt, "") || null,
      repeatCount: 1,
      priority: 120,
    };
  }

  if (/promotion[- ]ready/i.test(content)) {
    return {
      id: `promotion-ready:${proposalTargetKey ?? input.threadId}`,
      targetKey: proposalTargetKey ?? `thread:${input.threadId}`,
      laneId: null,
      threadId: input.threadId,
      kind: "promotion-ready",
      title: proposalId ? `Proposal ${proposalId} is promotion-ready` : "Promotion is ready",
      summary: content,
      href: proposalHref,
      lastSeenAt: toText(input.message.createdAt, "") || null,
      repeatCount: 1,
      priority: 150,
    };
  }

  return null;
}

function buildAttentionFromAction(action: OperatorApiAction): AttentionCandidate | null {
  const targetType = toText(action.targetType, "");
  const targetId = toText(action.targetId, "");
  if (!targetId) {
    return null;
  }

  const isProposalTarget = targetType === "proposal";
  const targetKey = isProposalTarget ? `proposal:${targetId}` : `${targetType}:${targetId}`;
  return {
    id: `action:${toText(action.id, targetKey)}`,
    targetKey,
    laneId: null,
    threadId: toText(action.threadId, "") || null,
    kind: isProposalTarget ? "approval" : "review",
    title: toText(action.summary, isProposalTarget ? `Proposal ${targetId} is waiting for approval` : "Review is waiting"),
    summary: toText(action.summary, "An operator decision is pending."),
    href: isProposalTarget ? buildEvidenceHref({ kind: "proposal", id: targetId }) : null,
    lastSeenAt: toText(action.requestedAt, "") || null,
    repeatCount: 1,
    priority: isProposalTarget ? 400 : 350,
  };
}

function buildAttentionFromProposalEntry(
  entry: SelfBuildApiProposalQueueEntry,
  kind: AttentionItemViewModel["kind"],
  priority: number,
): AttentionCandidate | null {
  const proposalId = toText(entry.id, "");
  if (!proposalId) {
    return null;
  }

  return {
    id: `${kind}:${proposalId}`,
    targetKey: `proposal:${proposalId}`,
    laneId: null,
    threadId: null,
    kind,
    title: toText(entry.title, `Proposal ${proposalId}`),
    summary: toText(entry.summary, humanize(kind)),
    href: buildEvidenceHref({ kind: "proposal", id: proposalId }),
    lastSeenAt: null,
    repeatCount: 1,
    priority,
  };
}

function mergeAttentionCandidates(existing: AttentionCandidate | undefined, candidate: AttentionCandidate) {
  if (!existing) {
    return candidate;
  }

  const sameSemanticKind =
    existing.kind === candidate.kind && existing.summary === candidate.summary;
  if (sameSemanticKind) {
    return {
      ...existing,
      lastSeenAt: maxTimestamp(existing.lastSeenAt, candidate.lastSeenAt),
      repeatCount: existing.repeatCount + candidate.repeatCount,
    };
  }

  if (candidate.priority > existing.priority) {
    return candidate;
  }

  if (candidate.priority === existing.priority && isLater(candidate.lastSeenAt, existing.lastSeenAt)) {
    return candidate;
  }

  return {
    ...existing,
    lastSeenAt: maxTimestamp(existing.lastSeenAt, candidate.lastSeenAt),
  };
}

function sortByRecent<T extends { lastSeenAt: string | null }>(left: T, right: T) {
  return parseTimestamp(right.lastSeenAt) - parseTimestamp(left.lastSeenAt);
}

function sortLanesByRecent(left: AgentLaneCardViewModel, right: AgentLaneCardViewModel) {
  return parseTimestamp(right.lastActivityAt) - parseTimestamp(left.lastActivityAt);
}

function hashIdentity(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function buildFallbackLaneLocalIdentity(input: {
  threadId: string;
  executionId: string | null;
  roleKey: string;
  session: MissionMapApiExecutionDetail["sessions"] extends Array<infer T>
    ? T extends { session?: infer S }
      ? S | null | undefined
      : never
    : never;
}) {
  const session = input.session;
  return JSON.stringify({
    executionId: input.executionId,
    threadId: input.threadId,
    roleKey: input.roleKey,
    startedAt: toText(session?.startedAt, ""),
    launcherType: toText(session?.launcherType, ""),
    runtimeAdapter: toText(session?.runtimeAdapter, ""),
    transportMode: toText(session?.transportMode, ""),
    projectName: toText(session?.projectName, ""),
  });
}

function buildLaneDuplicateOrderingKey(lane: LaneDraft) {
  return JSON.stringify({
    state: lane.state,
    stageLabel: lane.stageLabel,
    latestSummary: lane.latestSummary,
    lastActivityAt: lane.lastActivityAt,
    degraded: lane.degraded,
    roleLabel: lane.roleLabel,
    missionTitle: lane.missionTitle,
  });
}

function resolveStableRoleKey(input: {
  sessionRole?: string | null;
  executionRole?: string | null;
  roleLabel?: string | null;
}) {
  const stableRole = toText(input.sessionRole, toText(input.executionRole, ""));
  if (stableRole) {
    return slugify(stableRole, "agent");
  }

  return "agent";
}

export function buildAgentLaneId(input: {
  sessionId?: string | null;
  executionId?: string | null;
  threadId?: string | null;
  roleKey?: string | null;
  roleLabel?: string | null;
}) {
  const sessionId = toText(input.sessionId, "");
  if (sessionId) {
    return `session:${sessionId}`;
  }

  const roleKey = toText(input.roleKey, slugify(input.roleLabel, "agent"));
  const executionId = toText(input.executionId, "");
  if (executionId) {
    return `execution:${executionId}:role:${roleKey}`;
  }

  const threadId = toText(input.threadId, "");
  return `thread:${threadId || "unknown"}:role:${roleKey}`;
}

export function adaptAgentCockpit(input: AgentCockpitAdapterInput): AgentCockpitViewModel {
  const threads = asArray(input.threads);
  const threadDetails = input.threadDetails ?? {};
  const executionDetails = input.executionDetails ?? {};
  const sessionLives = input.sessionLives ?? {};
  const degradedThreadIds = new Set(asArray(input.degradedThreadIds));
  const degradedExecutionIds = new Set(asArray(input.degradedExecutionIds));
  const degradedSessionIds = new Set(asArray(input.degradedSessionIds));
  const degradedReasons = Array.from(new Set(asArray(input.degradedReasons).filter(Boolean)));

  const attentionByTarget = new Map<string, AttentionCandidate>();
  const allArtifacts: ArtifactRecord[] = [];
  const laneArtifactsByThreadId = new Map<string, ArtifactRecord[]>();

  const pushThreadArtifact = (threadId: string, record: ArtifactRecord | null) => {
    if (!record) {
      return;
    }
    allArtifacts.push(record);
    const existing = laneArtifactsByThreadId.get(threadId) ?? [];
    existing.push(record);
    laneArtifactsByThreadId.set(threadId, existing);
  };

  const latestSummaryByThreadId = new Map<string, string>();
  const latestSummaryTimeByThreadId = new Map<string, string | null>();

  for (const thread of threads) {
    const threadId = toText(thread.id, "");
    if (!threadId) {
      continue;
    }

    const detail = threadDetails[threadId] ?? null;
    const messages = asArray(detail?.messages).slice().sort((left, right) => {
      return parseTimestamp(toText(right.createdAt, "") || null) - parseTimestamp(toText(left.createdAt, "") || null);
    });

    const latestMessage = messages.find((message) => toText(message.content, ""));
    latestSummaryByThreadId.set(
      threadId,
      toText(
        latestMessage?.content,
        toText(detail?.summary?.lastMessageExcerpt, toText(thread.summary?.lastMessageExcerpt, "")),
      ),
    );
    latestSummaryTimeByThreadId.set(
      threadId,
      toText(latestMessage?.createdAt, toText(detail?.updatedAt, toText(thread.updatedAt, ""))) || null,
    );

    for (const message of messages) {
      const candidate = buildAttentionFromMessage({ message, threadId });
      if (candidate) {
        attentionByTarget.set(
          candidate.targetKey,
          mergeAttentionCandidates(attentionByTarget.get(candidate.targetKey), candidate),
        );
      }

      for (const artifact of asArray(message.payload?.artifacts)) {
        pushThreadArtifact(
          threadId,
          toArtifactRecordFromOperatorArtifact({
            artifact,
            lastSeenAt: toText(message.createdAt, toText(thread.updatedAt, "")) || null,
            threadId,
          }),
        );
      }
    }

    for (const artifact of asArray(detail?.context?.linkedArtifacts)) {
      pushThreadArtifact(
        threadId,
        toArtifactRecordFromOperatorArtifact({
          artifact,
          lastSeenAt: toText(thread.updatedAt, toText(detail?.updatedAt, "")) || null,
          threadId,
        }),
      );
    }
  }

  for (const action of asArray(input.actions)) {
    const candidate = buildAttentionFromAction(action);
    if (!candidate) {
      continue;
    }
    attentionByTarget.set(
      candidate.targetKey,
      mergeAttentionCandidates(attentionByTarget.get(candidate.targetKey), candidate),
    );
  }

  for (const entry of asArray(input.selfBuildSummary?.waitingApprovalProposals)) {
    const attention = buildAttentionFromProposalEntry(entry, "approval", 400);
    if (attention) {
      attentionByTarget.set(
        attention.targetKey,
        mergeAttentionCandidates(attentionByTarget.get(attention.targetKey), attention),
      );
    }
    const artifact = toArtifactRecordFromProposalEntry(entry, "proposal");
    if (artifact) {
      allArtifacts.push(artifact);
    }
  }

  for (const entry of asArray(input.selfBuildSummary?.waitingReviewProposals)) {
    const attention = buildAttentionFromProposalEntry(entry, "review", 350);
    if (attention) {
      attentionByTarget.set(
        attention.targetKey,
        mergeAttentionCandidates(attentionByTarget.get(attention.targetKey), attention),
      );
    }
    const artifact = toArtifactRecordFromProposalEntry(entry, "proposal");
    if (artifact) {
      allArtifacts.push(artifact);
    }
  }

  for (const entry of asArray(input.selfBuildSummary?.validationRequiredProposals)) {
    const attention = buildAttentionFromProposalEntry(entry, "validation-required", 240);
    if (attention) {
      attentionByTarget.set(
        attention.targetKey,
        mergeAttentionCandidates(attentionByTarget.get(attention.targetKey), attention),
      );
    }
    const artifact = toArtifactRecordFromProposalEntry(entry, "proposal");
    if (artifact) {
      allArtifacts.push(artifact);
    }
  }

  for (const entry of asArray(input.selfBuildSummary?.proposalsBlockedForPromotion)) {
    const attention = buildAttentionFromProposalEntry(entry, "promotion-blocked", 320);
    if (attention) {
      attentionByTarget.set(
        attention.targetKey,
        mergeAttentionCandidates(attentionByTarget.get(attention.targetKey), attention),
      );
    }
    const artifact = toArtifactRecordFromProposalEntry(entry, "proposal");
    if (artifact) {
      allArtifacts.push(artifact);
    }
  }

  for (const run of asArray(input.selfBuildSummary?.recentWorkItemRuns ?? input.selfBuildDashboard?.recentWorkItemRuns)) {
    const artifact = toArtifactRecordFromRunSummary(run);
    if (artifact) {
      allArtifacts.push(artifact);
    }
  }

  for (const workspace of asArray(input.selfBuildSummary?.workspaces)) {
    const artifact = toArtifactRecordFromWorkspace(workspace);
    if (artifact) {
      allArtifacts.push(artifact);
    }
  }

  for (const branch of asArray(input.selfBuildSummary?.integrationBranches)) {
    const artifact = toArtifactRecordFromBranch(branch);
    if (artifact) {
      allArtifacts.push(artifact);
    }
  }

  const mergedArtifacts = new Map<string, ArtifactRecord>();
  for (const record of allArtifacts) {
    const key = `${record.type}:${record.id}`;
    const existing = mergedArtifacts.get(key);
    if (!existing) {
      mergedArtifacts.set(key, record);
      continue;
    }

    mergedArtifacts.set(key, {
      ...existing,
      label:
        (record.labelRank > existing.labelRank ? record.label : existing.label) ??
        existing.label ??
        record.label,
      fallbackLabel:
        record.labelRank > existing.labelRank ? record.fallbackLabel : existing.fallbackLabel,
      status:
        record.status !== "unknown" && existing.status === "unknown"
          ? record.status
          : existing.status,
      href: existing.href ?? record.href,
      lastSeenAt: maxTimestamp(existing.lastSeenAt, record.lastSeenAt),
      labelRank: Math.max(existing.labelRank, record.labelRank),
      degraded: existing.degraded && record.degraded,
      threadId: existing.threadId ?? record.threadId,
    });
  }

  const recentArtifacts = Array.from(mergedArtifacts.values())
    .map(buildArtifactModel)
    .sort(sortByRecent);

  const lanes: LaneDraft[] = [];
  for (const thread of threads) {
    const threadId = toText(thread.id, "");
    if (!threadId) {
      continue;
    }

    const detail = threadDetails[threadId] ?? null;
    const executionId = toText(
      detail?.metadata?.execution?.executionId,
      toText(detail?.metadata?.execution?.selectedExecutionId, toText(detail?.metadata?.execution?.rootExecutionId, "")),
    );
    const executionDetail = executionId ? executionDetails[executionId] ?? null : null;
    const execution = executionDetail?.execution ?? null;
    const executionSessionEntries = asArray(executionDetail?.sessions).filter(
      (entry) => toText(entry.sessionId, toText(entry.session?.id, "")) || executionId,
    );
    const metadataSessionEntries = asArray(detail?.metadata?.execution?.sessionIds)
      .map((sessionId) => toText(sessionId, ""))
      .filter(Boolean)
      .filter(
        (sessionId) =>
          !executionSessionEntries.some(
            (entry) => toText(entry.sessionId, toText(entry.session?.id, "")) === sessionId,
          ),
      )
      .map((sessionId) => ({
        sessionId,
        session: null,
      }));
    const sessionEntries = [...executionSessionEntries, ...metadataSessionEntries];
    const laneSources =
      sessionEntries.length > 0
        ? sessionEntries
        : [
            {
              sessionId: null,
              session: null,
            },
          ];

    for (const source of laneSources) {
      const sessionId = toText(source.sessionId, toText(source.session?.id, "")) || null;
      const sessionLive = sessionId ? sessionLives[sessionId] ?? null : null;
      const roleLabel = humanize(
        source.session?.role,
        humanize(execution?.projectRole, humanize(detail?.progress?.currentStage, "Agent")),
      );
      const stableRoleKey = resolveStableRoleKey({
        sessionRole: toText(source.session?.role, "") || toText(sessionLive?.session?.role, "") || null,
        executionRole: toText(execution?.projectRole, "") || null,
        roleLabel,
      });
      const duplicateIdentitySeed = sessionId
        ? null
        : buildFallbackLaneLocalIdentity({
            executionId: executionId || null,
            threadId,
            roleKey: stableRoleKey,
            session: source.session,
          });
      const laneId = buildAgentLaneId({
        sessionId,
        executionId: executionId || null,
        threadId,
        roleKey: stableRoleKey,
        roleLabel,
      });

      const state = normalizeLaneState([
        sessionLive?.diagnostics?.status,
        sessionLive?.session?.state,
        source.session?.state,
        execution?.state,
        detail?.progress?.currentState,
        thread.status,
      ]);
      const lastActivityAt =
        toText(sessionLive?.diagnostics?.lastEventAt, "") ||
        toText(source.session?.updatedAt, "") ||
        latestSummaryTimeByThreadId.get(threadId) ||
        toText(thread.updatedAt, "") ||
        null;

      const threadDetailAttempted = Object.prototype.hasOwnProperty.call(threadDetails, threadId);
      const executionDetailAttempted = executionId
        ? Object.prototype.hasOwnProperty.call(executionDetails, executionId)
        : false;
      const sessionLiveAttempted = sessionId
        ? Object.prototype.hasOwnProperty.call(sessionLives, sessionId)
        : false;
      const degraded =
        degradedThreadIds.has(threadId) ||
        (executionId ? degradedExecutionIds.has(executionId) : false) ||
        (sessionId ? degradedSessionIds.has(sessionId) : false) ||
        (threadDetailAttempted && !detail) ||
        (executionId ? executionDetailAttempted && !executionDetail : false) ||
        (sessionId ? sessionLiveAttempted && !sessionLive : false);

      lanes.push({
        id: laneId,
        duplicateIdentitySeed,
        detailRouteId: laneId,
        inspectionLimited: false,
        inspectionSummary: null,
        label: roleLabel,
        roleLabel,
        sessionId,
        missionId: threadId,
        missionTitle: toText(thread.title, "Mission"),
        executionId: executionId || null,
        threadId,
        stageLabel: toText(detail?.progress?.currentStage, toText(detail?.hero?.phase, ""))
          ? humanize(toText(detail?.progress?.currentStage, toText(detail?.hero?.phase, "")))
          : null,
        latestSummary: latestSummaryByThreadId.get(threadId) ?? null,
        lastActivityAt,
        state,
        degraded,
      });
    }
  }

  const lanesByBaseId = new Map<string, LaneDraft[]>();
  for (const lane of lanes) {
    const existing = lanesByBaseId.get(lane.id) ?? [];
    existing.push(lane);
    lanesByBaseId.set(lane.id, existing);
  }
  const resolvedLanes = [...lanes];

  for (const [baseLaneId, siblingLanes] of lanesByBaseId.entries()) {
    if (siblingLanes.length <= 1) {
      continue;
    }

    const siblingsByFingerprint = new Map<string, LaneDraft[]>();
    for (const lane of siblingLanes) {
      const fingerprint = hashIdentity(lane.duplicateIdentitySeed ?? `${baseLaneId}:anon`);
      const existing = siblingsByFingerprint.get(fingerprint) ?? [];
      existing.push(lane);
      siblingsByFingerprint.set(fingerprint, existing);
    }

    const sortedFingerprints = Array.from(siblingsByFingerprint.keys()).sort();
    for (const fingerprint of sortedFingerprints) {
      const group = siblingsByFingerprint.get(fingerprint) ?? [];
      const sortedGroup = [...group].sort((left, right) => {
        return buildLaneDuplicateOrderingKey(left).localeCompare(
          buildLaneDuplicateOrderingKey(right),
        );
      });
      if (group.length === 1) {
        const lane = sortedGroup[0];
        const index = resolvedLanes.indexOf(lane);
        if (index >= 0) {
          const detailRouteId = `${baseLaneId}:lane:${fingerprint}`;
          resolvedLanes[index] = {
            ...lane,
            id: detailRouteId,
            detailRouteId,
          } satisfies LaneDraft;
        }
        continue;
      }

      sortedGroup.forEach((lane, groupIndex) => {
        const index = resolvedLanes.indexOf(lane);
        if (index >= 0) {
          const resolvedId = `${baseLaneId}:lane:${fingerprint}:dup:${groupIndex + 1}`;
          resolvedLanes[index] = {
            ...lane,
            id: resolvedId,
            detailRouteId: null,
            inspectionLimited: true,
            inspectionSummary:
              "Lane inspection is limited until this runtime exposes a stable identity.",
          } satisfies LaneDraft;
        }
      });
    }
  }

  for (const lane of resolvedLanes) {
    if (lane.state !== "blocked" && lane.state !== "error") {
      continue;
    }

    const blockedCandidate: AttentionCandidate = {
      id: `${lane.state}:${lane.id}`,
      targetKey: `lane:${lane.id}`,
      laneId: lane.id,
      threadId: lane.threadId,
      kind: lane.state === "error" ? "lane-error" : "lane-blocked",
      title: `${lane.roleLabel} lane needs attention`,
      summary:
        lane.state === "error"
          ? `${lane.roleLabel} reported an error state.`
          : `${lane.roleLabel} is blocked and needs operator attention.`,
      href: lane.detailRouteId
        ? `/cockpit/agents/${encodeURIComponent(lane.detailRouteId)}`
        : null,
      lastSeenAt: lane.lastActivityAt,
      repeatCount: 1,
      priority: lane.state === "error" ? 520 : 500,
    };
    attentionByTarget.set(
      blockedCandidate.targetKey,
      mergeAttentionCandidates(
        attentionByTarget.get(blockedCandidate.targetKey),
        blockedCandidate,
      ),
    );
  }

  const laneIdsByThreadId = new Map<string, string[]>();
  for (const lane of resolvedLanes) {
    if (!lane.threadId) {
      continue;
    }
    const existing = laneIdsByThreadId.get(lane.threadId) ?? [];
    existing.push(lane.id);
    laneIdsByThreadId.set(lane.threadId, existing);
  }

  const attention = Array.from(attentionByTarget.values())
    .map((candidate) => {
      const laneId =
        candidate.laneId ??
        (candidate.threadId ? laneIdsByThreadId.get(candidate.threadId)?.[0] ?? null : null);
      return {
        id: candidate.id,
        targetKey: candidate.targetKey,
        laneId,
        kind: candidate.kind,
        title: candidate.title,
        summary: candidate.summary,
        href: candidate.href,
        lastSeenAt: candidate.lastSeenAt,
        repeatCount: candidate.repeatCount,
        priority: candidate.priority,
      } satisfies AttentionItemViewModel;
    })
    .sort((left, right) => {
      if (right.priority !== left.priority) {
        return right.priority - left.priority;
      }
      return sortByRecent(left, right);
    });

  const recentArtifactMap = new Map(recentArtifacts.map((artifact) => [artifact.dedupeKey, artifact] as const));

  const laneCards = resolvedLanes
    .map((lane) => {
      const artifacts = (lane.threadId ? laneArtifactsByThreadId.get(lane.threadId) ?? [] : [])
        .map((artifact) => recentArtifactMap.get(`${artifact.type}:${artifact.id}`) ?? buildArtifactModel(artifact))
        .sort(sortByRecent);
      const laneAttention = attention.filter((item) => item.laneId === lane.id);

      return {
        id: lane.id,
        label: lane.label,
        roleLabel: lane.roleLabel,
        sessionId: lane.sessionId,
        state: lane.state,
        stageLabel: lane.stageLabel,
        latestSummary: lane.latestSummary,
        lastActivityAt: lane.lastActivityAt,
        freshnessLabel: formatRelativeTimestamp(lane.lastActivityAt),
        missionId: lane.missionId,
        missionTitle: lane.missionTitle,
        missionHref: "/mission-map",
        executionId: lane.executionId,
        threadId: lane.threadId,
        detailHref: lane.detailRouteId
          ? `/cockpit/agents/${encodeURIComponent(lane.detailRouteId)}`
          : null,
        inspectionLimited: lane.inspectionLimited,
        inspectionSummary: lane.inspectionSummary,
        sessionHref: lane.sessionId ? `/api/sessions/${encodeURIComponent(lane.sessionId)}/live` : null,
        artifactLinks: artifacts,
        attention: laneAttention,
        degraded: lane.degraded,
      } satisfies AgentLaneCardViewModel;
    })
    .sort(sortLanesByRecent);

  return {
    lanes: laneCards,
    attention,
    recentArtifacts,
    isDegraded: degradedReasons.length > 0,
    degradedReasons,
  };
}
