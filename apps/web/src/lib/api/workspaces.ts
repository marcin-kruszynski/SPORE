import { requestJson } from "./http.js";
import type { WorkspaceApiDetail } from "../../types/self-build.js";

const API_PREFIX = "/api/orchestrator/workspaces";

export function listWorkspaces() {
  return requestJson<WorkspaceApiDetail[]>(API_PREFIX);
}

export function getWorkspace(workspaceId: string) {
  return requestJson<WorkspaceApiDetail>(`${API_PREFIX}/${encodeURIComponent(workspaceId)}`);
}
