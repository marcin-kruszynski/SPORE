import type { JsonObject } from "@spore/shared-types";

import {
  getExecutionAdoptedPlan,
  getExecutionCoordinationMode,
  getExecutionCurrentWaveId,
  getExecutionDispatchTask,
  getExecutionDispatchQueue,
  getExecutionDispatchQueueStatus,
  getExecutionFamilyKey,
  getExecutionLatestReplan,
  getExecutionProjectRole,
  getExecutionReplanHistory,
  getExecutionRootExecutionId,
  getExecutionSupersededTaskIds,
  getPromotionSummary,
} from "./execution-metadata.js";

type LooseRecord = Record<string, unknown>;

export interface CoordinatorFamilyExecution {
  id: string;
  coordinationGroupId?: string | null;
  parentExecutionId?: string | null;
  projectId?: string | null;
  objective?: string | null;
  domainId?: string | null;
  state: string;
  reviewStatus?: string | null;
  approvalStatus?: string | null;
  branchKey?: string | null;
  holdReason?: string | null;
  metadata?: JsonObject;
}

export interface CoordinatorFamilyEscalation {
  id: string;
  executionId: string;
  reason: string;
  status: string;
  targetRole?: string | null;
  payload?: LooseRecord;
}

export interface CoordinatorFamilyHandoff {
  id: string;
  executionId: string;
  kind: string;
  summary?: LooseRecord;
  payload?: LooseRecord;
  validation?: LooseRecord;
  updatedAt?: string | null;
}

export interface CoordinatorFamilyPendingDecision {
  executionId: string;
  kind: "review" | "approval";
  laneRole: string;
  state: string;
}

export interface CoordinatorFamilyBlocker {
  kind: "escalation" | "promotion";
  executionId: string;
  code: string;
  reason: string;
  targetRole: string | null;
}

export interface CoordinatorLaneSummary {
  executionId: string;
  domainId: string | null;
  role: string;
  objective?: string | null;
  state: string;
  branchKey: string | null;
  holdReason: string | null;
  dispatchTaskId: string | null;
  taskSummary: string | null;
  dependencyTaskIds: string[];
  sharedContractRefs: Array<{
    id: string;
    summary: string | null;
  }>;
  recommendedWorkflow: string | null;
  activeTaskId: string | null;
  lastProgressSummary: string | null;
  blockedOnTaskIds: string[];
}

export interface CoordinatorReadinessSummary {
  state: string;
  readyForIntegratorPlanning: boolean;
  activeLeadLaneCount: number;
  pendingReviewCount: number;
  pendingApprovalCount: number;
  blockerCount: number;
}

export interface CoordinatorRoutingSummary {
  handoffId: string;
  updatedAt: string | null;
  summary: LooseRecord;
  payload: LooseRecord;
  validation: LooseRecord;
}

export interface CoordinatorPlanSummary {
  handoffId: string;
  updatedAt: string | null;
  summary: LooseRecord;
  payload: LooseRecord;
  validation: LooseRecord;
}

export interface CoordinatorAdoptedPlanSummary extends CoordinatorPlanSummary {
  status: string | null;
  version: number | null;
}

export interface CoordinatorDispatchTaskSummary {
  taskId: string;
  domainId: string | null;
  summary: string | null;
  waveId: string | null;
  status: string;
  executionId: string | null;
  dependencyTaskIds: string[];
  blockedByTaskIds: string[];
}

export interface CoordinatorDispatchQueueSummary {
  currentWaveId: string | null;
  tasks: CoordinatorDispatchTaskSummary[];
}

export interface CoordinatorDependencySummary {
  fromTaskId: string;
  toTaskId: string;
  satisfied: boolean;
}

export interface CoordinatorFamilyState {
  rootExecution: CoordinatorFamilyExecution;
  familyExecutions: CoordinatorFamilyExecution[];
  familyEscalations?: CoordinatorFamilyEscalation[];
  familyHandoffs?: CoordinatorFamilyHandoff[];
}

