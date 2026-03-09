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
import {
  createWorkItem,
  getManagedWorkItem,
  getManagedWorkItemRun,
  listManagedWorkItems,
  runManagedWorkItem,
  setManagedWorkItemDependencyState
} from "../work-items/work-items.js";

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
    run: `/work-item-groups/${encodeURIComponent(groupId)}/run`,
    dependencies: `/work-item-groups/${encodeURIComponent(groupId)}/dependencies`
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

function dependencyEdgeId(itemId, dependencyItemId, strictness = "hard") {
  return `dependency:${dependencyItemId}:${itemId}:${strictness}`;
}

function blockerId(edgeId, reasonCode) {
  return `blocker:${edgeId}:${reasonCode}`;
}

function normalizeDependencyStrictness(value) {
  return String(value ?? "hard").trim() === "advisory" ? "advisory" : "hard";
}

function normalizeAutoRelaxation(value, strictness) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      enabled: value.enabled !== false && strictness === "advisory",
      mode: value.mode ?? (strictness === "advisory" ? "warn-and-run" : "off"),
      reason: value.reason ?? (strictness === "advisory" ? "Advisory dependency warnings should stay visible without blocking work." : "")
    };
  }
  const enabled = value === undefined ? strictness === "advisory" : Boolean(value) && strictness === "advisory";
  return {
    enabled,
    mode: enabled ? "warn-and-run" : "off",
    reason: enabled ? "Advisory dependency warnings should stay visible without blocking work." : ""
  };
}

function normalizeDependencyEdge(edge, itemId, availableItemIds) {
  const dependencyItemId = String(edge?.dependencyItemId ?? edge?.dependsOn ?? "").trim();
  const strictness = normalizeDependencyStrictness(edge?.strictness);
  if (!dependencyItemId) {
    throw new Error(`dependency edge for ${itemId} is missing dependencyItemId`);
  }
  if (!availableItemIds.has(itemId) || !availableItemIds.has(dependencyItemId)) {
    throw new Error(`dependency edge must reference items inside the work-item group: ${dependencyItemId} -> ${itemId}`);
  }
  if (dependencyItemId === itemId) {
    throw new Error(`self-dependencies are not allowed: ${itemId}`);
  }
  return {
    id: dependencyEdgeId(itemId, dependencyItemId, strictness),
    itemId,
    dependencyItemId,
    strictness,
    label: strictness === "advisory" ? "advisory dependency" : "hard dependency",
    autoRelaxation: normalizeAutoRelaxation(edge?.autoRelaxation ?? edge?.autoRelax ?? undefined, strictness)
  };
}

