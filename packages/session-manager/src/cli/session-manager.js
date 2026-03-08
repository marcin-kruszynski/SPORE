#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

import {
  createLifecycleEvent,
  createSessionRecordFromPlan,
  transitionSessionRecord
} from "../lifecycle/session-lifecycle.js";
import { DEFAULT_EVENT_LOG_PATH, DEFAULT_SESSION_DB_PATH, PROJECT_ROOT } from "../metadata/constants.js";
import {
  appendEvent,
  filterEvents,
  formatEventLine,
  getLogSize,
  readEvents,
  readEventsFromOffset
} from "../events/event-log.js";
import {
  ensureParentDirectory,
  getSession,
  listSessions,
  openSessionDatabase,
  upsertSession
} from "../store/session-store.js";
import { transitionSessionState } from "../control/session-actions.js";
import { tmuxSessionExists } from "../../../runtime-pi/src/launchers/tmux-launcher.js";

function parseArgs(argv) {
  const positional = [];
  const flags = {};
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

function resolvePath(filePath, fallback) {
  const target = filePath ?? fallback;
  return path.isAbsolute(target) ? target : path.join(PROJECT_ROOT, target);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function matchesFilters(session, filters) {
  if (filters.session && session.id !== filters.session) {
    return false;
  }
  if (filters.run && session.runId !== filters.run) {
    return false;
  }
  if (filters.state && session.state !== filters.state) {
    return false;
  }
  return true;
}

function isSettled(session) {
  return ["completed", "failed", "stopped", "canceled"].includes(session.state);
}

function parseTimestamp(value) {
  if (!value) {
    return 0;
  }
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : 0;
}

async function loadPlan(planPath) {
  const resolved = resolvePath(planPath, null);
  const raw = await fs.readFile(resolved, "utf8");
  return JSON.parse(raw);
}

async function createFromPlan(flags) {
  if (!flags.plan) {
    throw new Error("use --plan <path-to-plan.json>");
  }
  const dbPath = resolvePath(flags.db, DEFAULT_SESSION_DB_PATH);
  const eventLogPath = resolvePath(flags.events, DEFAULT_EVENT_LOG_PATH);
  await ensureParentDirectory(dbPath);
  const plan = await loadPlan(flags.plan);
  const db = openSessionDatabase(dbPath);
  try {
    const record = createSessionRecordFromPlan(plan, {
      state: flags.state ?? "planned",
      contextPath: flags.context ?? null,
      domainId: flags.domain ?? null,
      workflowId: flags.workflow ?? null,
      parentSessionId: flags.parent ?? null,
      launcherType: flags.launcher ?? null,
      launchCommand: flags.command ?? null,
      tmuxSession: flags.tmux ?? null
    });
    upsertSession(db, record);
    const event = createLifecycleEvent(record, "session.planned", {
      source: "session-manager",
      planPath: flags.plan
    });
    await appendEvent(eventLogPath, event);
    console.log(JSON.stringify({ ok: true, session: record, event }, null, 2));
  } finally {
    db.close();
  }
}

async function transition(flags) {
  if (!flags.session || !flags.state) {
    throw new Error("use --session <id> --state <planned|starting|active|completed|failed|stopped>");
  }
  const result = await transitionSessionState({
    dbPath: flags.db ?? DEFAULT_SESSION_DB_PATH,
    eventLogPath: flags.events ?? DEFAULT_EVENT_LOG_PATH,
    sessionId: flags.session,
    nextState: flags.state,
    overrides: {
      transcriptPath: flags.transcript ?? null,
      contextPath: flags.context ?? null,
      launcherType: flags.launcher ?? null,
      launchCommand: flags.command ?? null,
      tmuxSession: flags.tmux ?? null
    },
    payload: {
      source: "session-manager",
      transcriptPath: flags.transcript ?? null
    }
  });
  console.log(JSON.stringify({ ok: true, session: result.session, event: result.event }, null, 2));
}

async function show(flags) {
  if (!flags.session) {
    throw new Error("use --session <id>");
  }
  const dbPath = resolvePath(flags.db, DEFAULT_SESSION_DB_PATH);
  const eventLogPath = resolvePath(flags.events, DEFAULT_EVENT_LOG_PATH);
  const db = openSessionDatabase(dbPath);
  try {
    const session = getSession(db, flags.session);
    const events = await readEvents(eventLogPath, flags.session);
    console.log(JSON.stringify({ session, events }, null, 2));
  } finally {
    db.close();
  }
}

async function list(flags) {
  const dbPath = resolvePath(flags.db, DEFAULT_SESSION_DB_PATH);
  const db = openSessionDatabase(dbPath);
  try {
    console.log(JSON.stringify({ sessions: listSessions(db) }, null, 2));
  } finally {
    db.close();
  }
}

async function events(flags) {
  const eventLogPath = resolvePath(flags.events, DEFAULT_EVENT_LOG_PATH);
  const items = filterEvents(await readEvents(eventLogPath), flags);
  if (flags.follow) {
    for (const event of items) {
      console.log(flags.pretty ? formatEventLine(event) : JSON.stringify(event));
    }
    let offset = await getLogSize(eventLogPath);
    const interval = Number.parseInt(flags.interval ?? "1000", 10);
    const timer = setInterval(async () => {
      try {
        const chunk = await readEventsFromOffset(eventLogPath, offset);
        offset = chunk.nextOffset;
        for (const event of filterEvents(chunk.events, flags)) {
          console.log(flags.pretty ? formatEventLine(event) : JSON.stringify(event));
        }
      } catch (error) {
        console.error(`session-manager feed error: ${error.message}`);
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

async function status(flags) {
  const dbPath = resolvePath(flags.db, DEFAULT_SESSION_DB_PATH);
  const eventLogPath = resolvePath(flags.events, DEFAULT_EVENT_LOG_PATH);
  const db = openSessionDatabase(dbPath);
  try {
    const sessions = listSessions(db);
    const events = await readEvents(eventLogPath);
    const byState = sessions.reduce((accumulator, session) => {
      accumulator[session.state] = (accumulator[session.state] ?? 0) + 1;
      return accumulator;
    }, {});
    console.log(
      JSON.stringify(
        {
          sessionCount: sessions.length,
          eventCount: events.length,
          byState,
          activeSessions: sessions.filter((session) => session.state === "active")
        },
        null,
        2
      )
    );
  } finally {
    db.close();
  }
}

function deriveExitPath(session) {
  if (!session.launchCommand) {
    return null;
  }
  if (session.launchCommand.endsWith(".launch.sh")) {
    return session.launchCommand.replace(/\.launch\.sh$/, ".exit.json");
  }
  return null;
}

async function reconcileOnce(flags) {
  const dbPath = resolvePath(flags.db, DEFAULT_SESSION_DB_PATH);
  const eventLogPath = resolvePath(flags.events, DEFAULT_EVENT_LOG_PATH);
  const graceMs = Number.parseInt(flags["grace-ms"] ?? "5000", 10);
  const db = openSessionDatabase(dbPath);
  try {
    const sessions = listSessions(db).filter(
      (session) =>
        ["planned", "starting", "active"].includes(session.state) &&
        matchesFilters(session, flags)
    );
    const reconciled = [];
    const pending = [];

    for (const summary of sessions) {
      const session = getSession(db, summary.id);
      if (!session) {
        continue;
      }
      const exitPath = deriveExitPath(session);
      let exitInfo = null;
      if (exitPath) {
        try {
          exitInfo = JSON.parse(
            await fs.readFile(resolvePath(exitPath, exitPath), "utf8")
          );
        } catch (error) {
          if (error.code !== "ENOENT") {
            throw error;
          }
        }
      }

      const hasTmux = session.tmuxSession ? await tmuxSessionExists(session.tmuxSession) : false;
      if (!exitInfo && hasTmux) {
        pending.push({
          sessionId: session.id,
          state: session.state,
          reason: "tmux-active"
        });
        continue;
      }
      if (!exitInfo && !hasTmux) {
        const ageMs = Date.now() - Math.max(parseTimestamp(session.updatedAt), parseTimestamp(session.createdAt));
        if (ageMs < graceMs) {
          pending.push({
            sessionId: session.id,
            state: session.state,
            reason: "waiting-for-exit-file",
            ageMs
          });
          continue;
        }

        const updated = transitionSessionRecord(session, "failed");
        upsertSession(db, updated);
        const event = createLifecycleEvent(updated, "session.failed", {
          source: "session-manager.reconcile",
          reason: "tmux-missing-no-exit-file",
          graceMs,
          transcriptPath: updated.transcriptPath ?? null
        });
        await appendEvent(eventLogPath, event);
        reconciled.push({ session: updated, event });
        continue;
      }

      const nextState = exitInfo?.exitCode === 0 ? "completed" : "failed";
      const updated = transitionSessionRecord(session, nextState);
      upsertSession(db, updated);
      const event = createLifecycleEvent(updated, `session.${nextState}`, {
        source: "session-manager.reconcile",
        reason: "exit-file",
        exitCode: exitInfo?.exitCode ?? null,
        transcriptPath: updated.transcriptPath ?? null
      });
      await appendEvent(eventLogPath, event);
      reconciled.push({ session: updated, event });
    }

    return {
      ok: true,
      scannedCount: sessions.length,
      pendingCount: pending.length,
      reconciledCount: reconciled.length,
      reconciled,
      pending
    };
  } finally {
    db.close();
  }
}

async function reconcile(flags) {
  const runPass = async () => {
    const result = await reconcileOnce(flags);
    if (flags.pretty) {
      const lines = [
        `scanned=${result.scannedCount}`,
        `pending=${result.pendingCount}`,
        `reconciled=${result.reconciledCount}`
      ];
      console.log(`[reconcile] ${lines.join(" ")}`);
      for (const item of result.reconciled) {
        console.log(
          `[reconcile] session=${item.session.id} state=${item.session.state} event=${item.event.type}`
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

  const interval = Number.parseInt(flags.interval ?? "1000", 10);
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

async function main() {
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
  throw new Error("commands: create-from-plan | transition | show | list | events | feed | status | reconcile");
}

main().catch((error) => {
  console.error(`session-manager error: ${error.message}`);
  process.exitCode = 1;
});
