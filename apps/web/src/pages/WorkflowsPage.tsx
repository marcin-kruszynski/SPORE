import { AlertTriangle, GitBranch, Layers3, RefreshCw, Users } from "lucide-react";
import { Link } from "react-router-dom";

import { PageHeader } from "../components/dashboard/PageHeader.js";
import { StatusBadge } from "../components/dashboard/StatusBadge.js";
import { SummaryCard } from "../components/dashboard/SummaryCard.js";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.js";
import { Button } from "../components/ui/button.js";
import { useWorkflows } from "../features/workflows/use-workflows.js";

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

const WorkflowsPage = () => {
  const workflows = useWorkflows();

  if (workflows.isInitialLoading && !workflows.catalog) {
    return (
      <div className="flex h-screen flex-col">
        <PageHeader title="Workflows" subtitle="Derived workflow surfaces" pendingCount={0} />
        <div className="flex flex-1 items-center justify-center px-6 text-sm text-muted-foreground">
          Loading workflows...
        </div>
      </div>
    );
  }

  if (workflows.loadErrorMessage) {
    return (
      <div className="flex h-screen flex-col">
        <PageHeader title="Workflows" subtitle="Derived workflow surfaces" pendingCount={0} />
        <div className="flex flex-1 items-center justify-center px-6">
          <Alert className="max-w-xl border-destructive/30 bg-destructive/5">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Workflows are unavailable</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>{workflows.loadErrorMessage}</p>
              <Button type="button" size="sm" onClick={() => void workflows.retry()}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  if (workflows.hasLoadedEmpty || !workflows.catalog) {
    return (
      <div className="flex h-screen flex-col">
        <PageHeader title="Workflows" subtitle="Derived workflow surfaces" pendingCount={0} />
        <EmptyState
          title="No workflows in scope yet"
          copy="Run real orchestrator executions and this page will derive workflow surfaces from current SPORE data."
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
      onClick={() => void workflows.retry()}
    >
      <RefreshCw className="h-3.5 w-3.5" /> Refresh
    </Button>
  );

  return (
    <div className="flex h-screen flex-col">
      <PageHeader
        title="Workflows"
        subtitle="Derived from execution lanes and linked operator missions"
        pendingCount={workflows.catalog.stats.pendingActions}
        actions={actions}
      />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <SummaryCard
              label="Total Workflows"
              value={workflows.catalog.stats.totalWorkflows}
              icon={<Layers3 className="h-4 w-4" />}
            />
            <SummaryCard label="Running" value={workflows.catalog.stats.runningWorkflows} />
            <SummaryCard
              label="Pending Actions"
              value={workflows.catalog.stats.pendingActions}
            />
            <SummaryCard label="Blocked" value={workflows.catalog.stats.blockedWorkflows} />
          </div>

          <section className="space-y-3">
            {workflows.workflows.map((workflow) => (
              <Link
                key={workflow.id}
                to={workflow.href}
                className="block rounded-xl border border-border bg-card/60 p-4 transition-colors hover:border-primary/30 hover:bg-card"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <GitBranch className="h-4 w-4 text-primary" />
                      <h2 className="truncate text-sm font-semibold text-foreground">
                        {workflow.name}
                      </h2>
                      <StatusBadge status={workflow.status} />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{workflow.summary}</p>
                    <p className="mt-2 text-xs text-muted-foreground">{workflow.subtitle}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground lg:min-w-[320px]">
                    <span>{workflow.executionCount} execution lanes</span>
                    <span>{workflow.projectCount} project{workflow.projectCount === 1 ? "" : "s"}</span>
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" /> {workflow.missionCount} mission
                      {workflow.missionCount === 1 ? "" : "s"}
                    </span>
                    <span>{workflow.pendingActionCount} pending action{workflow.pendingActionCount === 1 ? "" : "s"}</span>
                  </div>
                </div>

                <div className="mt-3 text-xs text-muted-foreground">
                  Last activity {workflow.latestActivityLabel}
                </div>
              </Link>
            ))}
          </section>
        </div>
      </div>

      {workflows.refreshErrorMessage && (
        <div className="border-t border-destructive/20 bg-destructive/5 px-6 py-2 text-xs text-destructive">
          {workflows.refreshErrorMessage}
        </div>
      )}
    </div>
  );
};

export default WorkflowsPage;
