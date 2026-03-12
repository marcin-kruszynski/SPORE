export interface ProjectCatalogStats {
  totalProjects: number;
  activeProjects: number;
  blockedProjects: number;
  pendingActions: number;
}

export interface ProjectEvidenceLink {
  label: string;
  href: string;
  status: string;
}

export interface ProjectWorkflowSummary {
  id: string;
  name: string;
  href: string;
  status: string;
  executionCount: number;
  missionCount: number;
  pendingActionCount: number;
}

export interface ProjectMissionSummary {
  id: string;
  title: string;
  status: string;
  objective: string;
  updatedAtLabel: string;
  pendingActionCount: number;
  executionId: string | null;
  evidenceLinks: ProjectEvidenceLink[];
}

export interface ProjectExecutionSummary {
  id: string;
  status: string;
  objective: string;
  updatedAtLabel: string;
  branchLabel: string;
  roleLabel: string;
  workflowName: string;
  coordinationGroupId: string | null;
}

export interface ProjectStatCard {
  label: string;
  value: string;
  highlight: boolean;
}

export interface ProjectSummaryModel {
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
  workflowCount: number;
  missionCount: number;
  pendingActionCount: number;
  projectId: string | null;
  projectPath: string | null;
}

export interface ProjectDetailModel extends ProjectSummaryModel {
  breadcrumbs: Array<{ label: string; href?: string }>;
  statCards: ProjectStatCard[];
  workflows: ProjectWorkflowSummary[];
  missions: ProjectMissionSummary[];
  executions: ProjectExecutionSummary[];
  evidenceLinks: ProjectEvidenceLink[];
}

export interface ProjectCatalogModel {
  stats: ProjectCatalogStats;
  projects: ProjectSummaryModel[];
}
