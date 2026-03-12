import { AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";

import { StatusBadge } from "../dashboard/StatusBadge.js";
import type { AttentionItemViewModel } from "../../types/agent-cockpit.js";

interface AttentionPanelProps {
  items: AttentionItemViewModel[];
}

export function AttentionPanel({ items }: AttentionPanelProps) {
  return (
    <section className="rounded-2xl border border-border bg-card/40 p-5">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-warning" />
        <h2 className="text-sm font-semibold text-foreground">Needs Attention</h2>
      </div>

      {items.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No active approvals, blockers, or stalled lanes right now.</p>
      ) : (
        <div className="mt-4 space-y-3">
          {items.map((item) => (
            <article key={item.id} className="rounded-xl border border-border bg-background/70 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{item.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{item.summary}</p>
                </div>
                <StatusBadge status={item.kind} />
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>{item.repeatCount > 1 ? `${item.repeatCount} repeated updates` : "Single active signal"}</span>
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