function getStoredDependencyEdges(item, availableItemIds) {
  const metadataEdges = asArray(item.metadata?.dependencies);
  if (metadataEdges.length > 0) {
    return metadataEdges.map((edge) => normalizeDependencyEdge(edge, item.id, availableItemIds));
  }
  return dedupe(item.metadata?.dependsOn ?? []).map((dependencyItemId) =>
    normalizeDependencyEdge({ dependencyItemId, strictness: "hard", autoRelaxation: false }, item.id, availableItemIds)
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
  if (item.status === "running") return "running";
  if (item.status === "failed") return "failed";
  if (item.status === "blocked") {
    return item.metadata?.dependency?.state === "review_needed" ? "review_needed" : "blocked";
  }
  return item.status || "pending";
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

function dependencyTransitionForState(item, state, blockers, advisoryWarnings, previousState, reason) {
  if (reason === "dependency_graph_updated") {
    return {
      type: "dependency_graph_updated",
      state,
      reasonCode: blockers[0]?.reasonCode ?? (advisoryWarnings.length > 0 ? "advisory_warning" : "graph_updated"),
      reason: blockers[0]?.reason ?? (advisoryWarnings[0]?.reason ?? "Dependency graph updated."),
      blockerId: blockers[0]?.id ?? null,
      dependencyItemId: blockers[0]?.dependencyItemId ?? advisoryWarnings[0]?.dependencyItemId ?? null,
      strictness: blockers[0]?.strictness ?? advisoryWarnings[0]?.strictness ?? null,
      nextActionHint: buildNextActionHint(blockers, advisoryWarnings)
    };
  }
  if (advisoryWarnings.length > 0 && (previousState !== "ready" || reason === "group_run")) {
    return {
      type: "dependency_auto_relaxed",
      state,
      reasonCode: advisoryWarnings[0].reasonCode,
      reason: advisoryWarnings[0].reason,
      blockerId: advisoryWarnings[0].id,
      dependencyItemId: advisoryWarnings[0].dependencyItemId,
      strictness: advisoryWarnings[0].strictness,
      nextActionHint: buildNextActionHint(blockers, advisoryWarnings)
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
      nextActionHint: buildNextActionHint(blockers, advisoryWarnings)
    };
  }
  if (state === "blocked") {
    return {
      type: blockers[0]?.reasonCode === "dependency_running" ? "dependency_retry_pending" : "dependency_blocked",
      state,
      reasonCode: blockers[0]?.reasonCode ?? "dependency_pending",
      reason: blockers[0]?.reason ?? `A dependency is still pending for ${item.title}.`,
      blockerId: blockers[0]?.id ?? null,
      dependencyItemId: blockers[0]?.dependencyItemId ?? null,
      strictness: blockers[0]?.strictness ?? null,
      nextActionHint: buildNextActionHint(blockers, advisoryWarnings)
    };
  }
  if (state === "ready" && previousState && previousState !== "ready") {
    return {
      type: "dependency_ready",
      state,
      reasonCode: "dependencies_satisfied",
      reason: `${item.title} is ready because required dependencies are now satisfied.`,
      nextActionHint: buildNextActionHint(blockers, advisoryWarnings)
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

    for (const edge of incomingEdges) {
      const dependencyItem = itemMap.get(edge.dependencyItemId);
      const dependencyState = dependencyStatusLabel(dependencyItem);
      const title = dependencyItem?.title ?? edge.dependencyItemId;

      if (edge.strictness === "advisory") {
        if (dependencyState !== "completed") {
          advisoryWarnings.push({
            id: blockerId(edge.id, edge.autoRelaxation.enabled ? "advisory_auto_relaxed" : "advisory_warning"),
            edgeId: edge.id,
            itemId: item.id,
            dependencyItemId: edge.dependencyItemId,
            dependencyTitle: title,
            strictness: edge.strictness,
            autoRelaxed: edge.autoRelaxation.enabled,
            reasonCode: edge.autoRelaxation.enabled ? "advisory_auto_relaxed" : "advisory_warning",
            reason: edge.autoRelaxation.enabled
              ? `${title} is not settled, but the advisory dependency auto-relaxed so work can continue.`
              : `${title} is not settled. This dependency is advisory, so work can continue with caution.`
          });
        }
        continue;
      }

      if (dependencyState === "completed") {
        continue;
      }

      const reasonCode = dependencyState === "failed"
        ? "dependency_failed"
        : dependencyState === "running"
        ? "dependency_running"
        : "dependency_pending";
      const reason = dependencyState === "failed"
        ? `${title} failed and requires review before downstream work can proceed.`
        : dependencyState === "running"
        ? `${title} is retrying or still running.`
        : `${title} has not completed yet.`;
      blockers.push({
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
            : `Complete ${title} before starting this work item.`
      });
    }

    const storedDependencyState = item.metadata?.dependency?.state ?? null;
    let state = dependencyStatusLabel(item);
    if (!["completed", "running", "failed"].includes(state)) {
      if (blockers.some((blocker) => blocker.reasonCode === "dependency_failed")) {
        state = "review_needed";
      } else if (blockers.length > 0) {
        state = "blocked";
      } else {
        state = "ready";
      }
    }

    const reason = buildDependencyReason(item, blockers, advisoryWarnings);
    const nextActionHint = buildNextActionHint(blockers, advisoryWarnings);
    const transition = dependencyTransitionForState(item, state, blockers, advisoryWarnings, storedDependencyState, null);

    return {
      ...item,
      blockedReason: state === "blocked" || state === "review_needed" ? reason : null,
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
          hard: incomingEdges.filter((edge) => edge.strictness === "hard").length,
          advisory: incomingEdges.filter((edge) => edge.strictness === "advisory").length,
          blocked: blockers.length,
          advisoryWarnings: advisoryWarnings.length
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
          advisoryWarningCount: advisoryWarnings.length
        }
      },
      dependencySummary: {
        totalIncoming: incomingEdges.length,
        totalOutgoing: outgoingEdges.length,
        blockerCount: blockers.length,
        advisoryWarningCount: advisoryWarnings.length,
        nextActionHint,
        reason
      }
    };
  });

  const counts = derivedItems.reduce(
    (accumulator, item) => {
      const state = item.dependencyState.state;
      accumulator.total += 1;
      accumulator[state] = (accumulator[state] ?? 0) + 1;
      accumulator.advisoryWarnings += item.dependencyState.advisoryWarnings.length;
      return accumulator;
    },
    { total: 0, ready: 0, blocked: 0, review_needed: 0, running: 0, completed: 0, failed: 0, pending: 0, advisoryWarnings: 0 }
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
    .sort((left, right) => new Date(right.timestamp ?? 0) - new Date(left.timestamp ?? 0));

  const dependencyGraph = {
    edges: allEdges.map((edge) => ({
      ...edge,
      itemTitle: itemMap.get(edge.itemId)?.title ?? edge.itemId,
      dependencyTitle: itemMap.get(edge.dependencyItemId)?.title ?? edge.dependencyItemId
    })),
    transitionLog,
    strictnessCounts: {
      hard: allEdges.filter((edge) => edge.strictness === "hard").length,
      advisory: allEdges.filter((edge) => edge.strictness === "advisory").length
    }
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
        advisoryWarnings: counts.advisoryWarnings
      },
      blockerIds: derivedItems.flatMap((item) => item.blockerIds ?? []),
      readyItemIds: derivedItems.filter((item) => item.dependencyState.readyToRun).map((item) => item.id),
      blockedItemIds: derivedItems.filter((item) => ["blocked", "review_needed"].includes(item.dependencyState.state)).map((item) => item.id),
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
        affectedDownstreamCount: derivedItems.filter((item) => item.dependencyState.counts.total > 0).length
      }
    }
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
      reason
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
        reasonCode: item.dependencyState.blockers[0]?.reasonCode ?? (item.dependencyState.advisoryWarnings[0]?.reasonCode ?? null),
        reason: item.dependencyState.reason,
        nextActionHint: item.dependencyState.nextActionHint,
        blockerIds: item.blockerIds,
        blockers: item.dependencyState.blockers,
        advisoryWarnings: item.dependencyState.advisoryWarnings,
        incomingEdges: item.dependencyState.incomingEdges,
        outgoingEdges: item.dependencyState.outgoingEdges,
        readyToRun: item.dependencyState.readyToRun,
        transition,
        updatedAt: nowIso()
      },
      dbPath
    );
  }

  const refreshedGroup = withDatabase(dbPath, (db) => getWorkItemGroup(db, group.id));
  const updatedGroup = {
    ...refreshedGroup,
    status: evaluated.readiness.headlineState,
    summary: {
      ...(refreshedGroup?.summary ?? {}),
      dependencyReadiness: evaluated.readiness,
      dependencyEdgeCount: evaluated.dependencyGraph.edges.length
    },
    metadata: {
      ...(refreshedGroup?.metadata ?? {}),
      dependencyGraph: {
        strictnessCounts: evaluated.dependencyGraph.strictnessCounts,
        lastEvaluatedAt: nowIso(),
        lastEvaluationReason: reason ?? "read"
      }
    },
    updatedAt: nowIso(),
    lastRunAt: refreshedGroup?.lastRunAt ?? null
  };
  withDatabase(dbPath, (db) => updateWorkItemGroup(db, updatedGroup));
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
  const recentActivity = items.length > 0 
    ? items.map((item) => ({ timestamp: item.updatedAt, kind: "work-item", id: item.id }))
        .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp))[0]
    : null;
  
  return {
    ...plan,
    links: goalPlanLinks(plan.id),
    recommendedWorkItems: plan.recommendations,
    materializedGroup: group,
    materializedItems: items,
    recentActivity: recentActivity ? {
      timestamp: recentActivity.timestamp,
      kind: recentActivity.kind,
      targetId: recentActivity.id
    } : null
  };
}

