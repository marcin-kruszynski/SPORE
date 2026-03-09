import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { DEFAULT_ORCHESTRATOR_DB_PATH, PROJECT_ROOT } from "../metadata/constants.js";
import { getRegressionDefinition, getScenarioDefinition, getWorkItemTemplateDefinition, listWorkItemTemplateDefinitions } from "../scenarios/catalog.js";
import { getRegressionRunSummaryById, getScenarioRunSummaryById, runRegressionById, runScenarioById } from "../scenarios/run-history.js";
import {
  getGoalPlan,
  getLearningRecord,
  getProposalArtifact,
  getProposalArtifactByRunId,
  getWorkspaceAllocation,
  getWorkspaceAllocationByRunId,
  getWorkItem,
  getWorkItemGroup,
  getWorkItemRun,
  insertGoalPlan,
  insertLearningRecord,
  insertProposalArtifact,
  insertWorkspaceAllocation,
  insertWorkItemGroup,
  listGoalPlans,
  listLearningRecords,
  listProposalArtifacts,
  listWorkspaceAllocations,
  listWorkItemGroups,
  listWorkItemRuns,
  listWorkItems,
  openOrchestratorDatabase,
  updateGoalPlan,
  updateLearningRecord,
  updateProposalArtifact,
  updateWorkspaceAllocation,
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
import {
  createWorkspace,
  deriveWorkspaceDiagnostics,
  inspectWorkspace,
  reconcileWorkspace,
  removeWorkspace,
  summarizeWorkspaceChanges,
  writeWorkspacePatchArtifact
} from "../../../workspace-manager/src/manager.js";

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

function workspaceLinks(workspaceId) {
  return {
    self: `/workspaces/${encodeURIComponent(workspaceId)}`
  };
}

function dependencyEdgeId(itemId, dependencyItemId, strictness = "hard") {
  return `dependency:${dependencyItemId}:${itemId}:${strictness}`;
}

function blockerId(edgeId, reasonCode) {
  return `blocker:${edgeId}:${reasonCode}`;
}

function appendDependencyLogEntry(entries = [], entry = {}) {
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
    nextActionHint: entry.nextActionHint ?? null
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
      dependencyTransitionLog: appendDependencyLogEntry(group.metadata?.dependencyTransitionLog, entry)
    },
    updatedAt: nowIso()
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

function workItemRequiresWorkspace(item) {
  return item.metadata?.requiresWorkspace === true || workItemKindRequiresProposal(item);
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
  const transitionLog = [...asArray(group.metadata?.dependencyTransitionLog), ...evaluated.dependencyGraph.transitionLog]
    .sort((left, right) => new Date(right.timestamp ?? 0) - new Date(left.timestamp ?? 0));
  
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
      transitionLog
    },
    readiness: evaluated.readiness,
    links: groupLinks(group.id)
  };
}

function buildProposalSummary(artifact) {
  if (!artifact) {
    return null;
  }
  const promotion = artifact.metadata?.promotion ?? null;
  return {
    ...artifact,
    promotionStatus: promotion?.status ?? null,
    promotion,
    links: proposalLinks(artifact.id)
  };
}

function getProposalPromotionState(proposal) {
  return proposal?.metadata?.promotion?.status ?? null;
}

function isProposalPromotionPending(proposal) {
  const promotionState = getProposalPromotionState(proposal);
  if (!proposal) {
    return false;
  }
  if (proposal.status === "approved" && !promotionState) {
    return true;
  }
  return ["ready_for_promotion", "promotion_candidate", "blocked", "policy_waiting_approval"].includes(promotionState);
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

function buildWorkspaceSummary(allocation) {
  return allocation ? {
    ...allocation,
    links: workspaceLinks(allocation.id),
    commandHint: `cd '${allocation.worktreePath}' && git status --short && git branch --show-current`
  } : null;
}

function getWorkspaceOwnerContext(allocation, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  if (!allocation) {
    return {
      workItemRun: null,
      proposal: null,
      workItem: null
    };
  }
  return withDatabase(dbPath, (db) => ({
    workItemRun: allocation.workItemRunId ? getWorkItemRun(db, allocation.workItemRunId) : null,
    proposal: allocation.proposalArtifactId ? getProposalArtifact(db, allocation.proposalArtifactId) : null,
    workItem: allocation.workItemId ? getWorkItem(db, allocation.workItemId) : null
  }));
}

function buildWorkspaceCleanupPolicy({ allocation, inspection = null, workItemRun = null, proposal = null } = {}) {
  const blockedBy = [];
  let reason = "ready";
  let eligible = true;

  if (!allocation) {
    return {
      eligible: false,
      reason: "missing-allocation",
      blockedBy: ["missing-allocation"],
      requiresForce: false
    };
  }

  if (allocation.status === "cleaned") {
    return {
      eligible: false,
      reason: "already-cleaned",
      blockedBy: ["already-cleaned"],
      requiresForce: false
    };
  }

  if (["provisioning"].includes(allocation.status)) {
    eligible = false;
    reason = "still-provisioning";
    blockedBy.push("still-provisioning");
  }

  if (proposal && (["ready_for_review", "reviewed"].includes(proposal.status) || isProposalPromotionPending(proposal))) {
    eligible = false;
    reason = isProposalPromotionPending(proposal)
      ? "proposal-awaiting-promotion"
      : "proposal-awaiting-governance";
    blockedBy.push(reason);
  }

  if (workItemRun && ["planned", "starting", "running"].includes(workItemRun.status)) {
    eligible = false;
    reason = "owner-run-active";
    blockedBy.push("owner-run-active");
  }

  const dirty = Array.isArray(inspection?.porcelain) && inspection.porcelain.length > 0;
  const requiresForce = dirty || ["orphaned", "failed"].includes(allocation.status);
  const artifactRetention =
    proposal && (["ready_for_review", "reviewed", "approved"].includes(proposal.status) || isProposalPromotionPending(proposal))
      ? "retain"
      : proposal
        ? "retain-patch-only"
        : "optional";
  const workspaceRetention =
    !eligible
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
      : "inspect-before-cleanup"
  };
}

