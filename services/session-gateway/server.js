#!/usr/bin/env node
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { URL } from "node:url";

import {
  appendSessionEventRecord,
  transitionSessionState
} from "../../packages/session-manager/src/control/session-actions.js";
import { DEFAULT_EVENT_LOG_PATH, DEFAULT_SESSION_DB_PATH, PROJECT_ROOT } from "../../packages/session-manager/src/metadata/constants.js";
import {
  filterEvents,
  getLogSize,
  readEvents,
  readEventsFromOffset
} from "../../packages/session-manager/src/events/event-log.js";
import {
  getSession,
  listSessions,
  openSessionDatabase
} from "../../packages/session-manager/src/store/session-store.js";
import {
  sendTmuxText,
  stopTmuxSession,
  tmuxSessionExists
} from "../../packages/runtime-pi/src/launchers/tmux-launcher.js";
import { appendControlMessage } from "../../packages/runtime-pi/src/control/session-control-queue.js";

function resolvePath(filePath, fallback) {
  const target = filePath ?? fallback;
  return path.isAbsolute(target) ? target : path.join(PROJECT_ROOT, target);
}

function json(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function text(response, statusCode, body, contentType = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, {
    "content-type": contentType
  });
  response.end(body);
}

function notFound(response, pathname) {
  json(response, 404, {
    ok: false,
    error: "not_found",
    pathname
  });
}

function badRequest(response, message) {
  json(response, 400, {
    ok: false,
    error: "bad_request",
    message
  });
}

function conflict(response, message, payload = {}) {
  json(response, 409, {
    ok: false,
    error: "conflict",
    message,
    ...payload
  });
}

