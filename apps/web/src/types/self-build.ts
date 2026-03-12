export type MissionEvidenceKind = "proposal" | "validation" | "promotion" | "workspace";

export type MissionEvidenceSubject = "proposal" | "run" | "branch" | "workspace";

export interface MissionEvidenceTarget {
  kind: MissionEvidenceKind;
  id: string;
  subject?: MissionEvidenceSubject;
}

export interface SelfBuildApiOverview {
  urgentCount?: number | null;
  followUpCount?: number | null;
  generatedAt?: string | null;
}

export interface SelfBuildApiFreshness {
  lastRefresh?: string | null;
  staleAfter?: string | null;
}

export interface SelfBuildApiCounts {
  workItems?: number | null;
  groups?: number | null;
  pendingDocSuggestions?: number | null;
  validationRequiredProposals?: number | null;
  proposalsBlockedForPromotion?: number | null;
  integrationBranches?: number | null;
  orphanedWorkspaces?: number | null;
  goalPlans?: number | null;
}

export interface SelfBuildApiLifecycle {
  blockedPromotions?: number | null;
  pendingValidations?: number | null;
  activeAutonomousRuns?: number | null;
  quarantinedWork?: number | null;
  protectedTierOverrides?: number | null;
  policyRecommendationQueue?: number | null;
}

export interface SelfBuildApiAttentionSummary {
  total?: number | null;
  byState?: Record<string, number> | null;
}

export interface SelfBuildApiQueueSummary {
  total?: number | null;
}

export interface SelfBuildApiProposalQueueEntry {
  id?: string | null;
  title?: string | null;
  summary?: string | null;
  status?: string | null;
  promotionStatus?: string | null;
  promotion?: {
    integrationBranch?: string | null;
  } | null;
}

export interface SelfBuildApiRecentRunSummary {
  id?: string | null;
  itemTitle?: string | null;
  itemKind?: string | null;
  status?: string | null;
  terminalKind?: string | null;
  validationStatus?: string | null;
  hasProposal?: boolean | null;
  hasWorkspace?: boolean | null;
  comparisonToPrevious?: {
    summary?: string | null;
  } | null;
}

export interface SelfBuildApiWorkspaceSummary {
  id?: string | null;
  branchName?: string | null;
  status?: string | null;
  workItemId?: string | null;
  workItemRunId?: string | null;
  safeMode?: boolean | null;
  worktreePath?: string | null;
}

export interface SelfBuildApiIntegrationBranchSummary {
  name?: string | null;
  status?: string | null;
  targetBranch?: string | null;
  proposalArtifactId?: string | null;
  sourceExecutionId?: string | null;
  diagnostics?: {
    issues?: Array<{
      reason?: string | null;
    }> | null;
  } | null;
  reason?: string | null;
}

export interface SelfBuildApiGroupSummary {
  id?: string | null;
  title?: string | null;
  status?: string | null;
  readiness?: {
    headlineState?: string | null;
    preRunSummary?: {
      label?: string | null;
    } | null;
    counts?: {
      ready?: number | null;
      blocked?: number | null;
      reviewNeeded?: number | null;
    } | null;
  } | null;
}

export interface SelfBuildApiSummary {
  overview?: SelfBuildApiOverview | null;
  freshness?: SelfBuildApiFreshness | null;
  counts?: SelfBuildApiCounts | null;
  waitingReviewProposals?: SelfBuildApiProposalQueueEntry[] | null;
  waitingApprovalProposals?: SelfBuildApiProposalQueueEntry[] | null;
  validationRequiredProposals?: SelfBuildApiProposalQueueEntry[] | null;
  proposalsBlockedForPromotion?: SelfBuildApiProposalQueueEntry[] | null;
  recentWorkItemRuns?: SelfBuildApiRecentRunSummary[] | null;
  workspaces?: SelfBuildApiWorkspaceSummary[] | null;
  integrationBranches?: SelfBuildApiIntegrationBranchSummary[] | null;
  groups?: SelfBuildApiGroupSummary[] | null;
  attentionSummary?: SelfBuildApiAttentionSummary | null;
  queueSummary?: SelfBuildApiQueueSummary | null;
  lifecycle?: SelfBuildApiLifecycle | null;
}

export interface SelfBuildApiDashboard {
  attentionSummary?: SelfBuildApiAttentionSummary | null;
  queueSummary?: SelfBuildApiQueueSummary | null;
  lifecycle?: SelfBuildApiLifecycle | null;
  recentWorkItemRuns?: SelfBuildApiRecentRunSummary[] | null;
}

export interface ValidationTraceDetail {
  status?: string | null;
  summary?: string | null;
  scenarioRunIds?: string[] | null;
  regressionRunIds?: string[] | null;
}

