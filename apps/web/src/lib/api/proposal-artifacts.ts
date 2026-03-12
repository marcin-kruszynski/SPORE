import { requestJson } from "./http.js";
import type {
  ProposalArtifactApiDetail,
  ProposalReviewPackageApiDetail,
} from "../../types/self-build.js";

const API_PREFIX = "/api/orchestrator/proposal-artifacts";

export function getProposalArtifact(proposalId: string) {
  return requestJson<ProposalArtifactApiDetail>(
    `${API_PREFIX}/${encodeURIComponent(proposalId)}`,
  );
}

export function getProposalReviewPackage(proposalId: string) {
  return requestJson<ProposalReviewPackageApiDetail>(
    `${API_PREFIX}/${encodeURIComponent(proposalId)}/review-package`,
  );
}
