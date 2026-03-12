import type { OperatorApiAction } from "../types/operator-chat.js";
import type {
  MissionMapApiCoordinationGroupSummary,
  MissionMapApiExecutionRecord,
  MissionMapApiThreadDetail,
  MissionMapApiThreadSummary,
} from "../types/mission-map.js";
import type {
  ProjectCatalogModel,
  ProjectDetailModel,
  ProjectExecutionSummary,
  ProjectMissionSummary,
  ProjectSummaryModel,
  ProjectWorkflowSummary,
} from "../types/projects.js";
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

interface ProjectAdapterInput {
  executions: MissionMapApiExecutionRecord[];
  threadSummaries: MissionMapApiThreadSummary[];
  threadDetails: MissionMapApiThreadDetail[];
  actions: OperatorApiAction[];
  coordinationGroups: MissionMapApiCoordinationGroupSummary[];
}

interface ProjectIdentity {
  id: string;
  name: string;
  projectId: string | null;
  projectPath: string | null;
  aliases: string[];
}

interface ProjectRecord {
  identity: ProjectIdentity;
  executions: MissionMapApiExecutionRecord[];
  threads: ThreadBundle[];
  actions: OperatorApiAction[];
}

function resolveProjectIdentity(input: {
  projectId?: unknown;
  projectName?: unknown;
  projectPath?: unknown;
  fallbackId?: unknown;
}): ProjectIdentity {
  const aliases = buildEntityAliases({
    explicitId: input.projectId,
    path: input.projectPath,
  });
  const projectId = toText(input.projectId, "") || null;
  const projectPath = toText(input.projectPath, "") || null;
  const id = projectId || projectPath || toText(input.fallbackId, "derived-project");
  return {
    id,
    name:
      toText(input.projectName, "") ||
      projectId ||
      basenameWithoutExtension(projectPath) ||
      humanize(id, "Project"),
    projectId,
    projectPath,
    aliases,
  };
}

function resolveProjectIdentityForThread(
  thread: ThreadBundle,
  executionMap: Map<string, MissionMapApiExecutionRecord>,
  projectRegistry: ReturnType<typeof createCanonicalEntityRegistry>,
) {
  const linkedExecution = thread.executionId
    ? (executionMap.get(thread.executionId) ?? null)
    : null;
  if (linkedExecution) {
    const descriptor = projectRegistry.resolve({
      explicitId: linkedExecution.projectId,
      path: linkedExecution.projectPath,
    });
    return descriptor
      ? {
          id: descriptor.id,
          name:
            toText(linkedExecution.projectName, "") ||
            descriptor.name,
          projectId: descriptor.explicitId,
          projectPath: descriptor.path,
          aliases: descriptor.aliases,
        }
      : null;
  }

  const metadataProjectId = toText(thread.detail?.metadata?.execution?.projectId, "");
  if (!metadataProjectId) {
    return null;
  }

  const descriptor = projectRegistry.resolve({
    explicitId: metadataProjectId,
    fallbackId: thread.id,
  });
  return descriptor
    ? {
        id: descriptor.id,
        name: descriptor.name,
        projectId: descriptor.explicitId,
        projectPath: descriptor.path,
        aliases: descriptor.aliases,
      }
    : null;
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

function buildProjectRecords(input: ProjectAdapterInput) {
  const projectRegistry = createCanonicalEntityRegistry(
    input.executions.map((execution) => ({
      explicitId: execution.projectId,
      path: execution.projectPath,
      name: execution.projectName,
      fallbackId: execution.id,
    })),
    "Project",
  );
  const executionMap = new Map(
    input.executions
      .map((execution) => {
        const id = toText(execution.id, "");
        return id ? ([id, execution] as const) : null;
      })
      .filter((entry): entry is readonly [string, MissionMapApiExecutionRecord] => Boolean(entry)),
  );
  const threadBundles = buildThreadBundles({
    threadSummaries: input.threadSummaries,
    threadDetails: input.threadDetails,
    coordinationGroups: input.coordinationGroups,
    executions: input.executions,
  });
  const records = new Map<string, ProjectRecord>();
  const projectByThreadId = new Map<string, string>();

  for (const execution of input.executions) {
    const descriptor = projectRegistry.resolve({
      explicitId: execution.projectId,
      path: execution.projectPath,
      name: execution.projectName,
      fallbackId: execution.id,
    });
    const identity = descriptor
      ? {
          id: descriptor.id,
          name:
            toText(execution.projectName, "") ||
            descriptor.name,
          projectId: descriptor.explicitId,
          projectPath: descriptor.path,
          aliases: descriptor.aliases,
        }
      : resolveProjectIdentity({
          projectId: execution.projectId,
          projectName: execution.projectName,
          projectPath: execution.projectPath,
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
    const identity = resolveProjectIdentityForThread(
      thread,
      executionMap,
      projectRegistry,
    );
    if (!identity) {
      continue;
    }
    const existing = records.get(identity.id) ?? {
      identity,
      executions: [],
      threads: [],
      actions: [],
    };
    existing.threads.push(thread);
    records.set(identity.id, existing);
    projectByThreadId.set(thread.id, identity.id);
  }

  for (const action of input.actions) {
    const threadId = toText(action.threadId, "");
    const projectId = projectByThreadId.get(threadId);
    if (!projectId) {
      continue;
    }
    const existing = records.get(projectId);
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

function buildProjectWorkflows(record: ProjectRecord) {
  const workflowRegistry = createCanonicalEntityRegistry(
    record.executions.map((execution) => ({
      explicitId: execution.workflowId,
      path: execution.workflowPath,
      name: execution.workflowName,
      fallbackId: execution.id,
    })),
    "Workflow",
  );
  const grouped = new Map<
    string,
    {
      id: string;
      name: string;
      statusValues: string[];
      executions: MissionMapApiExecutionRecord[];
      missionCount: number;
      pendingActionCount: number;
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
    const workflowDescriptor = workflowRegistry.resolve({
      explicitId: execution.workflowId,
      path: execution.workflowPath,
      name: execution.workflowName,
      fallbackId: execution.id,
    });
    const workflowId = workflowDescriptor?.id ?? toText(execution.id, "workflow");
    const existing = grouped.get(workflowId) ?? {
      id: workflowId,
      name:
        toText(execution.workflowName, "") ||
        workflowDescriptor?.name ||
        toText(execution.workflowId, "") ||
        basenameWithoutExtension(execution.workflowPath) ||
        humanize(workflowId, "Workflow"),
      statusValues: [],
      executions: [],
      missionCount: 0,
      pendingActionCount: 0,
    };
    existing.executions.push(execution);
    existing.statusValues.push(normalizeCatalogStatus(execution.state));

    const relatedThreads = threadByExecutionId.get(toText(execution.id, "")) ?? [];
    existing.missionCount += relatedThreads.length;
    existing.pendingActionCount += relatedThreads.reduce(
      (sum, thread) =>
        sum + Math.max(asArray(thread.detail?.pendingActions).length, Number(thread.summary?.pendingActionCount ?? 0)),
      0,
    );
    grouped.set(workflowId, existing);
  }

  return Array.from(grouped.values())
    .map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      href: buildRouteHref("/workflows", workflow.id),
      status: deriveAggregateStatus({
        statuses: workflow.statusValues,
        pendingActions: workflow.pendingActionCount,
      }),
      executionCount: workflow.executions.length,
      missionCount: workflow.missionCount,
      pendingActionCount: workflow.pendingActionCount,
    }))
    .sort((left, right) => left.name.localeCompare(right.name)) satisfies ProjectWorkflowSummary[];
}

function buildProjectMissions(record: ProjectRecord) {
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
  })) satisfies ProjectMissionSummary[];
}

