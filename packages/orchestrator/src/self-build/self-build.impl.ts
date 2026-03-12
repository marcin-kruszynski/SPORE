// biome-ignore-all lint/suspicious/noExplicitAny: self-build surfaces intentionally aggregate heterogeneous proposal, workspace, learning, and queue payloads.
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
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
  findActiveSelfBuildOverrideRecord,
  findDocSuggestionRecordByRunAndKind,
  getDocSuggestionRecord,
  getGoalPlan,
  getIntegrationBranch,
  getPolicyRecommendationReviewByRecommendationId,
  getProposalArtifact,
  getProposalArtifactByRunId,
  getQuarantineRecord,
  getSelfBuildIntakeRecord,
  getSelfBuildLoopState,
  getSelfBuildOverrideRecord,
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
  insertSelfBuildOverrideRecord,
  insertWorkItemGroup,
  insertWorkspaceAllocation,
  listDocSuggestionRecords,
  listGoalPlans,
  listIntegrationBranches,
  listLearningRecords,
  listPolicyRecommendationReviews,
  listProposalArtifacts,
  listQuarantineRecords,
  listRollbackRecords,
  listSelfBuildDecisions,
  listSelfBuildIntakeRecords,
  listSelfBuildLoopStates,
  listSelfBuildOverrideRecords,
  listWorkItemGroups,
  listWorkItemRuns,
  listWorkspaceAllocations,
  openOrchestratorDatabase,
  updateDocSuggestionRecord,
  updateGoalPlan,
  updateProposalArtifact,
  updateQuarantineRecord,
  updateSelfBuildIntakeRecord,
  updateSelfBuildOverrideRecord,
  updateWorkItem,
  updateWorkItemGroup,
  updateWorkItemRun,
  updateWorkspaceAllocation,
  upsertDocSuggestionRecord,
  upsertIntegrationBranch,
  upsertPolicyRecommendationReview,
  upsertSelfBuildIntakeRecord,
  upsertSelfBuildLoopState,
} from "../store/execution-store.js";
import type {
  DocSuggestionRecordListOptions,
  PolicyRecommendationReviewListOptions,
  QuarantineRecordListOptions,
  RollbackRecordListOptions,
  SelfBuildDecisionListOptions,
  SelfBuildIntakeListOptions,
  SelfBuildOverrideListOptions,
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
const activeValidationTasks = new Map<string, Promise<void>>();
const SUCCESSFUL_PROPOSAL_SOURCE_RUN_STATUSES = new Set([
  "completed",
  "waiting_review",
  "waiting_approval",
]);

type RolloutTierConfig = {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  allowedTemplates: string[];
  allowedDomains: string[];
  allowedMutationScopes: string[];
  targetPaths: string[];
  protectedScopes: string[];
  requireSafeMode: boolean;
  autoPromoteToIntegration: boolean;
  requiredValidationBundles: string[];
};
type IntakePriorityPolicy = {
  learningFailure: number;
  learningSuccess: number;
  docSuggestionPending: number;
  docSuggestionAccepted: number;
  integrationIssue: number;
  policyRecommendation: number;
  highSeverityBonus: number;
  acceptedBonus: number;
  blockedBonus: number;
  promotionBlockedBonus: number;
  quarantineBonus: number;
};
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
  rolloutTiers: RolloutTierConfig[];
  intakePriorityPolicy: IntakePriorityPolicy;
};
type AggregatedPackPolicy = {
  autonomousEligible: boolean;
  allowedTemplates: string[];
  allowedMutationScopes: string[];
  requiredValidationBundles: string[];
  quarantineOnFailureCount: unknown;
  quarantineOnBlockedCount: unknown;
  protectedScopes: string[];
  rolloutTiers: LooseRecord[];
  intakePriorityPolicy: LooseRecord;
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

function stablePolicyRecommendationId(kind, sourceId) {
  return `policy-rec:${toText(kind, "unknown")}:${toText(sourceId, "unknown")}`;
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

function readYamlFileSync(filePath) {
  return parseYaml(readFileSync(filePath, "utf8"));
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

function loadProjectConfigSync(projectRef = "spore") {
  const resolvedPath = resolveProjectPath(projectRef);
  const config = readYamlFileSync(resolvedPath);
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

function loadPolicyPackConfigSync(packId) {
  const resolvedPath = path.join(
    PROJECT_ROOT,
    "config/policy-packs",
    `${packId}.yaml`,
  );
  const config = readYamlFileSync(resolvedPath);
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

function matchesPathPrefix(candidate = "", prefixes: string[] = []) {
  const normalizedCandidate = toText(candidate, "");
  if (!normalizedCandidate) {
    return false;
  }
  return prefixes.some((prefix) => {
    const normalizedPrefix = toText(prefix, "");
    return (
      normalizedPrefix &&
      (normalizedCandidate === normalizedPrefix ||
        normalizedCandidate.startsWith(`${normalizedPrefix}/`))
    );
  });
}

function normalizeRolloutTier(
  tier: LooseRecord = {},
  index = 0,
): RolloutTierConfig {
  return {
    id: toText(tier.id, `tier-${index + 1}`),
    label: toText(tier.label, `Tier ${index + 1}`),
    description: toText(tier.description, ""),
    enabled: coerceBoolean(tier.enabled, true),
    allowedTemplates: dedupe(tier.allowedTemplates ?? []),
    allowedDomains: dedupe(tier.allowedDomains ?? []),
    allowedMutationScopes: dedupe(tier.allowedMutationScopes ?? []),
    targetPaths: dedupe(tier.targetPaths ?? []),
    protectedScopes: dedupe(tier.protectedScopes ?? []),
    requireSafeMode: coerceBoolean(tier.requireSafeMode, true),
    autoPromoteToIntegration: coerceBoolean(
      tier.autoPromoteToIntegration,
      false,
    ),
    requiredValidationBundles: dedupe(tier.requiredValidationBundles ?? []),
  };
}

function normalizeIntakePriorityPolicy(
  policy: LooseRecord = {},
): IntakePriorityPolicy {
  const asNumber = (value: unknown, fallback: number) =>
    Number.isFinite(Number(value)) ? Number(value) : fallback;
  return {
    learningFailure: asNumber(policy.learningFailure, 90),
    learningSuccess: asNumber(policy.learningSuccess, 40),
    docSuggestionPending: asNumber(policy.docSuggestionPending, 50),
    docSuggestionAccepted: asNumber(policy.docSuggestionAccepted, 80),
    integrationIssue: asNumber(policy.integrationIssue, 100),
    policyRecommendation: asNumber(policy.policyRecommendation, 95),
    highSeverityBonus: asNumber(policy.highSeverityBonus, 10),
    acceptedBonus: asNumber(policy.acceptedBonus, 5),
    blockedBonus: asNumber(policy.blockedBonus, 10),
    promotionBlockedBonus: asNumber(policy.promotionBlockedBonus, 12),
    quarantineBonus: asNumber(policy.quarantineBonus, 15),
  };
}

function resolveRecommendationTaskClass(
  templateId = "",
  domainId = "",
  mutationScope: string[] = [],
) {
  const scopes = dedupe(mutationScope);
  if (templateId === "runtime-validation-pass") {
    return "runtime-validation";
  }
  if (
    templateId === "operator-ui-pass" ||
    scopes.some((scope) => matchesPathPrefix(scope, ["apps/web"]))
  ) {
    return "operator-surface";
  }
  if (
    templateId === "config-schema-maintenance" ||
    scopes.some((scope) => matchesPathPrefix(scope, ["config", "schemas"]))
  ) {
    return "config-hardening";
  }
  if (
    templateId === "docs-maintenance-pass" ||
    domainId === "docs" ||
    scopes.some((scope) => matchesPathPrefix(scope, ["docs", "runbooks"]))
  ) {
    return "documentation";
  }
  return "general-self-work";
}

function resolveRecommendationTargetPaths(mutationScope: string[] = []) {
  return dedupe(mutationScope).sort((left, right) =>
    String(left).localeCompare(String(right)),
  );
}

function buildAutonomyTargetContext(
  target: LooseRecord = {},
  fallback: LooseRecord = {},
) {
  const mutationScope = dedupe(
    target.mutationScope ??
      target.metadata?.mutationScope ??
      target.summary?.mutationScope ??
      fallback.mutationScope ??
      [],
  );
  const targetPaths = dedupe(
    target.targetPaths ??
      target.metadata?.targetPaths ??
      target.summary?.targetPaths ??
      resolveRecommendationTargetPaths(mutationScope),
  );
  return {
    templateId: toText(
      target.templateId ?? target.metadata?.templateId,
      toText(fallback.templateId, ""),
    ),
    domainId: toText(
      target.domainId ?? target.metadata?.domainId,
      toText(fallback.domainId, ""),
    ),
    mutationScope,
    targetPaths,
    safeMode:
      target.safeMode ?? target.metadata?.safeMode ?? fallback.safeMode ?? true,
    taskClass: toText(
      target.taskClass ?? target.metadata?.taskClass,
      resolveRecommendationTaskClass(
        target.templateId ?? target.metadata?.templateId ?? fallback.templateId,
        target.domainId ?? target.metadata?.domainId ?? fallback.domainId,
        mutationScope,
      ),
    ),
  };
}

function findMatchingRolloutTiers(
  target: LooseRecord = {},
  policy: AutonomousPolicyConfig = normalizeAutonomousPolicy({}),
) {
  if (!Array.isArray(policy.rolloutTiers) || policy.rolloutTiers.length === 0) {
    return [];
  }
  const context = buildAutonomyTargetContext(target);
  return policy.rolloutTiers.filter((tier) => {
    if (tier.enabled === false) {
      return false;
    }
    if (tier.requireSafeMode === true && context.safeMode === false) {
      return false;
    }
    if (
      tier.allowedTemplates.length > 0 &&
      context.templateId &&
      !tier.allowedTemplates.includes(context.templateId)
    ) {
      return false;
    }
    if (
      tier.allowedDomains.length > 0 &&
      context.domainId &&
      !tier.allowedDomains.includes(context.domainId)
    ) {
      return false;
    }
    if (
      tier.allowedMutationScopes.length > 0 &&
      context.mutationScope.some(
        (scope) =>
          !tier.allowedMutationScopes.some((allowed) =>
            matchesPathPrefix(scope, [allowed]),
          ),
      )
    ) {
      return false;
    }
    if (
      tier.targetPaths.length > 0 &&
      context.targetPaths.length > 0 &&
      context.targetPaths.some(
        (targetPath) => !matchesPathPrefix(targetPath, tier.targetPaths),
      )
    ) {
      return false;
    }
    return true;
  });
}

function evaluateProtectedScopeGuardrails(
  target: LooseRecord = {},
  policy: AutonomousPolicyConfig = normalizeAutonomousPolicy({}),
) {
  const context = buildAutonomyTargetContext(target);
  const protectedScopes = dedupe([
    ...(policy.protectedScopes ?? []),
    ...policy.rolloutTiers.flatMap((tier) => tier.protectedScopes ?? []),
  ]);
  const blocked = dedupe(
    [...context.mutationScope, ...context.targetPaths].filter((entry) =>
      matchesPathPrefix(entry, protectedScopes),
    ),
  );
  return {
    blocked,
    blockedReason:
      blocked.length > 0
        ? `protected scopes present: ${blocked.join(", ")}`
        : "",
  };
}

function priorityLabel(priority = 0) {
  if (priority >= 95) return "critical";
  if (priority >= 80) return "high";
  if (priority >= 55) return "medium";
  return "low";
}

function scoreSelfBuildIntakeCandidate(
  candidate: LooseRecord = {},
  policy: AutonomousPolicyConfig = normalizeAutonomousPolicy({}),
) {
  const rules = policy.intakePriorityPolicy;
  let score = 0;
  const reasons: string[] = [];
  if (candidate.sourceType === "learning-record") {
    const learningKind = toText(candidate.metadata?.sourceKind, "");
    if (learningKind === "failure-pattern") {
      score += rules.learningFailure;
      reasons.push("failure-pattern learning");
    } else {
      score += rules.learningSuccess;
      reasons.push("success-pattern learning");
    }
  } else if (candidate.sourceType === "doc-suggestion") {
    if (candidate.status === "accepted") {
      score += rules.docSuggestionAccepted;
      reasons.push("accepted doc suggestion");
    } else {
      score += rules.docSuggestionPending;
      reasons.push("pending doc suggestion");
    }
  } else if (candidate.sourceType === "integration-branch") {
    score += rules.integrationIssue;
    reasons.push("integration branch issue");
  } else if (candidate.sourceType === "policy-recommendation") {
    score += rules.policyRecommendation;
    reasons.push("policy recommendation");
  }
  if (candidate.status === "accepted") {
    score += rules.acceptedBonus;
    reasons.push("accepted status");
  }
  const diagnosticsIssues = asArray(candidate.metadata?.diagnostics?.issues);
  if (
    diagnosticsIssues.some((issue) =>
      ["high", "critical"].includes(String(issue?.severity ?? "")),
    )
  ) {
    score += rules.highSeverityBonus;
    reasons.push("high severity issue");
  }
  if (candidate.metadata?.quarantine?.status === "active") {
    score += rules.quarantineBonus;
    reasons.push("active quarantine");
  }
  if (
    String(candidate.metadata?.proposalStatus ?? "") === "promotion_blocked"
  ) {
    score += rules.promotionBlockedBonus;
    reasons.push("promotion blocked");
  }
  if (
    ["blocked", "integration_failed", "quarantined"].includes(
      String(candidate.metadata?.branchStatus ?? ""),
    )
  ) {
    score += rules.blockedBonus;
    reasons.push("blocked branch");
  }
  return {
    score,
    label: priorityLabel(score),
    reason: reasons.join("; ") || "default priority",
  };
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
    rolloutTiers: asArray(policy.rolloutTiers).map((tier, index) =>
      normalizeRolloutTier(tier, index),
    ),
    intakePriorityPolicy: normalizeIntakePriorityPolicy(
      policy.intakePriorityPolicy,
    ),
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
        protectedScopes: dedupe([
          ...asArray(accumulator.protectedScopes),
          ...asStringArray(selfWorkPolicy.protectedScopes),
        ]),
        rolloutTiers: [
          ...asArray(accumulator.rolloutTiers),
          ...asArray(selfWorkPolicy.rolloutTiers),
        ],
        intakePriorityPolicy: mergeMetadata(
          accumulator.intakePriorityPolicy ?? {},
          asJsonObject(selfWorkPolicy.intakePriorityPolicy),
        ),
      };
    },
    {
      autonomousEligible: false,
      allowedTemplates: [],
      allowedMutationScopes: [],
      requiredValidationBundles: [],
      quarantineOnFailureCount: null,
      quarantineOnBlockedCount: null,
      protectedScopes: [],
      rolloutTiers: [],
      intakePriorityPolicy: {},
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
    protectedScopes: dedupe([
      ...asArray(aggregatedPackPolicy.protectedScopes),
      ...asStringArray(defaultAutonomousPolicy.protectedScopes),
    ]),
    rolloutTiers: [
      ...asArray(aggregatedPackPolicy.rolloutTiers),
      ...asArray(defaultAutonomousPolicy.rolloutTiers),
    ],
    intakePriorityPolicy: mergeMetadata(
      aggregatedPackPolicy.intakePriorityPolicy ?? {},
      asJsonObject(defaultAutonomousPolicy.intakePriorityPolicy),
    ),
    ...defaultAutonomousPolicy,
  });
  return {
    project,
    projectConfig,
    policyPackIds,
    autonomy,
  };
}

function loadProjectSelfBuildPolicySync(projectRef = "spore") {
  const project = loadProjectConfigSync(projectRef);
  const projectConfig = asJsonObject(project.config);
  const policyPackIds = dedupe(projectConfig.policyPacks ?? []);
  const packConfigs = policyPackIds.flatMap((packId) => {
    try {
      return [loadPolicyPackConfigSync(packId)];
    } catch {
      return [];
    }
  });
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
        protectedScopes: dedupe([
          ...asArray(accumulator.protectedScopes),
          ...asStringArray(selfWorkPolicy.protectedScopes),
        ]),
        rolloutTiers: [
          ...asArray(accumulator.rolloutTiers),
          ...asArray(selfWorkPolicy.rolloutTiers),
        ],
        intakePriorityPolicy: mergeMetadata(
          accumulator.intakePriorityPolicy ?? {},
          asJsonObject(selfWorkPolicy.intakePriorityPolicy),
        ),
      };
    },
    {
      autonomousEligible: false,
      allowedTemplates: [],
      allowedMutationScopes: [],
      requiredValidationBundles: [],
      quarantineOnFailureCount: null,
      quarantineOnBlockedCount: null,
      protectedScopes: [],
      rolloutTiers: [],
      intakePriorityPolicy: {},
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
    protectedScopes: dedupe([
      ...asArray(aggregatedPackPolicy.protectedScopes),
      ...asStringArray(defaultAutonomousPolicy.protectedScopes),
    ]),
    rolloutTiers: [
      ...asArray(aggregatedPackPolicy.rolloutTiers),
      ...asArray(defaultAutonomousPolicy.rolloutTiers),
    ],
    intakePriorityPolicy: mergeMetadata(
      aggregatedPackPolicy.intakePriorityPolicy ?? {},
      asJsonObject(defaultAutonomousPolicy.intakePriorityPolicy),
    ),
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

function resolveValidationBundleSelection(
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
    return {
      bundleIds: explicit,
      source: "explicit-request",
      reasons: [
        `Requested explicitly: ${explicit.join(", ")}.`,
        "Operator-selected bundles override stored validation defaults.",
      ],
    };
  }
  const metadata = item?.metadata ?? {};
  const fromRun = dedupe(run?.metadata?.validationBundleIds ?? []);
  if (fromRun.length > 0) {
    return {
      bundleIds: fromRun,
      source: "run-metadata",
      reasons: [
        `Using bundles already attached to work-item run ${run?.id ?? "unknown"}.`,
      ],
    };
  }
  const fromItem = dedupe(
    metadata.validationBundleIds ??
      metadata.recommendedValidationBundles ??
      metadata.recommendedValidationBundle ??
      [],
  );
  if (fromItem.length > 0) {
    return {
      bundleIds: fromItem,
      source: "work-item-metadata",
      reasons: [
        `Using validation bundles recommended by work item ${item?.id ?? "unknown"}.`,
      ],
    };
  }
  return {
    bundleIds: [],
    source: "fallback",
    reasons: [
      "No named validation bundle was configured, so validation falls back to the work item's scenario and regression recommendations.",
    ],
  };
}

function buildValidationError(kind, id, message) {
  return compactObject({
    kind,
    id: id ?? null,
    message: toText(message, "validation failed"),
  });
}

function resolveValidationTarget(run, proposal) {
  if (proposal?.id) {
    return {
      targetType: "proposal",
      targetId: String(proposal.id),
    };
  }
  return {
    targetType: "work-item-run",
    targetId: String(run?.id ?? ""),
  };
}

function primaryValidationBundleId(
  bundleIds: string[] = [],
  fallbackScenarioIds: string[] = [],
  fallbackRegressionIds: string[] = [],
) {
  if (bundleIds.length > 0) {
    return bundleIds[0];
  }
  if (fallbackScenarioIds.length > 0 || fallbackRegressionIds.length > 0) {
    return "__fallback__";
  }
  return "__fallback__";
}

function buildValidationState(run, proposal, options: LooseRecord = {}) {
  const previous =
    proposal?.metadata?.validation ?? run?.metadata?.validation ?? {};
  const bundleIds = dedupe(options.bundleIds ?? previous.bundleIds ?? []);
  const bundleId =
    options.bundleId ??
    primaryValidationBundleId(
      bundleIds,
      dedupe(options.fallbackScenarioIds ?? []),
      dedupe(options.fallbackRegressionIds ?? []),
    );
  const target = resolveValidationTarget(run, proposal);
  return {
    ...(previous && typeof previous === "object" ? previous : {}),
    id: toText(previous.id, createId("validation")),
    targetType: target.targetType,
    targetId: target.targetId,
    bundleId,
    bundleIds,
    status: options.status ?? previous.status ?? "queued",
    scenarioRunIds: dedupe(
      options.scenarioRunIds ?? previous.scenarioRunIds ?? [],
    ),
    regressionRunIds: dedupe(
      options.regressionRunIds ?? previous.regressionRunIds ?? [],
    ),
    startedAt:
      options.startedAt !== undefined
        ? options.startedAt
        : (previous.startedAt ?? null),
    endedAt:
      options.endedAt !== undefined
        ? options.endedAt
        : (previous.endedAt ?? null),
    error: options.error ?? previous.error ?? null,
    errors: asArray(options.errors ?? previous.errors ?? []),
    bundleResults: asArray(
      options.bundleResults ?? previous.bundleResults ?? [],
    ),
    validatedAt:
      options.validatedAt !== undefined
        ? options.validatedAt
        : (previous.validatedAt ?? null),
    validationFingerprint:
      options.validationFingerprint !== undefined
        ? options.validationFingerprint
        : (previous.validationFingerprint ?? null),
    validationDrift:
      options.validationDrift !== undefined
        ? options.validationDrift
        : previous.validationDrift === true,
  };
}

function persistValidationStateForRun(runId, state, dbPath) {
  return withDatabase(dbPath, (db) => {
    const run = getWorkItemRun(db, runId);
    if (!run) {
      return { run: null, proposal: null };
    }
    const updatedRun = {
      ...run,
      metadata: {
        ...run.metadata,
        validationBundleIds: dedupe(state.bundleIds ?? []).filter(
          (bundleId) => bundleId !== "__fallback__",
        ),
        validation: state,
      },
    };
    updateWorkItemRun(db, updatedRun);
    const proposal = getProposalArtifactByRunId(db, runId);
    if (!proposal) {
      return { run: updatedRun, proposal: null };
    }
    const updatedProposal = {
      ...proposal,
      updatedAt: nowIso(),
      metadata: {
        ...proposal.metadata,
        validation: state,
      },
    };
    updateProposalArtifact(db, updatedProposal);
    return {
      run: updatedRun,
      proposal: updatedProposal,
    };
  });
}

function loadWorkItemRunValidationContext(
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
  const proposal = withDatabase(dbPath, (db) =>
    getProposalArtifactByRunId(db, runId),
  );
  const selection = resolveValidationBundleSelection(item, run, options);
  const fallbackScenarioIds = dedupe(
    item.metadata?.recommendedScenarios ?? item.relatedScenarios ?? [],
  );
  const fallbackRegressionIds = dedupe(
    item.metadata?.recommendedRegressions ?? item.relatedRegressions ?? [],
  );
  return {
    run,
    item,
    proposal,
    bundleIds: selection.bundleIds,
    selection,
    fallbackScenarioIds,
    fallbackRegressionIds,
    currentValidation:
      proposal?.metadata?.validation ?? run.metadata?.validation ?? null,
  };
}

function buildQueuedValidationState(context, options: LooseRecord = {}) {
  return buildValidationState(context.run, context.proposal, {
    bundleIds: context.bundleIds,
    fallbackScenarioIds: context.fallbackScenarioIds,
    fallbackRegressionIds: context.fallbackRegressionIds,
    status: "queued",
    scenarioRunIds: [],
    regressionRunIds: [],
    startedAt: null,
    endedAt: null,
    error: null,
    errors: [],
    bundleResults: [],
    validatedAt: null,
    validationFingerprint:
      options.validationFingerprint ??
      context.currentValidation?.validationFingerprint ??
      null,
    validationDrift: options.validationDrift ?? false,
  });
}

function getActiveValidationTask(runId) {
  return activeValidationTasks.get(runId) ?? null;
}

function ensureWorkItemRunValidationTask(
  context,
  options: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const existing = getActiveValidationTask(context.run.id);
  if (existing) {
    return existing;
  }
  return scheduleWorkItemRunValidation(
    context.run.id,
    context.bundleIds,
    context.fallbackScenarioIds,
    context.fallbackRegressionIds,
    options,
    dbPath,
  );
}

async function executeWorkItemRunValidation(
  runId,
  bundleIds: string[],
  fallbackScenarioIds: string[],
  fallbackRegressionIds: string[],
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
  const proposal = withDatabase(dbPath, (db) =>
    getProposalArtifactByRunId(db, runId),
  );
  const startedAt = nowIso();
  const runningState = buildValidationState(run, proposal, {
    bundleIds,
    fallbackScenarioIds,
    fallbackRegressionIds,
    status: "running",
    startedAt,
    endedAt: null,
    error: null,
    errors: [],
    scenarioRunIds: [],
    regressionRunIds: [],
    bundleResults: [],
    validatedAt: null,
  });
  persistValidationStateForRun(runId, runningState, dbPath);

  const bundleResults = [];
  let scenarioRuns = [];
  let regressionRuns = [];
  let validationErrors = [];
  const effectiveBundleIds =
    bundleIds.length > 0
      ? bundleIds
      : [
          primaryValidationBundleId(
            [],
            fallbackScenarioIds,
            fallbackRegressionIds,
          ),
        ];

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
      const error = buildValidationError(
        "validation-bundle",
        bundleId,
        `validation bundle not found: ${bundleId}`,
      );
      bundleResults.push(
        summarizeValidationBundleRecord(bundleId, null, {
          status: "failed",
          errors: [error],
        }),
      );
      validationErrors.push(error);
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
        localErrors.push(
          buildValidationError(
            "scenario",
            scenarioId,
            error instanceof Error ? error.message : String(error),
          ),
        );
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
        localErrors.push(
          buildValidationError(
            "regression",
            regressionId,
            error instanceof Error ? error.message : String(error),
          ),
        );
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

  const endedAt = nowIso();
  const completedState = buildValidationState(run, proposal, {
    bundleIds,
    fallbackScenarioIds,
    fallbackRegressionIds,
    status:
      validationErrors.length > 0
        ? "failed"
        : regressionRuns.length === 0 && scenarioRuns.length === 0
          ? "completed"
          : "completed",
    scenarioRunIds: dedupe(scenarioRuns),
    regressionRunIds: dedupe(regressionRuns),
    errors: validationErrors,
    error: validationErrors[0] ?? null,
    bundleResults,
    startedAt: runningState.startedAt ?? startedAt,
    endedAt,
    validatedAt: endedAt,
  });
  const currentFingerprint = proposal
    ? computeProposalContentFingerprint(proposal)
    : null;
  completedState.validationFingerprint = currentFingerprint;
  completedState.validationDrift = false;

  const persisted = persistValidationStateForRun(runId, completedState, dbPath);
  const updatedRun = persisted.run;
  const refreshedProposal = withDatabase(dbPath, (db) =>
    getProposalArtifactByRunId(db, runId),
  );
  if (updatedRun) {
    const nextRun = {
      ...updatedRun,
      metadata: {
        ...updatedRun.metadata,
        docSuggestions: buildDocSuggestionsHelper(
          item,
          updatedRun,
          refreshedProposal,
        ),
      },
    };
    withDatabase(dbPath, (db) => updateWorkItemRun(db, nextRun));
  }
  if (proposal && refreshedProposal) {
    const validationStatus = buildProposalValidationStatus({
      ...refreshedProposal,
      metadata: {
        ...refreshedProposal.metadata,
        validation: completedState,
      },
    });
    const nextStatus =
      completedState.status === "failed"
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
          : completedState.status === "completed"
            ? "reviewed"
            : proposal.status;
    withDatabase(dbPath, (db) =>
      updateProposalArtifact(db, {
        ...refreshedProposal,
        status: nextStatus,
        updatedAt: nowIso(),
        metadata: {
          ...refreshedProposal.metadata,
          validation: completedState,
          promotion: compactObject({
            ...(refreshedProposal.metadata?.promotion ?? {}),
            blockers: validationStatus.blockers,
            status:
              nextStatus === "promotion_ready"
                ? "promotion_ready"
                : (refreshedProposal.metadata?.promotion?.status ?? "blocked"),
            updatedAt: nowIso(),
          }),
        },
      }),
    );
  }
  const finalRun = withDatabase(dbPath, (db) => getWorkItemRun(db, runId));
  const finalProposal = withDatabase(dbPath, (db) =>
    getProposalArtifactByRunId(db, runId),
  );
  if (finalRun) {
    await syncDocSuggestionRecordsForRun(item, finalRun, finalProposal, dbPath);
  }
  return getSelfBuildWorkItemRun(runId, dbPath);
}

function scheduleWorkItemRunValidation(
  runId,
  bundleIds: string[],
  fallbackScenarioIds: string[],
  fallbackRegressionIds: string[],
  options: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const existing = activeValidationTasks.get(runId);
  if (existing) {
    return existing;
  }
  const task = new Promise<void>((resolve) => {
    setTimeout(() => {
      (async () => {
        try {
          await executeWorkItemRunValidation(
            runId,
            bundleIds,
            fallbackScenarioIds,
            fallbackRegressionIds,
            options,
            dbPath,
          );
        } catch (error) {
          const run = withDatabase(dbPath, (db) => getWorkItemRun(db, runId));
          const proposal = withDatabase(dbPath, (db) =>
            getProposalArtifactByRunId(db, runId),
          );
          if (run) {
            const failedAt = nowIso();
            const failure = buildValidationError(
              "validation",
              runId,
              error instanceof Error ? error.message : String(error),
            );
            const failedState = buildValidationState(run, proposal, {
              bundleIds,
              fallbackScenarioIds,
              fallbackRegressionIds,
              status: "failed",
              startedAt:
                proposal?.metadata?.validation?.startedAt ??
                run.metadata?.validation?.startedAt ??
                failedAt,
              endedAt: failedAt,
              validatedAt: failedAt,
              error: failure,
              errors: [failure],
            });
            persistValidationStateForRun(runId, failedState, dbPath);
          }
        } finally {
          activeValidationTasks.delete(runId);
          resolve();
        }
      })().catch(() => {
        resolve();
      });
    }, 0);
  });
  activeValidationTasks.set(runId, task);
  return task;
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

function buildValidationTrace(item, validation: LooseRecord = {}) {
  const bundleIds = dedupe(validation.bundleIds ?? []);
  const bundleResults = asArray(validation.bundleResults);
  const source =
    bundleIds.length > 0 ? toText(validation.source, "run-state") : "fallback";
  const scenarioIds = dedupe([
    ...bundleResults.flatMap((record) => asArray(record?.scenarioIds)),
    ...(bundleIds.length === 0
      ? dedupe(
          item?.metadata?.recommendedScenarios ?? item?.relatedScenarios ?? [],
        )
      : []),
    ...dedupe(validation.fallbackScenarioIds ?? []),
  ]);
  const regressionIds = dedupe([
    ...bundleResults.flatMap((record) => asArray(record?.regressionIds)),
    ...(bundleIds.length === 0
      ? dedupe(
          item?.metadata?.recommendedRegressions ??
            item?.relatedRegressions ??
            [],
        )
      : []),
    ...dedupe(validation.fallbackRegressionIds ?? []),
  ]);
  const reasons = dedupe([
    ...asArray(validation.reasons),
    bundleIds.length > 0
      ? `Selected bundle${bundleIds.length === 1 ? "" : "s"}: ${bundleIds.join(", ")}.`
      : "No named validation bundle was selected.",
    scenarioIds.length > 0 || regressionIds.length > 0
      ? `Fan-out: ${scenarioIds.length} scenario${scenarioIds.length === 1 ? "" : "s"} and ${regressionIds.length} regression${regressionIds.length === 1 ? "" : "s"}.`
      : "No scenario or regression fan-out was recorded.",
    asArray(validation.errors).length > 0
      ? `Validation recorded ${asArray(validation.errors).length} error${
          asArray(validation.errors).length === 1 ? "" : "s"
        }.`
      : "",
  ]);
  const bundleLabelText = bundleResults
    .map((record) => toText(record?.label, toText(record?.bundleId, "")))
    .filter(Boolean)
    .join(", ");
  const summary =
    bundleIds.length > 0
      ? `Validation uses ${bundleIds.length} ${source === "explicit-request" ? "operator-selected" : "configured"} bundle${bundleIds.length === 1 ? "" : "s"}: ${bundleIds.join(", ")}${bundleLabelText ? ` (${bundleLabelText})` : ""}.`
      : "Validation falls back to the work item's recommended scenario and regression coverage.";
  return {
    source,
    selectedBundleIds: bundleIds,
    selectedBundleLabels: dedupe(
      bundleResults.map((record) =>
        toText(record?.label, toText(record?.bundleId, "")),
      ),
    ),
    scenarioIds,
    regressionIds,
    summary,
    reasons,
  };
}

function withValidationTrace(detail, selection = null) {
  if (!detail) {
    return detail;
  }
  const existingTrace =
    detail.trace &&
    typeof detail.trace === "object" &&
    !Array.isArray(detail.trace)
      ? detail.trace
      : {};
  const validation =
    detail.validation &&
    typeof detail.validation === "object" &&
    !Array.isArray(detail.validation)
      ? detail.validation
      : {};
  return {
    ...detail,
    trace: {
      ...existingTrace,
      validation: buildValidationTrace(detail.item, {
        ...validation,
        source: selection?.source,
        reasons: selection?.reasons,
      }),
    },
  };
}

function readValidationTraceSelection(detail) {
  const trace =
    detail?.trace &&
    typeof detail.trace === "object" &&
    !Array.isArray(detail.trace)
      ? detail.trace
      : {};
  return trace.validation &&
    typeof trace.validation === "object" &&
    !Array.isArray(trace.validation)
    ? trace.validation
    : null;
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
  const mutationScope = dedupe(
    payloadMetadata.mutationScope ??
      templateMetadata.mutationScope ??
      template.targetPaths ??
      [],
  );
  const taskClass = toText(
    payloadMetadata.taskClass ?? template.taskClass,
    resolveRecommendationTaskClass(
      template.id,
      templateMetadata.domainId,
      mutationScope,
    ),
  );
  const targetPaths = dedupe(
    payloadMetadata.targetPaths ??
      template.targetPaths ??
      resolveRecommendationTargetPaths(mutationScope),
  );
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
      taskClass,
      targetPaths,
      autonomousEligible:
        payloadMetadata.autonomousEligible ??
        template.autonomousEligible ??
        true,
      recommendedScenarios: dedupe([
        ...(template.recommendedScenarios ?? []),
        ...(payloadMetadata.recommendedScenarios ?? []),
      ]),
      recommendedRegressions: dedupe([
        ...(template.recommendedRegressions ?? []),
        ...(payloadMetadata.recommendedRegressions ?? []),
      ]),
      recommendedValidationBundles: dedupe([
        ...(template.recommendedValidationBundles ?? []),
        ...(payloadMetadata.recommendedValidationBundles ?? []),
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
    normalized.includes("frontend") ||
    normalized.includes("web") ||
    normalized.includes("ui") ||
    normalized.includes("dashboard")
  ) {
    return "frontend";
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
  const activeDomains = dedupe(
    asArray(projectConfig?.activeDomains)
      .map((entry) =>
        typeof entry === "string" ? entry : entry?.id ? String(entry.id) : "",
      )
      .filter(Boolean),
  );
  const hasDomain = (candidate) =>
    candidate === domainId ||
    (!domainId &&
      (activeDomains.length === 0 || activeDomains.includes(candidate)));
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
        targetPaths: ["docs", "docs/runbooks", "README.md"],
        taskClass: "documentation",
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
        targetPaths: ["config", "schemas", "docs"],
        taskClass: "config-hardening",
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
      relatedRegressions: [],
      metadata: {
        templateId: "operator-ui-pass",
        workflowPath: "config/workflows/frontend-ui-pass.yaml",
        domainId: "frontend",
        projectPath,
        roles: ["lead", "scout", "builder", "tester", "reviewer"],
        safeMode,
        mutationScope: safeMode ? ["docs", "config", "apps/web"] : ["apps/web"],
        targetPaths: safeMode ? ["apps/web", "docs", "config"] : ["apps/web"],
        taskClass: "operator-surface",
        requiresProposal: true,
        codeOriented: true,
        recommendedScenarios: ["frontend-ui-pass"],
        recommendedRegressions: [],
        recommendedValidationBundles: ["frontend-ui-pass"],
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
        targetPaths: safeMode
          ? ["config", "docs"]
          : ["packages/runtime-pi", "services/session-gateway"],
        taskClass: "runtime-validation",
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
        targetPaths: ["docs", "config"],
        taskClass: "general-self-work",
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

function buildGroupSummary(
  group,
  items = [],
  runs = [],
  proposals = [],
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
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
    proposals: proposals.map((proposal) =>
      buildProposalSummary(proposal, dbPath),
    ),
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
    .map((proposal) => buildProposalSummary(proposal, dbPath));
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

function buildProposalSummary(artifact, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const summary = buildProposalSummaryHelper(artifact);
  if (!summary) {
    return null;
  }
  const validationStatus = buildProposalValidationStatus(artifact);
  const governance = buildProposalGovernanceContext(artifact, dbPath);
  const effectiveStatus = governance.ready ? summary.status : "rework_required";
  const links = governance.ready
    ? summary.links
    : {
        self: summary.links.self,
        reviewPackage: summary.links.reviewPackage,
      };
  return {
    ...summary,
    status: effectiveStatus,
    links,
    governance: {
      ready: governance.ready,
      blockers: governance.blockers,
      sourceExecutionId: governance.sourceExecutionId,
      sourceRunStatus: governance.run?.status ?? null,
    },
    validation: validationStatus.validation,
    validationDrift: validationStatus.validationDrift,
    readiness: {
      ready: validationStatus.ready,
      blockers: validationStatus.blockers,
      requiredBundles: validationStatus.requiredBundles,
    },
    trace: {
      promotion: buildPromotionTrace(governance, validationStatus),
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

function buildWorkspaceAllocationTrace(
  allocation,
  workItem,
  workItemRun,
  inspection = null,
) {
  if (!allocation) {
    return null;
  }
  const mutationScope = dedupe(allocation.mutationScope ?? []);
  const failureReason = toText(allocation.metadata?.error, "");
  const reusedFromAllocationId =
    toText(allocation.metadata?.reusedFromAllocationId, "") ||
    toText(allocation.metadata?.linkedWorkspaceId, "") ||
    null;
  const sourceWorkspaceId =
    toText(allocation.metadata?.sourceWorkspaceId, "") || null;
  const decision =
    allocation.metadata?.reusedWorkspace === true || reusedFromAllocationId
      ? "reused"
      : allocation.status === "failed"
        ? "failed"
        : allocation.status === "cleaned"
          ? "cleaned"
          : "created";
  const reasons = dedupe([
    workItemRun?.id
      ? `Workspace belongs to work-item run ${workItemRun.id}.`
      : "",
    workItem?.kind
      ? `Work item kind ${workItem.kind} uses isolated workspace management.`
      : "",
    mutationScope.length > 0
      ? `Mutation scope: ${mutationScope.join(", ")}.`
      : "Mutation scope was not recorded.",
    allocation.safeMode !== false
      ? "Safe mode is enabled."
      : "Safe mode is disabled.",
    reusedFromAllocationId
      ? `Workspace reuse source allocation: ${reusedFromAllocationId}.`
      : allocation.metadata?.reusedWorkspace === true
        ? "Workspace reuse was requested by the workflow handoff."
        : "",
    sourceWorkspaceId
      ? `Workspace was derived from source allocation ${sourceWorkspaceId}.`
      : "",
    allocation.metadata?.workspacePurpose
      ? `Workspace purpose: ${allocation.metadata.workspacePurpose}.`
      : "",
    allocation.metadata?.handoffStatus
      ? `Handoff status: ${allocation.metadata.handoffStatus}.`
      : "",
    inspection && inspection.exists === false
      ? "Workspace path is missing on disk, so reconciliation is likely required."
      : "",
    failureReason ? `Provisioning failure: ${failureReason}` : "",
  ]);
  const summary =
    decision === "reused"
      ? `Reused workspace allocation ${reusedFromAllocationId ?? allocation.id ?? "unknown"} for run ${allocation.workItemRunId ?? allocation.ownerId ?? "unknown"}.`
      : decision === "failed"
        ? `Workspace allocation failed for run ${allocation.workItemRunId ?? allocation.ownerId ?? "unknown"}.`
        : sourceWorkspaceId
          ? `Created a derived workspace from source allocation ${sourceWorkspaceId} for run ${allocation.workItemRunId ?? allocation.ownerId ?? "unknown"}.`
          : decision === "cleaned"
            ? `Workspace allocation was cleaned after run ${allocation.workItemRunId ?? allocation.ownerId ?? "unknown"}.`
            : `Created a dedicated workspace for run ${allocation.workItemRunId ?? allocation.ownerId ?? "unknown"}.`;
  return {
    decision,
    summary,
    reasons,
    reusedFromAllocationId,
    ownerRunId: allocation.workItemRunId ?? null,
    mutationScope,
    safeMode: allocation.safeMode !== false,
    failureReason: failureReason || null,
    sourceWorkspaceId,
  };
}

function summarizeWorkspaceCleanupResult(result) {
  if (!result) {
    return {
      removed: false,
      skipped: true,
      reason: "cleanup-not-run",
    };
  }
  return {
    removed: result.removed === true,
    skipped: result.removed !== true,
    reason: result.removed === true ? "removed" : "cleanup-not-run",
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
    trace: {
      allocation: buildWorkspaceAllocationTrace(
        allocation,
        context.workItem,
        context.workItemRun,
        inspection,
      ),
    },
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

function resolveProposalSourceRunStatus(run: LooseRecord = {}) {
  const resultStatus = toText(run?.result?.status, "");
  if (SUCCESSFUL_PROPOSAL_SOURCE_RUN_STATUSES.has(resultStatus)) {
    return resultStatus;
  }
  if (
    ["failed", "rejected", "canceled", "stopped", "held", "paused"].includes(
      resultStatus,
    )
  ) {
    return null;
  }
  const runStatus = toText(run?.status, "");
  if (SUCCESSFUL_PROPOSAL_SOURCE_RUN_STATUSES.has(runStatus)) {
    return runStatus;
  }
  return workItemRunTerminalKind(run) === "completed" ? "completed" : null;
}

function describeProposalSourceRunStatus(run: LooseRecord = {}) {
  return toText(run?.result?.status, toText(run?.status, "unknown"));
}

function canRunFeedProposalLifecycle(item, run) {
  if (!item || !run) {
    return false;
  }
  if (!resolveProposalSourceRunStatus(run)) {
    return false;
  }
  if (item.kind === "workflow") {
    return Boolean(toText(run?.result?.executionId, ""));
  }
  return true;
}

function syncWorkspaceAllocationForRunOutcome(
  workspace,
  run,
  proposal = null,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  if (!workspace || !run) {
    return workspace;
  }
  const currentWorkspace = withDatabase(dbPath, (db) =>
    getWorkspaceAllocation(db, workspace.id),
  );
  if (!currentWorkspace) {
    return workspace;
  }
  const terminalKind = workItemRunTerminalKind(run);
  const updatedWorkspace = {
    ...currentWorkspace,
    executionId:
      run.result?.executionId ?? currentWorkspace.executionId ?? null,
    proposalArtifactId: proposal?.id ?? null,
    status:
      terminalKind === "failed"
        ? "failed"
        : terminalKind === "blocked"
          ? "active"
          : "settled",
    updatedAt: nowIso(),
  };
  withDatabase(dbPath, (db) => updateWorkspaceAllocation(db, updatedWorkspace));
  return updatedWorkspace;
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
      domainId: item.metadata?.domainId ?? null,
      projectId: item.metadata?.projectId ?? null,
      templateId: item.metadata?.templateId ?? null,
      safeMode: item.metadata?.safeMode !== false,
      mutationScope: dedupe(item.metadata?.mutationScope ?? []),
    },
    createdAt: now,
    updatedAt: now,
  };
  withDatabase(dbPath, (db) => insertLearningRecord(db, record));
  return record;
}

function inferDocSuggestionTemplateId(record) {
  const targetPath = String(record?.targetPath ?? "").trim();
  if (targetPath.startsWith("config/") || targetPath.startsWith("schemas/")) {
    return "config-schema-maintenance";
  }
  if (targetPath.startsWith("apps/web/")) {
    return "operator-ui-pass";
  }
  return "docs-maintenance-pass";
}

function buildDocSuggestionGoal(record) {
  const target = toText(record.targetPath, "project documentation");
  const summary = toText(record.summary, "");
  if (summary) {
    return `${summary} Apply and verify the suggested follow-up in ${target}.`;
  }
  return `Apply documentation or operator follow-up for ${target}.`;
}

function buildDocSuggestionSummary(
  record,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  if (!record) {
    return null;
  }
  const workItem = record.workItemId
    ? withDatabase(dbPath, (db) => getWorkItem(db, record.workItemId))
    : null;
  const proposal = record.proposalArtifactId
    ? withDatabase(dbPath, (db) =>
        getProposalArtifact(db, record.proposalArtifactId),
      )
    : null;
  const materializedWorkItemId =
    record.metadata?.materializedWorkItemId ?? null;
  const targetType =
    record.status === "materialized" ? "work-item" : "doc-suggestion";
  const targetId = materializedWorkItemId ?? record.id;
  return {
    ...record,
    itemType: "doc-suggestion",
    targetType,
    targetId,
    workItemTitle: workItem?.title ?? null,
    proposalTitle: proposal?.summary?.title ?? null,
    suggestedActions: [
      record.status === "pending" || record.status === "accepted"
        ? {
            action:
              record.status === "accepted"
                ? "materialize-doc-suggestion"
                : "review-doc-suggestion",
            targetType: "doc-suggestion",
            targetId: record.id,
            reason:
              record.status === "accepted"
                ? "This accepted doc suggestion can now be turned into managed self-work."
                : "This doc suggestion needs a review decision before it becomes managed work.",
            expectedOutcome:
              record.status === "accepted"
                ? "Create a managed work item from the doc suggestion."
                : "Accept or dismiss the doc suggestion with durable rationale.",
            commandHint:
              record.status === "accepted"
                ? `npm run orchestrator:doc-suggestion-materialize -- --suggestion ${record.id}`
                : `npm run orchestrator:doc-suggestion-review -- --suggestion ${record.id} --status accepted`,
            httpHint:
              record.status === "accepted"
                ? `/doc-suggestions/${encodeURIComponent(record.id)}/materialize`
                : `/doc-suggestions/${encodeURIComponent(record.id)}/review`,
            priority: record.status === "accepted" ? "medium" : "low",
          }
        : null,
    ].filter(Boolean),
    links: {
      self: `/doc-suggestions/${encodeURIComponent(record.id)}`,
      review: `/doc-suggestions/${encodeURIComponent(record.id)}/review`,
      materialize: `/doc-suggestions/${encodeURIComponent(record.id)}/materialize`,
      run: record.workItemRunId
        ? `/work-item-runs/${encodeURIComponent(record.workItemRunId)}`
        : null,
      proposal: record.proposalArtifactId
        ? `/proposal-artifacts/${encodeURIComponent(record.proposalArtifactId)}`
        : null,
      workItem: materializedWorkItemId
        ? `/work-items/${encodeURIComponent(materializedWorkItemId)}`
        : record.workItemId
          ? `/work-items/${encodeURIComponent(record.workItemId)}`
          : null,
    },
  };
}

export function listSelfBuildDocSuggestionSummaries(
  options: DocSuggestionRecordListOptions = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  return withDatabase(dbPath, (db) =>
    listDocSuggestionRecords(db, options),
  ).map((record) => buildDocSuggestionSummary(record, dbPath));
}

export function getDocSuggestionSummary(
  suggestionId,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const record = withDatabase(dbPath, (db) =>
    getDocSuggestionRecord(db, suggestionId),
  );
  return buildDocSuggestionSummary(record, dbPath);
}

async function syncDocSuggestionRecordsForRun(
  item,
  run,
  proposal,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  if (!item || !run) {
    return [];
  }
  const suggestions = buildDocSuggestionsHelper(item, run, proposal);
  const now = nowIso();
  const records = [];
  for (const suggestion of suggestions) {
    const existing = withDatabase(dbPath, (db) =>
      findDocSuggestionRecordByRunAndKind(
        db,
        run.id,
        String(suggestion.kind ?? "").trim(),
        suggestion.targetPath ?? null,
      ),
    );
    const next = {
      id: existing?.id ?? createId("doc-suggestion"),
      workItemId: item.id,
      workItemRunId: run.id,
      proposalArtifactId: proposal?.id ?? null,
      kind: String(suggestion.kind ?? "generic").trim(),
      targetPath: suggestion.targetPath ?? null,
      status:
        existing?.status &&
        ["accepted", "dismissed", "materialized"].includes(existing.status)
          ? existing.status
          : "pending",
      summary: toText(suggestion.summary, `Follow up on ${item.title}.`),
      payload: suggestion,
      metadata: mergeMetadata(existing?.metadata ?? {}, {
        projectId: item.metadata?.projectId ?? "spore",
        domainId: item.metadata?.domainId ?? null,
        templateId: inferDocSuggestionTemplateId({
          ...existing,
          ...suggestion,
        }),
        mutationScope: dedupe(item.metadata?.mutationScope ?? []),
        safeMode: item.metadata?.safeMode !== false,
      }),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      reviewedAt: existing?.reviewedAt ?? null,
      materializedAt: existing?.materializedAt ?? null,
    };
    const stored = withDatabase(dbPath, (db) =>
      upsertDocSuggestionRecord(db, next),
    );
    records.push(stored);
  }
  return records.map((record) => buildDocSuggestionSummary(record, dbPath));
}

export function listSelfBuildLearningSummaries(
  options: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const sourceType = toText(options.sourceType, "") || null;
  const limit = Number.parseInt(String(options.limit ?? "50"), 10) || 50;
  const records = withDatabase(dbPath, (db) =>
    listLearningRecords(db, sourceType, limit),
  );
  const status = toText(options.status, "");
  return records
    .filter((record) => !status || String(record.status) === status)
    .map((record) => ({
      ...buildLearningSummary(record),
      links: {
        self: "/self-build/learnings",
        source:
          record.sourceType === "work-item-run"
            ? `/work-item-runs/${encodeURIComponent(record.sourceId)}`
            : null,
      },
    }));
}

export async function reviewDocSuggestionRecord(
  suggestionId,
  decision: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const record = withDatabase(dbPath, (db) =>
    getDocSuggestionRecord(db, suggestionId),
  );
  if (!record) {
    return null;
  }
  const reviewedAt = nowIso();
  const status =
    String(decision.status ?? "accepted").trim() === "dismissed"
      ? "dismissed"
      : "accepted";
  const updated = {
    ...record,
    status,
    reviewedAt,
    updatedAt: reviewedAt,
    metadata: mergeMetadata(record.metadata ?? {}, {
      review: {
        status,
        by: decision.by ?? "operator",
        comments: decision.comments ?? "",
        reviewedAt,
      },
    }),
  };
  withDatabase(dbPath, (db) => updateDocSuggestionRecord(db, updated));
  return buildDocSuggestionSummary(updated, dbPath);
}

export async function materializeDocSuggestionRecord(
  suggestionId,
  payload: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const record = withDatabase(dbPath, (db) =>
    getDocSuggestionRecord(db, suggestionId),
  );
  if (!record) {
    return null;
  }
  const templateId = toText(
    payload.templateId,
    record.metadata?.templateId ?? inferDocSuggestionTemplateId(record),
  );
  const detail = await createManagedWorkItem(
    {
      templateId,
      title: payload.title ?? `Follow-up: ${record.summary}`,
      goal: payload.goal ?? buildDocSuggestionGoal(record),
      priority: payload.priority ?? "medium",
      source: payload.source ?? "doc-suggestion-materialize",
      relatedDocs: dedupe([
        record.targetPath ?? null,
        ...(record.payload?.relatedDocs ?? []),
      ]),
      metadata: mergeMetadata(record.metadata ?? {}, {
        sourceDocSuggestionId: record.id,
        projectId: record.metadata?.projectId ?? "spore",
        domainId: payload.domainId ?? record.metadata?.domainId ?? "docs",
        safeMode:
          payload.safeMode !== undefined
            ? payload.safeMode
            : record.metadata?.safeMode !== false,
        templateId,
      }),
    },
    dbPath,
  );
  const materializedAt = nowIso();
  const updated = {
    ...record,
    status: "materialized",
    materializedAt,
    updatedAt: materializedAt,
    metadata: mergeMetadata(record.metadata ?? {}, {
      materializedWorkItemId: detail.id,
      materializedBy: payload.by ?? "operator",
      materializedSource: payload.source ?? "doc-suggestion-materialize",
    }),
  };
  withDatabase(dbPath, (db) => updateDocSuggestionRecord(db, updated));
  return {
    suggestion: buildDocSuggestionSummary(updated, dbPath),
    workItem: getSelfBuildWorkItem(detail.id, dbPath),
  };
}

function inferLearningTemplateId(record) {
  const templateId = toText(record.metadata?.templateId, "");
  if (templateId) {
    return templateId;
  }
  const mutationScope = dedupe(record.metadata?.mutationScope ?? []);
  if (mutationScope.some((scope) => String(scope).startsWith("apps/web"))) {
    return "operator-ui-pass";
  }
  if (
    mutationScope.some((scope) =>
      ["config", "schemas", "docs", "runbooks"].includes(String(scope)),
    )
  ) {
    return "config-schema-maintenance";
  }
  return "runtime-validation-pass";
}

function buildIntakeGoalFromLearning(record) {
  if (record.kind === "failure-pattern") {
    return `Investigate and repair the failure pattern recorded in learning ${record.id}. Use durable evidence from source ${record.sourceId}.`;
  }
  return `Review the successful self-work outcome recorded in learning ${record.id} and determine whether it should trigger another managed improvement pass.`;
}

function buildIntakeGoalFromDocSuggestion(record) {
  return buildDocSuggestionGoal(record);
}

function buildIntakeGoalFromIntegrationBranch(branch) {
  return `Investigate integration branch ${branch.name} and restore promotion flow without mutating canonical root directly.`;
}

function buildIntakeGoalFromPolicyRecommendation(recommendation) {
  return (
    recommendation.goal ??
    `Address policy recommendation ${recommendation.id} so autonomous self-build can proceed more safely.`
  );
}

function buildIntegrationBranchDiagnostics(branch) {
  if (!branch) {
    return null;
  }
  const issues = [];
  const nowMs = Date.now();
  const updatedAtMs = new Date(
    branch.updatedAt ?? branch.createdAt ?? 0,
  ).getTime();
  const staleMs = nowMs - updatedAtMs;
  if (
    ["blocked", "integration_failed", "quarantined"].includes(
      String(branch.status),
    )
  ) {
    issues.push({
      code: "integration_branch_blocked",
      severity: "high",
      reason:
        branch.reason ??
        `Integration branch ${branch.name} is ${branch.status} and needs follow-up.`,
    });
  }
  if (
    ["promotion_candidate", "integration_running", "blocked"].includes(
      String(branch.status),
    ) &&
    staleMs > 24 * 60 * 60 * 1000
  ) {
    issues.push({
      code: "integration_branch_stale",
      severity: "medium",
      reason: `Integration branch ${branch.name} has been stale for more than 24 hours.`,
    });
  }
  if (!asArray(branch.proposalArtifactIds).length) {
    issues.push({
      code: "missing_proposal_sources",
      severity: "high",
      reason:
        "Integration branch has no durable proposal artifact sources attached.",
    });
  }
  if (!asArray(branch.workspaceIds).length) {
    issues.push({
      code: "missing_workspace_sources",
      severity: "medium",
      reason:
        "Integration branch has no workspace-linked sources attached, so branch provenance is incomplete.",
    });
  }
  if (!branch.sourceExecutionId) {
    issues.push({
      code: "integration_branch_no_execution_source",
      severity: "high",
      reason:
        "Integration branch is missing its source executionId and cannot be traced cleanly through promotion history.",
    });
  }
  const bundleResults = asArray(branch.metadata?.validation?.bundleResults);
  if (
    String(branch.status ?? "") !== "merged_to_integration" &&
    bundleResults.length === 0
  ) {
    issues.push({
      code: "integration_branch_validation_missing",
      severity: "medium",
      reason:
        "Integration branch has no durable validation-bundle evidence attached.",
    });
  }
  if (
    String(branch.status ?? "") === "promotion_candidate" &&
    branch.metadata?.promotion?.status === "blocked"
  ) {
    issues.push({
      code: "integration_branch_inconsistent",
      severity: "high",
      reason:
        "Integration branch is marked as a promotion candidate while promotion metadata still reports a blocked state.",
    });
  }
  if (branch.quarantine?.status === "active") {
    issues.push({
      code: "integration_branch_quarantined",
      severity: "high",
      reason: branch.quarantine.reason ?? "Integration branch is quarantined.",
    });
  }
  return {
    stale: issues.some((issue) => issue.code === "integration_branch_stale"),
    issueCount: issues.length,
    issues,
    healthStatus: issues.length > 0 ? "needs-attention" : "healthy",
    suggestedActions: [
      issues.length > 0
        ? {
            action: "inspect-integration-branch",
            targetType: "integration-branch",
            targetId: branch.name,
            reason: issues[0]?.reason ?? "Integration branch needs review.",
            expectedOutcome:
              "Inspect the branch and decide between recovery, quarantine release, or rollback.",
            commandHint: `npm run orchestrator:integration-branch-show -- --name ${branch.name}`,
            httpHint: `/integration-branches/${encodeURIComponent(branch.name)}`,
            priority: "high",
          }
        : null,
    ].filter(Boolean),
  };
}

export function getSelfBuildLearningTrends(
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const records = withDatabase(dbPath, (db) =>
    listLearningRecords(db, null, 200),
  );
  const buckets = new Map<string, LooseRecord>();
  for (const record of records) {
    const templateId = toText(
      record.metadata?.templateId,
      inferLearningTemplateId(record),
    );
    const domainId = toText(record.metadata?.domainId, "docs");
    const kind = toText(record.kind, "unknown");
    const bucketId = `${kind}:${domainId}:${templateId}`;
    const existing = buckets.get(bucketId) ?? {
      id: bucketId,
      kind,
      domainId,
      templateId,
      count: 0,
      activeCount: 0,
      statuses: {},
      latestAt: null,
      sourceIds: [],
    };
    existing.count += 1;
    existing.activeCount += String(record.status) === "active" ? 1 : 0;
    existing.statuses[String(record.status ?? "unknown")] =
      Number(existing.statuses[String(record.status ?? "unknown")] ?? 0) + 1;
    existing.latestAt =
      !existing.latestAt ||
      new Date(record.updatedAt ?? record.createdAt ?? 0).getTime() >
        new Date(existing.latestAt).getTime()
        ? (record.updatedAt ?? record.createdAt ?? null)
        : existing.latestAt;
    existing.sourceIds = dedupe([...existing.sourceIds, record.id]);
    buckets.set(bucketId, existing);
  }
  return [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      repeated: bucket.activeCount >= 2,
      severity:
        bucket.kind === "failure-pattern"
          ? bucket.activeCount >= 3
            ? "high"
            : "medium"
          : "low",
      summary:
        bucket.kind === "failure-pattern"
          ? `${bucket.activeCount} active failure-pattern learnings for ${bucket.templateId} in ${bucket.domainId}.`
          : `${bucket.activeCount} active learnings for ${bucket.templateId} in ${bucket.domainId}.`,
      links: {
        learnings: `/self-build/learnings?sourceType=${encodeURIComponent("work-item-run")}`,
      },
    }))
    .sort((left, right) => {
      const rightSeverity =
        right.severity === "high" ? 3 : right.severity === "medium" ? 2 : 1;
      const leftSeverity =
        left.severity === "high" ? 3 : left.severity === "medium" ? 2 : 1;
      if (rightSeverity !== leftSeverity) {
        return rightSeverity - leftSeverity;
      }
      return (
        new Date(right.latestAt ?? 0).getTime() -
        new Date(left.latestAt ?? 0).getTime()
      );
    });
}

export function getSelfBuildPolicyRecommendations(
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const trends = getSelfBuildLearningTrends(dbPath);
  const blockedDecisions = listSelfBuildDecisionSummaries(
    { state: "blocked", limit: 100 },
    dbPath,
  );
  const quarantines = listSelfBuildQuarantineSummaries(
    { status: "active", limit: 50 },
    dbPath,
  );
  const integrationBranches = listIntegrationBranchSummaries(
    { limit: 50 },
    dbPath,
  ).map((branch) => ({
    ...branch,
    diagnostics: buildIntegrationBranchDiagnostics(branch),
  }));
  const recommendations: LooseRecord[] = [];

  for (const trend of trends) {
    if (!trend.repeated) {
      continue;
    }
    recommendations.push({
      id: stablePolicyRecommendationId("learning-trend", trend.id),
      kind:
        trend.kind === "failure-pattern"
          ? "stabilize-template"
          : "review-learning-pattern",
      summary:
        trend.kind === "failure-pattern"
          ? `Repeated failure pattern for ${trend.templateId} in ${trend.domainId} should become managed repair work.`
          : `Repeated learning pattern for ${trend.templateId} in ${trend.domainId} should be reviewed for policy or template tuning.`,
      goal:
        trend.kind === "failure-pattern"
          ? `Stabilize autonomous self-build flow for template ${trend.templateId} in domain ${trend.domainId}.`
          : `Review learning trend ${trend.id} and decide whether template or policy tuning is needed.`,
      priority: trend.severity === "high" ? "high" : "medium",
      severity: trend.severity,
      domainId: trend.domainId,
      templateId: trend.templateId,
      sourceType: "learning-trend",
      sourceIds: trend.sourceIds,
      autonomyImpact: trend.kind === "failure-pattern" ? "degrade" : "observe",
      reason: trend.summary,
      suggestedActions: [
        {
          action: "materialize-policy-follow-up",
          targetType: "self-build-intake",
          targetId: null,
          priority: trend.severity === "high" ? "high" : "medium",
          reason: trend.summary,
          expectedOutcome:
            "Convert repeated learning evidence into managed repair or policy-tuning work.",
          commandHint: "npm run orchestrator:self-build-intake-refresh",
          httpHint: "/self-build/intake/refresh",
        },
      ],
    });
  }

  for (const decision of blockedDecisions) {
    const blockers = asArray(
      decision.metadata?.evaluation?.protectedScopeBlocks,
    );
    if (blockers.length === 0) {
      continue;
    }
    recommendations.push({
      id: stablePolicyRecommendationId("autonomy-decision", decision.id),
      kind: "protected-scope-block",
      summary: `Autonomous work hit protected scopes: ${blockers.join(", ")}.`,
      goal: `Review protected-scope policy for ${decision.targetType} ${decision.targetId} and decide whether to reroute or keep it supervised.`,
      priority: "high",
      severity: "high",
      domainId: null,
      templateId: null,
      sourceType: "autonomy-decision",
      sourceIds: [decision.id],
      autonomyImpact: "block",
      reason: decision.rationale ?? blockers.join(", "),
      blockedScopes: blockers,
      suggestedActions: [
        {
          action: "review-protected-scope-block",
          targetType: decision.targetType ?? "goal-plan",
          targetId: decision.targetId ?? null,
          priority: "high",
          reason: decision.rationale ?? blockers.join(", "),
          expectedOutcome:
            "Decide whether this work stays supervised or the autonomous policy needs a tier change.",
          commandHint:
            decision.targetType === "goal-plan"
              ? `npm run orchestrator:goal-plan-show -- --plan ${decision.targetId}`
              : null,
          httpHint: decision.links?.self ?? null,
        },
      ],
    });
  }

  for (const record of quarantines) {
    recommendations.push({
      id: stablePolicyRecommendationId("quarantine", record.id),
      kind: "quarantine-follow-up",
      summary: `Active quarantine exists for ${record.targetType} ${record.targetId}.`,
      goal: `Resolve quarantine ${record.id} and decide whether work should be repaired, revalidated, or kept blocked.`,
      priority: "high",
      severity: "high",
      domainId: null,
      templateId: null,
      sourceType: "quarantine",
      sourceIds: [record.id],
      autonomyImpact: "block",
      reason: record.reason ?? "Self-build target is quarantined.",
      suggestedActions: [
        {
          action: "inspect-quarantine",
          targetType: record.targetType,
          targetId: record.targetId,
          priority: "high",
          reason: record.reason ?? "Quarantine requires operator follow-up.",
          expectedOutcome:
            "Decide whether to release quarantine, reroute work, or keep the target blocked.",
          commandHint:
            record.targetType === "goal-plan"
              ? `npm run orchestrator:goal-plan-show -- --plan ${record.targetId}`
              : null,
          httpHint: record.links?.self ?? null,
        },
      ],
    });
  }

  for (const branch of integrationBranches) {
    if ((branch.diagnostics?.issueCount ?? 0) === 0) {
      continue;
    }
    recommendations.push({
      id: stablePolicyRecommendationId("integration-branch", branch.name),
      kind: "integration-branch-repair",
      summary: `Integration branch ${branch.name} has ${branch.diagnostics?.issueCount ?? 0} active issues.`,
      goal: `Repair integration branch ${branch.name} and restore promotion flow safely.`,
      priority: "high",
      severity: branch.diagnostics?.issues?.some(
        (issue) => issue.severity === "high",
      )
        ? "high"
        : "medium",
      domainId: "backend",
      templateId: "runtime-validation-pass",
      sourceType: "integration-branch",
      sourceIds: [branch.name],
      autonomyImpact: "block",
      reason:
        branch.diagnostics?.issues?.[0]?.reason ??
        branch.reason ??
        "Integration branch requires repair.",
      diagnostics: branch.diagnostics,
      suggestedActions: branch.diagnostics?.suggestedActions ?? [],
    });
  }

  const reviewByRecommendationId = new Map(
    withDatabase(dbPath, (db) =>
      listPolicyRecommendationReviews(db, { limit: 200 }),
    ).map((review) => [String(review.recommendationId), review]),
  );

  return recommendations
    .sort((left, right) => {
      const order = { high: 0, medium: 1, low: 2 };
      const leftPriority = order[left.priority] ?? 3;
      const rightPriority = order[right.priority] ?? 3;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      return String(left.summary).localeCompare(String(right.summary));
    })
    .slice(0, 50)
    .map((recommendation) =>
      buildPolicyRecommendationReviewSummary(
        reviewByRecommendationId.get(String(recommendation.id)) ?? null,
        recommendation,
      ),
    );
}

function buildSelfBuildIntakeSummary(record) {
  if (!record) {
    return null;
  }
  const score = Number(record.metadata?.priorityScore ?? record.priority ?? 0);
  return {
    ...record,
    itemType: "self-build-intake",
    targetType: "self-build-intake",
    targetId: record.id,
    priorityScore: score,
    priorityLabel: priorityLabel(score),
    priorityReason: toText(record.metadata?.priorityReason, ""),
    links: {
      self: `/self-build/intake/${encodeURIComponent(record.id)}`,
      review: `/self-build/intake/${encodeURIComponent(record.id)}/review`,
      materialize: `/self-build/intake/${encodeURIComponent(record.id)}/materialize`,
      goalPlan: record.goalPlanId
        ? `/goal-plans/${encodeURIComponent(record.goalPlanId)}`
        : null,
    },
  };
}

export function listSelfBuildIntakeSummaries(
  options: SelfBuildIntakeListOptions = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  return withDatabase(dbPath, (db) =>
    listSelfBuildIntakeRecords(db, options),
  ).map(buildSelfBuildIntakeSummary);
}

export function getSelfBuildIntakeSummary(
  intakeId,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const record = withDatabase(dbPath, (db) =>
    getSelfBuildIntakeRecord(db, intakeId),
  );
  return buildSelfBuildIntakeSummary(record);
}

export async function refreshSelfBuildIntake(
  options: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const now = nowIso();
  const activeKeys = new Set();
  const projectId = toText(options.projectId, "spore");
  const resolvedPolicy = await loadProjectSelfBuildPolicy(projectId);
  const autonomyPolicy = resolvedPolicy.autonomy;
  const learnings = listSelfBuildLearningSummaries(
    { status: "active", limit: 100 },
    dbPath,
  );
  const docSuggestions = listSelfBuildDocSuggestionSummaries(
    {
      status: options.includeAccepted === true ? undefined : "pending",
      limit: 100,
    },
    dbPath,
  ).concat(
    options.includeAccepted === true
      ? listSelfBuildDocSuggestionSummaries(
          { status: "accepted", limit: 100 },
          dbPath,
        )
      : [],
  );
  const integrationBranches = listIntegrationBranchSummaries(
    { limit: 100 },
    dbPath,
  );
  const branchIssues = integrationBranches
    .map((branch) => ({
      ...branch,
      diagnostics: buildIntegrationBranchDiagnostics(branch),
    }))
    .filter((branch) => (branch.diagnostics?.issueCount ?? 0) > 0);

  const createOrUpdate = (candidate) => {
    const scoring = scoreSelfBuildIntakeCandidate(candidate, autonomyPolicy);
    activeKeys.add(`${candidate.sourceType}:${candidate.sourceId}`);
    return withDatabase(dbPath, (db) =>
      upsertSelfBuildIntakeRecord(db, {
        ...candidate,
        projectId: candidate.projectId ?? projectId,
        priority: scoring.score,
        updatedAt: now,
        createdAt: candidate.createdAt ?? now,
        metadata: mergeMetadata(candidate.metadata ?? {}, {
          priorityScore: scoring.score,
          priorityLabel: scoring.label,
          priorityReason: scoring.reason,
        }),
      }),
    );
  };

  for (const learning of learnings) {
    createOrUpdate({
      id: createId("intake"),
      sourceType: "learning-record",
      sourceId: learning.id,
      kind: "learning-follow-up",
      status: "queued",
      priority: 0,
      goal: buildIntakeGoalFromLearning(learning),
      projectId,
      domainId: learning.metadata?.domainId ?? "docs",
      templateId: inferLearningTemplateId(learning),
      goalPlanId: null,
      metadata: {
        sourceSummary: learning.summary,
        sourceKind: learning.kind,
        projectId,
      },
      consumedAt: null,
    });
  }

  for (const suggestion of docSuggestions) {
    createOrUpdate({
      id: createId("intake"),
      sourceType: "doc-suggestion",
      sourceId: suggestion.id,
      kind: "doc-follow-up",
      status: "queued",
      priority: 0,
      goal: buildIntakeGoalFromDocSuggestion(suggestion),
      projectId: suggestion.metadata?.projectId ?? projectId,
      domainId: suggestion.metadata?.domainId ?? "docs",
      templateId:
        suggestion.metadata?.templateId ??
        inferDocSuggestionTemplateId(suggestion),
      goalPlanId: null,
      metadata: {
        targetPath: suggestion.targetPath ?? null,
        sourceSummary: suggestion.summary,
      },
      consumedAt: null,
    });
  }

  for (const branch of branchIssues) {
    createOrUpdate({
      id: createId("intake"),
      sourceType: "integration-branch",
      sourceId: branch.name,
      kind: "integration-repair",
      status: "queued",
      priority: 0,
      goal: buildIntakeGoalFromIntegrationBranch(branch),
      projectId: branch.projectId ?? projectId,
      domainId: "backend",
      templateId: "runtime-validation-pass",
      goalPlanId: null,
      metadata: {
        branchStatus: branch.status,
        diagnostics: branch.diagnostics,
        proposalStatus: branch.metadata?.promotion?.status ?? null,
      },
      consumedAt: null,
    });
  }

  const existing = listSelfBuildIntakeSummaries({ limit: 200 }, dbPath);
  for (const record of existing) {
    const key = `${record.sourceType}:${record.sourceId}`;
    if (
      !activeKeys.has(key) &&
      ["queued", "accepted"].includes(String(record.status))
    ) {
      withDatabase(dbPath, (db) =>
        updateSelfBuildIntakeRecord(db, {
          ...record,
          status: "blocked",
          updatedAt: now,
          metadata: mergeMetadata(record.metadata ?? {}, {
            blockedReason: "source-no-longer-active",
          }),
        }),
      );
    }
  }
  return listSelfBuildIntakeSummaries({ limit: 100 }, dbPath);
}

export async function reviewSelfBuildIntake(
  intakeId,
  decision: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const record = withDatabase(dbPath, (db) =>
    getSelfBuildIntakeRecord(db, intakeId),
  );
  if (!record) {
    return null;
  }
  const reviewedAt = nowIso();
  const status =
    String(decision.status ?? "accepted").trim() === "dismissed"
      ? "dismissed"
      : "accepted";
  const updated = {
    ...record,
    status,
    updatedAt: reviewedAt,
    metadata: mergeMetadata(record.metadata ?? {}, {
      review: {
        status,
        by: decision.by ?? "operator",
        comments: decision.comments ?? "",
        reviewedAt,
      },
    }),
  };
  withDatabase(dbPath, (db) => updateSelfBuildIntakeRecord(db, updated));
  return buildSelfBuildIntakeSummary(updated);
}

export async function materializeSelfBuildIntake(
  intakeId,
  payload: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const record = withDatabase(dbPath, (db) =>
    getSelfBuildIntakeRecord(db, intakeId),
  );
  if (!record) {
    return null;
  }
  const plan = await createGoalPlan(
    {
      title: payload.title ?? `Intake: ${record.kind}`,
      goal: payload.goal ?? record.goal,
      domain: payload.domain ?? record.domainId,
      mode: payload.mode ?? "autonomous",
      projectId: payload.projectId ?? record.projectId ?? "spore",
      safeMode: payload.safeMode !== undefined ? payload.safeMode : true,
      by: payload.by ?? "operator",
      source: payload.source ?? "self-build-intake-materialize",
      constraints: mergeMetadata(payload.constraints ?? {}, {
        templateHint: record.templateId ?? null,
        sourceIntakeId: record.id,
      }),
    },
    dbPath,
  );
  const materializedAt = nowIso();
  const updated = {
    ...record,
    status: "materialized",
    goalPlanId: plan.id,
    consumedAt: materializedAt,
    updatedAt: materializedAt,
    metadata: mergeMetadata(record.metadata ?? {}, {
      materializedBy: payload.by ?? "operator",
      materializedSource: payload.source ?? "self-build-intake-materialize",
      goalPlanId: plan.id,
    }),
  };
  withDatabase(dbPath, (db) => updateSelfBuildIntakeRecord(db, updated));
  return {
    intake: buildSelfBuildIntakeSummary(updated),
    goalPlan: getGoalPlanSummary(plan.id, dbPath),
  };
}

export async function reworkProposalArtifact(
  artifactId,
  payload: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const proposal = withDatabase(dbPath, (db) =>
    getProposalArtifact(db, artifactId),
  );
  if (!proposal) {
    return null;
  }
  const workItem = proposal.workItemId
    ? withDatabase(dbPath, (db) => getWorkItem(db, proposal.workItemId))
    : null;
  const group = workItem?.metadata?.groupId
    ? withDatabase(dbPath, (db) =>
        getWorkItemGroup(db, workItem.metadata.groupId),
      )
    : null;
  const title =
    payload.title ??
    `${proposal.summary?.title ?? workItem?.title ?? "Proposal"} rework`;
  const goal =
    payload.goal ??
    proposal.summary?.goal ??
    workItem?.goal ??
    "Address proposal review, validation, or promotion blockers.";
  const reworkItem = await createManagedWorkItem(
    {
      templateId:
        payload.templateId ??
        workItem?.metadata?.templateId ??
        proposal.metadata?.templateId ??
        "docs-maintenance-pass",
      title,
      kind: payload.kind ?? workItem?.kind ?? proposal.kind ?? "workflow",
      goal,
      source: payload.source ?? "proposal-rework",
      priority: payload.priority ?? workItem?.priority ?? "high",
      acceptanceCriteria:
        payload.acceptanceCriteria ?? workItem?.acceptanceCriteria ?? [],
      relatedDocs: dedupe([
        ...(workItem?.relatedDocs ?? []),
        ...(payload.relatedDocs ?? []),
      ]),
      relatedScenarios: dedupe([
        ...(workItem?.relatedScenarios ?? []),
        ...(payload.relatedScenarios ?? []),
      ]),
      relatedRegressions: dedupe([
        ...(workItem?.relatedRegressions ?? []),
        ...(payload.relatedRegressions ?? []),
      ]),
      metadata: mergeMetadata(
        workItem?.metadata ?? {},
        payload.metadata ?? {},
        {
          projectId:
            payload.projectId ?? workItem?.metadata?.projectId ?? "spore",
          projectPath:
            payload.projectPath ?? workItem?.metadata?.projectPath ?? null,
          domainId: payload.domainId ?? workItem?.metadata?.domainId ?? null,
          templateId:
            payload.templateId ??
            workItem?.metadata?.templateId ??
            proposal.metadata?.templateId ??
            null,
          safeMode:
            payload.safeMode !== undefined
              ? payload.safeMode
              : (workItem?.metadata?.safeMode ?? true),
          mutationScope:
            payload.mutationScope ?? workItem?.metadata?.mutationScope ?? null,
          groupId: payload.groupId ?? workItem?.metadata?.groupId ?? null,
          goalPlanId:
            payload.goalPlanId ?? workItem?.metadata?.goalPlanId ?? null,
          reworkOfProposalId: proposal.id,
          reworkOfWorkItemId: workItem?.id ?? null,
          reworkOfRunId: proposal.workItemRunId ?? null,
          originatingProposalId: proposal.id,
        },
      ),
    },
    dbPath,
  );
  const updatedProposal = {
    ...proposal,
    status: "rework_required",
    updatedAt: nowIso(),
    metadata: mergeMetadata(proposal.metadata ?? {}, {
      rework: {
        createdAt: nowIso(),
        by: payload.by ?? "operator",
        source: payload.source ?? "proposal-rework",
        comments: payload.comments ?? "",
        rationale: payload.rationale ?? payload.comments ?? "",
        reworkItemId: reworkItem?.id ?? null,
        groupId: group?.id ?? null,
      },
      reworkHistory: [
        ...asArray(proposal.metadata?.reworkHistory),
        {
          createdAt: nowIso(),
          by: payload.by ?? "operator",
          source: payload.source ?? "proposal-rework",
          comments: payload.comments ?? "",
          rationale: payload.rationale ?? payload.comments ?? "",
          reworkItemId: reworkItem?.id ?? null,
          groupId: group?.id ?? null,
        },
      ],
    }),
  };
  withDatabase(dbPath, (db) => updateProposalArtifact(db, updatedProposal));
  return {
    proposal: buildProposalSummary(updatedProposal, dbPath),
    reworkItem: reworkItem ? getSelfBuildWorkItem(reworkItem.id, dbPath) : null,
    group: group ? getWorkItemGroupSummary(group.id, dbPath) : null,
  };
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
    ? buildGroupSummary(group, groupItems, groupRuns, [], dbPath)
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
      ? buildProposalSummary(latestProposal, dbPath)
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
    proposal?.status === "ready_for_review" &&
    isProposalGovernanceReady(proposal, dbPath)
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
    proposal?.status === "approved" &&
    isProposalGovernanceReady(proposal, dbPath)
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
    proposal: buildProposalSummary(proposal, dbPath),
    workspace: buildWorkspaceSummary(workspace),
    validation: run.metadata?.validation ?? null,
    docSuggestions,
    learningRecords: learningRecords.map(buildLearningSummary),
    failure,
    trace: {
      validation: buildValidationTrace(item, {
        ...(run.metadata?.validation ?? {}),
        source: toText(run.metadata?.validation?.trace?.source, "fallback"),
        reasons: asArray(run.metadata?.validation?.trace?.reasons),
      }),
    },
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
          dbPath,
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
    if (
      failedItem &&
      failedRun &&
      workItemKindRequiresProposal(failedItem) &&
      canRunFeedProposalLifecycle(failedItem, failedRun)
    ) {
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
    }
    provisionedWorkspace = syncWorkspaceAllocationForRunOutcome(
      provisionedWorkspace,
      failedRun,
      proposal,
      dbPath,
    );
    if (failedItem && failedRun) {
      failedRun.metadata = {
        ...failedRun.metadata,
        proposalArtifactId: proposal?.id ?? null,
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
    const docSuggestions =
      failedItem && failedRun
        ? await syncDocSuggestionRecordsForRun(
            failedItem,
            failedRun,
            proposal,
            dbPath,
          )
        : [];
    return {
      item: failedItem,
      run: failedRun,
      proposal: buildProposalSummary(proposal, dbPath),
      learningRecord: buildLearningSummary(learningRecord),
      docSuggestions,
      error: error.message,
    };
  }
  const runDetail = getManagedWorkItemRun(result.run.id, dbPath);
  const settledItem = withDatabase(dbPath, (db) => getWorkItem(db, itemId));
  let proposal = null;
  if (
    workItemKindRequiresProposal(settledItem) &&
    canRunFeedProposalLifecycle(settledItem, runDetail)
  ) {
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
  }
  provisionedWorkspace = syncWorkspaceAllocationForRunOutcome(
    provisionedWorkspace,
    runDetail,
    proposal,
    dbPath,
  );
  runDetail.metadata = {
    ...runDetail.metadata,
    proposalArtifactId: proposal?.id ?? null,
    docSuggestions: buildDocSuggestionsHelper(settledItem, runDetail, proposal),
  };
  withDatabase(dbPath, (db) => updateWorkItemRun(db, runDetail));
  const learningRecord = await maybeCreateLearningRecord(
    settledItem,
    runDetail,
    proposal,
    dbPath,
  );
  const docSuggestions = await syncDocSuggestionRecordsForRun(
    settledItem,
    runDetail,
    proposal,
    dbPath,
  );
  return {
    item: settledItem,
    run: getManagedWorkItemRun(runDetail.id, dbPath),
    proposal: buildProposalSummary(proposal, dbPath),
    learningRecord: buildLearningSummary(learningRecord),
    docSuggestions,
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
        const validationResult = await queueWorkItemRunValidation(
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

export async function queueWorkItemGroupValidationBundle(
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
    const result = await queueWorkItemRunValidation(
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
            status: validationResults.every(
              (result) => result?.validation?.status === "completed",
            )
              ? "completed"
              : validationResults.some((result) =>
                    ["queued", "running"].includes(
                      String(result?.validation?.status ?? ""),
                    ),
                  )
                ? "running"
                : validationResults.some(
                      (result) => result?.validation?.status === "failed",
                    )
                  ? "failed"
                  : "queued",
            queuedAt: nowIso(),
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

export async function waitForWorkItemGroupValidationBundle(
  groupId,
  payload: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const detail = await queueWorkItemGroupValidationBundle(
    groupId,
    payload,
    dbPath,
  );
  if (!detail) {
    return null;
  }
  const waitTasks = asArray(detail.validationResults)
    .map((entry) => toText(entry?.id, ""))
    .map((runId) => getActiveValidationTask(runId))
    .filter(Boolean);
  if (waitTasks.length > 0) {
    await Promise.all(waitTasks);
  }
  return {
    group: getWorkItemGroupSummary(groupId, dbPath),
    validationResults: asArray(detail.validationResults).map((entry) =>
      entry?.id ? getSelfBuildWorkItemRun(entry.id, dbPath) : entry,
    ),
  };
}

export async function validateWorkItemGroupBundle(
  groupId,
  payload: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  return queueWorkItemGroupValidationBundle(groupId, payload, dbPath);
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
  if (!resolveProposalSourceRunStatus(run)) {
    return null;
  }
  const workspace = withDatabase(dbPath, (db) =>
    getWorkspaceAllocationByRunId(db, proposal.workItemRunId),
  );
  return (
    toText(run?.result?.executionId, "") ||
    toText(workspace?.executionId, "") ||
    null
  );
}

function buildProposalGovernanceContext(
  proposal,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  if (!proposal) {
    return {
      run: null,
      sourceExecutionId: null,
      blockers: [
        {
          code: "proposal_not_found",
          reason: "Proposal artifact not found.",
        },
      ],
      ready: false,
    };
  }
  const run = proposal.workItemRunId
    ? withDatabase(dbPath, (db) => getWorkItemRun(db, proposal.workItemRunId))
    : null;
  const sourceExecutionId = resolveProposalSourceExecutionId(proposal, dbPath);
  const blockers = [];
  if (!run) {
    blockers.push({
      code: "missing_proposal_source_run",
      reason:
        "Proposal cannot enter review or approval because the originating work-item run is missing.",
    });
  } else if (!resolveProposalSourceRunStatus(run)) {
    blockers.push({
      code: "invalid_proposal_source_run",
      reason: `Proposal cannot enter review or approval because the originating work-item run is ${describeProposalSourceRunStatus(run)}.`,
      runStatus: describeProposalSourceRunStatus(run),
      workItemRunId: run.id,
    });
  }
  if (proposal.kind === "workflow" && !sourceExecutionId) {
    blockers.push({
      code: "missing_promotion_source_execution",
      reason:
        "Proposal cannot be promoted because the originating work-item run has no durable executionId.",
    });
  }
  return {
    run,
    sourceExecutionId,
    blockers,
    ready: blockers.length === 0,
  };
}

function isProposalGovernanceReady(
  proposal,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  return buildProposalGovernanceContext(proposal, dbPath).ready;
}

function resolveProposalPromotionContext(
  proposal,
  options: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const governance = buildProposalGovernanceContext(proposal, dbPath);
  const sourceExecutionId = governance.sourceExecutionId;
  const targetBranch =
    options.targetBranch ??
    proposal?.metadata?.promotion?.targetBranch ??
    "main";
  const integrationBranch =
    options.integrationBranch ??
    proposal?.metadata?.promotion?.integrationBranch ??
    null;
  const blockers = [...governance.blockers];
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

function buildPromotionTrace(governance, readiness) {
  const blockers = dedupe([
    ...asArray(governance?.blockers).map((blocker) => hashPayload(blocker)),
    ...asArray(readiness?.blockers).map((blocker) => hashPayload(blocker)),
  ])
    .map((fingerprint) => {
      const combined = [
        ...asArray(governance?.blockers),
        ...asArray(readiness?.blockers),
      ];
      return (
        combined.find((blocker) => hashPayload(blocker) === fingerprint) ?? null
      );
    })
    .filter(Boolean);
  const reasons = dedupe(
    blockers.map((blocker) => toText(blocker?.reason, "")).filter(Boolean),
  );
  const ready = blockers.length === 0;
  return {
    ready,
    blockers,
    summary: ready
      ? "Promotion is ready because governance and validation gates are satisfied."
      : `Promotion is blocked because ${reasons[0] ?? "required governance or validation evidence is missing"}`,
    reasons,
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
  const governance = buildProposalGovernanceContext(proposal, dbPath);
  const promotion = resolveProposalPromotionContext(proposal, {}, dbPath);
  const readiness = buildProposalValidationStatus(proposal);
  const executionDetail = promotion.sourceExecutionId
    ? getExecutionDetail(promotion.sourceExecutionId, dbPath)
    : null;
  const effectiveProposalStatus = governance.ready
    ? String(proposal.status)
    : "rework_required";
  return {
    proposal: buildProposalSummary(
      {
        ...proposal,
        status: effectiveProposalStatus,
      },
      dbPath,
    ),
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
    governance: {
      ready: governance.ready,
      blockers: governance.blockers,
      sourceExecutionId: governance.sourceExecutionId,
      sourceRunStatus: governance.run?.status ?? null,
    },
    trace: {
      promotion: buildPromotionTrace(governance, readiness),
    },
    reviewHistory: asArray(proposal.metadata?.reviewHistory),
    approvalHistory: asArray(proposal.metadata?.approvalHistory),
    reworkHistory: asArray(proposal.metadata?.reworkHistory),
    suggestedActions: [
      governance.ready && effectiveProposalStatus === "ready_for_review"
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
      governance.ready &&
      ["reviewed", "waiting_approval"].includes(effectiveProposalStatus)
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
      governance.ready &&
      [
        "approved",
        "promotion_ready",
        "validation_required",
        "promotion_blocked",
      ].includes(effectiveProposalStatus)
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
      !governance.ready
        ? {
            action: "rework-proposal",
            targetType: "proposal",
            targetId: proposal.id,
            reason:
              governance.blockers[0]?.reason ??
              "Proposal needs recovery before governance can continue.",
            commandHint: `npm run orchestrator:proposal-review-package -- --proposal ${proposal.id}`,
            httpHint: `/proposal-artifacts/${encodeURIComponent(proposal.id)}/review-package`,
            priority: "high",
          }
        : null,
      ["rework_required", "validation_failed", "promotion_blocked"].includes(
        effectiveProposalStatus,
      )
        ? {
            action: "rework-proposal",
            targetType: "proposal",
            targetId: proposal.id,
            reason:
              String(proposal.status) === "rework_required"
                ? "Proposal was returned for rework."
                : "Proposal needs additional work before validation or promotion can proceed.",
            commandHint: `npm run orchestrator:proposal-rework -- --proposal ${proposal.id}`,
            httpHint: `/proposal-artifacts/${encodeURIComponent(proposal.id)}/rework`,
            priority: "high",
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
  return buildProposalSummary(artifact, dbPath);
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

export async function planProposalPromotion(
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
  const plan = await planPromotionForExecution(promotion.sourceExecutionId, {
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
    proposal: buildProposalSummary(artifact, dbPath),
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
  const planned = await planProposalPromotion(artifactId, options, dbPath);
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
        status: "promotion_candidate",
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
    proposal: proposal
      ? buildProposalSummary(proposal, dbPath)
      : planned.proposal,
    reviewPackage: planned.reviewPackage,
    promotion: planned.promotion,
    detail,
  };
}

export function getProposalByRun(runId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const artifact = withDatabase(dbPath, (db) =>
    getProposalArtifactByRunId(db, runId),
  );
  return buildProposalSummary(artifact, dbPath);
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
    cleanupResult = summarizeWorkspaceCleanupResult(
      await removeWorkspace({
        repoRoot,
        worktreePath: allocation.worktreePath,
        branchName: allocation.branchName ?? null,
        force: options.force === true || cleanupPolicy.requiresForce,
        keepBranch: options.keepBranch === true,
      }),
    );
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
  const governance = buildProposalGovernanceContext(artifact, dbPath);
  if (!governance.ready) {
    const blockedAt = nowIso();
    const updated = {
      ...artifact,
      status: "rework_required",
      updatedAt: blockedAt,
      metadata: {
        ...artifact.metadata,
        governance: {
          ...(artifact.metadata?.governance ?? {}),
          sourceExecutionId: governance.sourceExecutionId,
          blockers: governance.blockers,
          sourceRunStatus: governance.run?.status ?? null,
          lastBlockedAction: "review",
          updatedAt: blockedAt,
        },
        nextAction: "inspect-source-run",
      },
    };
    withDatabase(dbPath, (db) => updateProposalArtifact(db, updated));
    return buildProposalSummary(updated, dbPath);
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
  return buildProposalSummary(updated, dbPath);
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
  const governance = buildProposalGovernanceContext(artifact, dbPath);
  const sourceExecutionId = resolveProposalSourceExecutionId(artifact, dbPath);
  if (approved === "approved" && !governance.ready) {
    const updated = {
      ...artifact,
      status: "rework_required",
      updatedAt: approvedAt,
      metadata: {
        ...artifact.metadata,
        governance: {
          ...(artifact.metadata?.governance ?? {}),
          sourceExecutionId: governance.sourceExecutionId,
          blockers: governance.blockers,
          sourceRunStatus: governance.run?.status ?? null,
          lastBlockedAction: "approval",
          updatedAt: approvedAt,
        },
        promotion: compactObject({
          ...(artifact.metadata?.promotion ?? {}),
          status: "blocked",
          targetBranch:
            decision.targetBranch ?? artifact.metadata?.promotion?.targetBranch,
          integrationBranch: artifact.metadata?.promotion?.integrationBranch,
          sourceExecutionId: governance.sourceExecutionId,
          blockers: governance.blockers,
          updatedAt: approvedAt,
        }),
        nextAction: "inspect-source-run",
      },
    };
    withDatabase(dbPath, (db) => updateProposalArtifact(db, updated));
    return buildProposalSummary(updated, dbPath);
  }
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
  return buildProposalSummary(updated, dbPath);
}

export async function queueWorkItemRunValidation(
  runId,
  options: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const context = loadWorkItemRunValidationContext(runId, options, dbPath);
  if (!context) {
    return null;
  }
  const currentValidation = context.currentValidation;
  if (
    currentValidation &&
    ["queued", "running"].includes(String(currentValidation.status))
  ) {
    if (!getActiveValidationTask(runId)) {
      persistValidationStateForRun(
        runId,
        buildQueuedValidationState(context),
        dbPath,
      );
      ensureWorkItemRunValidationTask(context, options, dbPath);
      return withValidationTrace(
        getSelfBuildWorkItemRun(runId, dbPath),
        context.selection,
      );
    }
    return withValidationTrace(getSelfBuildWorkItemRun(runId, dbPath));
  }
  const queuedState = buildQueuedValidationState(context);
  persistValidationStateForRun(runId, queuedState, dbPath);
  ensureWorkItemRunValidationTask(context, options, dbPath);
  return withValidationTrace(
    getSelfBuildWorkItemRun(runId, dbPath),
    context.selection,
  );
}

export async function waitForWorkItemRunValidation(
  runId,
  options: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const queued = await queueWorkItemRunValidation(runId, options, dbPath);
  if (!queued) {
    return null;
  }
  const task = getActiveValidationTask(runId);
  if (task) {
    await task;
  }
  return withValidationTrace(
    getSelfBuildWorkItemRun(runId, dbPath),
    readValidationTraceSelection(queued),
  );
}

export async function validateWorkItemRun(
  runId,
  options: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  return queueWorkItemRunValidation(runId, options, dbPath);
}

export function getDocSuggestionsForRun(
  runId,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const detail = getSelfBuildWorkItemRun(runId, dbPath);
  if (!detail) {
    return null;
  }
  const suggestions = listSelfBuildDocSuggestionSummaries(
    { workItemRunId: runId, limit: 100 },
    dbPath,
  );
  return {
    runId,
    itemId: detail.workItemId,
    suggestions:
      suggestions.length > 0 ? suggestions : (detail.docSuggestions ?? []),
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

function overrideLinks(record) {
  return {
    self: "/self-build/overrides",
    review: `/self-build/overrides/${encodeURIComponent(record.id)}/review`,
    release: `/self-build/overrides/${encodeURIComponent(record.id)}/release`,
    target:
      record.targetType === "goal-plan"
        ? `/goal-plans/${encodeURIComponent(record.targetId)}`
        : record.targetType === "work-item-group"
          ? `/work-item-groups/${encodeURIComponent(record.targetId)}`
          : record.targetType === "proposal"
            ? `/proposal-artifacts/${encodeURIComponent(record.targetId)}`
            : record.targetType === "integration-branch"
              ? `/integration-branches/${encodeURIComponent(record.targetId)}`
              : null,
  };
}

function buildSelfBuildOverrideSummary(record) {
  if (!record) {
    return null;
  }
  const overrideKind = toText(record.kind, "protected-tier");
  return {
    ...record,
    id: record.id,
    itemType: "protected-override",
    targetType: "self-build-override",
    targetId: record.id,
    overrideId: record.id,
    overrideTargetType: record.targetType,
    overrideTargetId: record.targetId,
    reviewStatus: record.status,
    reviewReason: record.metadata?.reviewReason ?? record.reason ?? "",
    reviewedBy: record.metadata?.reviewedBy ?? null,
    protectedScope:
      record.metadata?.overrideScope ?? record.metadata?.protectedScope ?? null,
    overrideRequestedAt: record.createdAt,
    overrideKind,
    overridesProtectedScopes:
      record.metadata?.bypassProtectedScopes === true ||
      overrideKind === "protected-tier",
    overridesRolloutTier:
      record.metadata?.bypassRolloutTier === true ||
      record.metadata?.bypassRolloutTiers === true ||
      overrideKind === "protected-tier",
    links: overrideLinks(record),
  };
}

function buildPolicyRecommendationReviewSummary(record, recommendation = null) {
  if (!record && !recommendation) {
    return null;
  }
  const recommendationId =
    recommendation?.id ?? record?.recommendationId ?? null;
  const recommendationSummary =
    recommendation ?? record?.metadata?.recommendation ?? null;
  const queueStatus = (() => {
    const raw = String(record?.status ?? "pending_review").trim();
    if (raw === "deferred") return "held";
    if (raw === "rejected") return "dismissed";
    return raw || "pending_review";
  })();
  return {
    ...(recommendationSummary ?? {}),
    ...(record ?? {}),
    id: recommendationId ?? record?.id ?? null,
    itemType: "policy-recommendation",
    targetType: "policy-recommendation",
    targetId: recommendationId,
    recommendationId,
    recommendation: recommendationSummary,
    queueStatus,
    reviewStatus: queueStatus,
    reviewReason: record?.reason ?? "",
    reviewedBy: record?.reviewedBy ?? null,
    materializedIntakeId: record?.materializedIntakeId ?? null,
    materializedGoalPlanId: record?.materializedGoalPlanId ?? null,
    materializedTemplateId:
      recommendationSummary?.templateId ?? record?.metadata?.templateId ?? null,
    links: {
      self: recommendationId
        ? `/self-build/policy-recommendations/${encodeURIComponent(recommendationId)}`
        : "/self-build/policy-recommendations",
      review: recommendationId
        ? `/self-build/policy-recommendations/${encodeURIComponent(recommendationId)}/review`
        : null,
      materialize: recommendationId
        ? `/self-build/policy-recommendations/${encodeURIComponent(recommendationId)}/materialize`
        : null,
      intake: record?.materializedIntakeId
        ? `/self-build/intake/${encodeURIComponent(record.materializedIntakeId)}`
        : null,
      goalPlan: record?.materializedGoalPlanId
        ? `/goal-plans/${encodeURIComponent(record.materializedGoalPlanId)}`
        : null,
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

export function listSelfBuildOverrideSummaries(
  options: SelfBuildOverrideListOptions = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  return withDatabase(dbPath, (db) =>
    listSelfBuildOverrideRecords(db, options),
  ).map(buildSelfBuildOverrideSummary);
}

export function getSelfBuildOverrideSummary(
  overrideId,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const record = withDatabase(dbPath, (db) =>
    getSelfBuildOverrideRecord(db, overrideId),
  );
  return buildSelfBuildOverrideSummary(record);
}

export async function createSelfBuildOverride(
  payload: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const targetType = toText(payload.targetType, "");
  const targetId = toText(payload.targetId, "");
  if (!targetType || !targetId) {
    const error = new Error(
      "self-build override requires targetType and targetId",
    );
    (error as LooseRecord).code = "self_build_override_target_required";
    throw error;
  }
  const existingApproved = withDatabase(dbPath, (db) =>
    findActiveSelfBuildOverrideRecord(
      db,
      targetType,
      targetId,
      payload.kind ?? "protected-tier",
    ),
  );
  if (existingApproved) {
    return buildSelfBuildOverrideSummary(existingApproved);
  }
  const now = nowIso();
  const record = {
    id: payload.id ?? createId("self-build-override"),
    targetType,
    targetId,
    kind: toText(payload.kind, "protected-tier"),
    status: "pending_review",
    reason: toText(
      payload.reason,
      "Human override requested for protected-tier autonomous work.",
    ),
    requestedBy: payload.by ?? "operator",
    source: payload.source ?? "http",
    metadata: mergeMetadata(
      {
        rationale: payload.rationale ?? "",
        bypassProtectedScopes: payload.bypassProtectedScopes !== false,
        bypassRolloutTier: payload.bypassRolloutTier !== false,
        expiresAt: payload.expiresAt ?? null,
      },
      payload.metadata ?? {},
    ),
    createdAt: now,
    updatedAt: now,
    releasedAt: null,
  };
  withDatabase(dbPath, (db) => insertSelfBuildOverrideRecord(db, record));
  return buildSelfBuildOverrideSummary(record);
}

export async function reviewSelfBuildOverride(
  overrideId,
  payload: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const record = withDatabase(dbPath, (db) =>
    getSelfBuildOverrideRecord(db, overrideId),
  );
  if (!record) {
    return null;
  }
  const now = nowIso();
  const requestedStatus = String(payload.status ?? "").trim();
  const status =
    requestedStatus === "held"
      ? "held"
      : requestedStatus === "rejected"
        ? "rejected"
        : "approved";
  const updated = {
    ...record,
    status,
    updatedAt: now,
    metadata: mergeMetadata(record.metadata ?? {}, {
      reviewReason: payload.reason ?? payload.comments ?? "",
      reviewedBy: payload.by ?? "operator",
      reviewedAt: now,
    }),
  };
  withDatabase(dbPath, (db) => updateSelfBuildOverrideRecord(db, updated));
  return buildSelfBuildOverrideSummary(updated);
}

export async function releaseSelfBuildOverride(
  overrideId,
  payload: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const record = withDatabase(dbPath, (db) =>
    getSelfBuildOverrideRecord(db, overrideId),
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
      releasedAt: now,
    }),
  };
  withDatabase(dbPath, (db) => updateSelfBuildOverrideRecord(db, updated));
  return buildSelfBuildOverrideSummary(updated);
}

export function listPolicyRecommendationReviewSummaries(
  options: PolicyRecommendationReviewListOptions = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const reviews = withDatabase(dbPath, (db) =>
    listPolicyRecommendationReviews(db, options),
  );
  const byRecommendationId = new Map(
    reviews.map((review) => [String(review.recommendationId), review]),
  );
  const currentRecommendations = getSelfBuildPolicyRecommendations(dbPath);
  const activeSummaries = currentRecommendations.map((recommendation) =>
    buildPolicyRecommendationReviewSummary(
      byRecommendationId.get(String(recommendation.id)) ?? null,
      recommendation,
    ),
  );
  const staleReviews = reviews
    .filter(
      (review) =>
        !currentRecommendations.some(
          (recommendation) =>
            String(recommendation.id) === String(review.recommendationId),
        ),
    )
    .map((review) => buildPolicyRecommendationReviewSummary(review, null));
  return [...activeSummaries, ...staleReviews];
}

export async function reviewPolicyRecommendation(
  recommendationId,
  payload: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const recommendation = getSelfBuildPolicyRecommendations(dbPath).find(
    (entry) => String(entry.id) === String(recommendationId),
  );
  if (!recommendation) {
    return null;
  }
  const now = nowIso();
  const existing = withDatabase(dbPath, (db) =>
    getPolicyRecommendationReviewByRecommendationId(db, recommendationId),
  );
  const requestedStatus = String(payload.status ?? "").trim();
  const normalizedStatus =
    requestedStatus === "held" || requestedStatus === "deferred"
      ? "held"
      : requestedStatus === "dismissed" || requestedStatus === "rejected"
        ? "dismissed"
        : "accepted";
  const record = {
    id: existing?.id ?? createId("policy-rec-review"),
    recommendationId,
    status: normalizedStatus,
    reason: payload.reason ?? payload.comments ?? "",
    reviewedBy: payload.by ?? "operator",
    source: payload.source ?? "http",
    materializedIntakeId: existing?.materializedIntakeId ?? null,
    materializedGoalPlanId: existing?.materializedGoalPlanId ?? null,
    metadata: mergeMetadata(existing?.metadata ?? {}, {
      recommendation,
    }),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    reviewedAt: now,
    materializedAt: existing?.materializedAt ?? null,
  };
  withDatabase(dbPath, (db) => upsertPolicyRecommendationReview(db, record));
  return buildPolicyRecommendationReviewSummary(record, recommendation);
}

export async function materializePolicyRecommendation(
  recommendationId,
  payload: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const recommendation = getSelfBuildPolicyRecommendations(dbPath).find(
    (entry) => String(entry.id) === String(recommendationId),
  );
  if (!recommendation) {
    return null;
  }
  const now = nowIso();
  const existing = withDatabase(dbPath, (db) =>
    getPolicyRecommendationReviewByRecommendationId(db, recommendationId),
  );
  let materializedGoalPlanId = existing?.materializedGoalPlanId ?? null;
  let materializedIntakeId = existing?.materializedIntakeId ?? null;
  const mode = toText(payload.mode, "goal-plan");
  if (mode === "intake") {
    const projectId = payload.projectId ?? "spore";
    const resolvedPolicy = await loadProjectSelfBuildPolicy(projectId);
    const autonomyPolicy = resolvedPolicy.autonomy;
    const candidate = {
      id: createId("intake"),
      sourceType: "policy-recommendation",
      sourceId: recommendation.id,
      kind: "policy-follow-up",
      status: "accepted",
      priority: 0,
      goal: buildIntakeGoalFromPolicyRecommendation(recommendation),
      projectId,
      domainId: recommendation.domainId ?? payload.domain ?? "docs",
      templateId:
        payload.templateId ??
        recommendation.templateId ??
        "docs-maintenance-pass",
      goalPlanId: null,
      metadata: {
        recommendation,
        sourceSummary: recommendation.summary,
        sourceKind: recommendation.kind,
        diagnostics: recommendation.diagnostics ?? null,
      },
      consumedAt: null,
    };
    const scoring = scoreSelfBuildIntakeCandidate(candidate, autonomyPolicy);
    const intakeRecord = withDatabase(dbPath, (db) =>
      upsertSelfBuildIntakeRecord(db, {
        ...candidate,
        priority: scoring.score,
        updatedAt: now,
        createdAt: now,
        metadata: mergeMetadata(candidate.metadata ?? {}, {
          priorityScore: scoring.score,
          priorityLabel: scoring.label,
          priorityReason: scoring.reason,
        }),
      }),
    );
    materializedIntakeId = intakeRecord?.id ?? materializedIntakeId;
  } else {
    const goalPlan = await createGoalPlan(
      {
        goal: recommendation.goal,
        title: recommendation.summary,
        projectId: payload.projectId ?? "spore",
        domain: recommendation.domainId ?? payload.domain ?? "docs",
        source: payload.source ?? "policy-recommendation",
        by: payload.by ?? "operator",
        safeMode: payload.safeMode !== false,
        reviewRequired: payload.reviewRequired !== false,
      },
      dbPath,
    );
    materializedGoalPlanId = goalPlan?.id ?? materializedGoalPlanId;
  }

  const record = {
    id: existing?.id ?? createId("policy-rec-review"),
    recommendationId,
    status:
      existing?.status && existing.status !== "pending_review"
        ? existing.status
        : "accepted",
    reason:
      existing?.reason ?? payload.reason ?? "Materialized to managed work.",
    reviewedBy: existing?.reviewedBy ?? payload.by ?? "operator",
    source: payload.source ?? existing?.source ?? "http",
    materializedIntakeId,
    materializedGoalPlanId,
    metadata: mergeMetadata(existing?.metadata ?? {}, {
      recommendation,
      materializationMode: mode,
      templateId: payload.templateId ?? recommendation.templateId ?? null,
    }),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    reviewedAt: existing?.reviewedAt ?? now,
    materializedAt: now,
  };
  withDatabase(dbPath, (db) => upsertPolicyRecommendationReview(db, record));
  return buildPolicyRecommendationReviewSummary(record, recommendation);
}

export function getPolicyRecommendationSummary(
  recommendationId,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const recommendation = getSelfBuildPolicyRecommendations(dbPath).find(
    (entry) => String(entry.id) === String(recommendationId),
  );
  if (recommendation) {
    return recommendation;
  }
  const review = withDatabase(dbPath, (db) =>
    getPolicyRecommendationReviewByRecommendationId(db, recommendationId),
  );
  return buildPolicyRecommendationReviewSummary(review, null);
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
  details: LooseRecord = {},
) {
  return {
    kind,
    eligible,
    reasons,
    mode: policy.mode ?? "supervised",
    policy,
    ...details,
  };
}

function getActiveProtectedTierOverride(
  targetType,
  targetId,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const record = withDatabase(dbPath, (db) =>
    findActiveSelfBuildOverrideRecord(
      db,
      targetType,
      targetId,
      "protected-tier",
    ),
  );
  if (!record) {
    return null;
  }
  const expiresAt = record.metadata?.expiresAt
    ? new Date(String(record.metadata.expiresAt)).getTime()
    : null;
  if (expiresAt && Number.isFinite(expiresAt) && expiresAt < Date.now()) {
    return null;
  }
  return buildSelfBuildOverrideSummary(record);
}

function applyProtectedTierOverride(
  evaluation,
  targetType,
  targetId,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const override = getActiveProtectedTierOverride(targetType, targetId, dbPath);
  if (!override) {
    return evaluation;
  }
  const filteredReasons = asArray(evaluation?.reasons).filter((reason) => {
    const text = String(reason ?? "");
    if (
      override.overridesProtectedScopes &&
      (text.includes("protected scopes present") ||
        text.includes("protected scope"))
    ) {
      return false;
    }
    if (
      override.overridesRolloutTier &&
      text.includes("no rollout tier allows")
    ) {
      return false;
    }
    return true;
  });
  return {
    ...evaluation,
    eligible: filteredReasons.length === 0,
    reasons: filteredReasons,
    matchedTiers:
      override.overridesRolloutTier &&
      asArray(evaluation?.matchedTiers).length === 0
        ? ["override:protected-tier"]
        : (evaluation?.matchedTiers ?? []),
    protectedScopeBlocks: override.overridesProtectedScopes
      ? []
      : (evaluation?.protectedScopeBlocks ?? []),
    overrideApplied: true,
    override,
  };
}

function isMutationScopeAllowed(
  scopes: string[] = [],
  policy: LooseRecord = {},
) {
  const allowedScopes = dedupe(policy.allowedMutationScopes ?? []);
  const protectedScopes = dedupe(policy.protectedScopes ?? []);
  const blockedProtected = dedupe(
    scopes.filter((scope) => matchesPathPrefix(scope, protectedScopes)),
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

function evaluateGoalPlanAutonomousEligibility(
  plan,
  policy: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const reasons = [];
  const matchedTiers = [];
  const protectedScopeBlocks = [];
  const taskClasses = [];
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
    const context = buildAutonomyTargetContext(recommendation);
    const templateId = context.templateId || null;
    taskClasses.push(context.taskClass);
    if (
      templateId &&
      policy.allowedTemplates?.length > 0 &&
      !policy.allowedTemplates.includes(templateId)
    ) {
      reasons.push(`template not allowed for autonomy: ${templateId}`);
    }
    const scopeCheck = isMutationScopeAllowed(context.mutationScope, policy);
    if (!scopeCheck.allowed && scopeCheck.reason) {
      reasons.push(scopeCheck.reason);
    }
    const protectedCheck = evaluateProtectedScopeGuardrails(context, policy);
    if (protectedCheck.blocked.length > 0) {
      protectedScopeBlocks.push(...protectedCheck.blocked);
      reasons.push(protectedCheck.blockedReason);
    }
    const tierMatches = findMatchingRolloutTiers(context, policy);
    if (policy.rolloutTiers?.length > 0 && tierMatches.length === 0) {
      reasons.push(
        `no rollout tier allows ${templateId || context.taskClass} for ${
          context.domainId || "unknown-domain"
        }`,
      );
    }
    matchedTiers.push(...tierMatches.map((tier) => tier.id));
  }
  return applyProtectedTierOverride(
    summarizeAutonomyEvaluation(
      "goal-plan",
      reasons.length === 0,
      dedupe(reasons),
      policy,
      {
        matchedTiers: dedupe(matchedTiers),
        protectedScopeBlocks: dedupe(protectedScopeBlocks),
        taskClasses: dedupe(taskClasses),
      },
    ),
    "goal-plan",
    plan.id,
    dbPath,
  );
}

function evaluateGroupAutonomousEligibility(
  group,
  policy: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const reasons = [];
  const matchedTiers = [];
  const protectedScopeBlocks = [];
  const taskClasses = [];
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
    const context = buildAutonomyTargetContext(item);
    const templateId = context.templateId || null;
    taskClasses.push(context.taskClass);
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
    if (policy.requireSafeMode === true && context.safeMode === false) {
      reasons.push(`item not in safe mode: ${item.id}`);
    }
    const scopeCheck = isMutationScopeAllowed(context.mutationScope, policy);
    if (!scopeCheck.allowed && scopeCheck.reason) {
      reasons.push(`${item.id}: ${scopeCheck.reason}`);
    }
    const protectedCheck = evaluateProtectedScopeGuardrails(context, policy);
    if (protectedCheck.blocked.length > 0) {
      protectedScopeBlocks.push(...protectedCheck.blocked);
      reasons.push(`${item.id}: ${protectedCheck.blockedReason}`);
    }
    const tierMatches = findMatchingRolloutTiers(context, policy);
    if (policy.rolloutTiers?.length > 0 && tierMatches.length === 0) {
      reasons.push(
        `${item.id}: no rollout tier allows ${templateId || context.taskClass}`,
      );
    }
    matchedTiers.push(...tierMatches.map((tier) => tier.id));
  }
  return applyProtectedTierOverride(
    summarizeAutonomyEvaluation(
      "work-item-group",
      reasons.length === 0,
      dedupe(reasons),
      policy,
      {
        matchedTiers: dedupe(matchedTiers),
        protectedScopeBlocks: dedupe(protectedScopeBlocks),
        taskClasses: dedupe(taskClasses),
      },
    ),
    "work-item-group",
    group.id,
    dbPath,
  );
}

function evaluateProposalPromotionAutonomy(
  proposal,
  policy: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const reasons = [];
  const context = buildAutonomyTargetContext({
    templateId: proposal.summary?.templateId ?? proposal.metadata?.templateId,
    domainId: proposal.summary?.domainId ?? proposal.metadata?.domainId,
    mutationScope:
      proposal.summary?.mutationScope ??
      proposal.metadata?.mutationScope ??
      proposal.artifacts?.workspace?.mutationScope ??
      [],
    targetPaths:
      proposal.summary?.targetPaths ??
      proposal.metadata?.targetPaths ??
      proposal.artifacts?.workspace?.mutationScope ??
      [],
    safeMode: proposal.metadata?.safeMode ?? true,
    taskClass: proposal.summary?.taskClass ?? proposal.metadata?.taskClass,
  });
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
  const scopeCheck = isMutationScopeAllowed(context.mutationScope, policy);
  if (!scopeCheck.allowed && scopeCheck.reason) {
    reasons.push(scopeCheck.reason);
  }
  const protectedCheck = evaluateProtectedScopeGuardrails(context, policy);
  if (protectedCheck.blocked.length > 0) {
    reasons.push(protectedCheck.blockedReason);
  }
  const matchedTiers = findMatchingRolloutTiers(context, policy);
  if (policy.rolloutTiers?.length > 0 && matchedTiers.length === 0) {
    reasons.push(
      `no rollout tier allows ${context.templateId || context.taskClass}`,
    );
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
  return applyProtectedTierOverride(
    summarizeAutonomyEvaluation(
      "proposal",
      reasons.length === 0,
      dedupe(reasons),
      policy,
      {
        matchedTiers: dedupe(matchedTiers.map((tier) => tier.id)),
        protectedScopeBlocks: protectedCheck.blocked,
        taskClasses: dedupe([context.taskClass]),
      },
    ),
    "proposal",
    proposal.id,
    dbPath,
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
    } else if (record.targetType === "proposal") {
      const artifact = getProposalArtifact(db, record.targetId);
      if (artifact) {
        updateProposalArtifact(db, {
          ...artifact,
          status:
            payload.nextStatus ??
            (String(artifact.status) === "promotion_blocked"
              ? "validation_required"
              : artifact.status),
          updatedAt: now,
          metadata: mergeMetadata(artifact.metadata ?? {}, {
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
    diagnostics: buildIntegrationBranchDiagnostics(branch),
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
    diagnostics: buildIntegrationBranchDiagnostics(branch),
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
  const overrideRecords = listSelfBuildOverrideSummaries(
    { targetType, targetId, kind: "protected-tier", limit: 10 },
    dbPath,
  );
  if (
    overrideRecords.some((record) =>
      ["pending_review", "approved"].includes(String(record.status)),
    )
  ) {
    return null;
  }
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
  const intakeRecords = await refreshSelfBuildIntake(
    { includeAccepted: true },
    dbPath,
  );
  const queuedIntake = [...intakeRecords]
    .filter((entry) => ["queued", "accepted"].includes(String(entry.status)))
    .sort((left, right) => {
      const leftAccepted = left.status === "accepted" ? 0 : 1;
      const rightAccepted = right.status === "accepted" ? 0 : 1;
      if (leftAccepted !== rightAccepted) {
        return leftAccepted - rightAccepted;
      }
      return (
        Number(right.priorityScore ?? right.priority ?? 0) -
        Number(left.priorityScore ?? left.priority ?? 0)
      );
    })[0];
  if (queuedIntake) {
    const decisionRationale =
      "Autonomous loop evaluated self-build intake for goal-plan materialization.";
    await recordSelfBuildDecision(
      {
        loopId: loopState?.id ?? "default",
        mode: policy.mode,
        state: policy.autoReviewGoalPlans === true ? "eligible" : "blocked",
        action: "evaluate-intake",
        targetType: "self-build-intake",
        targetId: queuedIntake.id,
        rationale:
          policy.autoReviewGoalPlans === true
            ? decisionRationale
            : "Autonomous policy allows intake refresh but not autonomous goal-plan review/materialization.",
        policy,
        metadata: {
          intake: queuedIntake,
        },
      },
      dbPath,
    );
    if (policy.autoReviewGoalPlans === true) {
      const materialized = await materializeSelfBuildIntake(
        queuedIntake.id,
        {
          by,
          source,
          mode: policy.mode === "supervised" ? "supervised" : "autonomous",
          safeMode:
            queuedIntake.safeMode !== undefined ? queuedIntake.safeMode : true,
        },
        dbPath,
      );
      if (materialized?.goalPlan?.id) {
        const reviewStatus =
          materialized.goalPlan.metadata?.reviewRequired !== false
            ? "reviewed"
            : null;
        if (reviewStatus) {
          await reviewGoalPlan(
            materialized.goalPlan.id,
            {
              status: reviewStatus,
              by,
              source,
              comments:
                "Autonomous loop reviewed a self-build intake-derived goal plan.",
              reason:
                "Autonomous intake materialization created a goal plan eligible for auto-review.",
            },
            dbPath,
          );
        }
        await recordSelfBuildDecision(
          {
            loopId: loopState?.id ?? "default",
            mode: policy.mode,
            state: "executed",
            action: "materialize-intake",
            targetType: "self-build-intake",
            targetId: queuedIntake.id,
            rationale: "Autonomous loop materialized intake into a goal plan.",
            policy,
            metadata: {
              goalPlanId: materialized.goalPlan.id,
              intakeId: queuedIntake.id,
            },
          },
          dbPath,
        );
        return {
          action: "materialize-intake",
          intakeId: queuedIntake.id,
          result: materialized,
        };
      }
    }
  }
  const plannedGoal = listGoalPlansSummary({ limit: 20 }, dbPath).find((plan) =>
    ["planned", "reviewed"].includes(String(plan.status)),
  );
  if (plannedGoal) {
    const evaluation = evaluateGoalPlanAutonomousEligibility(
      plannedGoal,
      policy,
      dbPath,
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
      dbPath,
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
    const result = await queueWorkItemGroupValidationBundle(
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
    .map((proposal) => buildProposalSummary(proposal, dbPath))
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
    const evaluation = evaluateGroupAutonomousEligibility(
      group,
      policy,
      dbPath,
    );
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

function buildRolloutTierSummary(
  policy: AutonomousPolicyConfig,
  targets: LooseRecord[] = [],
) {
  const tiers = policy.rolloutTiers.map((tier) => {
    const matchedTargetIds = targets
      .filter((target) =>
        findMatchingRolloutTiers(target, policy).some(
          (match) => match.id === tier.id,
        ),
      )
      .map((target) =>
        toText(target.id ?? target.title ?? target.goal, "target"),
      );
    return {
      id: tier.id,
      label: tier.label,
      enabled: tier.enabled,
      description: tier.description,
      protectedScopes: tier.protectedScopes,
      requiredValidationBundles: tier.requiredValidationBundles,
      activeTargetCount: matchedTargetIds.length,
      matchedTargetIds: dedupe(matchedTargetIds).slice(0, 10),
    };
  });
  const unmatchedTargets = targets
    .filter((target) => {
      if (tiers.length === 0) {
        return false;
      }
      return findMatchingRolloutTiers(target, policy).length === 0;
    })
    .map((target) => {
      const context = buildAutonomyTargetContext(target);
      return {
        id: toText(target.id ?? "", ""),
        label: toText(
          target.title ?? target.goal ?? target.id,
          "Unknown target",
        ),
        targetPaths: context.targetPaths,
        taskClass: context.taskClass,
      };
    })
    .slice(0, 20);
  return {
    tierCount: tiers.length,
    enabledCount: tiers.filter((tier) => tier.enabled !== false).length,
    tiers,
    unmatchedTargetCount: unmatchedTargets.length,
    unmatchedTargets,
  };
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
  ).map((proposal) => buildProposalSummary(proposal, dbPath));
  const workspaces = withDatabase(dbPath, (db) =>
    listWorkspaceAllocations(db, { limit: 200 }),
  ).map(buildWorkspaceSummary);
  const learnings = withDatabase(dbPath, (db) =>
    listLearningRecords(db, null, 100),
  ).map(buildLearningSummary);
  const docSuggestions = listSelfBuildDocSuggestionSummaries(
    { limit: 100 },
    dbPath,
  );
  const queuedIntake = listSelfBuildIntakeSummaries({ limit: 100 }, dbPath);
  const integrationBranches = listIntegrationBranchSummaries(
    { limit: 50 },
    dbPath,
  );
  const loopStatus = getSelfBuildLoopStatus(dbPath);
  const autonomyPolicy =
    loadProjectSelfBuildPolicySync("spore").autonomy ??
    normalizeAutonomousPolicy(
      asJsonObject(
        withDatabase(dbPath, (db) => getSelfBuildLoopState(db, "default"))
          ?.policy,
      ),
    );
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
    (proposal) =>
      proposal.status === "ready_for_review" &&
      isProposalGovernanceReady(proposal, dbPath),
  );
  const waitingApprovalProposals = proposals.filter(
    (proposal) =>
      ["reviewed", "waiting_approval"].includes(proposal.status) &&
      isProposalGovernanceReady(proposal, dbPath),
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
  const learningTrends = getSelfBuildLearningTrends(dbPath);
  const policyRecommendations = getSelfBuildPolicyRecommendations(dbPath);
  const protectedTierOverrides = listSelfBuildOverrideSummaries(
    { kind: "protected-tier", limit: 100 },
    dbPath,
  );
  const policyRecommendationReviews = listPolicyRecommendationReviewSummaries(
    { limit: 100 },
    dbPath,
  );
  const pendingDocSuggestions = docSuggestions.filter((entry) =>
    ["pending", "accepted"].includes(String(entry.status)),
  );
  const queuedAutonomousIntake = queuedIntake.filter((entry) =>
    ["queued", "accepted"].includes(String(entry.status)),
  );
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
  const protectedScopeBlocks = autonomousBlockedDecisions
    .flatMap((decision) =>
      asArray(decision.metadata?.evaluation?.protectedScopeBlocks).map(
        (scope) => ({
          scope,
          decisionId: decision.id,
          targetType: decision.targetType ?? null,
          targetId: decision.targetId ?? null,
          reason: decision.rationale ?? null,
        }),
      ),
    )
    .slice(0, 20);
  const rolloutTargets = [
    ...workItems,
    ...goalPlans.flatMap((plan) => getGoalPlanEffectiveRecommendations(plan)),
    ...proposals.map((proposal) => ({
      id: proposal.id,
      title: proposal.summary?.title ?? proposal.id,
      metadata: {
        templateId:
          proposal.summary?.templateId ?? proposal.metadata?.templateId,
        domainId: proposal.summary?.domainId ?? proposal.metadata?.domainId,
        mutationScope:
          proposal.summary?.mutationScope ??
          proposal.metadata?.mutationScope ??
          proposal.artifacts?.workspace?.mutationScope ??
          [],
        targetPaths:
          proposal.summary?.targetPaths ??
          proposal.metadata?.targetPaths ??
          proposal.artifacts?.workspace?.mutationScope ??
          [],
        safeMode: proposal.metadata?.safeMode ?? true,
        taskClass: proposal.summary?.taskClass ?? proposal.metadata?.taskClass,
      },
    })),
  ];
  const rolloutTierSummary = buildRolloutTierSummary(
    autonomyPolicy,
    rolloutTargets,
  );
  const activeAutonomousRuns = allRuns
    .filter((run) => {
      const executionMode = String(
        run.metadata?.autonomy?.mode ??
          run.metadata?.sourceContext?.autonomyMode ??
          "",
      ).trim();
      const sourceType = String(
        run.metadata?.sourceContext?.sourceType ?? run.metadata?.source ?? "",
      ).trim();
      return (
        run.status === "running" &&
        (executionMode === "autonomous" ||
          sourceType === "self-build-intake" ||
          sourceType === "policy-recommendation" ||
          sourceType === "learning-record")
      );
    })
    .slice(0, 20);
  const blockedPromotionQueue = proposalsBlockedForPromotion.slice(0, 20);
  const pendingValidationQueue = validationRequiredProposals.slice(0, 20);
  const quarantineQueue = activeQuarantines.slice(0, 20);
  const overrideQueue = protectedTierOverrides.filter((record) =>
    ["pending_review", "approved", "held"].includes(String(record.status)),
  );
  const recommendationReviewQueue = policyRecommendations.filter((record) =>
    ["pending_review", "accepted", "held"].includes(
      String(record.queueStatus ?? ""),
    ),
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
    ...overrideQueue.map((record) =>
      buildAttentionItem({
        id: `attention:${record.id}:override`,
        kind: "protected-override",
        attentionState:
          record.status === "pending_review" ? "needs-review" : "blocked",
        targetType: record.targetType,
        targetId: record.targetId,
        goalPlanId: record.targetType === "goal-plan" ? record.targetId : null,
        groupId:
          record.targetType === "work-item-group" ? record.targetId : null,
        proposalId: record.targetType === "proposal" ? record.targetId : null,
        title: record.summary,
        reason:
          record.reason ||
          "Protected-tier override exists and should be reviewed before autonomy proceeds.",
        httpHint: record.links?.self ?? null,
        commandHint: `npm run orchestrator:self-build-overrides -- --target-type ${record.targetType} --target-id ${record.targetId}`,
        nextActionHint:
          "Review or release the override explicitly when the protected target is safe to continue.",
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
    ...pendingDocSuggestions.slice(0, 10).map((entry) =>
      buildAttentionItem({
        id: `attention:${entry.id}:doc-suggestion`,
        attentionState:
          entry.status === "accepted" ? "planner-follow-up" : "docs-follow-up",
        targetType: "doc-suggestion",
        targetId: entry.id,
        runId: entry.workItemRunId ?? null,
        itemId: entry.workItemId ?? null,
        title: entry.summary,
        reason:
          entry.status === "accepted"
            ? "Accepted doc suggestion is waiting to be materialized into managed work."
            : "Doc suggestion is waiting for review.",
        httpHint: entry.links?.self ?? null,
        commandHint:
          entry.status === "accepted"
            ? `npm run orchestrator:doc-suggestion-materialize -- --suggestion ${entry.id}`
            : `npm run orchestrator:doc-suggestion-review -- --suggestion ${entry.id} --status accepted`,
        timestamp: entry.updatedAt ?? entry.createdAt,
      }),
    ),
    ...queuedAutonomousIntake.slice(0, 10).map((entry) =>
      buildAttentionItem({
        id: `attention:${entry.id}:intake`,
        attentionState: "planner-follow-up",
        targetType: "self-build-intake",
        targetId: entry.id,
        title: entry.goal,
        reason:
          entry.status === "accepted"
            ? "Accepted self-build intake is waiting for materialization."
            : "Queued self-build intake is waiting for autonomous or operator materialization.",
        httpHint: entry.links?.self ?? null,
        commandHint:
          entry.status === "accepted"
            ? `npm run orchestrator:self-build-intake-materialize -- --intake ${entry.id}`
            : `npm run orchestrator:self-build-intake-review -- --intake ${entry.id} --status accepted`,
        timestamp: entry.updatedAt ?? entry.createdAt,
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
    ...recommendationReviewQueue.slice(0, 10).map((record) =>
      buildAttentionItem({
        id: `attention:${record.id}:policy-recommendation`,
        attentionState: "planner-follow-up",
        targetType: "policy-recommendation",
        targetId: record.id,
        title: record.summary,
        reason:
          record.queueStatus === "accepted"
            ? "Accepted policy recommendation is waiting to be materialized into a goal plan."
            : "Policy recommendation is waiting for operator review.",
        httpHint: record.links?.review ?? record.links?.self ?? null,
        commandHint:
          record.queueStatus === "accepted"
            ? `npm run orchestrator:self-build-policy-recommendation-materialize -- --recommendation ${record.id}`
            : `npm run orchestrator:self-build-policy-recommendation-review -- --recommendation ${record.id} --status accepted`,
        timestamp: record.reviewedAt ?? record.updatedAt ?? record.createdAt,
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
      docSuggestions: docSuggestions.length,
      pendingDocSuggestions: pendingDocSuggestions.length,
      autonomousIntake: queuedIntake.length,
      queuedAutonomousIntake: queuedAutonomousIntake.length,
      goalPlans: goalPlans.length,
      plannedGoalPlans: plannerFollowUpPlans.length,
      integrationBranches: integrationBranches.length,
      integrationBranchIssues: integrationBranches.filter(
        (branch) => (branch.diagnostics?.issueCount ?? 0) > 0,
      ).length,
      activeQuarantines: activeQuarantines.length,
      recentRollbacks: recentRollbacks.length,
      autonomousBlockedDecisions: autonomousBlockedDecisions.length,
      policyRecommendations: policyRecommendations.length,
      protectedTierOverrides: protectedTierOverrides.length,
      policyRecommendationReviews: policyRecommendationReviews.length,
      policyRecommendationQueue: recommendationReviewQueue.length,
      repeatedLearningTrends: learningTrends.filter((entry) => entry.repeated)
        .length,
      protectedScopeBlocks: protectedScopeBlocks.length,
      activeAutonomousRuns: activeAutonomousRuns.length,
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
    docSuggestionQueue: pendingDocSuggestions.slice(0, 20),
    autonomousIntake: queuedAutonomousIntake.slice(0, 20),
    loopStatus,
    recentDecisions,
    activeQuarantines,
    recentRollbacks,
    learningRecords: recentLearnings,
    learningTrends,
    policyRecommendations,
    policyRecommendationReviews,
    policyRecommendationQueue: recommendationReviewQueue,
    rolloutTierSummary,
    protectedScopeBlocks,
    protectedTierOverrides,
    overrides: protectedTierOverrides,
    activeAutonomousRuns,
    blockedPromotions: blockedPromotionQueue,
    pendingValidations: pendingValidationQueue,
    quarantines: quarantineQueue,
    lifecycle: {
      blockedPromotions: blockedPromotionQueue.length,
      pendingValidations: pendingValidationQueue.length,
      activeAutonomousRuns: activeAutonomousRuns.length,
      quarantinedWork: quarantineQueue.length,
      protectedTierOverrides: overrideQueue.length,
      policyRecommendationQueue: recommendationReviewQueue.length,
      policyRecommendationReviews: policyRecommendationReviews.length,
    },
    lifecycleBlockedPromotions: blockedPromotionQueue,
    lifecycleValidationQueue: pendingValidationQueue,
    lifecycleActiveAutonomousRuns: activeAutonomousRuns,
    lifecycleQuarantineQueue: quarantineQueue,
    lifecycleProtectedOverrideQueue: overrideQueue,
    lifecyclePolicyRecommendationQueue: recommendationReviewQueue,
    autonomyPolicy: {
      mode: autonomyPolicy.mode,
      enabled: autonomyPolicy.enabled,
      protectedScopes: autonomyPolicy.protectedScopes,
      requiredValidationBundles: autonomyPolicy.requiredValidationBundles,
    },
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
    docSuggestionQueue: base.docSuggestionQueue,
    autonomousIntake: base.autonomousIntake,
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
