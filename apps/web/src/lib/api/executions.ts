import {
  requestJson,
  requestPayloadJson,
} from "./http.js";
import type {
  MissionMapApiCoordinationGroupSummary,
  MissionMapApiExecutionDetail,
  MissionMapApiExecutionRecord,
  MissionMapApiExecutionTree,
} from "../../types/mission-map.js";

const API_PREFIX = "/api/orchestrator";

export async function listExecutions() {
  const payload = await requestPayloadJson<{
    executions?: MissionMapApiExecutionRecord[] | null;
  }>(`${API_PREFIX}/executions`);
  return Array.isArray(payload.executions) ? payload.executions : [];
}

export function getExecutionDetail(executionId: string) {
  return requestJson<MissionMapApiExecutionDetail>(
    `${API_PREFIX}/executions/${encodeURIComponent(executionId)}`,
  );
}

export async function getExecutionTree(executionId: string) {
  const payload = await requestPayloadJson<{ tree?: MissionMapApiExecutionTree | null }>(
    `${API_PREFIX}/executions/${encodeURIComponent(executionId)}/tree`,
  );
  return payload.tree ?? null;
}

export async function listCoordinationGroups() {
  const payload = await requestPayloadJson<{
    groups?: MissionMapApiCoordinationGroupSummary[] | null;
  }>(`${API_PREFIX}/coordination-groups`);
  return Array.isArray(payload.groups) ? payload.groups : [];
}
