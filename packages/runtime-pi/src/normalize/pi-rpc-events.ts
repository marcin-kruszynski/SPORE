import type { RuntimeEventEnvelope } from "@spore/runtime-core";

export function normalizePiRpcEvent(
  sessionId: string,
  sequence: number,
  raw: Record<string, unknown>,
): RuntimeEventEnvelope {
  const rawType = String(raw.type ?? raw.event ?? "runtime.raw");
  return {
    eventId: `${sessionId}:${sequence}`,
    sessionId,
    backendKind: "pi_rpc",
    sequence,
    timestamp: new Date().toISOString(),
    type: rawType,
    snapshot: null,
    payload: raw,
    rawRef: null,
  };
}
