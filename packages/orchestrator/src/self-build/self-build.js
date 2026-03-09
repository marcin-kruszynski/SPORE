import crypto from "node:crypto";

import { DEFAULT_ORCHESTRATOR_DB_PATH } from "../metadata/constants.js";
import { getRegressionDefinition, getScenarioDefinition, getWorkItemTemplateDefinition, listWorkItemTemplateDefinitions } from "../scenarios/catalog.js";
import { getRegressionRunSummaryById, getScenarioRunSummaryById, runRegressionById, runScenarioById } from "../scenarios/run-history.js";
import {
  getGoalPlan,
  getLearningRecord,
  getProposalArtifact,
  getProposalArtifactByRunId,
  getWorkItem,
  getWorkItemGroup,
  getWorkItemRun,
  insertGoalPlan,
  insertLearningRecord,
  insertProposalArtifact,
  insertWorkItemGroup,
  listGoalPlans,
  listLearningRecords,
  listProposalArtifacts,
  listWorkItemGroups,
  listWorkItemRuns,
  listWorkItems,
  openOrchestratorDatabase,
  updateGoalPlan,
  updateLearningRecord,
  updateProposalArtifact,
  updateWorkItem,
  updateWorkItemGroup,
  updateWorkItemRun
} from "../store/execution-store.js";
import { createWorkItem, getManagedWorkItem, getManagedWorkItemRun, listManagedWorkItems, runManagedWorkItem } from "../work-items/work-items.js";

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

function mergeMetadata(...values) {
  return Object.assign({}, ...values.filter((value) => value && typeof value === "object" && !Array.isArray(value)));
}

function compactObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== "")
  );
}

function dedupe(values) {
  return Array.from(new Set(asArray(values).map((value) => String(value).trim()).filter(Boolean)));
}

function groupLinks(groupId) {
  return {
    self: `/work-item-groups/${encodeURIComponent(groupId)}`,
    run: `/work-item-groups/${encodeURIComponent(groupId)}/run`
  };
}

function goalPlanLinks(planId) {
  return {
    self: `/goal-plans/${encodeURIComponent(planId)}`,
    materialize: `/goal-plans/${encodeURIComponent(planId)}/materialize`
  };
}

function proposalLinks(artifactId) {
  return {
    self: `/proposal-artifacts/${encodeURIComponent(artifactId)}`,
    review: `/proposal-artifacts/${encodeURIComponent(artifactId)}/review`,
    approval: `/proposal-artifacts/${encodeURIComponent(artifactId)}/approval`
  };
}

function workItemKindRequiresProposal(item) {
  return item.kind === "workflow" || item.metadata?.requiresProposal === true || item.metadata?.codeOriented === true;
}

function buildTemplatePayload(template, payload = {}) {
  const templateMetadata = template.defaultMetadata ?? template.metadata ?? {};
  const payloadMetadata = compactObject(payload.metadata ?? {});
  return {
    ...payload,
    title: payload.title ?? template.label ?? template.id,
    kind: payload.kind ?? template.kind,
    goal: toText(payload.goal, template.defaultGoal ?? ""),
    priority: payload.priority ?? template.priority ?? "medium",
    acceptanceCriteria: dedupe([...(template.acceptanceCriteria ?? []), ...(payload.acceptanceCriteria ?? [])]),
    relatedDocs: dedupe([...(template.relatedDocs ?? []), ...(payload.relatedDocs ?? [])]),
    relatedScenarios: dedupe([...(template.recommendedScenarios ?? []), ...(payload.relatedScenarios ?? [])]),
    relatedRegressions: dedupe([...(template.recommendedRegressions ?? []), ...(payload.relatedRegressions ?? [])]),
    metadata: mergeMetadata(templateMetadata, payloadMetadata, {
      templateId: template.id,
      recommendedScenarios: dedupe([...(template.recommendedScenarios ?? []), ...(payloadMetadata.recommendedScenarios ?? [])]),
      recommendedRegressions: dedupe([...(template.recommendedRegressions ?? []), ...(payloadMetadata.recommendedRegressions ?? [])]),
      safeModeEligible: template.safeModeEligible !== false,
      selfBuildEligible: template.selfBuildEligible !== false
    })
  };
}