function enrichWorkspaceAllocation(allocation, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH, inspection = null) {
  const summary = buildWorkspaceSummary(allocation);
  if (!summary) {
    return null;
  }
  const context = getWorkspaceOwnerContext(allocation, dbPath);
  const diagnostics =
    inspection
      ? deriveWorkspaceDiagnostics({ inspection, allocation })
      : compactObject(allocation.metadata?.diagnostics ?? {});
  const cleanupPolicy = buildWorkspaceCleanupPolicy({
    allocation,
    inspection,
    workItemRun: context.workItemRun,
    proposal: context.proposal
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
      proposalStatus: context.proposal?.status ?? null
    }
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

function workItemRunTerminalKind(run = {}) {
  const status = String(run.status ?? "").trim();
  if (["completed", "passed"].includes(status)) {
    return "completed";
  }
  if (["failed", "rejected", "canceled", "stopped"].includes(status)) {
    return "failed";
  }
  if (["waiting_review", "waiting_approval", "held", "paused", "blocked"].includes(status)) {
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
    scenarioRun: result.scenarioRunId ? `/scenario-runs/${encodeURIComponent(result.scenarioRunId)}` : null,
    regressionRun: result.regressionRunId ? `/regression-runs/${encodeURIComponent(result.regressionRunId)}` : null,
    execution: result.executionId ? `/executions/${encodeURIComponent(result.executionId)}` : null
  });
}

function buildRunComparison(currentRun, previousRun) {
  if (!currentRun || !previousRun) {
    return null;
  }
  const currentValidation = summarizeValidationState(currentRun.metadata?.validation);
  const previousValidation = summarizeValidationState(previousRun.metadata?.validation);
  const currentDocSuggestions = countDocSuggestions(currentRun.metadata?.docSuggestions);
  const previousDocSuggestions = countDocSuggestions(previousRun.metadata?.docSuggestions);
  const currentProposalId = currentRun.metadata?.proposalArtifactId ?? null;
  const previousProposalId = previousRun.metadata?.proposalArtifactId ?? null;
  const currentStarted = Date.parse(currentRun.startedAt ?? currentRun.createdAt ?? 0);
  const previousStarted = Date.parse(previousRun.startedAt ?? previousRun.createdAt ?? 0);

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
        : "No major run-to-run delta detected."
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
    { total: 0, completed: 0, blocked: 0, failed: 0, running: 0, pending: 0 }
  );
  const latest = runs[0] ?? null;
  const latestCompleted = runs.find((run) => workItemRunTerminalKind(run) === "completed") ?? null;
  const latestFailed = runs.find((run) => workItemRunTerminalKind(run) === "failed") ?? null;
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
    latestFailedRunId: latestFailed?.id ?? null
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
      executionId: result.executionId ?? null
    })
  };
}

function attentionPriorityForState(state) {
  const order = {
    "workspace-problem": 0,
    "needs-review": 1,
    "needs-approval": 2,
    "needs-validation": 3,
    "blocked": 4,
    "planner-follow-up": 5,
    "docs-follow-up": 6,
    "healthy": 7
  };
  return order[state] ?? 9;
}

function buildAttentionItem(payload = {}) {
  const attentionState = payload.attentionState ?? "healthy";
  const priority = payload.priority ?? (attentionPriorityForState(attentionState) <= 2 ? "high" : attentionPriorityForState(attentionState) <= 4 ? "medium" : "low");
  return compactObject({
    id: payload.id ?? createId("attention"),
    kind: payload.kind ?? attentionState,
    status: payload.status ?? attentionState,
    attentionState,
    attentionPriority: attentionPriorityForState(attentionState),
    priority,
    queueType: payload.queueType ?? (["workspace-problem", "needs-review", "needs-approval", "blocked"].includes(attentionState) ? "urgent" : "follow-up"),
    title: payload.title ?? "Untitled attention item",
    reason: payload.reason ?? "",
    targetType: payload.targetType ?? null,
    targetId: payload.targetId ?? null,
    itemId: payload.itemId ?? null,
    runId: payload.runId ?? null,
    proposalId: payload.proposalId ?? null,
    workspaceId: payload.workspaceId ?? null,
    groupId: payload.groupId ?? null,
    goalPlanId: payload.goalPlanId ?? null,
    templateId: payload.templateId ?? null,
    domainId: payload.domainId ?? null,
    safeMode: payload.safeMode ?? null,
    mutationScope: payload.mutationScope ?? [],
    requiresProposal: payload.requiresProposal ?? null,
    blockerIds: payload.blockerIds ?? [],
    actionHint: payload.actionHint ?? null,
    nextActionHint: payload.nextActionHint ?? null,
    commandHint: payload.commandHint ?? null,
    httpHint: payload.httpHint ?? null,
    timestamp: payload.timestamp ?? nowIso()
  });
}

function summarizeAttentionItems(items = []) {
  const byState = items.reduce((accumulator, item) => {
    const state = item.attentionState ?? "healthy";
    accumulator[state] = (accumulator[state] ?? 0) + 1;
    return accumulator;
  }, {});
  const topItems = [...items]
    .sort((left, right) => {
      const priorityDelta = (left.attentionPriority ?? 9) - (right.attentionPriority ?? 9);
      if (priorityDelta !== 0) return priorityDelta;
      return new Date(right.timestamp ?? 0) - new Date(left.timestamp ?? 0);
    })
    .slice(0, 10);
  return {
    total: items.length,
    byState,
    highestPriorityState: topItems[0]?.attentionState ?? "healthy",
    topItems
  };
}

function buildQueueSummary(urgentWork = [], followUpWork = []) {
  const all = [...urgentWork, ...followUpWork];
  const byGroup = all.reduce((accumulator, item) => {
    const key = item.groupId ?? "ungrouped";
    const entry = accumulator[key] ?? { count: 0, attentionStates: {}, groupId: item.groupId ?? null, goalPlanId: item.goalPlanId ?? null };
    entry.count += 1;
    entry.attentionStates[item.attentionState ?? "healthy"] = (entry.attentionStates[item.attentionState ?? "healthy"] ?? 0) + 1;
    accumulator[key] = entry;
    return accumulator;
  }, {});
  const byGoalPlan = all.reduce((accumulator, item) => {
    const key = item.goalPlanId ?? "no-goal-plan";
    accumulator[key] = (accumulator[key] ?? 0) + 1;
    return accumulator;
  }, {});
  return {
    total: all.length,
    urgent: urgentWork.length,
    followUp: followUpWork.length,
    byGroup,
    byGoalPlan
  };
}

