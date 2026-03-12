import type { OperatorApiAction } from "../types/operator-chat.js";
import type {
  MissionMapApiCoordinationGroupSummary,
  MissionMapApiExecutionRecord,
  MissionMapApiThreadDetail,
  MissionMapApiThreadSummary,
} from "../types/mission-map.js";
import type {
  WorkflowCatalogModel,
  WorkflowDetailModel,
  WorkflowExecutionSummary,
  WorkflowMissionSummary,
  WorkflowProjectSummary,
  WorkflowSummaryModel,
} from "../types/workflows.js";
import {
  asArray,
  basenameWithoutExtension,
  buildEvidenceLinksFromThread,
  buildEntityAliases,
  buildRouteHref,
  buildThreadBundles,
  createCanonicalEntityRegistry,
  deriveAggregateStatus,
  formatTimestampLabel,
  humanize,
  isBlockedStatus,
  isRunningStatus,
  normalizeCatalogStatus,
  timestampFor,
  toText,
  type ThreadBundle,
} from "./catalog-support.js";

interface WorkflowAdapterInput {
  executions: MissionMapApiExecutionRecord[];
  threadSummaries: MissionMapApiThreadSummary[];
  threadDetails: MissionMapApiThreadDetail[];
  actions: OperatorApiAction[];
  coordinationGroups: MissionMapApiCoordinationGroupSummary[];
}

interface WorkflowIdentity {
  id: string;
  name: string;
  workflowId: string | null;
  workflowPath: string | null;
  aliases: string[];
}

interface WorkflowRecord {
  identity: WorkflowIdentity;
  executions: MissionMapApiExecutionRecord[];
  threads: ThreadBundle[];
  actions: OperatorApiAction[];
}

function resolveWorkflowIdentity(input: {
  workflowId?: unknown;
  workflowName?: unknown;
  workflowPath?: unknown;
  fallbackId?: unknown;
}): WorkflowIdentity {
  const aliases = buildEntityAliases({
    explicitId: input.workflowId,
    path: input.workflowPath,
  });
  const workflowId = toText(input.workflowId, "") || null;
  const workflowPath = toText(input.workflowPath, "") || null;
  const id = workflowId || workflowPath || toText(input.fallbackId, "derived-workflow");
  return {
    id,
    name:
      toText(input.workflowName, "") ||
      workflowId ||
      basenameWithoutExtension(workflowPath) ||
      humanize(id, "Workflow"),
    workflowId,
    workflowPath,
    aliases,
  };
}

function compareExecutionRecency(left: MissionMapApiExecutionRecord, right: MissionMapApiExecutionRecord) {
  return (
    Math.max(timestampFor(right.updatedAt), timestampFor(right.endedAt), timestampFor(right.startedAt)) -
      Math.max(timestampFor(left.updatedAt), timestampFor(left.endedAt), timestampFor(left.startedAt)) ||
    toText(left.id, "").localeCompare(toText(right.id, ""))
  );
}

function compareThreadRecency(left: ThreadBundle, right: ThreadBundle) {
  return (
    Math.max(timestampFor(right.detail?.updatedAt), timestampFor(right.summary?.updatedAt)) -
      Math.max(timestampFor(left.detail?.updatedAt), timestampFor(left.summary?.updatedAt)) ||
    left.id.localeCompare(right.id)
  );
}

