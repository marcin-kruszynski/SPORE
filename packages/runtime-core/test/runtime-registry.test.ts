import assert from "node:assert/strict";
import test from "node:test";

import type {
  RuntimeAdapter,
  RuntimeControlAck,
  RuntimeControlCommand,
  RuntimeSessionBinding,
  RuntimeSnapshot,
  RuntimeStartRequest,
  RuntimeStartResult,
} from "../src/index.js";
import { RuntimeRegistry, RuntimeSupervisor } from "../src/index.js";

function createFakeAdapter(): RuntimeAdapter {
  return {
    providerFamily: "pi",
    backendKind: "pi_rpc",
    capabilities: {
      supportsSteer: true,
      supportsFollowUp: true,
      supportsPrompt: true,
      supportsAbort: true,
      supportsSnapshot: true,
      supportsAttach: true,
      supportsRawEvents: true,
      supportsTmuxInspection: true,
    },
    async start(request: RuntimeStartRequest): Promise<RuntimeStartResult> {
      return {
        launchCommand: "node fake-runtime.js",
        launcherType: "fake",
        binding: {
          sessionId: request.sessionId,
          backendKind: "pi_rpc",
          providerFamily: "pi",
          runtimeInstanceId: "fake-runtime",
          controlEndpoint: null,
          protocolVersion: null,
          capabilities: this.capabilities,
          artifacts: {
            transcriptPath: null,
            runtimeStatusPath: null,
            runtimeEventsPath: null,
            rawEventsPath: null,
            controlPath: null,
            handoffPath: null,
            launchContextPath: null,
            debugPaths: [],
          },
        },
      };
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
        rawStateRef: null,
      };
    },
    async sendControl(
      binding: RuntimeSessionBinding,
      command: RuntimeControlCommand,
    ): Promise<RuntimeControlAck> {
      return {
        requestId: command.requestId,
        sessionId: binding.sessionId,
        accepted: true,
        backendRequestId: null,
        status: "accepted",
        message: null,
      };
    },
    async shutdown(): Promise<void> {},
  };
}

test("runtime registry can register and resolve a backend kind without importing PI adapters", () => {
  const registry = new RuntimeRegistry();
  const adapter = createFakeAdapter();

  registry.register(adapter);

  assert.equal(registry.get(adapter.backendKind)?.backendKind, adapter.backendKind);
});

test("runtime supervisor delegates start to the registered adapter", async () => {
  const registry = new RuntimeRegistry();
  registry.register(createFakeAdapter());
  const supervisor = new RuntimeSupervisor({ registry });

  const result = await supervisor.start({
    sessionId: "session-1",
    runId: "run-1",
    executionId: null,
    stepId: null,
    providerFamily: "pi",
    backendKind: "pi_rpc",
    artifactRoot: "tmp/sessions/session-1",
    planPath: null,
    contextPath: null,
    promptPath: null,
    cwd: null,
    metadata: {},
  });

  assert.equal(result.binding.backendKind, "pi_rpc");
  assert.equal(result.launcherType, "fake");
});
