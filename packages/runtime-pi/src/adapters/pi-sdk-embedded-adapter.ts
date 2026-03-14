import fs from "node:fs/promises";
import path from "node:path";

import type {
  RuntimeAdapter,
  RuntimeControlAck,
  RuntimeControlCommand,
  RuntimeEventEnvelope,
  RuntimeSessionBinding,
  RuntimeSnapshot,
  RuntimeStartRequest,
  RuntimeStartResult,
} from "@spore/runtime-core";

import { readControlMessagesFromOffset } from "../control/session-control-queue.js";
import { PROJECT_ROOT } from "../metadata/constants.js";
import { createPiSdkSession } from "../sdk/create-pi-sdk-session.js";
import { buildCliRuntimeBinding, runRuntimeCli } from "./run-runtime-cli.js";

interface EmbeddedRuntimeRecord {
  binding: RuntimeSessionBinding;
  session: Awaited<ReturnType<typeof createPiSdkSession>>;
  state: RuntimeSnapshot["state"];
  health: RuntimeSnapshot["health"];
  startedAt: string;
  finishedAt: string | null;
  lastEventAt: string | null;
  sequence: number;
  controlOffset: number;
  controlTimer: NodeJS.Timeout | null;
}

const embeddedSessions = new Map<string, EmbeddedRuntimeRecord>();

