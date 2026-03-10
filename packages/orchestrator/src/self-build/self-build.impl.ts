// biome-ignore-all lint/suspicious/noExplicitAny: self-build surfaces intentionally aggregate heterogeneous proposal, workspace, learning, and queue payloads.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parseYaml } from "@spore/config-schema";
import {
  createWorkspace,
  deriveWorkspaceDiagnostics,
  inspectWorkspace,
  reconcileWorkspace,
  removeWorkspace,
} from "@spore/workspace-manager";
import { getExecutionDetail } from "../execution/history.js";
import {
  invokeFeaturePromotion,
  planPromotionForExecution,
} from "../execution/promotion.js";
import {
  DEFAULT_ORCHESTRATOR_DB_PATH,
  PROJECT_ROOT,
} from "../metadata/constants.js";
import {
  getRegressionDefinition,
  getScenarioDefinition,
  getValidationBundleDefinition,
  getWorkItemTemplateDefinition,
  listWorkItemTemplateDefinitions,
} from "../scenarios/catalog.js";
import {
  runRegressionById,
  runScenarioById,
} from "../scenarios/run-history.js";
import {
  findActiveQuarantineRecord,
  getGoalPlan,
  getIntegrationBranch,
  getProposalArtifact,
  getProposalArtifactByRunId,
  getQuarantineRecord,
  getSelfBuildLoopState,
  getWorkItem,
  getWorkItemGroup,
  getWorkItemRun,
  getWorkspaceAllocation,
  getWorkspaceAllocationByRunId,
  insertGoalPlan,
  insertLearningRecord,
  insertProposalArtifact,
  insertQuarantineRecord,
  insertRollbackRecord,
  insertSelfBuildDecision,
  insertWorkItemGroup,
  insertWorkspaceAllocation,
  listGoalPlans,
  listIntegrationBranches,
  listLearningRecords,
  listProposalArtifacts,
  listQuarantineRecords,
  listRollbackRecords,
  listSelfBuildDecisions,
  listSelfBuildLoopStates,
  listWorkItemGroups,
  listWorkItemRuns,
  listWorkspaceAllocations,
  openOrchestratorDatabase,
  updateGoalPlan,
  updateProposalArtifact,
  updateQuarantineRecord,
  updateWorkItem,
  updateWorkItemGroup,
  updateWorkItemRun,
  updateWorkspaceAllocation,
  upsertIntegrationBranch,
  upsertSelfBuildLoopState,
} from "../store/execution-store.js";
import type {
  QuarantineRecordListOptions,
  RollbackRecordListOptions,
  SelfBuildDecisionListOptions,
  WorkspaceAllocationListOptions,
  WorkspaceCleanupPolicy,
  WorkspaceCleanupResult,
} from "../types/contracts.js";
import { asJsonObject, asStringArray } from "../types/contracts.js";
import {
  createWorkItem,
  getManagedWorkItem,
  getManagedWorkItemRun,
  listManagedWorkItems,
  runManagedWorkItem,
  setManagedWorkItemDependencyState,
} from "../work-items/work-items.js";
import {
  buildAttentionItem as buildAttentionItemHelper,
  summarizeAttentionItems as summarizeAttentionItemsHelper,
} from "./attention-items.js";
import {
  attachWorkspacePatchArtifact as attachWorkspacePatchArtifactHelper,
  buildDocSuggestions as buildDocSuggestionsHelper,
  buildProposalArtifacts as buildProposalArtifactsHelper,
} from "./proposal-artifacts.js";
import { buildQueueSummary as buildQueueSummaryHelper } from "./queue-summary.js";
import {
  buildLearningSummary as buildLearningSummaryHelper,
  buildProposalSummary as buildProposalSummaryHelper,
  buildWorkspaceSummary as buildWorkspaceSummaryHelper,
  isProposalPromotionPending as isProposalPromotionPendingHelper,
} from "./summaries.js";

type LooseRecord = any;
type AutonomousPolicyConfig = {
  enabled: boolean;
  mode: string;
  allowedTemplates: string[];
  allowedDomains: string[];
  allowedMutationScopes: string[];
  requiredValidationBundles: string[];
  requireSafeMode: boolean;
  autoReviewGoalPlans: boolean;
  autoMaterializeGoalPlans: boolean;
  autoRunGroups: boolean;
  autoValidateBundles: boolean;
  autoPromoteToIntegration: boolean;
  quarantineOnFailureCount: number;
  quarantineOnBlockedCount: number;
  protectedScopes: string[];
};
type AggregatedPackPolicy = {
  autonomousEligible: boolean;
  allowedTemplates: string[];
  allowedMutationScopes: string[];
  requiredValidationBundles: string[];
  quarantineOnFailureCount: unknown;
  quarantineOnBlockedCount: unknown;
};

function withDatabase(dbPath, fn) {
  const db = openOrchestratorDatabase(dbPath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function toText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function nowIso() {
  return new Date().toISOString();
}

async function readYamlFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return parseYaml(raw);
}

function resolveProjectPath(projectRef = "spore") {
  const normalized = String(projectRef ?? "").trim();
  if (!normalized) {
    return path.join(PROJECT_ROOT, "config/projects/spore.yaml");
  }
  if (normalized.includes("/") || normalized.endsWith(".yaml")) {
    return path.isAbsolute(normalized)
      ? normalized
      : path.join(PROJECT_ROOT, normalized);
  }
  return path.join(PROJECT_ROOT, "config/projects", `${normalized}.yaml`);
}

async function loadProjectConfig(projectRef = "spore") {
  const resolvedPath = resolveProjectPath(projectRef);
  const config = await readYamlFile(resolvedPath);
  return {
    path: path.relative(PROJECT_ROOT, resolvedPath),
    config,
  };
}

async function loadPolicyPackConfig(packId) {
  const resolvedPath = path.join(
    PROJECT_ROOT,
    "config/policy-packs",
    `${packId}.yaml`,
  );
  const config = await readYamlFile(resolvedPath);
  return {
    id: packId,
    path: path.relative(PROJECT_ROOT, resolvedPath),
    config,
  };
}

function mergeMetadata(...values) {
  return Object.assign(
    {},
    ...values.filter(
      (value) => value && typeof value === "object" && !Array.isArray(value),
    ),
  );
}

function compactObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, entry]) => entry !== undefined && entry !== null && entry !== "",
    ),
  );
}

function coerceBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeAutonomousPolicy(
  policy: LooseRecord = {},
): AutonomousPolicyConfig {
  return {
    enabled: coerceBoolean(policy.enabled, false),
    mode: toText(policy.mode, "supervised"),
    allowedTemplates: dedupe(policy.allowedTemplates ?? []),
    allowedDomains: dedupe(policy.allowedDomains ?? []),
    allowedMutationScopes: dedupe(policy.allowedMutationScopes ?? []),
    requiredValidationBundles: dedupe(policy.requiredValidationBundles ?? []),
    requireSafeMode: coerceBoolean(policy.requireSafeMode, true),
    autoReviewGoalPlans: coerceBoolean(policy.autoReviewGoalPlans, false),
    autoMaterializeGoalPlans: coerceBoolean(
      policy.autoMaterializeGoalPlans,
      false,
    ),
    autoRunGroups: coerceBoolean(policy.autoRunGroups, false),
    autoValidateBundles: coerceBoolean(policy.autoValidateBundles, false),
    autoPromoteToIntegration: coerceBoolean(
      policy.autoPromoteToIntegration,
      false,
    ),
    quarantineOnFailureCount:
      Number.isFinite(Number(policy.quarantineOnFailureCount)) &&
      Number(policy.quarantineOnFailureCount) >= 1
        ? Number(policy.quarantineOnFailureCount)
        : 2,
    quarantineOnBlockedCount:
      Number.isFinite(Number(policy.quarantineOnBlockedCount)) &&
      Number(policy.quarantineOnBlockedCount) >= 1
        ? Number(policy.quarantineOnBlockedCount)
        : 2,
    protectedScopes: dedupe(policy.protectedScopes ?? []),
  };
}

async function loadProjectSelfBuildPolicy(projectRef = "spore") {
  const project = await loadProjectConfig(projectRef);
  const projectConfig = asJsonObject(project.config);
  const policyPackIds = dedupe(projectConfig.policyPacks ?? []);
  const packConfigs = [];
  for (const packId of policyPackIds) {
    try {
      packConfigs.push(await loadPolicyPackConfig(packId));
    } catch {
      // Missing policy packs are handled elsewhere by config validation.
    }
  }
  const aggregatedPackPolicy = packConfigs.reduce<AggregatedPackPolicy>(
    (accumulator, pack) => {
      const selfWorkPolicy = asJsonObject(
        asJsonObject(pack.config).selfWorkPolicy,
      );
      return {
        autonomousEligible:
          accumulator.autonomousEligible ||
          selfWorkPolicy.autonomousEligible === true,
        allowedTemplates: dedupe([
          ...asArray(accumulator.allowedTemplates),
          ...asStringArray(selfWorkPolicy.allowedAutonomousTemplates),
        ]),
        allowedMutationScopes: dedupe([
          ...asArray(accumulator.allowedMutationScopes),
          ...asStringArray(selfWorkPolicy.allowedAutonomousMutationScopes),
        ]),
        requiredValidationBundles: dedupe([
          ...asArray(accumulator.requiredValidationBundles),
          ...asStringArray(selfWorkPolicy.requiredAutonomousValidationBundles),
        ]),
        quarantineOnFailureCount:
          asJsonObject(selfWorkPolicy.quarantineThresholds).failureCount ??
          accumulator.quarantineOnFailureCount ??
          null,
        quarantineOnBlockedCount:
          asJsonObject(selfWorkPolicy.quarantineThresholds).blockedCount ??
          accumulator.quarantineOnBlockedCount ??
          null,
      };
    },
    {
      autonomousEligible: false,
      allowedTemplates: [],
      allowedMutationScopes: [],
      requiredValidationBundles: [],
      quarantineOnFailureCount: null,
      quarantineOnBlockedCount: null,
    },
  );
  const defaults = asJsonObject(projectConfig.selfWorkDefaults);
  const defaultAutonomousPolicy = asJsonObject(defaults.autonomousPolicy);
  const autonomy = normalizeAutonomousPolicy({
    enabled:
      defaultAutonomousPolicy.enabled ??
      aggregatedPackPolicy.autonomousEligible ??
      false,
    allowedTemplates: [
      ...asArray(aggregatedPackPolicy.allowedTemplates),
      ...asStringArray(defaultAutonomousPolicy.allowedTemplates),
    ],
    allowedDomains: asStringArray(defaultAutonomousPolicy.allowedDomains),
    allowedMutationScopes: [
      ...asArray(aggregatedPackPolicy.allowedMutationScopes),
      ...asStringArray(defaultAutonomousPolicy.allowedMutationScopes),
    ],
    requiredValidationBundles: [
      ...asArray(aggregatedPackPolicy.requiredValidationBundles),
      ...asStringArray(defaultAutonomousPolicy.requiredValidationBundles),
      ...asStringArray(defaults.defaultValidationBundles),
    ],
    quarantineOnFailureCount:
      defaultAutonomousPolicy.quarantineOnFailureCount ??
      aggregatedPackPolicy.quarantineOnFailureCount,
    quarantineOnBlockedCount:
      defaultAutonomousPolicy.quarantineOnBlockedCount ??
      aggregatedPackPolicy.quarantineOnBlockedCount,
    ...defaultAutonomousPolicy,
  });
  return {
    project,
    projectConfig,
    policyPackIds,
    autonomy,
  };
}

function hashPayload(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value ?? null))
    .digest("hex");
}

function cloneRecommendation(recommendation) {
  if (!recommendation || typeof recommendation !== "object") {
    return null;
  }
  return JSON.parse(JSON.stringify(recommendation));
}

function sanitizeGoalRecommendation(recommendation, index = 0) {
  const normalized = cloneRecommendation(recommendation) ?? {};
  return {
    ...normalized,
    id: toText(normalized.id, createId("goal-rec")),
    title: toText(normalized.title, `Work item ${index + 1}`),
    goal: toText(normalized.goal, normalized.title ?? "Untitled work item"),
    kind: toText(normalized.kind, "workflow"),
    priority: toText(normalized.priority, "medium"),
    groupOrder:
      Number.isFinite(Number(normalized.groupOrder)) &&
      Number(normalized.groupOrder) >= 0
        ? Number(normalized.groupOrder)
        : index,
    acceptanceCriteria: asArray(normalized.acceptanceCriteria),
    relatedScenarios: dedupe(normalized.relatedScenarios ?? []),
    relatedRegressions: dedupe(normalized.relatedRegressions ?? []),
    dependsOn: dedupe(normalized.dependsOn ?? []),
    metadata: mergeMetadata(normalized.metadata ?? {}),
    riskLevel: toText(normalized.riskLevel, "medium"),
    requiredGovernance: toText(normalized.requiredGovernance, "review"),
  };
}

function getGoalPlanEditedRecommendations(plan) {
  return asArray(plan?.metadata?.editedRecommendations)
    .map((recommendation, index) =>
      sanitizeGoalRecommendation(recommendation, index),
    )
    .sort(
      (left, right) =>
        Number(left.groupOrder ?? 0) - Number(right.groupOrder ?? 0),
    );
}

function getGoalPlanEffectiveRecommendations(plan) {
  const edited = getGoalPlanEditedRecommendations(plan);
  if (edited.length > 0) {
    return edited;
  }
  return asArray(plan?.recommendations)
    .map((recommendation, index) =>
      sanitizeGoalRecommendation(recommendation, index),
    )
    .sort(
      (left, right) =>
        Number(left.groupOrder ?? 0) - Number(right.groupOrder ?? 0),
    );
}

function appendGoalPlanEditHistory(entries = [], entry: LooseRecord = {}) {
  const normalized = compactObject({
    id: entry.id ?? createId("goal-plan-edit"),
    editedAt: entry.editedAt ?? nowIso(),
    by: entry.by ?? "operator",
    source: entry.source ?? "operator",
    rationale: entry.rationale ?? "",
    summary: entry.summary ?? "",
    droppedRecommendationIds: dedupe(entry.droppedRecommendationIds ?? []),
    reorderedRecommendationIds: dedupe(entry.reorderedRecommendationIds ?? []),
    addedRecommendationIds: dedupe(entry.addedRecommendationIds ?? []),
    recommendationCount:
      Number.isFinite(Number(entry.recommendationCount)) &&
      Number(entry.recommendationCount) >= 0
        ? Number(entry.recommendationCount)
        : null,
  });
  return [...asArray(entries).slice(-19), normalized];
}

function appendGoalPlanLifecycleHistory(entries = [], entry: LooseRecord = {}) {
  const normalized = compactObject({
    id: entry.id ?? createId("goal-plan-history"),
    type: entry.type ?? "updated",
    timestamp: entry.timestamp ?? nowIso(),
    by: entry.by ?? "operator",
    source: entry.source ?? "system",
    status: entry.status ?? null,
    rationale: entry.rationale ?? "",
    summary: entry.summary ?? "",
    targetId: entry.targetId ?? null,
  });
  return [...asArray(entries).slice(-29), normalized];
}

function summarizeGoalPlanEdits(originalRecommendations = [], edited = []) {
  const originalIds = new Set(
    originalRecommendations.map((recommendation) => String(recommendation.id)),
  );
  const editedIds = edited.map((recommendation) => String(recommendation.id));
  const editedIdSet = new Set(editedIds);
  const droppedRecommendationIds = [...originalIds].filter(
    (id) => !editedIdSet.has(id),
  );
  const addedRecommendationIds = editedIds.filter((id) => !originalIds.has(id));
  const reorderedRecommendationIds = editedIds.filter((id, index) => {
    const originalIndex = originalRecommendations.findIndex(
      (recommendation) => String(recommendation.id) === id,
    );
    return originalIndex >= 0 && originalIndex !== index;
  });
  return {
    droppedRecommendationIds,
    addedRecommendationIds,
    reorderedRecommendationIds,
  };
}

function resolveValidationBundleIdsForWorkItem(
  item,
  run,
  options: LooseRecord = {},
) {
  const explicit = parseIdList(
    options.validationBundles ??
      options.bundleIds ??
      options.bundles ??
      (options.bundle ? [options.bundle] : []),
  );
  if (explicit.length > 0) {
    return explicit;
  }
  const metadata = item?.metadata ?? {};
  const fromRun = dedupe(run?.metadata?.validationBundleIds ?? []);
  if (fromRun.length > 0) {
    return fromRun;
  }
  const fromItem = dedupe(
    metadata.validationBundleIds ??
      metadata.recommendedValidationBundles ??
      metadata.recommendedValidationBundle ??
      [],
  );
  return fromItem;
}

function summarizeValidationBundleRecord(
  bundleId,
  definition,
  payload: LooseRecord = {},
) {
  return compactObject({
    bundleId,
    label: definition?.label ?? bundleId,
    requiredForProposalReadiness:
      definition?.requiredForProposalReadiness ?? false,
    requiredForPromotionReadiness:
      definition?.requiredForPromotionReadiness ?? false,
    scenarioIds: dedupe(payload.scenarioIds ?? definition?.scenarios ?? []),
    regressionIds: dedupe(
      payload.regressionIds ?? definition?.regressions ?? [],
    ),
    scenarioRunIds: dedupe(payload.scenarioRunIds ?? []),
    regressionRunIds: dedupe(payload.regressionRunIds ?? []),
    failureClassifications: dedupe(payload.failureClassifications ?? []),
    errors: asArray(payload.errors),
    status: payload.status ?? "not_configured",
    validatedAt: payload.validatedAt ?? nowIso(),
    fingerprint: payload.fingerprint ?? null,
  });
}

function computeProposalContentFingerprint(proposal) {
  return hashPayload({
    summary: proposal?.summary ?? {},
    artifacts: proposal?.artifacts ?? {},
    metadata: {
      workspaceId: proposal?.metadata?.workspaceId ?? null,
      mutationScope: proposal?.metadata?.mutationScope ?? [],
      sourceExecutionId:
        proposal?.metadata?.promotion?.sourceExecutionId ?? null,
    },
  });
}

function buildProposalValidationStatus(proposal) {
  const validation = proposal?.metadata?.validation ?? {};
  const bundleRecords = asArray(validation.bundleResults);
  const requiredBundles = bundleRecords.filter(
    (record) =>
      record?.requiredForProposalReadiness === true ||
      record?.requiredForPromotionReadiness === true,
  );
  const failingRequired = requiredBundles.filter(
    (record) => String(record?.status) !== "completed",
  );
  const validationDrift = validation.validationDrift === true;
  const blockers = [];
  if (requiredBundles.length === 0) {
    blockers.push({
      code: "missing_validation_bundle",
      reason:
        "Proposal has not been validated against any required validation bundle.",
    });
  }
  for (const record of failingRequired) {
    blockers.push({
      code: "validation_bundle_failed",
      bundleId: record.bundleId ?? null,
      reason: `Validation bundle ${record.label ?? record.bundleId ?? "unknown"} is not completed.`,
    });
  }
  if (validationDrift) {
    blockers.push({
      code: "validation_drift",
      reason:
        "Proposal content changed after the last successful validation and must be validated again.",
    });
  }
  return {
    validation,
    validationDrift,
    requiredBundles,
    blockers,
    ready: blockers.length === 0,
  };
}

function dedupe(values) {
  return Array.from(
    new Set(
      asArray(values)
        .map((value) => String(value).trim())
        .filter(Boolean),
    ),
  );
}

function parseIdList(value) {
  if (Array.isArray(value)) {
    return dedupe(value);
  }
  if (typeof value === "string") {
    return dedupe(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    );
  }
  return [];
}

function groupLinks(groupId) {
  return {
    self: `/work-item-groups/${encodeURIComponent(groupId)}`,
    run: `/work-item-groups/${encodeURIComponent(groupId)}/run`,
    dependencies: `/work-item-groups/${encodeURIComponent(groupId)}/dependencies`,
  };
}

function goalPlanLinks(planId) {
  return {
    self: `/goal-plans/${encodeURIComponent(planId)}`,
    history: `/goal-plans/${encodeURIComponent(planId)}/history`,
    edit: `/goal-plans/${encodeURIComponent(planId)}/edit`,
    review: `/goal-plans/${encodeURIComponent(planId)}/review`,
    materialize: `/goal-plans/${encodeURIComponent(planId)}/materialize`,
    run: `/goal-plans/${encodeURIComponent(planId)}/run`,
  };
}

function dependencyEdgeId(itemId, dependencyItemId, strictness = "hard") {
  return `dependency:${dependencyItemId}:${itemId}:${strictness}`;
}

function blockerId(edgeId, reasonCode) {
  return `blocker:${edgeId}:${reasonCode}`;
}

function appendDependencyLogEntry(
  entries: LooseRecord[] = [],
  entry: LooseRecord = {},
) {
  const normalized = compactObject({
    id: entry.id ?? createId("dependency-transition"),
    type: entry.type ?? "dependency_state_updated",
    timestamp: entry.timestamp ?? nowIso(),
    state: entry.state ?? null,
    reasonCode: entry.reasonCode ?? null,
    reason: entry.reason ?? null,
    itemId: entry.itemId ?? null,
    dependencyItemId: entry.dependencyItemId ?? null,
    blockerId: entry.blockerId ?? null,
    strictness: entry.strictness ?? null,
    nextActionHint: entry.nextActionHint ?? null,
  });
  const existing = asArray(entries);
  const previous = existing[existing.length - 1];
  if (
    previous &&
    previous.type === normalized.type &&
    previous.itemId === normalized.itemId &&
    previous.dependencyItemId === normalized.dependencyItemId &&
    previous.reasonCode === normalized.reasonCode &&
    previous.state === normalized.state
  ) {
    return existing;
  }
  return [...existing.slice(-24), normalized];
}

function recordGroupDependencyTransition(groupId, entry, dbPath) {
  const group = withDatabase(dbPath, (db) => getWorkItemGroup(db, groupId));
  if (!group) {
    return;
  }
  const updated = {
    ...group,
    metadata: {
      ...group.metadata,
      dependencyTransitionLog: appendDependencyLogEntry(
        group.metadata?.dependencyTransitionLog,
        entry,
      ),
    },
    updatedAt: nowIso(),
  };
  withDatabase(dbPath, (db) => updateWorkItemGroup(db, updated));
}

function normalizeDependencyStrictness(value) {
  return String(value ?? "hard").trim() === "advisory" ? "advisory" : "hard";
}

function normalizeAutoRelaxation(value, strictness) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      enabled: value.enabled !== false && strictness === "advisory",
      mode: value.mode ?? (strictness === "advisory" ? "warn-and-run" : "off"),
      reason:
        value.reason ??
        (strictness === "advisory"
          ? "Advisory dependency warnings should stay visible without blocking work."
          : ""),
    };
  }
  const enabled =
    value === undefined
      ? strictness === "advisory"
      : Boolean(value) && strictness === "advisory";
  return {
    enabled,
    mode: enabled ? "warn-and-run" : "off",
    reason: enabled
      ? "Advisory dependency warnings should stay visible without blocking work."
      : "",
  };
}

function normalizeDependencyEdge(edge, itemId, availableItemIds) {
  const dependencyItemId = String(
    edge?.dependencyItemId ?? edge?.dependsOn ?? "",
  ).trim();
  const strictness = normalizeDependencyStrictness(edge?.strictness);
  if (!dependencyItemId) {
    throw new Error(
      `dependency edge for ${itemId} is missing dependencyItemId`,
    );
  }
  if (
    !availableItemIds.has(itemId) ||
    !availableItemIds.has(dependencyItemId)
  ) {
    throw new Error(
      `dependency edge must reference items inside the work-item group: ${dependencyItemId} -> ${itemId}`,
    );
  }
  if (dependencyItemId === itemId) {
    throw new Error(`self-dependencies are not allowed: ${itemId}`);
  }
  return {
    id: dependencyEdgeId(itemId, dependencyItemId, strictness),
    itemId,
    dependencyItemId,
    strictness,
    label:
      strictness === "advisory" ? "advisory dependency" : "hard dependency",
    autoRelaxation: normalizeAutoRelaxation(
      edge?.autoRelaxation ?? edge?.autoRelax ?? undefined,
      strictness,
    ),
  };
}

function getStoredDependencyEdges(item, availableItemIds) {
  const metadataEdges = asArray(item.metadata?.dependencies);
  if (metadataEdges.length > 0) {
    return metadataEdges.map((edge) =>
      normalizeDependencyEdge(edge, item.id, availableItemIds),
    );
  }
  return dedupe(item.metadata?.dependsOn ?? []).map((dependencyItemId) =>
    normalizeDependencyEdge(
      { dependencyItemId, strictness: "hard", autoRelaxation: false },
      item.id,
      availableItemIds,
    ),
  );
}

function sortByGroupOrder(items = []) {
  return [...items].sort((left, right) => {
    const leftOrder = Number(left.metadata?.groupOrder ?? 0);
    const rightOrder = Number(right.metadata?.groupOrder ?? 0);
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return String(left.id).localeCompare(String(right.id));
  });
}

function dependencyStatusLabel(item) {
  if (item.status === "completed") return "completed";
  if (item.status === "skipped") return "completed";
  if (item.status === "running") return "running";
  if (item.status === "failed") return "failed";
  if (item.status === "blocked") {
    return item.metadata?.dependency?.state === "review_needed"
      ? "review_needed"
      : "blocked";
  }
  return item.status || "pending";
}

function getDependencyRecoveryState(item) {
  const recovery = item?.metadata?.dependencyRecovery;
  if (!recovery || typeof recovery !== "object") {
    return { enabled: false, mode: null };
  }
  return {
    enabled: recovery.enabled !== false,
    mode: toText(recovery.mode, null),
    rationale: recovery.rationale ?? "",
    source: recovery.source ?? "operator",
    updatedAt: recovery.updatedAt ?? null,
  };
}

function buildDependencyReason(item, blockers, advisoryWarnings) {
  if (blockers.length > 0) {
    const primary = blockers[0];
    if (primary.reasonCode === "dependency_failed") {
      return `Waiting for a dependency decision because ${primary.dependencyTitle} failed.`;
    }
    if (primary.reasonCode === "dependency_running") {
      return `${primary.dependencyTitle} is running; wait for it to settle before continuing.`;
    }
    return `Waiting for ${primary.dependencyTitle} to complete before ${item.title} can run.`;
  }
  if (advisoryWarnings.length > 0) {
    return `Advisory dependency warning${advisoryWarnings.length === 1 ? "" : "s"} noted for ${item.title}.`;
  }
  return "Ready to run.";
}

function buildNextActionHint(blockers, advisoryWarnings) {
  if (blockers.length > 0) {
    const primary = blockers[0];
    if (primary.reasonCode === "dependency_failed") {
      return `Retry or resolve ${primary.dependencyTitle}, then re-check downstream readiness.`;
    }
    if (primary.reasonCode === "dependency_running") {
      return `Wait for ${primary.dependencyTitle} to settle, then refresh the group detail.`;
    }
    return `Complete ${primary.dependencyTitle} before running the blocked item.`;
  }
  if (advisoryWarnings.length > 0) {
    return "Review the advisory dependency warnings, then run when appropriate.";
  }
  return "Ready to run.";
}

