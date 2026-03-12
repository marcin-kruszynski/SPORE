import { resolveMissionMapExecutionLink } from "./mission-map.js";
import {
  buildEvidenceHref,
  resolveMissionEvidenceTargetFromArtifact,
} from "./self-build.js";
import type {
  MissionMapApiCoordinationGroupSummary,
  MissionMapApiExecutionRecord,
  MissionMapApiThreadDetail,
  MissionMapApiThreadSummary,
} from "../types/mission-map.js";

export interface CatalogEvidenceLink {
  label: string;
  href: string;
  status: string;
}

export interface CanonicalEntityDescriptor {
  id: string;
  name: string;
  explicitId: string | null;
  path: string | null;
  aliases: string[];
}

interface CanonicalEntityEntry {
  explicitId: string | null;
  path: string | null;
  name: string;
  fallbackId: string | null;
  aliases: Set<string>;
}

interface CanonicalEntityInput {
  explicitId?: unknown;
  path?: unknown;
  name?: unknown;
  fallbackId?: unknown;
  extraAliases?: Array<unknown>;
}

export interface CanonicalEntityRegistry {
  entries: CanonicalEntityDescriptor[];
  resolve(input: CanonicalEntityInput): CanonicalEntityDescriptor | null;
}

interface ExecutionMatchResult {
  executionId: string | null;
  warning: string | null;
}

export interface ThreadBundle {
  id: string;
  summary: MissionMapApiThreadSummary | null;
  detail: MissionMapApiThreadDetail | null;
  executionId: string | null;
  matchWarning: string | null;
}