async function provisionWorkspaceForWorkItemRun(item, run, options = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
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
    worktreePath: path.join(PROJECT_ROOT, ".spore", "worktrees", item.metadata?.projectId ?? "spore", createId("pending")),
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
      repoRoot
    },
    createdAt: now,
    updatedAt: now,
    cleanedAt: null
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
      mutationScope
    });
    const inspected = await inspectWorkspace({
      repoRoot,
      worktreePath: created.worktreePath,
      branchName: created.branchName
    });
    const updated = {
      ...allocation,
      worktreePath: created.worktreePath,
      branchName: created.branchName,
      status: inspected.clean ? "provisioned" : "active",
      metadata: {
        ...allocation.metadata,
        inspection: inspected
      },
      updatedAt: nowIso()
    };
    withDatabase(dbPath, (db) => updateWorkspaceAllocation(db, updated));
    return updated;
  } catch (error) {
    const failed = {
      ...allocation,
      status: "failed",
      metadata: {
        ...allocation.metadata,
        error: error.message
      },
      updatedAt: nowIso()
    };
    withDatabase(dbPath, (db) => updateWorkspaceAllocation(db, failed));
    throw error;
  }
}

function buildChangedFilesByScope(diffSummary = null) {
  if (!diffSummary || !Array.isArray(diffSummary.filesByScope)) {
    return [];
  }
  return diffSummary.filesByScope.map((entry) => ({
    scope: entry.scope,
    fileCount: entry.fileCount,
    addedCount: entry.addedCount,
    modifiedCount: entry.modifiedCount,
    deletedCount: entry.deletedCount,
    renamedCount: entry.renamedCount,
    untrackedCount: entry.untrackedCount,
    conflictedCount: entry.conflictedCount,
    insertionCount: entry.insertionCount,
    deletionCount: entry.deletionCount,
    files: entry.files.map((file) => ({
      path: file.path,
      previousPath: file.previousPath ?? null,
      status: file.status,
      insertions: file.insertions ?? 0,
      deletions: file.deletions ?? 0
    }))
  }));
}

async function attachWorkspacePatchArtifact(proposal, workspace) {
  if (!proposal || !workspace?.worktreePath) {
    return proposal;
  }
  const patchPath = path.join(PROJECT_ROOT, "artifacts", "proposals", `${proposal.id}.patch`);
  const [patchArtifact, diffSummary] = await Promise.all([
    writeWorkspacePatchArtifact({
      worktreePath: workspace.worktreePath,
      outputPath: patchPath
    }),
    summarizeWorkspaceChanges({
      worktreePath: workspace.worktreePath,
      mutationScope: workspace.mutationScope ?? []
    })
  ]);
  const patchPreview = await fs.readFile(patchArtifact.outputPath, "utf8")
    .then((content) => content.split(/\r?\n/).slice(0, 40).join("\n").slice(0, 4000))
    .catch(() => "");
  return {
    ...proposal,
    artifacts: {
      ...(proposal.artifacts ?? {}),
      proposedFiles:
        Array.isArray(diffSummary?.changedFiles) && diffSummary.changedFiles.length > 0
          ? diffSummary.changedFiles.map((file) => ({
              path: file.path,
              previousPath: file.previousPath ?? null,
              scope: file.scope ?? null,
              status: file.status,
              insertions: file.insertions ?? 0,
              deletions: file.deletions ?? 0
            }))
          : proposal.artifacts?.proposedFiles ?? [],
      workspace: {
        workspaceId: workspace.id,
        worktreePath: workspace.worktreePath,
        branchName: workspace.branchName,
        baseRef: workspace.baseRef,
        status: workspace.status,
        mutationScope: workspace.mutationScope ?? []
      },
      patchArtifact: {
        path: path.relative(PROJECT_ROOT, patchArtifact.outputPath),
        byteLength: patchArtifact.byteLength,
        preview: patchPreview
      },
      diffSummary,
      changedFilesByScope: buildChangedFilesByScope(diffSummary)
    },
    metadata: {
      ...(proposal.metadata ?? {}),
      workspaceId: workspace.id
    },
    updatedAt: nowIso()
  };
}