export interface CoordinatorSummary {
  rootExecutionId: string;
  familyKey: string | null;
  projectId: string | null;
  objective: string | null;
  coordinationMode: string | null;
  status: string;
  plannerLane: CoordinatorLaneSummary | null;
  leadLanes: CoordinatorLaneSummary[];
  integratorLane: CoordinatorLaneSummary | null;
  blockers: CoordinatorFamilyBlocker[];
  pendingDecisions: CoordinatorFamilyPendingDecision[];
  readiness: CoordinatorReadinessSummary;
  adoptedPlan: CoordinatorAdoptedPlanSummary | null;
  currentWaveId: string | null;
  dispatchQueue: CoordinatorDispatchQueueSummary;
  queueStatus: ReturnType<typeof getExecutionDispatchQueueStatus>;
  dependencies: CoordinatorDependencySummary[];
  replan: ReturnType<typeof getExecutionLatestReplan>;
  replanHistory: ReturnType<typeof getExecutionReplanHistory>;
  latestCoordinationPlan: CoordinatorPlanSummary | null;
  latestRoutingSummary: CoordinatorRoutingSummary | null;
}

const TERMINAL_EXECUTION_STATES = new Set([
  "completed",
  "failed",
  "rejected",
  "canceled",
]);

function toRecord(value: unknown): LooseRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as LooseRecord)
    : {};
}