export function toText(value: unknown, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

export function asArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export function basenameWithoutExtension(value: unknown) {
  const text = toText(value, "");
  if (!text) {
    return "";
  }

  const tail = text.split("/").pop() ?? text;
  return tail.replace(/\.[a-z0-9]+$/i, "");
}

function uniqueAliases(values: Array<unknown>) {
  return Array.from(
    new Set(
      values
        .map((value) => toText(value, ""))
        .filter(Boolean),
    ),
  );
}

export function buildEntityAliases(input: {
  explicitId?: unknown;
  path?: unknown;
  extraAliases?: Array<unknown>;
}) {
  return uniqueAliases([
    input.explicitId,
    input.path,
    ...(input.extraAliases ?? []),
  ]);
}

export function humanize(value: unknown, fallback = "Unknown") {
  const text = toText(value, fallback);
  return text
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function entityIdFor(entry: CanonicalEntityEntry, fallbackLabel: string) {
  return (
    entry.explicitId ||
    entry.path ||
    entry.fallbackId ||
    Array.from(entry.aliases)[0] ||
    `derived-${fallbackLabel.toLowerCase()}`
  );
}

function entityNameFor(entry: CanonicalEntityEntry, fallbackLabel: string) {
  return (
    toText(entry.name, "") ||
    entry.explicitId ||
    basenameWithoutExtension(entry.path) ||
    humanize(entityIdFor(entry, fallbackLabel), fallbackLabel)
  );
}

function descriptorFromEntry(
  entry: CanonicalEntityEntry,
  fallbackLabel: string,
): CanonicalEntityDescriptor {
  return {
    id: entityIdFor(entry, fallbackLabel),
    name: entityNameFor(entry, fallbackLabel),
    explicitId: entry.explicitId,
    path: entry.path,
    aliases: Array.from(entry.aliases),
  };
}

function toCanonicalEntry(input: CanonicalEntityInput) {
  return {
    explicitId: toText(input.explicitId, "") || null,
    path: toText(input.path, "") || null,
    name: toText(input.name, ""),
    fallbackId: toText(input.fallbackId, "") || null,
    aliases: new Set(
      buildEntityAliases({
        explicitId: input.explicitId,
        path: input.path,
        extraAliases: input.extraAliases,
      }),
    ),
  } satisfies CanonicalEntityEntry;
}

function sharesAlias(entry: CanonicalEntityEntry, aliases: string[]) {
  return aliases.some((alias) => entry.aliases.has(alias));
}

function mergeCanonicalEntries(
  target: CanonicalEntityEntry,
  source: CanonicalEntityEntry,
) {
  if (!target.explicitId && source.explicitId) {
    target.explicitId = source.explicitId;
  }
  if (!target.path && source.path) {
    target.path = source.path;
  }
  if (!target.name && source.name) {
    target.name = source.name;
  }
  if (!target.fallbackId && source.fallbackId) {
    target.fallbackId = source.fallbackId;
  }

  for (const alias of source.aliases) {
    target.aliases.add(alias);
  }
}

export function createCanonicalEntityRegistry(
  inputs: CanonicalEntityInput[],
  fallbackLabel: string,
): CanonicalEntityRegistry {
  const entries: CanonicalEntityEntry[] = [];

  for (const input of inputs) {
    const nextEntry = toCanonicalEntry(input);
    const aliases = Array.from(nextEntry.aliases);
    const matches = aliases.length === 0
      ? []
      : entries.filter((entry) => sharesAlias(entry, aliases));

    if (matches.length === 0) {
      entries.push(nextEntry);
      continue;
    }

    const primary = matches[0];
    mergeCanonicalEntries(primary, nextEntry);

    for (const match of matches.slice(1)) {
      mergeCanonicalEntries(primary, match);
      const index = entries.indexOf(match);
      if (index >= 0) {
        entries.splice(index, 1);
      }
    }
  }

  return {
    entries: entries.map((entry) => descriptorFromEntry(entry, fallbackLabel)),
    resolve(input) {
      const aliases = buildEntityAliases({
        explicitId: input.explicitId,
        path: input.path,
        extraAliases: input.extraAliases,
      });
      const matched = entries.find((entry) => sharesAlias(entry, aliases));
      if (matched) {
        return descriptorFromEntry(matched, fallbackLabel);
      }

      const explicitId = toText(input.explicitId, "");
      if (explicitId) {
        const basenameMatches = entries.filter(
          (entry) => basenameWithoutExtension(entry.path) === explicitId,
        );
        if (basenameMatches.length === 1 && basenameMatches[0]) {
          return descriptorFromEntry(basenameMatches[0], fallbackLabel);
        }
      }

      const virtualEntry = toCanonicalEntry(input);
      if (virtualEntry.aliases.size === 0) {
        return null;
      }

      return descriptorFromEntry(virtualEntry, fallbackLabel);
    },
  };
}

export function buildRouteHref(basePath: string, id: string) {
  return `${basePath}/${encodeURIComponent(id)}`;
}

export function timestampFor(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const text = toText(value, "");
  if (!text) {
    return 0;
  }

  if (/^\d+$/.test(text)) {
    const numeric = Number(text);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatTimestampLabel(value: unknown) {
  const timestamp = timestampFor(value);
  if (timestamp > 0) {
    return new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(timestamp));
  }

  const text = toText(value, "");
  return text || "No recent activity";
}

export function normalizeCatalogStatus(value: unknown) {
  const status = toText(value, "active").toLowerCase();
  if (
    ["blocked", "error", "failed", "rejected", "held", "paused", "quarantined"].includes(
      status,
    )
  ) {
    return "blocked";
  }
  if (
    ["waiting_approval", "needs-approval", "approval_required", "pending_approval"].includes(
      status,
    )
  ) {
    return "needs-approval";
  }
  if (
    ["waiting_review", "ready_for_review", "needs-review", "review_required"].includes(
      status,
    )
  ) {
    return "needs-review";
  }
  if (["validation_required", "validation-pending"].includes(status)) {
    return "validation-pending";
  }
  if (["promotion_ready", "promotion-ready", "promotion_candidate"].includes(status)) {
    return "promotion-ready";
  }
  if (["promotion_blocked", "promotion-blocked"].includes(status)) {
    return "promotion-blocked";
  }
  if (
    ["running", "active", "in_progress", "processing", "waiting_operator", "pending"].includes(
      status,
    )
  ) {
    return "running";
  }
  if (["completed", "resolved", "approved", "succeeded", "done", "reviewed"].includes(status)) {
    return "completed";
  }
  if (status === "inactive") {
    return "inactive";
  }
  return status || "active";
}

export function isBlockedStatus(value: unknown) {
  return (
    normalizeCatalogStatus(value) === "blocked" ||
    normalizeCatalogStatus(value) === "promotion-blocked"
  );
}

export function isRunningStatus(value: unknown) {
  return normalizeCatalogStatus(value) === "running";
}

export function isCompletedStatus(value: unknown) {
  return normalizeCatalogStatus(value) === "completed";
}

export function isReviewStatus(value: unknown) {
  return normalizeCatalogStatus(value) === "needs-review";
}

export function isApprovalStatus(value: unknown) {
  return normalizeCatalogStatus(value) === "needs-approval";
}

export function deriveAggregateStatus(input: {
  statuses: string[];
  pendingActions: number;
  actionTexts?: string[];
}) {
  const { statuses, pendingActions, actionTexts = [] } = input;
  const normalizedStatuses = statuses.map((status) => normalizeCatalogStatus(status));
  const actionText = actionTexts.join(" ").toLowerCase();

  if (normalizedStatuses.some((status) => isBlockedStatus(status))) {
    return "blocked";
  }
  if (
    normalizedStatuses.some((status) => isApprovalStatus(status)) ||
    actionText.includes("approval") ||
    actionText.includes("approve")
  ) {
    return "needs-approval";
  }
  if (normalizedStatuses.some((status) => isReviewStatus(status)) || pendingActions > 0) {
    return "needs-review";
  }
  if (normalizedStatuses.some((status) => isRunningStatus(status))) {
    return "running";
  }
  if (
    normalizedStatuses.length > 0 &&
    normalizedStatuses.every((status) => isCompletedStatus(status))
  ) {
    return "completed";
  }
  return normalizedStatuses[0] ?? "active";
}

function tokenize(value: string) {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((entry) => entry.length >= 4),
  );
}

function objectiveSimilarity(left: string, right: string) {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let matches = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      matches += 1;
    }
  }

  return matches / Math.max(leftTokens.size, rightTokens.size);
}

