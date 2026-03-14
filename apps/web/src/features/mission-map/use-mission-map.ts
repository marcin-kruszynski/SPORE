import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import {
  adaptMissionMapMission,
  resolveMissionMapExecutionLink,
} from "../../adapters/mission-map.js";
import {
  getExecutionDetail,
  getExecutionTree,
  listCoordinationGroups,
} from "../../lib/api/executions.js";
import { getOperatorThreadDetail, listOperatorThreads } from "../../lib/api/operator.js";
import { getSessionLive } from "../../lib/api/sessions.js";
import type {
  MissionMapApiCoordinationGroupSummary,
  MissionMapApiThreadDetail,
} from "../../types/mission-map.js";
import { connectExecutionStream } from "./execution-stream.js";

const THREADS_QUERY_KEY = ["mission-map", "threads"] as const;
const COORDINATION_QUERY_KEY = ["mission-map", "coordination-groups"] as const;

function selectedMissionQueryKey(options: {
  selectedThreadIds: string[];
  threadsVersion: number;
  coordinationVersion: string;
}) {
  return [
    "mission-map",
    "selected",
    options.threadsVersion,
    options.coordinationVersion,
    ...options.selectedThreadIds,
  ] as const;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Mission Map is unavailable.";
}

function collectExecutionIdsFromTree(
  tree: { root?: { execution?: { id?: string | null } | null; children?: unknown[] | null } | null } | null,
) {
  const ids = new Set<string>();
  const stack = [tree?.root ?? null];
  while (stack.length > 0) {
    const node = stack.pop() as
      | { execution?: { id?: string | null } | null; children?: unknown[] | null }
      | null
      | undefined;
    if (!node) {
      continue;
    }
    const executionId = String(node.execution?.id ?? "").trim();
    if (executionId) {
      ids.add(executionId);
    }
    const children = Array.isArray(node.children) ? node.children : [];
    stack.push(...children);
  }
  return Array.from(ids);
}

function isTerminalLikeState(value: unknown) {
  const state = String(value ?? "").trim().toLowerCase();
  return [
    "completed",
    "settled",
    "resolved",
    "approved",
    "succeeded",
    "done",
    "failed",
    "error",
    "rejected",
    "stopped",
    "canceled",
  ].includes(state);
}

function isPreLaunchState(value: unknown) {
  const state = String(value ?? "").trim().toLowerCase();
  return ["planned", "pending", "ready_for_review", "validation_required"].includes(state);
}

async function loadMissionBundle(options: {
  threadId: string;
  threadSummary: Awaited<ReturnType<typeof listOperatorThreads>>[number] | null;
  coordinationGroups: MissionMapApiCoordinationGroupSummary[];
  coordinationGroupsError: string | null;
}) {
  let threadDetail: MissionMapApiThreadDetail | null = null;
  let threadError: string | null = null;
  try {
    threadDetail = (await getOperatorThreadDetail(options.threadId)) as MissionMapApiThreadDetail;
  } catch (error) {
    threadError = getErrorMessage(error);
  }

  const executionLink = resolveMissionMapExecutionLink({
    threadSummary: options.threadSummary,
    threadDetail,
    coordinationGroups: options.coordinationGroups,
  });

  let executionDetail = null;
  let executionDetailsById: Record<string, Awaited<ReturnType<typeof getExecutionDetail>>> = {};
  let executionError: string | null = null;
  let executionTree = null;
  let treeError: string | null = null;

  if (executionLink.executionId) {
    const [detailResult, treeResult] = await Promise.allSettled([
      getExecutionDetail(executionLink.executionId),
      getExecutionTree(executionLink.executionId),
    ]);

    if (detailResult.status === "fulfilled") {
      executionDetail = detailResult.value;
      if (executionDetail?.execution?.id) {
        executionDetailsById[String(executionDetail.execution.id)] = executionDetail;
      }
    } else {
      executionError = getErrorMessage(detailResult.reason);
    }

    if (treeResult.status === "fulfilled") {
      executionTree = treeResult.value;
      const familyExecutionIds = collectExecutionIdsFromTree(executionTree).filter(
        (executionId) => executionId !== executionLink.executionId,
      );
      if (familyExecutionIds.length > 0) {
        const familyDetails = await Promise.allSettled(
          familyExecutionIds.map((executionId) => getExecutionDetail(executionId)),
        );
        for (let index = 0; index < familyExecutionIds.length; index += 1) {
          const executionId = familyExecutionIds[index];
          const detail = familyDetails[index];
          if (detail?.status === "fulfilled" && detail.value?.execution?.id) {
            executionDetailsById[String(detail.value.execution.id)] = detail.value;
          }
        }
      }
    } else {
      treeError = getErrorMessage(treeResult.reason);
    }
  }

  const sessionIds = Array.from(
    new Set(
      [
        ...((threadDetail?.metadata?.execution?.sessionIds ?? []).filter(Boolean) as string[]),
        ...Object.values(executionDetailsById)
          .flatMap((detail) => [
            ...(detail?.sessions ?? []).map((entry) => String(entry.sessionId ?? entry.session?.id ?? "").trim()),
            ...((detail?.steps ?? []).map((step) => String(step.sessionId ?? "").trim())),
          ])
          .filter(Boolean),
      ],
    ),
  );
  const sessionLives: Record<string, Awaited<ReturnType<typeof getSessionLive>>> = {};
  const sessionErrors: Record<string, string> = {};

  if (sessionIds.length > 0) {
    await Promise.all(
      sessionIds.map(async (sessionId) => {
        const knownSession = Object.values(executionDetailsById)
          .flatMap((detail) => detail?.sessions ?? [])
          .find((entry) => String(entry.sessionId ?? entry.session?.id ?? "").trim() === sessionId)
          ?.session;
        const knownStep = Object.values(executionDetailsById)
          .flatMap((detail) => detail?.steps ?? [])
          .find((step) => String(step.sessionId ?? "").trim() === sessionId);
        if (knownSession && isTerminalLikeState(knownSession.state)) {
          return;
        }
        if (knownStep && isPreLaunchState(knownStep.state)) {
          return;
        }
        try {
          sessionLives[sessionId] = await getSessionLive(sessionId);
        } catch (error) {
          sessionErrors[sessionId] = getErrorMessage(error);
        }
      }),
    );
  }

  return adaptMissionMapMission({
    threadSummary: options.threadSummary,
    threadDetail,
    threadError,
    coordinationGroups: options.coordinationGroups,
    coordinationGroupsError: options.coordinationGroupsError,
    executionLink,
    executionDetail,
    executionDetailsById,
    executionError,
    executionTree,
    treeError,
    sessionLives,
    sessionErrors,
  });
}

