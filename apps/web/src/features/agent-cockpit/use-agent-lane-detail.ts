import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  asArray,
  asRecord,
  formatRelativeTimestamp,
  humanize,
  parseTimestamp,
  toText,
} from "../../adapters/adapter-utils.js";
import {
  AGENT_COCKPIT_BOOTSTRAP_QUERY_KEY,
  AGENT_COCKPIT_QUERY_KEY,
  getAgentCockpitErrorMessage,
  loadAgentCockpitBootstrapModel,
} from "./use-agent-cockpit.js";
import { getExecutionDetail } from "../../lib/api/executions.js";
import { ApiError } from "../../lib/api/http.js";
import { getOperatorThreadDetail } from "../../lib/api/operator.js";
import { getSessionArtifact, getSessionLive } from "../../lib/api/sessions.js";
import type { AgentLaneCardViewModel, AgentSessionDetailViewModel } from "../../types/agent-cockpit.js";
import type {
  MissionMapApiExecutionDetail,
  MissionMapApiSessionEvent,
  MissionMapApiSessionLive,
  MissionMapApiThreadDetail,
} from "../../types/mission-map.js";
import type { OperatorApiMessage } from "../../types/operator-chat.js";

const AGENT_LANE_DETAIL_QUERY_KEY = "agent-cockpit-lane-detail";

function sortByRecent<T extends { timestamp: string | null }>(left: T, right: T) {
  return parseTimestamp(right.timestamp) - parseTimestamp(left.timestamp);
}

function buildMissionContext(
  lane: AgentLaneCardViewModel | null,
  previous: AgentSessionDetailViewModel | null,
) {
  if (lane?.missionTitle || lane?.missionId) {
    return {
      kind: "confirmed" as const,
      title: lane.missionTitle,
      href: lane.missionHref,
      summary: lane.missionTitle
        ? `${lane.missionTitle} remains the linked mission.`
        : "Mission linkage is available.",
    };
  }

  if (previous?.mission.title) {
    return {
      kind: "partial" as const,
      title: previous.mission.title,
      href: previous.mission.href,
      summary: `Mission linkage is partial. Last known mission ${previous.mission.title} is no longer confirmed.`,
    };
  }

  return {
    kind: "unknown" as const,
    title: null,
    href: null,
    summary: "Mission linkage unavailable.",
  };
}

function buildExecutionContext(
  lane: AgentLaneCardViewModel | null,
  executionDetail: MissionMapApiExecutionDetail | null,
  previous: AgentSessionDetailViewModel | null,
) {
  const executionId = lane?.executionId ?? null;
  if (executionId) {
    const objective = toText(executionDetail?.execution?.objective, "");
    return {
      kind: "confirmed" as const,
      id: executionId,
      href: null,
      summary: objective || `Execution ${executionId} is linked to this lane.`,
    };
  }

  if (previous?.execution.id) {
    return {
      kind: "partial" as const,
      id: previous.execution.id,
      href: previous.execution.href,
      summary: `Execution linkage is partial. Last known execution ${previous.execution.id} is no longer confirmed.`,
    };
  }

  return {
    kind: "unknown" as const,
    id: null,
    href: null,
    summary: "Execution linkage unavailable.",
  };
}

function toThreadUpdate(message: OperatorApiMessage, index: number) {
  const summary = toText(message.content, "");
  if (!summary) {
    return null;
  }

  const timestamp = toText(message.createdAt, "") || null;
  return {
    id: `thread:${toText(message.id, String(index))}`,
    summary,
    source: "thread" as const,
    timestamp,
    freshnessLabel: formatRelativeTimestamp(timestamp),
  };
}

function toSessionUpdate(event: MissionMapApiSessionEvent, index: number) {
  const payload = asRecord(event.payload);
  const summary =
    toText(payload.summary, "") ||
    toText(payload.message, "") ||
    toText(payload.status, "") ||
    humanize(event.type, "");
  if (!summary) {
    return null;
  }

  const timestamp = toText(event.createdAt, toText(event.timestamp, "")) || null;
  return {
    id: `session:${toText(event.id, String(index))}`,
    summary,
    source: "session" as const,
    timestamp,
    freshnessLabel: formatRelativeTimestamp(timestamp),
  };
}

