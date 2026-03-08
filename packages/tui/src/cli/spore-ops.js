#!/usr/bin/env node
import path from "node:path";

import { DEFAULT_EVENT_LOG_PATH, DEFAULT_SESSION_DB_PATH, PROJECT_ROOT } from "../../../session-manager/src/metadata/constants.js";
import { filterEvents, readEvents } from "../../../session-manager/src/events/event-log.js";
import {
  getSession,
  listSessions,
  openSessionDatabase
} from "../../../session-manager/src/store/session-store.js";
import { captureTmuxPane, tmuxSessionExists } from "../../../runtime-pi/src/launchers/tmux-launcher.js";

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

function clearScreen() {
  process.stdout.write("\u001Bc");
}

function renderDashboard({ sessions, events }) {
  const byState = sessions.reduce((accumulator, session) => {
    accumulator[session.state] = (accumulator[session.state] ?? 0) + 1;
    return accumulator;
  }, {});

  const lines = [];
  lines.push("SPORE Operator Dashboard");
  lines.push("");
  lines.push(`Sessions: ${sessions.length}`);
  lines.push(`States: ${JSON.stringify(byState)}`);
  lines.push("");
  lines.push("Active / Recent Sessions:");
  for (const session of sessions.slice(0, 8)) {
    lines.push(
      `- ${session.id} | role=${session.role} | state=${session.state} | run=${session.runId} | tmux=${session.tmuxSession ?? "-"}`
    );
  }
  lines.push("");
  lines.push("Recent Events:");
  for (const event of events.slice(-10)) {
    lines.push(
      `- ${event.timestamp} | ${event.type} | session=${event.sessionId} | run=${event.runId}`
    );
  }
  return `${lines.join("\n")}\n`;
}

async function readSnapshot(flags) {
  const dbPath = resolvePath(flags.db, DEFAULT_SESSION_DB_PATH);
  const eventLogPath = resolvePath(flags.events, DEFAULT_EVENT_LOG_PATH);
  const db = openSessionDatabase(dbPath);
  try {
    const sessions = listSessions(db);
    const events = filterEvents(await readEvents(eventLogPath), {
      limit: flags.limit ?? "20"
    });
    return { sessions, events };
  } finally {
    db.close();
  }
}

async function dashboard(flags) {
  const render = async () => {
    const snapshot = await readSnapshot(flags);
    clearScreen();
    process.stdout.write(renderDashboard(snapshot));
  };

  await render();
  if (!flags.watch) {
    return;
  }

  const interval = Number.parseInt(flags.interval ?? "1000", 10);
  const timer = setInterval(() => {
    render().catch((error) => {
      process.stderr.write(`spore-ops error: ${error.message}\n`);
    });
  }, interval);
  process.on("SIGINT", () => {
    clearInterval(timer);
    process.exit(0);
  });
}

async function inspect(flags) {
  if (!flags.session) {
    throw new Error("use --session <id>");
  }
  const dbPath = resolvePath(flags.db, DEFAULT_SESSION_DB_PATH);
  const eventLogPath = resolvePath(flags.events, DEFAULT_EVENT_LOG_PATH);
  const db = openSessionDatabase(dbPath);
  try {
    const session = getSession(db, flags.session);
    const events = filterEvents(await readEvents(eventLogPath), {
      session: flags.session,
      limit: flags.limit ?? "20"
    });
    let pane = null;
    if (session?.tmuxSession && (await tmuxSessionExists(session.tmuxSession))) {
      pane = await captureTmuxPane(
        session.tmuxSession,
        Number.parseInt(flags.lines ?? "80", 10)
      );
    }
    console.log(
      JSON.stringify(
        {
          session,
          events,
          pane
        },
        null,
        2
      )
    );
  } finally {
    db.close();
  }
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const command = positional[0];
  if (command === "dashboard") {
    await dashboard(flags);
    return;
  }
  if (command === "inspect") {
    await inspect(flags);
    return;
  }
  throw new Error("commands: dashboard | inspect");
}

main().catch((error) => {
  console.error(`spore-ops error: ${error.message}`);
  process.exitCode = 1;
});
