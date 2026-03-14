import path from "node:path";
import type {
  RuntimeAdapter,
  RuntimeControlAck,
  RuntimeControlCommand,
  RuntimeSessionBinding,
  RuntimeSnapshot,
  RuntimeStartRequest,
  RuntimeStartResult,
} from "@spore/runtime-core";

import { appendControlMessage } from "../control/session-control-queue.js";
import { buildCliRuntimeBinding, runRuntimeCli } from "./run-runtime-cli.js";

function buildBinding(
  request: RuntimeStartRequest,
  payload: Record<string, unknown>,
): RuntimeSessionBinding {
  const launchScriptPath =
    typeof payload.launchScriptPath === "string" ? payload.launchScriptPath : null;
  const transcriptPath =
    typeof payload.transcriptPath === "string" ? payload.transcriptPath : null;
  const tmuxSession =
    typeof payload.tmuxSession === "string" ? payload.tmuxSession : null;
  const runtimeStatusPath = path.join(
    "tmp",
    "sessions",
    `${request.sessionId}.runtime-status.json`,
  );
  const runtimeEventsPath = path.join(
    "tmp",
    "sessions",
    `${request.sessionId}.runtime-events.jsonl`,
  );
  const rawEventsPath = path.join(
    "tmp",
    "sessions",
    `${request.sessionId}.pi-events.jsonl`,
  );

  return {
    sessionId: request.sessionId,
    backendKind: "pi_rpc",
    providerFamily: "pi",
    runtimeInstanceId: tmuxSession,
    controlEndpoint: null,
    protocolVersion: null,
    capabilities: PI_RPC_CAPABILITIES,
    artifacts: {
      transcriptPath,
      runtimeStatusPath,
      runtimeEventsPath,
      rawEventsPath,
      controlPath: path.join("tmp", "sessions", `${request.sessionId}.control.ndjson`),
      handoffPath: path.join("tmp", "sessions", `${request.sessionId}.handoff.json`),
      launchContextPath: path.join(
        "tmp",
        "sessions",
        `${request.sessionId}.launch-context.json`,
      ),
      debugPaths: [
        launchScriptPath,
        path.join("tmp", "sessions", `${request.sessionId}.rpc-status.json`),
      ].filter((value): value is string => Boolean(value)),
    },
  };
}

export const PI_RPC_CAPABILITIES = {
  supportsSteer: true,
  supportsFollowUp: true,
  supportsPrompt: true,
  supportsAbort: true,
  supportsSnapshot: true,
  supportsAttach: true,
  supportsRawEvents: true,
  supportsTmuxInspection: true,
} as const;

export function createPiRpcAdapter(): RuntimeAdapter {
  return {
    providerFamily: "pi",
    backendKind: "pi_rpc",
    capabilities: PI_RPC_CAPABILITIES,
    async start(request: RuntimeStartRequest): Promise<RuntimeStartResult> {
      const commandArgs = Array.isArray(request.metadata.commandArgs)
        ? request.metadata.commandArgs.map((value) => String(value))
        : null;
      if (!commandArgs || commandArgs.length === 0) {
        throw new Error("pi_rpc adapter requires metadata.commandArgs");
      }
      const payload = await runRuntimeCli(commandArgs);
      const result = buildCliRuntimeBinding(
        request,
        payload,
        "pi_rpc",
        PI_RPC_CAPABILITIES,
      );
      result.binding.artifacts.rawEventsPath = path.join(
        "tmp",
        "sessions",
        `${request.sessionId}.pi-events.jsonl`,
      );
      result.binding.artifacts.debugPaths = [
        typeof payload.launchScriptPath === "string" ? payload.launchScriptPath : null,
        path.join("tmp", "sessions", `${request.sessionId}.rpc-status.json`),
      ].filter((value): value is string => Boolean(value));
      return result;
    },
    async attach(binding: RuntimeSessionBinding): Promise<RuntimeSessionBinding> {
      return binding;
    },
    async getSnapshot(binding: RuntimeSessionBinding): Promise<RuntimeSnapshot> {
      return {
        sessionId: binding.sessionId,
        backendKind: binding.backendKind,
        state: "active",
        health: "healthy",
        startedAt: null,
        finishedAt: null,
        lastEventAt: null,
        terminalSignal: null,
        rawStateRef: binding.artifacts.rawEventsPath,
      };
    },
    async sendControl(
      binding: RuntimeSessionBinding,
      command: RuntimeControlCommand,
    ): Promise<RuntimeControlAck> {
      const action =
        command.kind === "abort"
          ? "abort"
          : command.kind === "follow_up"
            ? "follow_up"
            : command.kind;
      await appendControlMessage(binding.sessionId, {
        action,
        ...command.payload,
      });
      return {
        requestId: command.requestId,
        sessionId: binding.sessionId,
        accepted: true,
        backendRequestId: null,
        status: action === "abort" ? "completed" : "queued",
        message: null,
      };
    },
    async shutdown(binding: RuntimeSessionBinding): Promise<void> {
      await appendControlMessage(binding.sessionId, {
        action: "abort",
        source: "runtime-adapter",
      });
    },
  };
}