export function normalizeComparableText(value: unknown) {
  return toText(value, "").replace(/\s+/g, " ").toLowerCase();
}

function threadTitle(input: {
  threadSummary: MissionMapApiThreadSummary | null;
  threadDetail: MissionMapApiThreadDetail | null;
}) {
  return (
    toText(input.threadDetail?.title, "") ||
    toText(input.threadSummary?.title, "") ||
    "mission"
  );
}

function executionProjectMatches(execution: MissionMapApiExecutionRecord, projectHint: string) {
  if (!projectHint) {
    return true;
  }

  return buildEntityAliases({
    explicitId: execution.projectId,
    path: execution.projectPath,
  }).includes(projectHint);
}

function resolveExecutionMatchForThread(input: {
  threadSummary: MissionMapApiThreadSummary | null;
  threadDetail: MissionMapApiThreadDetail | null;
  coordinationGroups: MissionMapApiCoordinationGroupSummary[];
  executions: MissionMapApiExecutionRecord[];
}): ExecutionMatchResult {
  const explicit = resolveMissionMapExecutionLink({
    threadSummary: input.threadSummary,
    threadDetail: input.threadDetail,
    coordinationGroups: input.coordinationGroups,
  });
  if (explicit.executionId) {
    return {
      executionId: explicit.executionId,
      warning: null,
    };
  }

  const objective =
    toText(input.threadDetail?.summary?.objective, "") ||
    toText(input.threadSummary?.summary?.objective, "");
  if (!objective) {
    return {
      executionId: null,
      warning: null,
    };
  }

  const normalizedObjective = normalizeComparableText(objective);
  const projectHint = toText(input.threadDetail?.metadata?.execution?.projectId, "");
  const uniqueBasenameExecutionId = projectHint
    ? (() => {
        const basenameMatches = input.executions.filter(
          (execution) => basenameWithoutExtension(execution.projectPath) === projectHint,
        );
        return basenameMatches.length === 1
          ? toText(basenameMatches[0]?.id, "") || null
          : null;
      })()
    : null;
  const candidates = input.executions
    .map((execution) => ({
      execution,
      exactMatch:
        normalizeComparableText(execution.objective) === normalizedObjective,
      score: objectiveSimilarity(objective, toText(execution.objective, "")),
      projectMatches:
        executionProjectMatches(execution, projectHint) ||
        (uniqueBasenameExecutionId !== null &&
          toText(execution.id, "") === uniqueBasenameExecutionId),
      recency: Math.max(
        timestampFor(execution.updatedAt),
        timestampFor(execution.endedAt),
        timestampFor(execution.startedAt),
      ),
    }))
    .filter(
      (candidate) =>
        candidate.projectMatches && (candidate.exactMatch || candidate.score > 0),
    )
    .sort(
      (left, right) =>
        Number(right.exactMatch) - Number(left.exactMatch) ||
        right.score - left.score ||
        right.recency - left.recency ||
        toText(left.execution.id, "").localeCompare(toText(right.execution.id, "")),
    );

  const bestCandidate = candidates[0];
  const secondCandidate = candidates[1] ?? null;
  if (!bestCandidate) {
    return {
      executionId: null,
      warning: null,
    };
  }

  if (!bestCandidate.exactMatch && bestCandidate.score < 0.55) {
    return {
      executionId: null,
      warning: `Low-confidence mission match for ${threadTitle(input)}.`,
    };
  }

  if (
    secondCandidate &&
    bestCandidate.exactMatch === secondCandidate.exactMatch &&
    bestCandidate.score === secondCandidate.score &&
    bestCandidate.recency === secondCandidate.recency
  ) {
    return {
      executionId: null,
      warning: `Ambiguous mission match for ${threadTitle(input)}.`,
    };
  }

  return {
    executionId: toText(bestCandidate.execution.id, "") || null,
    warning: null,
  };
}

