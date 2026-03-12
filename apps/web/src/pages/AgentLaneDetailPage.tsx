import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { AgentSessionSummary } from "../components/cockpit/AgentSessionSummary.js";
import { LaneUnavailableState } from "../components/cockpit/LaneUnavailableState.js";
import { PageHeader } from "../components/dashboard/PageHeader.js";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.js";
import { Button } from "../components/ui/button.js";
import { useAgentLaneDetail } from "../features/agent-cockpit/use-agent-lane-detail.js";

function UpdateList(props: {
  title: string;
  items: Array<{
    id: string;
    summary: string;
    source: "thread" | "session";
    freshnessLabel: string;
  }>;
  emptyLabel: string;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card/50 p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-foreground">{props.title}</h3>
      </div>
      {props.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{props.emptyLabel}</p>
      ) : (
        <div className="space-y-3">
          {props.items.map((item) => (
            <article key={item.id} className="rounded-xl border border-border/70 bg-background/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-foreground">{item.summary}</p>
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {item.source} - {item.freshnessLabel}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

const AgentLaneDetailPage = () => {
  const params = useParams<{ laneId: string }>();
  const detail = useAgentLaneDetail(params.laneId);

  if (detail.isInitialLoading) {
    return (
      <div className="flex h-screen flex-col">
        <PageHeader title="Agent Detail" subtitle="Loading lane detail" pendingCount={0} />
        <div className="flex flex-1 items-center justify-center px-6 text-sm text-muted-foreground">
          Loading lane context...
        </div>
      </div>
    );
  }

  if (!detail.model) {
    return (
      <div className="flex h-screen flex-col">
        <PageHeader title="Agent Detail" subtitle="Lane drill-in unavailable" pendingCount={0} />
        <div className="flex flex-1 items-center justify-center px-6">
          <Alert className="max-w-xl border-destructive/30 bg-destructive/5">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Lane detail is unavailable</AlertTitle>
            <AlertDescription>{detail.loadErrorMessage ?? "Unable to load lane detail."}</AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  const model = detail.model;

  return (
    <div className="flex h-screen flex-col">
      <PageHeader
        title="Agent Detail"
        subtitle={model.unavailable ? "Recoverable lane fallback" : model.sessionHealth.label}
        pendingCount={model.attention.length}
        actions={
          <div className="flex items-center gap-2">
            <Link
              to="/cockpit"
              className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-xs text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back to cockpit
            </Link>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs"
              onClick={() => void detail.retry()}
              aria-label="Retry lane detail"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Retry lane detail
            </Button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-6">
          {model.unavailable ? (
            <LaneUnavailableState
              routeLaneId={model.unavailable.routeLaneId}
              reason={model.unavailable.reason}
              missionTitle={model.unavailable.missionTitle}
              missionHref={model.unavailable.missionHref}
              sessionId={model.unavailable.sessionId}
            />
          ) : (
            <AgentSessionSummary detail={model} />
          )}

          {model.sessionHealth.kind !== "live" && (
            <Alert
              className={
                model.sessionHealth.kind === "reconnecting"
                  ? "border-warning/30 bg-warning/5"
                  : "border-border bg-card/60"
              }
            >
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>{model.sessionHealth.label}</AlertTitle>
              <AlertDescription>{model.sessionHealth.message}</AlertDescription>
            </Alert>
          )}

          <UpdateList
            title="Recent updates"
            items={model.recentUpdates}
            emptyLabel="No recent lane updates are visible yet."
          />

          <section className="rounded-2xl border border-border bg-card/50 p-5">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-foreground">Live session feed</h3>
            </div>
            {model.sessionEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No live session events are visible yet.</p>
            ) : (
              <div className="space-y-3">
                {model.sessionEvents.map((event) => (
                  <article
                    key={event.id}
                    className="rounded-xl border border-border/70 bg-background/60 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {event.type}
                      </p>
                      <span className="text-xs text-muted-foreground">{event.freshnessLabel}</span>
                    </div>
                    <p className="mt-2 text-sm text-foreground">{event.summary}</p>
                  </article>
                ))}
              </div>
            )}
          </section>

          <UpdateList
            title="Last visible outputs and summaries"
            items={model.lastVisibleOutputs}
            emptyLabel="No prior outputs or summaries are available yet."
          />

          <section className="rounded-2xl border border-border bg-card/50 p-5">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-foreground">Transcript preview</h3>
            </div>
            {model.transcriptPreview.content ? (
              <div className="rounded-xl border border-border/70 bg-background/80 p-4">
                <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs text-foreground">
                  {model.transcriptPreview.content}
                </pre>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span>{model.transcriptPreview.path ?? "Transcript path unavailable"}</span>
                  {model.transcriptPreview.truncated && <span>Preview truncated</span>}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Transcript preview is not available for this lane yet.
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-card/50 p-5">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-foreground">Linked artifacts</h3>
            </div>
            {model.artifacts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No linked artifacts are visible for this lane.</p>
            ) : (
              <div className="space-y-3">
                {model.artifacts.map((artifact) => (
                  <article key={artifact.dedupeKey} className="rounded-xl border border-border/70 bg-background/60 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">{artifact.label}</p>
                        <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
                          {artifact.type} - {artifact.status}
                        </p>
                      </div>
                      {artifact.href ? (
                        <Link to={artifact.href} className="text-sm text-primary hover:underline">
                          Open artifact
                        </Link>
                      ) : (
                        <span className="text-sm text-muted-foreground">Artifact link unavailable</span>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default AgentLaneDetailPage;
