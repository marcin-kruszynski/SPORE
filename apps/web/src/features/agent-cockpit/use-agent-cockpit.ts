import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { toText } from "../../adapters/adapter-utils.js";
import { adaptAgentCockpit } from "../../adapters/agent-cockpit.js";
import { getExecutionDetail, getExecutionTree } from "../../lib/api/executions.js";
import { getOperatorThreadDetail, listOperatorActions, listOperatorThreads } from "../../lib/api/operator.js";
import { getSessionLive, listSessions } from "../../lib/api/sessions.js";
import { getSelfBuildDashboard, getSelfBuildSummary } from "../../lib/api/self-build.js";
import { getWorkItemRun, getWorkItemRunWorkspace } from "../../lib/api/validation-runs.js";
import { listWorkspaces } from "../../lib/api/workspaces.js";
import type { AgentCockpitViewModel } from "../../types/agent-cockpit.js";
import type {
  MissionMapApiExecutionTree,
  MissionMapApiSessionListEntry,
  MissionMapApiThreadDetail,
} from "../../types/mission-map.js";
import type { WorkItemRunApiDetail, WorkspaceApiDetail } from "../../types/self-build.js";

export const AGENT_COCKPIT_QUERY_KEY = ["agent-cockpit", "page"] as const;
export const AGENT_COCKPIT_BOOTSTRAP_QUERY_KEY = ["agent-cockpit", "bootstrap"] as const;

export function getAgentCockpitErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Agent Cockpit is unavailable.";
}

function collectExecutionIdsFromTree(tree: MissionMapApiExecutionTree | null | undefined) {
  const executionIds = new Set<string>();

  function visit(node: MissionMapApiExecutionTree["root"]) {
    if (!node) {
      return;
    }
    const executionId = toText(node.execution?.id, "");
    if (executionId) {
      executionIds.add(executionId);
    }
    for (const child of node.children ?? []) {
      visit(child);
    }
  }

  visit(tree?.root ?? null);
  return executionIds;
}

type AgentCockpitLoadOptions = {
  includeActions: boolean;
  includeSelfBuild: boolean;
};

function applyDegradedOverlay(
  model: AgentCockpitViewModel,
  degradedReason: string,
): AgentCockpitViewModel {
  const degradedReasons = Array.from(
    new Set([...model.degradedReasons, degradedReason].filter(Boolean)),
  );

  return {
    ...model,
    lanes: model.lanes.map((lane) => ({
      ...lane,
      degraded: true,
    })),
    isDegraded: true,
    degradedReasons,
  };
}