function toText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toInteger(value: unknown): number | null {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareLaneSummaries(
  left: CoordinatorLaneSummary,
  right: CoordinatorLaneSummary,
) {
  return (left.domainId ?? left.executionId).localeCompare(
    right.domainId ?? right.executionId,
  );
}

function buildLaneSummary(
  execution: CoordinatorFamilyExecution,
  role: string,
  progressByExecutionId: Map<string, CoordinatorFamilyHandoff>,
): CoordinatorLaneSummary {
  const dispatchTask = getExecutionDispatchTask(execution);
  const progress = toRecord(progressByExecutionId.get(execution.id)?.payload);
  const progressSummary = toRecord(progressByExecutionId.get(execution.id)?.summary);
  return {
    executionId: execution.id,
    domainId: execution.domainId ?? null,
    role,
    objective: execution.objective ?? null,
    state: execution.state,
    branchKey: execution.branchKey ?? null,
    holdReason: execution.holdReason ?? null,
    dispatchTaskId: dispatchTask?.taskId ?? null,
    taskSummary: dispatchTask?.summary ?? null,
    dependencyTaskIds: dispatchTask?.dependencyTaskIds ?? [],
    sharedContractRefs: dispatchTask?.sharedContractRefs ?? [],
    recommendedWorkflow: dispatchTask?.recommendedWorkflow ?? null,
    activeTaskId: toText(progress.active_task_id),
    lastProgressSummary:
      toText(progressSummary.outcome) ?? toText(progress.summary) ?? null,
    blockedOnTaskIds: TERMINAL_EXECUTION_STATES.has(execution.state)
      ? []
      : toArray(progress.blocked_on_task_ids)
          .map((entry) => toText(entry))
          .filter((entry): entry is string => Boolean(entry)),
  };
}

function buildLatestLeadProgressByExecutionId(
  handoffs: CoordinatorFamilyHandoff[],
): Map<string, CoordinatorFamilyHandoff> {
  const latestByExecutionId = new Map<string, CoordinatorFamilyHandoff>();
  for (const handoff of handoffs) {
    if (handoff.kind !== "lead_progress") {
      continue;
    }
    const existing = latestByExecutionId.get(handoff.executionId);
    const existingTime = Date.parse(existing?.updatedAt ?? "") || 0;
    const handoffTime = Date.parse(handoff.updatedAt ?? "") || 0;
    if (!existing || handoffTime >= existingTime) {
      latestByExecutionId.set(handoff.executionId, handoff);
    }
  }
  return latestByExecutionId;
}

function getPendingDecision(
  execution: CoordinatorFamilyExecution,
): CoordinatorFamilyPendingDecision | null {
  const laneRole = getExecutionProjectRole(execution) ?? "lead";
  if (
    execution.state === "waiting_approval" ||
    execution.approvalStatus === "pending"
  ) {
    return {
      executionId: execution.id,
      kind: "approval",
      laneRole,
      state: execution.state,
    };
  }
  if (
    execution.state === "waiting_review" ||
    execution.reviewStatus === "pending"
  ) {
    return {
      executionId: execution.id,
      kind: "review",
      laneRole,
      state: execution.state,
    };
  }
  return null;
}

function buildEscalationBlockers(
  escalations: CoordinatorFamilyEscalation[],
): CoordinatorFamilyBlocker[] {
  return escalations
    .filter((escalation) => escalation.status === "open")
    .map((escalation) => ({
      kind: "escalation",
      executionId: escalation.executionId,
      code: escalation.reason,
      reason:
        toText(toRecord(escalation.payload).summary) ??
        escalation.reason,
      targetRole: escalation.targetRole ?? null,
    }));
}

function buildPromotionBlockers(
  execution: CoordinatorFamilyExecution | null,
): CoordinatorFamilyBlocker[] {
  const promotion = execution ? toRecord(getPromotionSummary(execution)) : {};
  const blockers = Array.isArray(promotion.blockers)
    ? promotion.blockers
    : [];
  return blockers.map((blocker) => {
    const normalized = toRecord(blocker);
    return {
      kind: "promotion" as const,
      executionId: execution?.id ?? "",
      code: toText(normalized.code) ?? "promotion_blocked",
      reason:
        toText(normalized.reason) ??
        toText(normalized.message) ??
        "Promotion is blocked.",
      targetRole: toText(normalized.targetRole),
    };
  });
}

function selectLatestRoutingSummary(
  rootExecutionId: string,
  handoffs: CoordinatorFamilyHandoff[],
): CoordinatorRoutingSummary | null {
  const latest = handoffs
    .filter(
      (handoff) =>
        handoff.executionId === rootExecutionId &&
        handoff.kind === "routing_summary",
    )
    .sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt ?? "") || 0;
      const rightTime = Date.parse(right.updatedAt ?? "") || 0;
      return rightTime - leftTime;
    })[0];
  if (!latest) {
    return null;
  }
  return {
    handoffId: latest.id,
    updatedAt: latest.updatedAt ?? null,
    summary: toRecord(latest.summary),
    payload: toRecord(latest.payload),
    validation: toRecord(latest.validation),
  };
}

function selectLatestCoordinationPlan(
  handoffs: CoordinatorFamilyHandoff[],
): CoordinatorPlanSummary | null {
  const latest = handoffs
    .filter((handoff) => handoff.kind === "coordination_plan")
    .sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt ?? "") || 0;
      const rightTime = Date.parse(right.updatedAt ?? "") || 0;
      return rightTime - leftTime;
    })[0];
  if (!latest) {
    return null;
  }
  return {
    handoffId: latest.id,
    updatedAt: latest.updatedAt ?? null,
    summary: toRecord(latest.summary),
    payload: toRecord(latest.payload),
    validation: toRecord(latest.validation),
  };
}

function buildTaskWaveMap(planPayload: LooseRecord): Map<string, string> {
  const waveByTaskId = new Map<string, string>();
  for (const wave of toArray(planPayload.waves)) {
    const normalizedWave = toRecord(wave);
    const waveId = toText(normalizedWave.id);
    if (!waveId) {
      continue;
    }
    for (const taskId of toArray(normalizedWave.task_ids)) {
      const normalizedTaskId = toText(taskId);
      if (normalizedTaskId) {
        waveByTaskId.set(normalizedTaskId, waveId);
      }
    }
  }
  return waveByTaskId;
}

