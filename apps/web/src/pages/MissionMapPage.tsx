import { useEffect, useMemo, useState, type ElementType } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Circle,
  GitBranch,
  Loader2,
  Network,
  Pause,
  PlayCircle,
  RefreshCw,
  TerminalSquare,
  XCircle,
} from "lucide-react";

import { MissionMapCanvas } from "../components/mission-map/MissionMapCanvas.js";
import { PageHeader } from "../components/dashboard/PageHeader.js";
import { StatusBadge } from "../components/dashboard/StatusBadge.js";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.js";
import { Button } from "../components/ui/button.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { cn } from "../lib/utils.js";
import { useMissionMap } from "../features/mission-map/use-mission-map.js";
import type {
  MissionMapMission,
  MissionMapNode,
  MissionMapNodeKind,
} from "../types/mission-map.js";

type ViewMode = "graph" | "tree";

const kindIconMap: Record<MissionMapNodeKind, ElementType> = {
  mission: Network,
  execution: GitBranch,
  session: TerminalSquare,
};

const stateIcon: Record<string, { icon: ElementType; color: string }> = {
  running: { icon: Loader2, color: "text-info" },
  active: { icon: PlayCircle, color: "text-success" },
  completed: { icon: CheckCircle2, color: "text-success" },
  idle: { icon: Circle, color: "text-muted-foreground" },
  waiting: { icon: Pause, color: "text-warning" },
  blocked: { icon: XCircle, color: "text-destructive" },
  error: { icon: AlertTriangle, color: "text-destructive" },
};

function countNodes(nodes: MissionMapNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countNodes(node.children), 0);
}

function countNodesByState(nodes: MissionMapNode[], state: string): number {
  return nodes.reduce(
    (sum, node) =>
      sum + (node.state === state ? 1 : 0) + countNodesByState(node.children, state),
    0,
  );
}

function MissionSourceSummary(props: { mission: MissionMapMission }) {
  const sourceStates = Object.values(props.mission.sourceState);
  return (
    <article className="rounded-xl border border-border bg-card/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-foreground">
              {props.mission.title}
            </h3>
            <StatusBadge status={props.mission.status} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{props.mission.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span>{countNodes(props.mission.rootNodes)} nodes</span>
          {props.mission.linkedExecutionId && <code>{props.mission.linkedExecutionId}</code>}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {sourceStates.map((source) => (
          <span
            key={`${props.mission.threadId}-${source.key}`}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium",
              source.status === "ready"
                ? "border-success/30 bg-success/10 text-success"
                : source.status === "partial"
                  ? "border-warning/30 bg-warning/10 text-warning"
                  : source.status === "error"
                    ? "border-destructive/30 bg-destructive/10 text-destructive"
                    : "border-border bg-muted text-muted-foreground",
            )}
          >
            {source.detail}
          </span>
        ))}
      </div>

      {props.mission.warnings.length > 0 && (
        <div className="mt-3 rounded-lg border border-warning/20 bg-warning/5 p-3 text-xs text-warning">
          {props.mission.warnings.map((warning) => (
            <p key={`${props.mission.threadId}-${warning}`}>{warning}</p>
          ))}
        </div>
      )}
    </article>
  );
}

