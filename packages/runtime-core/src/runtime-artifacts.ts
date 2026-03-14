import type { RuntimeArtifactManifest } from "./types.js";

export const DEFAULT_RUNTIME_ARTIFACT_NAMES = {
  runtimeStatus: "runtime-status.json",
  runtimeEvents: "runtime-events.jsonl",
  rawEvents: "raw-events.jsonl",
  control: "control.ndjson",
  transcript: "transcript.md",
  handoff: "handoff.json",
  launchContext: "launch-context.json",
} as const;

export function createRuntimeArtifactManifest(
  manifest: Partial<RuntimeArtifactManifest> = {},
): RuntimeArtifactManifest {
  return {
    transcriptPath: manifest.transcriptPath ?? null,
    runtimeStatusPath: manifest.runtimeStatusPath ?? null,
    runtimeEventsPath: manifest.runtimeEventsPath ?? null,
    rawEventsPath: manifest.rawEventsPath ?? null,
    controlPath: manifest.controlPath ?? null,
    handoffPath: manifest.handoffPath ?? null,
    launchContextPath: manifest.launchContextPath ?? null,
    debugPaths: Array.isArray(manifest.debugPaths) ? manifest.debugPaths : [],
  };
}
