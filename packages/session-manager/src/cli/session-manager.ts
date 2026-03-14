#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { transitionSessionState } from "../control/session-actions.js";
import {
  appendEvent,
  filterEvents,
  formatEventLine,
  getLogSize,
  readEvents,
  readEventsFromOffset,
} from "../events/event-log.js";
import {
  createLifecycleEvent,
  createSessionRecordFromPlan,
  transitionSessionRecord,
} from "../lifecycle/session-lifecycle.js";
import {
  DEFAULT_EVENT_LOG_PATH,
  DEFAULT_SESSION_DB_PATH,
  PROJECT_ROOT,
} from "../metadata/constants.js";
import {
  ensureParentDirectory,
  getSession,
  listSessions,
  openSessionDatabase,
  upsertSessionInTransaction,
  upsertSession,
} from "../store/session-store.js";
import {
  buildSessionArtifactRecoveryTelemetry,
  isSessionReconcileCandidateState,
  reconcileSessionFromArtifacts,
} from "../reconcile/session-reconcile.js";
import type {
  ParsedArgs,
  SessionEvent,
  SessionPlan,
  SessionRecord,
  SessionSummary,
} from "../types.js";

type CliFlags = Record<string, string | boolean | undefined>;

interface PendingSession {
  sessionId: string;
  state: string;
  reason: string;
  ageMs?: number;
}

interface ReconciledSession {
  session: SessionRecord;
  event: SessionEvent;
}

interface ReconcileResult {
  ok: true;
  scannedCount: number;
  pendingCount: number;
  reconciledCount: number;
  reconciled: ReconciledSession[];
  pending: PendingSession[];
}

function parseArgs(argv: string[]): ParsedArgs<CliFlags> {
  const positional: string[] = [];
  const flags: CliFlags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    index += 1;
  }
  return { positional, flags };
}

function asString(
  value: string | boolean | null | undefined,
): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function resolvePath(
  filePath: string | boolean | null | undefined,
  fallback: string | null,
): string {
  const target = asString(filePath) ?? fallback;
  if (!target) {
    throw new Error("path is required");
  }
  return path.isAbsolute(target) ? target : path.join(PROJECT_ROOT, target);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function matchesFilters(
  session: SessionRecord | SessionSummary,
  filters: CliFlags,
): boolean {
  const sessionFilter = asString(filters.session);
  const runFilter = asString(filters.run);
  const stateFilter = asString(filters.state);
  if (sessionFilter && session.id !== sessionFilter) {
    return false;
  }
  if (runFilter && session.runId !== runFilter) {
    return false;
  }
  if (stateFilter && session.state !== stateFilter) {
    return false;
  }
  return true;
}

function parseTimestamp(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : 0;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function tmuxSessionExists(sessionName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("tmux", ["has-session", "-t", sessionName], {
      stdio: "ignore",
    });
    child.once("error", () => resolve(false));
    child.once("exit", (code) => resolve(code === 0));
  });
}

async function loadPlan(planPath: string): Promise<SessionPlan> {
  const resolved = resolvePath(planPath, null);
  const raw = await fs.readFile(resolved, "utf8");
  return JSON.parse(raw) as SessionPlan;
}

async function readRuntimeStatusHeartbeat(
  session: SessionRecord,
): Promise<{ heartbeatAt: string | null; terminalSettled: boolean }> {
  const runtimeStatusPath = session.runtimeStatusPath
    ? resolvePath(session.runtimeStatusPath, session.runtimeStatusPath)
    : null;
  if (!runtimeStatusPath) {
    return { heartbeatAt: null, terminalSettled: false };
  }
  try {
    const raw = await fs.readFile(runtimeStatusPath, "utf8");
    const parsed = JSON.parse(raw) as {
      heartbeatAt?: string | null;
      terminalSignal?: { settled?: boolean } | null;
    };
    return {
      heartbeatAt: parsed.heartbeatAt ?? null,
      terminalSettled: Boolean(parsed.terminalSignal?.settled),
    };
  } catch (error) {
    const typed = error as NodeJS.ErrnoException;
    if (typed.code === "ENOENT") {
      return { heartbeatAt: null, terminalSettled: false };
    }
    throw typed;
  }
}