function withDatabase(dbPath, fn) {
  const db = openSessionDatabase(dbPath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function buildStatus(sessions, events) {
  const byState = sessions.reduce((accumulator, session) => {
    accumulator[session.state] = (accumulator[session.state] ?? 0) + 1;
    return accumulator;
  }, {});
  return {
    sessionCount: sessions.length,
    eventCount: events.length,
    byState,
    activeSessions: sessions.filter((session) => session.state === "active")
  };
}

function isSettled(session) {
  return ["completed", "failed", "stopped", "canceled"].includes(session.state);
}

function deriveExitPath(session) {
  if (!session.launchCommand) {
    return null;
  }
  if (session.launchCommand.endsWith(".launch.sh")) {
    return resolvePath(session.launchCommand.replace(/\.launch\.sh$/, ".exit.json"));
  }
  return null;
}

async function writeSyntheticExitFile(session, exitCode, reason) {
  const exitPath = deriveExitPath(session);
  if (!exitPath) {
    return null;
  }
  try {
    await fs.access(exitPath);
    return path.relative(PROJECT_ROOT, exitPath);
  } catch {
    await fs.mkdir(path.dirname(exitPath), { recursive: true });
    await fs.writeFile(
      exitPath,
      `${JSON.stringify({ exitCode, source: "session-gateway", reason }, null, 2)}\n`,
      "utf8"
    );
    return path.relative(PROJECT_ROOT, exitPath);
  }
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) {
      throw new Error("request body too large");
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

function supportsRpcControl(session) {
  return session.launcherType === "pi-rpc";
}

function getArtifactMap(session) {
  const base = path.join(PROJECT_ROOT, "tmp", "sessions", session.id);
  return {
    plan: `${base}.plan.json`,
    context: `${base}.context.json`,
    prompt: `${base}.prompt.md`,
    launch: `${base}.launch.sh`,
    transcript: `${base}.transcript.md`,
    piEvents: `${base}.pi-events.jsonl`,
    piSession: `${base}.pi-session.jsonl`,
    stderr: `${base}.stderr.log`,
    control: `${base}.control.ndjson`,
    exit: `${base}.exit.json`,
    rpcStatus: `${base}.rpc-status.json`
  };
}

async function describeArtifact(name, filePath) {
  try {
    const stats = await fs.stat(filePath);
    return {
      name,
      path: path.relative(PROJECT_ROOT, filePath),
      exists: true,
      size: stats.size,
      updatedAt: stats.mtime.toISOString()
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        name,
        path: path.relative(PROJECT_ROOT, filePath),
        exists: false,
        size: 0,
        updatedAt: null
      };
    }
    throw error;
  }
}

async function buildArtifactSummary(session) {
  const artifactMap = getArtifactMap(session);
  const entries = await Promise.all(
    Object.entries(artifactMap).map(([name, filePath]) => describeArtifact(name, filePath))
  );
  return entries.reduce((accumulator, item) => {
    accumulator[item.name] = item;
    return accumulator;
  }, {});
}

async function readArtifactContent(session, artifactName, raw = false) {
  const artifactMap = getArtifactMap(session);
  const targetPath = artifactMap[artifactName];
  if (!targetPath) {
    throw new Error(`unknown artifact: ${artifactName}`);
  }

  const content = await fs.readFile(targetPath, "utf8");
  if (raw) {
    return {
      path: path.relative(PROJECT_ROOT, targetPath),
      content
    };
  }

  if (artifactName.endsWith("Events") || artifactName === "piSession" || artifactName === "control") {
    return {
      path: path.relative(PROJECT_ROOT, targetPath),
      content: content
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    };
  }

  if (artifactName === "plan" || artifactName === "context" || artifactName === "exit" || artifactName === "rpcStatus") {
    return {
      path: path.relative(PROJECT_ROOT, targetPath),
      content: JSON.parse(content)
    };
  }

  return {
    path: path.relative(PROJECT_ROOT, targetPath),
    content
  };
}

async function appendControlAction(session, payload) {
  const controlRecord = await appendControlMessage(session.id, payload);
  return {
    path: path.relative(PROJECT_ROOT, controlRecord.path),
    entry: controlRecord.entry
  };
}

async function handleStopAction({ session, body, dbPath, eventsPath }) {
  if (session.state === "stopped" || isSettled(session)) {
    return {
      ok: true,
      action: "stop",
      noop: true,
      session
    };
  }

  const requestRecord = await appendSessionEventRecord({
    dbPath,
    eventLogPath: eventsPath,
    sessionId: session.id,
    type: "session.stop_requested",
    payload: {
      source: "session-gateway",
      reason: body.reason ?? null,
      force: body.force ?? true,
      controlMode: supportsRpcControl(session) ? "rpc" : "tmux"
    }
  });

  let control = null;
  let tmuxResult = null;

  if (supportsRpcControl(session)) {
    control = await appendControlAction(session, {
      action: "abort",
      source: "session-gateway",
      reason: body.reason ?? null
    });
  } else if (session.tmuxSession) {
    tmuxResult = await stopTmuxSession(session.tmuxSession, {
      force: body.force ?? true,
      timeoutMs: Number.parseInt(String(body.timeoutMs ?? "3000"), 10)
    });
  }

  const transition = await transitionSessionState({
    dbPath,
    eventLogPath: eventsPath,
    sessionId: session.id,
    nextState: "stopped",
    payload: {
      source: "session-gateway",
      requestedEventId: requestRecord.event.id,
      reason: body.reason ?? null,
      tmuxResult,
      control
    }
  });

  const syntheticExitPath = await writeSyntheticExitFile(
    transition.session,
    130,
    body.reason ?? "operator stop"
  );

  return {
    ok: true,
    action: "stop",
    requestEvent: requestRecord.event,
    transition,
    control,
    tmuxResult,
    syntheticExitPath
  };
}

async function handleMarkCompleteAction({ session, body, dbPath, eventsPath }) {
  if (session.state === "completed") {
    return {
      ok: true,
      action: "mark-complete",
      noop: true,
      session
    };
  }

  const requestRecord = await appendSessionEventRecord({
    dbPath,
    eventLogPath: eventsPath,
    sessionId: session.id,
    type: "session.complete_requested",
    payload: {
      source: "session-gateway",
      reason: body.reason ?? null
    }
  });

  const transition = await transitionSessionState({
    dbPath,
    eventLogPath: eventsPath,
    sessionId: session.id,
    nextState: "completed",
    payload: {
      source: "session-gateway",
      requestedEventId: requestRecord.event.id,
      reason: body.reason ?? null
    }
  });

  const syntheticExitPath = await writeSyntheticExitFile(
    transition.session,
    0,
    body.reason ?? "operator mark-complete"
  );

  return {
    ok: true,
    action: "mark-complete",
    requestEvent: requestRecord.event,
    transition,
    syntheticExitPath
  };
}

async function handleSteerAction({ session, body, dbPath, eventsPath }) {
  if (typeof body.message !== "string" || body.message.trim().length === 0) {
    throw new Error("steer action requires a non-empty string field: message");
  }

  const enter = body.enter !== false;
  const control = await appendControlAction(session, {
    action: body.mode === "follow_up" ? "follow_up" : "steer",
    source: "session-gateway",
    message: body.message,
    enter
  });

  let tmuxDelivery = {
    attempted: false,
    delivered: false,
    tmuxSession: session.tmuxSession ?? null,
    mode: supportsRpcControl(session) ? "rpc" : "tmux"
  };
  if (!supportsRpcControl(session) && session.tmuxSession && (await tmuxSessionExists(session.tmuxSession))) {
    await sendTmuxText(session.tmuxSession, body.message, enter);
    tmuxDelivery = {
      attempted: true,
      delivered: true,
      tmuxSession: session.tmuxSession,
      mode: "tmux"
    };
  }

  const eventRecord = await appendSessionEventRecord({
    dbPath,
    eventLogPath: eventsPath,
    sessionId: session.id,
    type: "session.steer",
    payload: {
      source: "session-gateway",
      controlEntryId: control.entry.id,
      controlPath: control.path,
      message: body.message,
      enter,
      deliveryMode: supportsRpcControl(session) ? "rpc" : "tmux",
      tmuxDelivery
    }
  });

  return {
    ok: true,
    action: "steer",
    session: eventRecord.session,
    event: eventRecord.event,
    control,
    tmuxDelivery
  };
}

async function handleActionRequest({ action, session, body, dbPath, eventsPath }) {
  if (action === "stop") {
    return handleStopAction({ session, body, dbPath, eventsPath });
  }
  if (action === "mark-complete") {
    return handleMarkCompleteAction({ session, body, dbPath, eventsPath });
  }
  if (action === "steer") {
    return handleSteerAction({ session, body, dbPath, eventsPath });
  }
  throw new Error(`unknown action: ${action}`);
}

async function handleEventStream(request, response, eventsPath, filters) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive"
  });
  response.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);

  const initial = filterEvents(await readEvents(eventsPath), {
    session: filters.session,
    run: filters.run,
    type: filters.type,
    since: filters.since,
    limit: filters.limit ?? "20"
  });
  for (const event of initial) {
    response.write(`event: session-event\ndata: ${JSON.stringify(event)}\n\n`);
  }

  let offset = await getLogSize(eventsPath);
  const interval = setInterval(async () => {
    try {
      const chunk = await readEventsFromOffset(eventsPath, offset);
      offset = chunk.nextOffset;
      const filtered = filterEvents(chunk.events, filters);
      for (const event of filtered) {
        response.write(`event: session-event\ndata: ${JSON.stringify(event)}\n\n`);
      }
      response.write(`event: heartbeat\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
    } catch (error) {
      response.write(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`);
    }
  }, Number.parseInt(String(filters.interval ?? "1000"), 10));

  request.on("close", () => {
    clearInterval(interval);
    response.end();
  });
}