function buildProjectExecutions(record: ProjectRecord) {
  return record.executions.map((execution) => ({
    id: toText(execution.id, "execution"),
    status: normalizeCatalogStatus(execution.state),
    objective: toText(execution.objective, "No objective returned."),
    updatedAtLabel: formatTimestampLabel(
      execution.updatedAt ?? execution.endedAt ?? execution.startedAt,
    ),
    branchLabel: toText(execution.branchKey, toText(execution.topology?.kind, "lane")),
    roleLabel: toText(execution.projectRole, toText(execution.topology?.projectLaneType, "lane")),
    workflowName:
      toText(execution.workflowName, "") ||
      toText(execution.workflowId, "") ||
      basenameWithoutExtension(execution.workflowPath) ||
      "Workflow",
    coordinationGroupId: toText(execution.coordinationGroupId, "") || null,
  })) satisfies ProjectExecutionSummary[];
}

function toProjectSummary(record: ProjectRecord): ProjectSummaryModel {
  const workflows = buildProjectWorkflows(record);
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
  const status = deriveAggregateStatus({
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
  });

  return {
    id: record.identity.id,
    name: record.identity.name,
    href: buildRouteHref("/projects", record.identity.id),
    status,
    summary:
      record.identity.projectPath ||
      record.identity.projectId ||
      "Derived from real execution and mission data.",
    subtitle:
      record.identity.projectPath && record.identity.projectId
        ? `${record.identity.projectId} · ${record.identity.projectPath}`
        : record.identity.projectPath || record.identity.projectId || "Real-backed project view",
    latestActivityLabel: formatTimestampLabel(latestTimestamp),
    executionCount: record.executions.length,
    activeExecutionCount: record.executions.filter((execution) => isRunningStatus(execution.state)).length,
    blockedExecutionCount: record.executions.filter((execution) => isBlockedStatus(execution.state)).length,
    workflowCount: workflows.length,
    missionCount: record.threads.length,
    pendingActionCount: pendingActions,
    projectId: record.identity.projectId,
    projectPath: record.identity.projectPath,
  };
}

export function adaptProjectCatalog(input: ProjectAdapterInput): ProjectCatalogModel {
  const projects = buildProjectRecords(input).map(toProjectSummary);
  return {
    stats: {
      totalProjects: projects.length,
      activeProjects: projects.filter((project) => ["running", "active"].includes(project.status)).length,
      blockedProjects: projects.filter((project) => isBlockedStatus(project.status)).length,
      pendingActions: projects.reduce(
        (sum, project) => sum + project.pendingActionCount,
        0,
      ),
    },
    projects,
  };
}

export function adaptProjectDetail(
  selection: { id: string },
  input: ProjectAdapterInput,
): ProjectDetailModel | null {
  const record = buildProjectRecords(input).find((entry) => entry.identity.id === selection.id);
  if (!record) {
    return null;
  }

  const summary = toProjectSummary(record);
  const workflows = buildProjectWorkflows(record);
  const missions = buildProjectMissions(record);
  const executions = buildProjectExecutions(record);
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
      { label: "Projects", href: "/projects" },
      { label: summary.name },
    ],
    statCards: [
      {
        label: "Executions",
        value: String(summary.executionCount),
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
        label: "Workflows",
        value: String(summary.workflowCount),
        highlight: false,
      },
      {
        label: "Evidence Links",
        value: String(evidenceLinks.length),
        highlight: evidenceLinks.length > 0,
      },
    ],
    workflows,
    missions,
    executions,
    evidenceLinks,
  };
}
