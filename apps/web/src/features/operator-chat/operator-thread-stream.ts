import type { OperatorApiThreadDetail } from "../../types/operator-chat.js";

interface OperatorThreadStreamHandlers {
  onThread(detail: OperatorApiThreadDetail): void;
  onError(message: string): void;
}

function parseEventData(data: string) {
  try {
    return JSON.parse(data) as {
      ok?: boolean;
      detail?: OperatorApiThreadDetail;
      message?: string;
      error?: string;
    };
  } catch {
    return null;
  }
}

export function connectOperatorThreadStream(
  threadId: string,
  handlers: OperatorThreadStreamHandlers,
) {
  const source = new EventSource(
    `/api/orchestrator/operator/threads/${encodeURIComponent(threadId)}/stream`,
  );

  const handleMessage = (event: MessageEvent<string>) => {
    const payload = parseEventData(event.data);
    if (!payload) {
      handlers.onError("Live updates returned invalid data.");
      return;
    }
    if (payload.ok !== true || !payload.detail) {
      handlers.onError(payload.message ?? payload.error ?? "Live updates failed.");
      return;
    }
    handlers.onThread(payload.detail);
  };

  const handleError = (event: Event) => {
    if (event instanceof MessageEvent && typeof event.data === "string") {
      const payload = parseEventData(event.data);
      if (payload) {
        handlers.onError(payload.message ?? payload.error ?? "Live updates failed.");
        return;
      }
    }

    handlers.onError("Live updates reconnecting...");
  };

  source.addEventListener("thread-ready", handleMessage);
  source.addEventListener("thread-update", handleMessage);
  source.addEventListener("error", handleError);

  return {
    close() {
      source.close();
    },
  };
}
