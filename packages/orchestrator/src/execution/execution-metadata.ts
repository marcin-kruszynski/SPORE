// biome-ignore-all lint/suspicious/noExplicitAny: execution metadata remains additive across project, governance, and promotion lanes.
import type { JsonObject, JsonValue } from "@spore/shared-types";

type LooseObject = Record<string, any>;

function asJsonObject(value: unknown): LooseObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as LooseObject)
    : {};
}

function asJsonArray(value: unknown): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function toText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function toInteger(value: unknown): number | null {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getExecutionMetadata(
  execution: { metadata?: JsonObject } | null,
) {
  return asJsonObject(execution?.metadata);
}

export function getExecutionProjectRole(
  execution: { metadata?: JsonObject } | null,
) {
  return (
    String(getExecutionMetadata(execution).projectRole ?? "").trim() || null
  );
}

export function getExecutionTopologyKind(
  execution: {
    metadata?: JsonObject;
    parentExecutionId?: string | null;
    id?: string | null;
  } | null,
) {
  const metadata = getExecutionMetadata(execution);
  return (
    String(metadata.topologyKind ?? "").trim() ||
    (execution?.parentExecutionId ? "child-workflow" : "standalone")
  );
}

export function getExecutionProjectRootId(
  execution: {
    metadata?: JsonObject;
    parentExecutionId?: string | null;
    id?: string | null;
    coordinationGroupId?: string | null;
  } | null,
) {
  return getExecutionRootExecutionId(execution);
}

export function getExecutionRootExecutionId(
  execution: {
    metadata?: JsonObject;
    parentExecutionId?: string | null;
    id?: string | null;
    coordinationGroupId?: string | null;
  } | null,
) {
  const metadata = getExecutionMetadata(execution);
  const explicit = String(
    metadata.rootExecutionId ?? metadata.projectRootExecutionId ?? "",
  ).trim();
  if (explicit) {
    return explicit;
  }
  return getExecutionTopologyKind(execution) === "project-root"
    ? (execution?.id ?? null)
    : null;
}

export function getExecutionFamilyKey(
  execution: {
    metadata?: JsonObject;
    coordinationGroupId?: string | null;
    parentExecutionId?: string | null;
    id?: string | null;
  } | null,
) {
  const metadata = getExecutionMetadata(execution);
  const explicit = String(metadata.familyKey ?? "").trim();
  if (explicit) {
    return explicit;
  }
  const coordinationGroupId = String(execution?.coordinationGroupId ?? "").trim();
  if (!coordinationGroupId) {
    return null;
  }
  return coordinationGroupId === getExecutionRootExecutionId(execution)
    ? null
    : coordinationGroupId;
}

export function getExecutionCoordinationMode(
  execution: { metadata?: JsonObject } | null,
) {
  const metadata = getExecutionMetadata(execution);
  return String(metadata.coordinationMode ?? "").trim() || null;
}

export function getExecutionAdoptedPlan(
  execution: { metadata?: JsonObject } | null,
) {
  const adoptedPlan = asJsonObject(getExecutionMetadata(execution).adoptedPlan);
  if (Object.keys(adoptedPlan).length === 0) {
    return null;
  }
  return {
    status: toText(adoptedPlan.status),
    handoffId: toText(adoptedPlan.handoffId),
    version: toInteger(adoptedPlan.version),
  };
}

export function getExecutionDispatchQueue(
  execution: { metadata?: JsonObject } | null,
) {
  const dispatchQueue = asJsonObject(getExecutionMetadata(execution).dispatchQueue);
  if (Object.keys(dispatchQueue).length === 0) {
    return null;
  }
  return {
    currentWaveId: toText(dispatchQueue.currentWaveId),
    tasks: asJsonArray(dispatchQueue.tasks).map((task) => {
      const normalized = asJsonObject(task);
      return {
        taskId: toText(normalized.taskId),
        domainId: toText(normalized.domainId),
        summary: toText(normalized.summary),
        waveId: toText(normalized.waveId),
        status: toText(normalized.status),
        executionId: toText(normalized.executionId),
        dependencyTaskIds: asJsonArray(normalized.dependencyTaskIds)
          .map((entry) => toText(entry))
          .filter((entry): entry is string => Boolean(entry)),
        sharedContractRefs: asJsonArray(normalized.sharedContractRefs)
          .map((entry) => asJsonObject(entry))
          .map((entry) => ({
            id: toText(entry.id),
            summary: toText(entry.summary),
          }))
          .filter((entry) => entry.id),
        recommendedWorkflow: toText(normalized.recommendedWorkflow),
      };
    }),
  };
}

export function getExecutionDispatchTask(
  execution: { metadata?: JsonObject } | null,
) {
  const dispatchTask = asJsonObject(getExecutionMetadata(execution).dispatchTask);
  if (Object.keys(dispatchTask).length === 0) {
    return null;
  }
  return {
    taskId: toText(dispatchTask.taskId),
    domainId: toText(dispatchTask.domainId),
    summary: toText(dispatchTask.summary),
    waveId: toText(dispatchTask.waveId),
    dependencyTaskIds: asJsonArray(dispatchTask.dependencyTaskIds)
      .map((entry) => toText(entry))
      .filter((entry): entry is string => Boolean(entry)),
    sharedContractRefs: asJsonArray(dispatchTask.sharedContractRefs)
      .map((entry) => {
        const contract = asJsonObject(entry);
        const id = toText(contract.id);
        if (!id) {
          return null;
        }
        return {
          id,
          summary: toText(contract.summary),
        };
      })
      .filter(Boolean),
    recommendedWorkflow: toText(dispatchTask.recommendedWorkflow),
  };
}

export function getExecutionCurrentWaveId(
  execution: { metadata?: JsonObject } | null,
) {
  return (
    getExecutionDispatchQueue(execution)?.currentWaveId ??
    toText(asJsonObject(getExecutionMetadata(execution).adoptedPlan).currentWaveId)
  );
}

export function getExecutionDispatchQueueStatus(
  execution: { metadata?: JsonObject } | null,
) {
  const counts = {
    pending: 0,
    dispatched: 0,
    in_progress: 0,
    blocked: 0,
    completed: 0,
    failed: 0,
  };
  for (const task of getExecutionDispatchQueue(execution)?.tasks ?? []) {
    const status = task.status;
    if (status && Object.hasOwn(counts, status)) {
      counts[status] += 1;
    }
  }
  return counts;
}

export function getExecutionSupersededTaskIds(
  execution: { metadata?: JsonObject } | null,
) {
  return asJsonArray(getExecutionMetadata(execution).supersededTaskIds)
    .map((entry) => toText(entry))
    .filter((entry): entry is string => Boolean(entry));
}

export function getExecutionLatestReplan(
  execution: { metadata?: JsonObject } | null,
) {
  const replan = asJsonObject(getExecutionMetadata(execution).replan);
  if (Object.keys(replan).length === 0) {
    return null;
  }
  return {
    status: toText(replan.status),
    reason: toText(replan.reason),
    latestPlanVersion: toInteger(replan.latestPlanVersion),
    requiresOperatorReview:
      replan.requiresOperatorReview === undefined
        ? null
        : replan.requiresOperatorReview === true,
  };
}

export function getExecutionReplanHistory(
  execution: { metadata?: JsonObject } | null,
) {
  return asJsonArray(getExecutionMetadata(execution).replanHistory)
    .map((entry) => {
      const record = asJsonObject(entry);
      const requestId = toText(record.requestId);
      const reason = toText(record.reason);
      if (!requestId && !reason) {
        return null;
      }
      return {
        requestId,
        reason,
        requestedByExecutionId: toText(record.requestedByExecutionId),
        latestPlanVersion: toInteger(record.latestPlanVersion),
        requiresOperatorReview:
          record.requiresOperatorReview === undefined
            ? null
            : record.requiresOperatorReview === true,
      };
    })
    .filter(Boolean);
}

export function getPromotionSummary(
  execution: { metadata?: JsonObject } | null,
): LooseObject | null {
  const promotion = getExecutionMetadata(execution).promotion;
  return promotion && typeof promotion === "object" && !Array.isArray(promotion)
    ? (promotion as LooseObject)
    : null;
}

export function decorateExecution<
  T extends {
    metadata?: JsonObject;
    parentExecutionId?: string | null;
    id?: string | null;
    coordinationGroupId?: string | null;
  },
>(
  execution: T | null,
):
  | (T & {
      metadata: JsonObject;
      projectRole: string | null;
      topology: {
        kind: string;
        rootRole: string | null;
        projectRootExecutionId: string | null;
        rootExecutionId: string | null;
        projectLaneType: string | null;
        familyKey: string | null;
        coordinationMode: string | null;
      };
      coordination: {
        adoptedPlan: ReturnType<typeof getExecutionAdoptedPlan>;
        dispatchTask: ReturnType<typeof getExecutionDispatchTask>;
        currentWaveId: string | null;
        dispatchQueue: ReturnType<typeof getExecutionDispatchQueue>;
        queueStatus: ReturnType<typeof getExecutionDispatchQueueStatus>;
        supersededTaskIds: ReturnType<typeof getExecutionSupersededTaskIds>;
        replan: ReturnType<typeof getExecutionLatestReplan>;
        replanHistory: ReturnType<typeof getExecutionReplanHistory>;
      };
      promotion: JsonObject | null;
      promotionStatus: JsonValue | null;
    })
  | null {
  if (!execution) {
    return null;
  }
  const metadata = getExecutionMetadata(execution);
  const projectRole = getExecutionProjectRole(execution);
  const promotion = getPromotionSummary(execution);
  return {
    ...execution,
    metadata,
    projectRole,
    topology: {
      kind: getExecutionTopologyKind(execution),
      rootRole: projectRole,
      projectRootExecutionId: getExecutionProjectRootId(execution),
      rootExecutionId: getExecutionRootExecutionId(execution),
      projectLaneType:
        String(metadata.projectLaneType ?? "").trim() || projectRole || null,
      familyKey: getExecutionFamilyKey(execution),
      coordinationMode: getExecutionCoordinationMode(execution),
    },
    coordination: {
      adoptedPlan: getExecutionAdoptedPlan(execution),
      dispatchTask: getExecutionDispatchTask(execution),
      currentWaveId: getExecutionCurrentWaveId(execution),
      dispatchQueue: getExecutionDispatchQueue(execution),
      queueStatus: getExecutionDispatchQueueStatus(execution),
      supersededTaskIds: getExecutionSupersededTaskIds(execution),
      replan: getExecutionLatestReplan(execution),
      replanHistory: getExecutionReplanHistory(execution),
    },
    promotion,
    promotionStatus: promotion?.status ?? null,
  };
}

export function deriveParentHoldReason(
  parentExecution: { metadata?: JsonObject } | null,
  childExecution: { metadata?: JsonObject; domainId?: string | null } | null,
) {
  const parentRole = getExecutionProjectRole(parentExecution);
  const childRole = getExecutionProjectRole(childExecution);
  if (parentRole === "coordinator") {
    if (childRole === "integrator") {
      return "waiting_for_feature_promotion";
    }
    if (childExecution?.domainId) {
      return "waiting_for_project_leads";
    }
  }
  return "waiting_for_child_executions";
}

export function shouldDeferImmediateParentHold(
  parentExecution: { metadata?: JsonObject } | null,
  childExecution: { metadata?: JsonObject; domainId?: string | null } | null,
) {
  return (
    getExecutionProjectRole(parentExecution) === "coordinator" &&
    Boolean(childExecution?.domainId) &&
    getExecutionProjectRole(childExecution) !== "integrator"
  );
}

export function defaultEscalationTargetRole(
  execution: { metadata?: JsonObject } | null,
  explicitTargetRole: string | null = null,
) {
  if (explicitTargetRole) {
    return explicitTargetRole;
  }
  return getExecutionProjectRole(execution) === "integrator"
    ? "coordinator"
    : "lead";
}

export function buildPromotionPolicySummary(
  execution: { policy?: JsonObject } | null,
) {
  const policy = asJsonObject(execution?.policy);
  return {
    autoMergeToTarget: policy.autoMergeToTarget === true,
    requireHumanApprovalToLand: policy.requireHumanApprovalToLand !== false,
    allowMechanicalConflictResolution:
      policy.allowMechanicalConflictResolution === true,
    allowIntegratorAutoLand: policy.allowIntegratorAutoLand === true,
    validationBundles: Array.isArray(policy.validationBundles)
      ? policy.validationBundles
      : [],
  };
}