export function useMissionMap(selectedThreadIds: string[]) {
  const queryClient = useQueryClient();
  const [streamStatus, setStreamStatus] = useState<string | null>(null);

  const threadsQuery = useQuery({
    queryKey: THREADS_QUERY_KEY,
    queryFn: listOperatorThreads,
  });
  const coordinationGroupsQuery = useQuery({
    queryKey: COORDINATION_QUERY_KEY,
    queryFn: listCoordinationGroups,
  });

  const threadSummaries = useMemo(
    () => (Array.isArray(threadsQuery.data) ? threadsQuery.data : []),
    [threadsQuery.data],
  );
  const threadMap = useMemo(
    () => new Map(threadSummaries.map((thread) => [String(thread.id ?? ""), thread] as const)),
    [threadSummaries],
  );
  const threadsVersion = threadsQuery.dataUpdatedAt;
  const coordinationVersion = `${coordinationGroupsQuery.status}:${coordinationGroupsQuery.dataUpdatedAt}:${coordinationGroupsQuery.errorUpdatedAt}`;
  const missionQueryKey = useMemo(
    () =>
      selectedMissionQueryKey({
        selectedThreadIds,
        threadsVersion,
        coordinationVersion,
      }),
    [coordinationVersion, selectedThreadIds, threadsVersion],
  );

  const missionsQuery = useQuery({
    queryKey: missionQueryKey,
    enabled: selectedThreadIds.length > 0,
    queryFn: async () => {
      const coordinationGroups = Array.isArray(coordinationGroupsQuery.data)
        ? coordinationGroupsQuery.data
        : [];
      const coordinationGroupsError = coordinationGroupsQuery.error
        ? getErrorMessage(coordinationGroupsQuery.error)
        : null;
      return Promise.all(
        selectedThreadIds.map((threadId) =>
          loadMissionBundle({
            threadId,
            threadSummary: threadMap.get(threadId) ?? null,
            coordinationGroups,
            coordinationGroupsError,
          }),
        ),
      );
    },
    placeholderData: (previous) => previous,
  });

  const missions = useMemo(
    () => (Array.isArray(missionsQuery.data) ? missionsQuery.data : []),
    [missionsQuery.data],
  );

  const streamExecutionIds = useMemo(
    () =>
      Array.from(
        new Set(
          missions
            .map((mission) => mission.linkedExecutionId)
            .filter((executionId): executionId is string => Boolean(executionId)),
        ),
      ),
    [missions],
  );

  useEffect(() => {
    if (streamExecutionIds.length === 0) {
      setStreamStatus(null);
      return undefined;
    }

    setStreamStatus(null);
    const streams = streamExecutionIds.map((executionId) =>
      connectExecutionStream(executionId, {
        onReady() {
          setStreamStatus(null);
        },
        onEvent() {
          void Promise.all([
            queryClient.invalidateQueries({ queryKey: ["mission-map", "selected"] }),
            queryClient.invalidateQueries({ queryKey: THREADS_QUERY_KEY }),
            queryClient.invalidateQueries({ queryKey: COORDINATION_QUERY_KEY }),
          ]);
        },
        onError(message) {
          setStreamStatus(message);
        },
      }),
    );

    return () => {
      for (const stream of streams) {
        stream.close();
      }
    };
  }, [queryClient, streamExecutionIds]);

  const hasCachedMissionState = threadSummaries.length > 0 || missions.length > 0;
  const blockingLoadError = !hasCachedMissionState && threadsQuery.error ? threadsQuery.error : null;

  return {
    threadSummaries,
    missions,
    isInitialLoading:
      threadsQuery.isLoading && threadSummaries.length === 0 && missions.length === 0,
    isMissionLoading: selectedThreadIds.length > 0 && missionsQuery.isLoading && missions.length === 0,
    hasLoadedEmpty:
      !threadsQuery.isLoading && !threadsQuery.error && threadSummaries.length === 0,
    loadErrorMessage: blockingLoadError ? getErrorMessage(blockingLoadError) : null,
    refreshErrorMessage:
      hasCachedMissionState && threadsQuery.error ? getErrorMessage(threadsQuery.error) : null,
    streamStatus,
    retry: async () => {
      await Promise.all([
        threadsQuery.refetch(),
        coordinationGroupsQuery.refetch(),
        selectedThreadIds.length > 0 ? missionsQuery.refetch() : Promise.resolve(),
      ]);
    },
  };
}
