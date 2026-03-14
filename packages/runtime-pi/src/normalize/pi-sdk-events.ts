import type { RuntimeBackendKind, RuntimeEventEnvelope } from "@spore/runtime-core";

export function normalizePiSdkEvent(
  sessionId: string,
  backendKind: Extract<RuntimeBackendKind, "pi_sdk_embedded" | "pi_sdk_worker">,
  sequence: number,
  raw: Record<string, unknown>,
): RuntimeEventEnvelope {
  const rawType = String(raw.type ?? raw.eventType ?? "runtime.raw");
  return {
    eventId: `${sessionId}:${sequence}`,
    sessionId,
    backendKind,
    sequence,
    timestamp: new Date().toISOString(),
    type: rawType,
    snapshot: null,
    payload: raw,
    rawRef: null,
  };
}
