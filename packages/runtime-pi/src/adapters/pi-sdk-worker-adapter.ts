import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import { buildTsxEntrypointArgs, PROJECT_ROOT } from "@spore/core";
import type {
  RuntimeAdapter,
  RuntimeControlAck,
  RuntimeControlCommand,
  RuntimeSessionBinding,
  RuntimeSnapshot,
  RuntimeStartRequest,
  RuntimeStartResult,
} from "@spore/runtime-core";

import {
  parseWorkerMessage,
  serializeWorkerMessage,
  type WorkerCommand,
  type WorkerEvent,
  type WorkerResponse,
  WORKER_PROTOCOL_VERSION,
} from "../worker/protocol.js";
import { readControlMessagesFromOffset } from "../control/session-control-queue.js";
import { buildCliRuntimeBinding, runRuntimeCli } from "./run-runtime-cli.js";

interface WorkerRuntimeRecord {
  binding: RuntimeSessionBinding;
  child: ChildProcess;
  state: RuntimeSnapshot["state"];
  health: RuntimeSnapshot["health"];
  startedAt: string;
  finishedAt: string | null;
  lastEventAt: string | null;
  pending: Map<string, (message: WorkerResponse) => void>;
  controlOffset: number;
  controlTimer: NodeJS.Timeout | null;
}

const workerSessions = new Map<string, WorkerRuntimeRecord>();

function nowIso() {
  return new Date().toISOString();
}