function dependencyTransitionForState(
  item,
  state,
  blockers,
  advisoryWarnings,
  previousState,
  reason,
) {
  if (reason === "dependency_graph_updated") {
    return {
      type: "dependency_graph_updated",
      state,
      reasonCode:
        blockers[0]?.reasonCode ??
        (advisoryWarnings.length > 0 ? "advisory_warning" : "graph_updated"),
      reason:
        blockers[0]?.reason ??
        advisoryWarnings[0]?.reason ??
        "Dependency graph updated.",
      blockerId: blockers[0]?.id ?? null,
      dependencyItemId:
        blockers[0]?.dependencyItemId ??
        advisoryWarnings[0]?.dependencyItemId ??
        null,
      strictness:
        blockers[0]?.strictness ?? advisoryWarnings[0]?.strictness ?? null,
      nextActionHint: buildNextActionHint(blockers, advisoryWarnings),
    };
  }
  if (
    advisoryWarnings.length > 0 &&
    (previousState !== "ready" || reason === "group_run")
  ) {
    return {
      type: "dependency_auto_relaxed",
      state,
      reasonCode: advisoryWarnings[0].reasonCode,
      reason: advisoryWarnings[0].reason,
      blockerId: advisoryWarnings[0].id,
      dependencyItemId: advisoryWarnings[0].dependencyItemId,
      strictness: advisoryWarnings[0].strictness,
      nextActionHint: buildNextActionHint(blockers, advisoryWarnings),
    };
  }
  if (state === previousState) {
    return null;
  }
  if (state === "review_needed") {
    return {
      type: "dependency_review_needed",
      state,
      reasonCode: blockers[0]?.reasonCode ?? "dependency_failed",
      reason: blockers[0]?.reason ?? `A dependency failed for ${item.title}.`,
      blockerId: blockers[0]?.id ?? null,
      dependencyItemId: blockers[0]?.dependencyItemId ?? null,
      strictness: blockers[0]?.strictness ?? null,
      nextActionHint: buildNextActionHint(blockers, advisoryWarnings),
    };
  }
  if (state === "blocked") {
    return {
      type:
        blockers[0]?.reasonCode === "dependency_running"
          ? "dependency_retry_pending"
          : "dependency_blocked",
      state,
      reasonCode: blockers[0]?.reasonCode ?? "dependency_pending",
      reason:
        blockers[0]?.reason ??
        `A dependency is still pending for ${item.title}.`,
      blockerId: blockers[0]?.id ?? null,
      dependencyItemId: blockers[0]?.dependencyItemId ?? null,
      strictness: blockers[0]?.strictness ?? null,
      nextActionHint: buildNextActionHint(blockers, advisoryWarnings),
    };
  }
  if (state === "ready" && previousState && previousState !== "ready") {
    return {
      type: "dependency_ready",
      state,
      reasonCode: "dependencies_satisfied",
      reason: `${item.title} is ready because required dependencies are now satisfied.`,
      nextActionHint: buildNextActionHint(blockers, advisoryWarnings),
    };
  }
  return null;
}

function detectDependencyCycles(edgesByItemId, availableItemIds) {
  const visiting = new Set();
  const visited = new Set();

  function visit(itemId) {
    if (visiting.has(itemId)) {
      throw new Error(`dependency cycle detected involving ${itemId}`);
    }
    if (visited.has(itemId)) {
      return;
    }
    visiting.add(itemId);
    for (const edge of edgesByItemId.get(itemId) ?? []) {
      if (availableItemIds.has(edge.dependencyItemId)) {
        visit(edge.dependencyItemId);
      }
    }
    visiting.delete(itemId);
    visited.add(itemId);
  }

  for (const itemId of availableItemIds) {
    visit(itemId);
  }
}

function evaluateGroupDependencies(items = []) {
  const sortedItems = sortByGroupOrder(items);
  const availableItemIds = new Set(sortedItems.map((item) => item.id));
  const itemMap = new Map(sortedItems.map((item) => [item.id, item]));
  const edgesByItemId = new Map();
  const outgoingByItemId = new Map();
  const allEdges = [];

  for (const item of sortedItems) {
    const edges = getStoredDependencyEdges(item, availableItemIds);
    edgesByItemId.set(item.id, edges);
    for (const edge of edges) {
      allEdges.push(edge);
      const outgoing = outgoingByItemId.get(edge.dependencyItemId) ?? [];
      outgoing.push(edge);
      outgoingByItemId.set(edge.dependencyItemId, outgoing);
    }
  }

  detectDependencyCycles(edgesByItemId, availableItemIds);

  const derivedItems = sortedItems.map((item) => {
    const incomingEdges = edgesByItemId.get(item.id) ?? [];
    const outgoingEdges = outgoingByItemId.get(item.id) ?? [];
    const blockers = [];
    const advisoryWarnings = [];
    const recovery = getDependencyRecoveryState(item);

    for (const edge of incomingEdges) {
      const dependencyItem = itemMap.get(edge.dependencyItemId);
      const dependencyState = dependencyStatusLabel(dependencyItem);
      const title = dependencyItem?.title ?? edge.dependencyItemId;

      if (edge.strictness === "advisory") {
        if (dependencyState !== "completed") {
          advisoryWarnings.push({
            id: blockerId(
              edge.id,
              edge.autoRelaxation.enabled
                ? "advisory_auto_relaxed"
                : "advisory_warning",
            ),
            edgeId: edge.id,
            itemId: item.id,
            dependencyItemId: edge.dependencyItemId,
            dependencyTitle: title,
            strictness: edge.strictness,
            autoRelaxed: edge.autoRelaxation.enabled,
            reasonCode: edge.autoRelaxation.enabled
              ? "advisory_auto_relaxed"
              : "advisory_warning",
            reason: edge.autoRelaxation.enabled
              ? `${title} is not settled, but the advisory dependency auto-relaxed so work can continue.`
              : `${title} is not settled. This dependency is advisory, so work can continue with caution.`,
          });
        }
        continue;
      }

      if (dependencyState === "completed") {
        continue;
      }

      const reasonCode =
        dependencyState === "failed"
          ? "dependency_failed"
          : dependencyState === "running"
            ? "dependency_running"
            : "dependency_pending";
      const reason =
        dependencyState === "failed"
          ? `${title} failed and requires review before downstream work can proceed.`
          : dependencyState === "running"
            ? `${title} is retrying or still running.`
            : `${title} has not completed yet.`;
      const blocker = {
        id: blockerId(edge.id, reasonCode),
        edgeId: edge.id,
        itemId: item.id,
        dependencyItemId: edge.dependencyItemId,
        dependencyTitle: title,
        strictness: edge.strictness,
        reasonCode,
        reason,
        nextActionHint:
          dependencyState === "failed"
            ? `Retry or resolve ${title}, then re-check downstream readiness.`
            : dependencyState === "running"
              ? `Wait for ${title} to settle before starting this work item.`
              : `Complete ${title} before starting this work item.`,
      };
      if (recovery.enabled && recovery.mode === "unblock") {
        advisoryWarnings.push({
          ...blocker,
          autoRelaxed: true,
          reasonCode: "manual_unblock",
          reason:
            recovery.rationale ||
            `Dependency ${title} was manually unblocked for ${item.title}.`,
        });
        continue;
      }
      blockers.push(blocker);
    }

    const storedDependencyState = item.metadata?.dependency?.state ?? null;
    let state = dependencyStatusLabel(item);
    if (!["completed", "running", "failed"].includes(state)) {
      if (
        blockers.some((blocker) => blocker.reasonCode === "dependency_failed")
      ) {
        state = "review_needed";
      } else if (blockers.length > 0) {
        state = "blocked";
      } else {
        state = "ready";
      }
    }

    const reason = buildDependencyReason(item, blockers, advisoryWarnings);
    const nextActionHint = buildNextActionHint(blockers, advisoryWarnings);
    const transition = dependencyTransitionForState(
      item,
      state,
      blockers,
      advisoryWarnings,
      storedDependencyState,
      null,
    );

    return {
      ...item,
      blockedReason:
        state === "blocked" || state === "review_needed" ? reason : null,
      blockerIds: blockers.map((blocker) => blocker.id),
      nextActionHint,
      dependencyState: {
        state,
        readyToRun: state === "ready",
        reason,
        blockerIds: blockers.map((blocker) => blocker.id),
        blockers,
        advisoryWarnings,
        incomingEdges,
        outgoingEdges,
        counts: {
          total: incomingEdges.length,
          hard: incomingEdges.filter((edge) => edge.strictness === "hard")
            .length,
          advisory: incomingEdges.filter(
            (edge) => edge.strictness === "advisory",
          ).length,
          blocked: blockers.length,
          advisoryWarnings: advisoryWarnings.length,
        },
        nextActionHint,
        transition,
        compactSummary: {
          label:
            state === "review_needed"
              ? "dependency review needed"
              : state === "blocked"
                ? "blocked by dependencies"
                : advisoryWarnings.length > 0
                  ? "ready with advisory warning"
                  : state,
          blockerCount: blockers.length,
          advisoryWarningCount: advisoryWarnings.length,
        },
      },
      dependencySummary: {
        totalIncoming: incomingEdges.length,
        totalOutgoing: outgoingEdges.length,
        blockerCount: blockers.length,
        advisoryWarningCount: advisoryWarnings.length,
        nextActionHint,
        reason,
      },
    };
  });

  const counts = derivedItems.reduce(
    (accumulator, item) => {
      const state = item.dependencyState.state;
      accumulator.total += 1;
      accumulator[state] = (accumulator[state] ?? 0) + 1;
      accumulator.advisoryWarnings +=
        item.dependencyState.advisoryWarnings.length;
      return accumulator;
    },
    {
      total: 0,
      ready: 0,
      blocked: 0,
      review_needed: 0,
      running: 0,
      completed: 0,
      failed: 0,
      pending: 0,
      advisoryWarnings: 0,
    },
  );

  let headlineState = "pending";
  if (counts.total === 0) {
    headlineState = "pending";
  } else if (counts.completed === counts.total) {
    headlineState = "completed";
  } else if (counts.failed > 0) {
    headlineState = "failed";
  } else if (counts.running > 0) {
    headlineState = "running";
  } else if (counts.ready > 0) {
    headlineState = "ready";
  } else if (counts.review_needed > 0 || counts.blocked > 0) {
    headlineState = "blocked";
  }

  const transitionLog = derivedItems
    .flatMap((item) => asArray(item.metadata?.dependencyTransitionLog))
    .sort(
      (left, right) =>
        new Date(right.timestamp ?? 0).getTime() -
        new Date(left.timestamp ?? 0).getTime(),
    );

  const dependencyGraph = {
    edges: allEdges.map((edge) => ({
      ...edge,
      itemTitle: itemMap.get(edge.itemId)?.title ?? edge.itemId,
      dependencyTitle:
        itemMap.get(edge.dependencyItemId)?.title ?? edge.dependencyItemId,
    })),
    transitionLog,
    strictnessCounts: {
      hard: allEdges.filter((edge) => edge.strictness === "hard").length,
      advisory: allEdges.filter((edge) => edge.strictness === "advisory")
        .length,
    },
  };

  return {
    items: derivedItems,
    dependencyGraph,
    readiness: {
      headlineState,
      counts: {
        total: counts.total,
        ready: counts.ready,
        blocked: counts.blocked,
        reviewNeeded: counts.review_needed,
        running: counts.running,
        completed: counts.completed,
        failed: counts.failed,
        advisoryWarnings: counts.advisoryWarnings,
      },
      blockerIds: derivedItems.flatMap((item) => item.blockerIds ?? []),
      readyItemIds: derivedItems
        .filter((item) => item.dependencyState.readyToRun)
        .map((item) => item.id),
      blockedItemIds: derivedItems
        .filter((item) =>
          ["blocked", "review_needed"].includes(item.dependencyState.state),
        )
        .map((item) => item.id),
      nextActionHint:
        headlineState === "failed"
          ? "Investigate failed work items and retry or resolve their dependents."
          : headlineState === "blocked"
            ? "Resolve blockers or wait for upstream work before running the group."
            : headlineState === "ready"
              ? "Run ready work items or inspect remaining blockers before launch."
              : headlineState === "completed"
                ? "All grouped work items are complete."
                : "Materialize or queue additional work before running the group.",
      preRunSummary: {
        label:
          headlineState === "ready"
            ? `${counts.ready} ready, ${counts.blocked + counts.review_needed} blocked/review-needed`
            : `${counts.completed}/${counts.total} complete`,
        totalEdges: allEdges.length,
        affectedDownstreamCount: derivedItems.filter(
          (item) => item.dependencyState.counts.total > 0,
        ).length,
      },
    },
  };
}

function persistGroupDependencyState(group, evaluated, reason, dbPath) {
  const rawItems = new Map(group.items.map((item) => [item.id, item]));
  for (const item of evaluated.items) {
    const current = rawItems.get(item.id) ?? item;
    const existingState = current.metadata?.dependency?.state ?? null;
    const transition = dependencyTransitionForState(
      item,
      item.dependencyState.state,
      item.dependencyState.blockers,
      item.dependencyState.advisoryWarnings,
      existingState,
      reason,
    );
    const status = ["completed", "running", "failed"].includes(current.status)
      ? current.status
      : ["blocked", "review_needed"].includes(item.dependencyState.state)
        ? "blocked"
        : "pending";
    setManagedWorkItemDependencyState(
      item.id,
      {
        status,
        state: item.dependencyState.state,
        reasonCode:
          item.dependencyState.blockers[0]?.reasonCode ??
          item.dependencyState.advisoryWarnings[0]?.reasonCode ??
          null,
        reason: item.dependencyState.reason,
        nextActionHint: item.dependencyState.nextActionHint,
        blockerIds: item.blockerIds,
        blockers: item.dependencyState.blockers,
        advisoryWarnings: item.dependencyState.advisoryWarnings,
        incomingEdges: item.dependencyState.incomingEdges,
        outgoingEdges: item.dependencyState.outgoingEdges,
        readyToRun: item.dependencyState.readyToRun,
        transition,
        updatedAt: nowIso(),
      },
      dbPath,
    );
  }

  const refreshedGroup = withDatabase(dbPath, (db) =>
    getWorkItemGroup(db, group.id),
  );
  const updatedGroup = {
    ...refreshedGroup,
    status: evaluated.readiness.headlineState,
    summary: {
      ...(refreshedGroup?.summary ?? {}),
      dependencyReadiness: evaluated.readiness,
      dependencyEdgeCount: evaluated.dependencyGraph.edges.length,
    },
    metadata: {
      ...(refreshedGroup?.metadata ?? {}),
      dependencyGraph: {
        strictnessCounts: evaluated.dependencyGraph.strictnessCounts,
        lastEvaluatedAt: nowIso(),
        lastEvaluationReason: reason ?? "read",
      },
    },
    updatedAt: nowIso(),
    lastRunAt: refreshedGroup?.lastRunAt ?? null,
  };
  withDatabase(dbPath, (db) => updateWorkItemGroup(db, updatedGroup));
}

function workItemKindRequiresProposal(item) {
  return (
    item.kind === "workflow" ||
    item.metadata?.requiresProposal === true ||
    item.metadata?.codeOriented === true
  );
}

function workItemRequiresWorkspace(item) {
  return (
    item.metadata?.requiresWorkspace === true ||
    workItemKindRequiresProposal(item)
  );
}

function buildTemplatePayload(template, payload: LooseRecord = {}) {
  const templateMetadata = template.defaultMetadata ?? template.metadata ?? {};
  const payloadMetadata = compactObject(payload.metadata ?? {}) as LooseRecord;
  return {
    ...payload,
    title: payload.title ?? template.label ?? template.id,
    kind: payload.kind ?? template.kind,
    goal: toText(payload.goal, template.defaultGoal ?? ""),
    priority: payload.priority ?? template.priority ?? "medium",
    acceptanceCriteria: dedupe([
      ...(template.acceptanceCriteria ?? []),
      ...(payload.acceptanceCriteria ?? []),
    ]),
    relatedDocs: dedupe([
      ...(template.relatedDocs ?? []),
      ...(payload.relatedDocs ?? []),
    ]),
    relatedScenarios: dedupe([
      ...(template.recommendedScenarios ?? []),
      ...(payload.relatedScenarios ?? []),
    ]),
    relatedRegressions: dedupe([
      ...(template.recommendedRegressions ?? []),
      ...(payload.relatedRegressions ?? []),
    ]),
    metadata: mergeMetadata(templateMetadata, payloadMetadata, {
      templateId: template.id,
      recommendedScenarios: dedupe([
        ...(template.recommendedScenarios ?? []),
        ...(payloadMetadata.recommendedScenarios ?? []),
      ]),
      recommendedRegressions: dedupe([
        ...(template.recommendedRegressions ?? []),
        ...(payloadMetadata.recommendedRegressions ?? []),
      ]),
      safeModeEligible: template.safeModeEligible !== false,
      selfBuildEligible: template.selfBuildEligible !== false,
    }),
  };
}

function extractGoalDomain(goal = "", explicitDomain = null) {
  if (explicitDomain) {
    return explicitDomain;
  }
  const normalized = String(goal).toLowerCase();
  if (
    normalized.includes("doc") ||
    normalized.includes("adr") ||
    normalized.includes("readme")
  ) {
    return "docs";
  }
  if (
    normalized.includes("cli") ||
    normalized.includes("terminal") ||
    normalized.includes("operator")
  ) {
    return "cli";
  }
  return "backend";
}

function buildGoalRecommendations({
  goal,
  domainId,
  safeMode = true,
  projectPath = "config/projects/spore.yaml",
  projectConfig = null,
}) {
  const normalized = String(goal).toLowerCase();
  const activeDomains = dedupe(projectConfig?.activeDomains ?? []);
  const hasDomain = (candidate) =>
    activeDomains.length === 0 ||
    activeDomains.includes(candidate) ||
    candidate === domainId;
  const recommendations = [];

  if (
    (normalized.includes("doc") ||
      normalized.includes("adr") ||
      normalized.includes("readme") ||
      domainId === "docs") &&
    hasDomain("docs")
  ) {
    recommendations.push({
      title: "Docs maintenance pass",
      kind: "scenario",
      goal,
      acceptanceCriteria: [
        "Produce documentation-oriented output.",
        "Leave a durable scenario run for review.",
      ],
      relatedScenarios: ["docs-adr-pass"],
      metadata: {
        templateId: "docs-maintenance-pass",
        scenarioId: "docs-adr-pass",
        domainId: "docs",
        projectPath,
        safeMode,
        mutationScope: ["docs", "runbooks"],
        recommendedScenarios: ["docs-adr-pass"],
        recommendedRegressions: ["local-fast"],
      },
    });
  }

  if (
    (normalized.includes("config") || normalized.includes("schema")) &&
    hasDomain("docs")
  ) {
    recommendations.push({
      title: "Config/schema maintenance",
      kind: "workflow",
      goal,
      acceptanceCriteria: [
        "Produce a reviewable proposal package.",
        "Validation must include local-fast regression.",
      ],
      relatedRegressions: ["local-fast"],
      metadata: {
        templateId: "config-schema-maintenance",
        workflowPath: "config/workflows/docs-adr-pass.yaml",
        domainId: "docs",
        projectPath,
        roles: ["lead", "scout", "reviewer"],
        safeMode,
        mutationScope: ["config", "docs"],
        requiresProposal: true,
        codeOriented: true,
        recommendedScenarios: ["docs-adr-pass"],
        recommendedRegressions: ["local-fast"],
      },
    });
  }

  if (
    (normalized.includes("web") ||
      normalized.includes("ui") ||
      normalized.includes("dashboard") ||
      domainId === "frontend") &&
    hasDomain("frontend")
  ) {
    recommendations.push({
      title: "Operator UI pass",
      kind: "workflow",
      goal,
      acceptanceCriteria: [
        "Produce a proposal for UI-facing work.",
        "Validate with frontend-ui-pass.",
      ],
      relatedScenarios: ["frontend-ui-pass"],
      relatedRegressions: ["local-fast"],
      metadata: {
        templateId: "operator-ui-pass",
        workflowPath: "config/workflows/frontend-ui-pass.yaml",
        domainId: "frontend",
        projectPath,
        roles: ["lead", "scout", "builder", "tester", "reviewer"],
        safeMode,
        mutationScope: safeMode ? ["docs", "config", "apps/web"] : ["apps/web"],
        requiresProposal: true,
        codeOriented: true,
        recommendedScenarios: ["frontend-ui-pass"],
        recommendedRegressions: ["local-fast"],
      },
    });
  }

  if (
    (normalized.includes("runtime") ||
      normalized.includes("session") ||
      normalized.includes("gateway") ||
      normalized.includes("validation") ||
      domainId === "backend") &&
    hasDomain("backend")
  ) {
    recommendations.push({
      title: "Runtime validation pass",
      kind: "regression",
      goal,
      acceptanceCriteria: [
        "Run canonical runtime validation.",
        "Produce durable regression history.",
      ],
      relatedRegressions: [safeMode ? "local-fast" : "pi-canonical"],
      metadata: {
        templateId: "runtime-validation-pass",
        regressionId: safeMode ? "local-fast" : "pi-canonical",
        domainId: domainId ?? "backend",
        projectPath,
        safeMode,
        mutationScope: safeMode
          ? ["config", "docs"]
          : ["packages/runtime-pi", "services/session-gateway"],
        recommendedRegressions: [safeMode ? "local-fast" : "pi-canonical"],
      },
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      title: "General self-work investigation",
      kind: "scenario",
      goal,
      acceptanceCriteria: [
        "Create a durable scenario run.",
        "Stop for review if governance blocks further progress.",
      ],
      relatedScenarios: ["cli-verification-pass"],
      metadata: {
        templateId: "general-self-work",
        scenarioId: "cli-verification-pass",
        domainId: domainId ?? "cli",
        projectPath,
        safeMode,
        mutationScope: ["docs", "config"],
        recommendedScenarios: ["cli-verification-pass"],
        recommendedRegressions: ["local-fast"],
      },
    });
  }

  return recommendations.map((recommendation, index) => ({
    ...recommendation,
    id: `${index + 1}`,
    groupOrder: index,
    dependsOn: index === 0 ? [] : [String(index)],
    riskLevel: recommendation.kind === "workflow" ? "medium" : "low",
    requiredGovernance: recommendation.metadata?.requiresProposal
      ? "review-and-approval"
      : "review",
  }));
}

function buildGoalPlanSummary(plan, items = [], group = null) {
  const originalRecommendations = asArray(
    plan.metadata?.originalRecommendations,
  );
  const editedRecommendations = getGoalPlanEditedRecommendations(plan);
  const effectiveRecommendations = getGoalPlanEffectiveRecommendations(plan);
  const recentActivity =
    items.length > 0
      ? items
          .map((item) => ({
            timestamp: item.updatedAt,
            kind: "work-item",
            id: item.id,
          }))
          .sort(
            (left, right) =>
              new Date(right.timestamp).getTime() -
              new Date(left.timestamp).getTime(),
          )[0]
      : null;

  return {
    ...plan,
    links: goalPlanLinks(plan.id),
    originalRecommendations,
    editedRecommendations,
    recommendations: effectiveRecommendations,
    recommendedWorkItems: effectiveRecommendations,
    materializedGroup: group,
    materializedItems: items,
    reviewHistory: asArray(plan.metadata?.reviewHistory),
    editHistory: asArray(plan.metadata?.editHistory),
    history: asArray(plan.metadata?.history),
    reviewRationale: plan.metadata?.reviewRationale ?? "",
    materializationSnapshot: plan.metadata?.materializationSnapshot ?? null,
    operatorFlow: compactObject({
      reviewRequired: plan.metadata?.reviewRequired ?? true,
      lastReviewedAt: plan.metadata?.lastReviewedAt ?? null,
      materializedAt: plan.materializedAt ?? null,
      groupId: plan.metadata?.groupId ?? null,
      nextAction:
        plan.status === "planned"
          ? "review"
          : plan.status === "reviewed"
            ? "materialize"
            : plan.status === "materialized"
              ? "run"
              : ["running", "blocked", "completed", "failed"].includes(
                    String(plan.status),
                  )
                ? "inspect-group"
                : null,
    }),
    operatorDecisions: compactObject({
      reviewRationale: plan.metadata?.reviewRationale ?? "",
      materializationSource:
        plan.metadata?.materializationSnapshot?.source ?? null,
      materializedGroupId:
        plan.metadata?.materializationSnapshot?.groupId ??
        plan.metadata?.groupId ??
        null,
    }),
    recentActivity: recentActivity
      ? {
          timestamp: recentActivity.timestamp,
          kind: recentActivity.kind,
          targetId: recentActivity.id,
        }
      : null,
  };
}

function buildGroupSummary(group, items = [], runs = [], proposals = []) {
  const latestRunAt =
    runs[0]?.endedAt ?? runs[0]?.startedAt ?? group.lastRunAt ?? null;
  const counts = runs.reduce((accumulator, run) => {
    accumulator[run.status] = (accumulator[run.status] ?? 0) + 1;
    return accumulator;
  }, {});
  const evaluated = evaluateGroupDependencies(items);
  const itemsWithLinks = evaluated.items.map((item) => ({
    ...item,
    links: {
      self: `/work-items/${encodeURIComponent(item.id)}`,
      runs: `/work-items/${encodeURIComponent(item.id)}/runs`,
    },
  }));
  const runsWithLinks = runs.slice(0, 10).map((run) => ({
    ...run,
    links: {
      self: `/work-item-runs/${encodeURIComponent(run.id)}`,
      item: `/work-items/${encodeURIComponent(run.workItemId)}`,
    },
  }));
  const transitionLog = [
    ...asArray(group.metadata?.dependencyTransitionLog),
    ...evaluated.dependencyGraph.transitionLog,
  ].sort(
    (left, right) =>
      new Date(right.timestamp ?? 0).getTime() -
      new Date(left.timestamp ?? 0).getTime(),
  );

  return {
    ...group,
    status: evaluated.readiness.headlineState,
    itemCount: items.length,
    latestRunAt,
    runCountsByStatus: counts,
    items: itemsWithLinks,
    recentRuns: runsWithLinks,
    dependencyGraph: {
      ...evaluated.dependencyGraph,
      transitionLog,
    },
    readiness: evaluated.readiness,
    proposals: proposals.map((proposal) => buildProposalSummary(proposal)),
    validationSummary: runs.reduce((accumulator, run) => {
      const status = summarizeValidationState(run.metadata?.validation);
      accumulator[status] = (accumulator[status] ?? 0) + 1;
      return accumulator;
    }, {}),
    batchHistory: asArray(group.metadata?.batchHistory),
    links: groupLinks(group.id),
  };
}

function listGroupProposals(
  groupId,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
  items = null,
) {
  const itemIds = new Set(
    asArray(items)
      .map((item) => item?.id)
      .filter(Boolean),
  );
  if (!itemIds.size) {
    const resolvedItems = listManagedWorkItems({ limit: 500 }, dbPath).filter(
      (item) => item.metadata?.groupId === groupId,
    );
    for (const item of resolvedItems) {
      itemIds.add(item.id);
    }
  }
  return withDatabase(dbPath, (db) => listProposalArtifacts(db, null, 500))
    .filter((proposal) => itemIds.has(proposal.workItemId))
    .map(buildProposalSummary);
}

