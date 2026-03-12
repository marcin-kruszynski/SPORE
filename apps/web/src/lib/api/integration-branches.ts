import { requestJson } from "./http.js";
import type { IntegrationBranchApiDetail } from "../../types/self-build.js";

const API_PREFIX = "/api/orchestrator/integration-branches";

export function getIntegrationBranch(branchName: string) {
  return requestJson<IntegrationBranchApiDetail>(
    `${API_PREFIX}/${encodeURIComponent(branchName)}`,
  );
}