function buildSessionEvents(sessionLive: MissionMapApiSessionLive | null) {
  return asArray(sessionLive?.events)
    .map((event, index) => {
      const update = toSessionUpdate(event, index);
      if (!update) {
        return null;
      }
      return {
        ...update,
        type: humanize(event.type, "Session update"),
      };
    })
    .filter(Boolean)
    .sort(sortByRecent) as Array<{
    id: string;
    type: string;
    summary: string;
    timestamp: string | null;
    freshnessLabel: string;
  }>;
}

function buildTranscriptPreview(input: {
  transcript: { content?: string | Record<string, unknown> | Array<Record<string, unknown>>; path?: string | null } | null;
  sessionLive: MissionMapApiSessionLive | null;
  previous: AgentSessionDetailViewModel | null;
  recentUpdates: Array<{ summary: string }>;
}) {
  const rawContent =
    typeof input.transcript?.content === "string"
      ? input.transcript.content
      : input.recentUpdates[0]?.summary ?? input.previous?.transcriptPreview.content ?? null;
  const content = rawContent?.trim() ? rawContent.trim() : null;
  const preview = content ? content.split(/\r?\n/).slice(0, 12).join("\n") : null;
  return {
    content: preview,
    path:
      input.transcript?.path ??
      toText(input.sessionLive?.artifacts?.transcript?.path, "") ??
      input.previous?.transcriptPreview.path ??
      null,
    truncated: Boolean(content && preview && content.length > preview.length),
  };
}

function stringifyValue(value: unknown) {
  if (typeof value === "string") {
    return value.trim() || null;
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return null;
}

function summarizeStructuredValue(value: unknown) {
  const record = asRecord(value);
  return firstNonEmptyText(
    record.outcome,
    record.summary,
    record.title,
    record.objective,
    record.message,
    record.details,
    record.note,
    record.path,
    record.action,
    typeof value === "string" ? value : null,
  );
}

function firstNonEmptyText(...values: unknown[]) {
  for (const value of values) {
    const text = toText(value, "").trim();
    if (text) {
      return text;
    }
  }
  return null;
}

function toTextList(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.values(value)
      .flatMap((entry) => toTextList(entry))
      .filter(Boolean);
  }
  if (!Array.isArray(value)) {
    const single = summarizeStructuredValue(value);
    return single ? [single] : [];
  }

  return value
    .map((entry) =>
      summarizeStructuredValue(entry) ??
      (entry && typeof entry === "object" ? stringifyValue(entry) : null),
    )
    .map((entry) => toText(entry, "").trim())
    .filter(Boolean);
}

function appendListSection(lines: string[], title: string, items: string[]) {
  if (items.length === 0) {
    return;
  }

  if (lines.length > 0) {
    lines.push("");
  }
  lines.push(`${title}:`);
  lines.push(...items.map((item) => `- ${item}`));
}

function buildReadablePayloadContent(payload: Record<string, unknown> | null) {
  if (!payload) {
    return null;
  }

  const lines: string[] = [];
  const primaryText = firstNonEmptyText(
    summarizeStructuredValue(payload.summary),
    payload.outcome,
    payload.message,
    payload.request,
    payload.instructions,
    payload.objective,
    payload.title,
  );
  if (primaryText) {
    lines.push(primaryText);
  }

  appendListSection(
    lines,
    "Findings",
    toTextList(payload.findings),
  );
  appendListSection(
    lines,
    "Recommendations",
    toTextList(payload.recommendations),
  );
  appendListSection(
    lines,
    "Evidence",
    toTextList(payload.evidence),
  );
  appendListSection(
    lines,
    "Scope",
    toTextList(payload.scope),
  );
  appendListSection(
    lines,
    "Changed paths",
    toTextList(payload.changed_paths ?? payload.changedPaths ?? payload.paths ?? payload.files),
  );
  appendListSection(
    lines,
    "Tests run",
    toTextList(payload.tests_run ?? payload.testsRun ?? payload.commands ?? payload.checks),
  );
  appendListSection(lines, "Notes", toTextList(payload.notes ?? payload.risks ?? payload.followUps));

  if (lines.length > 0) {
    return lines.join("\n");
  }

  return stringifyValue(payload);
}