function appendGroupBatchHistory(
  existingEntries: LooseRecord[] = [],
  entry: LooseRecord = {},
) {
  const normalized = compactObject({
    id: entry.id ?? createId("group-batch"),
    batchNumber: entry.batchNumber ?? null,
    startedAt: entry.startedAt ?? nowIso(),
    endedAt: entry.endedAt ?? null,
    readinessState: entry.readinessState ?? null,
    itemIds: dedupe(entry.itemIds ?? []),
    itemTitles: asArray(entry.itemTitles).filter(Boolean),
    statuses: compactObject(entry.statuses ?? {}),
    validationStatuses: compactObject(entry.validationStatuses ?? {}),
    failedItemIds: dedupe(entry.failedItemIds ?? []),
    blockedItemIds: dedupe(entry.blockedItemIds ?? []),
    nextActionHint: entry.nextActionHint ?? null,
  });
  return [...asArray(existingEntries).slice(-11), normalized];
}

function workItemShouldAutoValidate(run: LooseRecord = {}) {
  return workItemRunTerminalKind(run) === "completed";
}

function normalizeGroupRunEntry(result: LooseRecord = {}) {
  if (result?.item && result?.run) {
    return {
      itemId: result.item.id,
      item: result.item,
      run: result.run,
      proposal: result.proposal ?? null,
      learningRecord: result.learningRecord ?? null,
      status: result.run.status ?? result.status ?? "completed",
    };
  }
  return result;
}

function isProposalPromotionPending(proposal) {
  return isProposalPromotionPendingHelper(proposal);
}

function ensureSafeMode(item, projectId = null) {
  const metadata = item.metadata ?? {};
  const safeMode = metadata.safeMode !== false;
  const mutationScope = dedupe(metadata.mutationScope ?? []);
  const allowedSafeScope = [
    "docs",
    "config",
    "runbooks",
    "scenarios",
    "regressions",
    "apps/web",
  ];
  if (!safeMode) {
    return { safeMode, mutationScope };
  }
  for (const scope of mutationScope) {
    if (!allowedSafeScope.includes(scope)) {
      throw new Error(`safe mode blocks mutation scope: ${scope}`);
    }
  }
  if (
    projectId === "spore" &&
    item.kind === "workflow" &&
    mutationScope.length === 0
  ) {
    throw new Error(
      "safe mode workflow work items must declare metadata.mutationScope",
    );
  }
  return { safeMode, mutationScope };
}

function buildProposalSummary(artifact) {
  const summary = buildProposalSummaryHelper(artifact);
  if (!summary) {
    return null;
  }
  const validationStatus = buildProposalValidationStatus(artifact);
  return {
    ...summary,
    validation: validationStatus.validation,
    validationDrift: validationStatus.validationDrift,
    readiness: {
      ready: validationStatus.ready,
      blockers: validationStatus.blockers,
      requiredBundles: validationStatus.requiredBundles,
    },
  };
}

function buildLearningSummary(record) {
  return buildLearningSummaryHelper(record);
}

function buildWorkspaceSummary(allocation) {
  return buildWorkspaceSummaryHelper(allocation);
}

function getWorkspaceOwnerContext(
  allocation,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  if (!allocation) {
    return {
      workItemRun: null,
      proposal: null,
      workItem: null,
    };
  }
  return withDatabase(dbPath, (db) => ({
    workItemRun: allocation.workItemRunId
      ? getWorkItemRun(db, allocation.workItemRunId)
      : null,
    proposal: allocation.proposalArtifactId
      ? getProposalArtifact(db, allocation.proposalArtifactId)
      : null,
    workItem: allocation.workItemId
      ? getWorkItem(db, allocation.workItemId)
      : null,
  }));
}

function buildWorkspaceCleanupPolicy(
  options: LooseRecord = {},
): WorkspaceCleanupPolicy {
  const {
    allocation,
    inspection = null,
    workItemRun = null,
    proposal = null,
  } = options;
  const blockedBy = [];
  let reason = "ready";
  let eligible = true;

  if (!allocation) {
    return {
      eligible: false,
      reason: "missing-allocation",
      blockedBy: ["missing-allocation"],
      requiresForce: false,
    };
  }

  if (allocation.status === "cleaned") {
    return {
      eligible: false,
      reason: "already-cleaned",
      blockedBy: ["already-cleaned"],
      requiresForce: false,
    };
  }

  if (["provisioning"].includes(allocation.status)) {
    eligible = false;
    reason = "still-provisioning";
    blockedBy.push("still-provisioning");
  }

  if (
    proposal &&
    (["ready_for_review", "reviewed"].includes(proposal.status) ||
      isProposalPromotionPending(proposal))
  ) {
    eligible = false;
    reason = isProposalPromotionPending(proposal)
      ? "proposal-awaiting-promotion"
      : "proposal-awaiting-governance";
    blockedBy.push(reason);
  }

  if (
    workItemRun &&
    ["planned", "starting", "running"].includes(workItemRun.status)
  ) {
    eligible = false;
    reason = "owner-run-active";
    blockedBy.push("owner-run-active");
  }

  const dirty =
    Array.isArray(inspection?.porcelain) && inspection.porcelain.length > 0;
  const requiresForce =
    dirty || ["orphaned", "failed"].includes(allocation.status);
  const artifactRetention =
    proposal &&
    (["ready_for_review", "reviewed", "approved"].includes(proposal.status) ||
      isProposalPromotionPending(proposal))
      ? "retain"
      : proposal
        ? "retain-patch-only"
        : "optional";
  const workspaceRetention = !eligible
    ? "keep-until-governance-settles"
    : requiresForce
      ? "operator-cleanup-with-force"
      : "cleanup-allowed";

  return {
    eligible,
    reason,
    blockedBy,
    requiresForce,
    defaultKeepBranch: false,
    artifactRetention,
    workspaceRetention,
    recommendation: eligible
      ? requiresForce
        ? "cleanup-with-force"
        : "cleanup"
      : "inspect-before-cleanup",
  };
}

function enrichWorkspaceAllocation(
  allocation,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
  inspection = null,
) {
  const summary = buildWorkspaceSummary(allocation);
  if (!summary) {
    return null;
  }
  const context = getWorkspaceOwnerContext(allocation, dbPath);
  const diagnostics = inspection
    ? deriveWorkspaceDiagnostics({ inspection, allocation })
    : compactObject(allocation.metadata?.diagnostics ?? {});
  const cleanupPolicy = buildWorkspaceCleanupPolicy({
    allocation,
    inspection,
    workItemRun: context.workItemRun,
    proposal: context.proposal,
  });
  return {
    ...summary,
    diagnostics,
    cleanupPolicy,
    owner: {
      workItemId: allocation.workItemId ?? null,
      workItemRunId: allocation.workItemRunId ?? null,
      workItemRunStatus: context.workItemRun?.status ?? null,
      proposalArtifactId: allocation.proposalArtifactId ?? null,
      proposalStatus: context.proposal?.status ?? null,
    },
  };
}

function countDocSuggestions(value) {
  return Array.isArray(value) ? value.length : 0;
}

function summarizeValidationState(validation = null) {
  if (!validation) {
    return "not_configured";
  }
  return validation.status ?? "not_configured";
}

function workItemRunTerminalKind(run: LooseRecord = {}) {
  const status = String(run.status ?? "").trim();
  if (["completed", "passed"].includes(status)) {
    return "completed";
  }
  if (["failed", "rejected", "canceled", "stopped"].includes(status)) {
    return "failed";
  }
  if (
    [
      "waiting_review",
      "waiting_approval",
      "held",
      "paused",
      "blocked",
    ].includes(status)
  ) {
    return "blocked";
  }
  if (["running", "planned", "starting"].includes(status)) {
    return "running";
  }
  return "pending";
}

function buildWorkItemRunLinks(run) {
  const result = run?.result ?? {};
  return compactObject({
    self: `/work-item-runs/${encodeURIComponent(run.id)}`,
    item: `/work-items/${encodeURIComponent(run.workItemId)}`,
    proposal: `/work-item-runs/${encodeURIComponent(run.id)}/proposal`,
    workspace: `/work-item-runs/${encodeURIComponent(run.id)}/workspace`,
    validate: `/work-item-runs/${encodeURIComponent(run.id)}/validate`,
    docSuggestions: `/work-item-runs/${encodeURIComponent(run.id)}/doc-suggestions`,
    rerun: `/work-item-runs/${encodeURIComponent(run.id)}/rerun`,
    scenarioRun: result.scenarioRunId
      ? `/scenario-runs/${encodeURIComponent(result.scenarioRunId)}`
      : null,
    regressionRun: result.regressionRunId
      ? `/regression-runs/${encodeURIComponent(result.regressionRunId)}`
      : null,
    execution: result.executionId
      ? `/executions/${encodeURIComponent(result.executionId)}`
      : null,
  });
}

function buildRunComparison(currentRun, previousRun) {
  if (!currentRun || !previousRun) {
    return null;
  }
  const currentValidation = summarizeValidationState(
    currentRun.metadata?.validation,
  );
  const previousValidation = summarizeValidationState(
    previousRun.metadata?.validation,
  );
  const currentDocSuggestions = countDocSuggestions(
    currentRun.metadata?.docSuggestions,
  );
  const previousDocSuggestions = countDocSuggestions(
    previousRun.metadata?.docSuggestions,
  );
  const currentProposalId = currentRun.metadata?.proposalArtifactId ?? null;
  const previousProposalId = previousRun.metadata?.proposalArtifactId ?? null;
  const currentStarted = Date.parse(
    currentRun.startedAt ?? currentRun.createdAt ?? 0,
  );
  const previousStarted = Date.parse(
    previousRun.startedAt ?? previousRun.createdAt ?? 0,
  );

  return {
    previousRunId: previousRun.id,
    statusChanged: currentRun.status !== previousRun.status,
    previousStatus: previousRun.status ?? null,
    validationChanged: currentValidation !== previousValidation,
    previousValidationStatus: previousValidation,
    currentValidationStatus: currentValidation,
    proposalChanged: currentProposalId !== previousProposalId,
    previousProposalId,
    currentProposalId,
    docSuggestionDelta: currentDocSuggestions - previousDocSuggestions,
    currentDocSuggestionCount: currentDocSuggestions,
    previousDocSuggestionCount: previousDocSuggestions,
    startedDeltaMs:
      Number.isFinite(currentStarted) && Number.isFinite(previousStarted)
        ? currentStarted - previousStarted
        : null,
    summary:
      currentRun.status !== previousRun.status
        ? `Status changed from ${previousRun.status} to ${currentRun.status}.`
        : currentValidation !== previousValidation
          ? `Validation changed from ${previousValidation} to ${currentValidation}.`
          : currentProposalId !== previousProposalId
            ? "Proposal linkage changed between runs."
            : currentDocSuggestions !== previousDocSuggestions
              ? `Documentation suggestion count changed from ${previousDocSuggestions} to ${currentDocSuggestions}.`
              : "No major run-to-run delta detected.",
  };
}

function summarizeWorkItemRunTrend(runs = []) {
  const counts = runs.reduce(
    (accumulator, run) => {
      const bucket = workItemRunTerminalKind(run);
      accumulator.total += 1;
      accumulator[bucket] = (accumulator[bucket] ?? 0) + 1;
      return accumulator;
    },
    { total: 0, completed: 0, blocked: 0, failed: 0, running: 0, pending: 0 },
  );
  const latest = runs[0] ?? null;
  const latestCompleted =
    runs.find((run) => workItemRunTerminalKind(run) === "completed") ?? null;
  const latestFailed =
    runs.find((run) => workItemRunTerminalKind(run) === "failed") ?? null;
  const health =
    counts.failed > 0
      ? "degraded"
      : counts.blocked > 0
        ? "needs-review"
        : counts.running > 0
          ? "active"
          : counts.total > 0
            ? "healthy"
            : "idle";
  return {
    runCount: counts.total,
    byState: counts,
    health,
    latestRunId: latest?.id ?? null,
    latestSuccessfulRunId: latestCompleted?.id ?? null,
    latestFailedRunId: latestFailed?.id ?? null,
  };
}

function buildWorkItemRunSummary(run, item = null, previousRun = null) {
  if (!run) {
    return null;
  }
  const validationStatus = summarizeValidationState(run.metadata?.validation);
  const docSuggestionCount = countDocSuggestions(run.metadata?.docSuggestions);
  const result = run.result ?? {};
  return {
    ...run,
    itemTitle: item?.title ?? null,
    itemKind: item?.kind ?? null,
    terminalKind: workItemRunTerminalKind(run),
    validationStatus,
    docSuggestionCount,
    hasProposal: Boolean(run.metadata?.proposalArtifactId),
    hasWorkspace: Boolean(run.metadata?.workspaceId),
    links: buildWorkItemRunLinks(run),
    comparisonToPrevious: buildRunComparison(run, previousRun),
    relationSummary: compactObject({
      scenarioRunId: result.scenarioRunId ?? null,
      regressionRunId: result.regressionRunId ?? null,
      executionId: result.executionId ?? null,
    }),
  };
}

function buildAttentionItem(payload: LooseRecord = {}) {
  return buildAttentionItemHelper(payload, createId, nowIso);
}

function summarizeAttentionItems(items = []) {
  const summary = summarizeAttentionItemsHelper(items);
  return {
    ...summary,
    highestPriorityState: summary.topItems[0]?.attentionState ?? "healthy",
  };
}

function buildQueueSummary(urgentWork = [], followUpWork = []) {
  return buildQueueSummaryHelper(urgentWork, followUpWork);
}

async function provisionWorkspaceForWorkItemRun(
  item,
  run,
  options: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  if (!workItemRequiresWorkspace(item)) {
    return null;
  }

  const now = nowIso();
  const mutationScope = dedupe(item.metadata?.mutationScope ?? []);
  const repoRoot = process.env.SPORE_WORKSPACE_REPO_ROOT
    ? path.resolve(process.env.SPORE_WORKSPACE_REPO_ROOT)
    : PROJECT_ROOT;
  const worktreeRoot = process.env.SPORE_WORKTREE_ROOT
    ? path.resolve(process.env.SPORE_WORKTREE_ROOT)
    : null;
  const allocation = {
    id: createId("workspace"),
    projectId: item.metadata?.projectId ?? "spore",
    ownerType: "work-item-run",
    ownerId: run.id,
    executionId: run.result?.executionId ?? null,
    stepId: null,
    workItemId: item.id,
    workItemRunId: run.id,
    proposalArtifactId: null,
    worktreePath: path.join(
      PROJECT_ROOT,
      ".spore",
      "worktrees",
      item.metadata?.projectId ?? "spore",
      createId("pending"),
    ),
    branchName: `pending/${run.id}`,
    baseRef: item.metadata?.baseRef ?? "HEAD",
    integrationBranch: item.metadata?.integrationBranch ?? null,
    mode: "git-worktree",
    safeMode: item.metadata?.safeMode !== false,
    mutationScope,
    status: "provisioning",
    metadata: {
      source: options.source ?? "work-item-run",
      requestedBy: options.by ?? "operator",
      itemKind: item.kind,
      repoRoot,
    },
    createdAt: now,
    updatedAt: now,
    cleanedAt: null,
  };
  withDatabase(dbPath, (db) => insertWorkspaceAllocation(db, allocation));

  try {
    const created = await createWorkspace({
      repoRoot,
      workspaceId: allocation.id,
      projectId: allocation.projectId,
      ownerType: allocation.ownerType,
      ownerId: allocation.ownerId,
      baseRef: allocation.baseRef,
      worktreeRoot,
      safeMode: allocation.safeMode,
      mutationScope,
    });
    const inspected = await inspectWorkspace({
      repoRoot,
      worktreePath: created.worktreePath,
      branchName: created.branchName,
    });
    const updated = {
      ...allocation,
      worktreePath: created.worktreePath,
      branchName: created.branchName,
      status: inspected.clean ? "provisioned" : "active",
      metadata: {
        ...allocation.metadata,
        inspection: inspected,
      },
      updatedAt: nowIso(),
    };
    withDatabase(dbPath, (db) => updateWorkspaceAllocation(db, updated));
    return updated;
  } catch (error) {
    const failed = {
      ...allocation,
      status: "failed",
      metadata: {
        ...allocation.metadata,
        error: error.message,
      },
      updatedAt: nowIso(),
    };
    withDatabase(dbPath, (db) => updateWorkspaceAllocation(db, failed));
    throw error;
  }
}

async function maybeCreateLearningRecord(item, run, proposal, dbPath) {
  const now = nowIso();
  const kind =
    run.status === "failed" ? "failure-pattern" : "successful-self-work";
  const summary =
    run.status === "failed"
      ? `Work item ${item.id} failed and may require operator recovery.`
      : `Work item ${item.id} completed with durable self-work output.`;
  const record = {
    id: createId("learning"),
    sourceType: "work-item-run",
    sourceId: run.id,
    kind,
    status: "active",
    summary,
    details: {
      workItemId: item.id,
      proposalArtifactId: proposal?.id ?? null,
      result: run.result,
      docSuggestions: buildDocSuggestionsHelper(item, run, proposal),
    },
    metadata: {
      runStatus: run.status,
      itemKind: item.kind,
    },
    createdAt: now,
    updatedAt: now,
  };
  withDatabase(dbPath, (db) => insertLearningRecord(db, record));
  return record;
}

export async function listWorkItemTemplates() {
  const templates = await listWorkItemTemplateDefinitions();
  return templates.map((template) => ({
    ...template,
    links: {
      self: `/work-item-templates/${encodeURIComponent(template.id)}`,
    },
  }));
}

export async function getWorkItemTemplate(templateId) {
  const template = await getWorkItemTemplateDefinition(templateId);
  if (!template) {
    return null;
  }
  return {
    ...template,
    links: {
      self: `/work-item-templates/${encodeURIComponent(template.id)}`,
    },
  };
}

export async function createManagedWorkItem(
  payload: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const template = payload.templateId
    ? await getWorkItemTemplateDefinition(payload.templateId)
    : null;
  const basePayload = template
    ? buildTemplatePayload(template, payload)
    : payload;
  return createWorkItem(basePayload, dbPath);
}

export function listSelfBuildWorkItems(
  options: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  return listManagedWorkItems(options, dbPath);
}

export function listSelfBuildWorkItemRuns(
  itemId,
  options: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const limit = Number.parseInt(String(options.limit ?? "20"), 10) || 20;
  return withDatabase(dbPath, (db) => {
    const item = getWorkItem(db, itemId);
    const runs = listWorkItemRuns(db, itemId, limit);
    return runs.map((run, index) =>
      buildWorkItemRunSummary(run, item, runs[index + 1] ?? null),
    );
  });
}

export function getSelfBuildWorkItem(
  itemId,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const item = getManagedWorkItem(itemId, dbPath);
  if (!item) {
    return null;
  }
  const group = item.metadata?.groupId
    ? withDatabase(dbPath, (db) => getWorkItemGroup(db, item.metadata.groupId))
    : null;
  const goalPlan = item.metadata?.goalPlanId
    ? withDatabase(dbPath, (db) => getGoalPlan(db, item.metadata.goalPlanId))
    : null;
  const recentRuns = listSelfBuildWorkItemRuns(itemId, { limit: 20 }, dbPath);
  const latestProposal =
    recentRuns.length > 0
      ? withDatabase(dbPath, (db) =>
          getProposalArtifactByRunId(db, recentRuns[0].id),
        )
      : null;
  const latestWorkspace =
    recentRuns.length > 0
      ? withDatabase(dbPath, (db) =>
          getWorkspaceAllocationByRunId(db, recentRuns[0].id),
        )
      : null;
  const groupItems = group
    ? listManagedWorkItems({ limit: 500 }, dbPath).filter(
        (entry) => entry.metadata?.groupId === group.id,
      )
    : [];
  const groupRuns = groupItems.flatMap((entry) => entry.runs ?? []);
  const groupSummary = group
    ? buildGroupSummary(group, groupItems, groupRuns)
    : null;
  const derivedItem =
    groupSummary?.items?.find((entry) => entry.id === itemId) ?? item;

  return {
    ...derivedItem,
    workItemGroup: groupSummary,
    goalPlan: goalPlan ? buildGoalPlanSummary(goalPlan) : null,
    recentRuns: recentRuns.slice(0, 5),
    runHistory: {
      runs: recentRuns,
      latestRun: recentRuns[0] ?? null,
      runCountsByStatus: recentRuns.reduce((accumulator, run) => {
        accumulator[run.status] = (accumulator[run.status] ?? 0) + 1;
        return accumulator;
      }, {}),
      trend: summarizeWorkItemRunTrend(recentRuns),
      links: {
        self: `/work-items/${encodeURIComponent(itemId)}/runs`,
        rerun: `/work-items/${encodeURIComponent(itemId)}/run`,
      },
    },
    latestProposal: latestProposal
      ? buildProposalSummary(latestProposal)
      : null,
    latestWorkspace: buildWorkspaceSummary(latestWorkspace),
    links: {
      self: `/work-items/${encodeURIComponent(itemId)}`,
      runs: `/work-items/${encodeURIComponent(itemId)}/runs`,
      run: `/work-items/${encodeURIComponent(itemId)}/run`,
      group: group ? `/work-item-groups/${encodeURIComponent(group.id)}` : null,
      goalPlan: goalPlan
        ? `/goal-plans/${encodeURIComponent(goalPlan.id)}`
        : null,
    },
  };
}

export function getSelfBuildWorkItemRun(
  runId,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const run = getManagedWorkItemRun(runId, dbPath);
  if (!run) {
    return null;
  }
  const item = withDatabase(dbPath, (db) => getWorkItem(db, run.workItemId));
  const recentRuns = withDatabase(dbPath, (db) =>
    listWorkItemRuns(db, run.workItemId, 20),
  );
  const runIndex = recentRuns.findIndex((entry) => entry.id === run.id);
  const previousRun =
    runIndex >= 0
      ? (recentRuns[runIndex + 1] ?? null)
      : (recentRuns.find((entry) => entry.id !== run.id) ?? null);
  const proposal = withDatabase(dbPath, (db) =>
    getProposalArtifactByRunId(db, run.id),
  );
  const workspace = withDatabase(dbPath, (db) =>
    getWorkspaceAllocationByRunId(db, run.id),
  );
  const learningRecords = withDatabase(dbPath, (db) =>
    listLearningRecords(db, "work-item-run", 50).filter(
      (record) => record.sourceId === run.id,
    ),
  );
  const docSuggestions =
    run.metadata?.docSuggestions ??
    buildDocSuggestionsHelper(item ?? { relatedDocs: [] }, run, proposal);
  const group = item?.metadata?.groupId
    ? withDatabase(dbPath, (db) => getWorkItemGroup(db, item.metadata.groupId))
    : null;
  const goalPlan = item?.metadata?.goalPlanId
    ? withDatabase(dbPath, (db) => getGoalPlan(db, item.metadata.goalPlanId))
    : null;
  const failure =
    run.status === "failed"
      ? {
          code: "work_item_run_failed",
          label: "Work item run failed",
          reason:
            run.result?.error ??
            run.metadata?.error ??
            "The work item run ended in a failed state.",
        }
      : run.status === "blocked"
        ? {
            code: "work_item_run_blocked",
            label: "Work item run blocked",
            reason:
              item?.blockedReason ??
              item?.dependencyState?.reason ??
              "The work item run is blocked.",
          }
        : null;
  const suggestedActions = [];
  if (failure && run.status === "failed") {
    suggestedActions.push({
      action: "rerun-work-item",
      targetType: "work-item-run",
      targetId: run.id,
      reason: failure.reason,
      expectedOutcome:
        "Create a fresh run of the same work item with new runtime and proposal artifacts.",
      commandHint: `npm run orchestrator:work-item-run -- --item ${run.workItemId}`,
      httpHint: `/work-item-runs/${encodeURIComponent(run.id)}/rerun`,
      priority: "high",
    });
  }
  if (
    run.status === "completed" &&
    summarizeValidationState(run.metadata?.validation) !== "completed"
  ) {
    suggestedActions.push({
      action: "validate-work-item-run",
      targetType: "work-item-run",
      targetId: run.id,
      reason:
        "Validation has not been executed for this completed work-item run.",
      expectedOutcome:
        "Create linked scenario and regression validation records for the run.",
      commandHint: `npm run orchestrator:work-item-validate -- --run ${run.id}`,
      httpHint: `/work-item-runs/${encodeURIComponent(run.id)}/validate`,
      priority: "medium",
    });
  }
  if (
    (run.metadata?.proposalArtifactId ?? proposal?.id) &&
    proposal?.status === "ready_for_review"
  ) {
    suggestedActions.push({
      action: "review-proposal",
      targetType: "proposal",
      targetId: proposal.id,
      reason: "The linked proposal is waiting for review.",
      expectedOutcome:
        "Record proposal review notes and move governance forward.",
      commandHint: `npm run orchestrator:proposal-show -- --proposal ${proposal.id}`,
      httpHint: `/proposal-artifacts/${encodeURIComponent(proposal.id)}`,
      priority: "high",
    });
  }
  if (
    (run.metadata?.proposalArtifactId ?? proposal?.id) &&
    proposal?.status === "approved"
  ) {
    const promotion = resolveProposalPromotionContext(proposal, {}, dbPath);
    suggestedActions.push({
      action: promotion.ready
        ? "plan-proposal-promotion"
        : "inspect-promotion-blockers",
      targetType: "proposal",
      targetId: proposal.id,
      reason: promotion.ready
        ? "The proposal is approved and can be promoted through the integrator lane."
        : (promotion.blockers[0]?.reason ??
          "Promotion is blocked until durable source artifacts are available."),
      expectedOutcome: promotion.ready
        ? "Create or launch an explicit promotion lane from the originating execution."
        : "Clarify or repair the promotion source before invoking the integrator lane.",
      commandHint: promotion.ready
        ? `npm run orchestrator:proposal-promotion-plan -- --proposal ${proposal.id} --target-branch ${promotion.targetBranch}`
        : `npm run orchestrator:proposal-review-package -- --proposal ${proposal.id}`,
      httpHint: promotion.ready
        ? `/proposal-artifacts/${encodeURIComponent(proposal.id)}/promotion-plan`
        : `/proposal-artifacts/${encodeURIComponent(proposal.id)}/review-package`,
      priority: promotion.ready ? "medium" : "high",
    });
  }

  return {
    ...buildWorkItemRunSummary(run, item, previousRun),
    item,
    proposal: buildProposalSummary(proposal),
    workspace: buildWorkspaceSummary(workspace),
    validation: run.metadata?.validation ?? null,
    docSuggestions,
    learningRecords: learningRecords.map(buildLearningSummary),
    failure,
    suggestedActions,
    lineage: {
      workItemGroup: group ? { id: group.id, title: group.title } : null,
      goalPlan: goalPlan
        ? { id: goalPlan.id, title: goalPlan.title, goal: goalPlan.goal }
        : null,
    },
    links: {
      ...buildWorkItemRunLinks(run),
      self: `/work-item-runs/${encodeURIComponent(runId)}`,
      item: `/work-items/${encodeURIComponent(run.workItemId)}`,
      proposal: proposal
        ? `/proposal-artifacts/${encodeURIComponent(proposal.id)}`
        : null,
      workspace: workspace
        ? `/workspaces/${encodeURIComponent(workspace.id)}`
        : `/work-item-runs/${encodeURIComponent(runId)}/workspace`,
      validate: `/work-item-runs/${encodeURIComponent(runId)}/validate`,
      docSuggestions: `/work-item-runs/${encodeURIComponent(runId)}/doc-suggestions`,
      group: group ? `/work-item-groups/${encodeURIComponent(group.id)}` : null,
      goalPlan: goalPlan
        ? `/goal-plans/${encodeURIComponent(goalPlan.id)}`
        : null,
    },
  };
}

