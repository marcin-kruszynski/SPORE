import type { JsonObject } from "@spore/shared-types";

type AttentionItemPayload = JsonObject & {
  id?: string;
  kind?: string;
  status?: string;
  attentionState?: string;
  priority?: string;
  queueType?: string;
  title?: string;
  reason?: string;
  targetType?: string | null;
  targetId?: string | null;
  itemId?: string | null;
  runId?: string | null;
  proposalId?: string | null;
  workspaceId?: string | null;
  groupId?: string | null;
  goalPlanId?: string | null;
  templateId?: string | null;
  domainId?: string | null;
  safeMode?: boolean | null;
  mutationScope?: string[];
  requiresProposal?: boolean | null;
  blockerIds?: string[];
  actionHint?: string | null;
  nextActionHint?: string | null;
  commandHint?: string | null;
  httpHint?: string | null;
  timestamp?: string;
};

export function attentionPriorityForState(state: string) {
  const order: Record<string, number> = {
    "workspace-problem": 0,
    "needs-review": 1,
    "needs-approval": 2,
    "needs-validation": 3,
    blocked: 4,
    "planner-follow-up": 5,
    "docs-follow-up": 6,
    healthy: 7,
  };
  return order[state] ?? 9;
}

export function buildAttentionItem(
  payload: AttentionItemPayload = {},
  createId: (prefix: string) => string,
  nowIso: () => string,
) {
  const attentionState = payload.attentionState ?? "healthy";
  const attentionPriority = attentionPriorityForState(attentionState);
  const priority =
    payload.priority ??
    (attentionPriority <= 2
      ? "high"
      : attentionPriority <= 4
        ? "medium"
        : "low");
  return {
    id: payload.id ?? createId("attention"),
    kind: payload.kind ?? attentionState,
    status: payload.status ?? attentionState,
    attentionState,
    attentionPriority,
    priority,
    queueType:
      payload.queueType ??
      ([
        "workspace-problem",
        "needs-review",
        "needs-approval",
        "blocked",
      ].includes(attentionState)
        ? "urgent"
        : "follow-up"),
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
    mutationScope: Array.isArray(payload.mutationScope)
      ? payload.mutationScope
      : [],
    requiresProposal: payload.requiresProposal ?? null,
    blockerIds: Array.isArray(payload.blockerIds) ? payload.blockerIds : [],
    actionHint: payload.actionHint ?? null,
    nextActionHint: payload.nextActionHint ?? null,
    commandHint: payload.commandHint ?? null,
    httpHint: payload.httpHint ?? null,
    timestamp: payload.timestamp ?? nowIso(),
  };
}

export function summarizeAttentionItems(
  items: Array<Record<string, unknown>> = [],
) {
  const byState = items.reduce<Record<string, number>>((accumulator, item) => {
    const state = String(item.attentionState ?? "healthy");
    accumulator[state] = (accumulator[state] ?? 0) + 1;
    return accumulator;
  }, {});
  const topItems = [...items]
    .sort((left, right) => {
      const priorityDelta =
        Number(left.attentionPriority ?? 9) -
        Number(right.attentionPriority ?? 9);
      if (priorityDelta !== 0) return priorityDelta;
      return (
        new Date(String(right.timestamp ?? 0)).getTime() -
        new Date(String(left.timestamp ?? 0)).getTime()
      );
    })
    .slice(0, 10);
  return {
    total: items.length,
    byState,
    topItems,
  };
}
