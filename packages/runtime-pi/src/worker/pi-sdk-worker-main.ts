#!/usr/bin/env node
import fs from "node:fs/promises";
import readline from "node:readline";

import type { AgentSession } from "@mariozechner/pi-coding-agent";

import { createPiSdkSession } from "../sdk/create-pi-sdk-session.js";
import {
  serializeWorkerMessage,
  type WorkerCommand,
  WORKER_PROTOCOL_VERSION,
} from "./protocol.js";

interface WorkerRuntimeState {
  session: AgentSession;
  heartbeat?: NodeJS.Timeout;
  sequence: number;
  sessionId: string;
  promptPath: string | null;
}

let runtimeState: WorkerRuntimeState | null = null;

function writeMessage(message: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function nowIso() {
  return new Date().toISOString();
}

function emitEvent(eventType: string, payload: Record<string, unknown>, snapshot: Record<string, unknown> | null = null) {
  if (!runtimeState) {
    return;
  }
  runtimeState.sequence += 1;
  writeMessage({
    protocolVersion: WORKER_PROTOCOL_VERSION,
    messageType: "event",
    eventId: `${runtimeState.sessionId}:${runtimeState.sequence}`,
    sequence: runtimeState.sequence,
    sessionId: runtimeState.sessionId,
    timestamp: nowIso(),
    eventType,
    snapshot,
    payload,
    rawRef: null,
  });
}

async function handleStart(command: WorkerCommand) {
  const cwd = typeof command.payload.cwd === "string" ? command.payload.cwd : process.cwd();
  const promptPath = typeof command.payload.promptPath === "string" ? command.payload.promptPath : null;
  const session = await createPiSdkSession({ cwd });
  runtimeState = {
    session,
    sequence: 0,
    sessionId: command.sessionId,
    promptPath,
  };
  session.subscribe((event) => {
    emitEvent("runtime.raw", event as Record<string, unknown>, null);
  });
  runtimeState.heartbeat = setInterval(() => {
    emitEvent("runtime.heartbeat", {}, {
      state: session.isStreaming ? "active" : "idle",
      health: "healthy",
    });
  }, 1000);
  writeMessage({
    protocolVersion: WORKER_PROTOCOL_VERSION,
    messageType: "response",
    requestId: command.requestId,
    sessionId: command.sessionId,
    timestamp: nowIso(),
    ok: true,
    result: { accepted: true },
  });
  emitEvent("runtime.session.active", { promptPath }, { state: "active", health: "healthy" });
  const promptText = promptPath ? await fs.readFile(promptPath, "utf8") : "";
  void (async () => {
    try {
      await session.prompt(promptText);
      emitEvent("runtime.session.completed", {
        messages: session.messages,
      }, { state: "completed", health: "terminated" });
    } catch (error) {
      emitEvent("runtime.session.failed", {
        message: error instanceof Error ? error.message : String(error),
      }, { state: "failed", health: "terminated" });
    }
  })();
}

async function handleControl(command: WorkerCommand) {
  if (!runtimeState) {
    throw new Error("worker session not started");
  }
  const kind = String(command.payload.kind ?? "prompt");
  const message = String(command.payload.message ?? "");
  if (kind === "abort") {
    await runtimeState.session.abort();
  } else if (kind === "steer") {
    await runtimeState.session.steer(message);
  } else if (kind === "follow_up") {
    await runtimeState.session.followUp(message);
  } else {
    await runtimeState.session.prompt(message, { streamingBehavior: "followUp" });
  }
  writeMessage({
    protocolVersion: WORKER_PROTOCOL_VERSION,
    messageType: "response",
    requestId: command.requestId,
    sessionId: command.sessionId,
    timestamp: nowIso(),
    ok: true,
    result: { accepted: true, kind },
  });
}

function handleSnapshot(command: WorkerCommand) {
  const state = runtimeState?.session?.isStreaming ? "active" : "idle";
  writeMessage({
    protocolVersion: WORKER_PROTOCOL_VERSION,
    messageType: "response",
    requestId: command.requestId,
    sessionId: command.sessionId,
    timestamp: nowIso(),
    ok: true,
    result: {
      state,
      pendingMessageCount: runtimeState?.session.pendingMessageCount ?? 0,
    },
  });
}

async function handleShutdown(command: WorkerCommand) {
  if (runtimeState?.heartbeat) {
    clearInterval(runtimeState.heartbeat);
  }
  if (runtimeState) {
    await runtimeState.session.abort();
  }
  writeMessage({
    protocolVersion: WORKER_PROTOCOL_VERSION,
    messageType: "response",
    requestId: command.requestId,
    sessionId: command.sessionId,
    timestamp: nowIso(),
    ok: true,
    result: { accepted: true },
  });
  process.exitCode = 0;
  process.exit();
}

async function dispatch(command: WorkerCommand) {
  if (command.command === "session.start") {
    await handleStart(command);
    return;
  }
  if (command.command === "session.control") {
    await handleControl(command);
    return;
  }
  if (command.command === "session.snapshot") {
    handleSnapshot(command);
    return;
  }
  if (command.command === "session.shutdown") {
    await handleShutdown(command);
    return;
  }
  writeMessage({
    protocolVersion: WORKER_PROTOCOL_VERSION,
    messageType: "response",
    requestId: command.requestId,
    sessionId: command.sessionId,
    timestamp: nowIso(),
    ok: true,
    result: { pong: true },
  });
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on("line", (line) => {
  void (async () => {
    let parsedCommand: WorkerCommand | null = null;
    try {
      parsedCommand = JSON.parse(line) as WorkerCommand;
      await dispatch(parsedCommand);
    } catch (error) {
      if (parsedCommand) {
        writeMessage({
          protocolVersion: WORKER_PROTOCOL_VERSION,
          messageType: "response",
          requestId: parsedCommand.requestId,
          sessionId: parsedCommand.sessionId,
          timestamp: nowIso(),
          ok: false,
          error: {
            message: error instanceof Error ? error.message : String(error),
          },
        });
      } else {
        writeMessage({
          protocolVersion: WORKER_PROTOCOL_VERSION,
          messageType: "event",
          eventId: `worker-error:${Date.now()}`,
          sequence: runtimeState?.sequence ?? 0,
          sessionId: runtimeState?.sessionId ?? "unknown",
          timestamp: nowIso(),
          eventType: "runtime.error",
          snapshot: null,
          payload: {
            message: error instanceof Error ? error.message : String(error),
          },
          rawRef: null,
        });
      }
    }
  })();
});
