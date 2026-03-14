import { useState } from "react";
import { AlertTriangle, Plus, RefreshCw, SlidersHorizontal } from "lucide-react";

import { ContextRail } from "../components/chat/ContextRail.js";
import { MissionTimeline } from "../components/chat/MissionTimeline.js";
import { ThreadList } from "../components/chat/ThreadList.js";
import { PageHeader } from "../components/dashboard/PageHeader.js";
import { CreateMissionDialog } from "../components/dialogs/CreateMissionDialog.js";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.js";
import { Button } from "../components/ui/button.js";
import { Skeleton } from "../components/ui/skeleton.js";
import { useOperatorChat } from "../features/operator-chat/use-operator-chat.js";

const CHAT_SUBTITLE = "Operator Console";

const ChatPage = () => {
  const [showCreate, setShowCreate] = useState(false);
  const chat = useOperatorChat();

  if (chat.isInitialLoading) {
    return (
      <div className="flex h-screen flex-col">
        <PageHeader title="Chat" subtitle={CHAT_SUBTITLE} pendingCount={0} />
        <div className="flex flex-1 items-center justify-center px-6 text-sm text-muted-foreground">
          Loading mission control...
        </div>
      </div>
    );
  }

  if (chat.loadErrorMessage) {
    return (
      <div className="flex h-screen flex-col">
        <PageHeader title="Chat" subtitle={CHAT_SUBTITLE} pendingCount={chat.pendingCount} />
        <div className="flex flex-1 items-center justify-center px-6">
          <Alert className="max-w-xl border-destructive/30 bg-destructive/5">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Mission Control is unavailable</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>{chat.loadErrorMessage}</p>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  void chat.retry();
                }}
              >
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  const actions = (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" disabled>
        <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" /> Filters
      </Button>
      <Button
        size="sm"
        className="h-7 bg-primary text-xs text-primary-foreground hover:bg-primary/90"
        onClick={() => setShowCreate(true)}
      >
        <Plus className="mr-1.5 h-3.5 w-3.5" /> New Mission
      </Button>
    </div>
  );

  const mobileMissionSwitcher = !chat.hasLoadedEmpty && chat.threads.length > 0 && (
    <div className="border-b border-border px-4 py-3 md:hidden">
      <label
        htmlFor="active-mission-switcher"
        className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
      >
        Active mission
      </label>
      <select
        id="active-mission-switcher"
        aria-label="Active mission"
        value={chat.activeThreadId ?? chat.threads[0]?.id ?? ""}
        onChange={(event) => {
          if (event.target.value) {
            chat.setActiveThreadId(event.target.value);
          }
        }}
        className="mt-2 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
      >
        {chat.threads.map((thread) => (
          <option key={thread.id} value={thread.id}>
            {thread.title}
            {thread.pendingActionCount > 0 ? ` (${thread.pendingActionCount} pending)` : ""}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="flex h-screen flex-col">
      <PageHeader
        title="Chat"
        subtitle={CHAT_SUBTITLE}
        pendingCount={chat.pendingCount}
        actions={actions}
      />
      <div className="flex flex-1 overflow-hidden">
        <div className="hidden w-72 shrink-0 md:block">
          <ThreadList
            threads={chat.threads}
            activeId={chat.activeThreadId}
            pendingCount={chat.pendingCount}
            onSelect={chat.setActiveThreadId}
          />
        </div>

        <div className="flex flex-1 flex-col overflow-hidden">
          {mobileMissionSwitcher}

          {chat.hasLoadedEmpty && (
            <div className="mx-auto flex max-w-xl flex-1 items-center justify-center px-6">
              <div className="rounded-xl border border-dashed border-border bg-card/40 p-8 text-center">
                <h2 className="text-lg font-semibold text-foreground">No missions yet</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Start a real operator mission and the orchestrator will author the mission state from the backend projections.
                </p>
                <Button type="button" className="mt-4" onClick={() => setShowCreate(true)}>
                  Start Mission
                </Button>
              </div>
            </div>
          )}

          {!chat.hasLoadedEmpty && chat.isThreadLoading && (
            <div className="flex flex-1 flex-col gap-4 px-6 py-4">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          )}

          {!chat.hasLoadedEmpty && !chat.isThreadLoading && !chat.activeThread && chat.detailErrorMessage && (
            <div className="mx-auto flex max-w-xl flex-1 items-center justify-center px-6">
              <Alert className="max-w-xl border-destructive/30 bg-destructive/5">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Mission details are unavailable</AlertTitle>
                <AlertDescription className="space-y-3">
                  <p>{chat.detailErrorMessage}</p>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      void chat.retrySelectedThread();
                    }}
                  >
                    Retry Mission
                  </Button>
                </AlertDescription>
              </Alert>
            </div>
          )}

          {!chat.hasLoadedEmpty && !chat.isThreadLoading && chat.activeThread && (
            <div className="flex flex-1 overflow-hidden">
              <div className="flex-1 overflow-hidden">
                <MissionTimeline
                  thread={chat.activeThread}
                  sendingMessage={chat.sendMessagePending}
                  resolvingActionId={chat.resolvingActionId}
                  messageError={chat.sendMessageError}
                  actionError={chat.resolveActionError}
                  onSendMessage={chat.sendMessage}
                  onResolveAction={chat.resolveAction}
                />
              </div>
              <div className="hidden w-72 shrink-0 lg:block">
                <ContextRail thread={chat.activeThread} />
              </div>
            </div>
          )}
        </div>
      </div>

      {chat.refreshErrorMessage && (
        <div className="border-b border-destructive/20 bg-destructive/5 px-6 py-2 text-xs text-destructive">
          {chat.refreshErrorMessage}
        </div>
      )}

      {chat.streamStatus && !chat.loadErrorMessage && (
        <div className="border-t border-border bg-background/95 px-6 py-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-3.5 w-3.5" />
            {chat.streamStatus}
          </div>
        </div>
      )}

      <CreateMissionDialog
        open={showCreate}
        pending={chat.createMissionPending}
        error={chat.createMissionError}
        onOpenChange={setShowCreate}
        onCreate={chat.createMission}
      />
    </div>
  );
};

export default ChatPage;
