import fs from "node:fs/promises";
import { ensureParentDirectory } from "../store/session-store.js";
import type { SessionEvent, SessionEventFilters } from "../types.js";

function asString(
  value: string | number | boolean | undefined,
): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

export async function appendEvent(
  logPath: string,
  event: SessionEvent,
): Promise<void> {
  await ensureParentDirectory(logPath);
  await fs.appendFile(logPath, `${JSON.stringify(event)}\n`, "utf8");
}

export async function readEvents(
  logPath: string,
  sessionId: string | null = null,
): Promise<SessionEvent[]> {
  try {
    const raw = await fs.readFile(logPath, "utf8");
    const events = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as SessionEvent);
    return sessionId
      ? events.filter((event) => event.sessionId === sessionId)
      : events;
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export function filterEvents(
  events: SessionEvent[],
  filters: SessionEventFilters = {},
): SessionEvent[] {
  const limitValue = asString(filters.limit);
  const limit = limitValue ? Number.parseInt(limitValue, 10) : null;
  let filtered = events;

  const sessionFilter = asString(filters.session);
  const runFilter = asString(filters.run);
  const typeFilter = asString(filters.type);
  const sinceFilter = asString(filters.since);

  if (sessionFilter) {
    filtered = filtered.filter((event) => event.sessionId === sessionFilter);
  }
  if (runFilter) {
    filtered = filtered.filter((event) => event.runId === runFilter);
  }
  if (typeFilter) {
    filtered = filtered.filter((event) => event.type === typeFilter);
  }
  if (sinceFilter) {
    filtered = filtered.filter((event) => event.timestamp >= sinceFilter);
  }

  if (limit && Number.isFinite(limit) && limit > 0) {
    filtered = filtered.slice(-limit);
  }

  return filtered;
}

export async function getLogSize(logPath: string): Promise<number> {
  try {
    const stats = await fs.stat(logPath);
    return stats.size;
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return 0;
    }
    throw error;
  }
}

export async function readEventsFromOffset(
  logPath: string,
  offset: number,
): Promise<{ nextOffset: number; events: SessionEvent[] }> {
  const handle = await fs.open(logPath, "r");
  try {
    const stats = await handle.stat();
    if (stats.size <= offset) {
      return { nextOffset: stats.size, events: [] };
    }
    const length = stats.size - offset;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, offset);
    const events = buffer
      .toString("utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as SessionEvent);
    return { nextOffset: stats.size, events };
  } finally {
    await handle.close();
  }
}

export function formatEventLine(event: SessionEvent): string {
  const parts = [
    event.timestamp,
    event.type,
    `session=${event.sessionId}`,
    `run=${event.runId}`,
  ];
  if (event.projectId) {
    parts.push(`project=${event.projectId}`);
  }
  return parts.join(" ");
}