function buildWorkflowRecords(input: WorkflowAdapterInput) {
  const workflowRegistry = createCanonicalEntityRegistry(
    input.executions.map((execution) => ({
      explicitId: execution.workflowId,
      path: execution.workflowPath,
      name: execution.workflowName,
      fallbackId: execution.id,
    })),
    "Workflow",
  );
  const threadBundles = buildThreadBundles({
    threadSummaries: input.threadSummaries,
    threadDetails: input.threadDetails,
    coordinationGroups: input.coordinationGroups,
    executions: input.executions,
  });
  const records = new Map<string, WorkflowRecord>();
  const workflowByThreadId = new Map<string, string>();
  const executionById = new Map(
    input.executions
      .map((execution) => {
        const id = toText(execution.id, "");
        return id ? ([id, execution] as const) : null;
      })
      .filter((entry): entry is readonly [string, MissionMapApiExecutionRecord] => Boolean(entry)),
  );

  for (const execution of input.executions) {
    const descriptor = workflowRegistry.resolve({
      explicitId: execution.workflowId,
      path: execution.workflowPath,
      name: execution.workflowName,
      fallbackId: execution.id,
    });
    const identity = descriptor
      ? {
          id: descriptor.id,
          name:
            toText(execution.workflowName, "") ||
            descriptor.name,
          workflowId: descriptor.explicitId,
          workflowPath: descriptor.path,
          aliases: descriptor.aliases,
        }
      : resolveWorkflowIdentity({
          workflowId: execution.workflowId,
          workflowName: execution.workflowName,
          workflowPath: execution.workflowPath,
          fallbackId: execution.id,
        });
    const existing = records.get(identity.id) ?? {
      identity,
      executions: [],
      threads: [],
      actions: [],
    };
    existing.executions.push(execution);
    records.set(identity.id, existing);
  }

  for (const thread of threadBundles) {
    if (!thread.executionId) {
      continue;
    }
    const linkedExecution = executionById.get(thread.executionId);
    if (!linkedExecution) {
      continue;
    }

    const identity = resolveWorkflowIdentity({
      workflowId: workflowRegistry.resolve({
        explicitId: linkedExecution.workflowId,
        path: linkedExecution.workflowPath,
      })?.explicitId ?? linkedExecution.workflowId,
      workflowName:
        toText(linkedExecution.workflowName, "") ||
        workflowRegistry.resolve({
          explicitId: linkedExecution.workflowId,
          path: linkedExecution.workflowPath,
        })?.name,
      workflowPath:
        workflowRegistry.resolve({
          explicitId: linkedExecution.workflowId,
          path: linkedExecution.workflowPath,
        })?.path ?? linkedExecution.workflowPath,
      fallbackId: linkedExecution.id,
    });
    const existing = records.get(identity.id);
    if (!existing) {
      continue;
    }
    existing.threads.push(thread);
    workflowByThreadId.set(thread.id, identity.id);
  }

  for (const action of input.actions) {
    const threadId = toText(action.threadId, "");
    const workflowId = workflowByThreadId.get(threadId);
    if (!workflowId) {
      continue;
    }
    const existing = records.get(workflowId);
    if (!existing) {
      continue;
    }
    existing.actions.push(action);
  }

  return Array.from(records.values())
    .map((record) => ({
      ...record,
      executions: [...record.executions].sort(compareExecutionRecency),
      threads: [...record.threads].sort(compareThreadRecency),
    }))
    .sort((left, right) => {
      const leftTimestamp = Math.max(
        ...left.executions.map((execution) => timestampFor(execution.updatedAt)),
        ...left.threads.map((thread) => timestampFor(thread.detail?.updatedAt ?? thread.summary?.updatedAt)),
        0,
      );
      const rightTimestamp = Math.max(
        ...right.executions.map((execution) => timestampFor(execution.updatedAt)),
        ...right.threads.map((thread) => timestampFor(thread.detail?.updatedAt ?? thread.summary?.updatedAt)),
        0,
      );
      return rightTimestamp - leftTimestamp || left.identity.name.localeCompare(right.identity.name);
    });
}