function extractGoalDomain(goal = "", explicitDomain = null) {
  if (explicitDomain) {
    return explicitDomain;
  }
  const normalized = String(goal).toLowerCase();
  if (normalized.includes("doc") || normalized.includes("adr") || normalized.includes("readme")) {
    return "docs";
  }
  if (normalized.includes("cli") || normalized.includes("terminal") || normalized.includes("operator")) {
    return "cli";
  }
  return "backend";
}

function buildGoalRecommendations({ goal, domainId, safeMode = true }) {
  const normalized = String(goal).toLowerCase();
  const recommendations = [];
  if (normalized.includes("doc") || normalized.includes("adr") || domainId === "docs") {
    recommendations.push({
      title: "Docs maintenance pass",
      kind: "scenario",
      goal,
      acceptanceCriteria: [
        "Produce documentation-oriented output.",
        "Leave a durable scenario run for review."
      ],
      relatedScenarios: ["docs-adr-pass"],
      metadata: {
        templateId: "docs-maintenance-pass",
        scenarioId: "docs-adr-pass",
        domainId: "docs",
        projectPath: "config/projects/spore.yaml",
        safeMode,
        mutationScope: ["docs", "runbooks"],
        recommendedScenarios: ["docs-adr-pass"],
        recommendedRegressions: ["local-fast"]
      }
    });
  }
  if (normalized.includes("config") || normalized.includes("schema")) {
    recommendations.push({
      title: "Config/schema maintenance",
      kind: "workflow",
      goal,
      acceptanceCriteria: [
        "Produce a reviewable proposal package.",
        "Validation must include local-fast regression."
      ],
      relatedRegressions: ["local-fast"],
      metadata: {
        templateId: "config-schema-maintenance",
        workflowPath: "config/workflows/docs-adr-pass.yaml",
        domainId: "docs",
        projectPath: "config/projects/spore.yaml",
        roles: ["lead", "scout", "reviewer"],
        safeMode,
        mutationScope: ["config", "docs"],
        requiresProposal: true,
        codeOriented: true,
        recommendedScenarios: ["docs-adr-pass"],
        recommendedRegressions: ["local-fast"]
      }
    });
  }
  if (normalized.includes("web") || normalized.includes("ui") || normalized.includes("dashboard")) {
    recommendations.push({
      title: "Operator UI pass",
      kind: "workflow",
      goal,
      acceptanceCriteria: [
        "Produce a proposal for UI-facing work.",
        "Validate with frontend-ui-pass."
      ],
      relatedScenarios: ["frontend-ui-pass"],
      relatedRegressions: ["local-fast"],
      metadata: {
        templateId: "operator-ui-pass",
        workflowPath: "config/workflows/frontend-ui-pass.yaml",
        domainId: "frontend",
        projectPath: "config/projects/spore.yaml",
        roles: ["lead", "scout", "builder", "tester", "reviewer"],
        safeMode,
        mutationScope: safeMode ? ["docs", "config", "apps/web"] : ["apps/web"],
        requiresProposal: true,
        codeOriented: true,
        recommendedScenarios: ["frontend-ui-pass"],
        recommendedRegressions: ["local-fast"]
      }
    });
  }
  if (normalized.includes("runtime") || normalized.includes("session") || normalized.includes("gateway") || domainId === "backend") {
    recommendations.push({
      title: "Runtime validation pass",
      kind: "regression",
      goal,
      acceptanceCriteria: [
        "Run canonical runtime validation.",
        "Produce durable regression history."
      ],
      relatedRegressions: [safeMode ? "local-fast" : "pi-canonical"],
      metadata: {
        templateId: "runtime-validation-pass",
        regressionId: safeMode ? "local-fast" : "pi-canonical",
        domainId: domainId ?? "backend",
        projectPath: "config/projects/spore.yaml",
        safeMode,
        mutationScope: safeMode ? ["config", "docs"] : ["packages/runtime-pi", "services/session-gateway"],
        recommendedRegressions: [safeMode ? "local-fast" : "pi-canonical"]
      }
    });
  }
  if (recommendations.length === 0) {
    recommendations.push({
      title: "General self-work investigation",
      kind: "scenario",
      goal,
      acceptanceCriteria: [
        "Create a durable scenario run.",
        "Stop for review if governance blocks further progress."
      ],
      relatedScenarios: ["cli-verification-pass"],
      metadata: {
        templateId: "general-self-work",
        scenarioId: "cli-verification-pass",
        domainId: domainId ?? "cli",
        projectPath: "config/projects/spore.yaml",
        safeMode,
        mutationScope: ["docs", "config"],
        recommendedScenarios: ["cli-verification-pass"],
        recommendedRegressions: ["local-fast"]
      }
    });
  }
  return recommendations.map((recommendation, index) => ({
    ...recommendation,
    id: `${index + 1}`,
    groupOrder: index,
    dependsOn: index === 0 ? [] : [String(index)],
    riskLevel: recommendation.kind === "workflow" ? "medium" : "low",
    requiredGovernance: recommendation.metadata?.requiresProposal ? "review-and-approval" : "review"
  }));
}