function buildGroupSummary(group, items = [], runs = []) {
  const latestRunAt = runs[0]?.endedAt ?? runs[0]?.startedAt ?? group.lastRunAt ?? null;
  const counts = runs.reduce((accumulator, run) => {
    accumulator[run.status] = (accumulator[run.status] ?? 0) + 1;
    return accumulator;
  }, {});
  const evaluated = evaluateGroupDependencies(items);
  const itemsWithLinks = evaluated.items.map((item) => ({
    ...item,
    links: {
      self: `/work-items/${encodeURIComponent(item.id)}`,
      runs: `/work-items/${encodeURIComponent(item.id)}/runs`
    }
  }));
  const runsWithLinks = runs.slice(0, 10).map((run) => ({
    ...run,
    links: {
      self: `/work-item-runs/${encodeURIComponent(run.id)}`,
      item: `/work-items/${encodeURIComponent(run.workItemId)}`
    }
  }));
  
  return {
    ...group,
    status: evaluated.readiness.headlineState,
    itemCount: items.length,
    latestRunAt,
    runCountsByStatus: counts,
    items: itemsWithLinks,
    recentRuns: runsWithLinks,
    dependencyGraph: evaluated.dependencyGraph,
    readiness: evaluated.readiness,
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
  const recentRuns = listSelfBuildWorkItemRuns(itemId, { limit: 10 }, dbPath);
  const latestProposal = recentRuns.length > 0 
    ? withDatabase(dbPath, (db) => getProposalArtifactByRunId(db, recentRuns[0].id))
    : null;
  const groupItems = group ? listManagedWorkItems({ limit: 500 }, dbPath).filter((entry) => entry.metadata?.groupId === group.id) : [];
  const groupRuns = groupItems.flatMap((entry) => entry.runs ?? []);
  const groupSummary = group ? buildGroupSummary(group, groupItems, groupRuns) : null;
  const derivedItem = groupSummary?.items?.find((entry) => entry.id === itemId) ?? item;
  
  return {
    ...derivedItem,
    workItemGroup: groupSummary,
    goalPlan: goalPlan ? buildGoalPlanSummary(goalPlan) : null,
    recentRuns: recentRuns.slice(0, 5).map((run) => ({
      ...run,
      links: {
        self: `/work-item-runs/${encodeURIComponent(run.id)}`,
        proposal: run.id ? `/work-item-runs/${encodeURIComponent(run.id)}/proposal` : null,
        validate: `/work-item-runs/${encodeURIComponent(run.id)}/validate`,
        docSuggestions: `/work-item-runs/${encodeURIComponent(run.id)}/doc-suggestions`
      }
    })),
    latestProposal: latestProposal ? buildProposalSummary(latestProposal) : null,
    links: {
      self: `/work-items/${encodeURIComponent(itemId)}`,
      runs: `/work-items/${encodeURIComponent(itemId)}/runs`,
      run: `/work-items/${encodeURIComponent(itemId)}/run`,
      group: group ? `/work-item-groups/${encodeURIComponent(group.id)}` : null,
      goalPlan: goalPlan ? `/goal-plans/${encodeURIComponent(goalPlan.id)}` : null
    }
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
  const group = item?.metadata?.groupId ? withDatabase(dbPath, (db) => getWorkItemGroup(db, item.metadata.groupId)) : null;
  const goalPlan = item?.metadata?.goalPlanId ? withDatabase(dbPath, (db) => getGoalPlan(db, item.metadata.goalPlanId)) : null;
  
  return {
    ...run,
    item,
    proposal: buildProposalSummary(proposal),
    validation: run.metadata?.validation ?? null,
    docSuggestions,
    learningRecords: learningRecords.map(buildLearningSummary),
    lineage: {
      workItemGroup: group ? { id: group.id, title: group.title } : null,
      goalPlan: goalPlan ? { id: goalPlan.id, title: goalPlan.title, goal: goalPlan.goal } : null
    },
    links: {
      self: `/work-item-runs/${encodeURIComponent(runId)}`,
      item: `/work-items/${encodeURIComponent(run.workItemId)}`,
      proposal: proposal ? `/proposal-artifacts/${encodeURIComponent(proposal.id)}` : null,
      validate: `/work-item-runs/${encodeURIComponent(runId)}/validate`,
      docSuggestions: `/work-item-runs/${encodeURIComponent(runId)}/doc-suggestions`,
      group: group ? `/work-item-groups/${encodeURIComponent(group.id)}` : null,
      goalPlan: goalPlan ? `/goal-plans/${encodeURIComponent(goalPlan.id)}` : null
    }
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
  return buildGoalPlanSummary(
    plan,
    items,
    group ? buildGroupSummary(group, items.filter((item) => item.metadata?.groupId === group.id), items.flatMap((item) => item.runs ?? [])) : null
  );
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

export function setWorkItemGroupDependencies(groupId, payload = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const group = withDatabase(dbPath, (db) => getWorkItemGroup(db, groupId));
  if (!group) {
    return null;
  }
  const items = listManagedWorkItems({ limit: 500 }, dbPath).filter((item) => item.metadata?.groupId === group.id);
  const availableItemIds = new Set(items.map((item) => item.id));
  const replace = payload.replace !== false;
  const requestedEdges = asArray(payload.edges).map((edge) => {
    const itemId = String(edge?.itemId ?? "").trim();
    if (!itemId) {
      throw new Error("dependency edges require itemId");
    }
    return normalizeDependencyEdge(edge, itemId, availableItemIds);
  });

  const edgesByItemId = new Map(items.map((item) => [item.id, replace ? [] : getStoredDependencyEdges(item, availableItemIds)]));
  for (const edge of requestedEdges) {
    const existing = edgesByItemId.get(edge.itemId) ?? [];
    edgesByItemId.set(edge.itemId, [...existing.filter((entry) => entry.id !== edge.id), edge]);
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
          autoRelaxation: edge.autoRelaxation
        }))
      },
      updatedAt: nowIso()
    };
    withDatabase(dbPath, (db) => updateWorkItem(db, updated));
  }

  const reconciledGroup = getWorkItemGroupSummary(groupId, dbPath);
  persistGroupDependencyState(reconciledGroup, evaluateGroupDependencies(reconciledGroup.items), "dependency_graph_updated", dbPath);
  const detail = getWorkItemGroupSummary(groupId, dbPath);
  return {
    detail,
    impactSummary: {
      totalEdges: detail.dependencyGraph.edges.length,
      strictnessCounts: detail.dependencyGraph.strictnessCounts,
      headlineState: detail.readiness.headlineState,
      readinessCounts: detail.readiness.counts,
      blockerIds: detail.readiness.blockerIds,
      affectedItemIds: Array.from(new Set(detail.dependencyGraph.edges.map((edge) => edge.itemId))),
      nextActionHint: detail.readiness.nextActionHint
    }
  };
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

