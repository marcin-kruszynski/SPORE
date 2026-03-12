import { requestJson } from "./http.js";
import type {
  ProposalArtifactApiDetail,
  RegressionReportApiDetail,
  RegressionRunApiDetail,
  ScenarioRunApiDetail,
  WorkspaceApiDetail,
  WorkItemRunApiDetail,
} from "../../types/self-build.js";

const API_PREFIX = "/api/orchestrator";

export function getWorkItemRun(runId: string) {
  return requestJson<WorkItemRunApiDetail>(
    `${API_PREFIX}/work-item-runs/${encodeURIComponent(runId)}`,
  );
}

export function getWorkItemRunProposal(runId: string) {
  return requestJson<ProposalArtifactApiDetail>(
    `${API_PREFIX}/work-item-runs/${encodeURIComponent(runId)}/proposal`,
  );
}

export function getWorkItemRunWorkspace(runId: string) {
  return requestJson<WorkspaceApiDetail>(
    `${API_PREFIX}/work-item-runs/${encodeURIComponent(runId)}/workspace`,
  );
}

export function getScenarioRun(runId: string) {
  return requestJson<ScenarioRunApiDetail>(
    `${API_PREFIX}/scenario-runs/${encodeURIComponent(runId)}`,
  );
}

export function getRegressionRun(runId: string) {
  return requestJson<RegressionRunApiDetail>(
    `${API_PREFIX}/regression-runs/${encodeURIComponent(runId)}`,
  );
}

export function getRegressionReport(runId: string) {
  return requestJson<RegressionReportApiDetail>(
    `${API_PREFIX}/regression-runs/${encodeURIComponent(runId)}/report`,
  );
}