export async function rerunSelfBuildWorkItemRun(
  runId,
  options: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const existingRun = withDatabase(dbPath, (db) => getWorkItemRun(db, runId));
  if (!existingRun) {
    return null;
  }
  const result = await runSelfBuildWorkItem(
    existingRun.workItemId,
    {
      ...options,
      source: options.source ?? "work-item-rerun",
      by: options.by ?? "operator",
    },
    dbPath,
  );
  if (result?.run?.id) {
    const updatedRun = {
      ...result.run,
      metadata: {
        ...result.run.metadata,
        rerunOf: runId,
        rerunReason: options.reason ?? null,
        rerunSource: options.source ?? "work-item-rerun",
      },
    };
    withDatabase(dbPath, (db) => updateWorkItemRun(db, updatedRun));
    result.run = getManagedWorkItemRun(updatedRun.id, dbPath);
    if (result.proposal?.id) {
      const proposal = withDatabase(dbPath, (db) =>
        getProposalArtifact(db, result.proposal.id),
      );
      if (proposal) {
        withDatabase(dbPath, (db) =>
          updateProposalArtifact(db, {
            ...proposal,
            metadata: {
              ...proposal.metadata,
              rerunOf: runId,
              rerunSource: options.source ?? "work-item-rerun",
            },
            updatedAt: nowIso(),
          }),
        );
        result.proposal = buildProposalSummary(
          withDatabase(dbPath, (db) =>
            getProposalArtifact(db, result.proposal.id),
          ),
        );
      }
    }
  }
  return {
    ...result,
    rerunOf: runId,
  };
}

export async function runSelfBuildWorkItem(
  itemId,
  options: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const item = withDatabase(dbPath, (db) => getWorkItem(db, itemId));
  if (!item) {
    return null;
  }
  ensureSafeMode(item, item.metadata?.projectId ?? "spore");
  let provisionedWorkspace = null;
  let result = null;
  try {
    result = await runManagedWorkItem(
      itemId,
      {
        ...options,
        beforeExecute: async ({ run, runningItem }) => {
          if (!workItemRequiresWorkspace(runningItem)) {
            return { run, item: runningItem };
          }
          provisionedWorkspace = await provisionWorkspaceForWorkItemRun(
            runningItem,
            run,
            options,
            dbPath,
          );
          return {
            run: {
              ...run,
              metadata: {
                ...run.metadata,
                workspaceId: provisionedWorkspace.id,
                workspacePath: provisionedWorkspace.worktreePath,
                workspaceBranch: provisionedWorkspace.branchName,
              },
            },
            item: {
              ...runningItem,
              metadata: {
                ...runningItem.metadata,
                lastWorkspaceId: provisionedWorkspace.id,
              },
            },
          };
        },
      },
      dbPath,
    );
  } catch (error) {
    const failedItem = withDatabase(dbPath, (db) => getWorkItem(db, itemId));
    const failedRun = failedItem?.metadata?.lastRunId
      ? getManagedWorkItemRun(failedItem.metadata.lastRunId, dbPath)
      : null;
    let proposal = null;
    if (failedItem && failedRun && workItemKindRequiresProposal(failedItem)) {
      const now = nowIso();
      const proposalWorkspace =
        provisionedWorkspace ?? getWorkspaceByRun(failedRun.id, dbPath);
      proposal = {
        id: createId("proposal"),
        workItemRunId: failedRun.id,
        workItemId: failedItem.id,
        status: "ready_for_review",
        kind: failedItem.kind,
        summary: {
          title: `${failedItem.title} proposal`,
          goal: failedItem.goal,
          runStatus: failedRun.status,
          safeMode: failedItem.metadata?.safeMode !== false,
        },
        artifacts: buildProposalArtifactsHelper(
          failedItem,
          failedRun.metadata?.validation ?? null,
          proposalWorkspace,
          workItemKindRequiresProposal,
        ),
        metadata: {
          source: options.source ?? "work-item-run",
          requiresHumanApproval:
            failedItem.metadata?.requiresHumanApproval ?? false,
          workspaceId:
            failedRun.metadata?.workspaceId ?? provisionedWorkspace?.id ?? null,
        },
        createdAt: now,
        updatedAt: now,
        reviewedAt: null,
        approvedAt: null,
      };
      proposal = await attachWorkspacePatchArtifactHelper(
        proposal,
        proposalWorkspace,
        nowIso,
      );
      withDatabase(dbPath, (db) => insertProposalArtifact(db, proposal));
      if (provisionedWorkspace) {
        const updatedWorkspace = {
          ...provisionedWorkspace,
          executionId:
            failedRun.result?.executionId ??
            provisionedWorkspace.executionId ??
            null,
          proposalArtifactId: proposal.id,
          status: "active",
          updatedAt: nowIso(),
        };
        withDatabase(dbPath, (db) =>
          updateWorkspaceAllocation(db, updatedWorkspace),
        );
        provisionedWorkspace = updatedWorkspace;
      }
      failedRun.metadata = {
        ...failedRun.metadata,
        proposalArtifactId: proposal.id,
        docSuggestions: buildDocSuggestionsHelper(
          failedItem,
          failedRun,
          proposal,
        ),
      };
      withDatabase(dbPath, (db) => updateWorkItemRun(db, failedRun));
    }
    const learningRecord =
      failedItem && failedRun
        ? await maybeCreateLearningRecord(
            failedItem,
            failedRun,
            proposal,
            dbPath,
          )
        : null;
    return {
      item: failedItem,
      run: failedRun,
      proposal: buildProposalSummary(proposal),
      learningRecord: buildLearningSummary(learningRecord),
      error: error.message,
    };
  }
  const runDetail = getManagedWorkItemRun(result.run.id, dbPath);
  const settledItem = withDatabase(dbPath, (db) => getWorkItem(db, itemId));
  let proposal = null;
  if (workItemKindRequiresProposal(settledItem)) {
    const now = nowIso();
    const proposalWorkspace =
      provisionedWorkspace ?? getWorkspaceByRun(runDetail.id, dbPath);
    proposal = {
      id: createId("proposal"),
      workItemRunId: runDetail.id,
      workItemId: settledItem.id,
      status: "ready_for_review",
      kind: settledItem.kind,
      summary: {
        title: `${settledItem.title} proposal`,
        goal: settledItem.goal,
        runStatus: runDetail.status,
        safeMode: settledItem.metadata?.safeMode !== false,
      },
      artifacts: buildProposalArtifactsHelper(
        settledItem,
        runDetail.metadata?.validation ?? null,
        proposalWorkspace,
        workItemKindRequiresProposal,
      ),
      metadata: {
        source: options.source ?? "work-item-run",
        requiresHumanApproval:
          settledItem.metadata?.requiresHumanApproval ?? false,
        workspaceId:
          runDetail.metadata?.workspaceId ?? provisionedWorkspace?.id ?? null,
      },
      createdAt: now,
      updatedAt: now,
      reviewedAt: null,
      approvedAt: null,
    };
    proposal = await attachWorkspacePatchArtifactHelper(
      proposal,
      proposalWorkspace,
      nowIso,
    );
    withDatabase(dbPath, (db) => insertProposalArtifact(db, proposal));
    if (provisionedWorkspace) {
      const updatedWorkspace = {
        ...provisionedWorkspace,
        executionId:
          runDetail.result?.executionId ??
          provisionedWorkspace.executionId ??
          null,
        proposalArtifactId: proposal.id,
        status: "settled",
        updatedAt: nowIso(),
      };
      withDatabase(dbPath, (db) =>
        updateWorkspaceAllocation(db, updatedWorkspace),
      );
      provisionedWorkspace = updatedWorkspace;
    }
    runDetail.metadata = {
      ...runDetail.metadata,
      proposalArtifactId: proposal.id,
      docSuggestions: buildDocSuggestionsHelper(
        settledItem,
        runDetail,
        proposal,
      ),
    };
    withDatabase(dbPath, (db) => updateWorkItemRun(db, runDetail));
  }
  const learningRecord = await maybeCreateLearningRecord(
    settledItem,
    runDetail,
    proposal,
    dbPath,
  );
  return {
    item: settledItem,
    run: getManagedWorkItemRun(runDetail.id, dbPath),
    proposal: buildProposalSummary(proposal),
    learningRecord: buildLearningSummary(learningRecord),
  };
}

export async function createGoalPlan(
  payload: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const now = nowIso();
  const projectPath = payload.projectPath ?? payload.projectId ?? "spore";
  const project = await loadProjectConfig(projectPath);
  const projectConfig =
    project.config &&
    typeof project.config === "object" &&
    !Array.isArray(project.config)
      ? project.config
      : {};
  const domainId = extractGoalDomain(
    payload.goal ?? "",
    payload.domain ?? payload.domainId ?? null,
  );
  const safeMode = payload.safeMode !== false;
  const recommendations = buildGoalRecommendations({
    goal: payload.goal ?? "",
    domainId,
    safeMode,
    projectPath: project.path,
    projectConfig: project.config,
  }).map((recommendation, index) =>
    sanitizeGoalRecommendation(recommendation, index),
  );
  const plan = {
    id: payload.id ?? createId("goal-plan"),
    title: payload.title ?? `Goal plan for ${domainId}`,
    goal: toText(payload.goal, "Untitled goal"),
    projectId: payload.projectId ?? "spore",
    domainId,
    mode: payload.mode ?? "supervised",
    status: "planned",
    constraints: {
      ...(payload.constraints ?? {}),
      safeMode,
    },
    recommendations,
    metadata: {
      source: payload.source ?? "operator",
      requestedBy: payload.by ?? "operator",
      reviewRequired: payload.reviewRequired !== false,
      reviewHistory: [],
      editHistory: [],
      history: [
        compactObject({
          id: createId("goal-plan-history"),
          type: "created",
          timestamp: now,
          by: payload.by ?? "operator",
          source: payload.source ?? "operator",
          status: "planned",
          summary: "Goal plan created from operator input.",
        }),
      ],
      originalRecommendations: recommendations,
      projectPath: project.path,
      activeDomains: dedupe(projectConfig.activeDomains ?? []),
    },
    createdAt: now,
    updatedAt: now,
    materializedAt: null,
  };
  withDatabase(dbPath, (db) => insertGoalPlan(db, plan));
  return buildGoalPlanSummary(plan);
}

export function listGoalPlansSummary(
  options: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const status = options.status ? String(options.status).trim() : null;
  const limit = Number.parseInt(String(options.limit ?? "50"), 10) || 50;
  return withDatabase(dbPath, (db) => listGoalPlans(db, status, limit)).map(
    (plan) => buildGoalPlanSummary(plan),
  );
}

export function getGoalPlanSummary(
  planId,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const plan = withDatabase(dbPath, (db) => getGoalPlan(db, planId));
  if (!plan) {
    return null;
  }
  const items = listManagedWorkItems({}, dbPath).filter(
    (item) => item.metadata?.goalPlanId === plan.id,
  );
  const group =
    withDatabase(dbPath, (db) => listWorkItemGroups(db, null, 100)).find(
      (entry) => entry.goalPlanId === plan.id,
    ) ?? null;
  const groupItems = group
    ? items.filter((item) => item.metadata?.groupId === group.id)
    : [];
  const groupRuns = groupItems.flatMap((item) => item.runs ?? []);
  const groupProposals = group
    ? listGroupProposals(group.id, dbPath, groupItems)
    : [];
  return buildGoalPlanSummary(
    plan,
    items,
    group
      ? buildGroupSummary(group, groupItems, groupRuns, groupProposals)
      : null,
  );
}

export async function reviewGoalPlan(
  planId,
  decision: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const plan = withDatabase(dbPath, (db) => getGoalPlan(db, planId));
  if (!plan) {
    return null;
  }
  const status =
    String(decision.status ?? "reviewed").trim() === "rejected"
      ? "rejected"
      : "reviewed";
  const reviewEntry = compactObject({
    id: createId("goal-plan-review"),
    status,
    by: decision.by ?? "operator",
    comments: decision.comments ?? "",
    reason: decision.reason ?? decision.comments ?? "",
    reviewedAt: nowIso(),
  });
  const updated = {
    ...plan,
    status,
    updatedAt: reviewEntry.reviewedAt,
    metadata: {
      ...plan.metadata,
      reviewRationale: decision.reason ?? decision.comments ?? "",
      lastReviewedAt: reviewEntry.reviewedAt,
      reviewHistory: [
        ...asArray(plan.metadata?.reviewHistory),
        reviewEntry,
      ].slice(-20),
      history: appendGoalPlanLifecycleHistory(plan.metadata?.history, {
        type: "reviewed",
        timestamp: reviewEntry.reviewedAt,
        by: decision.by ?? "operator",
        source: "goal-plan-review",
        status,
        rationale: decision.reason ?? decision.comments ?? "",
        summary:
          status === "rejected"
            ? "Goal plan rejected by operator review."
            : "Goal plan reviewed and ready for materialization.",
      }),
    },
  };
  withDatabase(dbPath, (db) => updateGoalPlan(db, updated));
  return getGoalPlanSummary(planId, dbPath);
}

export async function editGoalPlan(
  planId,
  payload: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const plan = withDatabase(dbPath, (db) => getGoalPlan(db, planId));
  if (!plan) {
    return null;
  }
  const originalRecommendations = asArray(
    plan.metadata?.originalRecommendations ?? plan.recommendations,
  ).map((recommendation, index) =>
    sanitizeGoalRecommendation(recommendation, index),
  );
  const incomingRecommendations = asArray(
    payload.editedRecommendations ??
      payload.recommendations ??
      payload.recommendedItems ??
      [],
  );
  if (incomingRecommendations.length === 0) {
    const error = new Error(
      `goal plan edit requires editedRecommendations for ${planId}`,
    );
    (error as LooseRecord).code = "goal_plan_edit_missing_recommendations";
    throw error;
  }
  const editedRecommendations = incomingRecommendations
    .map((recommendation, index) =>
      sanitizeGoalRecommendation(recommendation, index),
    )
    .sort(
      (left, right) =>
        Number(left.groupOrder ?? 0) - Number(right.groupOrder ?? 0),
    );
  const editSummary = summarizeGoalPlanEdits(
    originalRecommendations,
    editedRecommendations,
  );
  const editedAt = nowIso();
  const updated = {
    ...plan,
    status: ["rejected", "completed"].includes(String(plan.status))
      ? plan.status
      : "planned",
    updatedAt: editedAt,
    metadata: {
      ...plan.metadata,
      editedRecommendations,
      reviewRationale: payload.rationale ?? payload.reviewRationale ?? "",
      editHistory: appendGoalPlanEditHistory(plan.metadata?.editHistory, {
        editedAt,
        by: payload.by ?? "operator",
        source: payload.source ?? "goal-plan-edit",
        rationale: payload.rationale ?? payload.reviewRationale ?? "",
        summary:
          payload.summary ??
          `Edited goal plan recommendations: ${editedRecommendations.length} active item(s).`,
        recommendationCount: editedRecommendations.length,
        ...editSummary,
      }),
      history: appendGoalPlanLifecycleHistory(plan.metadata?.history, {
        type: "edited",
        timestamp: editedAt,
        by: payload.by ?? "operator",
        source: payload.source ?? "goal-plan-edit",
        status: "planned",
        rationale: payload.rationale ?? payload.reviewRationale ?? "",
        summary:
          payload.summary ??
          `Operator updated goal plan recommendations (${editedRecommendations.length} item(s)).`,
      }),
    },
  };
  withDatabase(dbPath, (db) => updateGoalPlan(db, updated));
  return getGoalPlanSummary(planId, dbPath);
}

export function getGoalPlanHistory(
  planId,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const plan = withDatabase(dbPath, (db) => getGoalPlan(db, planId));
  if (!plan) {
    return null;
  }
  const summary = getGoalPlanSummary(planId, dbPath);
  const history = asArray(plan.metadata?.history).sort(
    (left, right) =>
      new Date(left.timestamp ?? 0).getTime() -
      new Date(right.timestamp ?? 0).getTime(),
  );
  return {
    goalPlan: summary,
    history,
    reviewHistory: asArray(plan.metadata?.reviewHistory),
    editHistory: asArray(plan.metadata?.editHistory),
    materializationSnapshot: plan.metadata?.materializationSnapshot ?? null,
  };
}

export async function materializeGoalPlan(
  planId,
  options: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const plan = withDatabase(dbPath, (db) => getGoalPlan(db, planId));
  if (!plan) {
    return null;
  }
  if (
    plan.metadata?.reviewRequired !== false &&
    ![
      "reviewed",
      "materialized",
      "running",
      "completed",
      "blocked",
      "failed",
    ].includes(String(plan.status)) &&
    options.force !== true
  ) {
    const error = new Error(
      `goal plan review required before materialization: ${planId}`,
    );
    (error as LooseRecord).code = "goal_plan_review_required";
    throw error;
  }
  const effectiveRecommendations = getGoalPlanEffectiveRecommendations(plan);
  const now = nowIso();
  const group = {
    id: options.groupId ?? createId("work-group"),
    title: `${plan.title} group`,
    goalPlanId: plan.id,
    status: "pending",
    summary: {
      plannedCount: effectiveRecommendations.length,
    },
    metadata: {
      projectId: plan.projectId,
      domainId: plan.domainId,
      safeMode: plan.constraints?.safeMode !== false,
    },
    createdAt: now,
    updatedAt: now,
    lastRunAt: null,
  };
  withDatabase(dbPath, (db) => insertWorkItemGroup(db, group));
  const items = [];
  const recommendationIdToItemId = new Map();
  for (const recommendation of effectiveRecommendations) {
    const template = recommendation.metadata?.templateId
      ? await getWorkItemTemplateDefinition(recommendation.metadata.templateId)
      : null;
    const detail = await createManagedWorkItem(
      {
        templateId: template?.id,
        title: recommendation.title,
        kind: recommendation.kind,
        goal: recommendation.goal,
        priority: recommendation.priority ?? "medium",
        acceptanceCriteria: recommendation.acceptanceCriteria ?? [],
        relatedScenarios: recommendation.relatedScenarios ?? [],
        relatedRegressions: recommendation.relatedRegressions ?? [],
        metadata: mergeMetadata(recommendation.metadata, {
          groupId: group.id,
          goalPlanId: plan.id,
          recommendationId: recommendation.id,
          dependsOn: recommendation.dependsOn ?? [],
          groupOrder: recommendation.groupOrder ?? 0,
        }),
      },
      dbPath,
    );
    recommendationIdToItemId.set(String(recommendation.id), detail.id);
    items.push(detail);
  }
  for (const item of items) {
    const dependencyIds = dedupe(item.metadata?.dependsOn ?? []).map(
      (dependencyId) =>
        recommendationIdToItemId.get(String(dependencyId)) ?? dependencyId,
    );
    const updatedItem = {
      ...item,
      metadata: {
        ...item.metadata,
        dependsOn: dependencyIds,
      },
    };
    withDatabase(dbPath, (db) => updateWorkItem(db, updatedItem));
  }
  const refreshedItems = items
    .map((item) => getManagedWorkItem(item.id, dbPath))
    .filter(Boolean);
  const updatedPlan = {
    ...plan,
    status: "materialized",
    updatedAt: now,
    materializedAt: now,
    metadata: {
      ...plan.metadata,
      groupId: group.id,
      materializedItemIds: refreshedItems.map((item) => item.id),
      materializationSnapshot: {
        groupId: group.id,
        source: options.source ?? "goal-plan-materialize",
        by: options.by ?? "operator",
        materializedAt: now,
        recommendationIds: effectiveRecommendations.map(
          (recommendation) => recommendation.id,
        ),
        recommendationCount: effectiveRecommendations.length,
      },
      history: appendGoalPlanLifecycleHistory(plan.metadata?.history, {
        type: "materialized",
        timestamp: now,
        by: options.by ?? "operator",
        source: options.source ?? "goal-plan-materialize",
        status: "materialized",
        targetId: group.id,
        summary: `Goal plan materialized into work-item group ${group.id}.`,
      }),
    },
  };
  withDatabase(dbPath, (db) => updateGoalPlan(db, updatedPlan));
  return buildGoalPlanSummary(
    updatedPlan,
    refreshedItems,
    buildGroupSummary(
      group,
      refreshedItems,
      refreshedItems.flatMap((item) => item.runs ?? []),
      listGroupProposals(group.id, dbPath, refreshedItems),
    ),
  );
}

export async function runGoalPlan(
  planId,
  options: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  let plan = getGoalPlanSummary(planId, dbPath);
  if (!plan) {
    return null;
  }
  if (
    options.reviewStatus &&
    ["planned", "rejected"].includes(String(plan.status))
  ) {
    plan = await reviewGoalPlan(
      planId,
      {
        status: options.reviewStatus,
        comments: options.reviewComments ?? "",
        reason: options.reviewReason ?? "",
        by: options.by ?? "operator",
      },
      dbPath,
    );
  }
  if (!plan.materializedGroup) {
    plan = await materializeGoalPlan(
      planId,
      {
        ...options,
        force: options.force === true,
      },
      dbPath,
    );
  }
  const groupId =
    plan?.materializedGroup?.id ?? plan?.metadata?.groupId ?? null;
  if (!groupId) {
    throw new Error(`goal plan ${planId} has no materialized work-item group`);
  }
  const groupResult = await runWorkItemGroup(
    groupId,
    {
      ...options,
      autoValidate: options.autoValidate !== false,
    },
    dbPath,
  );
  const refreshedPlan = getGoalPlanSummary(planId, dbPath);
  const resultStatus = String(groupResult?.group?.status ?? "pending");
  const updatedPlan = withDatabase(dbPath, (db) => {
    const current = getGoalPlan(db, planId);
    if (!current) {
      return null;
    }
    const next = {
      ...current,
      status:
        resultStatus === "completed"
          ? "completed"
          : ["blocked", "failed", "running"].includes(resultStatus)
            ? resultStatus
            : "materialized",
      updatedAt: nowIso(),
      metadata: {
        ...current.metadata,
        lastRunGroupId: groupId,
        lastRunAt: nowIso(),
        lastOperatorFlow: compactObject({
          autoValidate: options.autoValidate !== false,
          resultStatus,
          reviewRequired: current.metadata?.reviewRequired ?? true,
        }),
      },
    };
    updateGoalPlan(db, next);
    return next;
  });
  const finalPlan = updatedPlan
    ? getGoalPlanSummary(updatedPlan.id, dbPath)
    : refreshedPlan;
  const proposalsNeedingReview = asArray(groupResult?.group?.proposals).filter(
    (proposal) =>
      ["ready_for_review", "reviewed", "waiting_approval"].includes(
        String(proposal?.status),
      ),
  );
  return {
    goalPlan: finalPlan,
    group: groupResult?.group ?? null,
    results: groupResult?.results ?? [],
    validationResults: groupResult?.validationResults ?? [],
    proposalsNeedingReview,
    recommendations: proposalsNeedingReview.slice(0, 5).map((proposal) => ({
      action:
        proposal.status === "ready_for_review"
          ? "review-proposal"
          : "approve-proposal",
      targetType: "proposal",
      targetId: proposal.id,
      reason:
        proposal.status === "ready_for_review"
          ? "Proposal is ready for review."
          : "Proposal review is complete and waiting for approval.",
      httpHint: `/proposal-artifacts/${encodeURIComponent(proposal.id)}`,
      commandHint: `npm run orchestrator:proposal-show -- --proposal ${proposal.id}`,
    })),
  };
}

export function setWorkItemGroupDependencies(
  groupId,
  payload: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const group = withDatabase(dbPath, (db) => getWorkItemGroup(db, groupId));
  if (!group) {
    return null;
  }
  const items = listManagedWorkItems({ limit: 500 }, dbPath).filter(
    (item) => item.metadata?.groupId === group.id,
  );
  const availableItemIds = new Set(items.map((item) => item.id));
  const replace = payload.replace !== false;
  const requestedEdges = asArray(payload.edges).map((edge) => {
    const itemId = String(edge?.itemId ?? "").trim();
    if (!itemId) {
      throw new Error("dependency edges require itemId");
    }
    return normalizeDependencyEdge(edge, itemId, availableItemIds);
  });

  const edgesByItemId = new Map<string, LooseRecord[]>(
    items.map((item) => [
      item.id,
      replace ? [] : getStoredDependencyEdges(item, availableItemIds),
    ]),
  );
  for (const edge of requestedEdges) {
    const existing = edgesByItemId.get(edge.itemId) ?? [];
    edgesByItemId.set(edge.itemId, [
      ...existing.filter((entry) => entry.id !== edge.id),
      edge,
    ]);
  }
  detectDependencyCycles(edgesByItemId, availableItemIds);

  for (const item of items) {
    const edges = edgesByItemId.get(item.id) ?? [];
    const updated = {
      ...item,
      metadata: {
        ...item.metadata,
        dependsOn: edges.map((edge) => edge.dependencyItemId),
        dependencies: edges.map((edge) => ({
          dependencyItemId: edge.dependencyItemId,
          strictness: edge.strictness,
          autoRelaxation: edge.autoRelaxation,
        })),
      },
      updatedAt: nowIso(),
    };
    withDatabase(dbPath, (db) => updateWorkItem(db, updated));
  }

  recordGroupDependencyTransition(
    groupId,
    {
      type: "dependency_graph_updated",
      state: "ready",
      reasonCode: "graph_updated",
      reason: `Updated ${requestedEdges.length} dependency edge${requestedEdges.length === 1 ? "" : "s"} for work-item group ${groupId}.`,
      nextActionHint: "Review readiness counts before running the group.",
    },
    dbPath,
  );

  const reconciledGroup = getWorkItemGroupSummary(groupId, dbPath);
  persistGroupDependencyState(
    reconciledGroup,
    evaluateGroupDependencies(reconciledGroup.items),
    "dependency_graph_updated",
    dbPath,
  );
  const detail = getWorkItemGroupSummary(groupId, dbPath);
  return {
    detail,
    impactSummary: {
      totalEdges: detail.dependencyGraph.edges.length,
      strictnessCounts: detail.dependencyGraph.strictnessCounts,
      headlineState: detail.readiness.headlineState,
      readinessCounts: detail.readiness.counts,
      blockerIds: detail.readiness.blockerIds,
      affectedItemIds: Array.from(
        new Set(detail.dependencyGraph.edges.map((edge) => edge.itemId)),
      ),
      nextActionHint: detail.readiness.nextActionHint,
    },
  };
}

export function listWorkItemGroupsSummary(
  options: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const status = options.status ? String(options.status).trim() : null;
  const limit = Number.parseInt(String(options.limit ?? "50"), 10) || 50;
  const groups = withDatabase(dbPath, (db) =>
    listWorkItemGroups(db, status, limit),
  );
  const items = listManagedWorkItems({ limit: 500 }, dbPath);
  return groups.map((group) => {
    const groupItems = items.filter(
      (item) => item.metadata?.groupId === group.id,
    );
    const groupRuns = groupItems.flatMap((item) => item.runs ?? []);
    const groupProposals = listGroupProposals(group.id, dbPath, groupItems);
    return buildGroupSummary(group, groupItems, groupRuns, groupProposals);
  });
}

