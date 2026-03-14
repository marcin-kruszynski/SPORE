import type { RuntimeBackendKind } from "@spore/runtime-core";
import { RuntimeRegistry, RuntimeSupervisor } from "@spore/runtime-core";
import { registerPiRuntimeBackends } from "@spore/runtime-pi";

export interface StartRuntimeForStepOptions {
  backendKind?: string | null;
  sessionId: string;
  runId: string;
  commandArgs: string[];
}

export async function startRuntimeForStep(options: StartRuntimeForStepOptions) {
  const registry = new RuntimeRegistry();
  registerPiRuntimeBackends(registry);
  const supervisor = new RuntimeSupervisor({ registry });
  return supervisor.start({
    sessionId: options.sessionId,
    runId: options.runId,
    executionId: null,
    stepId: null,
    providerFamily: "pi",
    backendKind: (options.backendKind ?? "pi_rpc") as RuntimeBackendKind,
    artifactRoot: `tmp/sessions/${options.sessionId}`,
    planPath: null,
    contextPath: null,
    promptPath: null,
    cwd: null,
    metadata: {
      commandArgs: options.commandArgs,
    },
  });
}
