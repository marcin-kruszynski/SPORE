import type {
  DependencyBlocker,
  DependencyStatePayload,
  DependencyTransitionEntry,
} from "../types/contracts.js";

function compactObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, entry]) => entry !== undefined && entry !== null && entry !== "",
    ),
  );
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value.filter(Boolean) as T[]) : [];
}

function dedupe(values: unknown): string[] {
  return Array.from(
    new Set(
      asArray<unknown>(values)
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  );
}

export function appendDependencyTransition(
  createId: (prefix: string) => string,
  transitions: DependencyTransitionEntry[] = [],
  entry: DependencyTransitionEntry = {},
): DependencyTransitionEntry[] {
  const normalized = compactObject({
    id: entry.id ?? createId("dependency-transition"),
    type: entry.type ?? "dependency_state_updated",
    timestamp: entry.timestamp ?? new Date().toISOString(),
    state: entry.state ?? null,
    reasonCode: entry.reasonCode ?? null,
    reason: entry.reason ?? null,
    itemId: entry.itemId ?? null,
    dependencyItemId: entry.dependencyItemId ?? null,
    blockerId: entry.blockerId ?? null,
    strictness: entry.strictness ?? null,
    nextActionHint: entry.nextActionHint ?? null,
    notes: entry.notes ?? null,
  }) as DependencyTransitionEntry;
  const existing = asArray<DependencyTransitionEntry>(transitions);
  const previous = existing[existing.length - 1];
  if (
    previous &&
    previous.type === normalized.type &&
    previous.state === normalized.state &&
    previous.reasonCode === normalized.reasonCode &&
    previous.itemId === normalized.itemId &&
    previous.dependencyItemId === normalized.dependencyItemId &&
    previous.blockerId === normalized.blockerId
  ) {
    return existing;
  }
  return [...existing.slice(-24), normalized];
}

export function normalizeDependencyBlockers(
  blockers: unknown,
): DependencyBlocker[] {
  return asArray<unknown>(blockers).map(
    (blocker) => compactObject(blocker) as DependencyBlocker,
  );
}

export function buildDependencyState(
  currentDependency: Record<string, unknown>,
  dependency: DependencyStatePayload,
  now: string,
  toText: (value: unknown, fallback?: string) => string,
): Record<string, unknown> {
  const blockers = normalizeDependencyBlockers(
    dependency.blockers ?? currentDependency.blockers ?? [],
  );
  const blockerIds = dedupe(
    dependency.blockerIds ?? blockers.map((blocker) => blocker.id),
  );
  return compactObject({
    ...currentDependency,
    state: dependency.state ?? currentDependency.state ?? null,
    reasonCode: dependency.reasonCode ?? currentDependency.reasonCode ?? null,
    reason: toText(dependency.reason, String(currentDependency.reason ?? "")),
    nextActionHint: toText(
      dependency.nextActionHint,
      String(currentDependency.nextActionHint ?? ""),
    ),
    blockerIds,
    blockers,
    advisoryWarnings: asArray(
      dependency.advisoryWarnings ?? currentDependency.advisoryWarnings ?? [],
    ),
    incomingEdges: asArray(
      dependency.incomingEdges ?? currentDependency.incomingEdges ?? [],
    ),
    outgoingEdges: asArray(
      dependency.outgoingEdges ?? currentDependency.outgoingEdges ?? [],
    ),
    readyToRun:
      dependency.readyToRun ?? Boolean(currentDependency.readyToRun ?? false),
    updatedAt: now,
  });
}
