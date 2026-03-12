import { ArrowLeft, ExternalLink, GitBranch, Workflow } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { PageHeader } from "../components/dashboard/PageHeader.js";
import { StatusBadge } from "../components/dashboard/StatusBadge.js";
import { SummaryCard } from "../components/dashboard/SummaryCard.js";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.js";
import { Button } from "../components/ui/button.js";
import { useProjects } from "../features/projects/use-projects.js";

function Section(props: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card/40 p-5">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-foreground">{props.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{props.description}</p>
      </div>
      {props.children}
    </section>
  );
}

const ProjectDetailPage = () => {
  const { id } = useParams();
  const projects = useProjects();
  const detail = id ? (projects.projectMap.get(id) ?? null) : null;

  if (projects.isInitialLoading && !detail) {
    return (
      <div className="flex h-screen flex-col">
        <PageHeader title="Project" subtitle="Derived project detail" pendingCount={0} />
        <div className="flex flex-1 items-center justify-center px-6 text-sm text-muted-foreground">
          Loading project detail...
        </div>
      </div>
    );
  }

  if (projects.loadErrorMessage && !detail) {
    return (
      <div className="flex h-screen flex-col">
        <PageHeader title="Project" subtitle="Derived project detail" pendingCount={0} />
        <div className="flex flex-1 items-center justify-center px-6">
          <Alert className="max-w-xl border-destructive/30 bg-destructive/5">
            <AlertTitle>Project detail is unavailable</AlertTitle>
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

  if (!detail) {
    return <div className="p-6 text-muted-foreground">Project not found</div>;
  }

  return (
    <div className="flex h-screen flex-col">
      <PageHeader title={detail.name} breadcrumbs={detail.breadcrumbs} pendingCount={detail.pendingActionCount} />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-6">
          <div className="flex items-center gap-3">
            <Link to="/projects">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Back
              </Button>
            </Link>
            <StatusBadge status={detail.status} size="md" />
          </div>

          <section className="rounded-2xl border border-border bg-card/60 p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h1 className="text-2xl font-semibold text-foreground">{detail.name}</h1>
                <p className="mt-2 text-sm text-muted-foreground">{detail.summary}</p>
                <p className="mt-2 text-xs text-muted-foreground">{detail.subtitle}</p>
              </div>
              <div className="space-y-1 text-sm text-muted-foreground lg:text-right">
                <p>Last activity {detail.latestActivityLabel}</p>
                {detail.projectPath && <p>{detail.projectPath}</p>}
              </div>
            </div>
          </section>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {detail.statCards.map((card) => (
              <SummaryCard
                key={card.label}
                label={card.label}
                value={card.value}
                className={card.highlight ? "border-primary/30" : undefined}
              />
            ))}
          </div>

          <Section
            title="Related Workflows"
            description="Workflows derived from the execution lanes currently associated with this project."
          >
            {detail.workflows.length > 0 ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {detail.workflows.map((workflow) => (
                  <Link
                    key={workflow.id}
                    to={workflow.href}
                    className="rounded-xl border border-border bg-card/50 p-4 transition-colors hover:border-primary/30 hover:bg-card"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">{workflow.name}</h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {workflow.executionCount} executions · {workflow.missionCount} missions
                        </p>
                      </div>
                      <StatusBadge status={workflow.status} />
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No workflow lanes are linked to this project yet.</p>
            )}
          </Section>

          <Section
            title="Mission Context"
            description="Operator threads stay attached so review state and evidence remain visible next to project execution data."
          >
            {detail.missions.length > 0 ? (
              <div className="space-y-3">
                {detail.missions.map((mission) => (
                  <article key={mission.id} className="rounded-xl border border-border bg-card/50 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-sm font-semibold text-foreground">
                            {mission.title}
                          </h3>
                          <StatusBadge status={mission.status} />
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">{mission.objective}</p>
                      </div>
                      <div className="text-xs text-muted-foreground lg:text-right">
                        <p>{mission.pendingActionCount} pending action{mission.pendingActionCount === 1 ? "" : "s"}</p>
                        <p className="mt-1">Updated {mission.updatedAtLabel}</p>
                      </div>
                    </div>

                    {mission.evidenceLinks.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {mission.evidenceLinks.map((link) => (
                          <Link
                            key={link.href}
                            to={link.href}
                            className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
                          >
                            {link.label} <ExternalLink className="h-3 w-3" />
                          </Link>
                        ))}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No operator missions are linked to this project yet.</p>
            )}
          </Section>

          <Section
            title="Execution Lanes"
            description="Recent project executions grouped into this derived detail view from the real orchestrator execution store."
          >
            {detail.executions.length > 0 ? (
              <div className="space-y-3">
                {detail.executions.map((execution) => (
                  <article key={execution.id} className="rounded-xl border border-border bg-card/50 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold text-foreground">{execution.objective}</h3>
                          <StatusBadge status={execution.status} />
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {execution.workflowName} · {execution.roleLabel} · {execution.branchLabel}
                        </p>
                      </div>
                      <div className="text-xs text-muted-foreground lg:text-right">
                        <p>Execution {execution.id}</p>
                        <p className="mt-1">Updated {execution.updatedAtLabel}</p>
                        {execution.coordinationGroupId && (
                          <p className="mt-1">Group {execution.coordinationGroupId}</p>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No executions are linked to this project yet.</p>
            )}
          </Section>

          <Section
            title="Evidence Links"
            description="Real evidence drilldowns derived from mission-linked artifacts for this project."
          >
            {detail.evidenceLinks.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {detail.evidenceLinks.map((link) => (
                  <Link
                    key={link.href}
                    to={link.href}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
                  >
                    {link.label} <ExternalLink className="h-3 w-3" />
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No evidence links are attached to this project yet.</p>
            )}
          </Section>
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

export default ProjectDetailPage;
