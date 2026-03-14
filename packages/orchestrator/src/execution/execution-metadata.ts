// biome-ignore-all lint/suspicious/noExplicitAny: execution metadata remains additive across project, governance, and promotion lanes.
import type { JsonObject, JsonValue } from "@spore/shared-types";

type LooseObject = Record<string, any>;

function asJsonObject(value: unknown): LooseObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as LooseObject)
    : {};
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