function buildProposalArtifacts(item, run, validation = null, workspace = null) {
  const changeSummary = item.goal || `Proposal generated for ${item.title}`;
  const mutationScope = asArray(item.metadata?.mutationScope);
  const diffSummary = workspace?.metadata?.diffSummary ?? null;
  return {
    changeSummary,
    proposedFiles:
      Array.isArray(diffSummary?.changedFiles) && diffSummary.changedFiles.length > 0
        ? diffSummary.changedFiles.map((file) => ({
            path: file.path,
            previousPath: file.previousPath ?? null,
            scope: file.scope ?? null,
            status: file.status,
            insertions: file.insertions ?? 0,
            deletions: file.deletions ?? 0
          }))
        : mutationScope.map((scope) => ({ scope, status: "planned" })),
    diffSummary: diffSummary
      ? {
          fileCount: diffSummary.fileCount,
          trackedFileCount: diffSummary.trackedFileCount,
          untrackedFileCount: diffSummary.untrackedFileCount,
          addedCount: diffSummary.addedCount,
          modifiedCount: diffSummary.modifiedCount,
          deletedCount: diffSummary.deletedCount,
          renamedCount: diffSummary.renamedCount,
          conflictedCount: diffSummary.conflictedCount,
          insertionCount: diffSummary.insertionCount,
          deletionCount: diffSummary.deletionCount
        }
      : {
          fileCount: 0,
          trackedFileCount: 0,
          untrackedFileCount: 0,
          addedCount: 0,
          modifiedCount: 0,
          deletedCount: 0,
          renamedCount: 0,
          conflictedCount: 0,
          insertionCount: 0,
          deletionCount: 0
        },
    changedFilesByScope:
      Array.isArray(diffSummary?.filesByScope) && diffSummary.filesByScope.length > 0
        ? buildChangedFilesByScope(diffSummary)
        : mutationScope.map((scope) => ({
            scope,
            fileCount: 0,
            addedCount: 0,
            modifiedCount: 0,
            deletedCount: 0,
            renamedCount: 0,
            untrackedCount: 0,
            conflictedCount: 0,
            insertionCount: 0,
            deletionCount: 0,
            files: []
          })),
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
    handoffSnapshot: workspace?.metadata?.handoff
      ? {
          snapshotRef: workspace.metadata.handoff.snapshotRef ?? null,
          snapshotCommit: workspace.metadata.handoff.snapshotCommit ?? null,
          publishedAt: workspace.metadata.handoff.publishedAt ?? null,
          committed: workspace.metadata.handoff.committed ?? null
        }
      : null,
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
  return withDatabase(dbPath, (db) => {
    const item = getWorkItem(db, itemId);
    const runs = listWorkItemRuns(db, itemId, limit);
    return runs.map((run, index) => buildWorkItemRunSummary(run, item, runs[index + 1] ?? null));
  });
}

export function getSelfBuildWorkItem(itemId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const item = getManagedWorkItem(itemId, dbPath);
  if (!item) {
    return null;
  }
  const group = item.metadata?.groupId ? withDatabase(dbPath, (db) => getWorkItemGroup(db, item.metadata.groupId)) : null;
  const goalPlan = item.metadata?.goalPlanId ? withDatabase(dbPath, (db) => getGoalPlan(db, item.metadata.goalPlanId)) : null;
  const recentRuns = listSelfBuildWorkItemRuns(itemId, { limit: 20 }, dbPath);
  const latestProposal = recentRuns.length > 0 
    ? withDatabase(dbPath, (db) => getProposalArtifactByRunId(db, recentRuns[0].id))
    : null;
  const latestWorkspace = recentRuns.length > 0
    ? withDatabase(dbPath, (db) => getWorkspaceAllocationByRunId(db, recentRuns[0].id))
    : null;
  const groupItems = group ? listManagedWorkItems({ limit: 500 }, dbPath).filter((entry) => entry.metadata?.groupId === group.id) : [];
  const groupRuns = groupItems.flatMap((entry) => entry.runs ?? []);
  const groupSummary = group ? buildGroupSummary(group, groupItems, groupRuns) : null;
  const derivedItem = groupSummary?.items?.find((entry) => entry.id === itemId) ?? item;
  
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
        rerun: `/work-items/${encodeURIComponent(itemId)}/run`
      }
    },
    latestProposal: latestProposal ? buildProposalSummary(latestProposal) : null,
    latestWorkspace: buildWorkspaceSummary(latestWorkspace),
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
  const recentRuns = withDatabase(dbPath, (db) => listWorkItemRuns(db, run.workItemId, 20));
  const runIndex = recentRuns.findIndex((entry) => entry.id === run.id);
  const previousRun = runIndex >= 0 ? recentRuns[runIndex + 1] ?? null : recentRuns.find((entry) => entry.id !== run.id) ?? null;
  const proposal = withDatabase(dbPath, (db) => getProposalArtifactByRunId(db, run.id));
  const workspace = withDatabase(dbPath, (db) => getWorkspaceAllocationByRunId(db, run.id));
  const learningRecords = withDatabase(dbPath, (db) =>
    listLearningRecords(db, "work-item-run", 50).filter((record) => record.sourceId === run.id)
  );
  const docSuggestions = run.metadata?.docSuggestions ?? buildDocSuggestions(item ?? { relatedDocs: [] }, run, proposal);
  const group = item?.metadata?.groupId ? withDatabase(dbPath, (db) => getWorkItemGroup(db, item.metadata.groupId)) : null;
  const goalPlan = item?.metadata?.goalPlanId ? withDatabase(dbPath, (db) => getGoalPlan(db, item.metadata.goalPlanId)) : null;
  const failure =
    run.status === "failed"
      ? {
          code: "work_item_run_failed",
          label: "Work item run failed",
          reason: run.result?.error ?? run.metadata?.error ?? "The work item run ended in a failed state."
        }
      : run.status === "blocked"
      ? {
          code: "work_item_run_blocked",
          label: "Work item run blocked",
          reason: item?.blockedReason ?? item?.dependencyState?.reason ?? "The work item run is blocked."
        }
      : null;
  const suggestedActions = [];
  if (failure && run.status === "failed") {
    suggestedActions.push({
      action: "rerun-work-item",
      targetType: "work-item-run",
      targetId: run.id,
      reason: failure.reason,
      expectedOutcome: "Create a fresh run of the same work item with new runtime and proposal artifacts.",
      commandHint: `npm run orchestrator:work-item-run -- --item ${run.workItemId}`,
      httpHint: `/work-item-runs/${encodeURIComponent(run.id)}/rerun`,
      priority: "high"
    });
  }
  if (run.status === "completed" && summarizeValidationState(run.metadata?.validation) !== "completed") {
    suggestedActions.push({
      action: "validate-work-item-run",
      targetType: "work-item-run",
      targetId: run.id,
      reason: "Validation has not been executed for this completed work-item run.",
      expectedOutcome: "Create linked scenario and regression validation records for the run.",
      commandHint: `npm run orchestrator:work-item-validate -- --run ${run.id}`,
      httpHint: `/work-item-runs/${encodeURIComponent(run.id)}/validate`,
      priority: "medium"
    });
  }
  if ((run.metadata?.proposalArtifactId ?? proposal?.id) && proposal?.status === "ready_for_review") {
    suggestedActions.push({
      action: "review-proposal",
      targetType: "proposal",
      targetId: proposal.id,
      reason: "The linked proposal is waiting for review.",
      expectedOutcome: "Record proposal review notes and move governance forward.",
      commandHint: `npm run orchestrator:proposal-show -- --proposal ${proposal.id}`,
      httpHint: `/proposal-artifacts/${encodeURIComponent(proposal.id)}`,
      priority: "high"
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
      goalPlan: goalPlan ? { id: goalPlan.id, title: goalPlan.title, goal: goalPlan.goal } : null
    },
    links: {
      ...buildWorkItemRunLinks(run),
      self: `/work-item-runs/${encodeURIComponent(runId)}`,
      item: `/work-items/${encodeURIComponent(run.workItemId)}`,
      proposal: proposal ? `/proposal-artifacts/${encodeURIComponent(proposal.id)}` : null,
      workspace: workspace ? `/workspaces/${encodeURIComponent(workspace.id)}` : `/work-item-runs/${encodeURIComponent(runId)}/workspace`,
      validate: `/work-item-runs/${encodeURIComponent(runId)}/validate`,
      docSuggestions: `/work-item-runs/${encodeURIComponent(runId)}/doc-suggestions`,
      group: group ? `/work-item-groups/${encodeURIComponent(group.id)}` : null,
      goalPlan: goalPlan ? `/goal-plans/${encodeURIComponent(goalPlan.id)}` : null
    }
  };
}

