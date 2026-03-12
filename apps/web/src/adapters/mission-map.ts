import type {
  MissionMapAdapterInput,
  MissionMapApiCoordinationGroupSummary,
  MissionMapApiExecutionRecord,
  MissionMapApiExecutionStepSummary,
  MissionMapApiExecutionTreeNode,
  MissionMapApiSessionLive,
  MissionMapExecutionLink,
  MissionMapMission,
  MissionMapNode,
  MissionMapNodeState,
  MissionMapSourceKey,
  MissionMapSourceState,
} from "../types/mission-map.js";

function toText(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

function asArray<T>(value: T[] | null | undefined) {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function createSourceState(
  key: MissionMapSourceKey,
  status: MissionMapSourceState["status"],
  detail: string,
): MissionMapSourceState {
  return {
    key,
    status,
    detail,
  };
}

function normalizeNodeState(rawState: string | null | undefined): MissionMapNodeState {
  const state = toText(rawState, "idle").toLowerCase();
  if (["running", "active", "in_progress", "processing"].includes(state)) {
    return state === "active" ? "active" : "running";
  }
  if (["completed", "resolved", "approved", "succeeded", "done"].includes(state)) {
    return "completed";
  }
  if (["waiting", "waiting_operator", "waiting_review", "waiting_approval", "pending", "planned", "ready_for_review", "validation_required"].includes(state)) {
    return "waiting";
  }
  if (["blocked", "held", "paused", "quarantined"].includes(state)) {
    return "blocked";
  }
  if (["failed", "error", "rejected", "stopped", "canceled"].includes(state)) {
    return "error";
  }
  return "idle";
}

function humanize(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function summarizeStateCounts(byState: Record<string, number>) {
  const parts = Object.entries(byState)
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .map(([state, count]) => `${count} ${state}`);
  return parts.join(" · ");
}

function totalStepCount(summary: MissionMapApiExecutionStepSummary | null | undefined) {
  if (typeof summary?.count === "number" && Number.isFinite(summary.count)) {
    return summary.count;
  }
  return Object.values(summary?.byState ?? {}).reduce((sum, value) => sum + value, 0);
}

function completedStepCount(summary: MissionMapApiExecutionStepSummary | null | undefined) {
  const byState = summary?.byState ?? {};
  return (
    (byState.completed ?? 0) +
    (byState.resolved ?? 0) +
    (byState.approved ?? 0) +
    (byState.succeeded ?? 0)
  );
}

function calculateProgress(summary: MissionMapApiExecutionStepSummary | null | undefined) {
  const total = totalStepCount(summary);
  if (total <= 0) {
    return undefined;
  }
  return Math.max(0, Math.min(100, Math.round((completedStepCount(summary) / total) * 100)));
}

function executionObjective(execution: MissionMapApiExecutionRecord | null | undefined) {
  return toText(execution?.objective, "");
}

function missionObjective(input: MissionMapAdapterInput) {
  return (
    toText(input.threadDetail?.summary?.objective, "") ||
    toText(input.threadSummary?.summary?.objective, "") ||
    toText(input.threadDetail?.title, "") ||
    toText(input.threadSummary?.title, "Mission")
  );
}

function missionTitle(input: MissionMapAdapterInput) {
  return (
    toText(input.threadDetail?.title, "") ||
    toText(input.threadSummary?.title, "") ||
    toText(input.threadDetail?.id, "") ||
    toText(input.threadSummary?.id, "mission")
  );
}

function tokenize(value: string) {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((entry) => entry.length >= 4),
  );
}

function objectiveSimilarity(left: string, right: string) {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }
  let matches = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      matches += 1;
    }
  }
  return matches / Math.max(leftTokens.size, rightTokens.size);
}

function matchesProject(
  execution: MissionMapApiExecutionRecord,
  projectId: string,
) {
  if (!projectId) {
    return true;
  }
  return toText(execution.projectId, "") === projectId;
}