function buildGoalPlanSummary(plan, items = [], group = null) {
  return {
    ...plan,
    links: goalPlanLinks(plan.id),
    recommendedWorkItems: plan.recommendations,
    materializedGroup: group,
    materializedItems: items
  };
}

function buildGroupSummary(group, items = [], runs = []) {
  const latestRunAt = runs[0]?.endedAt ?? runs[0]?.startedAt ?? group.lastRunAt ?? null;
  const counts = runs.reduce((accumulator, run) => {
    accumulator[run.status] = (accumulator[run.status] ?? 0) + 1;
    return accumulator;
  }, {});
  return {
    ...group,
    itemCount: items.length,
    latestRunAt,
    runCountsByStatus: counts,
    items,
    recentRuns: runs.slice(0, 10),
    links: groupLinks(group.id)
  };
}

function buildProposalSummary(artifact) {
  return artifact ? {
    ...artifact,
    links: proposalLinks(artifact.id)
  } : null;
}

function buildLearningSummary(record) {
  return record ? {
    ...record,
    links: {
      self: `/learning-records/${encodeURIComponent(record.id)}`
    }
  } : null;
}

function ensureSafeMode(item, projectId = null) {
  const metadata = item.metadata ?? {};
  const safeMode = metadata.safeMode !== false;
  const mutationScope = dedupe(metadata.mutationScope ?? []);
  const allowedSafeScope = ["docs", "config", "runbooks", "scenarios", "regressions", "apps/web"];
  if (!safeMode) {
    return { safeMode, mutationScope };
  }
  for (const scope of mutationScope) {
    if (!allowedSafeScope.includes(scope)) {
      throw new Error(`safe mode blocks mutation scope: ${scope}`);
    }
  }
  if (projectId === "spore" && item.kind === "workflow" && mutationScope.length === 0) {
    throw new Error("safe mode workflow work items must declare metadata.mutationScope");
  }
  return { safeMode, mutationScope };
}

function buildProposalArtifacts(item, run, validation = null) {
  const changeSummary = item.goal || `Proposal generated for ${item.title}`;
  return {
    changeSummary,
    proposedFiles: asArray(item.metadata?.mutationScope).map((scope) => ({ scope, status: "planned" })),
    testSummary: validation ? {
      validationStatus: validation.status ?? null,
      scenarioRunIds: validation.scenarioRunIds ?? [],
      regressionRunIds: validation.regressionRunIds ?? []
    } : {
      validationStatus: "pending",
      scenarioRunIds: [],
      regressionRunIds: []
    },
    reviewNotes: {
      requiredReview: true,
      requiredApproval: item.metadata?.requiresHumanApproval ?? workItemKindRequiresProposal(item),
      safeMode: item.metadata?.safeMode !== false
    },
    docImpact: {
      relatedDocs: item.relatedDocs ?? [],
      relatedScenarios: item.relatedScenarios ?? [],
      relatedRegressions: item.relatedRegressions ?? []
    }
  };
}

function buildDocSuggestions(item, run, proposal = null) {
  const suggestions = [];
  if ((item.relatedDocs ?? []).length > 0 || item.metadata?.mutationScope?.includes("docs")) {
    suggestions.push({
      kind: "runbook-update",
      targetPath: "docs/runbooks/local-dev.md",
      summary: `Update operator instructions after work item ${item.id}.`
    });
  }
  if (proposal) {
    suggestions.push({
      kind: "readme-delta",
      targetPath: "README.md",
      summary: `Review README impact for proposal artifact ${proposal.id}.`
    });
  }
  if (run.status === "failed") {
    suggestions.push({
      kind: "adr-candidate",
      targetPath: "docs/decisions/",
      summary: `Capture failure pattern from work item run ${run.id}.`
    });
  }
  return suggestions;
}

