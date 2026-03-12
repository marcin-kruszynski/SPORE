import { requestJson } from "./http.js";
import type {
  SelfBuildApiDashboard,
  SelfBuildApiSummary,
} from "../../types/self-build.js";

const API_PREFIX = "/api/orchestrator/self-build";

export function getSelfBuildSummary() {
  return requestJson<SelfBuildApiSummary>(`${API_PREFIX}/summary`);
}

export function getSelfBuildDashboard() {
  return requestJson<SelfBuildApiDashboard>(`${API_PREFIX}/dashboard`);
}
