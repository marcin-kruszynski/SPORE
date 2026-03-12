interface ExecutionStreamHandlers {
  onEvent: () => void;
  onReady?: () => void;
  onError?: (message: string) => void;
}

export function connectExecutionStream(
  executionId: string,
  handlers: ExecutionStreamHandlers,
) {
  const source = new EventSource(
    `/api/orchestrator/stream/executions?execution=${encodeURIComponent(executionId)}`,
  );

  source.addEventListener("ready", () => {
    handlers.onReady?.();
  });
  source.addEventListener("workflow-event", () => {
    handlers.onEvent();
  });
  source.addEventListener("error", () => {
    handlers.onError?.(`Live execution updates reconnecting for ${executionId}.`);
  });

  return {
    close() {
      source.close();
    },
  };
}