async function maybeCreateLearningRecord(item, run, proposal, dbPath) {
  const now = nowIso();
  const kind = run.status === "failed" ? "failure-pattern" : "successful-self-work";
  const summary = run.status === "failed"
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
      docSuggestions: buildDocSuggestions(item, run, proposal)
    },
    metadata: {
      runStatus: run.status,
      itemKind: item.kind
    },
    createdAt: now,
    updatedAt: now
  };
  withDatabase(dbPath, (db) => insertLearningRecord(db, record));
  return record;
}

export async function listWorkItemTemplates() {
  const templates = await listWorkItemTemplateDefinitions();
  return templates.map((template) => ({
    ...template,
    links: {
      self: `/work-item-templates/${encodeURIComponent(template.id)}`
    }
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
      self: `/work-item-templates/${encodeURIComponent(template.id)}`
    }
  };
}

export async function createManagedWorkItem(payload = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const template = payload.templateId ? await getWorkItemTemplateDefinition(payload.templateId) : null;
  const basePayload = template ? buildTemplatePayload(template, payload) : payload;
  return createWorkItem(basePayload, dbPath);
}

export function listSelfBuildWorkItems(options = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  return listManagedWorkItems(options, dbPath);
}

export function listSelfBuildWorkItemRuns(itemId, options = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const limit = Number.parseInt(String(options.limit ?? "20"), 10) || 20;
  return withDatabase(dbPath, (db) => listWorkItemRuns(db, itemId, limit));
}

export function getSelfBuildWorkItem(itemId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const item = getManagedWorkItem(itemId, dbPath);
  if (!item) {
    return null;
  }
  const group = item.metadata?.groupId ? withDatabase(dbPath, (db) => getWorkItemGroup(db, item.metadata.groupId)) : null;
  const goalPlan = item.metadata?.goalPlanId ? withDatabase(dbPath, (db) => getGoalPlan(db, item.metadata.goalPlanId)) : null;
  return {
    ...item,
    workItemGroup: group ? buildGroupSummary(group) : null,
    goalPlan: goalPlan ? buildGoalPlanSummary(goalPlan) : null
  };
}

export function getSelfBuildWorkItemRun(runId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const run = getManagedWorkItemRun(runId, dbPath);
  if (!run) {
    return null;
  }
  const item = withDatabase(dbPath, (db) => getWorkItem(db, run.workItemId));
  const proposal = withDatabase(dbPath, (db) => getProposalArtifactByRunId(db, run.id));
  const learningRecords = withDatabase(dbPath, (db) =>
    listLearningRecords(db, "work-item-run", 50).filter((record) => record.sourceId === run.id)
  );
  const docSuggestions = run.metadata?.docSuggestions ?? buildDocSuggestions(item ?? { relatedDocs: [] }, run, proposal);
  return {
    ...run,
    item,
    proposal: buildProposalSummary(proposal),
    validation: run.metadata?.validation ?? null,
    docSuggestions,
    learningRecords: learningRecords.map(buildLearningSummary)
  };
}

export async function runSelfBuildWorkItem(itemId, options = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const item = withDatabase(dbPath, (db) => getWorkItem(db, itemId));
  if (!item) {
    return null;
  }
  ensureSafeMode(item, item.metadata?.projectId ?? "spore");
  const result = await runManagedWorkItem(itemId, options, dbPath);
  const runDetail = getManagedWorkItemRun(result.run.id, dbPath);
  const settledItem = withDatabase(dbPath, (db) => getWorkItem(db, itemId));
  let proposal = null;
  if (workItemKindRequiresProposal(settledItem)) {
    const now = nowIso();
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
        safeMode: settledItem.metadata?.safeMode !== false
      },
      artifacts: buildProposalArtifacts(settledItem, runDetail, runDetail.metadata?.validation ?? null),
      metadata: {
        source: options.source ?? "work-item-run",
        requiresHumanApproval: settledItem.metadata?.requiresHumanApproval ?? false
      },
      createdAt: now,
      updatedAt: now,
      reviewedAt: null,
      approvedAt: null
    };
    withDatabase(dbPath, (db) => insertProposalArtifact(db, proposal));
    runDetail.metadata = {
      ...runDetail.metadata,
      proposalArtifactId: proposal.id,
      docSuggestions: buildDocSuggestions(settledItem, runDetail, proposal)
    };
    withDatabase(dbPath, (db) => updateWorkItemRun(db, runDetail));
  }
  const learningRecord = await maybeCreateLearningRecord(settledItem, runDetail, proposal, dbPath);
  return {
    item: settledItem,
    run: getManagedWorkItemRun(runDetail.id, dbPath),
    proposal: buildProposalSummary(proposal),
    learningRecord: buildLearningSummary(learningRecord)
  };
}