export function getWorkItemGroupSummary(
  groupId,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const group = withDatabase(dbPath, (db) => getWorkItemGroup(db, groupId));
  if (!group) {
    return null;
  }
  const items = listManagedWorkItems({ limit: 500 }, dbPath).filter(
    (item) => item.metadata?.groupId === group.id,
  );
  const runs = items.flatMap((item) => item.runs ?? []);
  const proposals = listGroupProposals(group.id, dbPath, items);
  return buildGroupSummary(group, items, runs, proposals);
}

function appendGroupRecoveryHistory(entries = [], entry: LooseRecord = {}) {
  const normalized = compactObject({
    id: entry.id ?? createId("group-recovery"),
    type: entry.type ?? "updated",
    createdAt: entry.createdAt ?? nowIso(),
    by: entry.by ?? "operator",
    source: entry.source ?? "operator",
    rationale: entry.rationale ?? "",
    itemIds: dedupe(entry.itemIds ?? []),
    replacementItemIds: dedupe(entry.replacementItemIds ?? []),
    skippedItemIds: dedupe(entry.skippedItemIds ?? []),
  });
  return [...asArray(entries).slice(-29), normalized];
}

function appendGroupLifecycleHistory(entries = [], entry: LooseRecord = {}) {
  const normalized = compactObject({
    id: entry.id ?? createId("group-history"),
    type: entry.type ?? "updated",
    timestamp: entry.timestamp ?? nowIso(),
    by: entry.by ?? "operator",
    source: entry.source ?? "operator",
    status: entry.status ?? null,
    rationale: entry.rationale ?? "",
    summary: entry.summary ?? "",
  });
  return [...asArray(entries).slice(-39), normalized];
}

function persistGroupRecovery(group, recoveryEntry, dbPath) {
  const updated = {
    ...group,
    updatedAt: nowIso(),
    metadata: {
      ...(group.metadata ?? {}),
      recoveryHistory: appendGroupRecoveryHistory(
        group.metadata?.recoveryHistory,
        recoveryEntry,
      ),
      history: appendGroupLifecycleHistory(group.metadata?.history, {
        type: recoveryEntry.type,
        timestamp: recoveryEntry.createdAt ?? nowIso(),
        by: recoveryEntry.by ?? "operator",
        source: recoveryEntry.source ?? "operator",
        status: group.status ?? null,
        rationale: recoveryEntry.rationale ?? "",
        summary:
          recoveryEntry.summary ??
          `Recorded recovery action ${recoveryEntry.type} for group ${group.id}.`,
      }),
    },
  };
  withDatabase(dbPath, (db) => updateWorkItemGroup(db, updated));
}

export function unblockWorkItemGroup(
  groupId,
  payload: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const group = withDatabase(dbPath, (db) => getWorkItemGroup(db, groupId));
  if (!group) {
    return null;
  }
  const targetItemIds = parseIdList(payload.itemIds ?? payload.items ?? []);
  const items = listManagedWorkItems({ limit: 500 }, dbPath).filter(
    (item) => item.metadata?.groupId === group.id,
  );
  for (const item of items) {
    if (targetItemIds.length > 0 && !targetItemIds.includes(item.id)) {
      continue;
    }
    const updated = {
      ...item,
      status: ["blocked", "failed"].includes(String(item.status))
        ? "pending"
        : item.status,
      blockedReason: null,
      updatedAt: nowIso(),
      metadata: {
        ...item.metadata,
        dependencyRecovery: {
          enabled: true,
          mode: "unblock",
          rationale:
            payload.rationale ??
            "Operator manually unblocked dependency-gated work.",
          source: payload.source ?? "group-unblock",
          updatedAt: nowIso(),
        },
      },
    };
    withDatabase(dbPath, (db) => updateWorkItem(db, updated));
  }
  persistGroupRecovery(
    group,
    {
      type: "unblock",
      by: payload.by ?? "operator",
      source: payload.source ?? "group-unblock",
      rationale:
        payload.rationale ??
        "Operator manually unblocked dependency-gated work.",
      itemIds: targetItemIds,
      summary: `Unblocked ${targetItemIds.length || items.length} item(s) in work-item group ${groupId}.`,
    },
    dbPath,
  );
  return getWorkItemGroupSummary(groupId, dbPath);
}

export function requeueWorkItemGroupItem(
  groupId,
  itemId,
  payload: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const group = withDatabase(dbPath, (db) => getWorkItemGroup(db, groupId));
  if (!group) {
    return null;
  }
  const item = withDatabase(dbPath, (db) => getWorkItem(db, itemId));
  if (!item || item.metadata?.groupId !== groupId) {
    return null;
  }
  const updated = {
    ...item,
    status: "pending",
    blockedReason: null,
    updatedAt: nowIso(),
    metadata: {
      ...item.metadata,
      dependencyRecovery: {
        enabled: false,
        mode: "requeued",
        rationale: payload.rationale ?? "Operator requeued this work item.",
        source: payload.source ?? "group-requeue",
        updatedAt: nowIso(),
      },
      lastRequeuedAt: nowIso(),
    },
  };
  withDatabase(dbPath, (db) => updateWorkItem(db, updated));
  persistGroupRecovery(
    group,
    {
      type: "requeue-item",
      by: payload.by ?? "operator",
      source: payload.source ?? "group-requeue",
      rationale: payload.rationale ?? "Operator requeued this work item.",
      itemIds: [itemId],
      summary: `Requeued work item ${itemId}.`,
    },
    dbPath,
  );
  return getWorkItemGroupSummary(groupId, dbPath);
}

export function skipWorkItemGroupItem(
  groupId,
  itemId,
  payload: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const group = withDatabase(dbPath, (db) => getWorkItemGroup(db, groupId));
  if (!group) {
    return null;
  }
  const item = withDatabase(dbPath, (db) => getWorkItem(db, itemId));
  if (!item || item.metadata?.groupId !== groupId) {
    return null;
  }
  const updated = {
    ...item,
    status: "skipped",
    blockedReason: null,
    updatedAt: nowIso(),
    metadata: {
      ...item.metadata,
      skippedAt: nowIso(),
      skippedReason: payload.rationale ?? "Operator skipped this work item.",
    },
  };
  withDatabase(dbPath, (db) => updateWorkItem(db, updated));
  persistGroupRecovery(
    group,
    {
      type: "skip-item",
      by: payload.by ?? "operator",
      source: payload.source ?? "group-skip",
      rationale: payload.rationale ?? "Operator skipped this work item.",
      itemIds: [itemId],
      skippedItemIds: [itemId],
      summary: `Skipped work item ${itemId}.`,
    },
    dbPath,
  );
  return getWorkItemGroupSummary(groupId, dbPath);
}

export async function rerouteWorkItemGroup(
  groupId,
  payload: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const group = withDatabase(dbPath, (db) => getWorkItemGroup(db, groupId));
  if (!group) {
    return null;
  }
  const itemId = toText(payload.itemId, "");
  if (!itemId) {
    const error = new Error("reroute requires itemId");
    (error as LooseRecord).code = "missing_item_id";
    throw error;
  }
  const original = withDatabase(dbPath, (db) => getWorkItem(db, itemId));
  if (!original || original.metadata?.groupId !== groupId) {
    return null;
  }
  const repairItem = await createManagedWorkItem(
    {
      templateId: original.metadata?.templateId ?? null,
      title:
        payload.title ??
        `${original.title} (repair ${new Date().toISOString().slice(0, 10)})`,
      kind: original.kind,
      source: payload.source ?? "group-reroute",
      goal:
        payload.goal ??
        `Repair or reroute work for ${original.title} after recovery action.`,
      priority: payload.priority ?? original.priority ?? "high",
      acceptanceCriteria:
        payload.acceptanceCriteria ?? original.acceptanceCriteria ?? [],
      relatedDocs: payload.relatedDocs ?? original.relatedDocs ?? [],
      relatedScenarios:
        payload.relatedScenarios ?? original.relatedScenarios ?? [],
      relatedRegressions:
        payload.relatedRegressions ?? original.relatedRegressions ?? [],
      metadata: mergeMetadata(original.metadata, {
        groupId,
        goalPlanId: original.metadata?.goalPlanId ?? null,
        groupOrder: Number(original.metadata?.groupOrder ?? 0) + 0.5,
        rerouteOf: original.id,
        dependsOn: dedupe(
          payload.dependsOn ?? original.metadata?.dependsOn ?? [],
        ),
        dependencies:
          payload.dependencies ?? original.metadata?.dependencies ?? [],
      }),
    },
    dbPath,
  );
  const items = listManagedWorkItems({ limit: 500 }, dbPath).filter(
    (item) => item.metadata?.groupId === groupId,
  );
  for (const item of items) {
    if (item.id === original.id || item.id === repairItem.id) {
      continue;
    }
    const dependsOn = dedupe(item.metadata?.dependsOn ?? []).map(
      (dependencyId) =>
        dependencyId === original.id ? repairItem.id : dependencyId,
    );
    const dependencies = asArray(item.metadata?.dependencies).map((edge) =>
      edge?.dependencyItemId === original.id
        ? { ...edge, dependencyItemId: repairItem.id }
        : edge,
    );
    const updated = {
      ...item,
      updatedAt: nowIso(),
      metadata: {
        ...item.metadata,
        dependsOn,
        dependencies,
      },
    };
    withDatabase(dbPath, (db) => updateWorkItem(db, updated));
  }
  const originalUpdated = {
    ...original,
    status: "blocked",
    blockedReason:
      payload.rationale ?? "Work item rerouted into a repair lane.",
    updatedAt: nowIso(),
    metadata: {
      ...original.metadata,
      reroutedTo: repairItem.id,
      reroutedAt: nowIso(),
      rerouteReason: payload.rationale ?? "Operator rerouted this work item.",
    },
  };
  withDatabase(dbPath, (db) => updateWorkItem(db, originalUpdated));
  persistGroupRecovery(
    group,
    {
      type: "reroute",
      by: payload.by ?? "operator",
      source: payload.source ?? "group-reroute",
      rationale:
        payload.rationale ?? "Operator rerouted work into a repair lane.",
      itemIds: [original.id],
      replacementItemIds: [repairItem.id],
      summary: `Rerouted work item ${original.id} to repair item ${repairItem.id}.`,
    },
    dbPath,
  );
  return getWorkItemGroupSummary(groupId, dbPath);
}

export async function retryDownstreamWorkItemGroup(
  groupId,
  payload: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const group = withDatabase(dbPath, (db) => getWorkItemGroup(db, groupId));
  if (!group) {
    return null;
  }
  const itemIds = parseIdList(payload.itemIds ?? payload.items ?? []);
  const detail = getWorkItemGroupSummary(groupId, dbPath);
  const targeted = detail.items.filter((item) => {
    if (itemIds.length === 0) {
      return ["blocked", "review_needed", "failed"].includes(
        String(item.dependencyState?.state ?? item.status),
      );
    }
    return (
      itemIds.includes(item.id) ||
      item.blockerIds?.some((blockerId) =>
        itemIds.some((itemId) => blockerId.includes(itemId)),
      )
    );
  });
  for (const item of targeted) {
    const updated = {
      ...item,
      status: "pending",
      blockedReason: null,
      updatedAt: nowIso(),
      metadata: {
        ...item.metadata,
        dependencyRecovery: {
          enabled: false,
          mode: "retry-downstream",
          rationale:
            payload.rationale ?? "Operator retried downstream blocked work.",
          source: payload.source ?? "group-retry-downstream",
          updatedAt: nowIso(),
        },
      },
    };
    withDatabase(dbPath, (db) => updateWorkItem(db, updated));
  }
  persistGroupRecovery(
    group,
    {
      type: "retry-downstream",
      by: payload.by ?? "operator",
      source: payload.source ?? "group-retry-downstream",
      rationale:
        payload.rationale ?? "Operator retried downstream blocked work.",
      itemIds: targeted.map((item) => item.id),
      summary: `Requeued ${targeted.length} downstream item(s).`,
    },
    dbPath,
  );
  return getWorkItemGroupSummary(groupId, dbPath);
}

export async function runWorkItemGroup(
  groupId,
  options: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  let group = getWorkItemGroupSummary(groupId, dbPath);
  if (!group) {
    return null;
  }
  persistGroupDependencyState(
    group,
    evaluateGroupDependencies(group.items),
    "group_run",
    dbPath,
  );
  group = getWorkItemGroupSummary(groupId, dbPath);
  const results = [];
  const validationResults = [];
  const completedItemIds = new Set<string>();
  let batchNumber = 0;
  let progressMade = false;

  while (true) {
    group = getWorkItemGroupSummary(groupId, dbPath);
    const evaluated = evaluateGroupDependencies(group.items);
    const readyItems = sortByGroupOrder(evaluated.items).filter(
      (item) =>
        item.dependencyState?.readyToRun === true &&
        !completedItemIds.has(item.id) &&
        !["completed", "running", "failed"].includes(String(item.status)),
    );

    if (readyItems.length === 0) {
      break;
    }

    batchNumber += 1;
    progressMade = true;
    const batchStartedAt = nowIso();
    const settled = await Promise.allSettled(
      readyItems.map((item) => runSelfBuildWorkItem(item.id, options, dbPath)),
    );
    const batchResults = [];

    for (let index = 0; index < settled.length; index += 1) {
      const item = readyItems[index];
      const settledResult = settled[index];
      let normalized = null;
      if (settledResult.status === "fulfilled") {
        normalized = normalizeGroupRunEntry(settledResult.value);
      } else {
        const failedItem = getSelfBuildWorkItem(item.id, dbPath);
        const failedRun = failedItem?.metadata?.lastRunId
          ? getManagedWorkItemRun(failedItem.metadata.lastRunId, dbPath)
          : null;
        normalized = normalizeGroupRunEntry({
          itemId: item.id,
          item: failedItem ?? item,
          run: failedRun,
          status: failedRun?.status ?? "failed",
          error: settledResult.reason?.message ?? String(settledResult.reason),
        });
      }
      if (normalized?.itemId) {
        completedItemIds.add(normalized.itemId);
      }
      results.push(normalized);
      batchResults.push(normalized);

      if (
        options.autoValidate !== false &&
        normalized?.run?.id &&
        workItemShouldAutoValidate(normalized.run)
      ) {
        const validationResult = await validateWorkItemRun(
          normalized.run.id,
          {
            ...options,
            source: options.source ?? "work-item-group-run",
            by: options.by ?? "operator",
          },
          dbPath,
        );
        validationResults.push(validationResult);
      }
    }

    const refreshedGroup = withDatabase(dbPath, (db) =>
      getWorkItemGroup(db, groupId),
    );
    withDatabase(dbPath, (db) =>
      updateWorkItemGroup(db, {
        ...refreshedGroup,
        updatedAt: nowIso(),
        lastRunAt: nowIso(),
        metadata: {
          ...(refreshedGroup?.metadata ?? {}),
          batchHistory: appendGroupBatchHistory(
            refreshedGroup?.metadata?.batchHistory,
            {
              batchNumber,
              startedAt: batchStartedAt,
              endedAt: nowIso(),
              readinessState: evaluated.readiness.headlineState,
              itemIds: readyItems.map((item) => item.id),
              itemTitles: readyItems.map((item) => item.title),
              statuses: batchResults.reduce((accumulator, entry) => {
                const key = String(
                  entry?.run?.status ?? entry?.status ?? "unknown",
                );
                accumulator[key] = (accumulator[key] ?? 0) + 1;
                return accumulator;
              }, {}),
              validationStatuses: validationResults.reduce(
                (accumulator, entry) => {
                  const key = String(entry?.validation?.status ?? "unknown");
                  accumulator[key] = (accumulator[key] ?? 0) + 1;
                  return accumulator;
                },
                {},
              ),
              failedItemIds: batchResults
                .filter(
                  (entry) =>
                    String(entry?.run?.status ?? entry?.status) === "failed",
                )
                .map((entry) => entry.itemId),
              blockedItemIds: batchResults
                .filter((entry) =>
                  ["blocked", "waiting_review", "waiting_approval"].includes(
                    String(entry?.run?.status ?? entry?.status),
                  ),
                )
                .map((entry) => entry.itemId),
              nextActionHint: evaluated.readiness.nextActionHint,
            },
          ),
        },
      }),
    );

    const refreshed = getWorkItemGroupSummary(groupId, dbPath);
    persistGroupDependencyState(
      refreshed,
      evaluateGroupDependencies(refreshed.items),
      "group_run",
      dbPath,
    );
  }

  group = getWorkItemGroupSummary(groupId, dbPath);
  const seenResultIds = new Set(
    results.map((entry) => entry?.itemId).filter(Boolean),
  );
  for (const item of sortByGroupOrder(group.items)) {
    if (seenResultIds.has(item.id)) {
      continue;
    }
    if (["blocked", "review_needed"].includes(item.dependencyState?.state)) {
      results.push({
        itemId: item.id,
        item,
        status: "blocked",
        reason: item.dependencyState.reason,
        blockerIds: item.blockerIds,
        blockers: item.dependencyState.blockers,
        nextActionHint: item.nextActionHint,
        dependencyState: item.dependencyState.state,
      });
      continue;
    }
    if (item.status === "completed") {
      results.push({
        itemId: item.id,
        item,
        status: "completed",
        reason: "already_completed",
      });
    }
  }

  group = getWorkItemGroupSummary(groupId, dbPath);
  const updatedGroup = {
    ...withDatabase(dbPath, (db) => getWorkItemGroup(db, groupId)),
    status: group.readiness.headlineState,
    summary: {
      ...(group.summary ?? {}),
      resultCount: results.length,
      completedCount: results.filter(
        (entry) =>
          entry?.run?.status === "completed" || entry?.status === "completed",
      ).length,
      blockedCount: results.filter((entry) => entry?.status === "blocked")
        .length,
      failedCount: results.filter((entry) => entry?.run?.status === "failed")
        .length,
      validationCount: validationResults.length,
      progressMade,
      dependencyReadiness: group.readiness,
    },
    metadata: {
      ...(group.metadata ?? {}),
      dependencyGraph: {
        ...(group.metadata?.dependencyGraph ?? {}),
        strictnessCounts: group.dependencyGraph.strictnessCounts,
        lastEvaluatedAt: nowIso(),
        lastEvaluationReason: "group_run",
      },
    },
    updatedAt: nowIso(),
    lastRunAt: nowIso(),
  };
  withDatabase(dbPath, (db) => updateWorkItemGroup(db, updatedGroup));
  return {
    group: getWorkItemGroupSummary(groupId, dbPath),
    results,
    validationResults,
  };
}

export async function validateWorkItemGroupBundle(
  groupId,
  payload: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const group = getWorkItemGroupSummary(groupId, dbPath);
  if (!group) {
    return null;
  }
  const validationResults = [];
  for (const item of group.items) {
    const latestRunId = item.latestRun?.id ?? item.runs?.[0]?.id ?? null;
    if (!latestRunId) {
      continue;
    }
    const result = await validateWorkItemRun(
      latestRunId,
      {
        ...payload,
        source: payload.source ?? "group-validate-bundle",
        by: payload.by ?? "operator",
      },
      dbPath,
    );
    validationResults.push(result);
  }
  const refreshedGroup = withDatabase(dbPath, (db) =>
    getWorkItemGroup(db, groupId),
  );
  withDatabase(dbPath, (db) =>
    updateWorkItemGroup(db, {
      ...refreshedGroup,
      updatedAt: nowIso(),
      metadata: {
        ...(refreshedGroup?.metadata ?? {}),
        validationBundles: [
          ...asArray(refreshedGroup?.metadata?.validationBundles),
          compactObject({
            id: createId("group-validation"),
            bundleIds: parseIdList(
              payload.validationBundles ??
                payload.bundleIds ??
                payload.bundles ??
                (payload.bundle ? [payload.bundle] : []),
            ),
            validatedAt: nowIso(),
            runIds: validationResults
              .map((result) => result?.id)
              .filter(Boolean),
            source: payload.source ?? "group-validate-bundle",
            by: payload.by ?? "operator",
          }),
        ].slice(-20),
      },
    }),
  );
  return {
    group: getWorkItemGroupSummary(groupId, dbPath),
    validationResults,
  };
}

function resolveProposalSourceExecutionId(
  proposal,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  if (!proposal?.workItemRunId) {
    return null;
  }
  const run = withDatabase(dbPath, (db) =>
    getWorkItemRun(db, proposal.workItemRunId),
  );
  return run?.result?.executionId ?? null;
}

function resolveProposalPromotionContext(
  proposal,
  options: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const sourceExecutionId =
    options.executionId ??
    proposal?.metadata?.promotion?.sourceExecutionId ??
    resolveProposalSourceExecutionId(proposal, dbPath);
  const targetBranch =
    options.targetBranch ??
    proposal?.metadata?.promotion?.targetBranch ??
    "main";
  const integrationBranch =
    options.integrationBranch ??
    proposal?.metadata?.promotion?.integrationBranch ??
    proposal?.artifacts?.workspace?.branchName ??
    null;
  const blockers = [];
  if (!proposal) {
    blockers.push({
      code: "proposal_not_found",
      reason: "Proposal artifact not found.",
    });
  }
  if (!sourceExecutionId) {
    blockers.push({
      code: "missing_promotion_source_execution",
      reason:
        "Proposal cannot be promoted because the originating work-item run has no durable executionId.",
    });
  }
  if (!proposal?.artifacts?.workspace?.branchName && !integrationBranch) {
    blockers.push({
      code: "missing_workspace_branch",
      reason:
        "Proposal cannot be promoted because no workspace-linked branch is attached.",
    });
  }
  return {
    sourceExecutionId,
    targetBranch,
    integrationBranch,
    blockers,
    ready: blockers.length === 0,
    links: compactObject({
      plan: proposal
        ? `/proposal-artifacts/${encodeURIComponent(proposal.id)}/promotion-plan`
        : null,
      invoke: proposal
        ? `/proposal-artifacts/${encodeURIComponent(proposal.id)}/promotion-invoke`
        : null,
    }),
  };
}

function buildProposalReviewPackage(
  proposal,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  if (!proposal) {
    return null;
  }
  const run = proposal.workItemRunId
    ? getSelfBuildWorkItemRun(proposal.workItemRunId, dbPath)
    : null;
  const workItem = proposal.workItemId
    ? getSelfBuildWorkItem(proposal.workItemId, dbPath)
    : null;
  const workspace = proposal.workItemRunId
    ? getWorkspaceByRun(proposal.workItemRunId, dbPath)
    : null;
  const promotion = resolveProposalPromotionContext(proposal, {}, dbPath);
  const readiness = buildProposalValidationStatus(proposal);
  const executionDetail = promotion.sourceExecutionId
    ? getExecutionDetail(promotion.sourceExecutionId, dbPath)
    : null;
  return {
    proposal: buildProposalSummary(proposal),
    workItemRun: run,
    workItem,
    workspace,
    execution: executionDetail
      ? compactObject({
          id: executionDetail.execution?.id ?? promotion.sourceExecutionId,
          status: executionDetail.execution?.status ?? null,
          role: executionDetail.execution?.role ?? null,
          workflowId: executionDetail.execution?.workflowId ?? null,
          projectId: executionDetail.execution?.projectId ?? null,
          coordinationGroupId:
            executionDetail.execution?.coordinationGroupId ?? null,
          childExecutionIds:
            executionDetail.childExecutions?.map((child) => child.id) ?? [],
          links: {
            self: `/executions/${encodeURIComponent(
              executionDetail.execution?.id ?? promotion.sourceExecutionId,
            )}`,
            tree: `/executions/${encodeURIComponent(
              executionDetail.execution?.id ?? promotion.sourceExecutionId,
            )}/tree`,
            history: `/executions/${encodeURIComponent(
              executionDetail.execution?.id ?? promotion.sourceExecutionId,
            )}/history`,
          },
        })
      : null,
    promotion,
    readiness: {
      ready: readiness.ready,
      validationDrift: readiness.validationDrift,
      blockers: readiness.blockers,
      requiredBundles: readiness.requiredBundles,
    },
    reviewHistory: asArray(proposal.metadata?.reviewHistory),
    approvalHistory: asArray(proposal.metadata?.approvalHistory),
    suggestedActions: [
      proposal.status === "ready_for_review"
        ? {
            action: "review-proposal",
            targetType: "proposal",
            targetId: proposal.id,
            reason: "Proposal is waiting for review.",
            commandHint: `npm run orchestrator:proposal-review -- --proposal ${proposal.id} --status reviewed`,
            httpHint: `/proposal-artifacts/${encodeURIComponent(proposal.id)}/review`,
            priority: "high",
          }
        : null,
      ["reviewed", "waiting_approval"].includes(String(proposal.status))
        ? {
            action: "approve-proposal",
            targetType: "proposal",
            targetId: proposal.id,
            reason: "Proposal review completed and now waits for approval.",
            commandHint: `npm run orchestrator:proposal-approve -- --proposal ${proposal.id} --status approved`,
            httpHint: `/proposal-artifacts/${encodeURIComponent(proposal.id)}/approval`,
            priority: "high",
          }
        : null,
      [
        "approved",
        "promotion_ready",
        "validation_required",
        "promotion_blocked",
      ].includes(String(proposal.status))
        ? {
            action: promotion.ready
              ? readiness.ready
                ? "plan-promotion"
                : "inspect-validation-blockers"
              : "inspect-promotion-blockers",
            targetType: "proposal",
            targetId: proposal.id,
            reason: promotion.ready
              ? readiness.ready
                ? "Proposal is promotion-ready and can be planned through an integrator lane."
                : "Proposal governance passed, but validation gates still block promotion."
              : "Proposal approval completed but promotion is currently blocked.",
            commandHint:
              promotion.ready && readiness.ready
                ? `npm run orchestrator:proposal-promotion-plan -- --proposal ${proposal.id} --target-branch ${promotion.targetBranch}`
                : `npm run orchestrator:proposal-review-package -- --proposal ${proposal.id}`,
            httpHint:
              promotion.ready && readiness.ready
                ? `/proposal-artifacts/${encodeURIComponent(proposal.id)}/promotion-plan`
                : `/proposal-artifacts/${encodeURIComponent(proposal.id)}/review-package`,
            priority: promotion.ready && readiness.ready ? "medium" : "high",
          }
        : null,
    ].filter(Boolean),
  };
}

export function getProposalSummary(
  artifactId,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const artifact = withDatabase(dbPath, (db) =>
    getProposalArtifact(db, artifactId),
  );
  return buildProposalSummary(artifact);
}

export function getProposalReviewPackage(
  artifactId,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const artifact = withDatabase(dbPath, (db) =>
    getProposalArtifact(db, artifactId),
  );
  return buildProposalReviewPackage(artifact, dbPath);
}