export async function runWorkItemGroup(groupId, options = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  let group = getWorkItemGroupSummary(groupId, dbPath);
  if (!group) {
    return null;
  }
  persistGroupDependencyState(group, evaluateGroupDependencies(group.items), "group_run", dbPath);
  group = getWorkItemGroupSummary(groupId, dbPath);
  const items = sortByGroupOrder(group.items);
  const results = [];

  for (const item of items) {
    group = getWorkItemGroupSummary(groupId, dbPath);
    const current = group.items.find((entry) => entry.id === item.id);
    if (!current) {
      continue;
    }

    if (["blocked", "review_needed"].includes(current.dependencyState?.state)) {
      results.push({
        itemId: current.id,
        status: "blocked",
        reason: current.dependencyState.reason,
        blockerIds: current.blockerIds,
        blockers: current.dependencyState.blockers,
        nextActionHint: current.nextActionHint,
        dependencyState: current.dependencyState.state
      });
      continue;
    }

    if (current.status === "completed") {
      results.push({
        itemId: current.id,
        status: "completed",
        reason: "already_completed"
      });
      continue;
    }

    let result;
    try {
      result = await runSelfBuildWorkItem(current.id, options, dbPath);
    } catch (error) {
      const failedItem = getSelfBuildWorkItem(current.id, dbPath);
      const failedRun = failedItem?.metadata?.lastRunId ? getManagedWorkItemRun(failedItem.metadata.lastRunId, dbPath) : null;
      result = {
        item: failedItem,
        run: failedRun,
        error: error.message
      };
    }
    results.push(result);
    const refreshed = getWorkItemGroupSummary(groupId, dbPath);
    persistGroupDependencyState(refreshed, evaluateGroupDependencies(refreshed.items), "group_run", dbPath);
  }

  group = getWorkItemGroupSummary(groupId, dbPath);
  const updatedGroup = {
    ...withDatabase(dbPath, (db) => getWorkItemGroup(db, groupId)),
    status: group.readiness.headlineState,
    summary: {
      ...(group.summary ?? {}),
      resultCount: results.length,
      completedCount: results.filter((entry) => entry?.run?.status === "completed" || entry?.status === "completed").length,
      blockedCount: results.filter((entry) => entry?.status === "blocked").length,
      failedCount: results.filter((entry) => entry?.run?.status === "failed").length,
      dependencyReadiness: group.readiness
    },
    metadata: {
      ...(group.metadata ?? {}),
      dependencyGraph: {
        ...(group.metadata?.dependencyGraph ?? {}),
        strictnessCounts: group.dependencyGraph.strictnessCounts,
        lastEvaluatedAt: nowIso(),
        lastEvaluationReason: "group_run"
      }
    },
    updatedAt: nowIso(),
    lastRunAt: nowIso()
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
  const now = nowIso();
  const groups = listWorkItemGroupsSummary({ limit: 50 }, dbPath);
  const groupItemMap = new Map(groups.flatMap((group) => group.items.map((item) => [item.id, item])));
  const workItems = listManagedWorkItems({ limit: 100 }, dbPath).map((item) => groupItemMap.get(item.id) ?? item);
  const proposals = withDatabase(dbPath, (db) => listProposalArtifacts(db, null, 100)).map(buildProposalSummary);
  const learnings = withDatabase(dbPath, (db) => listLearningRecords(db, null, 100)).map(buildLearningSummary);
  const allRuns = workItems.flatMap((item) => (item.runs ?? []).map((run) => ({ ...run, itemTitle: item.title, itemId: item.id })));

  const blockedItems = workItems.filter((item) => item.status === "blocked" || ["blocked", "review_needed"].includes(item.dependencyState?.state));
  const failedItems = workItems.filter((item) => item.status === "failed");
  const waitingReviewProposals = proposals.filter((proposal) => proposal.status === "ready_for_review");
  const waitingApprovalProposals = proposals.filter((proposal) => ["reviewed", "waiting_approval"].includes(proposal.status));
  const pendingValidationRuns = allRuns.filter((run) => 
    run.status === "completed" && (!run.metadata?.validation || run.metadata.validation.status !== "completed")
  );
  const needsDocFollowUpRuns = allRuns.filter((run) =>
    run.metadata?.docSuggestions && run.metadata.docSuggestions.length > 0
  );
  const recentLearnings = learnings.filter((learning) => learning.status === "active").slice(0, 10);

  const urgentQueue = [
    ...blockedItems.map((item) => ({
      kind: "blocked-work-item",
      priority: "high",
      itemId: item.id,
      title: item.title,
      reason: item.blockedReason ?? item.dependencyState?.reason ?? "Work item blocked and requires operator intervention",
      httpHint: `/work-items/${encodeURIComponent(item.id)}`,
      blockerIds: item.blockerIds ?? [],
      nextActionHint: item.nextActionHint ?? item.dependencyState?.nextActionHint ?? null,
      timestamp: item.updatedAt
    })),
    ...failedItems.map((item) => ({
      kind: "failed-work-item",
      priority: "high",
      itemId: item.id,
      title: item.title,
      reason: "Work item failed and may need recovery or retry",
      httpHint: `/work-items/${encodeURIComponent(item.id)}`,
      timestamp: item.updatedAt
    })),
    ...waitingReviewProposals.map((proposal) => ({
      kind: "waiting-review",
      priority: "high",
      proposalId: proposal.id,
      title: proposal.summary?.title ?? "Untitled proposal",
      reason: "Proposal ready for operator review",
      httpHint: `/proposal-artifacts/${encodeURIComponent(proposal.id)}`,
      timestamp: proposal.createdAt
    })),
    ...waitingApprovalProposals.map((proposal) => ({
      kind: "waiting-approval",
      priority: "medium",
      proposalId: proposal.id,
      title: proposal.summary?.title ?? "Untitled proposal",
      reason: "Proposal reviewed and waiting for approval",
      httpHint: `/proposal-artifacts/${encodeURIComponent(proposal.id)}`,
      timestamp: proposal.reviewedAt ?? proposal.createdAt
    }))
  ].sort((left, right) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const leftPriority = priorityOrder[left.priority] ?? 3;
    const rightPriority = priorityOrder[right.priority] ?? 3;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return new Date(right.timestamp) - new Date(left.timestamp);
  });

  const followUpQueue = [
    ...pendingValidationRuns.slice(0, 10).map((run) => ({
      kind: "pending-validation",
      priority: "medium",
      runId: run.id,
      itemId: run.itemId,
      title: `Validate ${run.itemTitle}`,
      reason: "Work item run completed but validation not yet triggered",
      httpHint: `/work-item-runs/${encodeURIComponent(run.id)}`,
      actionHint: "POST /work-item-runs/:runId/validate",
      timestamp: run.endedAt ?? run.startedAt
    })),
    ...needsDocFollowUpRuns.slice(0, 10).map((run) => ({
      kind: "doc-suggestions",
      priority: "low",
      runId: run.id,
      itemId: run.itemId,
      title: `Doc follow-up for ${run.itemTitle}`,
      reason: "Work item run has documentation suggestions",
      httpHint: `/work-item-runs/${encodeURIComponent(run.id)}/doc-suggestions`,
      timestamp: run.endedAt ?? run.startedAt
    }))
  ].sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp));

  const mostRecentActivity = [
    ...workItems.map((item) => ({ kind: "work-item", timestamp: item.updatedAt })),
    ...groups.map((group) => ({ kind: "group", timestamp: group.updatedAt })),
    ...proposals.map((proposal) => ({ kind: "proposal", timestamp: proposal.updatedAt })),
    ...learnings.map((learning) => ({ kind: "learning", timestamp: learning.updatedAt }))
  ].sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp))[0];

  return {
    overview: {
      totalWorkItems: workItems.length,
      totalGroups: groups.length,
      totalProposals: proposals.length,
      urgentCount: urgentQueue.length,
      followUpCount: followUpQueue.length,
      lastActivity: mostRecentActivity?.timestamp ?? null,
      generatedAt: now
    },
    counts: {
      workItems: workItems.length,
      groups: groups.length,
      blockedItems: blockedItems.length,
      failedItems: failedItems.length,
      proposals: proposals.length,
      waitingReviewProposals: waitingReviewProposals.length,
      waitingApprovalProposals: waitingApprovalProposals.length,
      pendingValidationRuns: pendingValidationRuns.length,
      learningRecords: learnings.length
    },
    urgentWork: urgentQueue.slice(0, 20),
    followUpWork: followUpQueue.slice(0, 20),
    workItems,
    groups,
    blockedItems,
    failedItems,
    proposals,
    waitingReviewProposals,
    waitingApprovalProposals,
    learningRecords: recentLearnings,
    freshness: {
      lastRefresh: now,
      staleAfter: new Date(Date.now() + 60000).toISOString(),
      cacheHint: "client should poll every 30-60 seconds for live operator dashboards"
    },
    displayMetadata: {
      urgentLabel: urgentQueue.length === 0 ? "No urgent work" : `${urgentQueue.length} urgent ${urgentQueue.length === 1 ? "item" : "items"}`,
      followUpLabel: followUpQueue.length === 0 ? "No follow-up needed" : `${followUpQueue.length} follow-up ${followUpQueue.length === 1 ? "item" : "items"}`,
      statusBadge: urgentQueue.length > 0 ? "needs-attention" : "healthy"
    },
    recommendations: urgentQueue.slice(0, 5).map((item) => ({
      action: item.kind === "blocked-work-item" || item.kind === "failed-work-item" ? "inspect-work-item" : "review-proposal",
      targetType: item.itemId ? "work-item" : "proposal",
      targetId: item.itemId ?? item.proposalId,
      priority: item.priority,
      reason: item.reason,
      expectedOutcome: item.kind === "waiting-review" 
        ? "Operator reviews proposal and provides feedback or approval"
        : item.kind === "waiting-approval"
        ? "Operator approves or rejects proposal"
        : "Operator investigates work item status and decides next action",
      commandHint: item.itemId 
        ? `npm run orchestrator:work-item-show -- --item ${item.itemId}`
        : `npm run orchestrator:proposal-show -- --proposal ${item.proposalId}`,
      httpHint: item.httpHint
    }))
  };
}