function MissionTreeNode(props: {
  node: MissionMapNode;
  depth?: number;
  isLast?: boolean;
  parentRunning?: boolean;
}) {
  const KindIcon = kindIconMap[props.node.kind] ?? Bot;
  const state = stateIcon[props.node.state] ?? stateIcon.idle;
  const StateIcon = state.icon;
  const isRunning = props.node.state === "running";
  const hasChildren = props.node.children.length > 0;

  return (
    <div className="relative">
      {(props.depth ?? 0) > 0 && (
        <>
          <div
            className={cn(
              "absolute -left-6 top-6 w-6 border-t",
              props.parentRunning ? "border-primary/60" : "border-border",
            )}
          />
          {!props.isLast && (
            <div
              className={cn(
                "absolute -left-6 top-6 h-full border-l",
                props.parentRunning ? "border-primary/60" : "border-border",
              )}
            />
          )}
        </>
      )}

      <div
        className={cn(
          "rounded-lg border px-4 py-3 transition-all",
          isRunning
            ? "border-primary/50 bg-primary/5 shadow-[0_0_15px_-3px_hsl(var(--primary)/0.2)]"
            : props.node.state === "blocked" || props.node.state === "error"
              ? "border-destructive/40 bg-destructive/5"
              : props.node.state === "completed"
                ? "border-success/30 bg-success/5"
                : "border-border bg-card",
        )}
      >
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
              props.node.kind === "mission"
                ? "bg-primary/15 text-primary"
                : props.node.kind === "execution"
                  ? "bg-info/15 text-info"
                  : "bg-muted text-muted-foreground",
            )}
          >
            <KindIcon className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-foreground">
                {props.node.label}
              </span>
              <StateIcon
                className={cn(
                  "h-3.5 w-3.5 shrink-0",
                  state.color,
                  isRunning && "animate-spin",
                )}
              />
            </div>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {props.node.task}
            </p>
            {typeof props.node.progress === "number" && (
              <div className="mt-2 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      props.node.state === "completed"
                        ? "bg-success"
                        : props.node.state === "blocked" || props.node.state === "error"
                          ? "bg-destructive"
                          : "bg-primary",
                    )}
                    style={{ width: `${props.node.progress}%` }}
                  />
                </div>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {props.node.progress}%
                </span>
              </div>
            )}
            {props.node.output && (
              <div className="mt-1.5 rounded bg-muted/50 px-2 py-1 font-mono text-[10px] text-muted-foreground">
                {props.node.output}
              </div>
            )}
            {props.node.badges.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {props.node.badges.map((badge) => (
                  <span
                    key={`${props.node.id}-${badge}`}
                    className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
                  >
                    {badge}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {hasChildren && (
        <div className="relative ml-10 mt-1 space-y-1">
          {props.node.children.length > 1 && (
            <div
              className={cn(
                "absolute -left-6 top-0 border-l",
                isRunning ? "border-primary/60" : "border-border",
              )}
              style={{ height: "calc(100% - 1.5rem)" }}
            />
          )}
          {props.node.children.map((child, index) => (
            <MissionTreeNode
              key={child.id}
              node={child}
              depth={(props.depth ?? 0) + 1}
              isLast={index === props.node.children.length - 1}
              parentRunning={isRunning}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MissionTree(props: { mission: MissionMapMission }) {
  const runningCount = countNodesByState(props.mission.rootNodes, "running");
  const completedCount = countNodesByState(props.mission.rootNodes, "completed");
  const blockedCount =
    countNodesByState(props.mission.rootNodes, "blocked") +
    countNodesByState(props.mission.rootNodes, "error");
  const totalCount = countNodes(props.mission.rootNodes);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card/50">
      <div className="border-b border-border bg-card px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-foreground">
                {props.mission.title}
              </h3>
              <StatusBadge status={props.mission.status} />
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{props.mission.subtitle}</p>
          </div>
          <div className="ml-4 flex shrink-0 items-center gap-3 text-[11px]">
            <span className="flex items-center gap-1 text-success">
              <CheckCircle2 className="h-3 w-3" /> {completedCount}
            </span>
            <span className="flex items-center gap-1 text-info">
              <Loader2 className="h-3 w-3" /> {runningCount}
            </span>
            {blockedCount > 0 && (
              <span className="flex items-center gap-1 text-destructive">
                <XCircle className="h-3 w-3" /> {blockedCount}
              </span>
            )}
            <span className="text-muted-foreground">{totalCount} nodes</span>
          </div>
        </div>
      </div>
      <div className="space-y-2 p-5">
        {props.mission.rootNodes.map((node) => (
          <MissionTreeNode key={node.id} node={node} />
        ))}
      </div>
    </div>
  );
}

const MissionMapPage = () => {
  const [selectedMissions, setSelectedMissions] = useState<string[]>([]);
  const [selectionInitialized, setSelectionInitialized] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("graph");
  const missionMap = useMissionMap(selectedMissions);

  useEffect(() => {
    const availableIds = missionMap.threadSummaries
      .map((thread) => String(thread.id ?? "").trim())
      .filter(Boolean);
    if (availableIds.length === 0) {
      setSelectedMissions([]);
      setSelectionInitialized(false);
      return;
    }

    setSelectedMissions((current) => {
      const filtered = current.filter((threadId) => availableIds.includes(threadId));
      if (filtered.length !== current.length) {
        return filtered;
      }
      if (!selectionInitialized) {
        return [availableIds[0]];
      }
      return current;
    });

    if (!selectionInitialized) {
      setSelectionInitialized(true);
    }
  }, [missionMap.threadSummaries, selectionInitialized]);

  const selectedMissionViews = useMemo(() => {
    const missionMapById = new Map(
      missionMap.missions.map((mission) => [mission.threadId, mission] as const),
    );
    return selectedMissions
      .map((threadId) => missionMapById.get(threadId) ?? null)
      .filter((mission): mission is MissionMapMission => Boolean(mission));
  }, [missionMap.missions, selectedMissions]);

  const toggleMission = (threadId: string) => {
    setSelectedMissions((current) =>
      current.includes(threadId)
        ? current.filter((entry) => entry !== threadId)
        : [...current, threadId],
    );
  };

  if (missionMap.isInitialLoading) {
    return (
      <div className="flex h-screen flex-col">
        <PageHeader title="Mission Map" subtitle="Runtime topology" pendingCount={0} />
        <div className="flex flex-1 items-center justify-center px-6 text-sm text-muted-foreground">
          Loading mission map...
        </div>
      </div>
    );
  }

  if (missionMap.loadErrorMessage) {
    return (
      <div className="flex h-screen flex-col">
        <PageHeader title="Mission Map" subtitle="Runtime topology" pendingCount={0} />
        <div className="flex flex-1 items-center justify-center px-6">
          <Alert className="max-w-xl border-destructive/30 bg-destructive/5">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Mission Map is unavailable</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>{missionMap.loadErrorMessage}</p>
              <Button type="button" size="sm" onClick={() => void missionMap.retry()}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  if (missionMap.hasLoadedEmpty) {
    return (
      <div className="flex h-screen flex-col">
        <PageHeader title="Mission Map" subtitle="Runtime topology" pendingCount={0} />
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="max-w-xl rounded-xl border border-dashed border-border bg-card/40 p-8 text-center">
            <h2 className="text-lg font-semibold text-foreground">No missions yet</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Start a real operator mission and this map will derive its runtime topology from the live thread, execution, and session surfaces.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <PageHeader
        title="Mission Map"
        subtitle="Runtime topology"
        pendingCount={selectedMissionViews.length}
        actions={
          <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-0.5">
            <Button
              variant={viewMode === "graph" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => setViewMode("graph")}
            >
              <Network className="h-3.5 w-3.5" /> Graph
            </Button>
            <Button
              variant={viewMode === "tree" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => setViewMode("tree")}
            >
              <GitBranch className="h-3.5 w-3.5" /> Tree
            </Button>
          </div>
        }
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b border-border bg-background px-6 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="shrink-0 text-xs font-medium text-muted-foreground">
              Missions:
            </span>
            {missionMap.threadSummaries.map((thread) => {
              const threadId = String(thread.id ?? "").trim();
              if (!threadId) {
                return null;
              }
              const isSelected = selectedMissions.includes(threadId);
              const title = String(thread.title ?? "Mission").trim() || "Mission";
              return (
                <button
                  key={threadId}
                  type="button"
                  onClick={() => toggleMission(threadId)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all",
                    isSelected
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60",
                  )}
                >
                  <Network className="h-3 w-3" />
                  {title.length > 30 ? `${title.slice(0, 30)}...` : title}
                  <StatusBadge status={String(thread.status ?? "active")} className="ml-1" />
                </button>
              );
            })}
          </div>
        </div>

        {missionMap.isMissionLoading && selectedMissionViews.length === 0 && (
          <div className="grid gap-4 border-b border-border bg-background/60 px-6 py-4 lg:grid-cols-2">
            <Skeleton className="h-28 w-full" />
          </div>
        )}

        {selectedMissionViews.length > 0 && (
          <div className="grid gap-4 border-b border-border bg-background/60 px-6 py-4 lg:grid-cols-2">
            {selectedMissionViews.map((mission) => (
              <MissionSourceSummary key={mission.threadId} mission={mission} />
            ))}
          </div>
        )}

        {selectedMissions.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6">
            <div className="text-center">
              <Network className="mx-auto mb-3 h-12 w-12 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">
                Select missions above to explore the runtime map
              </p>
            </div>
          </div>
        ) : viewMode === "graph" ? (
          <MissionMapCanvas missions={selectedMissionViews} />
        ) : (
          <div className="flex-1 overflow-y-auto p-6">
            <div
              className={cn(
                "gap-6",
                selectedMissionViews.length === 1
                  ? "mx-auto max-w-4xl"
                  : "grid grid-cols-1 xl:grid-cols-2",
              )}
            >
              {selectedMissionViews.map((mission) => (
                <MissionTree key={mission.threadId} mission={mission} />
              ))}
            </div>
          </div>
        )}
      </div>

      {missionMap.refreshErrorMessage && (
        <div className="border-b border-destructive/20 bg-destructive/5 px-6 py-2 text-xs text-destructive">
          {missionMap.refreshErrorMessage}
        </div>
      )}

      {missionMap.streamStatus && (
        <div className="border-t border-border bg-background/95 px-6 py-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-3.5 w-3.5" />
            {missionMap.streamStatus}
          </div>
        </div>
      )}
    </div>
  );
};

export default MissionMapPage;
