import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";

import { adaptSelfBuildOverview } from "../adapters/self-build.js";
import { PageHeader } from "../components/dashboard/PageHeader.js";
import { StatusBadge } from "../components/dashboard/StatusBadge.js";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.js";
import { Button } from "../components/ui/button.js";
import { getSelfBuildDashboard, getSelfBuildSummary } from "../lib/api/self-build.js";
import type { SelfBuildOverviewModel } from "../types/self-build.js";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Self-Build is unavailable.";
}

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

function StatGrid(props: { items: SelfBuildOverviewModel["stats"] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {props.items.map((item) => (
        <article
          key={item.label}
          className={[
            "rounded-xl border bg-card/60 p-4",
            item.highlight ? "border-primary/30" : "border-border",
          ].join(" ")}
        >
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{item.label}</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{item.value}</p>
        </article>
      ))}
    </div>
  );
}

function EvidenceLinkCard(props: {
  title: string;
  status: string;
  summary: string;
  meta: string;
  href: string;
  eyebrow: string;
}) {
  return (
    <Link
      to={props.href}
      className="block rounded-xl border border-border bg-card/50 p-4 transition-colors hover:border-primary/30 hover:bg-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {props.eyebrow}
          </p>
          <h3 className="mt-1 truncate text-sm font-semibold text-foreground">{props.title}</h3>
        </div>
        <StatusBadge status={props.status} size="sm" />
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{props.summary}</p>
      <p className="mt-3 text-xs text-muted-foreground">{props.meta}</p>
    </Link>
  );
}

function Section(props: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card/40 p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{props.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{props.description}</p>
        </div>
      </div>
      {props.children}
    </section>
  );
}

const SelfBuildPage = () => {
  const dashboardQuery = useQuery({
    queryKey: ["self-build", "page"],
    queryFn: async () => {
      const [summary, dashboard] = await Promise.all([
        getSelfBuildSummary(),
        getSelfBuildDashboard(),
      ]);
      return adaptSelfBuildOverview({ summary, dashboard });
    },
  });

  const model = useMemo(() => dashboardQuery.data ?? null, [dashboardQuery.data]);

  if (dashboardQuery.isLoading && !model) {
    return (
      <div className="flex h-screen flex-col">
        <PageHeader title="Self-Build" subtitle="Governed evidence overview" pendingCount={0} />
        <div className="flex flex-1 items-center justify-center px-6 text-sm text-muted-foreground">
          Loading self-build...
        </div>
      </div>
    );
  }

  if (dashboardQuery.error && !model) {
    return (
      <div className="flex h-screen flex-col">
        <PageHeader title="Self-Build" subtitle="Governed evidence overview" pendingCount={0} />
        <div className="flex flex-1 items-center justify-center px-6">
          <Alert className="max-w-xl border-destructive/30 bg-destructive/5">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Self-Build is unavailable</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>{getErrorMessage(dashboardQuery.error)}</p>
              <Button type="button" size="sm" onClick={() => void dashboardQuery.refetch()}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  if (!model) {
    return (
      <div className="flex h-screen flex-col">
        <PageHeader title="Self-Build" subtitle="Governed evidence overview" pendingCount={0} />
        <EmptyState
          title="No self-build evidence yet"
          copy="Run real managed work and this page will project proposal, validation, promotion, and workspace evidence from the orchestrator read surfaces."
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
      onClick={() => void dashboardQuery.refetch()}
    >
      <RefreshCw className="h-3.5 w-3.5" /> Refresh
    </Button>
  );

  return (
    <div className="flex h-screen flex-col">
      <PageHeader
        title={model.hero.title}
        subtitle={model.hero.subtitle}
        pendingCount={model.proposalQueues.length}
        actions={actions}
      />

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-6">
          <section className="rounded-2xl border border-border bg-card/60 p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Real-backed summary
                </p>
                <h1 className="mt-1 text-2xl font-semibold text-foreground">{model.hero.title}</h1>
                <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                  {model.hero.subtitle}
                </p>
              </div>
              <div className="space-y-1 text-sm text-muted-foreground lg:text-right">
                <p>{model.hero.freshnessLabel}</p>
                <p>{model.hero.routeStateLabel}</p>
              </div>
            </div>
          </section>

          <StatGrid items={model.stats} />

          <Section
            title="Operator Attention"
            description="Urgency, follow-up pressure, and readiness counters the operator should scan first."
          >
            <StatGrid items={model.attentionCards} />
          </Section>

          <Section
            title="Proposal & Governance Queue"
            description="Proposal review, approval, validation-required, and promotion-blocked entries open into evidence drilldowns."
          >
            {model.proposalQueues.length > 0 ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {model.proposalQueues.map((entry) => (
                  <EvidenceLinkCard
                    key={entry.id}
                    title={entry.title}
                    status={entry.status}
                    summary={entry.summary}
                    meta={entry.evidenceLabel}
                    href={entry.href}
                    eyebrow="Proposal evidence"
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                title="No proposal evidence in queue"
                copy="The orchestrator has no proposal items waiting for review, approval, validation, or promotion attention right now."
              />
            )}
          </Section>

          <Section
            title="Recent Validation Runs"
            description="Each run drilldown keeps proposal, validation, workspace, scenario, and regression evidence visible together."
          >
            {model.validationRuns.length > 0 ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {model.validationRuns.map((run) => (
                  <EvidenceLinkCard
                    key={run.id}
                    title={run.title}
                    status={run.status}
                    summary={run.summary}
                    meta={run.meta}
                    href={run.href}
                    eyebrow="Validation evidence"
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No recent work-item runs are available.</p>
            )}
          </Section>

          <Section
            title="Workspace & Promotion Context"
            description="Surface live workspaces and integration branches so promotion blockers and mutable work context stay inspectable."
          >
            {model.workspaceResources.length > 0 ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {model.workspaceResources.map((resource) => (
                  <EvidenceLinkCard
                    key={`${resource.id}:${resource.href}`}
                    title={resource.title}
                    status={resource.status}
                    summary={resource.summary}
                    meta={resource.meta}
                    href={resource.href}
                    eyebrow="Runtime context"
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No workspace or promotion resources are available.</p>
            )}
          </Section>

          <Section
            title="Managed Work Groups"
            description="Keep readiness context visible even before the group-specific React drilldowns are added."
          >
            {model.groups.length > 0 ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {model.groups.map((group) => (
                  <article key={group.id} className="rounded-xl border border-border bg-card/50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">{group.title}</h3>
                        <p className="mt-2 text-sm text-muted-foreground">{group.summary}</p>
                      </div>
                      <StatusBadge status={group.status} size="sm" />
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">{group.meta}</p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No managed work groups are in scope.</p>
            )}
          </Section>
        </div>
      </div>

      {dashboardQuery.error && model && (
        <div className="border-t border-destructive/20 bg-destructive/5 px-6 py-2 text-xs text-destructive">
          {getErrorMessage(dashboardQuery.error)}
        </div>
      )}
    </div>
  );
};

export default SelfBuildPage;