export async function rerunSelfBuildWorkItemRun(runId, options = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const existingRun = withDatabase(dbPath, (db) => getWorkItemRun(db, runId));
  if (!existingRun) {
    return null;
  }
  const result = await runSelfBuildWorkItem(existingRun.workItemId, {
    ...options,
    source: options.source ?? "work-item-rerun",
    by: options.by ?? "operator"
  }, dbPath);
  if (result?.run?.id) {
    const updatedRun = {
      ...result.run,
      metadata: {
        ...result.run.metadata,
        rerunOf: runId,
        rerunReason: options.reason ?? null,
        rerunSource: options.source ?? "work-item-rerun"
      }
    };
    withDatabase(dbPath, (db) => updateWorkItemRun(db, updatedRun));
    result.run = getManagedWorkItemRun(updatedRun.id, dbPath);
    if (result.proposal?.id) {
      const proposal = withDatabase(dbPath, (db) => getProposalArtifact(db, result.proposal.id));
      if (proposal) {
        withDatabase(dbPath, (db) => updateProposalArtifact(db, {
          ...proposal,
          metadata: {
            ...proposal.metadata,
            rerunOf: runId,
            rerunSource: options.source ?? "work-item-rerun"
          },
          updatedAt: nowIso()
        }));
        result.proposal = buildProposalSummary(withDatabase(dbPath, (db) => getProposalArtifact(db, result.proposal.id)));
      }
    }
  }
  return {
    ...result,
    rerunOf: runId
  };
}

export async function runSelfBuildWorkItem(itemId, options = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const item = withDatabase(dbPath, (db) => getWorkItem(db, itemId));
  if (!item) {
    return null;
  }
  ensureSafeMode(item, item.metadata?.projectId ?? "spore");
  let provisionedWorkspace = null;
  let result;
  try {
    result = await runManagedWorkItem(itemId, {
      ...options,
      beforeExecute: async ({ run, runningItem }) => {
        if (!workItemRequiresWorkspace(runningItem)) {
          return { run, item: runningItem };
        }
        provisionedWorkspace = await provisionWorkspaceForWorkItemRun(runningItem, run, options, dbPath);
        return {
          run: {
            ...run,
            metadata: {
              ...run.metadata,
              workspaceId: provisionedWorkspace.id,
              workspacePath: provisionedWorkspace.worktreePath,
              workspaceBranch: provisionedWorkspace.branchName
            }
          },
          item: {
            ...runningItem,
            metadata: {
              ...runningItem.metadata,
              lastWorkspaceId: provisionedWorkspace.id
            }
          }
        };
      }
    }, dbPath);
  } catch (error) {
    const failedItem = withDatabase(dbPath, (db) => getWorkItem(db, itemId));
    const failedRun = failedItem?.metadata?.lastRunId ? getManagedWorkItemRun(failedItem.metadata.lastRunId, dbPath) : null;
    let proposal = null;
    if (failedItem && failedRun && workItemKindRequiresProposal(failedItem)) {
      const now = nowIso();
      const proposalWorkspace = provisionedWorkspace ?? getWorkspaceByRun(failedRun.id, dbPath);
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
          safeMode: failedItem.metadata?.safeMode !== false
        },
        artifacts: buildProposalArtifacts(failedItem, failedRun, failedRun.metadata?.validation ?? null, proposalWorkspace),
        metadata: {
          source: options.source ?? "work-item-run",
          requiresHumanApproval: failedItem.metadata?.requiresHumanApproval ?? false,
          workspaceId: failedRun.metadata?.workspaceId ?? provisionedWorkspace?.id ?? null
        },
        createdAt: now,
        updatedAt: now,
        reviewedAt: null,
        approvedAt: null
      };
      proposal = await attachWorkspacePatchArtifact(proposal, proposalWorkspace);
      withDatabase(dbPath, (db) => insertProposalArtifact(db, proposal));
      if (provisionedWorkspace) {
        const updatedWorkspace = {
          ...provisionedWorkspace,
          executionId: failedRun.result?.executionId ?? provisionedWorkspace.executionId ?? null,
          proposalArtifactId: proposal.id,
          status: "active",
          updatedAt: nowIso()
        };
        withDatabase(dbPath, (db) => updateWorkspaceAllocation(db, updatedWorkspace));
        provisionedWorkspace = updatedWorkspace;
      }
      failedRun.metadata = {
        ...failedRun.metadata,
        proposalArtifactId: proposal.id,
        docSuggestions: buildDocSuggestions(failedItem, failedRun, proposal)
      };
      withDatabase(dbPath, (db) => updateWorkItemRun(db, failedRun));
    }
    const learningRecord = failedItem && failedRun ? await maybeCreateLearningRecord(failedItem, failedRun, proposal, dbPath) : null;
    return {
      item: failedItem,
      run: failedRun,
      proposal: buildProposalSummary(proposal),
      learningRecord: buildLearningSummary(learningRecord),
      error: error.message
    };
  }
  const runDetail = getManagedWorkItemRun(result.run.id, dbPath);
  const settledItem = withDatabase(dbPath, (db) => getWorkItem(db, itemId));
  let proposal = null;
  if (workItemKindRequiresProposal(settledItem)) {
    const now = nowIso();
    const proposalWorkspace = provisionedWorkspace ?? getWorkspaceByRun(runDetail.id, dbPath);
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
      artifacts: buildProposalArtifacts(settledItem, runDetail, runDetail.metadata?.validation ?? null, proposalWorkspace),
      metadata: {
        source: options.source ?? "work-item-run",
        requiresHumanApproval: settledItem.metadata?.requiresHumanApproval ?? false,
        workspaceId: runDetail.metadata?.workspaceId ?? provisionedWorkspace?.id ?? null
      },
      createdAt: now,
      updatedAt: now,
      reviewedAt: null,
      approvedAt: null
    };
    proposal = await attachWorkspacePatchArtifact(proposal, proposalWorkspace);
    withDatabase(dbPath, (db) => insertProposalArtifact(db, proposal));
    if (provisionedWorkspace) {
      const updatedWorkspace = {
        ...provisionedWorkspace,
        executionId: runDetail.result?.executionId ?? provisionedWorkspace.executionId ?? null,
        proposalArtifactId: proposal.id,
        status: "settled",
        updatedAt: nowIso()
      };
      withDatabase(dbPath, (db) => updateWorkspaceAllocation(db, updatedWorkspace));
      provisionedWorkspace = updatedWorkspace;
    }
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

  recordGroupDependencyTransition(groupId, {
    type: "dependency_graph_updated",
    state: "ready",
    reasonCode: "graph_updated",
    reason: `Updated ${requestedEdges.length} dependency edge${requestedEdges.length === 1 ? "" : "s"} for work-item group ${groupId}.`,
    nextActionHint: "Review readiness counts before running the group."
  }, dbPath);

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
      recordGroupDependencyTransition(
        groupId,
        {
          type: "dependency_skip",
          state: current.dependencyState.state,
          reasonCode: current.dependencyState.blockers?.[0]?.reasonCode ?? "dependency_blocked",
          reason: current.dependencyState.reason,
          itemId: current.id,
          dependencyItemId: current.dependencyState.blockers?.[0]?.dependencyItemId ?? null,
          blockerId: current.blockerIds?.[0] ?? null,
          strictness: current.dependencyState.blockers?.[0]?.strictness ?? null,
          nextActionHint: current.nextActionHint
        },
        dbPath
      );
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
      recordGroupDependencyTransition(
        groupId,
        {
          type: "dependency_skip",
          state: "completed",
          reasonCode: "already_completed",
          reason: `${current.title} was already completed before the group run reached it.`,
          itemId: current.id,
          nextActionHint: "No action needed."
        },
        dbPath
      );
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