export function planProposalPromotion(
  artifactId,
  options: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const artifact = withDatabase(dbPath, (db) =>
    getProposalArtifact(db, artifactId),
  );
  if (!artifact) {
    return null;
  }
  const reviewPackage = buildProposalReviewPackage(artifact, dbPath);
  const promotion =
    reviewPackage?.promotion ??
    resolveProposalPromotionContext(artifact, options, dbPath);
  const readiness = buildProposalValidationStatus(artifact);
  if (!promotion.ready || !promotion.sourceExecutionId) {
    const error = new Error(
      `proposal promotion blocked: ${promotion.blockers[0]?.reason ?? "missing promotion source artifacts"}`,
    );
    (error as LooseRecord).code = "proposal_promotion_blocked";
    (error as LooseRecord).detail = reviewPackage;
    throw error;
  }
  if (!readiness.ready || String(artifact.status) !== "promotion_ready") {
    const error = new Error(
      `proposal promotion blocked: ${readiness.blockers[0]?.reason ?? "proposal is not promotion-ready"}`,
    );
    (error as LooseRecord).code = "proposal_promotion_blocked";
    (error as LooseRecord).detail = reviewPackage;
    throw error;
  }
  const plan = planPromotionForExecution(promotion.sourceExecutionId, {
    invocationId: options.invocationId ?? null,
    targetBranch: promotion.targetBranch,
    objective:
      options.objective ??
      `Promote proposal ${artifact.id} through an integrator lane without mutating canonical root directly.`,
    featureKey:
      options.featureKey ??
      artifact.workItemId ??
      artifact.workItemRunId ??
      artifact.id,
  });
  return {
    proposal: buildProposalSummary(artifact),
    reviewPackage,
    promotion,
    plan,
  };
}

export async function invokeProposalPromotion(
  artifactId,
  options: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
  sessionDbPath = process.env.SPORE_SESSION_DB_PATH,
) {
  const planned = planProposalPromotion(artifactId, options, dbPath);
  if (!planned) {
    return null;
  }
  const detail = await invokeFeaturePromotion(
    planned.promotion.sourceExecutionId,
    {
      invocationId: options.invocationId ?? null,
      targetBranch: planned.promotion.targetBranch,
      objective:
        options.objective ??
        `Promote proposal ${artifactId} through a governed integrator lane.`,
      featureKey:
        options.featureKey ??
        planned.proposal.workItemId ??
        planned.proposal.workItemRunId ??
        planned.proposal.id,
      wait: options.wait === true,
      timeout: options.timeout ?? "180000",
      interval: options.interval ?? "1500",
      noMonitor: options.noMonitor === true,
      stub: options.stub === true,
      launcher: options.launcher ?? null,
      stepSoftTimeoutMs:
        options.stepSoftTimeoutMs ?? options.stepSoftTimeout ?? null,
      stepHardTimeoutMs:
        options.stepHardTimeoutMs ?? options.stepHardTimeout ?? null,
      sessionDbPath: sessionDbPath ?? null,
    },
  );
  const proposal = withDatabase(dbPath, (db) =>
    getProposalArtifact(db, artifactId),
  );
  if (proposal) {
    const integrationBranch =
      planned.promotion.integrationBranch ??
      `spore/integration/${planned.proposal.id}`;
    withDatabase(dbPath, (db) =>
      upsertIntegrationBranch(db, {
        name: integrationBranch,
        projectId:
          proposal.metadata?.projectId ??
          proposal.summary?.projectId ??
          "spore",
        status: "promotion_candidate",
        targetBranch: planned.promotion.targetBranch,
        sourceExecutionId: planned.promotion.sourceExecutionId,
        proposalArtifactIds: [proposal.id],
        workspaceIds: dedupe([
          proposal.metadata?.workspaceId ?? null,
          proposal.artifacts?.workspace?.id ?? null,
        ]),
        metadata: {
          source: "proposal-promotion",
          invocationId:
            detail?.plan?.invocationId ??
            detail?.detail?.plan?.invocationId ??
            null,
          featureKey:
            options.featureKey ??
            planned.proposal.workItemId ??
            planned.proposal.workItemRunId ??
            planned.proposal.id,
        },
        createdAt: nowIso(),
        updatedAt: nowIso(),
        lastPromotionAt: nowIso(),
      }),
    );
    withDatabase(dbPath, (db) =>
      updateProposalArtifact(db, {
        ...proposal,
        updatedAt: nowIso(),
        metadata: {
          ...proposal.metadata,
          promotion: compactObject({
            ...(proposal.metadata?.promotion ?? {}),
            status: "promotion_candidate",
            plannedAt: nowIso(),
            invocationId:
              detail?.plan?.invocationId ??
              detail?.detail?.plan?.invocationId ??
              null,
            targetBranch: planned.promotion.targetBranch,
            integrationBranch,
            sourceExecutionId: planned.promotion.sourceExecutionId,
          }),
        },
      }),
    );
  }
  return {
    proposal: proposal ? buildProposalSummary(proposal) : planned.proposal,
    reviewPackage: planned.reviewPackage,
    promotion: planned.promotion,
    detail,
  };
}

export function getProposalByRun(runId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const artifact = withDatabase(dbPath, (db) =>
    getProposalArtifactByRunId(db, runId),
  );
  return buildProposalSummary(artifact);
}

export function listExecutionWorkspaces(
  executionId,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const workspaces = withDatabase(dbPath, (db) =>
    listWorkspaceAllocations(db, { executionId, limit: 200 }),
  ).map((allocation) => enrichWorkspaceAllocation(allocation, dbPath));
  const byStatus = workspaces.reduce((accumulator, workspace) => {
    accumulator[workspace.status] = (accumulator[workspace.status] ?? 0) + 1;
    return accumulator;
  }, {});
  return {
    executionId,
    count: workspaces.length,
    byStatus,
    workspaces,
    links: {
      self: `/executions/${encodeURIComponent(executionId)}/workspaces`,
    },
  };
}

export function listWorkspaceSummaries(
  options: WorkspaceAllocationListOptions = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  return withDatabase(dbPath, (db) =>
    listWorkspaceAllocations(db, options),
  ).map((allocation) => enrichWorkspaceAllocation(allocation, dbPath));
}

export function getWorkspaceSummary(
  workspaceId,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const allocation = withDatabase(dbPath, (db) =>
    getWorkspaceAllocation(db, workspaceId),
  );
  if (!allocation) {
    return null;
  }
  return enrichWorkspaceAllocation(allocation, dbPath);
}

export function getWorkspaceByRun(
  runId,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const allocation = withDatabase(dbPath, (db) =>
    getWorkspaceAllocationByRunId(db, runId),
  );
  return enrichWorkspaceAllocation(allocation, dbPath);
}

function deriveReconciledWorkspaceStatus(allocation, inspection, workItemRun) {
  if (allocation.status === "cleaned") {
    return "cleaned";
  }
  if (!inspection.exists || !inspection.registered) {
    return "orphaned";
  }
  if (
    workItemRun &&
    ["planned", "starting", "running"].includes(workItemRun.status)
  ) {
    return inspection.clean ? "provisioned" : "active";
  }
  if (allocation.status === "failed") {
    return "failed";
  }
  return inspection.clean ? "settled" : "active";
}

export async function getWorkspaceDetail(
  workspaceId,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const allocation = withDatabase(dbPath, (db) =>
    getWorkspaceAllocation(db, workspaceId),
  );
  if (!allocation) {
    return null;
  }
  const repoRoot = allocation.metadata?.repoRoot
    ? path.resolve(allocation.metadata.repoRoot)
    : PROJECT_ROOT;
  const inspection = await inspectWorkspace({
    repoRoot,
    worktreePath: allocation.worktreePath,
    branchName: allocation.branchName ?? null,
  });
  return enrichWorkspaceAllocation(allocation, dbPath, inspection);
}

export async function getWorkspaceDetailByRun(
  runId,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const allocation = withDatabase(dbPath, (db) =>
    getWorkspaceAllocationByRunId(db, runId),
  );
  if (!allocation) {
    return null;
  }
  return getWorkspaceDetail(allocation.id, dbPath);
}

export async function reconcileManagedWorkspace(
  workspaceId,
  options: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const allocation = withDatabase(dbPath, (db) =>
    getWorkspaceAllocation(db, workspaceId),
  );
  if (!allocation) {
    return null;
  }
  const repoRoot = allocation.metadata?.repoRoot
    ? path.resolve(allocation.metadata.repoRoot)
    : PROJECT_ROOT;
  const reconciled = await reconcileWorkspace({
    repoRoot,
    allocation,
  });
  const ownerContext = getWorkspaceOwnerContext(allocation, dbPath);
  const updated = {
    ...allocation,
    status: deriveReconciledWorkspaceStatus(
      allocation,
      reconciled.inspection,
      ownerContext.workItemRun,
    ),
    metadata: {
      ...allocation.metadata,
      diagnostics: reconciled.diagnostics,
      lastInspection: reconciled.inspection,
      lastReconciledAt: nowIso(),
      reconciledBy: options.by ?? "operator",
      reconcileSource: options.source ?? "workspace-reconcile",
    },
    updatedAt: nowIso(),
  };
  withDatabase(dbPath, (db) => updateWorkspaceAllocation(db, updated));
  return getWorkspaceDetail(updated.id, dbPath);
}

export async function cleanupManagedWorkspace(
  workspaceId,
  options: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const allocation = withDatabase(dbPath, (db) =>
    getWorkspaceAllocation(db, workspaceId),
  );
  if (!allocation) {
    return null;
  }
  const repoRoot = allocation.metadata?.repoRoot
    ? path.resolve(allocation.metadata.repoRoot)
    : PROJECT_ROOT;
  const inspection = await inspectWorkspace({
    repoRoot,
    worktreePath: allocation.worktreePath,
    branchName: allocation.branchName ?? null,
  });
  const ownerContext = getWorkspaceOwnerContext(allocation, dbPath);
  const cleanupPolicy = buildWorkspaceCleanupPolicy({
    allocation,
    inspection,
    workItemRun: ownerContext.workItemRun,
    proposal: ownerContext.proposal,
  });
  if (!cleanupPolicy.eligible && options.force !== true) {
    const error = new Error(
      `workspace cleanup blocked: ${cleanupPolicy.reason}`,
    );
    (error as LooseRecord).code = "cleanup_blocked";
    throw error;
  }

  let cleanupResult: WorkspaceCleanupResult = {
    removed: false,
    skipped: true,
    reason: "already-missing",
  };
  if (inspection.exists && inspection.registered) {
    cleanupResult = await removeWorkspace({
      repoRoot,
      worktreePath: allocation.worktreePath,
      branchName: allocation.branchName ?? null,
      force: options.force === true || cleanupPolicy.requiresForce,
      keepBranch: options.keepBranch === true,
    });
  }

  const updated = {
    ...allocation,
    status: "cleaned",
    cleanedAt: nowIso(),
    metadata: {
      ...allocation.metadata,
      cleanupPolicy,
      cleanupResult,
      cleanedBy: options.by ?? "operator",
      cleanupSource: options.source ?? "workspace-cleanup",
      cleanedWithForce: options.force === true || cleanupPolicy.requiresForce,
      keptBranch: options.keepBranch === true,
    },
    updatedAt: nowIso(),
  };
  withDatabase(dbPath, (db) => updateWorkspaceAllocation(db, updated));
  return enrichWorkspaceAllocation(updated, dbPath, {
    ...inspection,
    exists: false,
    registered: false,
    clean: true,
    issues: [],
  });
}

export async function reviewProposalArtifact(
  artifactId,
  decision: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const artifact = withDatabase(dbPath, (db) =>
    getProposalArtifact(db, artifactId),
  );
  if (!artifact) {
    return null;
  }
  const status =
    String(decision.status ?? "reviewed").trim() === "rejected"
      ? "rejected"
      : "reviewed";
  const reviewedAt = nowIso();
  const reviewEntry = compactObject({
    id: createId("proposal-review"),
    status,
    by: decision.by ?? "operator",
    comments: decision.comments ?? "",
    reason: decision.reason ?? decision.comments ?? "",
    reviewedAt,
  });
  const updated = {
    ...artifact,
    status,
    updatedAt: reviewedAt,
    reviewedAt,
    metadata: {
      ...artifact.metadata,
      review: reviewEntry,
      reviewHistory: [
        ...asArray(artifact.metadata?.reviewHistory),
        reviewEntry,
      ].slice(-20),
      nextAction:
        status === "reviewed"
          ? "approval-or-promotion-check"
          : "revise-work-item",
    },
  };
  withDatabase(dbPath, (db) => updateProposalArtifact(db, updated));
  return buildProposalSummary(updated);
}

export async function approveProposalArtifact(
  artifactId,
  decision: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const artifact = withDatabase(dbPath, (db) =>
    getProposalArtifact(db, artifactId),
  );
  if (!artifact) {
    return null;
  }
  const approved = decision.status ?? "approved";
  const approvedAt = nowIso();
  const sourceExecutionId = (() => {
    const run = artifact.workItemRunId
      ? withDatabase(dbPath, (db) => getWorkItemRun(db, artifact.workItemRunId))
      : null;
    return run?.result?.executionId ?? null;
  })();
  const blockers =
    approved === "approved" && !sourceExecutionId
      ? [
          {
            code: "missing_promotion_source_execution",
            reason:
              "Proposal approval completed, but no durable source execution was attached to the originating work-item run.",
          },
        ]
      : [];
  const currentFingerprint = computeProposalContentFingerprint(artifact);
  const currentValidation = artifact.metadata?.validation ?? {};
  const validationDrift =
    Boolean(currentValidation.validationFingerprint) &&
    currentValidation.validationFingerprint !== currentFingerprint;
  const readinessState = buildProposalValidationStatus({
    ...artifact,
    metadata: {
      ...artifact.metadata,
      validation: {
        ...currentValidation,
        validationDrift,
      },
    },
  });
  const readinessBlockers =
    approved === "approved"
      ? [...blockers, ...readinessState.blockers]
      : blockers;
  const nextPromotion =
    approved === "approved"
      ? {
          status:
            decision.promotionStatus ??
            (readinessBlockers.length > 0 ? "blocked" : "promotion_ready"),
          targetBranch:
            decision.targetBranch ??
            artifact.metadata?.promotion?.targetBranch ??
            null,
          integrationBranch:
            decision.integrationBranch ??
            artifact.artifacts?.workspace?.branchName ??
            artifact.metadata?.promotion?.integrationBranch ??
            null,
          sourceExecutionId,
          source: "proposal-approval",
          blockers: readinessBlockers,
          updatedAt: approvedAt,
        }
      : {
          status:
            approved === "rejected"
              ? "rejected"
              : (artifact.metadata?.promotion?.status ?? null),
          sourceExecutionId,
          blockers: readinessBlockers,
          updatedAt: approvedAt,
        };
  const approvalEntry = compactObject({
    id: createId("proposal-approval"),
    status: approved,
    by: decision.by ?? "operator",
    comments: decision.comments ?? "",
    reason: decision.reason ?? decision.comments ?? "",
    approvedAt,
    promotionStatus: nextPromotion.status ?? null,
    sourceExecutionId,
  });
  const updated = {
    ...artifact,
    status:
      approved === "approved"
        ? readinessBlockers.length > 0
          ? "validation_required"
          : "promotion_ready"
        : approved,
    updatedAt: approvedAt,
    approvedAt,
    metadata: {
      ...artifact.metadata,
      contentFingerprint: currentFingerprint,
      promotion: compactObject({
        ...(artifact.metadata?.promotion ?? {}),
        ...nextPromotion,
      }),
      validation: {
        ...currentValidation,
        validationDrift,
      },
      approval: approvalEntry,
      approvalHistory: [
        ...asArray(artifact.metadata?.approvalHistory),
        approvalEntry,
      ].slice(-20),
      nextAction:
        approved === "approved"
          ? readinessBlockers.length > 0
            ? "run-validation-or-inspect-blockers"
            : "promotion-plan"
          : "revise-work-item",
    },
  };
  withDatabase(dbPath, (db) => updateProposalArtifact(db, updated));
  return buildProposalSummary(updated);
}

