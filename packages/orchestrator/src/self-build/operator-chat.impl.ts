import crypto from "node:crypto";
import { DEFAULT_ORCHESTRATOR_DB_PATH } from "../metadata/constants.js";
import { openOrchestratorDatabase } from "../store/db.js";
import {
  findActiveQuarantineRecord,
  findPendingOperatorThreadAction,
  getOperatorThread,
  getOperatorThreadAction,
  insertOperatorThreadAction,
  insertOperatorThreadMessage,
  listOperatorThreadActions,
  listOperatorThreadMessages,
  listOperatorThreads,
  updateOperatorThreadAction,
  upsertOperatorThread,
} from "../store/execution-store.js";
import type {
  OperatorThreadActionListOptions,
  OperatorThreadListOptions,
} from "../types/contracts.js";
import { getSelfBuildDashboard, getSelfBuildSummary } from "./dashboard.js";
import {
  createGoalPlan,
  editGoalPlan,
  getGoalPlanSummary,
  quarantineSelfBuildTarget,
  releaseSelfBuildQuarantine,
  reviewGoalPlan,
  runGoalPlan,
} from "./goal-plans.js";
import {
  getSelfBuildWorkItem,
  getSelfBuildWorkItemRun,
  rerunSelfBuildWorkItemRun,
  runSelfBuildWorkItem,
} from "./managed-work.js";
import {
  approveProposalArtifact,
  getProposalReviewPackage,
  getProposalSummary,
  invokeProposalPromotion,
  reviewProposalArtifact,
  reworkProposalArtifact,
} from "./proposal-lifecycle.js";
import {
  getWorkItemGroupSummary,
  queueWorkItemGroupValidationBundle,
} from "./work-item-groups.js";

type LooseRecord = Record<string, unknown>;

interface OperatorThreadLinkage extends LooseRecord {
  goalPlanIds?: string[];
  activeGoalPlanId?: string | null;
  activeGroupId?: string | null;
  activeProposalId?: string | null;
  activeWorkItemId?: string | null;
  activeRunId?: string | null;
  integrationBranch?: string | null;
}

interface OperatorThreadExecutionSettings extends LooseRecord {
  projectId?: string;
  safeMode?: boolean;
  mode?: string;
  stub?: boolean;
  launcher?: string | null;
  wait?: boolean;
  timeout?: number;
  interval?: number;
  autoValidate?: boolean;
  autoRun?: boolean;
  autoPromote?: boolean;
}

const OPERATOR_PROGRESS_STAGES = [
  { id: "mission_received", title: "Mission received" },
  { id: "plan_prepared", title: "Plan prepared" },
  { id: "plan_approval", title: "Plan approval" },
  { id: "managed_work", title: "Managed work running" },
  { id: "proposal_review", title: "Proposal review" },
  { id: "proposal_approval", title: "Proposal approval" },
  { id: "validation", title: "Validation" },
  { id: "promotion", title: "Promotion" },
] as const;

const OPERATOR_PHASE_LABELS: Record<string, string> = {
  mission_received: "Mission intake",
  plan_prepared: "Plan preparation",
  plan_approval: "Plan review",
  managed_work: "Managed execution",
  proposal_review: "Proposal review",
  proposal_approval: "Proposal approval",
  validation: "Validation",
  promotion: "Promotion",
};