export interface WorkItemRunApiDetail {
  id?: string | null;
  status?: string | null;
  validationStatus?: string | null;
  comparisonToPrevious?: {
    summary?: string | null;
    previousRunId?: string | null;
  } | null;
  proposal?: {
    id?: string | null;
    title?: string | null;
    status?: string | null;
  } | null;
  workspace?: {
    id?: string | null;
    branchName?: string | null;
    status?: string | null;
  } | null;
  validation?: ValidationTraceDetail | null;
  docSuggestions?: Array<Record<string, unknown>> | null;
  failure?: Record<string, unknown> | null;
  suggestedActions?: Array<Record<string, unknown>> | null;
  links?: {
    scenarioRun?: string | null;
    regressionRun?: string | null;
  } | null;
  relationSummary?: {
    scenarioRunId?: string | null;
    regressionRunId?: string | null;
  } | null;
}

export interface ProposalArtifactApiDetail {
  id?: string | null;
  title?: string | null;
  status?: string | null;
  summary?: {
    title?: string | null;
  } | null;
}

export interface ProposalReviewPackageApiDetail {
  proposal?: {
    id?: string | null;
    title?: string | null;
    status?: string | null;
    summary?: {
      title?: string | null;
    } | null;
  } | null;
  readiness?: {
    ready?: boolean | null;
    blockers?: Array<Record<string, unknown>> | null;
    protectedScope?: string | null;
  } | null;
  promotion?: {
    status?: string | null;
    integrationBranch?: string | null;
    targetBranch?: string | null;
    sourceExecutionId?: string | null;
  } | null;
  workItemRun?: Record<string, unknown> | null;
  workItem?: Record<string, unknown> | null;
  workspace?: Record<string, unknown> | null;
  execution?: Record<string, unknown> | null;
  suggestedActions?: Array<Record<string, unknown>> | null;
  trace?: {
    promotion?: {
      ready?: boolean | null;
      summary?: string | null;
      blockers?: Array<Record<string, unknown>> | null;
    } | null;
  } | null;
}

export interface WorkspaceApiDetail {
  id?: string | null;
  status?: string | null;
  branchName?: string | null;
  baseRef?: string | null;
  worktreePath?: string | null;
  workItemId?: string | null;
  workItemRunId?: string | null;
  proposalArtifactId?: string | null;
  trace?: {
    allocation?: {
      decision?: string | null;
      summary?: string | null;
      reasons?: string[] | null;
    } | null;
  } | null;
}

export interface IntegrationBranchApiDetail {
  name?: string | null;
  status?: string | null;
  targetBranch?: string | null;
  proposalArtifactId?: string | null;
  sourceExecutionId?: string | null;
  diagnostics?: Record<string, unknown> | null;
}

export interface ScenarioRunApiDetail {
  run?: {
    id?: string | null;
    status?: string | null;
  } | null;
}

export interface RegressionRunApiDetail {
  run?: {
    id?: string | null;
    status?: string | null;
  } | null;
}

export interface RegressionReportApiDetail {
  report?: {
    summary?: string | null;
  } | null;
}

export interface SelfBuildStatModel {
  label: string;
  value: string;
  highlight: boolean;
}

export interface SelfBuildHeroModel {
  title: string;
  subtitle: string;
  freshnessLabel: string;
  routeStateLabel: string;
}

export interface SelfBuildQueueEntryModel {
  id: string;
  title: string;
  status: string;
  summary: string;
  href: string;
  evidenceLabel: string;
}

export interface SelfBuildRunModel {
  id: string;
  title: string;
  status: string;
  summary: string;
  meta: string;
  href: string;
}

export interface SelfBuildResourceModel {
  id: string;
  title: string;
  status: string;
  summary: string;
  meta: string;
  href: string;
}

export interface SelfBuildGroupModel {
  id: string;
  title: string;
  status: string;
  summary: string;
  meta: string;
}

export interface SelfBuildOverviewModel {
  hero: SelfBuildHeroModel;
  stats: SelfBuildStatModel[];
  attentionCards: SelfBuildStatModel[];
  proposalQueues: SelfBuildQueueEntryModel[];
  validationRuns: SelfBuildRunModel[];
  workspaceResources: SelfBuildResourceModel[];
  groups: SelfBuildGroupModel[];
}

export interface EvidenceFieldModel {
  label: string;
  value: string;
}

export interface EvidenceSectionModel {
  title: string;
  description?: string;
  entries: EvidenceFieldModel[];
  body?: string | null;
}

export interface EvidenceLinkModel {
  label: string;
  href: string;
}

export interface MissionEvidenceDetailModel {
  kind: MissionEvidenceKind;
  title: string;
  status: string;
  subtitle: string;
  breadcrumbs: Array<{ label: string; href?: string }>;
  summaryCards: EvidenceFieldModel[];
  relatedLinks: EvidenceLinkModel[];
  sections: EvidenceSectionModel[];
}

export interface MissionEvidenceAdapterInput {
  kind: MissionEvidenceKind;
  id: string;
  subject?: MissionEvidenceSubject;
  run?: WorkItemRunApiDetail | null;
  proposal?: ProposalArtifactApiDetail | null;
  proposalReviewPackage?: ProposalReviewPackageApiDetail | null;
  workspace?: WorkspaceApiDetail | null;
  integrationBranch?: IntegrationBranchApiDetail | null;
  scenarioRun?: ScenarioRunApiDetail | null;
  regressionRun?: RegressionRunApiDetail | null;
  regressionReport?: RegressionReportApiDetail | null;
}
