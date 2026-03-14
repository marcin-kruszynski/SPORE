import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ElementType,
} from "react";
import {
  Bot,
  CheckCircle2,
  Circle,
  GitBranch,
  Loader2,
  Maximize2,
  MousePointer2,
  Network,
  Pause,
  PlayCircle,
  TerminalSquare,
  XCircle,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import type {
  MissionMapMission,
  MissionMapNode,
  MissionMapNodeKind,
} from "../../types/mission-map.js";
import { cn } from "../../lib/utils.js";
import { StatusBadge } from "../dashboard/StatusBadge.js";
import { Button } from "../ui/button.js";

interface LayoutNode extends MissionMapNode {
  x: number;
  y: number;
  missionId: string;
  missionTitle: string;
  missionStatus: string;
}

const kindIconMap: Record<MissionMapNodeKind, ElementType> = {
  mission: Network,
  execution: GitBranch,
  session: TerminalSquare,
};

const stateConfig: Record<
  string,
  { icon: ElementType; color: string; glow: string; dot: string }
> = {
  running: {
    icon: Loader2,
    color: "text-info",
    glow: "shadow-[0_0_20px_-4px_hsl(var(--info)/0.5)]",
    dot: "bg-info",
  },
  active: {
    icon: PlayCircle,
    color: "text-success",
    glow: "",
    dot: "bg-success",
  },
  completed: {
    icon: CheckCircle2,
    color: "text-success",
    glow: "",
    dot: "bg-success",
  },
  idle: {
    icon: Circle,
    color: "text-muted-foreground",
    glow: "",
    dot: "bg-muted-foreground",
  },
  waiting: {
    icon: Pause,
    color: "text-warning",
    glow: "",
    dot: "bg-warning",
  },
  blocked: {
    icon: XCircle,
    color: "text-destructive",
    glow: "shadow-[0_0_20px_-4px_hsl(var(--destructive)/0.4)]",
    dot: "bg-destructive",
  },
  error: {
    icon: XCircle,
    color: "text-destructive",
    glow: "shadow-[0_0_20px_-4px_hsl(var(--destructive)/0.4)]",
    dot: "bg-destructive",
  },
};

const NODE_W = 260;
const NODE_H = 112;
const H_GAP = 70;
const V_GAP = 84;

function humanizeState(value: string) {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function measureSubtreeWidth(node: MissionMapNode): number {
  if (node.children.length === 0) {
    return NODE_W;
  }
  const childrenWidth = node.children.reduce(
    (sum, child) => sum + measureSubtreeWidth(child),
    0,
  );
  return Math.max(NODE_W, childrenWidth + H_GAP * (node.children.length - 1));
}

function layoutTree(
  node: MissionMapNode,
  x: number,
  y: number,
  mission: MissionMapMission,
): LayoutNode[] {
  const layoutNode: LayoutNode = {
    ...node,
    x,
    y,
    missionId: mission.threadId,
    missionTitle: mission.title,
    missionStatus: mission.status,
  };
  const nodes = [layoutNode];

  if (node.children.length > 0) {
    const totalWidth = node.children.reduce(
      (sum, child) => sum + measureSubtreeWidth(child),
      0,
    ) + H_GAP * (node.children.length - 1);
    let childX = x - totalWidth / 2;
    for (const child of node.children) {
      const childWidth = measureSubtreeWidth(child);
      nodes.push(
        ...layoutTree(child, childX + childWidth / 2, y + NODE_H + V_GAP, mission),
      );
      childX += childWidth + H_GAP;
    }
  }

  return nodes;
}

function layoutMissions(missions: MissionMapMission[]) {
  const nodes: LayoutNode[] = [];
  let offsetX = 0;
  for (const mission of missions) {
    let missionWidth = 0;
    for (const rootNode of mission.rootNodes) {
      missionWidth += measureSubtreeWidth(rootNode);
    }
    missionWidth += H_GAP * Math.max(0, mission.rootNodes.length - 1);

    let rootX = offsetX;
    for (const rootNode of mission.rootNodes) {
      const rootWidth = measureSubtreeWidth(rootNode);
      nodes.push(...layoutTree(rootNode, rootX + rootWidth / 2, 0, mission));
      rootX += rootWidth + H_GAP;
    }
    offsetX += missionWidth + 220;
  }
  return nodes;
}

function Edge(props: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  state: string;
}) {
  const isActive = props.state === "running" || props.state === "active";
  const isCompleted = props.state === "completed";
  const isBlocked = props.state === "blocked" || props.state === "error";
  const isWaiting = props.state === "waiting";
  const isDimmed = props.state === "idle" || isWaiting;
  const stroke = isActive
    ? "hsl(var(--primary))"
    : isCompleted
      ? "hsl(var(--success))"
      : isBlocked
        ? "hsl(var(--destructive))"
        : isWaiting
          ? "hsl(var(--warning) / 0.55)"
          : "hsl(var(--muted-foreground) / 0.25)";
  const controlOffset = Math.max(36, Math.min(96, Math.abs(props.y2 - props.y1) * 0.44));
  const pathD = `M ${props.x1} ${props.y1} C ${props.x1} ${props.y1 + controlOffset}, ${props.x2} ${props.y2 - controlOffset}, ${props.x2} ${props.y2}`;

  return (
    <>
      {(isActive || isBlocked) && (
        <path
          d={pathD}
          fill="none"
          stroke={stroke}
          strokeWidth={8}
          opacity={0.12}
          strokeLinecap="round"
        />
      )}
      <path
        d={pathD}
        fill="none"
        stroke={stroke}
        strokeWidth={isActive ? 2.8 : isBlocked ? 2.6 : isDimmed ? 1.6 : 2.2}
        strokeDasharray={isWaiting ? "6 5" : isDimmed ? "3 4" : undefined}
        opacity={isDimmed ? 0.4 : 0.92}
        strokeLinecap="round"
      />
      {isActive && (
        <circle r={3.2} fill="hsl(var(--primary))" opacity={0.9}>
          <animateMotion dur="2s" repeatCount="indefinite" path={pathD} />
        </circle>
      )}
      <circle cx={props.x1} cy={props.y1} r={2.4} fill={stroke} opacity={0.8} />
      <circle cx={props.x2} cy={props.y2} r={2.1} fill={stroke} opacity={0.72} />
    </>
  );
}

function CanvasNode(props: {
  node: LayoutNode;
  onSelect: (nodeId: string) => void;
}) {
  const KindIcon = kindIconMap[props.node.kind] ?? Bot;
  const state = stateConfig[props.node.state] ?? stateConfig.idle;
  const StateIcon = state.icon;
  const isRunning = props.node.state === "running";

  return (
    <button
      type="button"
      className={cn(
        "absolute cursor-pointer rounded-xl border bg-card/85 backdrop-blur-sm transition-all hover:scale-[1.03] hover:z-10",
        isRunning
          ? "border-primary/50 bg-primary/5"
          : props.node.state === "blocked" || props.node.state === "error"
            ? "border-destructive/30 bg-destructive/5"
            : props.node.state === "completed"
              ? "border-success/20 bg-success/5"
              : "border-border/60",
        state.glow,
      )}
      style={{
        left: props.node.x - NODE_W / 2,
        top: props.node.y,
        width: NODE_W,
        minHeight: NODE_H,
      }}
      onClick={() => props.onSelect(props.node.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onSelect(props.node.id);
        }
      }}
    >
      <div
        className={cn(
          "absolute -right-1.5 -top-1.5 h-3.5 w-3.5 rounded-full border-2 border-background",
          state.dot,
          isRunning && "animate-pulse",
        )}
      />
      <div className="p-3.5">
        <div className="flex items-start gap-2.5">
          <div
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
              props.node.kind === "mission"
                ? "bg-primary/15 text-primary"
                : props.node.kind === "execution"
                  ? "bg-info/15 text-info"
                  : "bg-muted text-muted-foreground",
            )}
          >
            <KindIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-xs font-bold text-foreground">
                {props.node.label}
              </span>
              <StateIcon
                className={cn(
                  "h-3 w-3 shrink-0",
                  state.color,
                  isRunning && "animate-spin",
                )}
                />
              </div>
              <div className="mt-1 flex items-center gap-1.5">
                <StatusBadge status={humanizeState(props.node.state)} />
                {typeof props.node.progress === "number" && (
                  <span className="font-mono text-[9px] text-muted-foreground">
                    {props.node.progress}%
                  </span>
                )}
              </div>
              <p className="mt-0.5 line-clamp-2 text-[10px] leading-tight text-muted-foreground">
                {props.node.task}
              </p>
            </div>
          </div>

        {typeof props.node.progress === "number" && (
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted/80">
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
            <span className="font-mono text-[9px] text-muted-foreground">
              {props.node.progress}%
            </span>
          </div>
        )}

        {props.node.output && (
          <div className="mt-1.5 truncate rounded bg-muted/30 px-2 py-0.5 font-mono text-[9px] text-muted-foreground">
            {props.node.output}
          </div>
        )}
      </div>
    </button>
  );
}