function buildAdoptedPlanSummary(
  rootExecution: CoordinatorFamilyExecution,
  handoffs: CoordinatorFamilyHandoff[],
): CoordinatorAdoptedPlanSummary | null {
  const adoptedPlan = getExecutionAdoptedPlan(rootExecution);
  if (!adoptedPlan) {
    return null;
  }
  const matchedHandoff = handoffs.find(
    (handoff) =>
      handoff.kind === "coordination_plan" && handoff.id === adoptedPlan.handoffId,
  );
  return {
    handoffId: adoptedPlan.handoffId,
    updatedAt: matchedHandoff?.updatedAt ?? null,
    summary: toRecord(matchedHandoff?.summary),
    payload: toRecord(matchedHandoff?.payload),
    validation: toRecord(matchedHandoff?.validation),
    status: adoptedPlan.status,
    version: adoptedPlan.version,
  };
}

function buildDispatchQueueSummary(
  rootExecution: CoordinatorFamilyExecution,
  adoptedPlan: CoordinatorAdoptedPlanSummary | null,
  leadLanes: CoordinatorLaneSummary[],
): CoordinatorDispatchQueueSummary {
  const dispatchQueue = getExecutionDispatchQueue(rootExecution);
  const queuedTasks = new Map(
    (dispatchQueue?.tasks ?? [])
      .filter((task) => task.taskId)
      .map((task) => [task.taskId as string, task]),
  );
  const planPayload = adoptedPlan?.payload ?? {};
  const waveByTaskId = buildTaskWaveMap(planPayload);
  const dependencyTaskIdsByTaskId = new Map<string, string[]>();
  for (const dependency of toArray(planPayload.dependencies)) {
    const normalizedDependency = toRecord(dependency);
    const fromTaskId = toText(normalizedDependency.from_task_id);
    const toTaskId = toText(normalizedDependency.to_task_id);
    if (!fromTaskId || !toTaskId) {
      continue;
    }
    dependencyTaskIdsByTaskId.set(fromTaskId, [
      ...(dependencyTaskIdsByTaskId.get(fromTaskId) ?? []),
      toTaskId,
    ]);
  }

  const planTasks = toArray(planPayload.domain_tasks)
    .map((task) => toRecord(task))
    .filter((task) => toText(task.id));
  const taskIds = [...new Set([
    ...planTasks.map((task) => toText(task.id)).filter((taskId) => taskId),
    ...Array.from(queuedTasks.keys()),
  ])];

  const tasks = taskIds
    .map((taskId) => {
      const normalizedTask =
        planTasks.find((task) => toText(task.id) === taskId) ?? {};
      const queuedTask = queuedTasks.get(taskId);
      const lane = leadLanes.find((candidate) => candidate.dispatchTaskId === taskId);
      const progressStatus = TERMINAL_EXECUTION_STATES.has(lane?.state ?? "")
        ? lane?.state === "completed"
          ? "completed"
          : "failed"
        : lane?.blockedOnTaskIds.length
          ? "blocked"
          : lane?.state === "running"
          ? "in_progress"
            : null;
      const dependencyTaskIds = dependencyTaskIdsByTaskId.get(taskId) ?? [];
      const blockedByTaskIds = dependencyTaskIds.filter((dependencyTaskId) => {
        const dependencyTask = queuedTasks.get(dependencyTaskId);
        return dependencyTask?.status !== "completed";
      });
      return {
        taskId,
        domainId: queuedTask?.domainId ?? toText(normalizedTask.domainId),
        summary: queuedTask?.summary ?? toText(normalizedTask.summary),
        waveId: queuedTask?.waveId ?? waveByTaskId.get(taskId) ?? null,
        status: progressStatus ?? queuedTask?.status ?? "pending",
        executionId: lane?.executionId ?? toText(queuedTask?.executionId) ?? null,
        dependencyTaskIds,
        blockedByTaskIds,
      } satisfies CoordinatorDispatchTaskSummary;
    })
    .sort((left, right) => {
      return (left.waveId ?? left.taskId).localeCompare(right.waveId ?? right.taskId) ||
        left.taskId.localeCompare(right.taskId);
    });

  const currentWaveId =
    dispatchQueue?.currentWaveId ??
    getExecutionCurrentWaveId(rootExecution) ??
    toArray(planPayload.waves)
      .map((wave) => toRecord(wave))
      .map((wave) => ({
        id: toText(wave.id),
        taskIds: toArray(wave.task_ids)
          .map((taskId) => toText(taskId))
          .filter((taskId): taskId is string => Boolean(taskId)),
      }))
      .find((wave) =>
        wave.id
          ? wave.taskIds.some((taskId) => {
              const task = tasks.find((candidate) => candidate.taskId === taskId);
              return task?.status !== "completed" && task?.status !== "failed";
            })
          : false,
      )?.id ??
    null;

  return {
    currentWaveId,
    tasks,
  };
}

