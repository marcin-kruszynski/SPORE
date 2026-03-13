import { useMemo, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";

import { AgentLaneCard } from "../components/cockpit/AgentLaneCard.js";
import { AttentionPanel } from "../components/cockpit/AttentionPanel.js";
import { RecentArtifactsPanel } from "../components/cockpit/RecentArtifactsPanel.js";
import { PageHeader } from "../components/dashboard/PageHeader.js";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.js";
import { Button } from "../components/ui/button.js";
import { useAgentCockpit } from "../features/agent-cockpit/use-agent-cockpit.js";

function EmptyState() {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-8">
      <div className="max-w-xl rounded-2xl border border-dashed border-border bg-card/40 p-8 text-center">
        <h2 className="text-lg font-semibold text-foreground">No active agents yet</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Start or resume real orchestrator work and the cockpit will project live session lanes here.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <Link to="/chat" className="rounded-md border border-border px-3 py-2 text-sm text-foreground">
            Open Chat
          </Link>
          <Link to="/mission-map" className="rounded-md border border-border px-3 py-2 text-sm text-foreground">
            Open Mission Map
          </Link>
        </div>
      </div>
    </div>
  );
}

const AgentCockpitPage = () => {
  const cockpit = useAgentCockpit();
  const [showHistory, setShowHistory] = useState(false);
  const model = cockpit.model;

  const laneById = useMemo(
    () => new Map((model?.lanes ?? []).map((lane) => [lane.id, lane] as const)),
    [model?.lanes],
  );

  const primaryThreadId = useMemo(() => {
    if (!model) {
      return null;
    }
    const candidateThreadIds = model.attention
      .map((item) => laneById.get(item.laneId ?? "")?.threadId ?? null)
      .filter(Boolean) as string[];
    const rankedThreadIds = candidateThreadIds.length > 0 ? candidateThreadIds : model.lanes.map((lane) => lane.threadId).filter(Boolean) as string[];
    if (rankedThreadIds.length === 0) {
      return null;
    }

    const threadScore = new Map<string, string>();
    for (const threadId of rankedThreadIds) {
      const latest = model.lanes
        .filter((lane) => lane.threadId === threadId)
        .map((lane) => lane.lastActivityAt ?? "")
        .sort()
        .at(-1) ?? "";
      const current = threadScore.get(threadId) ?? "";
      if (latest > current) {
        threadScore.set(threadId, latest);
      }
    }

    return [...threadScore.entries()].sort((left, right) => right[1].localeCompare(left[1]))[0]?.[0] ?? null;
  }, [laneById, model]);

  const currentLanes = model
    ? primaryThreadId
      ? model.lanes.filter((lane) => lane.threadId === primaryThreadId)
      : model.lanes
    : [];
  const historyLanes = model && primaryThreadId
    ? model.lanes.filter((lane) => lane.threadId !== primaryThreadId)
    : [];
  const currentMissionTitle = currentLanes.find((lane) => lane.missionTitle)?.missionTitle ?? null;
  const visibleLanes = showHistory && model ? model.lanes : currentLanes;

  if (cockpit.isInitialLoading) {
    return (
      <div className="flex h-screen flex-col">
        <PageHeader title="Agent Cockpit" subtitle="Live session supervision" pendingCount={0} />
        <div className="flex flex-1 items-center justify-center px-6 text-sm text-muted-foreground">
          Loading active lanes...
        </div>
      </div>
    );
  }

  if (cockpit.loadErrorMessage && !cockpit.model) {
    return (
      <div className="flex h-screen flex-col">
        <PageHeader title="Agent Cockpit" subtitle="Live session supervision" pendingCount={0} />
        <div className="flex flex-1 items-center justify-center px-6">
          <Alert className="max-w-xl border-destructive/30 bg-destructive/5">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Agent Cockpit is unavailable</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>{cockpit.loadErrorMessage}</p>
              <Button type="button" size="sm" onClick={() => void cockpit.retry()}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  if (!model || cockpit.hasLoadedEmpty) {
    return (
      <div className="flex h-screen flex-col">
        <PageHeader title="Agent Cockpit" subtitle="Live session supervision" pendingCount={0} />
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <PageHeader
        title="Agent Cockpit"
        subtitle="Live session supervision"
        pendingCount={model.attention.length}
        actions={
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={() => void cockpit.retry()}
            aria-label="Refresh cockpit"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-6">
          <section className="rounded-2xl border border-border bg-card/60 p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Session-first overview</p>
                <h1 className="mt-1 text-2xl font-semibold text-foreground">Agent Cockpit</h1>
                <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                  Keep active lanes, blockers, and fresh artifacts visible without leaving the runtime home.
                </p>
                {currentMissionTitle && (
                  <p className="mt-3 text-sm font-medium text-foreground">
                    Current mission: {currentMissionTitle}
                  </p>
                )}
              </div>
              <div className="text-sm text-muted-foreground lg:text-right">
                <p>{model.lanes.length} active lane{model.lanes.length === 1 ? "" : "s"}</p>
                <p>{model.attention.length} attention item{model.attention.length === 1 ? "" : "s"}</p>
                {historyLanes.length > 0 && (
                  <p>{historyLanes.length} historical lane{historyLanes.length === 1 ? "" : "s"} hidden</p>
                )}
              </div>
            </div>
          </section>

          {cockpit.degradedMessage && (
            <Alert className="border-warning/30 bg-warning/5">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Cockpit is in degraded mode</AlertTitle>
              <AlertDescription>
                Showing last-known lane state while live reads recover. {cockpit.degradedMessage}
              </AlertDescription>
            </Alert>
          )}

          <section className="rounded-2xl border border-border bg-card/40 p-5">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-foreground">Active Agents</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Each lane stays stable as updates arrive, so repeated events refresh context instead of creating duplicate rows.
              </p>
              {historyLanes.length > 0 && (
                <div className="mt-3">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setShowHistory((value) => !value)}
                  >
                    {showHistory ? "Hide history" : `Show history (${historyLanes.length})`}
                  </Button>
                </div>
              )}
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              {visibleLanes.map((lane) => (
                <AgentLaneCard key={lane.id} lane={lane} />
              ))}
            </div>
          </section>

          <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <AttentionPanel items={model.attention} />
            <RecentArtifactsPanel items={model.recentArtifacts} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgentCockpitPage;
