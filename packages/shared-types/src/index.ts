export type WorkflowState = string;
export type SessionState = string;
export type ScenarioRunStatus = string;
export type RegressionRunStatus = string;
export type WorkspaceStatus = string;
export type JsonPrimitive = string | number | boolean | null;
export interface JsonObject {
  [key: string]: JsonValue | undefined;
}
export type JsonArray = JsonValue[];
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface ApiEnvelope<T> {
  ok: boolean;
  detail?: T;
  error?: string;
  [key: string]: unknown;
}
export interface WithMetadata {
  metadata?: JsonObject;
}