export function MissionMapCanvas(props: { missions: MissionMapMission[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 80, y: 80 });
  const [zoom, setZoom] = useState(0.85);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const nodes = useMemo(() => layoutMissions(props.missions), [props.missions]);
  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.id, node] as const)), [nodes]);
  const selected = selectedNodeId ? nodeMap.get(selectedNodeId) ?? null : null;
  const edges = useMemo(() => {
    const nextEdges: Array<{
      key: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      state: string;
    }> = [];
    for (const node of nodes) {
      for (const child of node.children) {
        const childNode = nodeMap.get(child.id);
        if (!childNode) {
          continue;
        }
        nextEdges.push({
          key: `${node.id}-${childNode.id}`,
          x1: node.x,
          y1: node.y + NODE_H,
          x2: childNode.x,
          y2: childNode.y,
          state: childNode.state,
        });
      }
    }
    return nextEdges;
  }, [nodeMap, nodes]);

  const bounds = useMemo(() => {
    const minX = Math.min(...nodes.map((node) => node.x - NODE_W / 2), 0) - 100;
    const minY = Math.min(...nodes.map((node) => node.y), 0) - 100;
    const maxX = Math.max(...nodes.map((node) => node.x + NODE_W / 2), 0) + 100;
    const maxY = Math.max(...nodes.map((node) => node.y + NODE_H), 0) + 100;
    return { minX, minY, maxX, maxY };
  }, [nodes]);

  const handleWheel = useCallback((event: React.WheelEvent) => {
    event.preventDefault();
    const delta = -event.deltaY * 0.001;
    setZoom((currentZoom) => Math.min(2, Math.max(0.2, currentZoom + delta)));
  }, []);

  const handleMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (event.button !== 0) {
        return;
      }
      setIsPanning(true);
      setPanStart({ x: event.clientX - pan.x, y: event.clientY - pan.y });
    },
    [pan],
  );

  const handleMouseMove = useCallback(
    (event: React.MouseEvent) => {
      if (!isPanning) {
        return;
      }
      setPan({ x: event.clientX - panStart.x, y: event.clientY - panStart.y });
    },
    [isPanning, panStart],
  );

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  const fitView = useCallback(() => {
    if (!containerRef.current || nodes.length === 0) {
      return;
    }
    const rect = containerRef.current.getBoundingClientRect();
    const contentWidth = bounds.maxX - bounds.minX;
    const contentHeight = bounds.maxY - bounds.minY;
    const scaleX = rect.width / contentWidth;
    const scaleY = rect.height / contentHeight;
    const nextZoom = Math.min(scaleX, scaleY, 1) * 0.9;
    setZoom(Math.min(1, Math.max(0.35, nextZoom)));
    setPan({
      x: (rect.width - contentWidth * nextZoom) / 2 - bounds.minX * nextZoom,
      y: (rect.height - contentHeight * nextZoom) / 2 - bounds.minY * nextZoom,
    });
  }, [bounds.maxX, bounds.maxY, bounds.minX, bounds.minY, nodes.length]);

  useEffect(() => {
    if (nodes.length > 0) {
      fitView();
    }
  }, [fitView, nodes.length]);

  useEffect(() => {
    if (selectedNodeId && !nodeMap.has(selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [nodeMap, selectedNodeId]);

  if (props.missions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <MousePointer2 className="mx-auto mb-3 h-12 w-12 text-muted-foreground/20" />
          <p className="text-sm text-muted-foreground">
            Select missions above to explore the graph
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex-1 overflow-hidden">
      <div className="absolute right-4 top-4 z-20 flex flex-col gap-1">
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 bg-card/90 backdrop-blur"
          onClick={() => setZoom((currentZoom) => Math.min(2, currentZoom + 0.15))}
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 bg-card/90 backdrop-blur"
          onClick={() => setZoom((currentZoom) => Math.max(0.2, currentZoom - 0.15))}
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 bg-card/90 backdrop-blur"
          onClick={fitView}
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="absolute bottom-4 right-4 z-20 rounded-md border border-border bg-card/90 px-2.5 py-1 font-mono text-[10px] text-muted-foreground backdrop-blur">
        {Math.round(zoom * 100)}%
      </div>

      {/* biome-ignore lint/a11y/noStaticElementInteractions: the canvas surface handles pointer-based panning. */}
      {/* biome-ignore lint/a11y/useKeyWithMouseEvents: the canvas surface intentionally uses pointer gestures only. */}
      <div
        ref={containerRef}
        className={cn("h-full w-full", isPanning ? "cursor-grabbing" : "cursor-grab")}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          backgroundImage:
            "radial-gradient(circle, hsl(var(--border) / 0.3) 1px, transparent 1px)",
          backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
      >
        <div
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
            position: "relative",
          }}
        >
          <svg
            className="absolute pointer-events-none"
            style={{
              left: bounds.minX,
              top: bounds.minY,
              width: bounds.maxX - bounds.minX,
              height: bounds.maxY - bounds.minY,
              overflow: "visible",
            }}
            viewBox={`${bounds.minX} ${bounds.minY} ${bounds.maxX - bounds.minX} ${bounds.maxY - bounds.minY}`}
          >
            <title>Mission map edges</title>
            {edges.map((edge) => (
              <Edge
                key={edge.key}
                x1={edge.x1}
                y1={edge.y1}
                x2={edge.x2}
                y2={edge.y2}
                state={edge.state}
              />
            ))}
          </svg>
          {nodes.map((node) => (
            <CanvasNode key={node.id} node={node} onSelect={setSelectedNodeId} />
          ))}
          {props.missions.map((mission) => {
            const missionNodes = nodes.filter(
              (node) => node.missionId === mission.threadId && node.kind === "mission",
            );
            const firstNode = missionNodes[0];
            if (!firstNode) {
              return null;
            }
            return (
              <div
                key={mission.threadId}
                className="pointer-events-none absolute flex items-center gap-2"
                style={{ left: firstNode.x - NODE_W / 2, top: firstNode.y - 40 }}
              >
                <span className="text-[11px] font-bold uppercase tracking-wider text-foreground/70">
                  {mission.title}
                </span>
                <StatusBadge status={mission.status} />
              </div>
            );
          })}
        </div>
      </div>

      {selected && (
        <div className="absolute bottom-4 left-4 z-20 w-80 rounded-xl border border-border bg-card/95 p-4 backdrop-blur-md">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-bold text-foreground">{selected.label}</span>
            <button
              type="button"
              onClick={() => setSelectedNodeId(null)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              x
            </button>
          </div>
          <p className="mb-2 text-[11px] text-muted-foreground">{selected.task}</p>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={selected.state} />
            {typeof selected.progress === "number" && (
              <span className="font-mono text-[10px] text-muted-foreground">
                {selected.progress}%
              </span>
            )}
            {selected.badges.map((badge) => (
              <span
                key={`${selected.id}-${badge}`}
                className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
              >
                {badge}
              </span>
            ))}
          </div>
          {selected.output && (
            <div className="rounded bg-muted/40 px-2 py-1 font-mono text-[10px] text-muted-foreground">
              {selected.output}
            </div>
          )}
          <div className="mt-2 border-t border-border pt-2 text-[10px] text-muted-foreground">
            Mission: <span className="font-medium text-foreground">{selected.missionTitle}</span>
          </div>
        </div>
      )}
    </div>
  );
}
