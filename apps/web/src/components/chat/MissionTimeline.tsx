import { cn } from "../../lib/utils.js";
import type { OperatorMissionDetail } from "../../types/operator-chat.js";
import { StatusBadge } from "../dashboard/StatusBadge.js";
import { MessageComposer } from "./MessageComposer.js";
import { OrchestratorCard } from "./OrchestratorCard.js";

interface MissionTimelineProps {
  thread: OperatorMissionDetail;
  sendingMessage?: boolean;
  resolvingActionId?: string | null;
  messageError?: string | null;
  actionError?: string | null;
  onSendMessage: (message: string) => Promise<unknown>;
  onResolveAction: (actionId: string, choice: string) => Promise<unknown>;
}

export function MissionTimeline({
  thread,
  sendingMessage = false,
  resolvingActionId = null,
  messageError = null,
  actionError = null,
  onSendMessage,
  onResolveAction,
}: MissionTimelineProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">{thread.hero.title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{thread.hero.statusLine}</p>
          </div>
          <StatusBadge status={thread.status} size="md" />
        </div>

        {thread.progress.stages.length > 0 && (
          <>
            <div className="mt-4 flex items-center gap-1">
              {thread.progress.stages.map((stage) => (
                <div key={stage.id} className="flex flex-1 items-center gap-1">
                  <div
                    className={cn(
                      "h-1.5 flex-1 rounded-full transition-colors",
                      stage.status === "complete" && "bg-primary",
                      stage.status === "current" && "bg-primary animate-pulse-soft",
                      stage.status !== "complete" && stage.status !== "current" && "bg-muted",
                    )}
                  />
                </div>
              ))}
            </div>
            <div className="mt-1.5 flex justify-between gap-2">
              {thread.progress.stages.map((stage) => (
                <span
                  key={stage.id}
                  className={cn(
                    "text-[9px]",
                    stage.status === "upcoming"
                      ? "text-muted-foreground"
                      : "font-medium text-primary",
                  )}
                >
                  {stage.title}
                </span>
              ))}
            </div>
          </>
        )}

        {thread.quickReplies.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {thread.quickReplies.map((reply) => (
              <button
                key={reply}
                type="button"
                onClick={() => {
                  void onSendMessage(reply);
                }}
                className="rounded-full border border-border bg-background px-3 py-1 text-[11px] text-foreground transition-colors hover:bg-accent"
              >
                {reply}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="space-y-4">
          {thread.messages.length === 0 && (
            <div className="rounded-lg border border-dashed border-border bg-card/40 px-4 py-6 text-sm text-muted-foreground">
              Conversation history will appear here when the orchestrator returns updates.
            </div>
          )}
          {thread.messages.map((message) => {
            if (message.role === "operator") {
              return (
                <div key={message.id} className="flex justify-end">
                  <div className="max-w-[80%] rounded-lg rounded-br-sm bg-primary/10 px-4 py-3 text-sm text-foreground">
                    <p>{message.content}</p>
                    <span className="mt-1 block text-[10px] text-muted-foreground">
                      {message.timestampLabel}
                    </span>
                  </div>
                </div>
              );
            }

            return (
              <div key={message.id} className="max-w-[90%]">
                <OrchestratorCard
                  message={message}
                  actionError={actionError}
                  resolvingActionId={resolvingActionId}
                  onResolveAction={onResolveAction}
                />
              </div>
            );
          })}
        </div>
      </div>

      <MessageComposer
        pending={sendingMessage}
        error={messageError}
        onSend={onSendMessage}
      />
    </div>
  );
}