function buildRequestPrompt(input: {
  lane: AgentLaneCardViewModel;
  threadDetail: MissionMapApiThreadDetail | null;
  context: {
    content?: string | Record<string, unknown> | Array<Record<string, unknown>>;
  } | null;
}) {
  const parsedContext = asRecord(input.context?.content);
  const inboundList = Array.isArray(asRecord(parsedContext.handoffs).inbound)
    ? (asRecord(parsedContext.handoffs).inbound as unknown[])
    : [];
  const inbound = asRecord(inboundList[0]);
  const inboundSummary = asRecord(inbound.summary);
  const inboundPayload = asRecord(inbound.payload);
  const expected = toText(asRecord(asRecord(parsedContext.handoffs).expected).kind, "") || null;
  const source =
    toText(inbound.sourceRole, "") ||
    toText(asRecord(parsedContext.session).role, "") ||
    input.lane.roleLabel;
  return {
    title: `Input sent to ${input.lane.roleLabel}`,
    content:
      firstNonEmptyText(
        inboundSummary.outcome,
        inboundSummary.summary,
        inboundSummary.title,
        buildReadablePayloadContent(inboundPayload),
        toText(asRecord(asRecord(parsedContext.goalPlan).goal).task, ""),
        toText(input.threadDetail?.summary?.objective, ""),
        input.lane.latestSummary,
      ) ||
      buildReadablePayloadContent(asRecord(parsedContext.goalPlan)) ||
      buildReadablePayloadContent(asRecord(parsedContext.session)) ||
      toText(input.threadDetail?.summary?.objective, "") ||
      input.lane.latestSummary ||
      stringifyValue(inboundPayload) ||
      null,
    source: source ? humanize(source) : null,
    expectedKind: expected ? humanize(expected) : null,
  };
}

function buildReturnedHandoff(input: {
  handoff: Record<string, unknown> | null;
  transcriptPreview: { content: string | null };
}) {
  const primary = asRecord(input.handoff?.primary);
  const validation = asRecord(primary.validation);
  const issues = asArray(Array.isArray(validation.issues) ? validation.issues : [])
    .map((issue) => toText(asRecord(issue).message, ""))
    .filter(Boolean);

  return {
    title: `Returned ${humanize(toText(primary.kind, "handoff") || "handoff")}`,
    content:
      buildReadablePayloadContent(asRecord(primary.payload)) ||
      input.transcriptPreview.content ||
      null,
    valid:
      typeof validation.valid === "boolean" ? Boolean(validation.valid) : null,
    issues,
  };
}