export function resolveExecutionIdForThread(input: {
  threadSummary: MissionMapApiThreadSummary | null;
  threadDetail: MissionMapApiThreadDetail | null;
  coordinationGroups: MissionMapApiCoordinationGroupSummary[];
  executions: MissionMapApiExecutionRecord[];
}) {
  return resolveExecutionMatchForThread(input).executionId;
}

export function buildThreadBundles(input: {
  threadSummaries: MissionMapApiThreadSummary[];
  threadDetails: MissionMapApiThreadDetail[];
  coordinationGroups: MissionMapApiCoordinationGroupSummary[];
  executions: MissionMapApiExecutionRecord[];
}) {
  const summaryMap = new Map(
    input.threadSummaries
      .map((summary) => {
        const id = toText(summary.id, "");
        return id ? ([id, summary] as const) : null;
      })
      .filter(
        (entry): entry is readonly [string, MissionMapApiThreadSummary] => Boolean(entry),
      ),
  );
  const detailMap = new Map(
    input.threadDetails
      .map((detail) => {
        const id = toText(detail.id, "");
        return id ? ([id, detail] as const) : null;
      })
      .filter(
        (entry): entry is readonly [string, MissionMapApiThreadDetail] => Boolean(entry),
      ),
  );
  const threadIds = Array.from(new Set([...summaryMap.keys(), ...detailMap.keys()]));

  return threadIds.map((id) => {
    const summary = summaryMap.get(id) ?? null;
    const detail = detailMap.get(id) ?? null;
    const match = resolveExecutionMatchForThread({
      threadSummary: summary,
      threadDetail: detail,
      coordinationGroups: input.coordinationGroups,
      executions: input.executions,
    });
    return {
      id,
      summary,
      detail,
      executionId: match.executionId,
      matchWarning: match.warning,
    } satisfies ThreadBundle;
  });
}

export function buildEvidenceLinksFromThread(detail: MissionMapApiThreadDetail | null) {
  const seen = new Set<string>();
  return asArray(detail?.context?.linkedArtifacts)
    .map((artifact) => {
      const target = resolveMissionEvidenceTargetFromArtifact({
        itemType: artifact.itemType,
        itemId: artifact.itemId,
      });
      if (!target) {
        return null;
      }

      const href = buildEvidenceHref(target);
      if (seen.has(href)) {
        return null;
      }
      seen.add(href);

      return {
        label: toText(artifact.title, toText(artifact.itemId, humanize(target.kind))),
        href,
        status: normalizeCatalogStatus(artifact.status),
      } satisfies CatalogEvidenceLink;
    })
    .filter((link): link is CatalogEvidenceLink => Boolean(link));
}