export function listExecutionWorkspaces(executionId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const workspaces = withDatabase(dbPath, (db) =>
    listWorkspaceAllocations(db, { executionId, limit: 200 })
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
      self: `/executions/${encodeURIComponent(executionId)}/workspaces`
    }
  };
}

export function listWorkspaceSummaries(options = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  return withDatabase(dbPath, (db) => listWorkspaceAllocations(db, options)).map((allocation) => enrichWorkspaceAllocation(allocation, dbPath));
}

export function getWorkspaceSummary(workspaceId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const allocation = withDatabase(dbPath, (db) => getWorkspaceAllocation(db, workspaceId));
  if (!allocation) {
    return null;
  }
  return enrichWorkspaceAllocation(allocation, dbPath);
}

export function getWorkspaceByRun(runId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const allocation = withDatabase(dbPath, (db) => getWorkspaceAllocationByRunId(db, runId));
  return enrichWorkspaceAllocation(allocation, dbPath);
}

function deriveReconciledWorkspaceStatus(allocation, inspection, workItemRun) {
  if (allocation.status === "cleaned") {
    return "cleaned";
  }
  if (!inspection.exists || !inspection.registered) {
    return "orphaned";
  }
  if (workItemRun && ["planned", "starting", "running"].includes(workItemRun.status)) {
    return inspection.clean ? "provisioned" : "active";
  }
  if (allocation.status === "failed") {
    return "failed";
  }
  return inspection.clean ? "settled" : "active";
}

export async function getWorkspaceDetail(workspaceId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const allocation = withDatabase(dbPath, (db) => getWorkspaceAllocation(db, workspaceId));
  if (!allocation) {
    return null;
  }
  const repoRoot = allocation.metadata?.repoRoot ? path.resolve(allocation.metadata.repoRoot) : PROJECT_ROOT;
  const inspection = await inspectWorkspace({
    repoRoot,
    worktreePath: allocation.worktreePath,
    branchName: allocation.branchName ?? null
  });
  return enrichWorkspaceAllocation(allocation, dbPath, inspection);
}

export async function getWorkspaceDetailByRun(runId, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const allocation = withDatabase(dbPath, (db) => getWorkspaceAllocationByRunId(db, runId));
  if (!allocation) {
    return null;
  }
  return getWorkspaceDetail(allocation.id, dbPath);
}

export async function reconcileManagedWorkspace(workspaceId, options = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const allocation = withDatabase(dbPath, (db) => getWorkspaceAllocation(db, workspaceId));
  if (!allocation) {
    return null;
  }
  const repoRoot = allocation.metadata?.repoRoot ? path.resolve(allocation.metadata.repoRoot) : PROJECT_ROOT;
  const reconciled = await reconcileWorkspace({
    repoRoot,
    allocation
  });
  const ownerContext = getWorkspaceOwnerContext(allocation, dbPath);
  const updated = {
    ...allocation,
    status: deriveReconciledWorkspaceStatus(allocation, reconciled.inspection, ownerContext.workItemRun),
    metadata: {
      ...allocation.metadata,
      diagnostics: reconciled.diagnostics,
      lastInspection: reconciled.inspection,
      lastReconciledAt: nowIso(),
      reconciledBy: options.by ?? "operator",
      reconcileSource: options.source ?? "workspace-reconcile"
    },
    updatedAt: nowIso()
  };
  withDatabase(dbPath, (db) => updateWorkspaceAllocation(db, updated));
  return getWorkspaceDetail(updated.id, dbPath);
}