async function appendJsonLine(filePath: string, payload: Record<string, unknown>) {
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(PROJECT_ROOT, filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.appendFile(resolved, `${JSON.stringify(payload)}\n`, "utf8");
}

async function writeJsonFile(filePath: string, payload: Record<string, unknown>) {
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(PROJECT_ROOT, filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function createBinding(request: RuntimeStartRequest): RuntimeSessionBinding {
  return {
    sessionId: request.sessionId,
    backendKind: "pi_sdk_embedded",
    providerFamily: "pi",
    runtimeInstanceId: request.sessionId,
    controlEndpoint: null,
    protocolVersion: null,
    capabilities: PI_SDK_EMBEDDED_CAPABILITIES,
    artifacts: {
      transcriptPath: path.join("tmp", "sessions", `${request.sessionId}.transcript.md`),
      runtimeStatusPath: path.join("tmp", "sessions", `${request.sessionId}.runtime-status.json`),
      runtimeEventsPath: path.join("tmp", "sessions", `${request.sessionId}.runtime-events.jsonl`),
      rawEventsPath: path.join("tmp", "sessions", `${request.sessionId}.raw-events.jsonl`),
      controlPath: path.join("tmp", "sessions", `${request.sessionId}.control.ndjson`),
      handoffPath: path.join("tmp", "sessions", `${request.sessionId}.handoff.json`),
      launchContextPath: path.join("tmp", "sessions", `${request.sessionId}.launch-context.json`),
      debugPaths: [],
    },
  };
}

async function writeEmbeddedSnapshot(record: EmbeddedRuntimeRecord) {
  await writeJsonFile(record.binding.artifacts.runtimeStatusPath ?? "", {
    backendKind: record.binding.backendKind,
    providerFamily: record.binding.providerFamily,
    state: record.state,
    health: record.health,
    heartbeatAt: new Date().toISOString(),
    terminalSignal:
      record.finishedAt === null
        ? null
        : {
            settled: true,
            exitCode: record.state === "completed" ? 0 : 1,
            finishedAt: record.finishedAt,
            source: "pi_sdk_embedded",
          },
  });
}

async function appendEmbeddedEvent(
  record: EmbeddedRuntimeRecord,
  type: string,
  payload: Record<string, unknown>,
) {
  record.sequence += 1;
  record.lastEventAt = new Date().toISOString();
  const event: RuntimeEventEnvelope = {
    eventId: `${record.binding.sessionId}:${record.sequence}`,
    sessionId: record.binding.sessionId,
    backendKind: record.binding.backendKind,
    sequence: record.sequence,
    timestamp: record.lastEventAt,
    type,
    snapshot: {
      state: record.state,
      health: record.health,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      lastEventAt: record.lastEventAt,
    },
    payload,
    rawRef: record.binding.artifacts.rawEventsPath,
  };
  await appendJsonLine(
    record.binding.artifacts.runtimeEventsPath ?? "",
    event as unknown as Record<string, unknown>,
  );
}

export const PI_SDK_EMBEDDED_CAPABILITIES = {
  supportsSteer: true,
  supportsFollowUp: true,
  supportsPrompt: true,
  supportsAbort: true,
  supportsSnapshot: true,
  supportsAttach: false,
  supportsRawEvents: true,
  supportsTmuxInspection: false,
} as const;

export function createPiSdkEmbeddedAdapter(): RuntimeAdapter {
  return {
    providerFamily: "pi",
    backendKind: "pi_sdk_embedded",
    capabilities: PI_SDK_EMBEDDED_CAPABILITIES,
    async start(request, hooks): Promise<RuntimeStartResult> {
      const commandArgs = Array.isArray(request.metadata.commandArgs)
        ? request.metadata.commandArgs.map((value) => String(value))
        : null;
      if (commandArgs && commandArgs.length > 0) {
        const payload = await runRuntimeCli(commandArgs);
        return buildCliRuntimeBinding(
          request,
          payload,
          "pi_sdk_embedded",
          PI_SDK_EMBEDDED_CAPABILITIES,
        );
      }
      const promptPath = typeof request.metadata.promptPath === "string"
        ? request.metadata.promptPath
        : request.promptPath;
      const cwd = typeof request.metadata.cwd === "string" ? request.metadata.cwd : request.cwd;
      const session = await createPiSdkSession({ cwd });
      const binding = createBinding(request);
      const record: EmbeddedRuntimeRecord = {
        binding,
        session,
        state: "active",
        health: "healthy",
        startedAt: new Date().toISOString(),
        finishedAt: null,
      lastEventAt: null,
      sequence: 0,
      controlOffset: 0,
      controlTimer: null,
      };
      embeddedSessions.set(binding.sessionId, record);
      session.subscribe((event) => {
        void appendJsonLine(binding.artifacts.rawEventsPath ?? "", event as Record<string, unknown>);
      });
      await writeJsonFile(binding.artifacts.launchContextPath ?? "", {
        cwd: cwd ?? null,
        launcherType: "pi-sdk-embedded",
        backendKind: binding.backendKind,
        recordedAt: new Date().toISOString(),
      });
      await writeEmbeddedSnapshot(record);
      await appendEmbeddedEvent(record, "runtime.session.active", {
        promptPath,
      });
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
            const message = String(payload.message ?? "");
            if (action === "abort") {
              await record.session.abort();
            } else if (action === "follow_up") {
              await record.session.followUp(message);
            } else if (action === "steer") {
              await record.session.steer(message);
            }
          }
        })();
      }, 500);
      const promptText = promptPath
        ? await fs.readFile(
            path.isAbsolute(promptPath)
              ? promptPath
              : path.join(PROJECT_ROOT, promptPath),
            "utf8",
          )
        : "";
      void (async () => {
        try {
          await session.prompt(promptText);
          record.state = "completed";
          record.finishedAt = new Date().toISOString();
          await fs.writeFile(
            path.join(PROJECT_ROOT, binding.artifacts.transcriptPath ?? ""),
            `${JSON.stringify(session.messages, null, 2)}\n`,
            "utf8",
          );
          await writeEmbeddedSnapshot(record);
          await appendEmbeddedEvent(record, "runtime.session.completed", {});
        } catch (error) {
          record.state = "failed";
          record.health = "terminated";
          record.finishedAt = new Date().toISOString();
          await writeEmbeddedSnapshot(record);
          await appendEmbeddedEvent(record, "runtime.session.failed", {
            message: error instanceof Error ? error.message : String(error),
          });
          await hooks.onError?.(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      })();
      return {
        binding,
        launchCommand: null,
        launcherType: "pi-sdk-embedded",
      };
    },
    async getSnapshot(binding): Promise<RuntimeSnapshot> {
      const record = embeddedSessions.get(binding.sessionId);
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
                source: "pi_sdk_embedded",
              },
        rawStateRef: binding.artifacts.rawEventsPath,
      };
    },
    async sendControl(binding, command): Promise<RuntimeControlAck> {
      const record = embeddedSessions.get(binding.sessionId);
      if (!record) {
        return {
          requestId: command.requestId,
          sessionId: binding.sessionId,
          accepted: false,
          backendRequestId: null,
          status: "rejected",
          message: "embedded session not found",
        };
      }
      if (command.kind === "abort") {
        await record.session.abort();
      } else if (command.kind === "follow_up") {
        await record.session.followUp(String(command.payload.message ?? ""));
      } else if (command.kind === "steer") {
        await record.session.steer(String(command.payload.message ?? ""));
      } else {
        await record.session.prompt(String(command.payload.message ?? ""), {
          streamingBehavior: "followUp",
        });
      }
      await appendJsonLine(binding.artifacts.controlPath ?? "", {
        requestId: command.requestId,
        kind: command.kind,
        payload: command.payload,
      });
      return {
        requestId: command.requestId,
        sessionId: binding.sessionId,
        accepted: true,
        backendRequestId: null,
        status: command.kind === "abort" ? "completed" : "accepted",
        message: null,
      };
    },
    async shutdown(binding): Promise<void> {
      const record = embeddedSessions.get(binding.sessionId);
      if (record) {
        if (record.controlTimer) {
          clearInterval(record.controlTimer);
        }
        await record.session.abort();
        embeddedSessions.delete(binding.sessionId);
      }
    },
  };
}