async function createServer(options = {}) {
  const dbPath = resolvePath(options.db, DEFAULT_SESSION_DB_PATH);
  const eventsPath = resolvePath(options.events, DEFAULT_EVENT_LOG_PATH);

  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host ?? "127.0.0.1"}`);
      const pathname = url.pathname;
      const parts = pathname.split("/").filter(Boolean);

      if (
        request.method === "POST" &&
        parts.length === 4 &&
        parts[0] === "sessions" &&
        parts[2] === "actions"
      ) {
        const sessionId = decodeURIComponent(parts[1]);
        const action = parts[3];
        const session = withDatabase(dbPath, (db) => getSession(db, sessionId));
        if (!session) {
          notFound(response, pathname);
          return;
        }
        let body = {};
        try {
          body = await readJsonBody(request);
        } catch (error) {
          badRequest(response, error.message);
          return;
        }
        try {
          const result = await handleActionRequest({
            action,
            session,
            body,
            dbPath,
            eventsPath
          });
          json(response, 200, result);
        } catch (error) {
          if (error.message.startsWith("unknown action")) {
            notFound(response, pathname);
            return;
          }
          if (error.message.startsWith("steer action requires")) {
            badRequest(response, error.message);
            return;
          }
          if (error.message.includes("session not found")) {
            notFound(response, pathname);
            return;
          }
          conflict(response, error.message, { action, session });
        }
        return;
      }

      if (request.method === "GET" && pathname === "/stream/events") {
        await handleEventStream(request, response, eventsPath, {
          session: url.searchParams.get("session") ?? undefined,
          run: url.searchParams.get("run") ?? undefined,
          type: url.searchParams.get("type") ?? undefined,
          since: url.searchParams.get("since") ?? undefined,
          limit: url.searchParams.get("limit") ?? undefined,
          interval: url.searchParams.get("interval") ?? undefined
        });
        return;
      }

      if (request.method !== "GET") {
        json(response, 405, {
          ok: false,
          error: "method_not_allowed",
          method: request.method
        });
        return;
      }

      if (pathname === "/health") {
        json(response, 200, { ok: true, service: "session-gateway" });
        return;
      }

      if (pathname === "/sessions") {
        const sessions = withDatabase(dbPath, (db) => listSessions(db));
        json(response, 200, { ok: true, sessions });
        return;
      }

      if (parts.length === 3 && parts[0] === "sessions" && parts[2] === "artifacts") {
        const sessionId = decodeURIComponent(parts[1]);
        const session = withDatabase(dbPath, (db) => getSession(db, sessionId));
        if (!session) {
          notFound(response, pathname);
          return;
        }
        const artifacts = await buildArtifactSummary(session);
        json(response, 200, { ok: true, session, artifacts });
        return;
      }

      if (parts.length === 4 && parts[0] === "sessions" && parts[2] === "artifacts") {
        const sessionId = decodeURIComponent(parts[1]);
        const artifactName = parts[3];
        const session = withDatabase(dbPath, (db) => getSession(db, sessionId));
        if (!session) {
          notFound(response, pathname);
          return;
        }
        try {
          const payload = await readArtifactContent(session, artifactName, url.searchParams.get("raw") === "1");
          if (url.searchParams.get("raw") === "1") {
            text(response, 200, payload.content);
            return;
          }
          json(response, 200, { ok: true, artifact: artifactName, ...payload });
        } catch (error) {
          if (error.code === "ENOENT") {
            notFound(response, pathname);
            return;
          }
          if (error.message.startsWith("unknown artifact")) {
            notFound(response, pathname);
            return;
          }
          throw error;
        }
        return;
      }

      if (parts.length === 2 && parts[0] === "sessions") {
        const sessionId = decodeURIComponent(parts[1]);
        const session = withDatabase(dbPath, (db) => getSession(db, sessionId));
        if (!session) {
          notFound(response, pathname);
          return;
        }
        const events = filterEvents(await readEvents(eventsPath), {
          session: sessionId,
          limit: url.searchParams.get("limit") ?? "50"
        });
        const artifacts = await buildArtifactSummary(session);
        json(response, 200, { ok: true, session, events, artifacts });
        return;
      }

      if (pathname === "/events") {
        const events = filterEvents(await readEvents(eventsPath), {
          session: url.searchParams.get("session") ?? undefined,
          run: url.searchParams.get("run") ?? undefined,
          type: url.searchParams.get("type") ?? undefined,
          since: url.searchParams.get("since") ?? undefined,
          limit: url.searchParams.get("limit") ?? "100"
        });
        json(response, 200, { ok: true, events });
        return;
      }

      if (pathname === "/status") {
        const sessions = withDatabase(dbPath, (db) => listSessions(db));
        const events = await readEvents(eventsPath);
        json(response, 200, { ok: true, status: buildStatus(sessions, events) });
        return;
      }

      notFound(response, pathname);
    } catch (error) {
      json(response, 500, {
        ok: false,
        error: "internal_error",
        message: error.message
      });
    }
  });
}

async function main() {
  const host = process.env.SPORE_GATEWAY_HOST ?? "127.0.0.1";
  const port = Number.parseInt(process.env.SPORE_GATEWAY_PORT ?? "8787", 10);
  const server = await createServer();
  server.listen(port, host, () => {
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          service: "session-gateway",
          host,
          port
        },
        null,
        2
      ) + "\n"
    );
  });
}

main().catch((error) => {
  console.error(`session-gateway error: ${error.message}`);
  process.exitCode = 1;
});