export async function createGoalPlan(payload = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const now = nowIso();
  const domainId = extractGoalDomain(payload.goal ?? "", payload.domain ?? payload.domainId ?? null);
  const safeMode = payload.safeMode !== false;
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
      safeMode
    },
    recommendations: buildGoalRecommendations({
      goal: payload.goal ?? "",
      domainId,
      safeMode
    }),
    metadata: {
      source: payload.source ?? "operator",
      requestedBy: payload.by ?? "operator"
    },
    createdAt: now,
    updatedAt: now,
    materializedAt: null
  };
  withDatabase(dbPath, (db) => insertGoalPlan(db, plan));
  return buildGoalPlanSummary(plan);
}

export function listGoalPlansSummary(options = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const status = options.status ? String(options.status).trim() : null;
  const limit = Number.parseInt(String(options.limit ?? "50"), 10) || 50;
  return withDatabase(dbPath, (db) => listGoalPlans(db, status, limit)).map((plan) => buildGoalPlanSummary(plan));
}

export function getGoalPlanSummary(planId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const plan = withDatabase(dbPath, (db) => getGoalPlan(db, planId));
  if (!plan) {
    return null;
  }
  const items = listManagedWorkItems({}, dbPath).filter((item) => item.metadata?.goalPlanId === plan.id);
  const group = withDatabase(dbPath, (db) => listWorkItemGroups(db, null, 100)).find((entry) => entry.goalPlanId === plan.id) ?? null;
  return buildGoalPlanSummary(plan, items, group ? buildGroupSummary(group) : null);
}

export async function materializeGoalPlan(planId, options = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const plan = withDatabase(dbPath, (db) => getGoalPlan(db, planId));
  if (!plan) {
    return null;
  }
  const now = nowIso();
  const group = {
    id: options.groupId ?? createId("work-group"),
    title: `${plan.title} group`,
    goalPlanId: plan.id,
    status: "pending",
    summary: {
      plannedCount: plan.recommendations.length
    },
    metadata: {
      projectId: plan.projectId,
      domainId: plan.domainId,
      safeMode: plan.constraints?.safeMode !== false
    },
    createdAt: now,
    updatedAt: now,
    lastRunAt: null
  };
  withDatabase(dbPath, (db) => insertWorkItemGroup(db, group));
  const items = [];
  const recommendationIdToItemId = new Map();
  for (const recommendation of plan.recommendations) {
    const template = recommendation.metadata?.templateId ? await getWorkItemTemplateDefinition(recommendation.metadata.templateId) : null;
    const detail = await createManagedWorkItem({
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
        groupOrder: recommendation.groupOrder ?? 0
      })
    }, dbPath);
    recommendationIdToItemId.set(String(recommendation.id), detail.id);
    items.push(detail);
  }
  for (const item of items) {
    const dependencyIds = dedupe(item.metadata?.dependsOn ?? []).map((dependencyId) =>
      recommendationIdToItemId.get(String(dependencyId)) ?? dependencyId
    );
    const updatedItem = {
      ...item,
      metadata: {
        ...item.metadata,
        dependsOn: dependencyIds
      }
    };
    withDatabase(dbPath, (db) => updateWorkItem(db, updatedItem));
  }
  const refreshedItems = items.map((item) => getManagedWorkItem(item.id, dbPath)).filter(Boolean);
  const updatedPlan = {
    ...plan,
    status: "materialized",
    updatedAt: now,
    materializedAt: now,
    metadata: {
      ...plan.metadata,
      groupId: group.id,
      materializedItemIds: refreshedItems.map((item) => item.id)
    }
  };
  withDatabase(dbPath, (db) => updateGoalPlan(db, updatedPlan));
  return buildGoalPlanSummary(updatedPlan, refreshedItems, buildGroupSummary(group, refreshedItems));
}

