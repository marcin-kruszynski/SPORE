import path from "node:path";

import { appendEvent } from "../events/event-log.js";
import { createSessionEvent, transitionSessionRecord } from "../lifecycle/session-lifecycle.js";
import { DEFAULT_EVENT_LOG_PATH, DEFAULT_SESSION_DB_PATH, PROJECT_ROOT } from "../metadata/constants.js";
import { getSession, openSessionDatabase, upsertSession } from "../store/session-store.js";

function resolvePath(filePath, fallback) {
  const target = filePath ?? fallback;
  return path.isAbsolute(target) ? target : path.join(PROJECT_ROOT, target);
}

function applyOverrides(session, overrides = {}) {
  return {
    ...session,
    transcriptPath: overrides.transcriptPath ?? session.transcriptPath,
    contextPath: overrides.contextPath ?? session.contextPath,
    launcherType: overrides.launcherType ?? session.launcherType,
    launchCommand: overrides.launchCommand ?? session.launchCommand,
    tmuxSession: overrides.tmuxSession ?? session.tmuxSession
  };
}

export async function appendSessionEventRecord({
  dbPath = DEFAULT_SESSION_DB_PATH,
  eventLogPath = DEFAULT_EVENT_LOG_PATH,
  sessionId,
  type,
  payload = {}
}) {
  const resolvedDbPath = resolvePath(dbPath, DEFAULT_SESSION_DB_PATH);
  const resolvedEventLogPath = resolvePath(eventLogPath, DEFAULT_EVENT_LOG_PATH);
  const db = openSessionDatabase(resolvedDbPath);
  try {
    const session = getSession(db, sessionId);
    if (!session) {
      throw new Error(`session not found: ${sessionId}`);
    }
    const event = createSessionEvent(session, type, payload);
    await appendEvent(resolvedEventLogPath, event);
    return { session, event };
  } finally {
    db.close();
  }
}

export async function transitionSessionState({
  dbPath = DEFAULT_SESSION_DB_PATH,
  eventLogPath = DEFAULT_EVENT_LOG_PATH,
  sessionId,
  nextState,
  overrides = {},
  payload = {}
}) {
  const resolvedDbPath = resolvePath(dbPath, DEFAULT_SESSION_DB_PATH);
  const resolvedEventLogPath = resolvePath(eventLogPath, DEFAULT_EVENT_LOG_PATH);
  const db = openSessionDatabase(resolvedDbPath);
  try {
    const current = getSession(db, sessionId);
    if (!current) {
      throw new Error(`session not found: ${sessionId}`);
    }
    const updated = transitionSessionRecord(applyOverrides(current, overrides), nextState);
    upsertSession(db, updated);
    const event = createSessionEvent(updated, `session.${nextState}`, payload);
    await appendEvent(resolvedEventLogPath, event);
    return {
      previousSession: current,
      session: updated,
      event
    };
  } finally {
    db.close();
  }
}