async function createFromPlan(flags: CliFlags): Promise<void> {
  const planPath = asString(flags.plan);
  if (!planPath) {
    throw new Error("use --plan <path-to-plan.json>");
  }
  const dbPath = resolvePath(flags.db, DEFAULT_SESSION_DB_PATH);
  const eventLogPath = resolvePath(flags.events, DEFAULT_EVENT_LOG_PATH);
  await ensureParentDirectory(dbPath);
  const plan = await loadPlan(planPath);
  const db = openSessionDatabase(dbPath);
  try {
    const record = createSessionRecordFromPlan(plan, {
      state: (asString(flags.state) ?? "planned") as SessionRecord["state"],
      contextPath: asString(flags.context) ?? null,
      domainId: asString(flags.domain) ?? null,
      workflowId: asString(flags.workflow) ?? null,
      parentSessionId: asString(flags.parent) ?? null,
      launcherType: asString(flags.launcher) ?? null,
      launchCommand: asString(flags.command) ?? null,
      tmuxSession: asString(flags.tmux) ?? null,
      runtimeInstanceId: asString(flags["runtime-instance"]) ?? null,
      runtimeCapabilities: asString(flags["runtime-capabilities-json"])
        ? (JSON.parse(String(flags["runtime-capabilities-json"])) as Record<string, boolean>)
        : null,
      runtimeStatusPath: asString(flags["runtime-status"]) ?? null,
      runtimeEventsPath: asString(flags["runtime-events"]) ?? null,
    });
    upsertSession(db, record);
    const event = createLifecycleEvent(record, "session.planned", {
      source: "session-manager",
      planPath,
    });
    await appendEvent(eventLogPath, event);
    console.log(JSON.stringify({ ok: true, session: record, event }, null, 2));
  } finally {
    db.close();
  }
}

async function transition(flags: CliFlags): Promise<void> {
  const sessionId = asString(flags.session);
  const nextState = asString(flags.state);
  if (!sessionId || !nextState) {
    throw new Error(
      "use --session <id> --state <planned|starting|active|completed|failed|stopped>",
    );
  }
  const result = await transitionSessionState({
    dbPath: asString(flags.db) ?? DEFAULT_SESSION_DB_PATH,
    eventLogPath: asString(flags.events) ?? DEFAULT_EVENT_LOG_PATH,
    sessionId,
    nextState,
    overrides: {
      transcriptPath: asString(flags.transcript) ?? null,
      contextPath: asString(flags.context) ?? null,
      launcherType: asString(flags.launcher) ?? null,
      launchCommand: asString(flags.command) ?? null,
      tmuxSession: asString(flags.tmux) ?? null,
      runtimeInstanceId: asString(flags["runtime-instance"]) ?? null,
      runtimeCapabilities: asString(flags["runtime-capabilities-json"])
        ? (JSON.parse(String(flags["runtime-capabilities-json"])) as Record<string, boolean>)
        : null,
      runtimeStatusPath: asString(flags["runtime-status"]) ?? null,
      runtimeEventsPath: asString(flags["runtime-events"]) ?? null,
    },
    payload: {
      source: "session-manager",
      transcriptPath: asString(flags.transcript) ?? null,
    },
  });
  console.log(
    JSON.stringify(
      { ok: true, session: result.session, event: result.event },
      null,
      2,
    ),
  );
}

async function show(flags: CliFlags): Promise<void> {
  const sessionId = asString(flags.session);
  if (!sessionId) {
    throw new Error("use --session <id>");
  }
  const dbPath = resolvePath(flags.db, DEFAULT_SESSION_DB_PATH);
  const eventLogPath = resolvePath(flags.events, DEFAULT_EVENT_LOG_PATH);
  const db = openSessionDatabase(dbPath);
  try {
    const session = getSession(db, sessionId);
    const events = await readEvents(eventLogPath, sessionId);
    console.log(JSON.stringify({ session, events }, null, 2));
  } finally {
    db.close();
  }
}

async function list(flags: CliFlags): Promise<void> {
  const dbPath = resolvePath(flags.db, DEFAULT_SESSION_DB_PATH);
  const db = openSessionDatabase(dbPath);
  try {
    console.log(JSON.stringify({ sessions: listSessions(db) }, null, 2));
  } finally {
    db.close();
  }
}

