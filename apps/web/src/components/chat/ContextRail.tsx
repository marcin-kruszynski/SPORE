import { ChevronRight } from "lucide-react";

import type { OperatorMissionDetail } from "../../types/operator-chat.js";
import { StatusBadge } from "../dashboard/StatusBadge.js";

interface ContextRailProps {
  thread: OperatorMissionDetail;
}

export function ContextRail({ thread }: ContextRailProps) {
  return (
    <div className="flex h-full flex-col border-l border-border bg-card/30">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Context</h3>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="border-b border-border/50 px-4 py-3">
          <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Current State</h4>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Status</span>
              <StatusBadge status={thread.status} size="sm" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Phase</span>
              <span className="text-xs font-medium text-foreground">{thread.hero.phase}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Pending</span>
              <span className="text-xs font-medium text-warning">
                {thread.pendingActions.length} action{thread.pendingActions.length === 1 ? "" : "s"}
              </span>
            </div>
            {thread.progress.exceptionState && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Exception</span>
                <span className="text-xs font-medium text-destructive">
                  {thread.progress.exceptionState}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="border-b border-border/50 px-4 py-3">
          <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Current Decision</h4>
          <div className="space-y-2 text-xs text-foreground/80">
            <p className="font-medium text-foreground">{thread.decisionGuidance.title}</p>
            <p>{thread.decisionGuidance.why}</p>
            <div>
              <span className="text-muted-foreground">Next:</span> {thread.decisionGuidance.nextIfApproved}
            </div>
            <div>
              <span className="text-muted-foreground">Risk:</span> {thread.decisionGuidance.riskNote}
            </div>
          </div>
        </div>

        {thread.pendingActions.length > 0 && (
          <div className="border-b border-border/50 px-4 py-3">
            <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Pending Actions</h4>
            <div className="space-y-1.5">
              {thread.pendingActions.map((action) => (
                <div key={action.id} className="rounded-md bg-warning/5 px-2.5 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                    <span className="flex-1 text-foreground">{action.decisionTitle}</span>
                  </div>
                  <p className="mt-1 text-muted-foreground">{action.reason}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {thread.evidenceItems.length > 0 && (
          <div className="border-b border-border/50 px-4 py-3">
            <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Evidence</h4>
            <div className="space-y-1.5">
              {thread.evidenceItems.map((item) => (
                <div key={`${item.key}:${item.id}`} className="flex items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent/50">
                  <div className="flex-1">
                    <span className="text-[10px] font-medium uppercase text-muted-foreground">{item.key}</span>
                    <p className="text-xs text-foreground">{item.label}</p>
                  </div>
                  <StatusBadge status={item.status} size="sm" />
                </div>
              ))}
            </div>
          </div>
        )}

        {thread.linkedArtifacts.length > 0 && (
          <div className="px-4 py-3">
            <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Linked Artifacts</h4>
            <div className="space-y-1.5">
              {thread.linkedArtifacts.map((artifact) => (
                <button key={`${artifact.type}:${artifact.id}`} type="button" className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent/50">
                  <div className="flex-1">
                    <span className="text-[10px] font-medium uppercase text-muted-foreground">{artifact.type}</span>
                    <p className="text-xs text-foreground">{artifact.label}</p>
                  </div>
                  <StatusBadge status={artifact.status} size="sm" />
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="border-t border-border/50 px-4 py-3">
          <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Runtime</h4>
          <div className="space-y-2 text-xs text-foreground/80">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Project</span>
              <span className="font-medium text-foreground">{thread.context.projectId}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Runtime</span>
              <span className="font-medium text-foreground">{thread.context.runtimeLabel}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Safe Mode</span>
              <span className="font-medium text-foreground">{thread.context.safeModeLabel}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Auto Validate</span>
              <span className="font-medium text-foreground">{thread.context.autoValidateLabel}</span>
            </div>
            {thread.context.quarantineLabel && (
              <p className="rounded-md bg-destructive/5 px-2.5 py-2 text-destructive">
                {thread.context.quarantineLabel}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