async function loadAgentCockpitData(options: AgentCockpitLoadOptions) {
  const degradedReasons: string[] = [];
  const degradedThreadIds = new Set<string>();
  const degradedExecutionIds = new Set<string>();
  const degradedSessionIds = new Set<string>();
  const degradedRunIds = new Set<string>();
  const [threadsResult, actionsResult, selfBuildSummaryResult, selfBuildDashboardResult] =
    await Promise.allSettled([
      listOperatorThreads(),
      options.includeActions ? listOperatorActions() : Promise.resolve([]),
      options.includeSelfBuild ? getSelfBuildSummary() : Promise.resolve(null),
      options.includeSelfBuild ? getSelfBuildDashboard() : Promise.resolve(null),
    ]);

  if (threadsResult.status !== "fulfilled") {
    throw threadsResult.reason;
  }

  const threads = threadsResult.value;
  const actions = actionsResult.status === "fulfilled" ? actionsResult.value : [];
  const selfBuildSummary =
    selfBuildSummaryResult.status === "fulfilled" ? selfBuildSummaryResult.value : null;
  const selfBuildDashboard =
    selfBuildDashboardResult.status === "fulfilled" ? selfBuildDashboardResult.value : null;
  let workspaces: WorkspaceApiDetail[] = [];
  let sessionList: MissionMapApiSessionListEntry[] = [];

  if (options.includeActions && actionsResult.status !== "fulfilled") {
    degradedReasons.push(`Actions: ${getAgentCockpitErrorMessage(actionsResult.reason)}`);
  }
  if (options.includeSelfBuild && selfBuildSummaryResult.status !== "fulfilled") {
    degradedReasons.push(
      `Self-build summary: ${getAgentCockpitErrorMessage(selfBuildSummaryResult.reason)}`,
    );
  }
  if (options.includeSelfBuild && selfBuildDashboardResult.status !== "fulfilled") {
    degradedReasons.push(
      `Self-build dashboard: ${getAgentCockpitErrorMessage(selfBuildDashboardResult.reason)}`,
    );
  }

  try {
    workspaces = await listWorkspaces();
  } catch (error) {
    degradedReasons.push(`Workspaces: ${getAgentCockpitErrorMessage(error)}`);
  }

  try {
    sessionList = await listSessions();
  } catch (error) {
    degradedReasons.push(`Sessions: ${getAgentCockpitErrorMessage(error)}`);
  }

  const threadDetails: Record<string, MissionMapApiThreadDetail | null> = {};
  await Promise.all(
    threads.map(async (thread) => {
      const threadId = toText(thread.id, "");
      if (!threadId) {
        return;
      }
      try {
        threadDetails[threadId] = (await getOperatorThreadDetail(threadId)) as MissionMapApiThreadDetail;
      } catch (error) {
        threadDetails[threadId] = null;
        degradedThreadIds.add(threadId);
        degradedReasons.push(`Thread ${threadId}: ${getAgentCockpitErrorMessage(error)}`);
      }
    }),
  );

  const executionIds = Array.from(
    new Set(
      Object.values(threadDetails)
        .map((detail) =>
          toText(
            detail?.metadata?.execution?.executionId,
            toText(
              detail?.metadata?.execution?.selectedExecutionId,
              toText(detail?.metadata?.execution?.rootExecutionId, ""),
            ),
          ),
        )
        .filter(Boolean),
    ),
  );

  const runIds = Array.from(
    new Set(
      Object.values(threadDetails)
        .map((detail) => toText(detail?.metadata?.linkage?.activeRunId, ""))
        .filter(Boolean),
    ),
  );

  const workItemRuns: Record<string, WorkItemRunApiDetail | null> = {};
  const runWorkspaces: Record<string, Awaited<ReturnType<typeof getWorkItemRunWorkspace>> | null> = {};
  await Promise.all(
    runIds.map(async (runId) => {
      try {
        workItemRuns[runId] = await getWorkItemRun(runId);
      } catch (error) {
        workItemRuns[runId] = null;
        degradedRunIds.add(runId);
        degradedReasons.push(`Work-item run ${runId}: ${getAgentCockpitErrorMessage(error)}`);
      }

      try {
        runWorkspaces[runId] = await getWorkItemRunWorkspace(runId);
      } catch {
        runWorkspaces[runId] = null;
      }
    }),
  );

  const executionIdsFromRuns = Array.from(
    new Set(
      Object.entries(workItemRuns)
        .map(([runId, run]) =>
          toText(
            run?.result?.executionId,
            toText(
              run?.relationSummary?.executionId,
              toText(runWorkspaces[runId]?.executionId, ""),
            ),
          ),
        )
        .filter(Boolean),
    ),
  );

  const rootExecutionIds = Array.from(new Set([...executionIds, ...executionIdsFromRuns]));

  const executionDetails: Record<string, Awaited<ReturnType<typeof getExecutionDetail>> | null> = {};
  const executionTrees: Record<string, MissionMapApiExecutionTree | null> = {};
  await Promise.all(
    rootExecutionIds.map(async (executionId) => {
      try {
        executionDetails[executionId] = await getExecutionDetail(executionId);
      } catch (error) {
        executionDetails[executionId] = null;
        degradedExecutionIds.add(executionId);
        degradedReasons.push(`Execution ${executionId}: ${getAgentCockpitErrorMessage(error)}`);
      }

      try {
        executionTrees[executionId] = await getExecutionTree(executionId);
      } catch (error) {
        executionTrees[executionId] = null;
        degradedExecutionIds.add(executionId);
        degradedReasons.push(`Execution tree ${executionId}: ${getAgentCockpitErrorMessage(error)}`);
      }
    }),
  );

  const childExecutionIds = Array.from(
    new Set(
      Object.values(executionTrees).flatMap((tree) => Array.from(collectExecutionIdsFromTree(tree))),
    ),
  ).filter((executionId) => !executionDetails[executionId]);

  await Promise.all(
    childExecutionIds.map(async (executionId) => {
      try {
        executionDetails[executionId] = await getExecutionDetail(executionId);
      } catch (error) {
        executionDetails[executionId] = null;
        degradedExecutionIds.add(executionId);
        degradedReasons.push(`Execution ${executionId}: ${getAgentCockpitErrorMessage(error)}`);
      }
    }),
  );

  const sessionIds = Array.from(
    new Set(
      [
        ...Object.values(threadDetails).flatMap((detail) =>
          (detail?.metadata?.execution?.sessionIds ?? []).map((sessionId) =>
            toText(sessionId, ""),
          ),
        ),
        ...Object.values(executionDetails)
          .flatMap((detail) => detail?.sessions ?? [])
          .map((entry) => toText(entry.sessionId, toText(entry.session?.id, ""))),
        ...workspaces.map((workspace) => toText(workspace.metadata?.sessionId, "")),
        ...sessionList.map((session) => toText(session.id, "")),
      ].filter(Boolean),
    ),
  );

  const sessionLives: Record<string, Awaited<ReturnType<typeof getSessionLive>> | null> = {};
  await Promise.all(
    sessionIds.map(async (sessionId) => {
      try {
        sessionLives[sessionId] = await getSessionLive(sessionId);
      } catch (error) {
        sessionLives[sessionId] = null;
        degradedSessionIds.add(sessionId);
        degradedReasons.push(`Session ${sessionId}: ${getAgentCockpitErrorMessage(error)}`);
      }
    }),
  );

  return {
    threads,
    threadDetails,
    actions,
    workItemRuns,
    runWorkspaces,
    workspaces,
    executionDetails,
    executionTrees,
    sessionList,
    sessionLives,
    selfBuildSummary,
    selfBuildDashboard,
    degradedThreadIds: Array.from(degradedThreadIds),
    degradedExecutionIds: Array.from(degradedExecutionIds),
    degradedSessionIds: Array.from(degradedSessionIds),
    degradedReasons,
  };
}