export async function cleanupManagedWorkspace(workspaceId, options = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const allocation = withDatabase(dbPath, (db) => getWorkspaceAllocation(db, workspaceId));
  if (!allocation) {
    return null;
  }
  const repoRoot = allocation.metadata?.repoRoot ? path.resolve(allocation.metadata.repoRoot) : PROJECT_ROOT;
  const inspection = await inspectWorkspace({
    repoRoot,
    worktreePath: allocation.worktreePath,
    branchName: allocation.branchName ?? null
  });
  const ownerContext = getWorkspaceOwnerContext(allocation, dbPath);
  const cleanupPolicy = buildWorkspaceCleanupPolicy({
    allocation,
    inspection,
    workItemRun: ownerContext.workItemRun,
    proposal: ownerContext.proposal
  });
  if (!cleanupPolicy.eligible && options.force !== true) {
    const error = new Error(`workspace cleanup blocked: ${cleanupPolicy.reason}`);
    error.code = "cleanup_blocked";
    throw error;
  }

  let cleanupResult = {
    removed: false,
    skipped: true,
    reason: "already-missing"
  };
  if (inspection.exists && inspection.registered) {
    cleanupResult = await removeWorkspace({
      repoRoot,
      worktreePath: allocation.worktreePath,
      branchName: allocation.branchName ?? null,
      force: options.force === true || cleanupPolicy.requiresForce,
      keepBranch: options.keepBranch === true
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
      keptBranch: options.keepBranch === true
    },
    updatedAt: nowIso()
  };
  withDatabase(dbPath, (db) => updateWorkspaceAllocation(db, updated));
  return enrichWorkspaceAllocation(updated, dbPath, {
    ...inspection,
    exists: false,
    registered: false,
    clean: true,
    issues: []
  });
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
  const nextPromotion =
    approved === "approved"
      ? {
          status: decision.promotionStatus ?? "ready_for_promotion",
          targetBranch: decision.targetBranch ?? artifact.metadata?.promotion?.targetBranch ?? null,
          integrationBranch: decision.integrationBranch ?? artifact.artifacts?.workspace?.branchName ?? artifact.metadata?.promotion?.integrationBranch ?? null,
          source: "proposal-approval",
          updatedAt: nowIso()
        }
      : {
          status: approved === "rejected" ? "rejected" : artifact.metadata?.promotion?.status ?? null,
          updatedAt: nowIso()
        };
  const updated = {
    ...artifact,
    status: approved,
    updatedAt: nowIso(),
    approvedAt: nowIso(),
    metadata: {
      ...artifact.metadata,
      promotion: compactObject({
        ...(artifact.metadata?.promotion ?? {}),
        ...nextPromotion
      }),
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
  const validationErrors = [];
  for (const scenarioId of scenarioIds) {
    const definition = await getScenarioDefinition(scenarioId);
    if (!definition) continue;
    try {
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
    } catch (error) {
      validationErrors.push({
        kind: "scenario",
        id: scenarioId,
        message: error.message
      });
    }
  }
  for (const regressionId of regressionIds) {
    const definition = await getRegressionDefinition(regressionId);
    if (!definition) continue;
    try {
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
    } catch (error) {
      validationErrors.push({
        kind: "regression",
        id: regressionId,
        message: error.message
      });
    }
  }
  const validation = {
    status:
      validationErrors.length > 0
        ? "failed"
        : regressionRuns.length === 0 && scenarioRuns.length === 0
        ? "not_configured"
        : "completed",
    scenarioRunIds: scenarioRuns,
    regressionRunIds: regressionRuns,
    errors: validationErrors,
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
  const goalPlans = listGoalPlansSummary({ limit: 100 }, dbPath);
  const proposals = withDatabase(dbPath, (db) => listProposalArtifacts(db, null, 100)).map(buildProposalSummary);
  const workspaces = withDatabase(dbPath, (db) => listWorkspaceAllocations(db, { limit: 200 })).map(buildWorkspaceSummary);
  const learnings = withDatabase(dbPath, (db) => listLearningRecords(db, null, 100)).map(buildLearningSummary);
  const allRuns = workItems.flatMap((item) => listSelfBuildWorkItemRuns(item.id, { limit: 20 }, dbPath).map((run) => ({ ...run, itemTitle: item.title, itemId: item.id })));

  const blockedItems = workItems.filter((item) => item.status === "blocked" || ["blocked", "review_needed"].includes(item.dependencyState?.state));
  const failedItems = workItems.filter((item) => item.status === "failed");
  const waitingReviewProposals = proposals.filter((proposal) => proposal.status === "ready_for_review");
  const waitingApprovalProposals = proposals.filter((proposal) => ["reviewed", "waiting_approval"].includes(proposal.status));
  const promotionPendingProposals = proposals.filter((proposal) => isProposalPromotionPending(proposal));
  const orphanedWorkspaces = workspaces.filter((workspace) => ["orphaned", "failed"].includes(workspace.status));
  const activeWorkspaces = workspaces.filter((workspace) => ["provisioned", "active", "settled"].includes(workspace.status));
  const pendingValidationRuns = allRuns.filter((run) => 
    run.status === "completed" && (!run.metadata?.validation || run.metadata.validation.status !== "completed")
  );
  const needsDocFollowUpRuns = allRuns.filter((run) =>
    run.metadata?.docSuggestions && run.metadata.docSuggestions.length > 0
  );
  const recentLearnings = learnings.filter((learning) => learning.status === "active").slice(0, 10);
  const plannerFollowUpPlans = goalPlans.filter((plan) => plan.status === "planned");

  const urgentQueue = [
    ...blockedItems.map((item) => buildAttentionItem({
      id: `attention:${item.id}:blocked`,
      attentionState: item.dependencyState?.state === "review_needed" ? "needs-review" : "blocked",
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
      reason: item.blockedReason ?? item.dependencyState?.reason ?? "Work item blocked and requires operator intervention.",
      httpHint: `/work-items/${encodeURIComponent(item.id)}`,
      commandHint: `npm run orchestrator:work-item-show -- --item ${item.id}`,
      blockerIds: item.blockerIds ?? [],
      nextActionHint: item.nextActionHint ?? item.dependencyState?.nextActionHint ?? null,
      timestamp: item.updatedAt
    })),
    ...failedItems.map((item) => buildAttentionItem({
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
      timestamp: item.updatedAt
    })),
    ...waitingReviewProposals.map((proposal) => buildAttentionItem({
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
      timestamp: proposal.createdAt
    })),
    ...waitingApprovalProposals.map((proposal) => buildAttentionItem({
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
      timestamp: proposal.reviewedAt ?? proposal.createdAt
    })),
    ...promotionPendingProposals.map((proposal) => buildAttentionItem({
      id: `attention:${proposal.id}:promotion`,
      attentionState: "planner-follow-up",
      targetType: "proposal",
      targetId: proposal.id,
      proposalId: proposal.id,
      itemId: proposal.workItemId ?? null,
      runId: proposal.workItemRunId ?? null,
      title: proposal.summary?.title ?? "Untitled proposal",
      reason: "Proposal approved but not yet promoted through an integration lane.",
      httpHint: `/proposal-artifacts/${encodeURIComponent(proposal.id)}`,
      commandHint: `npm run orchestrator:proposal-show -- --proposal ${proposal.id}`,
      nextActionHint: "Use the promotion planner or explicit coordinator-to-integrator lane when the project family is ready.",
      timestamp: proposal.approvedAt ?? proposal.updatedAt ?? proposal.createdAt
    })),
    ...orphanedWorkspaces.map((workspace) => buildAttentionItem({
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
      nextActionHint: "Inspect the workspace and reconcile or remove it if the owner run is already settled.",
      timestamp: workspace.updatedAt
    }))
  ].sort((left, right) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const leftPriority = priorityOrder[left.priority] ?? 3;
    const rightPriority = priorityOrder[right.priority] ?? 3;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return new Date(right.timestamp) - new Date(left.timestamp);
  });

  const followUpQueue = [
    ...pendingValidationRuns.slice(0, 10).map((run) => buildAttentionItem({
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
      nextActionHint: "Trigger validation to attach durable scenario and regression evidence.",
      timestamp: run.endedAt ?? run.startedAt
    })),
    ...needsDocFollowUpRuns.slice(0, 10).map((run) => buildAttentionItem({
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
      timestamp: run.endedAt ?? run.startedAt
    })),
    ...plannerFollowUpPlans.slice(0, 10).map((plan) => buildAttentionItem({
      id: `attention:${plan.id}:planner`,
      attentionState: "planner-follow-up",
      targetType: "goal-plan",
      targetId: plan.id,
      goalPlanId: plan.id,
      title: plan.title,
      reason: "Goal plan is still planned and waiting to be materialized into managed work.",
      httpHint: `/goal-plans/${encodeURIComponent(plan.id)}`,
      commandHint: `npm run orchestrator:goal-plan-show -- --plan ${plan.id}`,
      timestamp: plan.updatedAt
    }))
  ].sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp));

  const attentionItems = [...urgentQueue, ...followUpQueue];
  const attentionSummary = summarizeAttentionItems(attentionItems);
  const queueSummary = buildQueueSummary(urgentQueue, followUpQueue);

  const mostRecentActivity = [
    ...workItems.map((item) => ({ kind: "work-item", timestamp: item.updatedAt })),
    ...groups.map((group) => ({ kind: "group", timestamp: group.updatedAt })),
    ...proposals.map((proposal) => ({ kind: "proposal", timestamp: proposal.updatedAt })),
    ...learnings.map((learning) => ({ kind: "learning", timestamp: learning.updatedAt })),
    ...goalPlans.map((plan) => ({ kind: "goal-plan", timestamp: plan.updatedAt }))
  ].sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp))[0];

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
      generatedAt: now
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
      pendingValidationRuns: pendingValidationRuns.length,
      learningRecords: learnings.length,
      goalPlans: goalPlans.length,
      plannedGoalPlans: plannerFollowUpPlans.length
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
    workspaces: workspaces.slice(0, 50),
    orphanedWorkspaces,
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
      action:
        item.kind === "blocked-work-item" || item.kind === "failed-work-item"
          ? "inspect-work-item"
          : item.kind === "orphaned-workspace"
            ? "inspect-workspace"
            : "review-proposal",
      targetType: item.itemId ? "work-item" : item.workspaceId ? "workspace" : "proposal",
      targetId: item.itemId ?? item.workspaceId ?? item.proposalId,
      priority: item.priority,
      reason: item.reason,
      expectedOutcome: item.kind === "waiting-review" 
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
      httpHint: item.httpHint
    })),
    alerts: attentionItems.filter((item) => item.queueType === "urgent").slice(0, 10),
    attentionItems
  };
}

