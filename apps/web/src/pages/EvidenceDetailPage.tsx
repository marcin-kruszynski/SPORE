import { AlertTriangle, ArrowUpRight, RefreshCw } from "lucide-react";
import { Link, useLocation, useParams } from "react-router-dom";

import { PageHeader } from "../components/dashboard/PageHeader.js";
import { StatusBadge } from "../components/dashboard/StatusBadge.js";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.js";
import { Button } from "../components/ui/button.js";
import {
  toMissionEvidenceTarget,
  useMissionEvidence,
} from "../features/evidence/use-mission-evidence.js";

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

const EvidenceDetailPage = () => {
  const params = useParams();
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  const target = toMissionEvidenceTarget(params.kind, params.id, search.get("subject"));
  const evidence = useMissionEvidence(target);

  if (!target) {
    return (
      <div className="flex h-screen flex-col">
        <PageHeader title="Evidence" subtitle="Detail drilldown" pendingCount={0} />
        <EmptyState
          title="Evidence target is invalid"
          copy="Use a real-backed evidence link from Self-Build or Mission Control to open this route."
        />
      </div>
    );
  }

  if (evidence.isLoading && !evidence.detail) {
    return (
      <div className="flex h-screen flex-col">
        <PageHeader title="Evidence" subtitle="Detail drilldown" pendingCount={0} />
        <div className="flex flex-1 items-center justify-center px-6 text-sm text-muted-foreground">
          Loading evidence detail...
        </div>
      </div>
    );
  }

  if (evidence.errorMessage && !evidence.detail) {
    return (
      <div className="flex h-screen flex-col">
        <PageHeader title="Evidence" subtitle="Detail drilldown" pendingCount={0} />
        <div className="flex flex-1 items-center justify-center px-6">
          <Alert className="max-w-xl border-destructive/30 bg-destructive/5">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Evidence detail is unavailable</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>{evidence.errorMessage}</p>
              <Button type="button" size="sm" onClick={() => void evidence.retry()}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  if (!evidence.detail) {
    return (
      <div className="flex h-screen flex-col">
        <PageHeader title="Evidence" subtitle="Detail drilldown" pendingCount={0} />
        <EmptyState
          title="No evidence detail returned"
          copy="The orchestrator did not return a detail payload for this evidence target."
        />
      </div>
    );
  }

  const detail = evidence.detail;
  const actions = (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-8 gap-1.5 text-xs"
      onClick={() => void evidence.retry()}
    >
      <RefreshCw className="h-3.5 w-3.5" /> Refresh
    </Button>
  );

  return (
    <div className="flex h-screen flex-col">
      <PageHeader
        title={detail.title}
        subtitle={detail.subtitle}
        breadcrumbs={detail.breadcrumbs}
        pendingCount={detail.relatedLinks.length}
        actions={actions}
      />

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-6">
          <section className="rounded-2xl border border-border bg-card/60 p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Evidence detail
                </p>
                <h1 className="mt-1 text-2xl font-semibold text-foreground">{detail.title}</h1>
                <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{detail.subtitle}</p>
              </div>
              <StatusBadge status={detail.status} size="md" />
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {detail.summaryCards.map((card) => (
                <article key={card.label} className="rounded-xl border border-border bg-card/50 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{card.label}</p>
                  <p className="mt-2 text-sm font-semibold text-foreground">{card.value}</p>
                </article>
              ))}
            </div>
          </section>

          {detail.relatedLinks.length > 0 && (
            <section className="rounded-2xl border border-border bg-card/40 p-5">
              <h2 className="text-sm font-semibold text-foreground">Related Evidence</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Jump sideways into proposal, workspace, or promotion evidence without losing the operator trail.
              </p>
              <div className="mt-4 grid gap-3 lg:grid-cols-3">
                {detail.relatedLinks.map((link) => (
                  <Link
                    key={link.href}
                    to={link.href}
                    className="flex items-center justify-between rounded-xl border border-border bg-card/50 px-4 py-3 text-sm text-foreground transition-colors hover:border-primary/30 hover:bg-card"
                  >
                    <span>{link.label}</span>
                    <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                  </Link>
                ))}
              </div>
            </section>
          )}

          <div className="grid gap-4 xl:grid-cols-2">
            {detail.sections.map((section) => (
              <section key={section.title} className="rounded-2xl border border-border bg-card/40 p-5">
                <h2 className="text-sm font-semibold text-foreground">{section.title}</h2>
                {section.description && (
                  <p className="mt-1 text-sm text-muted-foreground">{section.description}</p>
                )}
                <div className="mt-4 space-y-3">
                  {section.entries.map((entry) => (
                    <div
                      key={`${section.title}:${entry.label}`}
                      className="flex items-start justify-between gap-4 border-b border-border/60 pb-3 text-sm last:border-none last:pb-0"
                    >
                      <span className="text-muted-foreground">{entry.label}</span>
                      <span className="max-w-[60%] text-right font-medium text-foreground">
                        {entry.value}
                      </span>
                    </div>
                  ))}
                  {section.body && (
                    <div className="rounded-xl border border-border bg-card/50 p-4 text-sm text-muted-foreground">
                      {section.body}
                    </div>
                  )}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>

      {evidence.errorMessage && detail && (
        <div className="border-t border-destructive/20 bg-destructive/5 px-6 py-2 text-xs text-destructive">
          {evidence.errorMessage}
        </div>
      )}
    </div>
  );
};

export default EvidenceDetailPage;