function buildWorkflowProjects(record: WorkflowRecord) {
  const projectRegistry = createCanonicalEntityRegistry(
    record.executions.map((execution) => ({
      explicitId: execution.projectId,
      path: execution.projectPath,
      name: execution.projectName,
      fallbackId: execution.id,
    })),
    "Project",
  );
  const grouped = new Map<
    string,
    {
      id: string;
      name: string;
      statusValues: string[];
      executionCount: number;
      missionCount: number;
    }
  >();
  const threadByExecutionId = new Map<string, ThreadBundle[]>();

  for (const thread of record.threads) {
    if (!thread.executionId) {
      continue;
    }
    const current = threadByExecutionId.get(thread.executionId) ?? [];
    current.push(thread);
    threadByExecutionId.set(thread.executionId, current);
  }

  for (const execution of record.executions) {
    const projectDescriptor = projectRegistry.resolve({
      explicitId: execution.projectId,
      path: execution.projectPath,
      name: execution.projectName,
      fallbackId: execution.id,
    });
    const projectId = projectDescriptor?.id ?? toText(execution.id, "project");
    const existing = grouped.get(projectId) ?? {
      id: projectId,
      name:
        toText(execution.projectName, "") ||
        projectDescriptor?.name ||
        toText(execution.projectId, "") ||
        basenameWithoutExtension(execution.projectPath) ||
        humanize(projectId, "Project"),
      statusValues: [],
      executionCount: 0,
      missionCount: 0,
    };
    existing.executionCount += 1;
    existing.statusValues.push(normalizeCatalogStatus(execution.state));
    existing.missionCount += (threadByExecutionId.get(toText(execution.id, "")) ?? []).length;
    grouped.set(projectId, existing);
  }

  return Array.from(grouped.values())
    .map((project) => ({
      id: project.id,
      name: project.name,
      href: buildRouteHref("/projects", project.id),
      status: deriveAggregateStatus({
        statuses: project.statusValues,
        pendingActions: 0,
      }),
      executionCount: project.executionCount,
      missionCount: project.missionCount,
    }))
    .sort((left, right) => left.name.localeCompare(right.name)) satisfies WorkflowProjectSummary[];
}

function buildWorkflowMissions(record: WorkflowRecord) {
  return record.threads.map((thread) => ({
    id: thread.id,
    title:
      toText(thread.detail?.title, "") ||
      toText(thread.summary?.title, "") ||
      `Mission ${thread.id}`,
    status: deriveAggregateStatus({
      statuses: [
        toText(thread.detail?.status, ""),
        toText(thread.summary?.status, ""),
      ],
      pendingActions: Math.max(
        asArray(thread.detail?.pendingActions).length,
        Number(thread.summary?.pendingActionCount ?? 0),
      ),
    }),
    objective:
      toText(thread.detail?.summary?.objective, "") ||
      toText(thread.summary?.summary?.objective, "") ||
      "No objective returned.",
    updatedAtLabel: formatTimestampLabel(thread.detail?.updatedAt ?? thread.summary?.updatedAt),
    pendingActionCount: Math.max(
      asArray(thread.detail?.pendingActions).length,
      Number(thread.summary?.pendingActionCount ?? 0),
    ),
    executionId: thread.executionId,
    evidenceLinks: buildEvidenceLinksFromThread(thread.detail),
  })) satisfies WorkflowMissionSummary[];
}

function buildWorkflowExecutions(record: WorkflowRecord) {
  const projectRegistry = createCanonicalEntityRegistry(
    record.executions.map((execution) => ({
      explicitId: execution.projectId,
      path: execution.projectPath,
      name: execution.projectName,
      fallbackId: execution.id,
    })),
    "Project",
  );
  return record.executions.map((execution) => {
    const projectDescriptor = projectRegistry.resolve({
      explicitId: execution.projectId,
      path: execution.projectPath,
      name: execution.projectName,
      fallbackId: execution.id,
    });
    const projectId = projectDescriptor?.id ?? toText(execution.id, "project");
    return {
      id: toText(execution.id, "execution"),
      status: normalizeCatalogStatus(execution.state),
      objective: toText(execution.objective, "No objective returned."),
      updatedAtLabel: formatTimestampLabel(
        execution.updatedAt ?? execution.endedAt ?? execution.startedAt,
      ),
      branchLabel: toText(execution.branchKey, toText(execution.topology?.kind, "lane")),
      roleLabel: toText(execution.projectRole, toText(execution.topology?.projectLaneType, "lane")),
      projectName:
        toText(execution.projectName, "") ||
        projectDescriptor?.name ||
        toText(execution.projectId, "") ||
        basenameWithoutExtension(execution.projectPath) ||
        "Project",
      projectHref: buildRouteHref("/projects", projectId),
      coordinationGroupId: toText(execution.coordinationGroupId, "") || null,
    } satisfies WorkflowExecutionSummary;
  });
}