function withDatabase<T>(
  dbPath: string,
  fn: (db: ReturnType<typeof openOrchestratorDatabase>) => T,
): T {
  const db = openOrchestratorDatabase(dbPath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

function asObject(value: unknown): LooseRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as LooseRecord)
    : {};
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function toText(value: unknown, fallback = ""): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function dedupe(values: unknown[]): string[] {
  return [
    ...new Set(
      values.map((value) => String(value ?? "").trim()).filter(Boolean),
    ),
  ];
}

function containsAny(text: string, candidates: string[]): boolean {
  const normalized = normalizeMessage(text);
  return candidates.some((candidate) => normalized.includes(candidate));
}

function normalizeMessage(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function safeExcerpt(value: string, max = 96): string {
  const text = value.trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}...` : text;
}

function threadLinks(threadId: string) {
  return {
    self: `/operator/threads/${encodeURIComponent(threadId)}`,
    messages: `/operator/threads/${encodeURIComponent(threadId)}/messages`,
    actions: `/operator/actions?threadId=${encodeURIComponent(threadId)}`,
  };
}

function actionLinks(actionId: string) {
  return {
    self: `/operator/actions/${encodeURIComponent(actionId)}`,
    resolve: `/operator/actions/${encodeURIComponent(actionId)}/resolve`,
  };
}

function normalizeExecutionSettings(
  payload: LooseRecord = {},
): OperatorThreadExecutionSettings {
  const timeout =
    Number.parseInt(String(payload.timeout ?? "180000"), 10) || 180000;
  const interval =
    Number.parseInt(String(payload.interval ?? "1500"), 10) || 1500;
  return {
    projectId: toText(payload.projectId ?? payload.project, "spore"),
    safeMode: payload.safeMode !== false,
    mode: toText(payload.mode, "supervised"),
    stub: payload.stub !== false,
    launcher: payload.launcher ? String(payload.launcher) : null,
    wait: payload.wait !== false,
    timeout,
    interval,
    autoValidate: payload.autoValidate !== false,
    autoRun: payload.autoRun !== false,
    autoPromote: payload.autoPromote === true,
  };
}

function extractExecutionSettings(
  thread: LooseRecord | null | undefined,
): OperatorThreadExecutionSettings {
  return normalizeExecutionSettings(
    asObject(asObject(thread?.metadata).execution),
  );
}

function extractLinkage(
  thread: LooseRecord | null | undefined,
): OperatorThreadLinkage {
  const linkage = asObject(asObject(thread?.metadata).linkage);
  return {
    goalPlanIds: dedupe(asArray(linkage.goalPlanIds)),
    activeGoalPlanId: toText(linkage.activeGoalPlanId, "") || null,
    activeGroupId: toText(linkage.activeGroupId, "") || null,
    activeProposalId: toText(linkage.activeProposalId, "") || null,
    activeWorkItemId: toText(linkage.activeWorkItemId, "") || null,
    activeRunId: toText(linkage.activeRunId, "") || null,
    integrationBranch: toText(linkage.integrationBranch, "") || null,
  };
}

function mergeThreadMetadata(
  thread: LooseRecord,
  next: {
    execution?: LooseRecord;
    linkage?: OperatorThreadLinkage;
    mission?: LooseRecord;
    observed?: LooseRecord;
  } = {},
): LooseRecord {
  const metadata = asObject(thread.metadata);
  return {
    ...metadata,
    execution: {
      ...asObject(metadata.execution),
      ...asObject(next.execution),
    },
    linkage: {
      ...extractLinkage(thread),
      ...asObject(next.linkage),
      goalPlanIds: dedupe([
        ...asArray(extractLinkage(thread).goalPlanIds),
        ...asArray(asObject(next.linkage).goalPlanIds),
      ]),
    },
    mission: {
      ...asObject(metadata.mission),
      ...asObject(next.mission),
    },
    observed: {
      ...asObject(metadata.observed),
      ...asObject(next.observed),
    },
  };
}

function artifactRef(
  itemType: string,
  itemId: string | null | undefined,
  title: string,
  status: string | null | undefined,
) {
  if (!itemType || !itemId) {
    return null;
  }
  return {
    itemType,
    itemId,
    title,
    status: status ?? null,
  };
}

function summarizeGoalPlan(plan: LooseRecord | null) {
  if (!plan) {
    return null;
  }
  const recommendations = asArray<LooseRecord>(plan.recommendations);
  const titles = recommendations
    .slice(0, 3)
    .map((entry) =>
      toText(entry.title, entry.id ? String(entry.id) : "recommendation"),
    )
    .filter(Boolean);
  return {
    id: plan.id,
    title: plan.title,
    status: plan.status,
    recommendationCount: recommendations.length,
    previewTitles: titles,
    nextAction: asObject(plan.operatorFlow).nextAction ?? null,
  };
}

function summarizeProposal(proposal: LooseRecord | null) {
  if (!proposal) {
    return null;
  }
  return {
    id: proposal.id,
    title:
      toText(asObject(proposal.summary).title, "") ||
      toText(proposal.title, "") ||
      toText(proposal.id, "proposal"),
    status: proposal.status,
    ready: asObject(proposal.readiness).ready === true,
    blockerCount: asArray(asObject(proposal.readiness).blockers).length,
    validationStatus: asObject(proposal.validation).status ?? null,
  };
}

function summarizeRun(run: LooseRecord | null) {
  if (!run) {
    return null;
  }
  return {
    id: run.id,
    workItemId: run.workItemId ?? null,
    itemTitle: run.itemTitle ?? null,
    status: run.status ?? null,
    terminalKind: run.terminalKind ?? null,
    failure: asObject(run.failure),
    suggestedActions: asArray(run.suggestedActions),
    createdAt: run.createdAt ?? null,
    startedAt: run.startedAt ?? null,
    endedAt: run.endedAt ?? null,
  };
}

function timestampFor(value: unknown) {
  const timestamp = new Date(String(value ?? 0)).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function proposalTimestamp(proposal: LooseRecord | null) {
  return Math.max(
    timestampFor(proposal?.updatedAt),
    timestampFor(proposal?.createdAt),
  );
}

function runTimestamp(run: LooseRecord | null) {
  return Math.max(
    timestampFor(run?.endedAt),
    timestampFor(run?.startedAt),
    timestampFor(run?.updatedAt),
    timestampFor(run?.createdAt),
  );
}

function getProposalIntegrationBranch(proposal: LooseRecord | null) {
  return toText(
    asObject(asObject(asObject(proposal).metadata).promotion).integrationBranch,
    "",
  );
}

function groupPrimaryWorkItemId(group: LooseRecord | null) {
  const items = asArray<LooseRecord>(group?.items);
  return items.length === 1 ? toText(items[0]?.id, "") || null : null;
}

function proposalMatchesThreadLineage(
  proposal: LooseRecord,
  linkage: OperatorThreadLinkage,
  currentProposal: LooseRecord | null,
  dbPath: string,
) {
  const anchorProposalId =
    toText(currentProposal?.id, "") || toText(linkage.activeProposalId, "");
  const anchorWorkItemId =
    toText(currentProposal?.workItemId, "") ||
    toText(linkage.activeWorkItemId, "");
  const anchorRunId =
    toText(currentProposal?.workItemRunId, "") || toText(linkage.activeRunId, "");

  if (!anchorProposalId && !anchorWorkItemId && !anchorRunId) {
    return true;
  }
  if (anchorProposalId && String(proposal.id) === anchorProposalId) {
    return true;
  }
  if (anchorWorkItemId && toText(proposal.workItemId, "") === anchorWorkItemId) {
    return true;
  }
  if (anchorRunId && toText(proposal.workItemRunId, "") === anchorRunId) {
    return true;
  }
  if (anchorRunId && toText(asObject(proposal.metadata).rerunOf, "") === anchorRunId) {
    return true;
  }

  const proposalItem = proposal.workItemId
    ? getSelfBuildWorkItem(String(proposal.workItemId), dbPath)
    : null;
  const itemMetadata = asObject(proposalItem?.metadata);
  return Boolean(
    (anchorProposalId &&
      [
        toText(itemMetadata.reworkOfProposalId, ""),
        toText(itemMetadata.originatingProposalId, ""),
      ].includes(anchorProposalId)) ||
      (anchorWorkItemId &&
        toText(itemMetadata.reworkOfWorkItemId, "") === anchorWorkItemId) ||
      (anchorRunId && toText(itemMetadata.reworkOfRunId, "") === anchorRunId),
  );
}

function listGoalPlanRecommendations(plan: LooseRecord | null) {
  return asArray<LooseRecord>(plan?.recommendations ?? []);
}

function recommendationPreview(plan: LooseRecord | null) {
  return listGoalPlanRecommendations(plan)
    .map(
      (entry) =>
        `[${toText(entry.id, "?")}] ${toText(entry.title, "Work item")}`,
    )
    .join("; ");
}

function detectPlanEditScopes(message: string) {
  const scopes = [];
  if (containsAny(message, ["docs", "doc", "readme", "adr"])) {
    scopes.push("docs");
  }
  if (containsAny(message, ["config", "schema", "schemas"])) {
    scopes.push("config");
  }
  if (containsAny(message, ["web", "ui", "frontend", "dashboard"])) {
    scopes.push("web");
  }
  if (containsAny(message, ["runtime", "backend", "session", "gateway"])) {
    scopes.push("runtime");
  }
  if (containsAny(message, ["cli", "terminal"])) {
    scopes.push("cli");
  }
  return dedupe(scopes);
}

function recommendationMatchesScope(
  recommendation: LooseRecord,
  scope: string,
) {
  const metadata = asObject(recommendation.metadata);
  const domainId = toText(metadata.domainId, "");
  const templateId = toText(metadata.templateId, "");
  const taskClass = toText(metadata.taskClass, "");
  const targetPaths = asArray<string>(metadata.targetPaths).map((entry) =>
    String(entry),
  );
  switch (scope) {
    case "docs":
      return (
        templateId === "docs-maintenance-pass" ||
        taskClass === "documentation" ||
        targetPaths.every(
          (entry) =>
            entry.startsWith("docs") ||
            entry === "README.md" ||
            entry === "runbooks",
        )
      );
    case "config":
      return (
        templateId === "config-schema-maintenance" ||
        taskClass === "config-hardening" ||
        targetPaths.some(
          (entry) => entry.startsWith("config") || entry.startsWith("schemas"),
        )
      );
    case "web":
      return (
        domainId === "frontend" ||
        templateId === "operator-ui-pass" ||
        taskClass === "operator-surface" ||
        targetPaths.some((entry) => entry.startsWith("apps/web"))
      );
    case "runtime":
      return (
        domainId === "backend" ||
        templateId === "runtime-validation-pass" ||
        taskClass === "runtime-validation" ||
        targetPaths.some(
          (entry) =>
            entry.startsWith("packages/runtime-pi") ||
            entry.startsWith("services/session-gateway") ||
            entry.startsWith("services/orchestrator"),
        )
      );
    case "cli":
      return domainId === "cli" || templateId === "general-self-work";
    default:
      return false;
  }
}

function parseRecommendationIdsFromMessage(
  message: string,
  recommendations: LooseRecord[],
) {
  const normalized = normalizeMessage(message);
  const matched = [];
  for (const recommendation of recommendations) {
    const id = toText(recommendation.id, "");
    const title = normalizeMessage(toText(recommendation.title, ""));
    const templateId = normalizeMessage(
      toText(asObject(recommendation.metadata).templateId, ""),
    );
    if (
      id &&
      new RegExp(`\\b${id.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`).test(
        normalized,
      )
    ) {
      matched.push(id);
      continue;
    }
    if (title && normalized.includes(title)) {
      matched.push(id);
      continue;
    }
    if (templateId && normalized.includes(templateId)) {
      matched.push(id);
    }
  }
  return dedupe(matched);
}

function resequenceRecommendations(recommendations: LooseRecord[]) {
  return recommendations.map((recommendation, index, entries) => ({
    ...recommendation,
    groupOrder: index,
    dependsOn:
      index === 0 ? [] : [String(entries[index - 1]?.id ?? "")].filter(Boolean),
  }));
}

function parseGoalPlanEditMessage(plan: LooseRecord | null, message: string) {
  const recommendations = listGoalPlanRecommendations(plan);
  if (recommendations.length === 0) {
    return { detected: false };
  }
  const normalized = normalizeMessage(message);
  const scopes = detectPlanEditScopes(normalized);
  const matchedIds = parseRecommendationIdsFromMessage(
    normalized,
    recommendations,
  );
  const matchedRecommendations = recommendations.filter(
    (entry) =>
      matchedIds.includes(String(entry.id)) ||
      scopes.some((scope) => recommendationMatchesScope(entry, scope)),
  );
  const hasKeep = /\b(keep only|keep|scope to|focus on)\b/.test(normalized);
  const hasDrop = /\b(drop|remove|without|exclude)\b/.test(normalized);
  const hasPrioritize = /\b(prioritize|move first|start with)\b/.test(
    normalized,
  );
  const requestsPlanPreview = containsAny(normalized, [
    "show plan",
    "show recommendations",
    "list recommendations",
    "show options",
    "edit plan",
  ]);

  if (requestsPlanPreview) {
    return {
      detected: true,
      previewOnly: true,
      summary: `Current plan options: ${recommendationPreview(plan)}. You can reply with commands like “keep only docs”, “drop 2”, or “prioritize operator-ui-pass”.`,
    };
  }
  if (hasKeep && matchedRecommendations.length > 0) {
    return {
      detected: true,
      recommendations: resequenceRecommendations(matchedRecommendations),
      summary: `Updated the goal plan to keep ${matchedRecommendations.length} recommendation(s): ${matchedRecommendations.map((entry) => toText(entry.title, String(entry.id))).join("; ")}.`,
    };
  }
  if (hasDrop && matchedRecommendations.length > 0) {
    const remaining = recommendations.filter(
      (entry) =>
        !matchedRecommendations.some((candidate) => candidate.id === entry.id),
    );
    if (remaining.length > 0) {
      return {
        detected: true,
        recommendations: resequenceRecommendations(remaining),
        summary: `Dropped ${matchedRecommendations.length} recommendation(s) from the goal plan. Remaining work: ${remaining.map((entry) => toText(entry.title, String(entry.id))).join("; ")}.`,
      };
    }
  }
  if (hasPrioritize && matchedRecommendations.length > 0) {
    const prioritizedIds = new Set(
      matchedRecommendations.map((entry) => String(entry.id)),
    );
    const reordered = resequenceRecommendations([
      ...matchedRecommendations,
      ...recommendations.filter(
        (entry) => !prioritizedIds.has(String(entry.id)),
      ),
    ]);
    return {
      detected: true,
      recommendations: reordered,
      summary: `Moved ${matchedRecommendations.map((entry) => toText(entry.title, String(entry.id))).join("; ")} to the front of the goal plan.`,
    };
  }
  return { detected: false };
}

async function applyGoalPlanEditMessage(
  threadId: string,
  goalPlan: LooseRecord,
  message: string,
  payload: LooseRecord,
  dbPath: string,
) {
  const parsed = parseGoalPlanEditMessage(goalPlan, message);
  if (!parsed.detected) {
    return null;
  }
  if (parsed.previewOnly) {
    appendThreadMessage(
      threadId,
      "assistant",
      "summary",
      parsed.summary,
      {
        artifacts: [
          artifactRef(
            "goal-plan",
            String(goalPlan.id),
            toText(goalPlan.title, String(goalPlan.id)),
            String(goalPlan.status),
          ),
        ],
      },
      dbPath,
    );
    return getGoalPlanSummary(String(goalPlan.id), dbPath);
  }
  const edited = await editGoalPlan(
    String(goalPlan.id),
    {
      recommendations: parsed.recommendations,
      rationale: message,
      by: payload.by ?? "operator",
      source: payload.source ?? "operator-chat",
    },
    dbPath,
  );
  appendThreadMessage(
    threadId,
    "assistant",
    "summary",
    `${parsed.summary} Updated plan options: ${recommendationPreview(edited)}.`,
    {
      artifacts: [
        artifactRef(
          "goal-plan",
          String(goalPlan.id),
          toText(edited?.title, String(goalPlan.id)),
          toText(edited?.status, "planned"),
        ),
      ],
    },
    dbPath,
  );
  return edited;
}

function buildThreadSummary(
  thread: LooseRecord,
  messages: LooseRecord[],
  pendingActions: LooseRecord[],
  context: LooseRecord,
) {
  const lastMessage = messages.at(-1);
  const goalPlan = asObject(context.goalPlan);
  const group = asObject(context.group);
  const proposal = asObject(context.proposal);
  return {
    objective:
      toText(
        asObject(thread.metadata).mission &&
          asObject(asObject(thread.metadata).mission).objective,
        "",
      ) || toText(thread.title, ""),
    pendingActionCount: pendingActions.length,
    lastMessageRole: lastMessage?.role ?? null,
    lastMessageAt:
      lastMessage?.createdAt ?? thread.latestMessageAt ?? thread.updatedAt,
    lastMessageExcerpt: lastMessage
      ? safeExcerpt(toText(lastMessage.content, ""), 140)
      : null,
    goalPlan: summarizeGoalPlan(goalPlan),
    group: group.id
      ? {
          id: group.id,
          title: group.title,
          status: group.status,
          itemCount: group.itemCount ?? asArray(group.items).length,
        }
      : null,
    proposal: summarizeProposal(proposal),
  };
}

function threadObjective(thread: LooseRecord) {
  return (
    toText(asObject(asObject(thread.metadata).mission).objective, "") ||
    toText(asObject(thread.summary).objective, "") ||
    toText(thread.title, "Mission")
  );
}

function threadDisplayTitle(thread: LooseRecord) {
  const storedTitle = toText(thread.title, "");
  const objective = threadObjective(thread);
  if (storedTitle && storedTitle !== objective) {
    return storedTitle;
  }
  const shortenedObjective = safeExcerpt(objective, 56);
  return shortenedObjective === objective
    ? `Mission: ${objective}`
    : shortenedObjective;
}

function buildThreadEvidenceSummary(context: LooseRecord) {
  const goalPlan = asObject(context.goalPlan);
  const proposal = asObject(context.proposal);
  const latestRun = asObject(context.latestRun);
  const activeQuarantine = asObject(context.activeQuarantine);
  const validation = asObject(proposal.validation);
  const readiness = asObject(proposal.readiness);
  const promotion = asObject(asObject(proposal.metadata).promotion);
  return {
    plan: goalPlan.id
      ? {
          id: goalPlan.id,
          title: toText(goalPlan.title, String(goalPlan.id)),
          status: toText(goalPlan.status, "planned"),
          recommendationCount: asArray(goalPlan.recommendations).length,
          nextAction: asObject(goalPlan.operatorFlow).nextAction ?? null,
        }
      : null,
    latestRun: latestRun.id
      ? {
          id: latestRun.id,
          workItemId: toText(latestRun.workItemId, "") || null,
          status: toText(latestRun.status, "unknown"),
          terminalKind: toText(latestRun.terminalKind, "") || null,
          failureReason:
            toText(asObject(latestRun.failure).reason, "") || null,
        }
      : null,
    proposal: proposal.id
      ? {
          id: proposal.id,
          title:
            toText(asObject(proposal.summary).title, "") ||
            toText(proposal.title, String(proposal.id)),
          status: toText(proposal.status, "unknown"),
          blockerCount: asArray(readiness.blockers).length,
          ready: readiness.ready === true,
        }
      : null,
    validation: proposal.id
      ? {
          id: toText(validation.id, "") || null,
          targetType: toText(validation.targetType, "") || null,
          targetId: toText(validation.targetId, "") || null,
          bundleId: toText(validation.bundleId, "") || null,
          status:
            toText(validation.status, "") ||
            (toText(proposal.status, "") === "validation_required"
              ? "pending"
              : null),
          summary:
            toText(validation.summary, "") ||
            toText(validation.message, "") ||
            null,
          scenarioRunIds: asArray(validation.scenarioRunIds),
          regressionRunIds: asArray(validation.regressionRunIds),
          startedAt: validation.startedAt ?? null,
          endedAt: validation.endedAt ?? null,
          error: validation.error ?? null,
          blockerCount: asArray(validation.blockers).length,
        }
      : null,
    promotion: proposal.id
      ? {
          status:
            toText(promotion.status, "") ||
            toText(proposal.promotionStatus, "") ||
            null,
          integrationBranch:
            toText(promotion.integrationBranch, "") ||
            getProposalIntegrationBranch(proposal) ||
            null,
          ready: ["promotion_ready", "promotion_candidate"].includes(
            toText(proposal.status, ""),
          ),
        }
      : null,
    quarantine: activeQuarantine.id
      ? {
          id: activeQuarantine.id,
          status: toText(activeQuarantine.status, "active"),
          targetType: toText(activeQuarantine.targetType, ""),
          targetId: toText(activeQuarantine.targetId, ""),
          reason: toText(activeQuarantine.reason, "") || null,
          createdAt: activeQuarantine.createdAt ?? null,
        }
      : null,
  };
}

function buildThreadProgress(
  thread: LooseRecord,
  context: LooseRecord,
  pendingActions: LooseRecord[],
  actionHistory: LooseRecord[],
) {
  const goalPlan = asObject(context.goalPlan);
  const group = asObject(context.group);
  const proposal = asObject(context.proposal);
  const latestRun = asObject(context.latestRun);
  const activeQuarantine = asObject(context.activeQuarantine);
  const pendingActionKind = toText(pendingActions[0]?.actionKind, "");
  const proposalStatus = toText(proposal.status, "");
  const goalPlanStatus = toText(goalPlan.status, "");
  const needsRunRecovery = latestRunNeedsRecovery(latestRun, proposal);

  let currentStage = "mission_received";
  if (pendingActionKind === "goal-plan-review") {
    currentStage = "plan_approval";
  } else if (pendingActionKind === "proposal-approval") {
    currentStage = "proposal_approval";
  } else if (pendingActionKind === "managed-run-recovery") {
    currentStage = "managed_work";
  } else if (
    ["proposal-review", "proposal-rework", "quarantine-release"].includes(
      pendingActionKind,
    )
  ) {
    currentStage = "proposal_review";
  } else if (pendingActionKind === "proposal-promotion") {
    currentStage = "promotion";
  } else if (
    ["promotion_ready", "promotion_candidate"].includes(proposalStatus)
  ) {
    currentStage = "promotion";
  } else if (proposalStatus === "validation_required") {
    currentStage = "validation";
  } else if (proposalStatus === "reviewed") {
    currentStage = "proposal_approval";
  } else if (proposal.id) {
    currentStage = "proposal_review";
  } else if (group.id || goalPlanStatus === "materialized") {
    currentStage = "managed_work";
  } else if (goalPlan.id && goalPlanStatus === "planned") {
    currentStage = "plan_approval";
  } else if (goalPlan.id) {
    currentStage = "plan_prepared";
  }

  let stateOverride: string | null = null;
  if (activeQuarantine.id) {
    stateOverride = "quarantined";
  } else if (
    pendingActionKind === "managed-run-recovery" ||
    (needsRunRecovery && ["failed", "blocked"].includes(toText(latestRun.status, "")))
  ) {
    stateOverride = "run_failed";
  } else if (proposalStatus === "validation_failed") {
    stateOverride = "validation_failed";
  } else if (proposalStatus === "promotion_blocked") {
    stateOverride = "promotion_blocked";
  } else if (
    pendingActionKind === "proposal-rework" ||
    ["rejected", "rework_required"].includes(proposalStatus)
  ) {
    stateOverride = "rework";
  } else if (
    String(thread.status) === "completed" ||
    proposalStatus === "promotion_candidate" ||
    goalPlanStatus === "completed"
  ) {
    stateOverride = "completed";
  } else if (
    pendingActions.length === 0 &&
    actionHistory.some((action) => asObject(action.resolution).held === true)
  ) {
    stateOverride = "held";
  }

  const currentIndex = OPERATOR_PROGRESS_STAGES.findIndex(
    (stage) => stage.id === currentStage,
  );
  return {
    stages: OPERATOR_PROGRESS_STAGES.map((stage, index) => ({
      ...stage,
      status:
        stateOverride === "completed"
          ? "complete"
          : index < currentIndex
            ? "complete"
            : index === currentIndex
              ? "current"
              : "upcoming",
    })),
    currentStage,
    currentState: stateOverride ?? currentStage,
    stateOverride,
    exceptionState: stateOverride,
  };
}

function buildDecisionGuidance(
  action: LooseRecord | null,
  thread: LooseRecord,
  progress: LooseRecord,
) {
  const objective = threadObjective(thread);
  const choices = asArray<LooseRecord>(asObject(action?.options).actions)
    .map((entry) => toText(entry.label, toText(entry.value, "")))
    .filter(Boolean);
  const actionKind = toText(action?.actionKind, "");
  switch (actionKind) {
    case "goal-plan-review":
      return {
        title: "Review the mission plan",
        why: `I prepared a plan for ${objective} and I will not start managed work until you confirm it.`,
        nextIfApproved:
          "The orchestrator starts the managed run in the configured mode and returns with proposal evidence for review.",
        riskNote:
          "Approving starts the governed execution path for the scoped recommendations.",
        primaryAction: "Approve the plan",
        secondaryActions: choices.filter((label) => label !== "Approve plan"),
        suggestedReplies: [
          "Keep only docs",
          "Keep only web",
          "Drop 2",
          "Prioritize UI first",
          "Show plan options",
        ],
      };
    case "proposal-review":
      return {
        title: "Review the proposal package",
        why: "Managed work finished and produced a proposal that needs explicit review.",
        nextIfApproved:
          "The proposal moves into approval so validation readiness can continue.",
        riskNote:
          "Reject if the proposal misses scope, quality, or supporting evidence.",
        primaryAction: "Mark the proposal reviewed",
        secondaryActions: choices.filter((label) => label !== "Mark reviewed"),
        suggestedReplies: [],
      };
    case "managed-run-recovery":
      return {
        title: "Recover the latest managed run",
        why: "The latest rerun failed before it produced a replacement proposal, so the thread needs recovery guidance instead of stale proposal review.",
        nextIfApproved:
          "Rerunning starts a fresh managed run for the same work item and refreshes the thread with the new result.",
        riskNote:
          "Quarantine pauses the mission at the group boundary; hold keeps the thread waiting without starting new work.",
        primaryAction: "Rerun the work item",
        secondaryActions: choices.filter((label) => label !== "Rerun work item"),
        suggestedReplies: [],
      };
    case "proposal-approval":
      return {
        title: "Approve the reviewed proposal",
        why: "The proposal already passed review and now needs approval before validation and promotion checks continue.",
        nextIfApproved:
          "Validation runs next, then promotion becomes available if the evidence stays healthy.",
        riskNote:
          "Approval advances the change toward validation and possible promotion.",
        primaryAction: "Approve the proposal",
        secondaryActions: choices.filter(
          (label) => label !== "Approve proposal",
        ),
        suggestedReplies: [],
      };
    case "proposal-rework":
      return {
        title: "Choose how to recover the proposal",
        why: "The proposal is blocked and cannot continue without operator direction.",
        nextIfApproved:
          "Choosing rework creates the follow-up work item and lets the governed flow continue from there.",
        riskNote:
          "Quarantine pauses the mission entirely; hold keeps the thread waiting without changing artifact state.",
        primaryAction: "Create rework",
        secondaryActions: choices.filter((label) => label !== "Create rework"),
        suggestedReplies: [],
      };
    case "quarantine-release":
      return {
        title: "Decide whether to release quarantine",
        why: "A quarantine record is active, so the governed mission cannot continue yet.",
        nextIfApproved:
          "Releasing quarantine returns the underlying artifact to the normal governed flow.",
        riskNote:
          "Keeping quarantine in place preserves the safety stop until you are ready.",
        primaryAction: "Release quarantine",
        secondaryActions: choices.filter(
          (label) => label !== "Release quarantine",
        ),
        suggestedReplies: [],
      };
    case "proposal-promotion":
      return {
        title: "Decide whether to promote the proposal",
        why: "Validation is complete and the proposal is ready for the configured integration target.",
        nextIfApproved:
          "The orchestrator launches promotion to the integration branch and records the promotion result.",
        riskNote:
          "Promotion moves the change toward shared integration, so approve only when the evidence is sufficient.",
        primaryAction: "Promote to integration",
        secondaryActions: choices.filter(
          (label) => label !== "Promote to integration",
        ),
        suggestedReplies: [],
      };
    default:
      if (
        toText(progress.stateOverride, "") === "completed" ||
        toText(progress.exceptionState, "") === "completed"
      ) {
        return {
          title: "Mission complete",
          why: "The mission reached a completed promotion state and no further operator decision is pending.",
          nextIfApproved: "No approval is waiting right now.",
          riskNote: null,
          primaryAction: "Start another mission when ready",
          secondaryActions: [],
          suggestedReplies: [],
        };
      }
      return {
        title: "No operator decision is pending",
        why: "The orchestrator is either still working or waiting on the next governed state transition.",
        nextIfApproved: "No approval is waiting right now.",
        riskNote: null,
        primaryAction: "Ask for status",
        secondaryActions: [],
        suggestedReplies: [],
      };
  }
}

function buildInboxSummary(action: LooseRecord, decisionGuidance: LooseRecord) {
  const urgencyByKind: Record<string, string> = {
    "goal-plan-review": "normal",
    "managed-run-recovery": "high",
    "proposal-review": "high",
    "proposal-approval": "high",
    "proposal-rework": "high",
    "quarantine-release": "high",
    "proposal-promotion": "normal",
  };
  return {
    urgency: urgencyByKind[toText(action.actionKind, "")] ?? "normal",
    reason: toText(
      decisionGuidance.why,
      toText(action.summary, "Operator review is waiting."),
    ),
    waitingLabel:
      toText(action.title, "") ||
      `Waiting for ${toText(action.actionKind, "operator decision")}`,
  };
}

function buildThreadHero(
  thread: LooseRecord,
  progress: LooseRecord,
  pendingActions: LooseRecord[],
) {
  const execution = extractExecutionSettings(thread);
  const currentStage = toText(progress.currentStage, "mission_received");
  const stateOverride =
    toText(progress.stateOverride, "") ||
    toText(progress.exceptionState, "") ||
    null;
  const pendingAction = pendingActions[0] ?? null;

  let statusLine = "I captured your mission and I am preparing the first plan.";
  if (stateOverride === "quarantined") {
    statusLine = "This mission is quarantined until you release it.";
  } else if (stateOverride === "run_failed") {
    statusLine =
      "The latest managed run failed and needs recovery before the mission can continue.";
  } else if (stateOverride === "rework") {
    statusLine = "This mission needs rework before it can continue.";
  } else if (stateOverride === "validation_failed") {
    statusLine =
      "This mission is blocked because the proposal failed validation.";
  } else if (stateOverride === "promotion_blocked") {
    statusLine =
      "This mission is blocked because promotion cannot continue yet.";
  } else if (stateOverride === "held") {
    statusLine = "This mission is on hold until you tell me how to continue.";
  } else if (stateOverride === "completed") {
    statusLine =
      "This mission completed and the promotion flow has already been launched.";
  } else if (currentStage === "plan_approval") {
    statusLine = "I prepared a plan and need your approval before I start.";
  } else if (currentStage === "managed_work") {
    statusLine = "I am running the managed work for this mission now.";
  } else if (currentStage === "proposal_review") {
    statusLine = "I finished the managed run and now need proposal review.";
  } else if (currentStage === "proposal_approval") {
    statusLine = "The proposal has been reviewed and now needs approval.";
  } else if (currentStage === "validation") {
    statusLine = "The proposal is approved and validation is running now.";
  } else if (currentStage === "promotion") {
    statusLine = pendingAction
      ? "Validation passed and the proposal is ready for promotion approval."
      : "Promotion is underway for this mission.";
  }

  return {
    title: threadDisplayTitle(thread),
    statusLine,
    phase: OPERATOR_PHASE_LABELS[currentStage] ?? "Mission",
    primaryCtaHint: toText(
      asObject(asObject(pendingAction?.options).actions).label,
      toText(
        asArray<LooseRecord>(asObject(pendingAction?.options).actions)[0]
          ?.label,
        "",
      ) || null,
    ),
    badges: {
      runtime: execution.stub !== false ? "Stub runtime" : "Live runtime",
      safeMode: execution.safeMode !== false ? "Safe mode on" : "Safe mode off",
      autoValidate:
        execution.autoValidate !== false
          ? "Auto-validate on"
          : "Auto-validate off",
    },
  };
}

function buildPendingActionTrace(
  action: LooseRecord | null,
  context: LooseRecord = {},
  options: { allowStoredTrace?: boolean } = {},
) {
  if (!action) {
    return {
      actionKind: null,
      summary: "No operator action is currently pending.",
      reasons: [],
    };
  }
  const storedTrace = asObject(asObject(action.payload).trace);
  if (
    options.allowStoredTrace === true &&
    storedTrace.scope === "captured-at-action-creation"
  ) {
    return storedTrace;
  }
  const proposal = asObject(context.proposal);
  const goalPlan = asObject(context.goalPlan);
  const latestRun = asObject(context.latestRun);
  const activeQuarantine = asObject(context.activeQuarantine);
  switch (toText(action.actionKind, "")) {
    case "proposal-review":
      return {
        actionKind: action.actionKind,
        summary: `Pending proposal review because proposal ${toText(proposal.id, toText(action.targetId, "unknown"))} is ${toText(proposal.status, "ready_for_review")}.`,
        reasons: dedupe([
          proposal.id ? `Selected proposal ${proposal.id} is the current thread proposal.` : "",
          proposal.status ? `Proposal status is ${proposal.status}.` : "",
        ]),
      };
    case "proposal-approval":
      return {
        actionKind: action.actionKind,
        summary: `Pending proposal approval because proposal ${toText(proposal.id, toText(action.targetId, "unknown"))} already passed review.`,
        reasons: dedupe([
          proposal.status ? `Proposal status is ${proposal.status}.` : "",
        ]),
      };
    case "managed-run-recovery":
      return {
        actionKind: action.actionKind,
        summary: `Pending recovery because run ${toText(latestRun.id, toText(action.targetId, "unknown"))} failed before producing a replacement proposal.`,
        reasons: dedupe([
          latestRun.status ? `Latest run status is ${latestRun.status}.` : "",
          toText(latestRun.failureReason, ""),
        ]),
      };
    case "goal-plan-review":
      return {
        actionKind: action.actionKind,
        summary: `Pending goal-plan review because goal plan ${toText(goalPlan.id, toText(action.targetId, "unknown"))} is ready for operator approval.`,
        reasons: dedupe([
          goalPlan.status ? `Goal plan status is ${goalPlan.status}.` : "",
        ]),
      };
    case "proposal-promotion":
      return {
        actionKind: action.actionKind,
        summary: `Pending promotion decision because proposal ${toText(proposal.id, toText(action.targetId, "unknown"))} is promotion-ready.`,
        reasons: dedupe([
          proposal.status ? `Proposal status is ${proposal.status}.` : "",
        ]),
      };
    case "quarantine-release":
      return {
        actionKind: action.actionKind,
        summary: `Pending quarantine release because quarantine ${toText(activeQuarantine.id, toText(action.targetId, "unknown"))} is active.`,
        reasons: dedupe([
          activeQuarantine.reason ? `Quarantine reason: ${activeQuarantine.reason}` : "",
        ]),
      };
    default:
      return {
        actionKind: action.actionKind,
        summary: toText(action.summary, action.title ? String(action.title) : "Operator action pending."),
        reasons: [],
      };
  }
}

function describePendingAction(
  action: LooseRecord | null,
  thread?: LooseRecord,
  progress?: LooseRecord,
  context: LooseRecord = {},
  traceOptions: { allowStoredTrace?: boolean } = {},
) {
  if (!action) {
    return null;
  }
  const options = asObject(action.options);
  const choices = asArray<LooseRecord>(options.actions).map((entry) => ({
    value: entry.value,
    label: entry.label,
    tone: entry.tone ?? "secondary",
  }));
  const decisionGuidance =
    thread && progress ? buildDecisionGuidance(action, thread, progress) : null;
  return {
    ...action,
    choices,
    trace: buildPendingActionTrace(action, context, traceOptions),
    decisionGuidance,
    threadSummary:
      thread && progress
        ? {
            title: threadDisplayTitle(thread),
            objective: threadObjective(thread),
          }
        : null,
    inboxSummary:
      decisionGuidance && thread && progress
        ? buildInboxSummary(action, decisionGuidance)
        : null,
    links: {
      ...actionLinks(String(action.id)),
      ...asObject(action.links),
    },
  };
}

function updateThreadRecord(
  thread: LooseRecord,
  updates: {
    title?: string;
    status?: string;
    metadata?: LooseRecord;
    summary?: LooseRecord;
    latestMessageAt?: string | null;
    updatedAt?: string;
  },
  dbPath: string,
) {
  const next = {
    ...thread,
    title: updates.title ?? thread.title,
    status: updates.status ?? thread.status,
    metadata: updates.metadata ?? thread.metadata,
    summary: updates.summary ?? thread.summary,
    latestMessageAt:
      updates.latestMessageAt !== undefined
        ? updates.latestMessageAt
        : (thread.latestMessageAt ?? null),
    updatedAt: updates.updatedAt ?? nowIso(),
  };
  return withDatabase(dbPath, (db) => upsertOperatorThread(db, next));
}

function appendThreadMessage(
  threadId: string,
  role: string,
  kind: string,
  content: string,
  payload: LooseRecord = {},
  dbPath: string,
) {
  const createdAt = nowIso();
  withDatabase(dbPath, (db) =>
    insertOperatorThreadMessage(db, {
      id: createId("operator-message"),
      threadId,
      role,
      kind,
      content,
      payload,
      createdAt,
    }),
  );
  const thread = withDatabase(dbPath, (db) => getOperatorThread(db, threadId));
  if (thread) {
    updateThreadRecord(
      thread,
      {
        latestMessageAt: createdAt,
        updatedAt: createdAt,
      },
      dbPath,
    );
  }
  return createdAt;
}

function listPendingThreadActions(threadId: string, dbPath: string) {
  return withDatabase(dbPath, (db) =>
    listOperatorThreadActions(db, {
      threadId,
      status: "pending",
      limit: 50,
    }),
  );
}

function closeAction(
  action: LooseRecord,
  status: string,
  resolution: LooseRecord,
  dbPath: string,
) {
  const updated = {
    ...action,
    status,
    updatedAt: nowIso(),
    resolvedAt: nowIso(),
    resolution,
  };
  withDatabase(dbPath, (db) => updateOperatorThreadAction(db, updated));
  return updated;
}

function createPendingAction(
  threadId: string,
  config: {
    actionKind: string;
    title: string;
    summary: string;
    targetType: string;
    targetId: string;
    payload?: LooseRecord;
    options?: LooseRecord;
    links?: LooseRecord;
    requestedBy?: string;
  },
  dbPath: string,
) {
  const existing = withDatabase(dbPath, (db) =>
    findPendingOperatorThreadAction(
      db,
      threadId,
      config.actionKind,
      config.targetType,
      config.targetId,
    ),
  );
  if (existing) {
    return { action: existing, created: false };
  }
  const requestedAt = nowIso();
  const action = {
    id: createId("operator-action"),
    threadId,
    status: "pending",
    actionKind: config.actionKind,
    title: config.title,
    summary: config.summary,
    targetType: config.targetType,
    targetId: config.targetId,
    payload: {
      ...(config.payload ?? {}),
      trace: {
        ...asObject(asObject(config.payload).trace),
        scope: "captured-at-action-creation",
        actionKind: config.actionKind,
        targetType: config.targetType,
        targetId: config.targetId,
        summary: toText(
          asObject(asObject(config.payload).trace).summary,
          config.summary,
        ),
      },
    },
    options: config.options ?? {},
    links: {
      ...actionLinks(createId("placeholder")),
      ...config.links,
    },
    requestedBy: config.requestedBy ?? "orchestrator",
    requestedAt,
    updatedAt: requestedAt,
    resolvedAt: null,
    resolution: {},
  };
  action.links = {
    ...actionLinks(action.id),
    ...config.links,
  };
  withDatabase(dbPath, (db) => insertOperatorThreadAction(db, action));
  return {
    action: withDatabase(dbPath, (db) =>
      getOperatorThreadAction(db, action.id),
    ),
    created: true,
  };
}

function selectActiveProposal(
  group: LooseRecord | null,
  linkage: OperatorThreadLinkage,
  currentProposal: LooseRecord | null = null,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const proposals = asArray<LooseRecord>(group?.proposals);
  if (proposals.length === 0) {
    return {
      proposal: currentProposal,
      trace: {
        selectedProposalId: toText(currentProposal?.id, "") || null,
        candidateProposalIds: [],
        ignoredProposalIds: [],
        summary: currentProposal
          ? `Kept proposal ${currentProposal.id} because the group has no newer proposal candidates.`
          : "No proposal is currently linked to this thread.",
        reasons: currentProposal
          ? ["The active group does not expose proposal candidates."]
          : ["No proposal candidates were available."],
      },
    };
  }
  const lineageAnchored = proposals.filter((proposal) =>
    proposalMatchesThreadLineage(proposal, linkage, currentProposal, dbPath),
  );
  const hasLineageAnchor = Boolean(
    currentProposal?.id ||
      linkage.activeProposalId ||
      linkage.activeWorkItemId ||
      linkage.activeRunId,
  );
  const candidates =
    lineageAnchored.length > 0
      ? lineageAnchored
      : hasLineageAnchor
        ? []
        : proposals;
  if (candidates.length === 0) {
    return {
      proposal: currentProposal,
      trace: {
        selectedProposalId: toText(currentProposal?.id, "") || null,
        candidateProposalIds: [],
        ignoredProposalIds: dedupe(proposals.map((proposal) => proposal.id)),
        summary: currentProposal
          ? `Kept proposal ${currentProposal.id} because no group proposal matched the thread lineage.`
          : "No proposal matched the thread lineage anchor.",
        reasons: [
          "Thread lineage is anchored to an existing proposal, work item, or run.",
          "Available group proposals were ignored because they did not match that lineage.",
        ],
      },
    };
  }
  const sorted = [...candidates].sort((left, right) => {
    const rightTime = proposalTimestamp(right);
    const leftTime = proposalTimestamp(left);
    if (rightTime !== leftTime) {
      return rightTime - leftTime;
    }
    if (
      linkage.activeProposalId &&
      String(right.id) === String(linkage.activeProposalId)
    ) {
      return 1;
    }
    if (
      linkage.activeProposalId &&
      String(left.id) === String(linkage.activeProposalId)
    ) {
      return -1;
      }
      return 0;
    });
  const proposal = sorted[0] ?? currentProposal;
  const ignoredProposalIds = dedupe(
    proposals
      .filter((entry) => String(entry.id) !== String(proposal?.id ?? ""))
      .map((entry) => entry.id),
  );
  return {
    proposal,
    trace: {
      selectedProposalId: toText(proposal?.id, "") || null,
      candidateProposalIds: dedupe(candidates.map((entry) => entry.id)),
      ignoredProposalIds,
      summary: proposal
        ? `Selected proposal ${proposal.id} for this thread because it best matches the current lineage and recency checks.`
        : "No proposal was selected for this thread.",
      reasons: dedupe([
        hasLineageAnchor
          ? "Applied thread lineage filters before considering proposal recency."
          : "No lineage anchor was present, so group proposals were ranked by recency.",
        lineageAnchored.length > 0 && proposals.length !== lineageAnchored.length
          ? `Ignored ${proposals.length - lineageAnchored.length} unrelated proposal${proposals.length - lineageAnchored.length === 1 ? "" : "s"}.`
          : "",
        proposal ? "Picked the newest remaining proposal candidate." : "",
      ]),
    },
  };
}

function chooseActiveProposal(
  group: LooseRecord | null,
  linkage: OperatorThreadLinkage,
  currentProposal: LooseRecord | null = null,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  return selectActiveProposal(group, linkage, currentProposal, dbPath).proposal;
}

function resolveLatestThreadRun(
  group: LooseRecord | null,
  linkage: OperatorThreadLinkage,
  proposal: LooseRecord | null,
  dbPath: string,
) {
  const candidateWorkItemIds = dedupe([
    linkage.activeWorkItemId,
    proposal?.workItemId ? String(proposal.workItemId) : null,
    groupPrimaryWorkItemId(group),
  ]);
  const runs = candidateWorkItemIds
    .map((itemId) => getSelfBuildWorkItem(itemId, dbPath))
    .map((item) => asObject(item.runHistory).latestRun)
    .filter(Boolean)
    .map((run) => getSelfBuildWorkItemRun(String(asObject(run).id), dbPath))
    .filter(Boolean);

  if (linkage.activeRunId) {
    const exact = getSelfBuildWorkItemRun(linkage.activeRunId, dbPath);
    if (exact) {
      runs.push(exact);
    }
  }

  const sorted = runs.sort((left, right) => runTimestamp(right) - runTimestamp(left));
  return sorted[0] ?? null;
}

function latestRunNeedsRecovery(
  latestRun: LooseRecord | null,
  proposal: LooseRecord | null,
) {
  if (!latestRun) {
    return false;
  }
  if (!["failed", "blocked"].includes(toText(latestRun.status, ""))) {
    return false;
  }
  const latestRunProposalId =
    toText(asObject(latestRun.proposal).id, "") ||
    toText(asObject(latestRun.metadata).proposalArtifactId, "");
  if (latestRunProposalId) {
    return false;
  }
  return !proposal || runTimestamp(latestRun) >= proposalTimestamp(proposal);
}

function summarizeThreadContext(
  thread: LooseRecord,
  goalPlan: LooseRecord | null,
  group: LooseRecord | null,
  proposal: LooseRecord | null,
  latestRun: LooseRecord | null,
) {
  const dashboard = getSelfBuildDashboard();
  return {
    mission: asObject(thread.metadata).mission ?? {},
    goalPlan,
    group,
    proposal,
    latestRun: summarizeRun(latestRun),
    linkedArtifacts: [
      artifactRef(
        "goal-plan",
        goalPlan?.id ? String(goalPlan.id) : null,
        toText(
          goalPlan?.title,
          goalPlan?.id ? String(goalPlan.id) : "Goal plan",
        ),
        goalPlan?.status ? String(goalPlan.status) : null,
      ),
      artifactRef(
        "work-item-group",
        group?.id ? String(group.id) : null,
        toText(
          group?.title,
          group?.id ? String(group.id) : "Managed work group",
        ),
        group?.status ? String(group.status) : null,
      ),
      artifactRef(
        "work-item-run",
        latestRun?.id ? String(latestRun.id) : null,
        toText(
          latestRun?.itemTitle,
          latestRun?.id ? String(latestRun.id) : "Latest run",
        ),
        latestRun?.status ? String(latestRun.status) : null,
      ),
      artifactRef(
        "proposal",
        proposal?.id ? String(proposal.id) : null,
        toText(
          asObject(proposal?.summary).title,
          proposal?.id ? String(proposal.id) : "Proposal",
        ),
        proposal?.status ? String(proposal.status) : null,
      ),
      artifactRef(
        "integration-branch",
        toText(
          asObject(asObject(proposal?.metadata).promotion).integrationBranch,
          "",
        ) || null,
        toText(
          asObject(asObject(proposal?.metadata).promotion).integrationBranch,
          "Integration branch",
        ),
        toText(asObject(asObject(proposal?.metadata).promotion).status, "") ||
          null,
      ),
    ].filter(Boolean),
    globalSummary: {
      counts: asObject(getSelfBuildSummary().counts),
      attentionSummary: asObject(dashboard.attentionSummary),
      lifecycle: asObject(dashboard.lifecycle),
      queueSummary: asObject(dashboard.queueSummary),
    },
  };
}

function inferThreadStatus(
  goalPlan: LooseRecord | null,
  group: LooseRecord | null,
  proposal: LooseRecord | null,
  pendingActions: LooseRecord[],
) {
  if (pendingActions.length > 0) {
    return "waiting_operator";
  }
  if (
    ["failed", "blocked", "quarantined"].includes(String(group?.status ?? ""))
  ) {
    return "blocked";
  }
  if (
    ["rejected", "rework_required"].includes(String(proposal?.status ?? ""))
  ) {
    return "blocked";
  }
  if (
    String(proposal?.status ?? "") === "promotion_candidate" ||
    String(goalPlan?.status ?? "") === "completed"
  ) {
    return "completed";
  }
  if (goalPlan || group || proposal) {
    return "running";
  }
  return "active";
}

function buildPendingActionMessage(action: LooseRecord) {
  const choices = asArray<LooseRecord>(asObject(action.options).actions);
  const labels = choices
    .map((entry) => String(entry.label ?? entry.value ?? ""))
    .filter(Boolean);
  const suffix = labels.length > 0 ? ` Options: ${labels.join(" / ")}.` : "";
  return `${toText(action.summary, action.title ? String(action.title) : "Operator decision required")}${suffix}`;
}

function matchPendingActionChoice(message: string, action: LooseRecord | null) {
  if (!action) {
    return null;
  }
  const normalized = normalizeMessage(message);
  const actions = asArray<LooseRecord>(asObject(action.options).actions);
  if (actions.length === 0) {
    return null;
  }
  const matches = new Map<string, string[]>([
    [
      "approve",
      [
        "approve",
        "approved",
        "accept",
        "accepted",
        "yes",
        "tak",
        "ok",
        "continue",
        "go ahead",
        "run it",
      ],
    ],
    ["reviewed", ["review", "reviewed", "approve", "accept", "yes", "tak"]],
    ["reject", ["reject", "rejected", "no", "nie", "cancel", "stop"]],
    ["rejected", ["reject", "rejected", "no", "nie", "cancel", "stop"]],
    ["edit", ["edit", "adjust", "change plan", "revise plan"]],
    ["rework", ["rework", "fix it", "repair", "redo"]],
    ["rerun", ["rerun", "retry", "run again", "try again"]],
    ["quarantine", ["quarantine", "freeze", "isolate"]],
    ["release", ["release", "unquarantine", "resume"]],
    ["promote", ["promote", "promotion", "integrate", "ship", "yes", "tak"]],
    ["hold", ["hold", "wait", "later", "pause", "not now"]],
  ]);
  for (const entry of actions) {
    const value = toText(entry.value, "");
    const aliases = matches.get(value) ?? [value];
    if (aliases.some((alias) => normalized.includes(alias))) {
      return value;
    }
  }
  return null;
}

async function supersedeObsoleteActions(
  threadId: string,
  goalPlan: LooseRecord | null,
  proposal: LooseRecord | null,
  latestRun: LooseRecord | null,
  activeQuarantine: LooseRecord | null,
  dbPath: string,
) {
  const pending = listPendingThreadActions(threadId, dbPath);
  const needsRunRecovery = latestRunNeedsRecovery(latestRun, proposal);
  for (const action of pending) {
    const stillRelevant =
      (action.actionKind === "goal-plan-review" &&
        action.targetId === goalPlan?.id &&
        String(goalPlan?.status ?? "") === "planned") ||
      (action.actionKind === "proposal-review" &&
        !needsRunRecovery &&
        action.targetId === proposal?.id &&
        ["draft", "ready_for_review"].includes(
          String(proposal?.status ?? ""),
        )) ||
      (action.actionKind === "proposal-approval" &&
        !needsRunRecovery &&
        action.targetId === proposal?.id &&
        String(proposal?.status ?? "") === "reviewed") ||
      (action.actionKind === "proposal-promotion" &&
        !needsRunRecovery &&
        action.targetId === proposal?.id &&
        String(proposal?.status ?? "") === "promotion_ready") ||
      (action.actionKind === "proposal-rework" &&
        !needsRunRecovery &&
        action.targetId === proposal?.id &&
        [
          "rejected",
          "rework_required",
          "validation_failed",
          "promotion_blocked",
        ].includes(String(proposal?.status ?? ""))) ||
      (action.actionKind === "managed-run-recovery" &&
        needsRunRecovery &&
        action.targetId === latestRun?.id &&
        ["failed", "blocked"].includes(String(latestRun?.status ?? ""))) ||
      (action.actionKind === "quarantine-release" &&
        action.targetId === activeQuarantine?.id &&
        String(activeQuarantine?.status ?? "") === "active");
    if (!stillRelevant) {
      closeAction(
        action,
        "superseded",
        {
          status: "superseded",
          reason: "Target state changed before the operator responded.",
        },
        dbPath,
      );
    }
  }
}

function findThreadQuarantine(
  goalPlan: LooseRecord | null,
  group: LooseRecord | null,
  proposal: LooseRecord | null,
  integrationBranch: string | null,
  dbPath: string,
) {
  const targets = [
    goalPlan?.id ? ["goal-plan", String(goalPlan.id)] : null,
    group?.id ? ["work-item-group", String(group.id)] : null,
    proposal?.id ? ["proposal", String(proposal.id)] : null,
    integrationBranch ? ["integration-branch", integrationBranch] : null,
  ].filter(Boolean) as Array<[string, string]>;
  for (const [targetType, targetId] of targets) {
    const record = withDatabase(dbPath, (db) =>
      findActiveQuarantineRecord(db, targetType, targetId),
    );
    if (record) {
      return record;
    }
  }
  return null;
}

function executionRunOptions(thread: LooseRecord, overrides: LooseRecord = {}) {
  const execution = extractExecutionSettings(thread);
  return {
    project: execution.projectId ?? "spore",
    safeMode: execution.safeMode !== false,
    wait: execution.wait !== false,
    timeout: String(overrides.timeout ?? execution.timeout ?? 180000),
    interval: String(overrides.interval ?? execution.interval ?? 1500),
    stub:
      overrides.stub !== undefined
        ? overrides.stub === true
        : execution.stub !== false,
    launcher:
      overrides.launcher !== undefined
        ? overrides.launcher
        : execution.launcher,
    by: overrides.by ?? "operator-chat",
    source: overrides.source ?? "operator-chat",
  };
}

function buildStatusReply(
  thread: LooseRecord,
  goalPlan: LooseRecord | null,
  group: LooseRecord | null,
  proposal: LooseRecord | null,
  pendingActions: LooseRecord[],
) {
  const lines = [`Thread status: ${thread.status}.`];
  if (goalPlan) {
    lines.push(`Goal plan ${goalPlan.id} is ${goalPlan.status}.`);
  }
  if (group) {
    lines.push(`Managed work group ${group.id} is ${group.status}.`);
  }
  if (proposal) {
    lines.push(`Proposal ${proposal.id} is ${proposal.status}.`);
  }
  if (pendingActions[0]) {
    lines.push(
      `Waiting for operator decision: ${toText(pendingActions[0].title, String(pendingActions[0].actionKind ?? "action"))}.`,
    );
  }
  if (!goalPlan && !group && !proposal && pendingActions.length === 0) {
    lines.push(
      "No managed self-build artifacts are linked to this thread yet.",
    );
  }
  return lines.join(" ");
}

function messageRequestsStatus(message: string) {
  return containsAny(message, [
    "status",
    "summary",
    "state",
    "where are we",
    "what next",
    "co dalej",
    "stan",
    "podsum",
  ]);
}

function messageRequestsHelp(message: string) {
  return containsAny(message, [
    "help",
    "what can you do",
    "pomoc",
    "commands",
    "capabilities",
  ]);
}

function requestThreadAction(
  threadId: string,
  config: {
    actionKind: string;
    title: string;
    summary: string;
    targetType: string;
    targetId: string;
    payload?: LooseRecord;
    options?: LooseRecord;
  },
  messagePayload: LooseRecord,
  dbPath: string,
) {
  const created = createPendingAction(threadId, config, dbPath);
  if (created.created && created.action) {
    appendThreadMessage(
      threadId,
      "assistant",
      "action-request",
      buildPendingActionMessage(created.action),
      {
        pendingActionId: created.action.id,
        ...messagePayload,
      },
      dbPath,
    );
  }
  return listPendingThreadActions(threadId, dbPath);
}

function requestQuarantineReleaseAction(
  threadId: string,
  activeQuarantine: LooseRecord,
  dbPath: string,
) {
  return requestThreadAction(
    threadId,
    {
      actionKind: "quarantine-release",
      title: "Release quarantine",
      summary: `Quarantine ${activeQuarantine.id} is active for ${activeQuarantine.targetType} ${activeQuarantine.targetId}. Decide whether to keep it in place or release it back into the governed flow.`,
      targetType: "quarantine",
      targetId: String(activeQuarantine.id),
      payload: {
        itemType: activeQuarantine.targetType,
        itemId: activeQuarantine.targetId,
        quarantineId: activeQuarantine.id,
      },
      options: {
        actions: [
          {
            value: "release",
            label: "Release quarantine",
            tone: "primary",
          },
          { value: "hold", label: "Keep quarantined", tone: "secondary" },
        ],
      },
    },
    {},
    dbPath,
  );
}

function requestGoalPlanReviewAction(
  threadId: string,
  goalPlan: LooseRecord,
  dbPath: string,
) {
  return requestThreadAction(
    threadId,
    {
      actionKind: "goal-plan-review",
      title: "Review goal plan",
      summary: `Goal plan ${goalPlan.id} is ready for operator review. Plan options: ${recommendationPreview(goalPlan)}. Reply with approve, reject, or edit. You can also say “keep only docs”, “drop 2”, or “prioritize operator-ui-pass”.`,
      targetType: "goal-plan",
      targetId: String(goalPlan.id),
      payload: {
        itemType: "goal-plan",
        itemId: goalPlan.id,
      },
      options: {
        actions: [
          { value: "approve", label: "Approve plan", tone: "primary" },
          { value: "edit", label: "Edit in chat", tone: "secondary" },
          { value: "reject", label: "Reject plan", tone: "secondary" },
        ],
      },
    },
    {
      artifacts: [
        artifactRef(
          "goal-plan",
          String(goalPlan.id),
          toText(goalPlan.title, String(goalPlan.id)),
          String(goalPlan.status),
        ),
      ],
    },
    dbPath,
  );
}

function requestProposalReviewAction(
  threadId: string,
  proposal: LooseRecord,
  dbPath: string,
) {
  return requestThreadAction(
    threadId,
    {
      actionKind: "proposal-review",
      title: "Review proposal",
      summary: `Proposal ${proposal.id} needs review before approval and validation.`,
      targetType: "proposal",
      targetId: String(proposal.id),
      payload: {
        itemType: "proposal",
        itemId: proposal.id,
      },
      options: {
        actions: [
          { value: "reviewed", label: "Mark reviewed", tone: "primary" },
          { value: "rejected", label: "Reject proposal", tone: "secondary" },
        ],
      },
    },
    {
      artifacts: [
        artifactRef(
          "proposal",
          String(proposal.id),
          toText(asObject(proposal.summary).title, String(proposal.id)),
          String(proposal.status),
        ),
      ],
    },
    dbPath,
  );
}

function requestProposalApprovalAction(
  threadId: string,
  proposal: LooseRecord,
  dbPath: string,
) {
  return requestThreadAction(
    threadId,
    {
      actionKind: "proposal-approval",
      title: "Approve proposal",
      summary: `Proposal ${proposal.id} has been reviewed and now needs approval before validation and promotion checks.`,
      targetType: "proposal",
      targetId: String(proposal.id),
      payload: {
        itemType: "proposal",
        itemId: proposal.id,
      },
      options: {
        actions: [
          { value: "approve", label: "Approve proposal", tone: "primary" },
          { value: "reject", label: "Reject proposal", tone: "secondary" },
        ],
      },
    },
    {
      artifacts: [
        artifactRef(
          "proposal",
          String(proposal.id),
          toText(asObject(proposal.summary).title, String(proposal.id)),
          String(proposal.status),
        ),
      ],
    },
    dbPath,
  );
}

function requestProposalReworkAction(
  threadId: string,
  proposal: LooseRecord,
  dbPath: string,
) {
  return requestThreadAction(
    threadId,
    {
      actionKind: "proposal-rework",
      title: "Rework or quarantine proposal",
      summary: `Proposal ${proposal.id} is ${proposal.status}. Decide whether to create rework, quarantine the target, or hold the conversation here.`,
      targetType: "proposal",
      targetId: String(proposal.id),
      payload: {
        itemType: "proposal",
        itemId: proposal.id,
      },
      options: {
        actions: [
          { value: "rework", label: "Create rework", tone: "primary" },
          { value: "quarantine", label: "Quarantine", tone: "secondary" },
          { value: "hold", label: "Hold", tone: "secondary" },
        ],
      },
    },
    {
      artifacts: [
        artifactRef(
          "proposal",
          String(proposal.id),
          toText(asObject(proposal.summary).title, String(proposal.id)),
          String(proposal.status),
        ),
      ],
    },
    dbPath,
  );
}

function requestManagedRunRecoveryAction(
  threadId: string,
  latestRun: LooseRecord,
  group: LooseRecord | null,
  dbPath: string,
) {
  const recoveryTargetId = group?.id ? String(group.id) : null;
  return requestThreadAction(
    threadId,
    {
      actionKind: "managed-run-recovery",
      title: "Recover latest managed run",
      summary: `Run ${latestRun.id} failed before it produced a replacement proposal. Decide whether to rerun the work item, quarantine the group, or hold the thread here.`,
      targetType: "work-item-run",
      targetId: String(latestRun.id),
      payload: {
        itemType: "work-item-run",
        itemId: latestRun.id ?? null,
        workItemId: latestRun.workItemId ?? null,
        quarantineTargetType: "work-item-group",
        quarantineTargetId: recoveryTargetId,
        failure: asObject(latestRun.failure),
      },
      options: {
        actions: [
          { value: "rerun", label: "Rerun work item", tone: "primary" },
          { value: "quarantine", label: "Quarantine group", tone: "secondary" },
          { value: "hold", label: "Hold", tone: "secondary" },
        ],
      },
    },
    {
      artifacts: [
        artifactRef(
          "work-item-run",
          String(latestRun.id),
          toText(latestRun.itemTitle, String(latestRun.id)),
          toText(latestRun.status, "failed"),
        ),
      ],
    },
    dbPath,
  );
}

function requestProposalPromotionAction(
  threadId: string,
  proposal: LooseRecord,
  reviewPackage: LooseRecord,
  dbPath: string,
) {
  return requestThreadAction(
    threadId,
    {
      actionKind: "proposal-promotion",
      title: "Promote proposal",
      summary: `Proposal ${proposal.id} is promotion-ready. Decide whether the orchestrator should promote it to the configured integration branch.`,
      targetType: "proposal",
      targetId: String(proposal.id),
      payload: {
        itemType: "proposal",
        itemId: proposal.id,
        reviewPackage,
      },
      options: {
        actions: [
          {
            value: "promote",
            label: "Promote to integration",
            tone: "primary",
          },
          { value: "hold", label: "Hold here", tone: "secondary" },
        ],
      },
    },
    {
      artifacts: [
        artifactRef(
          "proposal",
          String(proposal.id),
          toText(asObject(proposal.summary).title, String(proposal.id)),
          String(proposal.status),
        ),
      ],
    },
    dbPath,
  );
}

async function syncThreadState(threadId: string, dbPath: string) {
  let thread = withDatabase(dbPath, (db) => getOperatorThread(db, threadId));
  if (!thread) {
    return null;
  }

  const linkage = extractLinkage(thread);
  let goalPlan = linkage.activeGoalPlanId
    ? getGoalPlanSummary(linkage.activeGoalPlanId, dbPath)
    : null;
  if (!goalPlan && asArray(linkage.goalPlanIds).length > 0) {
    const latestGoalPlanId = asArray<string>(linkage.goalPlanIds).at(-1);
    goalPlan = latestGoalPlanId
      ? getGoalPlanSummary(latestGoalPlanId, dbPath)
      : null;
  }
  let group = linkage.activeGroupId
    ? getWorkItemGroupSummary(linkage.activeGroupId, dbPath)
    : null;
  if (!group && goalPlan?.materializedGroup?.id) {
    group = getWorkItemGroupSummary(
      String(goalPlan.materializedGroup.id),
      dbPath,
    );
  }
  let proposal = linkage.activeProposalId
    ? getProposalSummary(linkage.activeProposalId, dbPath)
    : null;
  let proposalSelection = selectActiveProposal(group, linkage, proposal, dbPath);
  proposal = proposalSelection.proposal;
  let latestRun = resolveLatestThreadRun(group, linkage, proposal, dbPath);

  let integrationBranch =
    getProposalIntegrationBranch(proposal) || linkage.integrationBranch || null;
  let activeQuarantine = findThreadQuarantine(
    goalPlan,
    group,
    proposal,
    integrationBranch,
    dbPath,
  );

  await supersedeObsoleteActions(
    threadId,
    goalPlan,
    proposal,
    latestRun,
    activeQuarantine,
    dbPath,
  );

  let pendingActions = listPendingThreadActions(threadId, dbPath);
  if (pendingActions.length === 0) {
    if (activeQuarantine) {
      pendingActions = requestQuarantineReleaseAction(
        threadId,
        activeQuarantine,
        dbPath,
      );
    } else if (goalPlan && String(goalPlan.status) === "planned") {
      pendingActions = requestGoalPlanReviewAction(threadId, goalPlan, dbPath);
    } else if (
      goalPlan &&
      ["reviewed", "materialized"].includes(String(goalPlan.status)) &&
      extractExecutionSettings(thread).autoRun !== false
    ) {
      appendThreadMessage(
        threadId,
        "assistant",
        "event",
        `Goal plan ${goalPlan.id} is approved. I am materializing and running managed work now.`,
        {
          artifacts: [
            artifactRef(
              "goal-plan",
              String(goalPlan.id),
              toText(goalPlan.title, String(goalPlan.id)),
              String(goalPlan.status),
            ),
          ],
        },
        dbPath,
      );
      await runGoalPlan(
        String(goalPlan.id),
        {
          ...executionRunOptions(thread),
          autoValidate: extractExecutionSettings(thread).autoValidate !== false,
        },
        dbPath,
      );
      goalPlan = getGoalPlanSummary(String(goalPlan.id), dbPath);
      group = goalPlan?.materializedGroup?.id
        ? getWorkItemGroupSummary(String(goalPlan.materializedGroup.id), dbPath)
        : group;
      proposalSelection = selectActiveProposal(
        group,
        extractLinkage(thread),
        proposal,
        dbPath,
      );
      proposal = proposalSelection.proposal;
      latestRun = resolveLatestThreadRun(group, extractLinkage(thread), proposal, dbPath);
    } else if (
      latestRunNeedsRecovery(latestRun, proposal)
    ) {
      pendingActions = requestManagedRunRecoveryAction(
        threadId,
        latestRun,
        group,
        dbPath,
      );
    } else if (
      proposal &&
      ["draft", "ready_for_review"].includes(String(proposal.status))
    ) {
      pendingActions = requestProposalReviewAction(threadId, proposal, dbPath);
    } else if (proposal && String(proposal.status) === "reviewed") {
      pendingActions = requestProposalApprovalAction(threadId, proposal, dbPath);
    } else if (
      proposal &&
      [
        "rejected",
        "rework_required",
        "validation_failed",
        "promotion_blocked",
      ].includes(String(proposal.status))
    ) {
      pendingActions = requestProposalReworkAction(threadId, proposal, dbPath);
    } else if (
      proposal &&
      String(proposal.status) === "validation_required" &&
      extractExecutionSettings(thread).autoValidate !== false
    ) {
      appendThreadMessage(
        threadId,
        "assistant",
        "event",
        `Proposal ${proposal.id} needs validation. I am running the configured validation flow now.`,
        {
          artifacts: [
            artifactRef(
              "proposal",
              String(proposal.id),
              toText(asObject(proposal.summary).title, String(proposal.id)),
              String(proposal.status),
            ),
          ],
        },
        dbPath,
      );
      if (group?.id) {
        await queueWorkItemGroupValidationBundle(
          String(group.id),
          executionRunOptions(thread, {
            source: "operator-chat-validation",
            wait: false,
          }),
          dbPath,
        );
      }
      group = group?.id
        ? getWorkItemGroupSummary(String(group.id), dbPath)
        : group;
      proposalSelection = selectActiveProposal(
        group,
        extractLinkage(thread),
        proposal,
        dbPath,
      );
      proposal = proposalSelection.proposal;
      latestRun = resolveLatestThreadRun(group, extractLinkage(thread), proposal, dbPath);
      integrationBranch =
        getProposalIntegrationBranch(proposal) ||
        linkage.integrationBranch ||
        null;
      activeQuarantine = findThreadQuarantine(
        goalPlan,
        group,
        proposal,
        integrationBranch,
        dbPath,
      );
    } else if (proposal && String(proposal.status) === "promotion_ready") {
      const reviewPackage = getProposalReviewPackage(
        String(proposal.id),
        dbPath,
      );
      pendingActions = requestProposalPromotionAction(
        threadId,
        proposal,
        reviewPackage,
        dbPath,
      );
    }
  }

  thread = withDatabase(dbPath, (db) => getOperatorThread(db, threadId));
  const nextLinkage = {
    ...extractLinkage(thread),
    activeGoalPlanId: goalPlan?.id ? String(goalPlan.id) : null,
    activeGroupId: group?.id
      ? String(group.id)
      : goalPlan?.materializedGroup?.id
        ? String(goalPlan.materializedGroup.id)
        : null,
    activeProposalId: proposal?.id ? String(proposal.id) : null,
    activeWorkItemId:
      toText(proposal?.workItemId, "") ||
      toText(latestRun?.workItemId, "") ||
      groupPrimaryWorkItemId(group) ||
      extractLinkage(thread).activeWorkItemId ||
      null,
    activeRunId:
      toText(latestRun?.id, "") ||
      toText(proposal?.workItemRunId, "") ||
      extractLinkage(thread).activeRunId ||
      null,
    integrationBranch:
      getProposalIntegrationBranch(proposal) ||
      extractLinkage(thread).integrationBranch ||
      null,
  };
  const messages = withDatabase(dbPath, (db) =>
    listOperatorThreadMessages(db, threadId, 200),
  );
  activeQuarantine = findThreadQuarantine(
    goalPlan,
    group,
    proposal,
    nextLinkage.integrationBranch,
    dbPath,
  );
  const context = {
    ...summarizeThreadContext(thread, goalPlan, group, proposal, latestRun),
    activeQuarantine,
  };
  const actionHistory = withDatabase(dbPath, (db) =>
    listOperatorThreadActions(db, {
      threadId,
      limit: 100,
    }),
  );
  const progress = buildThreadProgress(
    thread,
    context,
    pendingActions,
    actionHistory,
  );
  const hero = buildThreadHero(thread, progress, pendingActions);
  const evidenceSummary = buildThreadEvidenceSummary(context);
  const projectedPendingActions = pendingActions
    .map((action) =>
      describePendingAction(action, thread, progress, context, {
        allowStoredTrace: false,
      })
    )
    .filter(Boolean);
  const projectedActionHistory = actionHistory
    .map((action) =>
      describePendingAction(action, thread, progress, context, {
        allowStoredTrace: true,
      })
    )
    .filter(Boolean);
  const summary = buildThreadSummary(thread, messages, pendingActions, context);
  const status = inferThreadStatus(goalPlan, group, proposal, pendingActions);
  const updated = updateThreadRecord(
    thread,
    {
      status,
      metadata: mergeThreadMetadata(thread, {
        linkage: nextLinkage,
      }),
      summary,
      latestMessageAt:
        messages.at(-1)?.createdAt ?? thread.latestMessageAt ?? null,
    },
    dbPath,
  );
  return {
    ...updated,
    messages,
    hero,
    progress,
    evidenceSummary,
    decisionGuidance:
      asObject(projectedPendingActions[0]).decisionGuidance ??
      buildDecisionGuidance(null, thread, progress),
    inboxSummary: asObject(projectedPendingActions[0]).inboxSummary ?? {
      urgency: progress.currentState === "completed" ? "normal" : "low",
      reason: toText(
        asObject(asObject(projectedPendingActions[0]).decisionGuidance ?? {})
          .why,
        "No operator decision is pending.",
      ),
      waitingLabel:
        progress.currentState === "completed"
          ? "Mission completed"
          : "No pending operator action",
    },
    pendingActions: projectedPendingActions,
    actionHistory: projectedActionHistory,
    context,
    trace: {
      proposalSelection: proposalSelection.trace,
      pendingAction:
        asObject(projectedPendingActions[0]).trace ??
        buildPendingActionTrace(projectedPendingActions[0] ?? null, context),
    },
    links: threadLinks(threadId),
  };
}

async function createGoalPlanFromMessage(
  thread: LooseRecord,
  content: string,
  payload: LooseRecord,
  dbPath: string,
) {
  const execution = extractExecutionSettings(thread);
  const plan = await createGoalPlan(
    {
      goal: content,
      title: payload.title ?? safeExcerpt(content, 80),
      projectId: execution.projectId ?? "spore",
      mode: execution.mode ?? "supervised",
      safeMode: execution.safeMode !== false,
      by: payload.by ?? "operator",
      source: payload.source ?? "operator-chat",
      reviewRequired: payload.reviewRequired !== false,
    },
    dbPath,
  );
  const recommendationCount = asArray(plan?.recommendations).length;
  const previewTitles = asArray<LooseRecord>(plan?.recommendations)
    .slice(0, 3)
    .map(
      (entry) =>
        `[${toText(entry.id, "?")}] ${toText(entry.title, "recommended work")}`,
    )
    .filter(Boolean);
  const preview =
    previewTitles.length > 0
      ? ` Suggested work: ${previewTitles.join("; ")}.`
      : "";
  appendThreadMessage(
    String(thread.id),
    "assistant",
    "summary",
    `I created goal plan ${plan?.id} with ${recommendationCount} recommended work item(s).${preview}`,
    {
      artifacts: [
        artifactRef(
          "goal-plan",
          plan?.id ? String(plan.id) : null,
          toText(plan?.title, plan?.id ? String(plan.id) : "Goal plan"),
          plan?.status ? String(plan.status) : null,
        ),
      ],
    },
    dbPath,
  );
  updateThreadRecord(
    thread,
    {
      metadata: mergeThreadMetadata(thread, {
        mission: {
          objective: content,
          lastOperatorRequest: content,
        },
        linkage: {
          goalPlanIds: dedupe([
            ...asArray(extractLinkage(thread).goalPlanIds),
            plan?.id ? String(plan.id) : null,
          ]),
          activeGoalPlanId: plan?.id ? String(plan.id) : null,
          activeGroupId: null,
          activeProposalId: null,
          activeWorkItemId: null,
          activeRunId: null,
        },
      }),
    },
    dbPath,
  );
}

async function replyWithStatus(thread: LooseRecord, dbPath: string) {
  const detail = await syncThreadState(String(thread.id), dbPath);
  appendThreadMessage(
    String(thread.id),
    "assistant",
    "summary",
    buildStatusReply(
      detail,
      asObject(detail.context).goalPlan as LooseRecord | null,
      asObject(detail.context).group as LooseRecord | null,
      asObject(detail.context).proposal as LooseRecord | null,
      asArray(detail.pendingActions),
    ),
    {
      context: detail.context,
    },
    dbPath,
  );
  return syncThreadState(String(thread.id), dbPath);
}

function helpReply() {
  return [
    "Tell me what you want SPORE to do and I will turn that into a governed self-build flow.",
    "I can create a goal plan, edit that plan in chat, stop for review and approval, run managed work, trigger validation, request rework or quarantine, release quarantines, and ask before promotion.",
    "You can answer directly in chat with commands like: approve, reject, edit, keep only docs, drop 2, rework, quarantine, release, promote, hold, status.",
  ].join(" ");
}

export function listOperatorThreadsSummary(
  options: OperatorThreadListOptions = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  return withDatabase(dbPath, (db) => listOperatorThreads(db, options)).map(
    (thread) => ({
      ...thread,
      links: threadLinks(String(thread.id)),
      pendingActionCount: withDatabase(
        dbPath,
        (db) =>
          listOperatorThreadActions(db, {
            threadId: String(thread.id),
            status: "pending",
            limit: 20,
          }).length,
      ),
    }),
  );
}

export async function getOperatorThreadDetail(
  threadId: string,
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  return syncThreadState(threadId, dbPath);
}

export async function createOperatorThread(
  payload: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const content = toText(
    payload.message ?? payload.goal ?? payload.objective,
    "",
  );
  if (!content) {
    throw new Error("operator thread requires a message");
  }
  const createdAt = nowIso();
  const execution = normalizeExecutionSettings(payload);
  const thread = {
    id: createId("operator-thread"),
    title: toText(
      payload.title,
      threadDisplayTitle({
        title: "",
        summary: {},
        metadata: { mission: { objective: content } },
      }),
    ),
    projectId: execution.projectId ?? "spore",
    status: "active",
    summary: {
      objective: content,
      pendingActionCount: 0,
      lastMessageExcerpt: safeExcerpt(content, 140),
    },
    metadata: {
      mission: {
        objective: content,
      },
      execution,
      linkage: {
        goalPlanIds: [],
        activeGoalPlanId: null,
        activeGroupId: null,
        activeProposalId: null,
        activeWorkItemId: null,
        activeRunId: null,
      },
      observed: {},
    },
    createdAt,
    updatedAt: createdAt,
    latestMessageAt: createdAt,
  };
  withDatabase(dbPath, (db) => upsertOperatorThread(db, thread));
  appendThreadMessage(thread.id, "operator", "message", content, {}, dbPath);
  await createGoalPlanFromMessage(thread, content, payload, dbPath);
  return syncThreadState(thread.id, dbPath);
}

export async function postOperatorThreadMessage(
  threadId: string,
  payload: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const thread = withDatabase(dbPath, (db) => getOperatorThread(db, threadId));
  if (!thread) {
    return null;
  }
  const content = toText(payload.message ?? payload.content, "");
  if (!content) {
    throw new Error("operator message requires content");
  }
  appendThreadMessage(threadId, "operator", "message", content, {}, dbPath);
  const synced = await syncThreadState(threadId, dbPath);
  const pendingAction = asArray<LooseRecord>(synced.pendingActions)[0] ?? null;
  const matchedChoice = matchPendingActionChoice(content, pendingAction);
  const activeGoalPlan = asObject(asObject(synced.context).goalPlan);
  if (
    pendingAction?.actionKind === "goal-plan-review" &&
    activeGoalPlan?.id &&
    (!matchedChoice || matchedChoice === "edit")
  ) {
    const edited = await applyGoalPlanEditMessage(
      threadId,
      activeGoalPlan,
      content,
      payload,
      dbPath,
    );
    if (edited) {
      return syncThreadState(threadId, dbPath);
    }
    if (matchedChoice === "edit") {
      appendThreadMessage(
        threadId,
        "assistant",
        "summary",
        `You can edit the current plan by saying things like “keep only docs”, “drop 2”, “prioritize operator-ui-pass”, or “show plan”. Current options: ${recommendationPreview(activeGoalPlan)}.`,
        {
          artifacts: [
            artifactRef(
              "goal-plan",
              String(activeGoalPlan.id),
              toText(activeGoalPlan.title, String(activeGoalPlan.id)),
              String(activeGoalPlan.status),
            ),
          ],
        },
        dbPath,
      );
      return syncThreadState(threadId, dbPath);
    }
  }
  if (matchedChoice && pendingAction?.id) {
    return resolveOperatorThreadAction(
      String(pendingAction.id),
      {
        choice: matchedChoice,
        comments: content,
        by: payload.by ?? "operator",
        source: payload.source ?? "operator-chat",
      },
      dbPath,
    );
  }
  if (messageRequestsHelp(content)) {
    appendThreadMessage(
      threadId,
      "assistant",
      "summary",
      helpReply(),
      {},
      dbPath,
    );
    return syncThreadState(threadId, dbPath);
  }
  if (messageRequestsStatus(content)) {
    return replyWithStatus(thread, dbPath);
  }
  if (pendingAction?.id) {
    appendThreadMessage(
      threadId,
      "assistant",
      "summary",
      `I still need a decision on ${toText(pendingAction.title, String(pendingAction.actionKind ?? "the pending action"))}. Reply with one of the available actions or ask for status/help.`,
      {},
      dbPath,
    );
    return syncThreadState(threadId, dbPath);
  }
  await createGoalPlanFromMessage(thread, content, payload, dbPath);
  return syncThreadState(threadId, dbPath);
}

export async function listOperatorPendingActions(
  options: OperatorThreadActionListOptions = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const limit = Number.parseInt(String(options.limit ?? "100"), 10) || 100;
  const scopedThreadId = options.threadId
    ? String(options.threadId).trim()
    : "";
  const normalizedStatus = options.status ? String(options.status).trim() : "";
  const threadIds = scopedThreadId
    ? [scopedThreadId]
    : normalizedStatus === "pending"
      ? withDatabase(dbPath, (db) =>
          listOperatorThreads(db, {
            limit: Math.max(limit * 4, 100),
          }),
        ).map((thread) => thread.id)
      : dedupe(
          withDatabase(dbPath, (db) =>
            listOperatorThreadActions(db, options),
          ).map((action) => action.threadId),
        );

  const freshProjectedActions = [];
  for (const threadId of threadIds) {
    const detail = await syncThreadState(String(threadId), dbPath);
    if (!detail) {
      continue;
    }
    freshProjectedActions.push(
      ...(normalizedStatus === "pending" && !scopedThreadId
        ? asArray<LooseRecord>(detail.pendingActions)
        : asArray<LooseRecord>(detail.actionHistory)),
    );
  }

  return freshProjectedActions
    .filter((action) => {
      if (scopedThreadId && String(action.threadId) !== scopedThreadId) {
        return false;
      }
      if (options.status && String(action.status) !== String(options.status)) {
        return false;
      }
      if (
        options.actionKind &&
        String(action.actionKind) !== String(options.actionKind)
      ) {
        return false;
      }
      if (
        options.targetType &&
        String(action.targetType) !== String(options.targetType)
      ) {
        return false;
      }
      if (
        options.targetId &&
        String(action.targetId) !== String(options.targetId)
      ) {
        return false;
      }
      return true;
    })
    .sort(
      (left, right) =>
        Date.parse(String(right.requestedAt ?? 0)) -
        Date.parse(String(left.requestedAt ?? 0)),
    )
    .slice(0, limit);
}

interface ResolveOperatorActionArgs {
  action: LooseRecord;
  choice: string;
  payload: LooseRecord;
  thread: LooseRecord;
  dbPath: string;
}

function resolveHoldAndSync(
  action: LooseRecord,
  message: string,
  dbPath: string,
) {
  closeAction(
    action,
    "resolved",
    {
      choice: "hold",
      held: true,
    },
    dbPath,
  );
  appendThreadMessage(
    String(action.threadId),
    "assistant",
    "action-result",
    message,
    {},
    dbPath,
  );
  return syncThreadState(String(action.threadId), dbPath);
}

async function resolveGoalPlanReviewAction({
  action,
  choice,
  payload,
  dbPath,
}: ResolveOperatorActionArgs) {
  if (choice === "edit") {
    appendThreadMessage(
      String(action.threadId),
      "assistant",
      "summary",
      `Tell me how to reshape goal plan ${action.targetId}. Try “keep only docs”, “drop 2”, “prioritize operator-ui-pass”, or “show plan”.`,
      {},
      dbPath,
    );
    return syncThreadState(String(action.threadId), dbPath);
  }
  const result = await reviewGoalPlan(
    String(action.targetId),
    {
      status: choice === "reject" ? "rejected" : "reviewed",
      comments: payload.comments ?? "",
      reason: payload.reason ?? payload.comments ?? "",
      by: payload.by ?? "operator",
      source: payload.source ?? "operator-chat",
    },
    dbPath,
  );
  closeAction(
    action,
    "resolved",
    {
      choice,
      resultStatus: result?.status ?? null,
    },
    dbPath,
  );
  appendThreadMessage(
    String(action.threadId),
    "assistant",
    "action-result",
    choice === "reject"
      ? `Goal plan ${action.targetId} was rejected. Send a revised request when you want a new plan.`
      : `Goal plan ${action.targetId} was approved. I will continue the managed self-build flow now.`,
    {
      artifacts: [
        artifactRef(
          "goal-plan",
          String(action.targetId),
          toText(result?.title, String(action.targetId)),
          toText(result?.status, ""),
        ),
      ],
    },
    dbPath,
  );
  return null;
}

async function resolveProposalReviewAction({
  action,
  choice,
  payload,
  dbPath,
}: ResolveOperatorActionArgs) {
  const result = await reviewProposalArtifact(
    String(action.targetId),
    {
      status:
        choice === "rejected" || choice === "reject" ? "rejected" : "reviewed",
      comments: payload.comments ?? "",
      reason: payload.reason ?? payload.comments ?? "",
      by: payload.by ?? "operator",
      source: payload.source ?? "operator-chat",
    },
    dbPath,
  );
  closeAction(
    action,
    "resolved",
    {
      choice,
      resultStatus: result?.status ?? null,
    },
    dbPath,
  );
  appendThreadMessage(
    String(action.threadId),
    "assistant",
    "action-result",
    choice === "rejected" || choice === "reject"
      ? `Proposal ${action.targetId} was rejected during review.`
      : `Proposal ${action.targetId} was marked as reviewed and can move to approval.`,
    {
      artifacts: [
        artifactRef(
          "proposal",
          String(action.targetId),
          toText(asObject(result?.summary).title, String(action.targetId)),
          result?.status ? String(result.status) : null,
        ),
      ],
    },
    dbPath,
  );
  return null;
}

async function resolveProposalApprovalAction({
  action,
  choice,
  payload,
  dbPath,
}: ResolveOperatorActionArgs) {
  const result = await approveProposalArtifact(
    String(action.targetId),
    {
      status: choice === "reject" ? "rejected" : "approved",
      comments: payload.comments ?? "",
      reason: payload.reason ?? payload.comments ?? "",
      by: payload.by ?? "operator",
      source: payload.source ?? "operator-chat",
    },
    dbPath,
  );
  closeAction(
    action,
    "resolved",
    {
      choice,
      resultStatus: result?.status ?? null,
    },
    dbPath,
  );
  appendThreadMessage(
    String(action.threadId),
    "assistant",
    "action-result",
    choice === "reject"
      ? `Proposal ${action.targetId} was rejected during approval.`
      : `Proposal ${action.targetId} was approved. I will continue with validation and readiness checks.`,
    {
      artifacts: [
        artifactRef(
          "proposal",
          String(action.targetId),
          toText(asObject(result?.summary).title, String(action.targetId)),
          result?.status ? String(result.status) : null,
        ),
      ],
    },
    dbPath,
  );
  return null;
}

async function resolveProposalReworkAction({
  action,
  choice,
  payload,
  thread,
  dbPath,
}: ResolveOperatorActionArgs) {
  if (choice === "hold") {
    return resolveHoldAndSync(
      action,
      `Proposal ${action.targetId} stays on hold. Reply with rework or quarantine when you want me to continue.`,
      dbPath,
    );
  }
  if (choice === "quarantine") {
    const result = await quarantineSelfBuildTarget(
      "proposal",
      String(action.targetId),
      {
        reason:
          payload.reason ??
          payload.comments ??
          "Operator requested quarantine from operator chat.",
        rationale: payload.comments ?? payload.reason ?? "",
        by: payload.by ?? "operator",
        sourceType: payload.source ?? "operator-chat",
        sourceId: action.id,
      },
      dbPath,
    );
    closeAction(
      action,
      "resolved",
      {
        choice,
        quarantineId: result?.id ?? null,
      },
      dbPath,
    );
    appendThreadMessage(
      String(action.threadId),
      "assistant",
      "action-result",
      `Proposal ${action.targetId} has been quarantined. I will wait for an explicit release before continuing.`,
      {},
      dbPath,
    );
    return syncThreadState(String(action.threadId), dbPath);
  }
  const result = await reworkProposalArtifact(
    String(action.targetId),
    {
      comments: payload.comments ?? "",
      rationale: payload.reason ?? payload.comments ?? "",
      by: payload.by ?? "operator",
      source: payload.source ?? "operator-chat",
    },
    dbPath,
  );
  const reworkItem = asObject(result?.reworkItem);
  closeAction(
    action,
    "resolved",
    {
      choice,
      reworkItemId: reworkItem.id ?? null,
    },
    dbPath,
  );
  appendThreadMessage(
    String(action.threadId),
    "assistant",
    "action-result",
    reworkItem.id
      ? `Created rework item ${reworkItem.id} for proposal ${action.targetId}.`
      : `Created a proposal rework request for ${action.targetId}.`,
    {
      artifacts: [
        artifactRef(
          "work-item",
          reworkItem.id ? String(reworkItem.id) : null,
          toText(reworkItem.title, "Rework item"),
          toText(reworkItem.status, "pending"),
        ),
      ],
    },
    dbPath,
  );
  if (reworkItem.id) {
    updateThreadRecord(
      thread,
      {
        metadata: mergeThreadMetadata(thread, {
          linkage: {
            activeWorkItemId: String(reworkItem.id),
            activeRunId: null,
          },
        }),
      },
      dbPath,
    );
  }
  if (reworkItem.id && extractExecutionSettings(thread).autoRun !== false) {
    await runSelfBuildWorkItem(
      String(reworkItem.id),
      executionRunOptions(thread, {
        source: payload.source ?? "operator-chat-rework-run",
        by: payload.by ?? "operator",
      }),
      dbPath,
    );
    const refreshedItem = getSelfBuildWorkItem(String(reworkItem.id), dbPath);
    appendThreadMessage(
      String(action.threadId),
      "assistant",
      "event",
      `I started the rework item ${reworkItem.id} so the managed flow can continue without another manual step.`,
      {
        artifacts: [
          artifactRef(
            "work-item",
            refreshedItem?.id ? String(refreshedItem.id) : String(reworkItem.id),
            toText(refreshedItem?.title, String(reworkItem.id)),
            toText(refreshedItem?.status, "running"),
          ),
        ],
      },
      dbPath,
    );
  }
  return null;
}

async function resolveManagedRunRecoveryAction({
  action,
  choice,
  payload,
  thread,
  dbPath,
}: ResolveOperatorActionArgs) {
  if (choice === "hold") {
    return resolveHoldAndSync(
      action,
      `Run ${action.targetId} stays on hold. Reply with rerun or quarantine when you want me to continue.`,
      dbPath,
    );
  }
  if (choice === "quarantine") {
    const result = await quarantineSelfBuildTarget(
      toText(asObject(action.payload).quarantineTargetType, "work-item-group"),
      toText(asObject(action.payload).quarantineTargetId, ""),
      {
        reason:
          payload.reason ??
          payload.comments ??
          "Operator requested quarantine from operator chat recovery flow.",
        rationale: payload.comments ?? payload.reason ?? "",
        by: payload.by ?? "operator",
        sourceType: payload.source ?? "operator-chat",
        sourceId: action.id,
      },
      dbPath,
    );
    closeAction(
      action,
      "resolved",
      {
        choice,
        quarantineId: result?.id ?? null,
      },
      dbPath,
    );
    appendThreadMessage(
      String(action.threadId),
      "assistant",
      "action-result",
      `Quarantined the affected managed-work group after run ${action.targetId} failed. I will wait for an explicit release before continuing.`,
      {},
      dbPath,
    );
    return syncThreadState(String(action.threadId), dbPath);
  }
  const result = await rerunSelfBuildWorkItemRun(
    String(action.targetId),
    executionRunOptions(thread, {
      source: payload.source ?? "operator-chat-run-recovery",
      by: payload.by ?? "operator",
    }),
    dbPath,
  );
  closeAction(
    action,
    "resolved",
    {
      choice,
      rerunOf: action.targetId,
      nextRunId: asObject(result?.run).id ?? null,
    },
    dbPath,
  );
  appendThreadMessage(
    String(action.threadId),
    "assistant",
    "action-result",
    `I started a fresh rerun from failed run ${action.targetId} so the thread can recover from the latest managed-work failure.`,
    {
      artifacts: [
        artifactRef(
          "work-item-run",
          toText(asObject(result?.run).id, "") || null,
          toText(asObject(result?.run).itemTitle, "Recovery rerun"),
          toText(asObject(result?.run).status, "running"),
        ),
      ],
    },
    dbPath,
  );
  return null;
}

async function resolveQuarantineReleaseAction({
  action,
  choice,
  payload,
  dbPath,
}: ResolveOperatorActionArgs) {
  if (choice === "hold") {
    return resolveHoldAndSync(
      action,
      `Quarantine ${action.targetId} remains active. Reply with release when you want to continue.`,
      dbPath,
    );
  }
  const result = await releaseSelfBuildQuarantine(
    String(action.targetId),
    {
      reason: payload.reason ?? payload.comments ?? "Released from operator chat.",
      by: payload.by ?? "operator",
      nextStatus: payload.nextStatus ?? null,
    },
    dbPath,
  );
  closeAction(
    action,
    "resolved",
    {
      choice,
      releaseStatus: result?.status ?? null,
    },
    dbPath,
  );
  appendThreadMessage(
    String(action.threadId),
    "assistant",
    "action-result",
    `Released quarantine ${action.targetId}. I will resume the governed self-build flow from the underlying target state.`,
    {},
    dbPath,
  );
  return null;
}

async function resolveProposalPromotionAction({
  action,
  choice,
  payload,
  thread,
  dbPath,
}: ResolveOperatorActionArgs) {
  if (choice === "hold") {
    return resolveHoldAndSync(
      action,
      `Promotion for proposal ${action.targetId} is on hold. Send “promote” when you want me to continue.`,
      dbPath,
    );
  }
  const result = await invokeProposalPromotion(
    String(action.targetId),
    {
      ...executionRunOptions(thread, {
        source: payload.source ?? "operator-chat-promotion",
        by: payload.by ?? "operator",
      }),
    },
    dbPath,
  );
  closeAction(
    action,
    "resolved",
    {
      choice,
      integrationBranch:
        toText(asObject(result?.promotion).integrationBranch, "") ||
        getProposalIntegrationBranch(asObject(result?.proposal)),
    },
    dbPath,
  );
  const integrationBranch =
    toText(asObject(result?.promotion).integrationBranch, "") ||
    getProposalIntegrationBranch(asObject(result?.proposal));
  appendThreadMessage(
    String(action.threadId),
    "assistant",
    "action-result",
    integrationBranch
      ? `Promotion launched for proposal ${action.targetId}. Current integration branch: ${integrationBranch}.`
      : `Promotion launched for proposal ${action.targetId}.`,
    {
      artifacts: [
        artifactRef(
          "integration-branch",
          integrationBranch || null,
          integrationBranch || "Integration branch",
          "promotion_candidate",
        ),
      ],
    },
    dbPath,
  );
  return null;
}

export async function resolveOperatorThreadAction(
  actionId: string,
  payload: LooseRecord = {},
  dbPath = DEFAULT_ORCHESTRATOR_DB_PATH,
) {
  const action = withDatabase(dbPath, (db) =>
    getOperatorThreadAction(db, actionId),
  );
  if (!action) {
    return null;
  }
  if (String(action.status) !== "pending") {
    return syncThreadState(String(action.threadId), dbPath);
  }
  const thread = withDatabase(dbPath, (db) =>
    getOperatorThread(db, String(action.threadId)),
  );
  if (!thread) {
    return null;
  }
  const choice = toText(payload.choice, "approve");
  const handlers: Record<
    string,
    (args: ResolveOperatorActionArgs) => Promise<LooseRecord | null>
  > = {
    "goal-plan-review": resolveGoalPlanReviewAction,
    "proposal-review": resolveProposalReviewAction,
    "proposal-approval": resolveProposalApprovalAction,
    "proposal-rework": resolveProposalReworkAction,
    "managed-run-recovery": resolveManagedRunRecoveryAction,
    "quarantine-release": resolveQuarantineReleaseAction,
    "proposal-promotion": resolveProposalPromotionAction,
  };
  const handler = handlers[String(action.actionKind)];
  if (!handler) {
    throw new Error(`unsupported operator action kind: ${action.actionKind}`);
  }
  const earlyResult = await handler({
    action,
    choice,
    payload,
    thread,
    dbPath,
  });
  if (earlyResult) {
    return earlyResult;
  }
  return syncThreadState(String(action.threadId), dbPath);
}
