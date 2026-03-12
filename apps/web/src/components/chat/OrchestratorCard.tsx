import {
  AlertTriangle,
  ArrowRight,
  CheckCircle,
  GitBranch,
  Info,
  Link2,
  ShieldAlert,
  Target,
} from "lucide-react";

import { cn } from "../../lib/utils.js";
import type { OperatorMissionMessage } from "../../types/operator-chat.js";
import { Button } from "../ui/button.js";

interface OrchestratorCardProps {
  message: OperatorMissionMessage;
  resolvingActionId?: string | null;
  actionError?: string | null;
  onResolveAction: (actionId: string, choice: string) => Promise<unknown>;
}

const typeConfig: Record<
  string,
  {
    icon: React.ElementType;
    accent: string;
    bg: string;
    border: string;
    label: string;
  }
> = {
  "summary": {
    icon: Info,
    accent: "text-primary",
    bg: "bg-primary/5",
    border: "border-primary/20",
    label: "Mission Update",
  },
  "action-request": {
    icon: Target,
    accent: "text-warning",
    bg: "bg-warning/5",
    border: "border-warning/20",
    label: "Decision Required",
  },
  "action-result": {
    icon: CheckCircle,
    accent: "text-success",
    bg: "bg-success/5",
    border: "border-success/20",
    label: "Decision Recorded",
  },
  "event": {
    icon: GitBranch,
    accent: "text-info",
    bg: "bg-info/5",
    border: "border-info/20",
    label: "Workflow Update",
  },
  "message": {
    icon: ArrowRight,
    accent: "text-muted-foreground",
    bg: "bg-muted/40",
    border: "border-border",
    label: "Message",
  },
  "warning": {
    icon: AlertTriangle,
    accent: "text-warning",
    bg: "bg-warning/5",
    border: "border-warning/20",
    label: "Warning",
  },
  "blocker": {
    icon: ShieldAlert,
    accent: "text-destructive",
    bg: "bg-destructive/5",
    border: "border-destructive/20",
    label: "Blocker",
  },
};

const actionVariantStyles: Record<string, string> = {
  primary: "bg-primary hover:bg-primary/90 text-primary-foreground",
  secondary: "bg-secondary hover:bg-secondary/80 text-secondary-foreground",
};

export function OrchestratorCard({
  message,
  resolvingActionId = null,
  actionError = null,
  onResolveAction,
}: OrchestratorCardProps) {
  const config = typeConfig[message.kind] || typeConfig["message"];
  const Icon = config.icon;
  const pendingAction = message.pendingAction;
  const isPendingAction = pendingAction?.status === "pending";

  return (
    <div className={cn("rounded-lg border p-4", config.bg, config.border)}>
      <div className="mb-2 flex items-center gap-2">
        <Icon className={cn("h-4 w-4", config.accent)} />
        <span className={cn("text-xs font-semibold uppercase tracking-wider", config.accent)}>
          {config.label}
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {message.timestampLabel}
        </span>
      </div>

      <p className="text-sm font-medium text-foreground">{message.content}</p>

      {message.artifacts.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {message.artifacts.map((artifact) => (
            <div
              key={`${artifact.type}:${artifact.id}`}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background/70 px-2.5 py-1.5 text-xs"
            >
              <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-foreground">{artifact.label}</span>
            </div>
          ))}
        </div>
      )}

      {pendingAction && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-medium text-foreground">{pendingAction.decisionTitle}</span>
            <span className="text-muted-foreground">{pendingAction.status}</span>
          </div>
          <div className="text-xs text-muted-foreground">{pendingAction.reason}</div>
          {actionError && isPendingAction && resolvingActionId === pendingAction.id && (
            <div className="text-xs text-destructive">{actionError}</div>
          )}
          {isPendingAction && pendingAction.choices.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {pendingAction.choices.map((choice) => (
                <Button
                  key={`${pendingAction.id}:${choice.value}`}
                  type="button"
                  size="sm"
                  disabled={resolvingActionId === pendingAction.id}
                  onClick={() => {
                    void onResolveAction(pendingAction.id, choice.value);
                  }}
                  className={cn(
                    "h-8 px-4 text-xs font-semibold",
                    actionVariantStyles[choice.tone] || actionVariantStyles.secondary,
                  )}
                >
                  {choice.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
