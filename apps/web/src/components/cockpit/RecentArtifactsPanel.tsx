import { FileStack } from "lucide-react";
import { Link } from "react-router-dom";

import { StatusBadge } from "../dashboard/StatusBadge.js";
import type { RecentArtifactViewModel } from "../../types/agent-cockpit.js";

interface RecentArtifactsPanelProps {
  items: RecentArtifactViewModel[];
}

export function RecentArtifactsPanel({ items }: RecentArtifactsPanelProps) {
  return (
    <section className="rounded-2xl border border-border bg-card/40 p-5">
      <div className="flex items-center gap-2">
        <FileStack className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">Recent Artifacts</h2>
      </div>

      {items.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Artifacts appear here as proposals, validation runs, workspaces, and promotion evidence land.</p>
      ) : (
        <div className="mt-4 space-y-3">
          {items.slice(0, 6).map((item) => (
            <article key={item.dedupeKey} className="rounded-xl border border-border bg-background/70 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{item.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{item.freshnessLabel}</p>
                </div>
                <StatusBadge status={item.status} />
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>{item.degraded ? "Partial detail preserved" : "Linked evidence ready"}</span>
                {item.href ? (
                  <Link to={item.href} className="font-medium text-primary hover:underline">
                    Open
                  </Link>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