function normalizeComparableText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function timestampFor(value: string | null | undefined) {
  const timestamp = value ? new Date(value).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function executionRecency(execution: MissionMapApiExecutionRecord) {
  return Math.max(
    timestampFor(execution.updatedAt),
    timestampFor(execution.endedAt),
    timestampFor(execution.startedAt),
  );
}

interface DerivedExecutionCandidate {
  execution: MissionMapApiExecutionRecord;
  groupId: string | null;
  objectiveScore: number;
  exactObjectiveMatch: boolean;
  isRoot: boolean;
  isRunning: boolean;
  recency: number;
}

function compareDerivedCandidatePriority(
  left: DerivedExecutionCandidate,
  right: DerivedExecutionCandidate,
) {
  return (
    Number(right.exactObjectiveMatch) - Number(left.exactObjectiveMatch) ||
    right.objectiveScore - left.objectiveScore ||
    Number(right.isRoot) - Number(left.isRoot) ||
    Number(right.isRunning) - Number(left.isRunning) ||
    right.recency - left.recency
  );
}

function compareDerivedCandidates(
  left: DerivedExecutionCandidate,
  right: DerivedExecutionCandidate,
) {
  return (
    compareDerivedCandidatePriority(left, right) ||
    toText(left.execution.id, "").localeCompare(toText(right.execution.id, "")) ||
    toText(left.groupId, "").localeCompare(toText(right.groupId, ""))
  );
}

export function resolveMissionMapExecutionLink(
  input: Pick<
    MissionMapAdapterInput,
    | "threadSummary"
    | "threadDetail"
    | "coordinationGroups"
    | "executionDetail"
    | "executionTree"
  >,
): MissionMapExecutionLink {
  const executionFromDetail = toText(input.executionDetail?.execution?.id, "");
  if (executionFromDetail) {
    return {
      executionId: executionFromDetail,
      coordinationGroupId:
        toText(input.executionDetail?.execution?.coordinationGroupId, "") || null,
      strategy: "detail",
      detail: "Linked execution from execution detail.",
    };
  }

  const executionFromTree =
    toText(input.executionTree?.selectedExecutionId, "") ||
    toText(input.executionTree?.root?.execution?.id, "");
  if (executionFromTree) {
    return {
      executionId: executionFromTree,
      coordinationGroupId:
        toText(input.executionTree?.coordinationGroupId, "") ||
        toText(input.executionTree?.root?.execution?.coordinationGroupId, "") ||
        null,
      strategy: "tree",
      detail: "Linked execution from execution tree.",
    };
  }

  const executionMetadata = input.threadDetail?.metadata?.execution;
  const fromMetadata =
    toText(executionMetadata?.executionId, "") ||
    toText(executionMetadata?.selectedExecutionId, "") ||
    toText(executionMetadata?.rootExecutionId, "");
  if (fromMetadata) {
    return {
      executionId: fromMetadata,
      coordinationGroupId: toText(executionMetadata?.coordinationGroupId, "") || null,
      strategy: "thread-metadata",
      detail: "Linked execution from thread metadata.",
    };
  }

  const latestRun = asRecord(input.threadDetail?.context?.latestRun);
  const fromContext = toText(latestRun.executionId, "");
  if (fromContext) {
    return {
      executionId: fromContext,
      coordinationGroupId: toText(latestRun.coordinationGroupId, "") || null,
      strategy: "thread-context",
      detail: "Linked execution from thread context.",
    };
  }

  const groups = asArray(input.coordinationGroups);
  const objective = missionObjective(input);
  const projectId = toText(input.threadDetail?.metadata?.execution?.projectId, "");
  const normalizedObjective = normalizeComparableText(objective);
  const candidates: DerivedExecutionCandidate[] = [];

  for (const group of groups) {
    for (const execution of asArray(group.executions)) {
      if (!matchesProject(execution, projectId)) {
        continue;
      }
      const objectiveScore = objectiveSimilarity(
        objective,
        executionObjective(execution),
      );
      if (objectiveScore <= 0) {
        continue;
      }

      candidates.push({
          execution,
          groupId:
            toText(execution.coordinationGroupId, "") || toText(group.groupId, "") || null,
          objectiveScore,
          exactObjectiveMatch:
            normalizeComparableText(executionObjective(execution)) === normalizedObjective,
          isRoot: !toText(execution.parentExecutionId, ""),
          isRunning: normalizeNodeState(execution.state) === "running",
          recency: executionRecency(execution),
        });
    }
  }

  if (candidates.length > 0) {
    const sortedCandidates = [...candidates].sort(compareDerivedCandidates);
    const bestMatch = sortedCandidates[0];
    const secondBestMatch = sortedCandidates[1] ?? null;

    if (
      bestMatch &&
      secondBestMatch &&
      compareDerivedCandidatePriority(bestMatch, secondBestMatch) === 0
    ) {
      return {
        executionId: null,
        coordinationGroupId: null,
        strategy: "none",
        detail:
          "Multiple execution candidates matched this mission. Waiting for an explicit execution link.",
      };
    }

    return {
      executionId: toText(bestMatch.execution.id, "") || null,
      coordinationGroupId: bestMatch.groupId,
      strategy: "derived",
      detail: "Derived execution link from coordination-group objective and project matches.",
    };
  }

  return {
    executionId: null,
    coordinationGroupId: null,
    strategy: "none",
    detail: "No linked execution was found for this mission.",
  };
}

function buildExecutionOutput(summary: MissionMapApiExecutionStepSummary | null | undefined) {
  const total = totalStepCount(summary);
  if (total <= 0) {
    return null;
  }
  const completed = completedStepCount(summary);
  return `${completed}/${total} steps complete`;
}

function buildExecutionBadges(execution: MissionMapApiExecutionRecord | null | undefined) {
  return [
    toText(execution?.projectRole, ""),
    toText(execution?.branchKey, ""),
    toText(execution?.workflowId, ""),
    toText(execution?.domainId, ""),
  ].filter(Boolean);
}

function buildExecutionLabel(
  execution: MissionMapApiExecutionRecord | null | undefined,
  mission: { title: string; objective: string },
  linkedExecutionId: string | null,
  preferMissionLabel = true,
) {
  const objective = executionObjective(execution);
  const executionId = toText(execution?.id, "");
  if (
    preferMissionLabel &&
    linkedExecutionId &&
    executionId === linkedExecutionId &&
    (objective.length === 0 || objective === mission.objective)
  ) {
    return `${mission.title} execution`;
  }
  return (
    objective ||
    toText(execution?.branchKey, "") ||
    (toText(execution?.projectRole, "")
      ? `${toText(execution?.projectRole, "execution")} execution`
      : "Execution")
  );
}

function buildSessionNode(
  sessionId: string,
  sessionLive: MissionMapApiSessionLive | null,
  error: string | null,
  fallbackSession: { id?: string | null; role?: string | null; state?: string | null; runtimeAdapter?: string | null; launcherType?: string | null; transportMode?: string | null; } | null,
): MissionMapNode {
  const session = sessionLive?.session ?? fallbackSession ?? null;
  const diagnostics = sessionLive?.diagnostics ?? null;
  const role = toText(session?.role, "") || sessionId;
  const workspaceId = toText(sessionLive?.workspace?.id, "");
  const runtime = toText(session?.runtimeAdapter, "");
  const output = error
    ? error
    : [
        toText(diagnostics?.status, ""),
        workspaceId ? `workspace ${workspaceId}` : "",
        runtime,
      ]
        .filter(Boolean)
        .join(" · ");
  return {
    id: `session:${sessionId}`,
    kind: "session",
    label: `${role} session`,
    task: toText(session?.id, sessionId),
    state: error
      ? "error"
      : normalizeNodeState(
          toText(diagnostics?.status, "") || toText(session?.state, "idle"),
        ),
    output: output || undefined,
    badges: [
      toText(session?.launcherType, ""),
      toText(session?.transportMode, ""),
      toText(diagnostics?.operatorUrgency, ""),
    ].filter(Boolean),
    source: "sessions",
    children: [],
  };
}

function buildExecutionNodeFromTree(
  treeNode: MissionMapApiExecutionTreeNode,
  mission: { title: string; objective: string },
  linkedExecutionId: string | null,
  sessionIds: string[],
  sessionLives: Record<string, MissionMapApiSessionLive>,
  sessionErrors: Record<string, string>,
  sessionRecords: Map<string, { id?: string | null; role?: string | null; state?: string | null; runtimeAdapter?: string | null; launcherType?: string | null; transportMode?: string | null; }>,
  attachSessions: boolean,
): MissionMapNode | null {
  const execution = treeNode.execution ?? null;
  const executionId = toText(execution?.id, "");
  if (!executionId) {
    return null;
  }
  const childExecutions = asArray(treeNode.children)
    .map((child) =>
      buildExecutionNodeFromTree(
        child,
        mission,
        linkedExecutionId,
        sessionIds,
        sessionLives,
        sessionErrors,
        sessionRecords,
        false,
      ),
    )
    .filter((node): node is MissionMapNode => Boolean(node));
  const sessionNodes = attachSessions
    ? sessionIds.map((sessionId) =>
        buildSessionNode(
          sessionId,
          sessionLives[sessionId] ?? null,
          sessionErrors[sessionId] ?? null,
          sessionRecords.get(sessionId) ?? null,
        ),
      )
    : [];
  return {
    id: `execution:${executionId}`,
    kind: "execution",
    label: buildExecutionLabel(execution, mission, linkedExecutionId),
    task:
      [
        toText(execution?.projectRole, ""),
        toText(execution?.domainId, ""),
        toText(execution?.branchKey, ""),
      ]
        .filter(Boolean)
        .join(" · ") || "Execution lane",
    state: normalizeNodeState(execution?.state),
    progress: calculateProgress(treeNode.stepSummary),
    output: buildExecutionOutput(treeNode.stepSummary) ?? undefined,
    badges: buildExecutionBadges(execution),
    source: "tree",
    children: [...sessionNodes, ...childExecutions],
  };
}

function buildExecutionNodeFromRecord(
  execution: MissionMapApiExecutionRecord,
  mission: { title: string; objective: string },
  linkedExecutionId: string | null,
  childrenByParent: Map<string, MissionMapApiExecutionRecord[]>,
  preferMissionLabel = false,
): MissionMapNode {
  const executionId = toText(execution.id, "execution");
  const children = asArray(childrenByParent.get(executionId)).map((child) =>
    buildExecutionNodeFromRecord(child, mission, linkedExecutionId, childrenByParent),
  );
  return {
    id: `execution:${executionId}`,
    kind: "execution",
    label: buildExecutionLabel(execution, mission, linkedExecutionId, preferMissionLabel),
    task:
      [
        toText(execution.projectRole, ""),
        toText(execution.domainId, ""),
        toText(execution.branchKey, ""),
      ]
        .filter(Boolean)
        .join(" · ") || "Execution lane",
    state: normalizeNodeState(execution.state),
    badges: buildExecutionBadges(execution),
    source: "coordination",
    children,
  };
}

function findNodeById(nodes: MissionMapNode[], nodeId: string): MissionMapNode | null {
  for (const node of nodes) {
    if (node.id === nodeId) {
      return node;
    }
    const nested = findNodeById(node.children, nodeId);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function buildExecutionRootsFromCoordinationGroup(
  group: MissionMapApiCoordinationGroupSummary,
  mission: { title: string; objective: string },
  linkedExecutionId: string | null,
  sessionIds: string[],
  sessionLives: Record<string, MissionMapApiSessionLive>,
  sessionErrors: Record<string, string>,
  sessionRecords: Map<string, { id?: string | null; role?: string | null; state?: string | null; runtimeAdapter?: string | null; launcherType?: string | null; transportMode?: string | null; }>,
) {
  const executions = asArray(group.executions).filter(
    (entry): entry is MissionMapApiExecutionRecord => Boolean(toText(entry.id, "")),
  );
  const childrenByParent = new Map<string, MissionMapApiExecutionRecord[]>();
  for (const execution of executions) {
    const parentId = toText(execution.parentExecutionId, "");
    if (!parentId) {
      continue;
    }
    const current = childrenByParent.get(parentId) ?? [];
    current.push(execution);
    childrenByParent.set(parentId, current);
  }

  const rootExecutions = executions.filter((execution) => {
    const parentId = toText(execution.parentExecutionId, "");
    return !parentId || !executions.some((candidate) => candidate.id === parentId);
  });

  const roots = rootExecutions.map((execution) =>
    buildExecutionNodeFromRecord(
      execution,
      mission,
      linkedExecutionId,
      childrenByParent,
      false,
    ),
  );

  if (sessionIds.length === 0) {
    return roots;
  }

  const targetRoot = linkedExecutionId
    ? findNodeById(roots, `execution:${linkedExecutionId}`) ?? roots[0] ?? null
    : roots[0] ?? null;
  if (!targetRoot) {
    return roots;
  }

  targetRoot.children = [
    ...sessionIds.map((sessionId) =>
      buildSessionNode(
        sessionId,
        sessionLives[sessionId] ?? null,
        sessionErrors[sessionId] ?? null,
        sessionRecords.get(sessionId) ?? null,
      ),
    ),
    ...targetRoot.children,
  ];

  return roots;
}

function findCoordinationGroup(
  groups: MissionMapApiCoordinationGroupSummary[],
  link: MissionMapExecutionLink,
) {
  if (link.coordinationGroupId) {
    const exact = groups.find(
      (group) => toText(group.groupId, "") === link.coordinationGroupId,
    );
    if (exact) {
      return exact;
    }
  }
  if (!link.executionId) {
    return null;
  }
  return (
    groups.find((group) =>
      asArray(group.executions).some(
        (execution) => toText(execution.id, "") === link.executionId,
      ),
    ) ?? null
  );
}

function missionSubtitle(input: MissionMapAdapterInput, link: MissionMapExecutionLink) {
  return (
    toText(input.threadDetail?.hero?.statusLine, "") ||
    toText(input.threadSummary?.summary?.lastMessageExcerpt, "") ||
    (link.executionId
      ? `Linked execution ${link.executionId}`
      : "Waiting for linked execution data.")
  );
}

export function adaptMissionMapMission(
  input: MissionMapAdapterInput,
): MissionMapMission {
  const title = missionTitle(input);
  const objective = missionObjective(input);
  const threadId =
    toText(input.threadDetail?.id, "") ||
    toText(input.threadSummary?.id, "") ||
    title;
  const link = input.executionLink ?? resolveMissionMapExecutionLink(input);
  const coordinationGroups = asArray(input.coordinationGroups);
  const coordinationGroup = findCoordinationGroup(coordinationGroups, link);
  const warnings: string[] = [];

  if (input.threadError) {
    warnings.push(input.threadError);
  }
  if (input.executionError) {
    warnings.push(input.executionError);
  }
  if (input.treeError) {
    warnings.push(input.treeError);
  }
  if (input.coordinationGroupsError) {
    warnings.push(input.coordinationGroupsError);
  }
  for (const error of Object.values(input.sessionErrors ?? {})) {
    warnings.push(error);
  }
  if (link.strategy === "derived") {
    warnings.push(link.detail);
  }
  if (link.strategy === "none") {
    warnings.push(link.detail);
  }

  const sessionLives = input.sessionLives ?? {};
  const sessionErrors = input.sessionErrors ?? {};
  const sessionRecords = new Map(
    asArray(input.executionDetail?.sessions)
      .map((entry) => {
        const sessionId = toText(entry.sessionId, "") || toText(entry.session?.id, "");
        if (!sessionId) {
          return null;
        }
        return [sessionId, entry.session ?? null] as const;
      })
      .filter((entry): entry is readonly [string, { id?: string | null; role?: string | null; state?: string | null; runtimeAdapter?: string | null; launcherType?: string | null; transportMode?: string | null; }] => Boolean(entry)),
  );
  const sessionIds = Array.from(
    new Set(
      [
        ...asArray(input.threadDetail?.metadata?.execution?.sessionIds).map((entry) =>
          toText(entry, ""),
        ),
        ...asArray(input.executionDetail?.sessions).map((entry) =>
          toText(entry.sessionId, "") || toText(entry.session?.id, ""),
        ),
      ].filter(Boolean),
    ),
  );

  const missionNode: MissionMapNode = {
    id: `thread:${threadId}`,
    kind: "mission",
    label: title,
    task: objective,
    state: normalizeNodeState(
      toText(input.threadDetail?.status, "") || toText(input.threadSummary?.status, "active"),
    ),
    output: missionSubtitle(input, link),
    badges: [
      toText(input.threadDetail?.hero?.phase, ""),
      toText(input.threadDetail?.metadata?.execution?.projectId, ""),
    ].filter(Boolean),
    source: "thread",
    children: [],
  };

  if (input.executionTree?.root) {
    const treeRoot = buildExecutionNodeFromTree(
      input.executionTree.root,
        { title, objective },
        link.executionId,
        sessionIds,
        sessionLives,
        sessionErrors,
        sessionRecords,
        true,
      );
    if (treeRoot) {
      missionNode.children.push(treeRoot);
    }
  } else if (coordinationGroup) {
    missionNode.children.push(
      ...buildExecutionRootsFromCoordinationGroup(
        coordinationGroup,
        { title, objective },
        link.executionId,
        sessionIds,
        sessionLives,
        sessionErrors,
        sessionRecords,
      ),
    );
  } else if (input.executionDetail?.execution) {
    missionNode.children.push({
      id: `execution:${toText(input.executionDetail.execution.id, "execution")}`,
      kind: "execution",
      label: buildExecutionLabel(
        input.executionDetail.execution,
        { title, objective },
        link.executionId,
        true,
      ),
      task:
        [
          toText(input.executionDetail.execution.projectRole, ""),
          toText(input.executionDetail.execution.domainId, ""),
          toText(input.executionDetail.execution.branchKey, ""),
        ]
          .filter(Boolean)
          .join(" · ") || "Execution lane",
      state: normalizeNodeState(input.executionDetail.execution.state),
      badges: buildExecutionBadges(input.executionDetail.execution),
      source: "execution",
      children: sessionIds.map((sessionId) =>
        buildSessionNode(
          sessionId,
          sessionLives[sessionId] ?? null,
          sessionErrors[sessionId] ?? null,
          sessionRecords.get(sessionId) ?? null,
        ),
      ),
    });
  }

  const readySessionCount = sessionIds.filter((sessionId) => sessionLives[sessionId]).length;
  const sourceState = {
    thread: input.threadDetail || input.threadSummary
      ? createSourceState(
          "thread",
          input.threadError ? "partial" : "ready",
          input.threadError ? `thread partial: ${input.threadError}` : "thread ready",
        )
      : createSourceState("thread", "missing", "thread missing"),
    execution: link.executionId
      ? createSourceState(
          "execution",
          input.executionDetail
            ? "ready"
            : link.strategy === "derived"
              ? "partial"
              : input.executionError
                ? "partial"
                : "missing",
          input.executionDetail
            ? "execution ready"
            : link.strategy === "derived"
              ? "execution partial"
              : input.executionError
                ? `execution partial: ${input.executionError}`
                : "execution missing",
        )
      : createSourceState("execution", "missing", "execution missing"),
    tree: input.executionTree?.root
      ? createSourceState("tree", "ready", "tree ready")
      : input.treeError
        ? createSourceState("tree", "partial", `tree partial: ${input.treeError}`)
        : createSourceState("tree", "missing", "tree missing"),
    coordination: coordinationGroup
      ? createSourceState("coordination", "ready", "coordination ready")
      : input.coordinationGroupsError
        ? createSourceState(
            "coordination",
            "partial",
            `coordination partial: ${input.coordinationGroupsError}`,
          )
        : coordinationGroups.length > 0
          ? createSourceState("coordination", "missing", "coordination missing")
          : createSourceState("coordination", "missing", "coordination missing"),
    sessions: sessionIds.length === 0
      ? createSourceState("sessions", "missing", "sessions missing")
      : readySessionCount === sessionIds.length && Object.keys(sessionErrors).length === 0
        ? createSourceState("sessions", "ready", "sessions ready")
        : readySessionCount > 0 || Object.keys(sessionErrors).length > 0
          ? createSourceState("sessions", "partial", "sessions partial")
          : createSourceState("sessions", "missing", "sessions missing"),
  } satisfies Record<MissionMapSourceKey, MissionMapSourceState>;

  return {
    threadId,
    title,
    status:
      toText(input.threadDetail?.status, "") ||
      toText(input.threadSummary?.status, "active"),
    objective,
    subtitle: missionSubtitle(input, link),
    linkedExecutionId: link.executionId,
    linkedCoordinationGroupId:
      link.coordinationGroupId || toText(coordinationGroup?.groupId, "") || null,
    rootNodes: [missionNode],
    warnings: Array.from(new Set(warnings.filter(Boolean))),
    sourceState,
  };
}
