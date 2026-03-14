import type { JsonObject } from "@spore/shared-types";

import {
  getExecutionCoordinationMode,
  getExecutionFamilyKey,
  getExecutionProjectRole,
  getExecutionRootExecutionId,
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
  state: string;
  branchKey: string | null;
  holdReason: string | null;
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
  leadLanes: CoordinatorLaneSummary[];
  integratorLane: CoordinatorLaneSummary | null;
  blockers: CoordinatorFamilyBlocker[];
  pendingDecisions: CoordinatorFamilyPendingDecision[];
  readiness: CoordinatorReadinessSummary;
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
): CoordinatorLaneSummary {
  return {
    executionId: execution.id,
    domainId: execution.domainId ?? null,
    role,
    state: execution.state,
    branchKey: execution.branchKey ?? null,
    holdReason: execution.holdReason ?? null,
  };
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
  const leadLanes = directChildren
    .filter((execution) => getExecutionProjectRole(execution) !== "integrator")
    .map((execution) => buildLaneSummary(execution, "lead"))
    .sort(compareLaneSummaries);
  const integratorExecution =
    directChildren.find(
      (execution) => getExecutionProjectRole(execution) === "integrator",
    ) ?? null;
  const integratorLane = integratorExecution
    ? buildLaneSummary(integratorExecution, "integrator")
    : null;

  const blockers = [
    ...buildEscalationBlockers(state.familyEscalations ?? []),
    ...buildPromotionBlockers(integratorExecution),
  ];
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
    latestRoutingSummary: selectLatestRoutingSummary(
      rootExecutionId,
      state.familyHandoffs ?? [],
    ),
  };
}
