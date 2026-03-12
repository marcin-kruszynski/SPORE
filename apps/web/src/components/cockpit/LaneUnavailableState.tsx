import { AlertTriangle, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

interface LaneUnavailableStateProps {
  routeLaneId: string;
  reason: string;
  missionTitle: string | null;
  missionHref: string | null;
  sessionId: string | null;
}

export function LaneUnavailableState({
  routeLaneId,
  reason,
  missionTitle,
  missionHref,
  sessionId,
}: LaneUnavailableStateProps) {
  return (
    <section className="rounded-2xl border border-warning/30 bg-warning/5 p-6">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 text-warning" />
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold text-foreground">Lane unavailable</h2>
          <p className="mt-2 text-sm text-muted-foreground">{reason}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-border/70 bg-background/70 p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Route param</p>
          <p className="mt-1 text-sm text-foreground">{routeLaneId}</p>
        </div>
        <div className="rounded-xl border border-border/70 bg-background/70 p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Last known mission</p>
          {missionTitle ? (
            missionHref ? (
              <Link to={missionHref} className="mt-1 inline-flex text-sm text-primary hover:underline">
                {missionTitle}
              </Link>
            ) : (
              <p className="mt-1 text-sm text-foreground">{missionTitle}</p>
            )
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">No mission linkage available.</p>
          )}
        </div>
        <div className="rounded-xl border border-border/70 bg-background/70 p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Last known session</p>
          <p className="mt-1 text-sm text-foreground">{sessionId ?? "No session linkage available."}</p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <Link
          to="/cockpit"
          className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-sm text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Open cockpit home
        </Link>
      </div>
    </section>
  );
}
