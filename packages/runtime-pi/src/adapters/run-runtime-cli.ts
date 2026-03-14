import { spawn } from "node:child_process";

import { buildTsxEntrypointArgs, PROJECT_ROOT } from "@spore/core";

import type {
  RuntimeCapabilities,
  RuntimeSessionBinding,
  RuntimeStartRequest,
  RuntimeStartResult,
} from "@spore/runtime-core";

export async function runRuntimeCli(
  args: string[],
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      buildTsxEntrypointArgs(args[0]!, args.slice(1)),
      {
        cwd: PROJECT_ROOT,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(JSON.parse(stdout) as Record<string, unknown>);
        return;
      }
      reject(new Error(stderr || stdout || "runtime cli launch failed"));
    });
  });
}

export function buildCliRuntimeBinding(
  request: RuntimeStartRequest,
  payload: Record<string, unknown>,
  backendKind: RuntimeSessionBinding["backendKind"],
  capabilities: RuntimeCapabilities,
  protocolVersion: string | null = null,
): RuntimeStartResult {
  const runtimeStatusPath =
    typeof payload.runtimeStatusPath === "string"
      ? payload.runtimeStatusPath
      : `tmp/sessions/${request.sessionId}.runtime-status.json`;
  const runtimeEventsPath =
    typeof payload.runtimeEventsPath === "string"
      ? payload.runtimeEventsPath
      : `tmp/sessions/${request.sessionId}.runtime-events.jsonl`;
  const transcriptPath =
    typeof payload.transcriptPath === "string"
      ? payload.transcriptPath
      : `tmp/sessions/${request.sessionId}.transcript.md`;
  const launchContextPath =
    typeof payload.launchContextPath === "string"
      ? payload.launchContextPath
      : `tmp/sessions/${request.sessionId}.launch-context.json`;
  return {
    binding: {
      sessionId: request.sessionId,
      backendKind,
      providerFamily: request.providerFamily,
      runtimeInstanceId:
        typeof payload.tmuxSession === "string"
          ? payload.tmuxSession
          : request.sessionId,
      controlEndpoint: null,
      protocolVersion,
      capabilities,
      artifacts: {
        transcriptPath,
        runtimeStatusPath,
        runtimeEventsPath,
        rawEventsPath:
          typeof payload.rawEventsPath === "string"
            ? payload.rawEventsPath
            : `tmp/sessions/${request.sessionId}.raw-events.jsonl`,
        controlPath: `tmp/sessions/${request.sessionId}.control.ndjson`,
        handoffPath: `tmp/sessions/${request.sessionId}.handoff.json`,
        launchContextPath,
        debugPaths: [],
      },
    },
    launchCommand:
      typeof payload.launchScriptPath === "string" ? payload.launchScriptPath : null,
    launcherType:
      typeof payload.launcherType === "string" ? payload.launcherType : null,
  };
}