async function events(flags: CliFlags): Promise<void> {
  const eventLogPath = resolvePath(flags.events, DEFAULT_EVENT_LOG_PATH);
  const items = filterEvents(await readEvents(eventLogPath), flags);
  if (flags.follow) {
    for (const event of items) {
      console.log(
        flags.pretty ? formatEventLine(event) : JSON.stringify(event),
      );
    }
    let offset = await getLogSize(eventLogPath);
    const interval = Number.parseInt(asString(flags.interval) ?? "1000", 10);
    const timer = setInterval(async () => {
      try {
        const chunk = await readEventsFromOffset(eventLogPath, offset);
        offset = chunk.nextOffset;
        for (const event of filterEvents(chunk.events, flags)) {
          console.log(
            flags.pretty ? formatEventLine(event) : JSON.stringify(event),
          );
        }
      } catch (error: unknown) {
        console.error(`session-manager feed error: ${getErrorMessage(error)}`);
      }
    }, interval);
    process.on("SIGINT", () => {
      clearInterval(timer);
      process.exit(0);
    });
    return;
  }

  if (flags.pretty) {
    for (const event of items) {
      console.log(formatEventLine(event));
    }
    return;
  }
  console.log(JSON.stringify({ events: items }, null, 2));
}

async function status(flags: CliFlags): Promise<void> {
  const dbPath = resolvePath(flags.db, DEFAULT_SESSION_DB_PATH);
  const eventLogPath = resolvePath(flags.events, DEFAULT_EVENT_LOG_PATH);
  const db = openSessionDatabase(dbPath);
  try {
    const sessions = listSessions(db);
    const events = await readEvents(eventLogPath);
    const byState = sessions.reduce<Record<string, number>>(
      (accumulator, session) => {
        accumulator[session.state] = (accumulator[session.state] ?? 0) + 1;
        return accumulator;
      },
      {},
    );
    console.log(
      JSON.stringify(
        {
          sessionCount: sessions.length,
          eventCount: events.length,
          byState,
          activeSessions: sessions.filter(
            (session) => session.state === "active",
          ),
        },
        null,
        2,
      ),
    );
  } finally {
    db.close();
  }
}

