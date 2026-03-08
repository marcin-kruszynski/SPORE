import fs from "node:fs/promises";
import path from "node:path";

import { ensureParentDirectory } from "../store/session-store.js";

export async function appendEvent(logPath, event) {
  await ensureParentDirectory(logPath);
  await fs.appendFile(logPath, `${JSON.stringify(event)}\n`, "utf8");
}

export async function readEvents(logPath, sessionId = null) {
  try {
    const raw = await fs.readFile(logPath, "utf8");
    const events = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return sessionId ? events.filter((event) => event.sessionId === sessionId) : events;
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export function filterEvents(events, filters = {}) {
  const limit = filters.limit ? Number.parseInt(filters.limit, 10) : null;
  let filtered = events;

  if (filters.session) {
    filtered = filtered.filter((event) => event.sessionId === filters.session);
  }
  if (filters.run) {
    filtered = filtered.filter((event) => event.runId === filters.run);
  }
  if (filters.type) {
    filtered = filtered.filter((event) => event.type === filters.type);
  }
  if (filters.since) {
    filtered = filtered.filter((event) => event.timestamp >= filters.since);
  }

  if (limit && Number.isFinite(limit) && limit > 0) {
    filtered = filtered.slice(-limit);
  }

  return filtered;
}

export async function getLogSize(logPath) {
  try {
    const stats = await fs.stat(logPath);
    return stats.size;
  } catch (error) {
    if (error.code === "ENOENT") {
      return 0;
    }
    throw error;
  }
}

export async function readEventsFromOffset(logPath, offset) {
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
      .map((line) => JSON.parse(line));
    return { nextOffset: stats.size, events };
  } finally {
    await handle.close();
  }
}

export function formatEventLine(event) {
  const parts = [
    event.timestamp,
    event.type,
    `session=${event.sessionId}`,
    `run=${event.runId}`
  ];
  if (event.projectId) {
    parts.push(`project=${event.projectId}`);
  }
  return parts.join(" ");
}
