import type { RuntimeBackendKind, RuntimeSnapshot } from "./types.js";

export interface RuntimeEventRecord {
  eventId: string;
  sessionId: string;
  backendKind: RuntimeBackendKind;
  sequence: number;
  timestamp: string;
  type: string;
  snapshot: Partial<RuntimeSnapshot> | null;
  payload: Record<string, unknown>;
  rawRef: string | null;
}

export function createRuntimeEventRecord(
  input: RuntimeEventRecord,
): RuntimeEventRecord {
  return {
    ...input,
    snapshot: input.snapshot ?? null,
    payload: input.payload ?? {},
    rawRef: input.rawRef ?? null,
  };
}