async function reconcileOnce(flags: CliFlags): Promise<ReconcileResult> {
  const dbPath = resolvePath(flags.db, DEFAULT_SESSION_DB_PATH);
  const eventLogPath = resolvePath(flags.events, DEFAULT_EVENT_LOG_PATH);
  const graceMs = Number.parseInt(asString(flags["grace-ms"]) ?? "5000", 10);
  const db = openSessionDatabase(dbPath);
  try {
    const sessions = listSessions(db).filter(
      (session) =>
        ["planned", "starting", "active"].includes(session.state) &&
        matchesFilters(session, flags),
    );
    const reconciled: ReconciledSession[] = [];
    const pending: PendingSession[] = [];

    for (const summary of sessions) {
      const session = getSession(db, summary.id);
      if (!session) {
        continue;
      }
      const artifactReconcile = await reconcileSessionFromArtifacts({
        dbPath,
        sessionId: session.id,
      });
      const currentSession = artifactReconcile.session ?? getSession(db, session.id);

      if (currentSession && artifactReconcile.reconciled && artifactReconcile.signal) {
        const artifactRecovery = buildSessionArtifactRecoveryTelemetry(
          artifactReconcile.signal,
        );
        const event = createLifecycleEvent(
          currentSession,
          `session.${currentSession.state}`,
          {
            source: "session-manager.reconcile",
            reason: artifactRecovery.signalSource,
            signalSource: artifactRecovery.signalSource,
            terminalSignalSource: artifactRecovery.terminalSignalSource,
            fallbackReason: artifactRecovery.fallbackReason,
            artifactRecoveryCount: artifactRecovery.artifactRecoveryCount,
            artifactRecovery,
            exitCode: artifactRecovery.exitCode,
            artifactPath: artifactRecovery.artifactPath,
            transcriptPath: currentSession.transcriptPath ?? null,
          },
        );
        await appendEvent(eventLogPath, event);
        reconciled.push({ session: currentSession, event });
        continue;
      }

      if (!currentSession || !isSessionReconcileCandidateState(currentSession.state)) {
        continue;
      }

      const hasTmux = currentSession.tmuxSession
        ? await tmuxSessionExists(currentSession.tmuxSession)
        : false;
      const runtimeHeartbeat = await readRuntimeStatusHeartbeat(currentSession);
      if (hasTmux) {
        pending.push({
          sessionId: currentSession.id,
          state: currentSession.state,
          reason: "tmux-active",
        });
        continue;
      }
      if (
        !hasTmux &&
        runtimeHeartbeat.heartbeatAt &&
        !runtimeHeartbeat.terminalSettled
      ) {
        const ageMs = Date.now() - parseTimestamp(runtimeHeartbeat.heartbeatAt);
        if (ageMs < graceMs) {
          pending.push({
            sessionId: currentSession.id,
            state: currentSession.state,
            reason: "runtime-heartbeat-active",
            ageMs,
          });
          continue;
        }
      }
      if (!hasTmux) {
        const ageMs =
          Date.now() -
          Math.max(
            parseTimestamp(currentSession.updatedAt),
            parseTimestamp(currentSession.createdAt),
          );
        if (ageMs < graceMs) {
          pending.push({
            sessionId: currentSession.id,
            state: currentSession.state,
            reason: "waiting-for-exit-file",
            ageMs,
          });
          continue;
        }

        let updated = currentSession;
        db.exec("BEGIN IMMEDIATE");
        try {
          const latest = getSession(db, currentSession.id);
          if (!latest || !isSessionReconcileCandidateState(latest.state)) {
            db.exec("COMMIT");
            continue;
          }
          updated = transitionSessionRecord(latest, "failed");
          upsertSessionInTransaction(db, updated);
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        const event = createLifecycleEvent(updated, "session.failed", {
          source: "session-manager.reconcile",
          reason: "tmux-missing-no-exit-file",
          graceMs,
          transcriptPath: updated.transcriptPath ?? null,
        });
        await appendEvent(eventLogPath, event);
        reconciled.push({ session: updated, event });
        continue;
      }
    }

    return {
      ok: true,
      scannedCount: sessions.length,
      pendingCount: pending.length,
      reconciledCount: reconciled.length,
      reconciled,
      pending,
    };
  } finally {
    db.close();
  }
}

async function reconcile(flags: CliFlags): Promise<void> {
  const runPass = async (): Promise<ReconcileResult> => {
    const result = await reconcileOnce(flags);
    if (flags.pretty) {
      const lines = [
        `scanned=${result.scannedCount}`,
        `pending=${result.pendingCount}`,
        `reconciled=${result.reconciledCount}`,
      ];
      console.log(`[reconcile] ${lines.join(" ")}`);
      for (const item of result.reconciled) {
        console.log(
          `[reconcile] session=${item.session.id} state=${item.session.state} event=${item.event.type}`,
        );
      }
    } else if (!flags.watch || result.reconciledCount > 0 || flags.verbose) {
      console.log(JSON.stringify(result, null, 2));
    }
    return result;
  };

  const first = await runPass();
  if (!flags.watch) {
    return;
  }

  const interval = Number.parseInt(asString(flags.interval) ?? "1000", 10);
  if (flags["stop-on-settled"] && first.pendingCount === 0) {
    return;
  }

  let stopped = false;
  process.on("SIGINT", () => {
    stopped = true;
    process.exit(0);
  });

  while (!stopped) {
    await sleep(interval);
    const result = await runPass();
    if (flags["stop-on-settled"] && result.pendingCount === 0) {
      return;
    }
  }
}

async function main(): Promise<void> {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const command = positional[0];
  if (command === "create-from-plan") {
    await createFromPlan(flags);
    return;
  }
  if (command === "transition") {
    await transition(flags);
    return;
  }
  if (command === "show") {
    await show(flags);
    return;
  }
  if (command === "list") {
    await list(flags);
    return;
  }
  if (command === "events") {
    await events(flags);
    return;
  }
  if (command === "feed") {
    await events({ ...flags, follow: true });
    return;
  }
  if (command === "status") {
    await status(flags);
    return;
  }
  if (command === "reconcile") {
    await reconcile(flags);
    return;
  }
  throw new Error(
    "commands: create-from-plan | transition | show | list | events | feed | status | reconcile",
  );
}

main().catch((error: unknown) => {
  console.error(`session-manager error: ${getErrorMessage(error)}`);
  process.exitCode = 1;
});