export async function validateWorkItemRun(
  runId,
  options: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const run = withDatabase(dbPath, (db) => getWorkItemRun(db, runId));
  if (!run) {
    return null;
  }
  const item = withDatabase(dbPath, (db) => getWorkItem(db, run.workItemId));
  if (!item) {
    return null;
  }
  const bundleIds = resolveValidationBundleIdsForWorkItem(item, run, options);
  const fallbackScenarioIds = dedupe(
    item.metadata?.recommendedScenarios ?? item.relatedScenarios ?? [],
  );
  const fallbackRegressionIds = dedupe(
    item.metadata?.recommendedRegressions ?? item.relatedRegressions ?? [],
  );
  const bundleResults = [];
  let scenarioRuns = [];
  let regressionRuns = [];
  let validationErrors = [];
  const effectiveBundleIds =
    bundleIds.length > 0 ? bundleIds : ["__fallback__"];
  for (const bundleId of effectiveBundleIds) {
    const definition =
      bundleId === "__fallback__"
        ? {
            id: "__fallback__",
            label: "Fallback Validation",
            scenarios: fallbackScenarioIds,
            regressions: fallbackRegressionIds,
            requiredForProposalReadiness: false,
            requiredForPromotionReadiness: false,
          }
        : await getValidationBundleDefinition(bundleId);
    if (!definition) {
      bundleResults.push(
        summarizeValidationBundleRecord(bundleId, null, {
          status: "failed",
          errors: [
            {
              kind: "validation-bundle",
              id: bundleId,
              message: `validation bundle not found: ${bundleId}`,
            },
          ],
        }),
      );
      continue;
    }
    const localScenarioRuns = [];
    const localRegressionRuns = [];
    const localErrors = [];
    for (const scenarioId of dedupe(definition.scenarios ?? [])) {
      const scenarioDefinition = await getScenarioDefinition(scenarioId);
      if (!scenarioDefinition) continue;
      try {
        const result = await runScenarioById(
          scenarioId,
          {
            project: item.metadata?.projectPath ?? "config/projects/spore.yaml",
            wait: true,
            timeout: options.timeout ?? "180000",
            interval: options.interval ?? "1500",
            noMonitor: options.noMonitor === true,
            stub: options.stub !== false,
            launcher: options.launcher ?? null,
            source: options.source ?? "work-item-validation",
            by: options.by ?? "operator",
          },
          dbPath,
        );
        localScenarioRuns.push(result.run.id);
      } catch (error) {
        localErrors.push({
          kind: "scenario",
          id: scenarioId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    for (const regressionId of dedupe(definition.regressions ?? [])) {
      const regressionDefinition = await getRegressionDefinition(regressionId);
      if (!regressionDefinition) continue;
      try {
        const result = await runRegressionById(
          regressionId,
          {
            project: item.metadata?.projectPath ?? "config/projects/spore.yaml",
            timeout: options.timeout ?? "180000",
            interval: options.interval ?? "1500",
            noMonitor: options.noMonitor === true,
            stub: options.stub !== false,
            launcher: options.launcher ?? null,
            source: options.source ?? "work-item-validation",
            by: options.by ?? "operator",
          },
          dbPath,
        );
        localRegressionRuns.push(result.run.id);
      } catch (error) {
        localErrors.push({
          kind: "regression",
          id: regressionId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    scenarioRuns = [...scenarioRuns, ...localScenarioRuns];
    regressionRuns = [...regressionRuns, ...localRegressionRuns];
    validationErrors = [...validationErrors, ...localErrors];
    bundleResults.push(
      summarizeValidationBundleRecord(bundleId, definition, {
        scenarioRunIds: localScenarioRuns,
        regressionRunIds: localRegressionRuns,
        errors: localErrors,
        status:
          localErrors.length > 0
            ? "failed"
            : localScenarioRuns.length === 0 && localRegressionRuns.length === 0
              ? "not_configured"
              : "completed",
        validatedAt: nowIso(),
      }),
    );
  }
  const validation: LooseRecord = {
    status:
      validationErrors.length > 0
        ? "failed"
        : regressionRuns.length === 0 && scenarioRuns.length === 0
          ? "not_configured"
          : "completed",
    scenarioRunIds: dedupe(scenarioRuns),
    regressionRunIds: dedupe(regressionRuns),
    errors: validationErrors,
    bundleIds: bundleResults.map((record) => record.bundleId),
    bundleResults,
    validatedAt: nowIso(),
  };
  const proposal = withDatabase(dbPath, (db) =>
    getProposalArtifactByRunId(db, runId),
  );
  const currentFingerprint = proposal
    ? computeProposalContentFingerprint(proposal)
    : null;
  validation.validationFingerprint = currentFingerprint;
  validation.validationDrift = false;
  const updatedRun = {
    ...run,
    metadata: {
      ...run.metadata,
      validationBundleIds: bundleResults
        .map((record) => record.bundleId)
        .filter((bundleId) => bundleId && bundleId !== "__fallback__"),
      validation,
      docSuggestions: buildDocSuggestionsHelper(item, run, proposal),
    },
  };
  withDatabase(dbPath, (db) => updateWorkItemRun(db, updatedRun));
  if (proposal) {
    const validationStatus = buildProposalValidationStatus({
      ...proposal,
      metadata: {
        ...proposal.metadata,
        validation: {
          ...validation,
          validationFingerprint: currentFingerprint,
          validationDrift: false,
        },
      },
    });
    const nextStatus =
      validation.status === "failed"
        ? "validation_failed"
        : validationStatus.ready &&
            [
              "reviewed",
              "approved",
              "validation_required",
              "promotion_blocked",
              "promotion_ready",
            ].includes(String(proposal.status))
          ? "promotion_ready"
          : validation.status === "completed"
            ? "reviewed"
            : proposal.status;
    withDatabase(dbPath, (db) =>
      updateProposalArtifact(db, {
        ...proposal,
        status: nextStatus,
        updatedAt: nowIso(),
        metadata: {
          ...proposal.metadata,
          validation: {
            ...validation,
            validationFingerprint: currentFingerprint,
            validationDrift: false,
          },
          promotion: compactObject({
            ...(proposal.metadata?.promotion ?? {}),
            blockers: validationStatus.blockers,
            status:
              nextStatus === "promotion_ready"
                ? "promotion_ready"
                : (proposal.metadata?.promotion?.status ?? "blocked"),
            updatedAt: nowIso(),
          }),
        },
      }),
    );
  }
  return getSelfBuildWorkItemRun(runId, dbPath);
}

export function getDocSuggestionsForRun(
  runId,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const detail = getSelfBuildWorkItemRun(runId, dbPath);
  if (!detail) {
    return null;
  }
  return {
    runId,
    itemId: detail.workItemId,
    suggestions: detail.docSuggestions ?? [],
  };
}

function buildSelfBuildDecisionSummary(decision) {
  if (!decision) {
    return null;
  }
  return {
    ...decision,
    links: {
      self: "/self-build/decisions",
    },
  };
}

export function listSelfBuildDecisionSummaries(
  options: SelfBuildDecisionListOptions = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  return withDatabase(dbPath, (db) => listSelfBuildDecisions(db, options)).map(
    buildSelfBuildDecisionSummary,
  );
}

function quarantineLinks(record) {
  return {
    self: "/self-build/quarantine",
    release: `/self-build/quarantine/${encodeURIComponent(record.id)}/release`,
  };
}

function buildQuarantineSummary(record) {
  if (!record) {
    return null;
  }
  return {
    ...record,
    links: quarantineLinks(record),
  };
}

export function listSelfBuildQuarantineSummaries(
  options: QuarantineRecordListOptions = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  return withDatabase(dbPath, (db) => listQuarantineRecords(db, options)).map(
    buildQuarantineSummary,
  );
}

function buildRollbackSummary(record) {
  if (!record) {
    return null;
  }
  return {
    ...record,
    links: {
      self: "/self-build/rollback",
    },
  };
}

export function listSelfBuildRollbackSummaries(
  options: RollbackRecordListOptions = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  return withDatabase(dbPath, (db) => listRollbackRecords(db, options)).map(
    buildRollbackSummary,
  );
}

async function recordSelfBuildDecision(
  payload: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const entry = {
    id: payload.id ?? createId("self-build-decision"),
    loopId: payload.loopId ?? "default",
    mode: payload.mode ?? null,
    state: toText(payload.state, "info"),
    action: toText(payload.action, "noop"),
    targetType: payload.targetType ?? null,
    targetId: payload.targetId ?? null,
    rationale: payload.rationale ?? "",
    policy: mergeMetadata(payload.policy ?? {}),
    metadata: mergeMetadata(payload.metadata ?? {}),
    createdAt: payload.createdAt ?? nowIso(),
  };
  withDatabase(dbPath, (db) => insertSelfBuildDecision(db, entry));
  return buildSelfBuildDecisionSummary(entry);
}

function summarizeAutonomyEvaluation(
  kind,
  eligible,
  reasons = [],
  policy: AutonomousPolicyConfig = normalizeAutonomousPolicy({}),
) {
  return {
    kind,
    eligible,
    reasons,
    mode: policy.mode ?? "supervised",
    policy,
  };
}

function isMutationScopeAllowed(
  scopes: string[] = [],
  policy: LooseRecord = {},
) {
  const allowedScopes = dedupe(policy.allowedMutationScopes ?? []);
  const protectedScopes = dedupe(policy.protectedScopes ?? []);
  const blockedProtected = dedupe(
    scopes.filter((scope) => protectedScopes.includes(scope)),
  );
  if (blockedProtected.length > 0) {
    return {
      allowed: false,
      reason: `protected scopes present: ${blockedProtected.join(", ")}`,
    };
  }
  if (allowedScopes.length === 0) {
    return { allowed: true, reason: "" };
  }
  const disallowed = dedupe(
    scopes.filter((scope) => !allowedScopes.includes(scope)),
  );
  return disallowed.length > 0
    ? {
        allowed: false,
        reason: `disallowed mutation scopes: ${disallowed.join(", ")}`,
      }
    : { allowed: true, reason: "" };
}

function evaluateGoalPlanAutonomousEligibility(plan, policy: LooseRecord = {}) {
  const reasons = [];
  if (policy.enabled !== true) {
    reasons.push("autonomous policy disabled");
  }
  if (policy.requireSafeMode === true && plan.constraints?.safeMode === false) {
    reasons.push("goal plan is not in safe mode");
  }
  if (
    policy.allowedDomains?.length > 0 &&
    plan.domainId &&
    !policy.allowedDomains.includes(plan.domainId)
  ) {
    reasons.push(`domain not allowed for autonomy: ${plan.domainId}`);
  }
  const recommendations = asArray(
    plan.editedRecommendations?.length > 0
      ? plan.editedRecommendations
      : plan.recommendations,
  );
  for (const recommendation of recommendations) {
    const templateId = recommendation.metadata?.templateId ?? null;
    if (
      templateId &&
      policy.allowedTemplates?.length > 0 &&
      !policy.allowedTemplates.includes(templateId)
    ) {
      reasons.push(`template not allowed for autonomy: ${templateId}`);
    }
    const scopeCheck = isMutationScopeAllowed(
      dedupe(recommendation.metadata?.mutationScope ?? []),
      policy,
    );
    if (!scopeCheck.allowed && scopeCheck.reason) {
      reasons.push(scopeCheck.reason);
    }
  }
  return summarizeAutonomyEvaluation(
    "goal-plan",
    reasons.length === 0,
    dedupe(reasons),
    policy,
  );
}

function evaluateGroupAutonomousEligibility(group, policy: LooseRecord = {}) {
  const reasons = [];
  if (policy.enabled !== true) {
    reasons.push("autonomous policy disabled");
  }
  if (String(group.status) === "quarantined") {
    reasons.push("group is quarantined");
  }
  if (
    [
      "blocked",
      "failed",
      "waiting_review",
      "waiting_validation",
      "waiting_promotion",
    ].includes(String(group.status))
  ) {
    reasons.push(`group state requires manual handling: ${group.status}`);
  }
  for (const item of asArray(group.items)) {
    const templateId = item.metadata?.templateId ?? null;
    if (
      templateId &&
      policy.allowedTemplates?.length > 0 &&
      !policy.allowedTemplates.includes(templateId)
    ) {
      reasons.push(`template not allowed for autonomy: ${templateId}`);
    }
    if (
      policy.allowedDomains?.length > 0 &&
      item.metadata?.domainId &&
      !policy.allowedDomains.includes(item.metadata.domainId)
    ) {
      reasons.push(
        `domain not allowed for autonomy: ${item.metadata.domainId}`,
      );
    }
    if (policy.requireSafeMode === true && item.metadata?.safeMode === false) {
      reasons.push(`item not in safe mode: ${item.id}`);
    }
    const scopeCheck = isMutationScopeAllowed(
      dedupe(item.metadata?.mutationScope ?? []),
      policy,
    );
    if (!scopeCheck.allowed && scopeCheck.reason) {
      reasons.push(`${item.id}: ${scopeCheck.reason}`);
    }
  }
  return summarizeAutonomyEvaluation(
    "work-item-group",
    reasons.length === 0,
    dedupe(reasons),
    policy,
  );
}

function evaluateProposalPromotionAutonomy(
  proposal,
  policy: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const reasons = [];
  if (policy.enabled !== true) {
    reasons.push("autonomous policy disabled");
  }
  if (policy.autoPromoteToIntegration !== true) {
    reasons.push("autonomous promotion disabled by policy");
  }
  if (String(proposal.status) !== "promotion_ready") {
    reasons.push(`proposal not promotion_ready: ${proposal.status}`);
  }
  if (proposal.validationDrift === true) {
    reasons.push("proposal validation drift detected");
  }
  const activeQuarantine = withDatabase(dbPath, (db) =>
    findActiveQuarantineRecord(db, "proposal", proposal.id),
  );
  if (activeQuarantine) {
    reasons.push(`proposal quarantined: ${activeQuarantine.reason}`);
  }
  const scopeCheck = isMutationScopeAllowed(
    dedupe(
      proposal.summary?.mutationScope ??
        proposal.metadata?.mutationScope ??
        proposal.artifacts?.workspace?.mutationScope ??
        [],
    ),
    policy,
  );
  if (!scopeCheck.allowed && scopeCheck.reason) {
    reasons.push(scopeCheck.reason);
  }
  const missingRequiredBundles = dedupe(
    policy.requiredValidationBundles ?? [],
  ).filter(
    (bundleId) =>
      !asArray(proposal.validation?.bundleResults).some(
        (result) =>
          String(result?.bundleId ?? result?.id ?? "") === bundleId &&
          String(result?.status ?? "") === "completed",
      ),
  );
  if (missingRequiredBundles.length > 0) {
    reasons.push(
      `missing required autonomous validation bundles: ${missingRequiredBundles.join(", ")}`,
    );
  }
  return summarizeAutonomyEvaluation(
    "proposal",
    reasons.length === 0,
    dedupe(reasons),
    policy,
  );
}

function quarantineTargetLinks(targetType, targetId) {
  switch (targetType) {
    case "goal-plan":
      return { self: `/goal-plans/${encodeURIComponent(targetId)}` };
    case "work-item-group":
      return { self: `/work-item-groups/${encodeURIComponent(targetId)}` };
    case "proposal":
      return { self: `/proposal-artifacts/${encodeURIComponent(targetId)}` };
    case "integration-branch":
      return { self: `/integration-branches/${encodeURIComponent(targetId)}` };
    default:
      return { self: null };
  }
}

export async function quarantineSelfBuildTarget(
  targetType,
  targetId,
  payload: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const targetExists = withDatabase(dbPath, (db) => {
    if (targetType === "goal-plan") {
      return Boolean(getGoalPlan(db, targetId));
    }
    if (targetType === "work-item-group") {
      return Boolean(getWorkItemGroup(db, targetId));
    }
    if (targetType === "proposal") {
      return Boolean(getProposalArtifact(db, targetId));
    }
    if (targetType === "integration-branch") {
      return Boolean(getIntegrationBranch(db, targetId));
    }
    return false;
  });
  if (!targetExists) {
    const error = new Error(
      `cannot quarantine missing ${targetType}: ${targetId}`,
    );
    (error as LooseRecord).code = "self_build_target_not_found";
    throw error;
  }
  const existing = withDatabase(dbPath, (db) =>
    findActiveQuarantineRecord(db, targetType, targetId),
  );
  if (existing) {
    return buildQuarantineSummary(existing);
  }
  const now = nowIso();
  const record = {
    id: createId("quarantine"),
    targetType,
    targetId,
    status: "active",
    reason: toText(
      payload.reason,
      "Autonomous safety policy quarantined this target.",
    ),
    sourceType: payload.sourceType ?? "self-build-loop",
    sourceId: payload.sourceId ?? null,
    metadata: mergeMetadata(
      {
        by: payload.by ?? "self-build-loop",
        rationale: payload.rationale ?? "",
      },
      payload.metadata ?? {},
      quarantineTargetLinks(targetType, targetId),
    ),
    createdAt: now,
    updatedAt: now,
    releasedAt: null,
  };
  withDatabase(dbPath, (db) => insertQuarantineRecord(db, record));
  withDatabase(dbPath, (db) => {
    if (targetType === "goal-plan") {
      const plan = getGoalPlan(db, targetId);
      if (plan) {
        updateGoalPlan(db, {
          ...plan,
          status: "blocked",
          updatedAt: now,
          metadata: mergeMetadata(plan.metadata ?? {}, {
            quarantine: {
              id: record.id,
              status: "active",
              reason: record.reason,
              updatedAt: now,
            },
          }),
        });
      }
    } else if (targetType === "work-item-group") {
      const group = getWorkItemGroup(db, targetId);
      if (group) {
        updateWorkItemGroup(db, {
          ...group,
          status: "quarantined",
          updatedAt: now,
          metadata: mergeMetadata(group.metadata ?? {}, {
            quarantine: {
              id: record.id,
              status: "active",
              reason: record.reason,
              updatedAt: now,
            },
          }),
        });
      }
    } else if (targetType === "proposal") {
      const artifact = getProposalArtifact(db, targetId);
      if (artifact) {
        updateProposalArtifact(db, {
          ...artifact,
          status: "promotion_blocked",
          updatedAt: now,
          metadata: mergeMetadata(artifact.metadata ?? {}, {
            quarantine: {
              id: record.id,
              status: "active",
              reason: record.reason,
              updatedAt: now,
            },
          }),
        });
      }
    } else if (targetType === "integration-branch") {
      const branch = getIntegrationBranch(db, targetId);
      if (branch) {
        upsertIntegrationBranch(db, {
          ...branch,
          status: "quarantined",
          updatedAt: now,
          metadata: mergeMetadata(branch.metadata ?? {}, {
            quarantine: {
              id: record.id,
              status: "active",
              reason: record.reason,
              updatedAt: now,
            },
          }),
        });
      }
    }
  });
  return buildQuarantineSummary(record);
}

export async function releaseSelfBuildQuarantine(
  quarantineId,
  payload: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const record = withDatabase(dbPath, (db) =>
    getQuarantineRecord(db, quarantineId),
  );
  if (!record) {
    return null;
  }
  const now = nowIso();
  const updated = {
    ...record,
    status: "released",
    updatedAt: now,
    releasedAt: now,
    metadata: mergeMetadata(record.metadata ?? {}, {
      releasedBy: payload.by ?? "operator",
      releaseReason: payload.reason ?? "",
    }),
  };
  withDatabase(dbPath, (db) => updateQuarantineRecord(db, updated));
  withDatabase(dbPath, (db) => {
    if (record.targetType === "goal-plan") {
      const plan = getGoalPlan(db, record.targetId);
      if (plan) {
        updateGoalPlan(db, {
          ...plan,
          status:
            payload.nextStatus ??
            (String(plan.status) === "blocked" ? "planned" : plan.status),
          updatedAt: now,
          metadata: mergeMetadata(plan.metadata ?? {}, {
            quarantine: {
              id: record.id,
              status: "released",
              reason: record.reason,
              releasedAt: now,
            },
          }),
        });
      }
    } else if (record.targetType === "work-item-group") {
      const group = getWorkItemGroup(db, record.targetId);
      if (group) {
        updateWorkItemGroup(db, {
          ...group,
          status:
            payload.nextStatus ??
            (String(group.status) === "quarantined" ? "blocked" : group.status),
          updatedAt: now,
          metadata: mergeMetadata(group.metadata ?? {}, {
            quarantine: {
              id: record.id,
              status: "released",
              reason: record.reason,
              releasedAt: now,
            },
          }),
        });
      }
    } else if (record.targetType === "integration-branch") {
      const branch = getIntegrationBranch(db, record.targetId);
      if (branch) {
        upsertIntegrationBranch(db, {
          ...branch,
          status:
            payload.nextStatus ??
            (String(branch.status) === "quarantined"
              ? "blocked"
              : branch.status),
          updatedAt: now,
          metadata: mergeMetadata(branch.metadata ?? {}, {
            quarantine: {
              id: record.id,
              status: "released",
              reason: record.reason,
              releasedAt: now,
            },
          }),
        });
      }
    }
  });
  return buildQuarantineSummary(updated);
}

export async function rollbackIntegrationBranch(
  branchName,
  payload: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const branch = withDatabase(dbPath, (db) =>
    getIntegrationBranch(db, branchName),
  );
  if (!branch) {
    return null;
  }
  const now = nowIso();
  const rollback = {
    id: createId("rollback"),
    targetType: "integration-branch",
    targetId: branchName,
    status: "recorded",
    reason: toText(
      payload.reason,
      "Operator requested rollback/quarantine for integration branch.",
    ),
    metadata: mergeMetadata(
      {
        by: payload.by ?? "operator",
        source: payload.source ?? "integration-branch-rollback",
        proposalArtifactIds: branch.proposalArtifactIds ?? [],
        workspaceIds: branch.workspaceIds ?? [],
      },
      payload.metadata ?? {},
    ),
    createdAt: now,
    updatedAt: now,
  };
  withDatabase(dbPath, (db) => insertRollbackRecord(db, rollback));
  const quarantine = await quarantineSelfBuildTarget(
    "integration-branch",
    branchName,
    {
      by: payload.by ?? "operator",
      reason: rollback.reason,
      sourceType: "rollback",
      sourceId: rollback.id,
      metadata: {
        rollbackId: rollback.id,
      },
    },
    dbPath,
  );
  return {
    rollback: buildRollbackSummary(rollback),
    quarantine,
    branch: getIntegrationBranchSummary(branchName, dbPath),
  };
}

export function listIntegrationBranchSummaries(
  options: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const status = options.status ? String(options.status).trim() : null;
  const limit = Number.parseInt(String(options.limit ?? "50"), 10) || 50;
  const quarantines = listSelfBuildQuarantineSummaries(
    { status: "active", targetType: "integration-branch", limit: 100 },
    dbPath,
  );
  const rollbacks = listSelfBuildRollbackSummaries(
    { targetType: "integration-branch", limit: 100 },
    dbPath,
  );
  return withDatabase(dbPath, (db) =>
    listIntegrationBranches(db, status, limit),
  ).map((branch) => ({
    ...branch,
    quarantine:
      quarantines.find((record) => record.targetId === branch.name) ?? null,
    latestRollback:
      rollbacks.find((record) => record.targetId === branch.name) ?? null,
    links: {
      self: `/integration-branches/${encodeURIComponent(branch.name)}`,
      quarantine: `/integration-branches/${encodeURIComponent(branch.name)}/quarantine`,
      rollback: `/integration-branches/${encodeURIComponent(branch.name)}/rollback`,
    },
  }));
}

export function getIntegrationBranchSummary(
  branchName,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const branch = withDatabase(dbPath, (db) =>
    getIntegrationBranch(db, branchName),
  );
  if (!branch) {
    return null;
  }
  const quarantine = listSelfBuildQuarantineSummaries(
    { status: "active", targetType: "integration-branch", limit: 100 },
    dbPath,
  ).find((record) => record.targetId === branch.name);
  const rollback = listSelfBuildRollbackSummaries(
    { targetType: "integration-branch", limit: 100 },
    dbPath,
  ).find((record) => record.targetId === branch.name);
  return {
    ...branch,
    quarantine: quarantine ?? null,
    latestRollback: rollback ?? null,
    links: {
      self: `/integration-branches/${encodeURIComponent(branch.name)}`,
      quarantine: `/integration-branches/${encodeURIComponent(branch.name)}/quarantine`,
      rollback: `/integration-branches/${encodeURIComponent(branch.name)}/rollback`,
    },
  };
}

function buildLoopStatusSummary(
  loopState,
  history = [],
  decisions = [],
  quarantines = [],
  rollbacks = [],
) {
  if (!loopState) {
    return {
      id: "default",
      status: "stopped",
      mode: "supervised",
      history,
      recentDecisions: decisions,
      activeQuarantines: quarantines,
      recentRollbacks: rollbacks,
    };
  }
  return {
    ...loopState,
    history,
    recentDecisions: decisions,
    activeQuarantines: quarantines,
    recentRollbacks: rollbacks,
    links: {
      self: "/self-build/loop/status",
      start: "/self-build/loop/start",
      stop: "/self-build/loop/stop",
      decisions: "/self-build/decisions",
      quarantine: "/self-build/quarantine",
      rollback: "/self-build/rollback",
    },
  };
}

export function getSelfBuildLoopStatus(dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  return withDatabase(dbPath, (db) =>
    buildLoopStatusSummary(
      getSelfBuildLoopState(db, "default"),
      listSelfBuildLoopStates(db, null, 20),
      listSelfBuildDecisions(db, { limit: 20 }).map(
        buildSelfBuildDecisionSummary,
      ),
      listQuarantineRecords(db, { status: "active", limit: 20 }).map(
        buildQuarantineSummary,
      ),
      listRollbackRecords(db, { limit: 20 }).map(buildRollbackSummary),
    ),
  );
}

async function maybeQuarantineFromLoop(
  targetType,
  targetId,
  evaluation,
  options: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const policy = evaluation?.policy ?? {};
  const threshold =
    targetType === "proposal"
      ? Number(policy.quarantineOnFailureCount ?? 2)
      : Number(policy.quarantineOnBlockedCount ?? 2);
  const recentCount = listSelfBuildDecisionSummaries(
    { targetType, targetId, state: "blocked", limit: 20 },
    dbPath,
  ).length;
  if (!Number.isFinite(threshold) || threshold < 1 || recentCount < threshold) {
    return null;
  }
  return quarantineSelfBuildTarget(
    targetType,
    targetId,
    {
      by: options.by ?? "self-build-loop",
      sourceType: "self-build-loop",
      sourceId: options.loopId ?? "default",
      reason: `Autonomous loop quarantined ${targetType} after repeated blockers: ${dedupe(
        evaluation?.reasons ?? [],
      ).join("; ")}`,
      metadata: {
        mode: policy.mode ?? "supervised",
        blockers: dedupe(evaluation?.reasons ?? []),
        threshold,
        decisionCount: recentCount,
      },
    },
    dbPath,
  );
}

async function runSelfBuildLoopIteration(
  loopState,
  options: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const by = options.by ?? "self-build-loop";
  const source = options.source ?? "self-build-loop";
  const policy = normalizeAutonomousPolicy(
    loopState?.policy ?? options.policy ?? {},
  );
  const plannedGoal = listGoalPlansSummary({ limit: 20 }, dbPath).find((plan) =>
    ["planned", "reviewed"].includes(String(plan.status)),
  );
  if (plannedGoal) {
    const evaluation = evaluateGoalPlanAutonomousEligibility(
      plannedGoal,
      policy,
    );
    await recordSelfBuildDecision(
      {
        loopId: loopState?.id ?? "default",
        mode: policy.mode,
        state: evaluation.eligible ? "eligible" : "blocked",
        action: "evaluate-goal-plan",
        targetType: "goal-plan",
        targetId: plannedGoal.id,
        rationale: evaluation.eligible
          ? "Goal plan is eligible for autonomous progression."
          : evaluation.reasons.join("; "),
        policy,
        metadata: {
          evaluation,
        },
      },
      dbPath,
    );
    if (!evaluation.eligible) {
      const quarantine = await maybeQuarantineFromLoop(
        "goal-plan",
        plannedGoal.id,
        evaluation,
        { ...options, loopId: loopState?.id ?? "default" },
        dbPath,
      );
      return {
        action: quarantine ? "quarantine-goal-plan" : "blocked-goal-plan",
        goalPlanId: plannedGoal.id,
        evaluation,
        quarantine,
      };
    }
    let reviewed = plannedGoal;
    if (
      plannedGoal.metadata?.reviewRequired !== false &&
      plannedGoal.status !== "reviewed" &&
      policy.autoReviewGoalPlans === true
    ) {
      reviewed = await reviewGoalPlan(
        plannedGoal.id,
        {
          status: "reviewed",
          by,
          source,
          comments:
            "Autonomous loop reviewed goal plan because autonomy policy allowed automatic review.",
        },
        dbPath,
      );
      await recordSelfBuildDecision(
        {
          loopId: loopState?.id ?? "default",
          mode: policy.mode,
          state: "executed",
          action: "review-goal-plan",
          targetType: "goal-plan",
          targetId: plannedGoal.id,
          rationale: "Automatic review completed under autonomous policy.",
          policy,
        },
        dbPath,
      );
    }
    if (
      reviewed?.status !== "reviewed" &&
      reviewed?.metadata?.reviewRequired !== false
    ) {
      return {
        action: "blocked-goal-plan",
        goalPlanId: plannedGoal.id,
        evaluation,
        reason: "Goal plan still requires review before autonomous execution.",
      };
    }
    const result = await runGoalPlan(
      plannedGoal.id,
      {
        ...options,
        autoValidate: policy.autoValidateBundles === true,
        source,
        by,
      },
      dbPath,
    );
    await recordSelfBuildDecision(
      {
        loopId: loopState?.id ?? "default",
        mode: policy.mode,
        state: "executed",
        action: "run-goal-plan",
        targetType: "goal-plan",
        targetId: plannedGoal.id,
        rationale: "Autonomous loop ran an eligible goal plan.",
        policy,
        metadata: {
          resultStatus: result?.goalPlan?.status ?? null,
          groupId: result?.group?.id ?? null,
        },
      },
      dbPath,
    );
    return {
      action: "run-goal-plan",
      goalPlanId: plannedGoal.id,
      evaluation,
      result,
    };
  }

  const validationGroup = listWorkItemGroupsSummary({ limit: 50 }, dbPath).find(
    (entry) =>
      asArray(entry.proposals).some((proposal) =>
        ["validation_required", "validation_failed"].includes(
          String(proposal?.status),
        ),
      ),
  );
  if (validationGroup && policy.autoValidateBundles === true) {
    const evaluation = evaluateGroupAutonomousEligibility(
      validationGroup,
      policy,
    );
    await recordSelfBuildDecision(
      {
        loopId: loopState?.id ?? "default",
        mode: policy.mode,
        state: evaluation.eligible ? "eligible" : "blocked",
        action: "evaluate-group-validation",
        targetType: "work-item-group",
        targetId: validationGroup.id,
        rationale: evaluation.eligible
          ? "Group is eligible for autonomous validation."
          : evaluation.reasons.join("; "),
        policy,
      },
      dbPath,
    );
    if (!evaluation.eligible) {
      const quarantine = await maybeQuarantineFromLoop(
        "work-item-group",
        validationGroup.id,
        evaluation,
        { ...options, loopId: loopState?.id ?? "default" },
        dbPath,
      );
      return {
        action: quarantine ? "quarantine-group" : "blocked-group-validation",
        groupId: validationGroup.id,
        evaluation,
        quarantine,
      };
    }
    const bundleIds = policy.requiredValidationBundles?.length
      ? policy.requiredValidationBundles
      : undefined;
    const result = await validateWorkItemGroupBundle(
      validationGroup.id,
      {
        ...options,
        bundles: bundleIds,
        source,
        by,
      },
      dbPath,
    );
    await recordSelfBuildDecision(
      {
        loopId: loopState?.id ?? "default",
        mode: policy.mode,
        state: "executed",
        action: "validate-group-bundle",
        targetType: "work-item-group",
        targetId: validationGroup.id,
        rationale:
          "Autonomous loop executed validation bundle for a ready group.",
        policy,
        metadata: {
          bundleIds: bundleIds ?? [],
        },
      },
      dbPath,
    );
    return {
      action: "validate-group-bundle",
      groupId: validationGroup.id,
      evaluation,
      result,
    };
  }

  const promotionProposal = withDatabase(dbPath, (db) =>
    listProposalArtifacts(db, "promotion_ready", 50),
  )
    .map((proposal) => buildProposalSummary(proposal))
    .find(Boolean);
  if (promotionProposal) {
    const evaluation = evaluateProposalPromotionAutonomy(
      promotionProposal,
      policy,
      dbPath,
    );
    await recordSelfBuildDecision(
      {
        loopId: loopState?.id ?? "default",
        mode: policy.mode,
        state: evaluation.eligible ? "eligible" : "blocked",
        action: "evaluate-promotion",
        targetType: "proposal",
        targetId: promotionProposal.id,
        rationale: evaluation.eligible
          ? "Proposal is eligible for autonomous promotion."
          : evaluation.reasons.join("; "),
        policy,
      },
      dbPath,
    );
    if (!evaluation.eligible) {
      const quarantine = await maybeQuarantineFromLoop(
        "proposal",
        promotionProposal.id,
        evaluation,
        { ...options, loopId: loopState?.id ?? "default" },
        dbPath,
      );
      return {
        action: quarantine ? "quarantine-proposal" : "blocked-promotion",
        proposalId: promotionProposal.id,
        evaluation,
        quarantine,
      };
    }
    const promotion = await invokeProposalPromotion(
      promotionProposal.id,
      {
        ...options,
        source,
        by,
        stub: options.stub === true,
      },
      dbPath,
    );
    await recordSelfBuildDecision(
      {
        loopId: loopState?.id ?? "default",
        mode: policy.mode,
        state: "executed",
        action: "invoke-promotion",
        targetType: "proposal",
        targetId: promotionProposal.id,
        rationale:
          "Autonomous loop promoted a validation-ready proposal to integration branch.",
        policy,
        metadata: {
          integrationBranch:
            promotion?.promotion?.integrationBranch ??
            promotion?.proposal?.metadata?.promotion?.integrationBranch ??
            null,
        },
      },
      dbPath,
    );
    return {
      action: "invoke-promotion",
      proposalId: promotionProposal.id,
      evaluation,
      result: promotion,
    };
  }

  const group = listWorkItemGroupsSummary({ limit: 50 }, dbPath).find((entry) =>
    ["pending", "ready"].includes(String(entry.status)),
  );
  if (group && policy.autoRunGroups === true) {
    const evaluation = evaluateGroupAutonomousEligibility(group, policy);
    await recordSelfBuildDecision(
      {
        loopId: loopState?.id ?? "default",
        mode: policy.mode,
        state: evaluation.eligible ? "eligible" : "blocked",
        action: "evaluate-group-run",
        targetType: "work-item-group",
        targetId: group.id,
        rationale: evaluation.eligible
          ? "Work-item group is eligible for autonomous execution."
          : evaluation.reasons.join("; "),
        policy,
      },
      dbPath,
    );
    if (!evaluation.eligible) {
      const quarantine = await maybeQuarantineFromLoop(
        "work-item-group",
        group.id,
        evaluation,
        { ...options, loopId: loopState?.id ?? "default" },
        dbPath,
      );
      return {
        action: quarantine ? "quarantine-group" : "blocked-group-run",
        groupId: group.id,
        evaluation,
        quarantine,
      };
    }
    const result = await runWorkItemGroup(
      group.id,
      {
        ...options,
        autoValidate: policy.autoValidateBundles === true,
        source,
        by,
      },
      dbPath,
    );
    await recordSelfBuildDecision(
      {
        loopId: loopState?.id ?? "default",
        mode: policy.mode,
        state: "executed",
        action: "run-group",
        targetType: "work-item-group",
        targetId: group.id,
        rationale: "Autonomous loop ran an eligible work-item group.",
        policy,
        metadata: {
          resultStatus: result?.group?.status ?? null,
        },
      },
      dbPath,
    );
    return {
      action: "run-group",
      groupId: group.id,
      evaluation,
      result,
    };
  }
  return {
    action: "idle",
    reason:
      "No eligible goal plans, validation work, promotion-ready proposals, or runnable groups were available.",
  };
}

export async function startSelfBuildLoop(
  options: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const startedAt = nowIso();
  const projectId = options.projectId ?? "spore";
  const resolvedPolicy = await loadProjectSelfBuildPolicy(projectId);
  const current = withDatabase(dbPath, (db) =>
    getSelfBuildLoopState(db, "default"),
  );
  const next = {
    id: "default",
    status: "running",
    mode:
      options.mode ??
      current?.mode ??
      resolvedPolicy.autonomy.mode ??
      "supervised",
    projectId: options.projectId ?? current?.projectId ?? "spore",
    policy: normalizeAutonomousPolicy(
      mergeMetadata(
        current?.policy ?? {},
        resolvedPolicy.autonomy ?? {},
        options.policy ?? {},
      ),
    ),
    metadata: mergeMetadata(current?.metadata ?? {}, {
      decisionLog: [
        ...asArray(current?.metadata?.decisionLog),
        compactObject({
          id: createId("self-build-loop-decision"),
          type: "start",
          timestamp: startedAt,
          by: options.by ?? "operator",
          source: options.source ?? "self-build-loop-start",
        }),
      ].slice(-50),
    }),
    createdAt: current?.createdAt ?? startedAt,
    updatedAt: startedAt,
    heartbeatAt: startedAt,
    startedAt,
    stoppedAt: null,
  };
  withDatabase(dbPath, (db) => upsertSelfBuildLoopState(db, next));
  await recordSelfBuildDecision(
    {
      loopId: next.id,
      mode: next.mode,
      state: "executed",
      action: "start-loop",
      targetType: "self-build-loop",
      targetId: next.id,
      rationale: "Self-build loop started.",
      policy: next.policy,
      metadata: {
        projectId: next.projectId,
      },
    },
    dbPath,
  );
  const iteration = await runSelfBuildLoopIteration(next, options, dbPath);
  const settledAt = nowIso();
  withDatabase(dbPath, (db) =>
    upsertSelfBuildLoopState(db, {
      ...next,
      status: iteration.action === "idle" ? "idle" : "running",
      updatedAt: settledAt,
      heartbeatAt: settledAt,
      metadata: mergeMetadata(next.metadata ?? {}, {
        lastIteration: iteration,
        decisionLog: [
          ...asArray(next.metadata?.decisionLog),
          compactObject({
            id: createId("self-build-loop-decision"),
            type: "iteration",
            timestamp: settledAt,
            by: options.by ?? "operator",
            source: options.source ?? "self-build-loop-start",
            summary: iteration.action,
          }),
        ].slice(-50),
      }),
    }),
  );
  return getSelfBuildLoopStatus(dbPath);
}

export function stopSelfBuildLoop(
  options: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const current = withDatabase(dbPath, (db) =>
    getSelfBuildLoopState(db, "default"),
  );
  const stoppedAt = nowIso();
  const next = {
    id: "default",
    status: "stopped",
    mode: current?.mode ?? options.mode ?? "supervised",
    projectId: current?.projectId ?? options.projectId ?? "spore",
    policy: mergeMetadata(current?.policy ?? {}, options.policy ?? {}),
    metadata: mergeMetadata(current?.metadata ?? {}, {
      decisionLog: [
        ...asArray(current?.metadata?.decisionLog),
        compactObject({
          id: createId("self-build-loop-decision"),
          type: "stop",
          timestamp: stoppedAt,
          by: options.by ?? "operator",
          source: options.source ?? "self-build-loop-stop",
          rationale: options.reason ?? "",
        }),
      ].slice(-50),
    }),
    createdAt: current?.createdAt ?? stoppedAt,
    updatedAt: stoppedAt,
    heartbeatAt: stoppedAt,
    startedAt: current?.startedAt ?? null,
    stoppedAt,
  };
  withDatabase(dbPath, (db) => upsertSelfBuildLoopState(db, next));
  void recordSelfBuildDecision(
    {
      loopId: next.id,
      mode: next.mode,
      state: "executed",
      action: "stop-loop",
      targetType: "self-build-loop",
      targetId: next.id,
      rationale: options.reason ?? "Self-build loop stopped.",
      policy: next.policy,
    },
    dbPath,
  );
  return getSelfBuildLoopStatus(dbPath);
}

export function getSelfBuildSummary(dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const now = nowIso();
  const groups = listWorkItemGroupsSummary({ limit: 50 }, dbPath);
  const groupItemMap = new Map<string, LooseRecord>(
    groups.flatMap((group) => group.items.map((item) => [item.id, item])),
  );
  const workItems = listManagedWorkItems({ limit: 100 }, dbPath).map(
    (item) => groupItemMap.get(item.id) ?? item,
  );
  const goalPlans = listGoalPlansSummary({ limit: 100 }, dbPath);
  const proposals = withDatabase(dbPath, (db) =>
    listProposalArtifacts(db, null, 100),
  ).map(buildProposalSummary);
  const workspaces = withDatabase(dbPath, (db) =>
    listWorkspaceAllocations(db, { limit: 200 }),
  ).map(buildWorkspaceSummary);
  const learnings = withDatabase(dbPath, (db) =>
    listLearningRecords(db, null, 100),
  ).map(buildLearningSummary);
  const integrationBranches = listIntegrationBranchSummaries(
    { limit: 50 },
    dbPath,
  );
  const loopStatus = getSelfBuildLoopStatus(dbPath);
  const allRuns = workItems.flatMap((item: LooseRecord) =>
    listSelfBuildWorkItemRuns(item.id, { limit: 20 }, dbPath).map((run) => ({
      ...run,
      itemTitle: item.title,
      itemId: item.id,
    })),
  );

  const blockedItems = workItems.filter(
    (item) =>
      item.status === "blocked" ||
      ["blocked", "review_needed"].includes(item.dependencyState?.state),
  );
  const failedItems = workItems.filter((item) => item.status === "failed");
  const waitingReviewProposals = proposals.filter(
    (proposal) => proposal.status === "ready_for_review",
  );
  const waitingApprovalProposals = proposals.filter((proposal) =>
    ["reviewed", "waiting_approval"].includes(proposal.status),
  );
  const promotionPendingProposals = proposals.filter((proposal) =>
    isProposalPromotionPending(proposal),
  );
  const validationRequiredProposals = proposals.filter((proposal) =>
    ["validation_required", "validation_failed"].includes(
      String(proposal.status),
    ),
  );
  const proposalsBlockedForPromotion = proposals.filter(
    (proposal) => String(proposal.status) === "promotion_blocked",
  );
  const orphanedWorkspaces = workspaces.filter((workspace) =>
    ["orphaned", "failed"].includes(workspace.status),
  );
  const activeWorkspaces = workspaces.filter((workspace) =>
    ["provisioned", "active", "settled"].includes(workspace.status),
  );
  const pendingValidationRuns = allRuns.filter(
    (run) =>
      run.status === "completed" &&
      (!run.metadata?.validation ||
        run.metadata.validation.status !== "completed"),
  );
  const validationsPendingExecution = allRuns.filter((run) => {
    const validation = run.metadata?.validation;
    return (
      run.status === "completed" &&
      (!validation ||
        validation.status !== "completed" ||
        validation.validationDrift === true)
    );
  });
  const needsDocFollowUpRuns = allRuns.filter(
    (run) =>
      run.metadata?.docSuggestions && run.metadata.docSuggestions.length > 0,
  );
  const recentLearnings = learnings
    .filter((learning) => learning.status === "active")
    .slice(0, 10);
  const plannerFollowUpPlans = goalPlans.filter(
    (plan) => plan.status === "planned",
  );
  const recentDecisions = listSelfBuildDecisionSummaries({ limit: 20 }, dbPath);
  const activeQuarantines = listSelfBuildQuarantineSummaries(
    { status: "active", limit: 20 },
    dbPath,
  );
  const recentRollbacks = listSelfBuildRollbackSummaries({ limit: 20 }, dbPath);
  const autonomousBlockedDecisions = recentDecisions.filter(
    (decision) => String(decision.state) === "blocked",
  );

  const urgentQueue = [
    ...blockedItems.map((item) =>
      buildAttentionItem({
        id: `attention:${item.id}:blocked`,
        attentionState:
          item.dependencyState?.state === "review_needed"
            ? "needs-review"
            : "blocked",
        targetType: "work-item",
        targetId: item.id,
        itemId: item.id,
        groupId: item.metadata?.groupId ?? null,
        goalPlanId: item.metadata?.goalPlanId ?? null,
        templateId: item.metadata?.templateId ?? null,
        domainId: item.metadata?.domainId ?? null,
        safeMode: item.metadata?.safeMode ?? null,
        mutationScope: item.metadata?.mutationScope ?? [],
        requiresProposal: workItemRequiresWorkspace(item),
        title: item.title,
        reason:
          item.blockedReason ??
          item.dependencyState?.reason ??
          "Work item blocked and requires operator intervention.",
        httpHint: `/work-items/${encodeURIComponent(item.id)}`,
        commandHint: `npm run orchestrator:work-item-show -- --item ${item.id}`,
        blockerIds: item.blockerIds ?? [],
        nextActionHint:
          item.nextActionHint ?? item.dependencyState?.nextActionHint ?? null,
        timestamp: item.updatedAt,
      }),
    ),
    ...failedItems.map((item) =>
      buildAttentionItem({
        id: `attention:${item.id}:failed`,
        attentionState: "blocked",
        targetType: "work-item",
        targetId: item.id,
        itemId: item.id,
        groupId: item.metadata?.groupId ?? null,
        goalPlanId: item.metadata?.goalPlanId ?? null,
        templateId: item.metadata?.templateId ?? null,
        domainId: item.metadata?.domainId ?? null,
        safeMode: item.metadata?.safeMode ?? null,
        mutationScope: item.metadata?.mutationScope ?? [],
        requiresProposal: workItemRequiresWorkspace(item),
        title: item.title,
        reason: "Work item failed and may need recovery or retry.",
        httpHint: `/work-items/${encodeURIComponent(item.id)}`,
        commandHint: `npm run orchestrator:work-item-run -- --item ${item.id}`,
        timestamp: item.updatedAt,
      }),
    ),
    ...waitingReviewProposals.map((proposal) =>
      buildAttentionItem({
        id: `attention:${proposal.id}:review`,
        attentionState: "needs-review",
        targetType: "proposal",
        targetId: proposal.id,
        proposalId: proposal.id,
        itemId: proposal.workItemId ?? null,
        runId: proposal.workItemRunId ?? null,
        title: proposal.summary?.title ?? "Untitled proposal",
        reason: "Proposal ready for operator review.",
        httpHint: `/proposal-artifacts/${encodeURIComponent(proposal.id)}`,
        commandHint: `npm run orchestrator:proposal-show -- --proposal ${proposal.id}`,
        timestamp: proposal.createdAt,
      }),
    ),
    ...waitingApprovalProposals.map((proposal) =>
      buildAttentionItem({
        id: `attention:${proposal.id}:approval`,
        attentionState: "needs-approval",
        targetType: "proposal",
        targetId: proposal.id,
        proposalId: proposal.id,
        itemId: proposal.workItemId ?? null,
        runId: proposal.workItemRunId ?? null,
        title: proposal.summary?.title ?? "Untitled proposal",
        reason: "Proposal reviewed and waiting for approval.",
        httpHint: `/proposal-artifacts/${encodeURIComponent(proposal.id)}`,
        commandHint: `npm run orchestrator:proposal-show -- --proposal ${proposal.id}`,
        timestamp: proposal.reviewedAt ?? proposal.createdAt,
      }),
    ),
    ...promotionPendingProposals.map((proposal) =>
      buildAttentionItem({
        id: `attention:${proposal.id}:promotion`,
        attentionState: "planner-follow-up",
        targetType: "proposal",
        targetId: proposal.id,
        proposalId: proposal.id,
        itemId: proposal.workItemId ?? null,
        runId: proposal.workItemRunId ?? null,
        title: proposal.summary?.title ?? "Untitled proposal",
        reason:
          "Proposal approved but not yet promoted through an integration lane.",
        httpHint: `/proposal-artifacts/${encodeURIComponent(proposal.id)}`,
        commandHint: `npm run orchestrator:proposal-show -- --proposal ${proposal.id}`,
        nextActionHint:
          "Use the promotion planner or explicit coordinator-to-integrator lane when the project family is ready.",
        timestamp:
          proposal.approvedAt ?? proposal.updatedAt ?? proposal.createdAt,
      }),
    ),
    ...validationRequiredProposals.map((proposal) =>
      buildAttentionItem({
        id: `attention:${proposal.id}:validation-required`,
        attentionState: "needs-validation",
        targetType: "proposal",
        targetId: proposal.id,
        proposalId: proposal.id,
        itemId: proposal.workItemId ?? null,
        runId: proposal.workItemRunId ?? null,
        title: proposal.summary?.title ?? "Untitled proposal",
        reason:
          "Proposal approval is not enough for promotion. Validation bundles must pass before promotion can proceed.",
        httpHint: `/proposal-artifacts/${encodeURIComponent(proposal.id)}`,
        commandHint: `npm run orchestrator:proposal-show -- --proposal ${proposal.id}`,
        nextActionHint:
          "Inspect required validation bundles and run validation before planning promotion.",
        timestamp:
          proposal.updatedAt ?? proposal.approvedAt ?? proposal.createdAt,
      }),
    ),
    ...proposalsBlockedForPromotion.map((proposal) =>
      buildAttentionItem({
        id: `attention:${proposal.id}:promotion-blocked`,
        attentionState: "blocked",
        targetType: "proposal",
        targetId: proposal.id,
        proposalId: proposal.id,
        itemId: proposal.workItemId ?? null,
        runId: proposal.workItemRunId ?? null,
        title: proposal.summary?.title ?? "Untitled proposal",
        reason:
          proposal.readiness?.blockers?.join("; ") ??
          "Proposal promotion is blocked by validation, policy, or durable-source requirements.",
        httpHint: `/proposal-artifacts/${encodeURIComponent(proposal.id)}`,
        commandHint: `npm run orchestrator:proposal-review-package -- --proposal ${proposal.id}`,
        nextActionHint:
          "Inspect readiness blockers, rerun validation if needed, or route back through coordinator-led rework.",
        timestamp:
          proposal.updatedAt ?? proposal.approvedAt ?? proposal.createdAt,
      }),
    ),
    ...orphanedWorkspaces.map((workspace) =>
      buildAttentionItem({
        id: `attention:${workspace.id}:workspace`,
        attentionState: "workspace-problem",
        targetType: "workspace",
        targetId: workspace.id,
        workspaceId: workspace.id,
        itemId: workspace.workItemId ?? null,
        runId: workspace.workItemRunId ?? null,
        proposalId: workspace.proposalArtifactId ?? null,
        title: workspace.branchName,
        reason: `Workspace ${workspace.id} is ${workspace.status} and may require cleanup or recovery.`,
        httpHint: `/workspaces/${encodeURIComponent(workspace.id)}`,
        commandHint: `npm run orchestrator:workspace-show -- --workspace ${workspace.id}`,
        nextActionHint:
          "Inspect the workspace and reconcile or remove it if the owner run is already settled.",
        timestamp: workspace.updatedAt,
      }),
    ),
    ...activeQuarantines.map((record) =>
      buildAttentionItem({
        id: `attention:${record.id}:quarantine`,
        kind: "quarantine",
        attentionState: "blocked",
        targetType: record.targetType,
        targetId: record.targetId,
        goalPlanId: record.targetType === "goal-plan" ? record.targetId : null,
        groupId:
          record.targetType === "work-item-group" ? record.targetId : null,
        proposalId: record.targetType === "proposal" ? record.targetId : null,
        title: `Quarantine: ${record.targetType} ${record.targetId}`,
        reason: record.reason || "Self-build target quarantined by policy.",
        httpHint: record.links?.self ?? null,
        commandHint:
          record.targetType === "goal-plan"
            ? `npm run orchestrator:goal-plan-show -- --plan ${record.targetId}`
            : record.targetType === "work-item-group"
              ? `npm run orchestrator:work-item-group-show -- --group ${record.targetId}`
              : record.targetType === "proposal"
                ? `npm run orchestrator:proposal-show -- --proposal ${record.targetId}`
                : record.targetType === "integration-branch"
                  ? `npm run orchestrator:integration-branch-show -- --name ${record.targetId}`
                  : null,
        nextActionHint:
          "Inspect blockers, then release the quarantine explicitly when the target is safe to resume.",
        timestamp: record.updatedAt ?? record.createdAt,
      }),
    ),
  ].sort((left, right) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const leftPriority = priorityOrder[left.priority] ?? 3;
    const rightPriority = priorityOrder[right.priority] ?? 3;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return (
      new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime()
    );
  });

  const followUpQueue = [
    ...pendingValidationRuns.slice(0, 10).map((run) =>
      buildAttentionItem({
        id: `attention:${run.id}:validation`,
        attentionState: "needs-validation",
        targetType: "work-item-run",
        targetId: run.id,
        runId: run.id,
        itemId: run.itemId,
        title: `Validate ${run.itemTitle}`,
        reason: "Work item run completed but validation not yet triggered.",
        httpHint: `/work-item-runs/${encodeURIComponent(run.id)}`,
        commandHint: `npm run orchestrator:work-item-validate -- --run ${run.id}`,
        nextActionHint:
          "Trigger validation to attach durable scenario and regression evidence.",
        timestamp: run.endedAt ?? run.startedAt,
      }),
    ),
    ...integrationBranches
      .filter((branch) =>
        ["blocked", "quarantined", "integration_failed"].includes(
          String(branch.status),
        ),
      )
      .slice(0, 10)
      .map((branch) =>
        buildAttentionItem({
          id: `attention:${branch.name}:integration-branch`,
          attentionState: "blocked",
          targetType: "proposal",
          targetId: branch.proposalId ?? branch.name,
          proposalId: branch.proposalId ?? null,
          runId: branch.workItemRunId ?? null,
          title: branch.name,
          reason:
            branch.reason ??
            `Integration branch ${branch.name} requires operator follow-up.`,
          httpHint: `/integration-branches/${encodeURIComponent(branch.name)}`,
          commandHint: `npm run orchestrator:integration-branch-show -- --name ${branch.name}`,
          nextActionHint:
            "Inspect integration branch state, resolve blockers, or route back through coordinator.",
          timestamp: branch.updatedAt ?? branch.createdAt,
        }),
      ),
    ...needsDocFollowUpRuns.slice(0, 10).map((run) =>
      buildAttentionItem({
        id: `attention:${run.id}:docs`,
        attentionState: "docs-follow-up",
        targetType: "work-item-run",
        targetId: run.id,
        runId: run.id,
        itemId: run.itemId,
        title: `Doc follow-up for ${run.itemTitle}`,
        reason: "Work item run has documentation suggestions.",
        httpHint: `/work-item-runs/${encodeURIComponent(run.id)}/doc-suggestions`,
        commandHint: `npm run orchestrator:work-item-doc-suggestions -- --run ${run.id}`,
        timestamp: run.endedAt ?? run.startedAt,
      }),
    ),
    ...plannerFollowUpPlans.slice(0, 10).map((plan) =>
      buildAttentionItem({
        id: `attention:${plan.id}:planner`,
        attentionState: "planner-follow-up",
        targetType: "goal-plan",
        targetId: plan.id,
        goalPlanId: plan.id,
        title: plan.title,
        reason:
          "Goal plan is still planned and waiting to be materialized into managed work.",
        httpHint: `/goal-plans/${encodeURIComponent(plan.id)}`,
        commandHint: `npm run orchestrator:goal-plan-show -- --plan ${plan.id}`,
        timestamp: plan.updatedAt,
      }),
    ),
    ...autonomousBlockedDecisions.slice(0, 10).map((decision) =>
      buildAttentionItem({
        id: `attention:${decision.id}:autonomy`,
        kind: "autonomous-blocked",
        attentionState: "planner-follow-up",
        targetType: decision.targetType ?? "self-build-loop",
        targetId: decision.targetId ?? decision.id,
        goalPlanId:
          decision.targetType === "goal-plan" ? decision.targetId : null,
        groupId:
          decision.targetType === "work-item-group" ? decision.targetId : null,
        proposalId:
          decision.targetType === "proposal" ? decision.targetId : null,
        title: `Autonomous block: ${decision.action}`,
        reason:
          decision.rationale ||
          "Autonomous policy blocked this self-build action and requires review.",
        httpHint: decision.links?.self ?? "/self-build/decisions",
        commandHint:
          decision.targetType === "goal-plan"
            ? `npm run orchestrator:goal-plan-show -- --plan ${decision.targetId}`
            : decision.targetType === "work-item-group"
              ? `npm run orchestrator:work-item-group-show -- --group ${decision.targetId}`
              : decision.targetType === "proposal"
                ? `npm run orchestrator:proposal-show -- --proposal ${decision.targetId}`
                : null,
        timestamp: decision.createdAt,
      }),
    ),
  ].sort(
    (left, right) =>
      new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime(),
  );

  const attentionItems = [...urgentQueue, ...followUpQueue];
  const attentionSummary = summarizeAttentionItems(attentionItems);
  const queueSummary = buildQueueSummary(urgentQueue, followUpQueue);

  const mostRecentActivity = [
    ...workItems.map((item) => ({
      kind: "work-item",
      timestamp: item.updatedAt,
    })),
    ...groups.map((group) => ({ kind: "group", timestamp: group.updatedAt })),
    ...proposals.map((proposal) => ({
      kind: "proposal",
      timestamp: proposal.updatedAt,
    })),
    ...learnings.map((learning) => ({
      kind: "learning",
      timestamp: learning.updatedAt,
    })),
    ...goalPlans.map((plan) => ({
      kind: "goal-plan",
      timestamp: plan.updatedAt,
    })),
  ].sort(
    (left, right) =>
      new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime(),
  )[0];

  return {
    overview: {
      totalWorkItems: workItems.length,
      totalGroups: groups.length,
      totalProposals: proposals.length,
      totalWorkspaces: workspaces.length,
      totalGoalPlans: goalPlans.length,
      urgentCount: urgentQueue.length,
      followUpCount: followUpQueue.length,
      lastActivity: mostRecentActivity?.timestamp ?? null,
      generatedAt: now,
    },
    counts: {
      workItems: workItems.length,
      groups: groups.length,
      blockedItems: blockedItems.length,
      failedItems: failedItems.length,
      proposals: proposals.length,
      workspaces: workspaces.length,
      orphanedWorkspaces: orphanedWorkspaces.length,
      activeWorkspaces: activeWorkspaces.length,
      waitingReviewProposals: waitingReviewProposals.length,
      waitingApprovalProposals: waitingApprovalProposals.length,
      validationRequiredProposals: validationRequiredProposals.length,
      proposalsBlockedForPromotion: proposalsBlockedForPromotion.length,
      pendingValidationRuns: pendingValidationRuns.length,
      validationsPendingExecution: validationsPendingExecution.length,
      learningRecords: learnings.length,
      goalPlans: goalPlans.length,
      plannedGoalPlans: plannerFollowUpPlans.length,
      integrationBranches: integrationBranches.length,
      activeQuarantines: activeQuarantines.length,
      recentRollbacks: recentRollbacks.length,
      autonomousBlockedDecisions: autonomousBlockedDecisions.length,
    },
    queueSummary,
    attentionSummary,
    urgentWork: urgentQueue.slice(0, 20),
    followUpWork: followUpQueue.slice(0, 20),
    workItems,
    groups,
    goalPlans,
    blockedItems,
    failedItems,
    proposals,
    validationRequiredProposals,
    proposalsBlockedForPromotion,
    workspaces: workspaces.slice(0, 50),
    orphanedWorkspaces,
    waitingReviewProposals,
    waitingApprovalProposals,
    integrationBranches,
    loopStatus,
    recentDecisions,
    activeQuarantines,
    recentRollbacks,
    learningRecords: recentLearnings,
    freshness: {
      lastRefresh: now,
      staleAfter: new Date(Date.now() + 60000).toISOString(),
      cacheHint:
        "client should poll every 30-60 seconds for live operator dashboards",
    },
    displayMetadata: {
      urgentLabel:
        urgentQueue.length === 0
          ? "No urgent work"
          : `${urgentQueue.length} urgent ${urgentQueue.length === 1 ? "item" : "items"}`,
      followUpLabel:
        followUpQueue.length === 0
          ? "No follow-up needed"
          : `${followUpQueue.length} follow-up ${followUpQueue.length === 1 ? "item" : "items"}`,
      statusBadge: urgentQueue.length > 0 ? "needs-attention" : "healthy",
    },
    recommendations: urgentQueue.slice(0, 5).map((item) => ({
      action:
        item.kind === "blocked-work-item" || item.kind === "failed-work-item"
          ? "inspect-work-item"
          : item.kind === "quarantine"
            ? "release-quarantine"
            : item.kind === "orphaned-workspace"
              ? "inspect-workspace"
              : item.targetType === "goal-plan"
                ? "review-goal-plan"
                : "review-proposal",
      targetType:
        item.targetType ??
        (item.itemId
          ? "work-item"
          : item.workspaceId
            ? "workspace"
            : "proposal"),
      targetId:
        item.targetId ?? item.itemId ?? item.workspaceId ?? item.proposalId,
      priority: item.priority,
      reason: item.reason,
      expectedOutcome:
        item.kind === "quarantine"
          ? "Operator releases or keeps quarantine after reviewing blocked autonomous work."
          : item.kind === "waiting-review"
            ? "Operator reviews proposal and provides feedback or approval"
            : item.kind === "waiting-approval"
              ? "Operator approves or rejects proposal"
              : item.kind === "orphaned-workspace"
                ? "Operator reconciles or cleans up a workspace that no longer matches a healthy owner run."
                : "Operator investigates work item status and decides next action",
      commandHint: item.itemId
        ? `npm run orchestrator:work-item-show -- --item ${item.itemId}`
        : item.workspaceId
          ? `npm run orchestrator:workspace-show -- --workspace ${item.workspaceId}`
          : `npm run orchestrator:proposal-show -- --proposal ${item.proposalId}`,
      httpHint: item.httpHint,
    })),
    alerts: attentionItems
      .filter((item) => item.queueType === "urgent")
      .slice(0, 10),
    attentionItems,
  };
}

export function getSelfBuildDashboard(
  options: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const base = getSelfBuildSummary(dbPath);
  const filters = compactObject({
    status: toText(options.status, ""),
    group: toText(options.group, ""),
    template: toText(options.template, ""),
    domain: toText(options.domain, ""),
  });
  const workItems = base.workItems.filter((item) => {
    if (
      filters.status &&
      String(item.status ?? item.dependencyState?.state ?? "").trim() !==
        filters.status
    )
      return false;
    if (
      filters.group &&
      String(item.metadata?.groupId ?? "").trim() !== filters.group
    )
      return false;
    if (
      filters.template &&
      String(item.metadata?.templateId ?? "").trim() !== filters.template
    )
      return false;
    if (
      filters.domain &&
      String(item.metadata?.domainId ?? "").trim() !== filters.domain
    )
      return false;
    return true;
  });
  const workItemIds = new Set(workItems.map((item) => item.id));
  const groups = base.groups.filter(
    (group) =>
      !filters.group ||
      group.id === filters.group ||
      group.items.some((item) => workItemIds.has(item.id)),
  );
  const proposals = base.proposals.filter(
    (proposal) =>
      !proposal.workItemId ||
      workItemIds.size === 0 ||
      workItemIds.has(proposal.workItemId),
  );
  const validationRequiredProposals = base.validationRequiredProposals.filter(
    (proposal) =>
      !proposal.workItemId ||
      workItemIds.size === 0 ||
      workItemIds.has(proposal.workItemId),
  );
  const proposalsBlockedForPromotion = base.proposalsBlockedForPromotion.filter(
    (proposal) =>
      !proposal.workItemId ||
      workItemIds.size === 0 ||
      workItemIds.has(proposal.workItemId),
  );
  const workspaces = base.workspaces.filter(
    (workspace) =>
      !workspace.workItemId ||
      workItemIds.size === 0 ||
      workItemIds.has(workspace.workItemId),
  );
  const recentRuns = workItems
    .flatMap((item) =>
      listSelfBuildWorkItemRuns(item.id, { limit: 5 }, dbPath).map((run) => ({
        ...run,
        itemTitle: item.title,
        templateId: item.metadata?.templateId ?? null,
        domainId: item.metadata?.domainId ?? null,
        safeMode: item.metadata?.safeMode ?? null,
      })),
    )
    .sort(
      (left, right) =>
        new Date(right.startedAt ?? right.createdAt ?? 0).getTime() -
        new Date(left.startedAt ?? left.createdAt ?? 0).getTime(),
    )
    .slice(0, 20);
  const filteredAttentionItems = base.attentionItems.filter((item) => {
    if (filters.group && item.groupId && item.groupId !== filters.group)
      return false;
    if (
      filters.template &&
      item.templateId &&
      item.templateId !== filters.template
    )
      return false;
    if (filters.domain && item.domainId && item.domainId !== filters.domain)
      return false;
    return true;
  });
  const urgentWork = filteredAttentionItems.filter(
    (item) => item.queueType === "urgent",
  );
  const followUpWork = filteredAttentionItems.filter(
    (item) => item.queueType !== "urgent",
  );
  return {
    ...base,
    route: {
      self: "/self-build/dashboard",
    },
    filtersApplied: filters,
    overview: {
      ...base.overview,
      filteredWorkItems: workItems.length,
      filteredGroups: groups.length,
      filteredProposals: proposals.length,
      filteredWorkspaces: workspaces.length,
    },
    queueSummary: buildQueueSummary(urgentWork, followUpWork),
    attentionSummary: summarizeAttentionItems(filteredAttentionItems),
    urgentWork,
    followUpWork,
    workItems,
    groups,
    proposals,
    validationRequiredProposals,
    proposalsBlockedForPromotion,
    workspaces,
    integrationBranches: base.integrationBranches,
    loopStatus: base.loopStatus,
    recentDecisions: base.recentDecisions,
    activeQuarantines: base.activeQuarantines,
    recentRollbacks: base.recentRollbacks,
    recentWorkItemRuns: recentRuns,
    dashboardSections: {
      overview: true,
      queues: true,
      groupReadiness: true,
      recentRuns: true,
      workspaces: true,
      proposals: true,
      learnings: true,
      integration: true,
      loop: true,
      autonomy: true,
    },
  };
}
