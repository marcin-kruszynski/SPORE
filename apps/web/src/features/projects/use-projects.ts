import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  adaptProjectCatalog,
  adaptProjectDetail,
} from "../../adapters/projects.js";
import {
  listCoordinationGroups,
  listExecutions,
} from "../../lib/api/executions.js";
import {
  getOperatorThreadDetail,
  listOperatorActions,
  listOperatorThreads,
} from "../../lib/api/operator.js";
import type { MissionMapApiThreadDetail } from "../../types/mission-map.js";

const PROJECTS_QUERY_KEY = ["projects", "derived"] as const;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Projects are unavailable.";
}

async function loadThreadDetails(threads: Array<{ id: string; label: string }>) {
  const failures: string[] = [];
  const results = await Promise.allSettled(
    threads.map((thread) =>
      getOperatorThreadDetail(thread.id).then(
        (detail) => detail as MissionMapApiThreadDetail,
      ),
    ),
  );
  const threadDetails = results
    .filter(
      (result): result is PromiseFulfilledResult<MissionMapApiThreadDetail> =>
        result.status === "fulfilled",
    )
    .map((result) => result.value);

  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") {
      failures.push(threads[index]?.label || threads[index]?.id || `thread-${index + 1}`);
    }
  }

  return {
    threadDetails,
    degradedMessage:
      failures.length > 0
        ? `Thread detail degraded: ${failures.join(", ")}`
        : null,
  };
}

async function loadProjectsBundle() {
  const [executions, coordinationGroups, threadSummaries, actions] = await Promise.all([
    listExecutions(),
    listCoordinationGroups(),
    listOperatorThreads(),
    listOperatorActions(),
  ]);
  const threadIds = threadSummaries
    .map((thread) => String(thread.id ?? "").trim())
    .filter(Boolean);
  const threadLabelMap = new Map(
    threadSummaries.map((thread) => [
      String(thread.id ?? "").trim(),
      String(thread.title ?? thread.summary?.objective ?? thread.id ?? "").trim(),
    ]),
  );
  const threadDetailResult = await loadThreadDetails(
    threadIds.map((threadId) => ({
      id: threadId,
      label: threadLabelMap.get(threadId) || threadId,
    })),
  );

  return {
    executions,
    coordinationGroups,
    threadSummaries,
    threadDetails: threadDetailResult.threadDetails,
    actions,
    degradedMessage: threadDetailResult.degradedMessage,
  };
}

export function useProjects() {
  const query = useQuery({
    queryKey: PROJECTS_QUERY_KEY,
    queryFn: loadProjectsBundle,
    placeholderData: (previous) => previous,
  });

  const catalog = useMemo(
    () => (query.data ? adaptProjectCatalog(query.data) : null),
    [query.data],
  );
  const projectMap = useMemo(
    () =>
      new Map(
        (catalog?.projects ?? []).map((project) => {
          const detail = query.data
            ? adaptProjectDetail({ id: project.id }, query.data)
            : null;
          return [project.id, detail] as const;
        }),
      ),
    [catalog?.projects, query.data],
  );
  const hasCachedState = Boolean(catalog && catalog.projects.length > 0);
  const blockingLoadError = hasCachedState ? null : query.error;

  return {
    catalog,
    projects: catalog?.projects ?? [],
    projectMap,
    isInitialLoading: query.isLoading && !catalog,
    hasLoadedEmpty: !query.isLoading && !query.error && (catalog?.projects.length ?? 0) === 0,
    loadErrorMessage: blockingLoadError ? getErrorMessage(blockingLoadError) : null,
    refreshErrorMessage:
      query.data?.degradedMessage ||
      (hasCachedState && query.error ? getErrorMessage(query.error) : null),
    retry: () => query.refetch(),
  };
}
