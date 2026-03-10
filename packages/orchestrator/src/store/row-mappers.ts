import type { JsonObject } from "@spore/shared-types";

type LooseRecord = Record<string, unknown>;

export function parseJsonField<T = LooseRecord>(
  value: unknown,
  fallback = {} as T,
): T {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

export function mapWorkflowEventRow<T extends LooseRecord>(event: T) {
  return {
    ...event,
    payload: parseJsonField<JsonObject>(event.payloadJson, {}),
  };
}

export function mapEscalationRow<T extends LooseRecord>(record: T) {
  return {
    ...record,
    payload: parseJsonField<JsonObject>(record.payloadJson, {}),
  };
}

export function mapAuditRecordRow<T extends LooseRecord>(record: T) {
  return {
    ...record,
    payload: parseJsonField<JsonObject>(record.payloadJson, {}),
    result: parseJsonField<JsonObject>(record.result, {}),
  };
}
