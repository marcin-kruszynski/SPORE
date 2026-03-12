export interface WorkflowCatalogStats {
  totalWorkflows: number;
  runningWorkflows: number;
  blockedWorkflows: number;
  pendingActions: number;
}

export interface WorkflowEvidenceLink {
  label: string;
  href: string;
  status: string;
}

export interface WorkflowProjectSummary {
  id: string;
  name: string;
  href: string;
  status: string;
  executionCount: number;
  missionCount: number;
}

export interface WorkflowMissionSummary {
  id: string;
  title: string;
  status: string;
  objective: string;
  updatedAtLabel: string;
  pendingActionCount: number;
  executionId: string | null;
  evidenceLinks: WorkflowEvidenceLink[];
}

export interface WorkflowExecutionSummary {
  id: string;
  status: string;
  objective: string;
  updatedAtLabel: string;
  branchLabel: string;
  roleLabel: string;
  projectName: string;
  projectHref: string;
  coordinationGroupId: string | null;
}

export interface WorkflowStatCard {
  label: string;
  value: string;
  highlight: boolean;
}

export interface WorkflowSummaryModel {
  id: string;
  name: string;
  href: string;
  status: string;
  summary: string;
  subtitle: string;
  latestActivityLabel: string;
  executionCount: number;
  activeExecutionCount: number;
  blockedExecutionCount: number;
  projectCount: number;
  missionCount: number;
  pendingActionCount: number;
  workflowId: string | null;
  workflowPath: string | null;
}

export interface WorkflowDetailModel extends WorkflowSummaryModel {
  breadcrumbs: Array<{ label: string; href?: string }>;
  statCards: WorkflowStatCard[];
  projects: WorkflowProjectSummary[];
  missions: WorkflowMissionSummary[];
  executions: WorkflowExecutionSummary[];
  evidenceLinks: WorkflowEvidenceLink[];
}

export interface WorkflowCatalogModel {
  stats: WorkflowCatalogStats;
  workflows: WorkflowSummaryModel[];
}