export async function loadAgentCockpitModel() {
  const data = await loadAgentCockpitData({
    includeActions: true,
    includeSelfBuild: true,
  });

  return adaptAgentCockpit({
    ...data,
  });
}

export async function loadAgentCockpitBootstrapModel() {
  const data = await loadAgentCockpitData({
    includeActions: false,
    includeSelfBuild: false,
  });

  return adaptAgentCockpit({
    ...data,
  });
}

export function useAgentCockpit() {
  const query = useQuery({
    queryKey: AGENT_COCKPIT_QUERY_KEY,
    queryFn: loadAgentCockpitModel,
    refetchInterval: 15000,
  });

  const model = useMemo(() => {
    if (!query.data) {
      return null;
    }

    if (!query.error) {
      return query.data;
    }

    return applyDegradedOverlay(query.data, getAgentCockpitErrorMessage(query.error));
  }, [query.data, query.error]);
  const hasCachedState = Boolean(model);

  return {
    model,
    isInitialLoading: query.isLoading && !model,
    hasLoadedEmpty: !query.isLoading && !query.error && Boolean(model) && model.lanes.length === 0,
    loadErrorMessage:
      query.error && !hasCachedState ? getAgentCockpitErrorMessage(query.error) : null,
    degradedMessage:
      query.error && hasCachedState
        ? getAgentCockpitErrorMessage(query.error)
        : model?.isDegraded
          ? model.degradedReasons[0] ?? "Some live reads are degraded."
          : null,
    retry: () => query.refetch(),
  };
}
