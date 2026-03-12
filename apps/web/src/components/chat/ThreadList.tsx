import { useMemo, useState } from "react";
import { Inbox, Search } from "lucide-react";

import { cn } from "../../lib/utils.js";
import type { OperatorMissionThreadSummary } from "../../types/operator-chat.js";
import { StatusBadge } from "../dashboard/StatusBadge.js";

interface ThreadListProps {
  threads: OperatorMissionThreadSummary[];
  activeId: string | null;
  pendingCount: number;
  onSelect: (id: string) => void;
}

export function ThreadList({ threads, activeId, pendingCount, onSelect }: ThreadListProps) {
  const [searchValue, setSearchValue] = useState("");
  const filteredThreads = useMemo(() => {
    const query = searchValue.trim().toLowerCase();
    if (!query) {
      return threads;
    }

    return threads.filter((thread) => {
      return [thread.title, thread.objective, thread.lastMessageExcerpt]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [searchValue, threads]);

  return (
    <div className="flex h-full flex-col border-r border-border bg-card/50">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Missions</h2>
        <div className="flex items-center gap-1.5">
          <Inbox className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-primary">{pendingCount} pending</span>
        </div>
      </div>
      <div className="px-3 py-2">
        <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search threads..."
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {filteredThreads.length === 0 && (
          <div className="px-4 py-6 text-xs text-muted-foreground">
            {threads.length === 0
              ? "No missions are active yet."
              : "No missions match this search."}
          </div>
        )}
        {filteredThreads.map((thread) => (
          <button
            type="button"
            key={thread.id}
            onClick={() => onSelect(thread.id)}
            className={cn(
              "flex w-full flex-col gap-1 border-b border-border/50 px-4 py-3 text-left transition-colors hover:bg-accent/50",
              activeId === thread.id && "bg-accent",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs font-medium leading-tight text-foreground">
                {thread.title}
              </span>
              {thread.pendingActionCount > 0 && <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={thread.status} size="sm" />
              {thread.pendingActionCount > 0 && (
                <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[9px] font-medium text-warning">
                  {thread.pendingActionCount} action{thread.pendingActionCount > 1 ? "s" : ""}
                </span>
              )}
            </div>
            <p className="line-clamp-2 text-[10px] text-muted-foreground">
              {thread.lastMessageExcerpt}
            </p>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[10px] text-muted-foreground">{thread.objective}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">{thread.updatedAtLabel}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