function buildDependencySummary(
  adoptedPlan: CoordinatorAdoptedPlanSummary | null,
  dispatchQueue: CoordinatorDispatchQueueSummary,
): CoordinatorDependencySummary[] {
  const statusByTaskId = new Map(
    dispatchQueue.tasks.map((task) => [task.taskId, task.status]),
  );
  return toArray(adoptedPlan?.payload.dependencies)
    .map((dependency) => {
      const normalizedDependency = toRecord(dependency);
      const fromTaskId = toText(normalizedDependency.from_task_id);
      const toTaskId = toText(normalizedDependency.to_task_id);
      if (!fromTaskId || !toTaskId) {
        return null;
      }
      return {
        fromTaskId,
        toTaskId,
        satisfied: statusByTaskId.get(toTaskId) === "completed",
      } satisfies CoordinatorDependencySummary;
    })
    .filter(
      (dependency): dependency is CoordinatorDependencySummary => dependency !== null,
    );
}

function buildQueueStatusSummary(dispatchQueue: CoordinatorDispatchQueueSummary) {
  const counts = {
    pending: 0,
    dispatched: 0,
    in_progress: 0,
    blocked: 0,
    completed: 0,
    failed: 0,
  };
  for (const task of dispatchQueue.tasks) {
    if (Object.hasOwn(counts, task.status)) {
      counts[task.status as keyof typeof counts] += 1;
    }
  }
  return counts;
}