export function listWorkItemGroupsSummary(options = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const status = options.status ? String(options.status).trim() : null;
  const limit = Number.parseInt(String(options.limit ?? "50"), 10) || 50;
  const groups = withDatabase(dbPath, (db) => listWorkItemGroups(db, status, limit));
  const items = listManagedWorkItems({ limit: 500 }, dbPath);
  return groups.map((group) => buildGroupSummary(
    group,
    items.filter((item) => item.metadata?.groupId === group.id),
    items.flatMap((item) => (item.metadata?.groupId === group.id ? item.runs ?? [] : []))
  ));
}

export function getWorkItemGroupSummary(groupId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const group = withDatabase(dbPath, (db) => getWorkItemGroup(db, groupId));
  if (!group) {
    return null;
  }
  const items = listManagedWorkItems({ limit: 500 }, dbPath).filter((item) => item.metadata?.groupId === group.id);
  const runs = items.flatMap((item) => item.runs ?? []);
  return buildGroupSummary(group, items, runs);
}

function itemDependenciesSatisfied(item, completedIds) {
  const dependsOn = dedupe(item.metadata?.dependsOn ?? []);
  return dependsOn.every((dependencyId) => completedIds.has(dependencyId) || completedIds.has(`item:${dependencyId}`));
}

export async function runWorkItemGroup(groupId, options = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const group = getWorkItemGroupSummary(groupId, dbPath);
  if (!group) {
    return null;
  }
  const items = [...group.items].sort((left, right) => (left.metadata?.groupOrder ?? 0) - (right.metadata?.groupOrder ?? 0));
  const completed = new Set();
  const results = [];
  let groupStatus = "completed";
  for (const item of items) {
    if (!itemDependenciesSatisfied(item, completed)) {
      groupStatus = "blocked";
      results.push({
        itemId: item.id,
        status: "blocked",
        reason: "dependencies_not_satisfied"
      });
      continue;
    }
    const result = await runSelfBuildWorkItem(item.id, options, dbPath);
    results.push(result);
    if (result.run.status === "completed") {
      completed.add(item.id);
    } else if (["blocked", "failed"].includes(result.run.status)) {
      groupStatus = result.run.status === "failed" ? "failed" : "blocked";
      if (groupStatus === "failed") {
        break;
      }
    }
  }
  const updatedGroup = {
    ...group,
    status: groupStatus,
    summary: {
      ...group.summary,
      resultCount: results.length,
      completedCount: results.filter((entry) => entry?.run?.status === "completed").length,
      blockedCount: results.filter((entry) => entry?.run?.status === "blocked").length,
      failedCount: results.filter((entry) => entry?.run?.status === "failed").length
    },
    updatedAt: nowIso(),
    lastRunAt: nowIso(),
    metadata: group.metadata
  };
  withDatabase(dbPath, (db) => updateWorkItemGroup(db, updatedGroup));
  return {
    group: getWorkItemGroupSummary(groupId, dbPath),
    results
  };
}

export function getProposalSummary(artifactId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const artifact = withDatabase(dbPath, (db) => getProposalArtifact(db, artifactId));
  return buildProposalSummary(artifact);
}

export function getProposalByRun(runId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const artifact = withDatabase(dbPath, (db) => getProposalArtifactByRunId(db, runId));
  return buildProposalSummary(artifact);
}

export async function reviewProposalArtifact(artifactId, decision = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const artifact = withDatabase(dbPath, (db) => getProposalArtifact(db, artifactId));
  if (!artifact) {
    return null;
  }
  const updated = {
    ...artifact,
    status: decision.status ?? "reviewed",
    updatedAt: nowIso(),
    reviewedAt: nowIso(),
    metadata: {
      ...artifact.metadata,
      review: {
        by: decision.by ?? "operator",
        comments: decision.comments ?? ""
      }
    }
  };
  withDatabase(dbPath, (db) => updateProposalArtifact(db, updated));
  return buildProposalSummary(updated);
}

export async function approveProposalArtifact(artifactId, decision = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const artifact = withDatabase(dbPath, (db) => getProposalArtifact(db, artifactId));
  if (!artifact) {
    return null;
  }
  const approved = decision.status ?? "approved";
  const updated = {
    ...artifact,
    status: approved,
    updatedAt: nowIso(),
    approvedAt: nowIso(),
    metadata: {
      ...artifact.metadata,
      approval: {
        by: decision.by ?? "operator",
        comments: decision.comments ?? ""
      }
    }
  };
  withDatabase(dbPath, (db) => updateProposalArtifact(db, updated));
  return buildProposalSummary(updated);
}

