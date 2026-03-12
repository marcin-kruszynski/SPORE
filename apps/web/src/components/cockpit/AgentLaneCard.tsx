import { Activity, ArrowRight, Bot, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";

import { StatusBadge } from "../dashboard/StatusBadge.js";
import type { AgentLaneCardViewModel } from "../../types/agent-cockpit.js";

interface AgentLaneCardProps {
  lane: AgentLaneCardViewModel;
}

function ExternalAnchor(props: { href: string; label: string; children: React.ReactNode }) {
  return (
    <a
      href={props.href}
      className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
      aria-label={props.label}
    >
      {props.children}
      <ExternalLink className="h-3.5 w-3.5" />
    </a>
  );
}

export function AgentLaneCard({ lane }: AgentLaneCardProps) {
  const newestArtifact = lane.artifactLinks[0] ?? null;

  return (
    <article className="rounded-2xl border border-border bg-card/60 p-5 shadow-sm transition-colors hover:border-primary/30">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Bot className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold text-foreground">{lane.label}</p>
              <p className="truncate text-xs uppercase tracking-wide text-muted-foreground">
                {lane.sessionId ?? lane.executionId ?? lane.threadId ?? "Unlinked lane"}
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusBadge status={lane.state} size="md" />
            {lane.stageLabel && <span className="text-sm text-foreground">{lane.stageLabel}</span>}
            <span className="text-xs text-muted-foreground">{lane.freshnessLabel}</span>
          </div>
        </div>

        {lane.detailHref ? (
          <Link
            to={lane.detailHref}
            className="inline-flex items-center gap-1 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
            aria-label={`Open ${lane.label} lane`}
          >
            Open lane
            <ArrowRight className="h-4 w-4" />
          </Link>
        ) : (
          <span
            className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm font-medium text-muted-foreground"
          >
            Inspection limited
          </span>
        )}
      </div>

      <div className="mt-4 rounded-xl border border-border/70 bg-background/60 p-4">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Activity className="h-3.5 w-3.5" />
          Latest meaningful update
        </div>
        <p className="mt-2 text-sm text-foreground">{lane.latestSummary ?? "No live summary yet."}</p>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {lane.sessionHref && (
          <ExternalAnchor href={lane.sessionHref} label="Open session">
            Session
          </ExternalAnchor>
        )}
        <Link
          to={lane.missionHref}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
          aria-label="Open mission map"
        >
          Mission
        </Link>
        {newestArtifact?.href && (
          <Link
            to={newestArtifact.href}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
            aria-label="Open newest artifact"
          >
            Artifact
          </Link>
        )}
      </div>

      {lane.degraded && (
        <p className="mt-3 text-xs text-warning">
          Live reads are degraded for this lane. Showing last-known context.
        </p>
      )}
      {lane.inspectionLimited && lane.inspectionSummary && (
        <p className="mt-3 text-xs text-muted-foreground">{lane.inspectionSummary}</p>
      )}
    </article>
  );
}
