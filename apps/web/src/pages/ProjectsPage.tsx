import { AlertTriangle, FolderKanban, GitBranch, RefreshCw, Users } from "lucide-react";
import { Link } from "react-router-dom";

import { PageHeader } from "../components/dashboard/PageHeader.js";
import { StatusBadge } from "../components/dashboard/StatusBadge.js";
import { SummaryCard } from "../components/dashboard/SummaryCard.js";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.js";
import { Button } from "../components/ui/button.js";
import { useProjects } from "../features/projects/use-projects.js";

function EmptyState(props: { title: string; copy: string }) {
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="max-w-xl rounded-xl border border-dashed border-border bg-card/40 p-8 text-center">
        <h2 className="text-lg font-semibold text-foreground">{props.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{props.copy}</p>
      </div>
    </div>
  );
}

const ProjectsPage = () => {
  const projects = useProjects();

  if (projects.isInitialLoading && !projects.catalog) {
    return (
      <div className="flex h-screen flex-col">
        <PageHeader title="Projects" subtitle="Derived delivery contexts" pendingCount={0} />
        <div className="flex flex-1 items-center justify-center px-6 text-sm text-muted-foreground">
          Loading projects...
        </div>
      </div>
    );
  }

  if (projects.loadErrorMessage) {
    return (
      <div className="flex h-screen flex-col">
        <PageHeader title="Projects" subtitle="Derived delivery contexts" pendingCount={0} />
        <div className="flex flex-1 items-center justify-center px-6">
          <Alert className="max-w-xl border-destructive/30 bg-destructive/5">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Projects are unavailable</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>{projects.loadErrorMessage}</p>
              <Button type="button" size="sm" onClick={() => void projects.retry()}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  if (projects.hasLoadedEmpty || !projects.catalog) {
    return (
      <div className="flex h-screen flex-col">
        <PageHeader title="Projects" subtitle="Derived delivery contexts" pendingCount={0} />
        <EmptyState
          title="No projects in scope yet"
          copy="Run real managed work and this page will group execution, mission, and operator data into derived project surfaces."
        />
      </div>
    );
  }

  const actions = (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-8 gap-1.5 text-xs"
      onClick={() => void projects.retry()}
    >
      <RefreshCw className="h-3.5 w-3.5" /> Refresh
    </Button>
  );

  return (
    <div className="flex h-screen flex-col">
      <PageHeader
        title="Projects"
        subtitle="Derived from executions, missions, and operator actions"
        pendingCount={projects.catalog.stats.pendingActions}
        actions={actions}
      />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <SummaryCard
              label="Total Projects"
              value={projects.catalog.stats.totalProjects}
              icon={<FolderKanban className="h-4 w-4" />}
            />
            <SummaryCard label="Active" value={projects.catalog.stats.activeProjects} />
            <SummaryCard
              label="Pending Actions"
              value={projects.catalog.stats.pendingActions}
            />
            <SummaryCard label="Blocked" value={projects.catalog.stats.blockedProjects} />
          </div>

          <section className="space-y-3">
            {projects.projects.map((project) => (
              <Link
                key={project.id}
                to={project.href}
                className="block rounded-xl border border-border bg-card/60 p-4 transition-colors hover:border-primary/30 hover:bg-card"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate text-sm font-semibold text-foreground">
                        {project.name}
                      </h2>
                      <StatusBadge status={project.status} />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{project.summary}</p>
                    <p className="mt-2 text-xs text-muted-foreground">{project.subtitle}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground lg:min-w-[320px]">
                    <span className="flex items-center gap-1">
                      <GitBranch className="h-3 w-3" /> {project.workflowCount} workflow
                      {project.workflowCount === 1 ? "" : "s"}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" /> {project.missionCount} mission
                      {project.missionCount === 1 ? "" : "s"}
                    </span>
                    <span>{project.executionCount} execution lanes</span>
                    <span>{project.pendingActionCount} pending action{project.pendingActionCount === 1 ? "" : "s"}</span>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>Last activity {project.latestActivityLabel}</span>
                  {project.projectPath && <span>{project.projectPath}</span>}
                </div>
              </Link>
            ))}
          </section>
        </div>
      </div>

      {projects.refreshErrorMessage && (
        <div className="border-t border-destructive/20 bg-destructive/5 px-6 py-2 text-xs text-destructive">
          {projects.refreshErrorMessage}
        </div>
      )}
    </div>
  );
};

export default ProjectsPage;