export function getSelfBuildDashboard(options = {}, dbPath = DEFAULT_ORCHESTRATOR_DB_PATH) {
  const base = getSelfBuildSummary(dbPath);
  const filters = compactObject({
    status: toText(options.status, ""),
    group: toText(options.group, ""),
    template: toText(options.template, ""),
    domain: toText(options.domain, "")
  });
  const workItems = base.workItems.filter((item) => {
    if (filters.status && String(item.status ?? item.dependencyState?.state ?? "").trim() !== filters.status) return false;
    if (filters.group && String(item.metadata?.groupId ?? "").trim() !== filters.group) return false;
    if (filters.template && String(item.metadata?.templateId ?? "").trim() !== filters.template) return false;
    if (filters.domain && String(item.metadata?.domainId ?? "").trim() !== filters.domain) return false;
    return true;
  });
  const workItemIds = new Set(workItems.map((item) => item.id));
  const groups = base.groups.filter((group) => !filters.group || group.id === filters.group || group.items.some((item) => workItemIds.has(item.id)));
  const proposals = base.proposals.filter((proposal) => !proposal.workItemId || workItemIds.size === 0 || workItemIds.has(proposal.workItemId));
  const workspaces = base.workspaces.filter((workspace) => !workspace.workItemId || workItemIds.size === 0 || workItemIds.has(workspace.workItemId));
  const recentRuns = workItems.flatMap((item) => listSelfBuildWorkItemRuns(item.id, { limit: 5 }, dbPath).map((run) => ({
    ...run,
    itemTitle: item.title,
    templateId: item.metadata?.templateId ?? null,
    domainId: item.metadata?.domainId ?? null,
    safeMode: item.metadata?.safeMode ?? null
  }))).sort((left, right) => new Date(right.startedAt ?? right.createdAt ?? 0) - new Date(left.startedAt ?? left.createdAt ?? 0)).slice(0, 20);
  const filteredAttentionItems = base.attentionItems.filter((item) => {
    if (filters.group && item.groupId && item.groupId !== filters.group) return false;
    if (filters.template && item.templateId && item.templateId !== filters.template) return false;
    if (filters.domain && item.domainId && item.domainId !== filters.domain) return false;
    return true;
  });
  const urgentWork = filteredAttentionItems.filter((item) => item.queueType === "urgent");
  const followUpWork = filteredAttentionItems.filter((item) => item.queueType !== "urgent");
  return {
    ...base,
    route: {
      self: "/self-build/dashboard"
    },
    filtersApplied: filters,
    overview: {
      ...base.overview,
      filteredWorkItems: workItems.length,
      filteredGroups: groups.length,
      filteredProposals: proposals.length,
      filteredWorkspaces: workspaces.length
    },
    queueSummary: buildQueueSummary(urgentWork, followUpWork),
    attentionSummary: summarizeAttentionItems(filteredAttentionItems),
    urgentWork,
    followUpWork,
    workItems,
    groups,
    proposals,
    workspaces,
    recentWorkItemRuns: recentRuns,
    dashboardSections: {
      overview: true,
      queues: true,
      groupReadiness: true,
      recentRuns: true,
      workspaces: true,
      proposals: true,
      learnings: true
    }
  };
}