function toWorkflowSummary(record: WorkflowRecord): WorkflowSummaryModel {
  const projects = buildWorkflowProjects(record);
  const missionPendingActions = record.threads.reduce(
    (sum, thread) =>
      sum + Math.max(asArray(thread.detail?.pendingActions).length, Number(thread.summary?.pendingActionCount ?? 0)),
    0,
  );
  const pendingActions = Math.max(missionPendingActions, record.actions.length);
  const latestTimestamp = Math.max(
    ...record.executions.map((execution) => timestampFor(execution.updatedAt)),
    ...record.threads.map((thread) => timestampFor(thread.detail?.updatedAt ?? thread.summary?.updatedAt)),
    0,
  );
  const actionTexts = record.actions.map((action) =>
    `${toText(action.actionKind, "")} ${toText(action.summary, "")}`,
  );

  return {
    id: record.identity.id,
    name: record.identity.name,
    href: buildRouteHref("/workflows", record.identity.id),
    status: deriveAggregateStatus({
      statuses: [
        ...record.executions.map((execution) =>
          toText(execution.promotionStatus, "") ||
          toText(execution.approvalStatus, "") ||
          toText(execution.reviewStatus, "") ||
          toText(execution.state, ""),
        ),
        ...record.threads.map((thread) =>
          toText(thread.detail?.status, "") || toText(thread.summary?.status, ""),
        ),
      ],
      pendingActions,
      actionTexts,
    }),
    summary:
      record.identity.workflowPath ||
      record.identity.workflowId ||
      "Derived from real execution and mission data.",
    subtitle:
      record.identity.workflowPath && record.identity.workflowId
        ? `${record.identity.workflowId} · ${record.identity.workflowPath}`
        : record.identity.workflowPath || record.identity.workflowId || "Real-backed workflow view",
    latestActivityLabel: formatTimestampLabel(latestTimestamp),
    executionCount: record.executions.length,
    activeExecutionCount: record.executions.filter((execution) => isRunningStatus(execution.state)).length,
    blockedExecutionCount: record.executions.filter((execution) => isBlockedStatus(execution.state)).length,
    projectCount: projects.length,
    missionCount: record.threads.length,
    pendingActionCount: pendingActions,
    workflowId: record.identity.workflowId,
    workflowPath: record.identity.workflowPath,
  };
}

export function adaptWorkflowCatalog(input: WorkflowAdapterInput): WorkflowCatalogModel {
  const workflows = buildWorkflowRecords(input).map(toWorkflowSummary);
  return {
    stats: {
      totalWorkflows: workflows.length,
      runningWorkflows: workflows.filter((workflow) => ["running", "active"].includes(workflow.status)).length,
      blockedWorkflows: workflows.filter((workflow) => isBlockedStatus(workflow.status)).length,
      pendingActions: workflows.reduce(
        (sum, workflow) => sum + workflow.pendingActionCount,
        0,
      ),
    },
    workflows,
  };
}

export function adaptWorkflowDetail(
  selection: { id: string },
  input: WorkflowAdapterInput,
): WorkflowDetailModel | null {
  const record = buildWorkflowRecords(input).find((entry) => entry.identity.id === selection.id);
  if (!record) {
    return null;
  }

  const summary = toWorkflowSummary(record);
  const projects = buildWorkflowProjects(record);
  const missions = buildWorkflowMissions(record);
  const executions = buildWorkflowExecutions(record);
  const evidenceLinks = Array.from(
    new Map(
      missions
        .flatMap((mission) => mission.evidenceLinks)
        .map((link) => [link.href, link] as const),
    ).values(),
  );

  return {
    ...summary,
    breadcrumbs: [
      { label: "Workflows", href: "/workflows" },
      { label: summary.name },
    ],
    statCards: [
      {
        label: "Executions",
        value: String(summary.executionCount),
        highlight: false,
      },
      {
        label: "Projects",
        value: String(summary.projectCount),
        highlight: false,
      },
      {
        label: "Missions",
        value: String(summary.missionCount),
        highlight: false,
      },
      {
        label: "Pending Actions",
        value: String(summary.pendingActionCount),
        highlight: summary.pendingActionCount > 0,
      },
      {
        label: "Blocked Lanes",
        value: String(summary.blockedExecutionCount),
        highlight: summary.blockedExecutionCount > 0,
      },
      {
        label: "Evidence Links",
        value: String(evidenceLinks.length),
        highlight: evidenceLinks.length > 0,
      },
    ],
    projects,
    missions,
    executions,
    evidenceLinks,
  };
}