export function buildCoordinatorSummary(
  state: CoordinatorFamilyState,
): CoordinatorSummary {
  const rootExecutionId =
    getExecutionRootExecutionId(state.rootExecution) ?? state.rootExecution.id;
  const familyExecutions = new Map<string, CoordinatorFamilyExecution>();
  for (const execution of state.familyExecutions) {
    familyExecutions.set(execution.id, execution);
  }
  familyExecutions.set(state.rootExecution.id, state.rootExecution);

  const directChildren = Array.from(familyExecutions.values()).filter(
    (execution) => execution.parentExecutionId === state.rootExecution.id,
  );
  const supersededTaskIds = new Set(
    getExecutionSupersededTaskIds(state.rootExecution),
  );
  const latestLeadProgressByExecutionId = buildLatestLeadProgressByExecutionId(
    state.familyHandoffs ?? [],
  );
  const plannerExecution =
    directChildren.find((execution) => {
      const projectRole = getExecutionProjectRole(execution);
      const laneType = toText(execution.metadata?.projectLaneType);
      return projectRole === "planner" || laneType === "planner";
    }) ?? null;
  const leadLanes = directChildren
    .filter((execution) => {
      const projectRole = getExecutionProjectRole(execution);
      const laneType = toText(execution.metadata?.projectLaneType);
      const dispatchTaskId = toText(
        toRecord(execution.metadata?.dispatchTask).taskId,
      );
      return (
        projectRole !== "integrator" &&
        projectRole !== "planner" &&
        laneType !== "planner" &&
        execution.metadata?.dispatchSuperseded !== true &&
        !(dispatchTaskId && supersededTaskIds.has(dispatchTaskId))
      );
    })
    .map((execution) => buildLaneSummary(execution, "lead", latestLeadProgressByExecutionId))
    .sort(compareLaneSummaries);
  const integratorExecution =
    directChildren.find(
      (execution) => getExecutionProjectRole(execution) === "integrator",
    ) ?? null;
  const integratorLane = integratorExecution
    ? buildLaneSummary(integratorExecution, "integrator", latestLeadProgressByExecutionId)
    : null;
  const plannerLane = plannerExecution
    ? buildLaneSummary(plannerExecution, "planner", latestLeadProgressByExecutionId)
    : null;

  const blockers = [
    ...buildEscalationBlockers(state.familyEscalations ?? []),
    ...buildPromotionBlockers(integratorExecution),
  ];
  const latestCoordinationPlan = selectLatestCoordinationPlan(
    state.familyHandoffs ?? [],
  );
  const adoptedPlan = buildAdoptedPlanSummary(state.rootExecution, state.familyHandoffs ?? []);
  const dispatchQueue = buildDispatchQueueSummary(
    state.rootExecution,
    adoptedPlan,
    leadLanes,
  );
  const dependencies = buildDependencySummary(adoptedPlan, dispatchQueue);
  const queueStatus = buildQueueStatusSummary(dispatchQueue);
  const pendingDecisions = Array.from(familyExecutions.values())
    .map((execution) => getPendingDecision(execution))
    .filter(
      (decision): decision is CoordinatorFamilyPendingDecision =>
        decision !== null,
    )
    .sort((left, right) => left.executionId.localeCompare(right.executionId));
  const activeLeadLaneCount = leadLanes.filter(
    (lane) => !TERMINAL_EXECUTION_STATES.has(lane.state),
  ).length;
  const pendingReviewCount = pendingDecisions.filter(
    (decision) => decision.kind === "review",
  ).length;
  const pendingApprovalCount = pendingDecisions.filter(
    (decision) => decision.kind === "approval",
  ).length;
  const readyForIntegratorPlanning =
    leadLanes.length > 0 &&
    activeLeadLaneCount === 0 &&
    pendingReviewCount === 0 &&
    pendingApprovalCount === 0 &&
    blockers.length === 0;
  const readinessState =
    blockers.length > 0
      ? "blocked"
      : pendingApprovalCount > 0
        ? "waiting_approval"
        : pendingReviewCount > 0
          ? "waiting_review"
          : activeLeadLaneCount > 0
            ? "waiting_for_project_leads"
            : readyForIntegratorPlanning
              ? "ready_for_integrator"
              : state.rootExecution.state;

  return {
    rootExecutionId,
    familyKey: getExecutionFamilyKey(state.rootExecution),
    projectId: state.rootExecution.projectId ?? null,
    objective: state.rootExecution.objective ?? null,
    coordinationMode: getExecutionCoordinationMode(state.rootExecution),
    status: state.rootExecution.state,
    plannerLane,
    leadLanes,
    integratorLane,
    blockers,
    pendingDecisions,
    readiness: {
      state: readinessState,
      readyForIntegratorPlanning,
      activeLeadLaneCount,
      pendingReviewCount,
      pendingApprovalCount,
      blockerCount: blockers.length,
    },
    adoptedPlan,
    currentWaveId: dispatchQueue.currentWaveId,
    dispatchQueue,
    queueStatus,
    dependencies,
    replan: getExecutionLatestReplan(state.rootExecution),
    replanHistory: getExecutionReplanHistory(state.rootExecution),
    latestCoordinationPlan,
    latestRoutingSummary: selectLatestRoutingSummary(
      rootExecutionId,
      state.familyHandoffs ?? [],
    ),
  };
}