async function appendLine(filePath: string, payload: Record<string, unknown>) {
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(PROJECT_ROOT, filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.appendFile(resolved, `${JSON.stringify(payload)}\n`, "utf8");
}

async function writeJson(filePath: string, payload: Record<string, unknown>) {
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(PROJECT_ROOT, filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function createBinding(request: RuntimeStartRequest): RuntimeSessionBinding {
  return {
    sessionId: request.sessionId,
    backendKind: "pi_sdk_worker",
    providerFamily: "pi",
    runtimeInstanceId: request.sessionId,
    controlEndpoint: null,
    protocolVersion: WORKER_PROTOCOL_VERSION,
    capabilities: PI_SDK_WORKER_CAPABILITIES,
    artifacts: {
      transcriptPath: path.join("tmp", "sessions", `${request.sessionId}.transcript.md`),
      runtimeStatusPath: path.join("tmp", "sessions", `${request.sessionId}.runtime-status.json`),
      runtimeEventsPath: path.join("tmp", "sessions", `${request.sessionId}.runtime-events.jsonl`),
      rawEventsPath: path.join("tmp", "sessions", `${request.sessionId}.raw-events.jsonl`),
      controlPath: path.join("tmp", "sessions", `${request.sessionId}.control.ndjson`),
      handoffPath: path.join("tmp", "sessions", `${request.sessionId}.handoff.json`),
      launchContextPath: path.join("tmp", "sessions", `${request.sessionId}.launch-context.json`),
      debugPaths: [path.join("tmp", "sessions", `${request.sessionId}.worker-protocol.ndjson`)],
    },
  };
}

async function sendWorkerCommand(
  record: WorkerRuntimeRecord,
  command: Omit<WorkerCommand, "protocolVersion" | "messageType" | "timestamp">,
): Promise<WorkerResponse> {
  const message: WorkerCommand = {
    protocolVersion: WORKER_PROTOCOL_VERSION,
    messageType: "command",
    timestamp: nowIso(),
    ...command,
  };
  await appendLine(record.binding.artifacts.debugPaths[0]!, message as unknown as Record<string, unknown>);
  const response = new Promise<WorkerResponse>((resolve) => {
    record.pending.set(message.requestId, resolve);
  });
  record.child.stdin?.write(serializeWorkerMessage(message));
  return response;
}

async function updateWorkerStatus(record: WorkerRuntimeRecord) {
  await writeJson(record.binding.artifacts.runtimeStatusPath ?? "", {
    backendKind: record.binding.backendKind,
    providerFamily: record.binding.providerFamily,
    state: record.state,
    health: record.health,
    heartbeatAt: nowIso(),
    terminalSignal:
      record.finishedAt === null
        ? null
        : {
            settled: true,
            exitCode: record.state === "completed" ? 0 : 1,
            finishedAt: record.finishedAt,
            source: "pi_sdk_worker",
          },
  });
}

export const PI_SDK_WORKER_CAPABILITIES = {
  supportsSteer: true,
  supportsFollowUp: true,
  supportsPrompt: true,
  supportsAbort: true,
  supportsSnapshot: true,
  supportsAttach: true,
  supportsRawEvents: true,
  supportsTmuxInspection: false,
} as const;

export function createPiSdkWorkerAdapter(): RuntimeAdapter {
  return {
    providerFamily: "pi",
    backendKind: "pi_sdk_worker",
    capabilities: PI_SDK_WORKER_CAPABILITIES,
    async start(request): Promise<RuntimeStartResult> {
      const commandArgs = Array.isArray(request.metadata.commandArgs)
        ? request.metadata.commandArgs.map((value) => String(value))
        : null;
      if (commandArgs && commandArgs.length > 0) {
        const payload = await runRuntimeCli(commandArgs);
        return buildCliRuntimeBinding(
          request,
          payload,
          "pi_sdk_worker",
          PI_SDK_WORKER_CAPABILITIES,
          WORKER_PROTOCOL_VERSION,
        );
      }
      const binding = createBinding(request);
      const child = spawn(
        process.execPath,
        buildTsxEntrypointArgs("packages/runtime-pi/src/worker/pi-sdk-worker-main.ts", []),
        {
          cwd: PROJECT_ROOT,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      const record: WorkerRuntimeRecord = {
        binding,
        child,
        state: "starting",
        health: "healthy",
        startedAt: nowIso(),
        finishedAt: null,
        lastEventAt: null,
        pending: new Map(),
        controlOffset: 0,
        controlTimer: null,
      };
      workerSessions.set(binding.sessionId, record);
      let buffer = "";
      child.stdout?.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines.filter(Boolean)) {
          const message = parseWorkerMessage(line);
          void appendLine(binding.artifacts.debugPaths[0]!, message as unknown as Record<string, unknown>);
          if (message.messageType === "response") {
            record.pending.get(message.requestId)?.(message);
            record.pending.delete(message.requestId);
            continue;
          }
          const event = message as WorkerEvent;
          record.lastEventAt = event.timestamp;
          if (event.eventType === "runtime.heartbeat") {
            record.health = "healthy";
          }
          if (event.eventType === "runtime.session.completed") {
            record.state = "completed";
            record.health = "terminated";
            record.finishedAt = nowIso();
            const messages = Array.isArray(event.payload.messages)
              ? event.payload.messages
              : [];
            void fs.writeFile(
              path.join(PROJECT_ROOT, binding.artifacts.transcriptPath ?? ""),
              `${JSON.stringify(messages, null, 2)}\n`,
              "utf8",
            );
          }
          if (event.eventType === "runtime.session.failed") {
            record.state = "failed";
            record.health = "terminated";
            record.finishedAt = nowIso();
          }
          void appendLine(binding.artifacts.runtimeEventsPath ?? "", event as unknown as Record<string, unknown>);
          void updateWorkerStatus(record);
        }
      });
      await writeJson(binding.artifacts.launchContextPath ?? "", {
        launcherType: "pi-sdk-worker",
        backendKind: binding.backendKind,
        cwd: request.cwd ?? null,
        recordedAt: nowIso(),
      });
      await updateWorkerStatus(record);
      const response = await sendWorkerCommand(record, {
        requestId: crypto.randomUUID(),
        sessionId: binding.sessionId,
        command: "session.start",
        payload: {
          cwd: request.cwd,
          promptPath:
            typeof request.metadata.promptPath === "string"
              ? request.metadata.promptPath
              : request.promptPath,
          controlPath: binding.artifacts.controlPath,
        },
      });
      if (!response.ok) {
        throw new Error(String(response.error?.message ?? "worker start failed"));
      }
      record.state = "active";
      await updateWorkerStatus(record);
      record.controlTimer = setInterval(() => {
        void (async () => {
          const result = await readControlMessagesFromOffset(
            binding.artifacts.controlPath ?? binding.sessionId,
            record.controlOffset,
          );
          record.controlOffset = result.nextOffset;
          for (const entry of result.entries as Array<{ payload?: Record<string, unknown> }>) {
            const payload = entry.payload ?? {};
            const action = String(payload.action ?? "prompt");
            const requestId = crypto.randomUUID();
            if (action === "abort" || action === "steer" || action === "follow_up") {
              await sendWorkerCommand(record, {
                requestId,
                sessionId: binding.sessionId,
                command: "session.control",
                payload: {
                  kind: action,
                  message: payload.message,
                },
              });
            }
          }
        })();
      }, 500);
      return {
        binding,
        launchCommand: "packages/runtime-pi/src/worker/pi-sdk-worker-main.ts",
        launcherType: "pi-sdk-worker",
      };
    },
    async attach(binding): Promise<RuntimeSessionBinding | null> {
      return workerSessions.has(binding.sessionId) ? binding : null;
    },
    async getSnapshot(binding): Promise<RuntimeSnapshot> {
      const record = workerSessions.get(binding.sessionId);
      return {
        sessionId: binding.sessionId,
        backendKind: binding.backendKind,
        state: record?.state ?? "unknown",
        health: record?.health ?? "unreachable",
        startedAt: record?.startedAt ?? null,
        finishedAt: record?.finishedAt ?? null,
        lastEventAt: record?.lastEventAt ?? null,
        terminalSignal:
          record?.finishedAt == null
            ? null
            : {
                settled: true,
                exitCode: record.state === "completed" ? 0 : 1,
                finishedAt: record.finishedAt,
                source: "pi_sdk_worker",
              },
        rawStateRef: binding.artifacts.debugPaths[0] ?? null,
      };
    },
    async sendControl(binding, command): Promise<RuntimeControlAck> {
      const record = workerSessions.get(binding.sessionId);
      if (!record) {
        return {
          requestId: command.requestId,
          sessionId: binding.sessionId,
          accepted: false,
          backendRequestId: null,
          status: "rejected",
          message: "worker session not found",
        };
      }
      const response = await sendWorkerCommand(record, {
        requestId: command.requestId,
        sessionId: binding.sessionId,
        command: command.kind === "snapshot" ? "session.snapshot" : "session.control",
        payload:
          command.kind === "snapshot"
            ? {}
            : { kind: command.kind, ...command.payload },
      });
      return {
        requestId: command.requestId,
        sessionId: binding.sessionId,
        accepted: response.ok,
        backendRequestId: null,
        status: command.kind === "abort" ? "completed" : "accepted",
        message: response.ok ? null : String(response.error?.message ?? "worker control failed"),
      };
    },
    async shutdown(binding): Promise<void> {
      const record = workerSessions.get(binding.sessionId);
      if (!record) {
        return;
      }
      if (record.controlTimer) {
        clearInterval(record.controlTimer);
      }
      await sendWorkerCommand(record, {
        requestId: crypto.randomUUID(),
        sessionId: binding.sessionId,
        command: "session.shutdown",
        payload: {},
      });
      workerSessions.delete(binding.sessionId);
    },
  };
}