export async function validateWorkItemRun(runId, options = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const run = withDatabase(dbPath, (db) => getWorkItemRun(db, runId));
  if (!run) {
    return null;
  }
  const item = withDatabase(dbPath, (db) => getWorkItem(db, run.workItemId));
  if (!item) {
    return null;
  }
  const scenarioIds = dedupe(item.metadata?.recommendedScenarios ?? item.relatedScenarios ?? []);
  const regressionIds = dedupe(item.metadata?.recommendedRegressions ?? item.relatedRegressions ?? []);
  const scenarioRuns = [];
  const regressionRuns = [];
  for (const scenarioId of scenarioIds) {
    const definition = await getScenarioDefinition(scenarioId);
    if (!definition) continue;
    const result = await runScenarioById(scenarioId, {
      project: item.metadata?.projectPath ?? "config/projects/spore.yaml",
      wait: true,
      timeout: options.timeout ?? "180000",
      interval: options.interval ?? "1500",
      noMonitor: options.noMonitor === true,
      stub: options.stub !== false,
      launcher: options.launcher ?? null,
      source: options.source ?? "work-item-validation",
      by: options.by ?? "operator"
    }, dbPath);
    scenarioRuns.push(result.run.id);
  }
  for (const regressionId of regressionIds) {
    const definition = await getRegressionDefinition(regressionId);
    if (!definition) continue;
    const result = await runRegressionById(regressionId, {
      project: item.metadata?.projectPath ?? "config/projects/spore.yaml",
      timeout: options.timeout ?? "180000",
      interval: options.interval ?? "1500",
      noMonitor: options.noMonitor === true,
      stub: options.stub !== false,
      launcher: options.launcher ?? null,
      source: options.source ?? "work-item-validation",
      by: options.by ?? "operator"
    }, dbPath);
    regressionRuns.push(result.run.id);
  }
  const validation = {
    status: regressionRuns.length === 0 && scenarioRuns.length === 0 ? "not_configured" : "completed",
    scenarioRunIds: scenarioRuns,
    regressionRunIds: regressionRuns,
    validatedAt: nowIso()
  };
  const updatedRun = {
    ...run,
    metadata: {
      ...run.metadata,
      validation,
      docSuggestions: buildDocSuggestions(item, run, withDatabase(dbPath, (db) => getProposalArtifactByRunId(db, runId)))
    }
  };
  withDatabase(dbPath, (db) => updateWorkItemRun(db, updatedRun));
  return getSelfBuildWorkItemRun(runId, dbPath);
}

export function getDocSuggestionsForRun(runId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const detail = getSelfBuildWorkItemRun(runId, dbPath);
  if (!detail) {
    return null;
  }
  return {
    runId,
    itemId: detail.workItemId,
    suggestions: detail.docSuggestions ?? []
  };
}

export function getSelfBuildSummary(dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const workItems = listManagedWorkItems({ limit: 100 }, dbPath);
  const groups = listWorkItemGroupsSummary({ limit: 50 }, dbPath);
  const proposals = withDatabase(dbPath, (db) => listProposalArtifacts(db, null, 100)).map(buildProposalSummary);
  const learnings = withDatabase(dbPath, (db) => listLearningRecords(db, null, 100)).map(buildLearningSummary);
  const blockedItems = workItems.filter((item) => item.status === "blocked");
  const pendingReviewProposals = proposals.filter((proposal) => ["ready_for_review", "reviewed", "waiting_approval"].includes(proposal.status));
  return {
    counts: {
      workItems: workItems.length,
      groups: groups.length,
      blockedItems: blockedItems.length,
      proposals: proposals.length,
      pendingReviewProposals: pendingReviewProposals.length,
      learningRecords: learnings.length
    },
    workItems,
    groups,
    blockedItems,
    proposals,
    pendingReviewProposals,
    learningRecords: learnings,
    recommendations: blockedItems.slice(0, 5).map((item) => ({
      action: "inspect-work-item",
      targetType: "work-item",
      targetId: item.id,
      priority: "medium",
      reason: `Work item ${item.title} is blocked and may require operator review.`,
      expectedOutcome: "The operator can review the latest run or proposal and decide whether to resume, validate, or rerun.",
      commandHint: `npm run orchestrator:work-item-show -- --item ${item.id}`,
      httpHint: `/work-items/${encodeURIComponent(item.id)}`
    }))
  };
}
