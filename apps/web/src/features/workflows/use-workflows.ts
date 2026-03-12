import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  adaptWorkflowCatalog,
  adaptWorkflowDetail,
} from "../../adapters/workflows.js";
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

const WORKFLOWS_QUERY_KEY = ["workflows", "derived"] as const;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Workflows are unavailable.";
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

async function loadWorkflowsBundle() {
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

export function useWorkflows() {
  const query = useQuery({
    queryKey: WORKFLOWS_QUERY_KEY,
    queryFn: loadWorkflowsBundle,
    placeholderData: (previous) => previous,
  });

  const catalog = useMemo(
    () => (query.data ? adaptWorkflowCatalog(query.data) : null),
    [query.data],
  );
  const workflowMap = useMemo(
    () =>
      new Map(
        (catalog?.workflows ?? []).map((workflow) => {
          const detail = query.data
            ? adaptWorkflowDetail({ id: workflow.id }, query.data)
            : null;
          return [workflow.id, detail] as const;
        }),
      ),
    [catalog?.workflows, query.data],
  );
  const hasCachedState = Boolean(catalog && catalog.workflows.length > 0);
  const blockingLoadError = hasCachedState ? null : query.error;

  return {
    catalog,
    workflows: catalog?.workflows ?? [],
    workflowMap,
    isInitialLoading: query.isLoading && !catalog,
    hasLoadedEmpty: !query.isLoading && !query.error && (catalog?.workflows.length ?? 0) === 0,
    loadErrorMessage: blockingLoadError ? getErrorMessage(blockingLoadError) : null,
    refreshErrorMessage:
      query.data?.degradedMessage ||
      (hasCachedState && query.error ? getErrorMessage(query.error) : null),
    retry: () => query.refetch(),
  };
}