function dedupeUpdates(
  updates: Array<{
    id: string;
    summary: string;
    source: "thread" | "session";
    timestamp: string | null;
    freshnessLabel: string;
  }>,
) {
  const sortedUpdates = [...updates].sort(sortByRecent);
  const seen = new Set<string>();
  return sortedUpdates.filter((update) => {
    const key = `${update.source}:${update.summary}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function collectUpdates(input: {
  lane: AgentLaneCardViewModel;
  threadDetail: MissionMapApiThreadDetail | null;
  sessionLive: MissionMapApiSessionLive | null;
  previous: AgentSessionDetailViewModel | null;
}) {
  const updates = dedupeUpdates(
    [
      ...asArray(input.threadDetail?.messages).map(toThreadUpdate).filter(Boolean),
      ...asArray(input.sessionLive?.events).map(toSessionUpdate).filter(Boolean),
    ] as Array<{
      id: string;
      summary: string;
      source: "thread" | "session";
      timestamp: string | null;
      freshnessLabel: string;
    }>,
  ).sort(sortByRecent);

  if (updates.length > 0) {
    return updates;
  }

  if (input.previous?.recentUpdates.length) {
    return input.previous.recentUpdates;
  }

  if (input.lane.latestSummary) {
    return [
      {
        id: `lane:${input.lane.id}`,
        summary: input.lane.latestSummary,
        source: "thread" as const,
        timestamp: input.lane.lastActivityAt,
        freshnessLabel: formatRelativeTimestamp(input.lane.lastActivityAt),
      },
    ];
  }

  return [];
}

function buildInspection(input: {
  sessionLive: MissionMapApiSessionLive | null;
  lane: AgentLaneCardViewModel;
  previous: AgentSessionDetailViewModel | null;
}) {
  return {
    tmuxSession:
      toText(input.sessionLive?.launcherMetadata?.tmuxSession, "") ||
      toText(input.sessionLive?.session?.tmuxSession, "") ||
      input.previous?.inspection.tmuxSession ||
      null,
    transcriptPath:
      toText(input.sessionLive?.session?.transcriptPath, "") ||
      toText(input.sessionLive?.artifacts?.transcript?.path, "") ||
      input.previous?.inspection.transcriptPath ||
      null,
    launchCommand:
      toText(input.sessionLive?.session?.launchCommand, "") ||
      input.previous?.inspection.launchCommand ||
      null,
    cwd:
      toText(input.sessionLive?.launcherMetadata?.cwd, "") ||
      toText(input.sessionLive?.launchContext?.cwd, "") ||
      input.previous?.inspection.cwd ||
      null,
    workspaceId:
      toText(input.sessionLive?.workspace?.id, "") ||
      toText(input.sessionLive?.launchContext?.workspaceId, "") ||
      input.previous?.inspection.workspaceId ||
      null,
    workspacePurpose:
      toText(input.sessionLive?.workspace?.purpose, "") ||
      input.previous?.inspection.workspacePurpose ||
      null,
    branchName:
      toText(input.sessionLive?.launchContext?.branchName, "") ||
      input.previous?.inspection.branchName ||
      null,
    runtimeAdapter:
      toText(input.sessionLive?.launcherMetadata?.runtimeAdapter, "") ||
      toText(input.sessionLive?.session?.runtimeAdapter, "") ||
      input.previous?.inspection.runtimeAdapter ||
      null,
    transportMode:
      toText(input.sessionLive?.launcherMetadata?.transportMode, "") ||
      toText(input.sessionLive?.session?.transportMode, "") ||
      input.previous?.inspection.transportMode ||
      null,
    launcherType:
      toText(input.sessionLive?.launcherMetadata?.launcherType, "") ||
      toText(input.sessionLive?.session?.launcherType, "") ||
      input.previous?.inspection.launcherType ||
      null,
    lastEventType:
      toText(input.sessionLive?.diagnostics?.lastEventType, "") ||
      input.previous?.inspection.lastEventType ||
      null,
    lastEventAt:
      toText(input.sessionLive?.diagnostics?.lastEventAt, "") ||
      input.previous?.inspection.lastEventAt ||
      null,
  };
}

function buildSessionHealth(input: {
  lane: AgentLaneCardViewModel;
  sessionLive: MissionMapApiSessionLive | null;
  sessionError: unknown;
  previous: AgentSessionDetailViewModel | null;
  degraded: boolean;
}) {
  if (!input.lane.sessionId) {
    return {
      kind: "unavailable" as const,
      label: "Session unavailable",
      message: "This lane does not expose a live session id yet.",
    };
  }

  if (input.sessionError) {
    if (input.sessionError instanceof ApiError && input.sessionError.status === 404) {
      return {
        kind: "unavailable" as const,
        label: "Session unavailable",
        message: "The live session snapshot is no longer available. Showing the last visible lane context.",
      };
    }

    if (input.previous && input.previous.sessionId === input.lane.sessionId) {
      return {
        kind: "reconnecting" as const,
        label: "Reconnecting to live session",
        message: `${getAgentCockpitErrorMessage(input.sessionError)} Showing the previous lane snapshot while live reads recover.`,
      };
    }

    return {
      kind: "unavailable" as const,
      label: "Session unavailable",
      message: getAgentCockpitErrorMessage(input.sessionError),
    };
  }

  if (!input.sessionLive) {
    return {
      kind: "unavailable" as const,
      label: "Session unavailable",
      message: "A live session snapshot is not available for this lane.",
    };
  }

  if (input.degraded || input.lane.degraded) {
    return {
      kind: "degraded" as const,
      label: "Session degraded",
      message: "Showing live lane context with partial linkage while related sources recover.",
    };
  }

  return {
    kind: "live" as const,
    label: "Session live",
    message: "Live session reads are current.",
  };
}

function buildUnavailableDetail(
  routeLaneId: string,
  previous: AgentSessionDetailViewModel | null,
  reason: string,
): AgentSessionDetailViewModel {
  return {
    laneId: routeLaneId,
    label: previous?.label ?? "Unknown lane",
    sessionId: previous?.sessionId ?? null,
    state: previous?.state ?? "unknown",
    stageLabel: previous?.stageLabel ?? null,
    summary: previous?.summary ?? null,
    latestSummary: previous?.latestSummary ?? null,
    lastActivityAt: previous?.lastActivityAt ?? null,
    freshnessLabel: formatRelativeTimestamp(previous?.lastActivityAt ?? null),
    requestPrompt: previous?.requestPrompt ?? {
      title: "Input sent to agent",
      content: null,
      source: null,
      expectedKind: null,
    },
    returnedHandoff: previous?.returnedHandoff ?? {
      title: "Returned handoff",
      content: null,
      valid: null,
      issues: [],
    },
    mission: previous?.mission ?? {
      kind: "unknown",
      title: null,
      href: null,
      summary: "Mission linkage unavailable.",
    },
    execution: previous?.execution ?? {
      kind: "unknown",
      id: null,
      href: null,
      summary: "Execution linkage unavailable.",
    },
    sessionHealth: {
      kind: "unavailable",
      label: "Session unavailable",
      message: reason,
    },
    sessionHref: previous?.sessionHref ?? null,
    recentUpdates: previous?.recentUpdates ?? [],
    lastVisibleOutputs: previous?.lastVisibleOutputs ?? [],
    sessionEvents: previous?.sessionEvents ?? [],
    transcriptPreview: previous?.transcriptPreview ?? {
      content: null,
      path: null,
      truncated: false,
    },
    inspection: previous?.inspection ?? {
      tmuxSession: null,
      transcriptPath: null,
      launchCommand: null,
      cwd: null,
      workspaceId: null,
      workspacePurpose: null,
      branchName: null,
      runtimeAdapter: null,
      transportMode: null,
      launcherType: null,
      lastEventType: null,
      lastEventAt: null,
    },
    artifacts: previous?.artifacts ?? [],
    attention: previous?.attention ?? [],
    degraded: true,
    unavailable: {
      routeLaneId,
      reason,
      label: previous?.label ?? null,
      sessionId: previous?.sessionId ?? null,
      missionTitle: previous?.mission.title ?? null,
      missionHref: previous?.mission.href ?? null,
    },
  };
}

function buildDetailModel(input: {
  lane: AgentLaneCardViewModel;
  threadDetail: MissionMapApiThreadDetail | null;
  executionDetail: MissionMapApiExecutionDetail | null;
  sessionLive: MissionMapApiSessionLive | null;
  transcript: {
    content?: string | Record<string, unknown> | Array<Record<string, unknown>>;
    path?: string | null;
  } | null;
  context: {
    content?: string | Record<string, unknown> | Array<Record<string, unknown>>;
    path?: string | null;
  } | null;
  sessionError: unknown;
  previous: AgentSessionDetailViewModel | null;
  degraded: boolean;
}) {
  const recentUpdates = collectUpdates({
    lane: input.lane,
    threadDetail: input.threadDetail,
    sessionLive: input.sessionLive,
    previous: input.previous,
  });
  const latestSummary = recentUpdates[0]?.summary ?? input.lane.latestSummary ?? input.previous?.latestSummary ?? null;
  const liveLastEventAt = toText(input.sessionLive?.diagnostics?.lastEventAt, "") || null;
  const artifacts = Array.from(
    new Map(input.lane.artifactLinks.map((artifact) => [artifact.dedupeKey, artifact])).values(),
  );
  const lastActivityAt =
    recentUpdates[0]?.timestamp ??
    liveLastEventAt ??
    input.lane.lastActivityAt ??
    input.previous?.lastActivityAt ??
    null;

  const transcriptPreview = buildTranscriptPreview({
    transcript: input.transcript,
    sessionLive: input.sessionLive,
    previous: input.previous,
    recentUpdates,
  });

  return {
    laneId: input.lane.id,
    label: input.lane.label,
    sessionId: input.lane.sessionId,
    state: input.lane.state,
    stageLabel: input.lane.stageLabel,
    summary: toText(input.threadDetail?.summary?.objective, "") || input.previous?.summary || null,
    latestSummary,
    lastActivityAt,
    freshnessLabel: formatRelativeTimestamp(lastActivityAt),
    requestPrompt: buildRequestPrompt({
      lane: input.lane,
      threadDetail: input.threadDetail,
      context: input.context,
    }),
    returnedHandoff: buildReturnedHandoff({
      handoff: asRecord(input.sessionLive?.handoff),
      transcriptPreview,
    }),
    mission: buildMissionContext(input.lane, input.previous),
    execution: buildExecutionContext(input.lane, input.executionDetail, input.previous),
    sessionHealth: buildSessionHealth({
      lane: input.lane,
      sessionLive: input.sessionLive,
      sessionError: input.sessionError,
      previous: input.previous,
      degraded: input.degraded,
    }),
    sessionHref: input.lane.sessionHref,
    recentUpdates,
    lastVisibleOutputs:
      input.sessionError && input.previous?.lastVisibleOutputs.length
        ? input.previous.lastVisibleOutputs
        : recentUpdates.slice(0, 3),
    sessionEvents: buildSessionEvents(input.sessionLive),
    transcriptPreview,
    inspection: buildInspection({
      sessionLive: input.sessionLive,
      lane: input.lane,
      previous: input.previous,
    }),
    artifacts,
    attention: input.lane.attention,
    degraded: input.degraded || input.lane.degraded || Boolean(input.sessionError),
    unavailable: null,
  } satisfies AgentSessionDetailViewModel;
}

async function loadAgentLaneDetailModel(input: {
  laneId: string;
  queryClient: ReturnType<typeof useQueryClient>;
  previous: AgentSessionDetailViewModel | null;
}) {
  const cockpitModel = await input.queryClient.fetchQuery({
    queryKey: AGENT_COCKPIT_BOOTSTRAP_QUERY_KEY,
    queryFn: loadAgentCockpitBootstrapModel,
  });
  const lane = cockpitModel.lanes.find((entry) => entry.id === input.laneId) ?? null;

  if (!lane) {
    return buildUnavailableDetail(
      input.laneId,
      input.previous,
      "This lane is no longer present in the latest cockpit snapshot.",
    );
  }

  const [threadResult, executionResult, sessionResult] = await Promise.allSettled([
    lane.threadId ? getOperatorThreadDetail(lane.threadId) : Promise.resolve(null),
    lane.executionId ? getExecutionDetail(lane.executionId) : Promise.resolve(null),
    lane.sessionId ? getSessionLive(lane.sessionId) : Promise.resolve(null),
  ]);

  const sessionLive =
    sessionResult.status === "fulfilled"
      ? (sessionResult.value as MissionMapApiSessionLive | null)
      : null;
  const artifactResults = await Promise.allSettled([
    lane.sessionId && sessionLive?.artifacts?.transcript?.exists
      ? getSessionArtifact(lane.sessionId, "transcript")
      : Promise.resolve(null),
    lane.sessionId && sessionLive?.artifacts?.context?.exists
      ? getSessionArtifact(lane.sessionId, "context")
      : Promise.resolve(null),
  ]);

  return buildDetailModel({
    lane,
    threadDetail: threadResult.status === "fulfilled" ? (threadResult.value as MissionMapApiThreadDetail | null) : null,
    executionDetail:
      executionResult.status === "fulfilled"
        ? (executionResult.value as MissionMapApiExecutionDetail | null)
        : null,
    sessionLive,
    transcript:
      artifactResults[0]?.status === "fulfilled"
        ? artifactResults[0].value
        : null,
    context:
      artifactResults[1]?.status === "fulfilled"
        ? artifactResults[1].value
        : null,
    sessionError: sessionResult.status === "rejected" ? sessionResult.reason : null,
    previous: input.previous,
    degraded: threadResult.status === "rejected" || executionResult.status === "rejected",
  });
}

export function useAgentLaneDetail(laneId: string | undefined) {
  const queryClient = useQueryClient();
  const previousDetailRef = useRef<{
    laneId: string;
    detail: AgentSessionDetailViewModel;
  } | null>(null);

  const getPreviousForLane = useCallback(() => {
    return laneId && previousDetailRef.current?.laneId === laneId
      ? previousDetailRef.current.detail
      : null;
  }, [laneId]);

  const query = useQuery({
    queryKey: [AGENT_LANE_DETAIL_QUERY_KEY, laneId],
    enabled: Boolean(laneId),
    queryFn: () =>
      loadAgentLaneDetailModel({
        laneId: laneId ?? "unknown",
        queryClient,
        previous: getPreviousForLane(),
      }),
    refetchInterval: 15000,
  });

  useEffect(() => {
    if (query.data && !query.data.unavailable && laneId) {
      previousDetailRef.current = {
        laneId,
        detail: query.data,
      };
    }
  }, [laneId, query.data]);

  const model = useMemo(() => {
    if (query.data) {
      return query.data;
    }

    const previousForLane = getPreviousForLane();

    if (query.error && previousForLane) {
      return buildUnavailableDetail(
        laneId ?? "unknown",
        previousForLane,
        getAgentCockpitErrorMessage(query.error),
      );
    }

    return null;
  }, [getPreviousForLane, laneId, query.data, query.error]);

  return {
    model,
    isInitialLoading: query.isLoading && !model,
    loadErrorMessage: !model && query.error ? getAgentCockpitErrorMessage(query.error) : null,
    retry: async () => {
      await queryClient.invalidateQueries({ queryKey: AGENT_COCKPIT_QUERY_KEY, exact: true });
      return query.refetch();
    },
  };
}
