import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import {
  adaptOperatorInboxAction,
  adaptOperatorThreadDetail,
  adaptOperatorThreadSummary,
} from "../../adapters/operator-chat.js";
import {
  createOperatorThread,
  getOperatorThreadDetail,
  listOperatorActions,
  listOperatorThreads,
  postOperatorThreadMessage,
  resolveOperatorAction,
} from "../../lib/api/operator.js";
import type {
  OperatorApiAction,
  OperatorApiThreadSummary,
  CreateMissionFormValues,
  OperatorApiThreadDetail,
} from "../../types/operator-chat.js";
import {
  buildCreateMissionInput,
  buildResolveActionInput,
  buildSendMessageInput,
} from "./operator-chat-actions.js";
import { connectOperatorThreadStream } from "./operator-thread-stream.js";

const THREADS_QUERY_KEY = ["operator-chat", "threads"] as const;
const ACTIONS_QUERY_KEY = ["operator-chat", "actions"] as const;

function detailQueryKey(threadId: string) {
  return ["operator-chat", "detail", threadId] as const;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Mission Control is unavailable.";
}

export function useOperatorChat() {
  const queryClient = useQueryClient();
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<string | null>(null);

  const threadsQuery = useQuery({
    queryKey: THREADS_QUERY_KEY,
    queryFn: listOperatorThreads,
  });
  const actionsQuery = useQuery({
    queryKey: ACTIONS_QUERY_KEY,
    queryFn: listOperatorActions,
  });
  const detailQuery = useQuery({
    queryKey: detailQueryKey(selectedThreadId ?? "idle"),
    queryFn: () => getOperatorThreadDetail(selectedThreadId ?? ""),
    enabled: Boolean(selectedThreadId),
  });

  useEffect(() => {
    const threads = Array.isArray(threadsQuery.data) ? threadsQuery.data : [];
    if (threads.length === 0) {
      if (!threadsQuery.isLoading) {
        setSelectedThreadId(null);
      }
      return;
    }

    setSelectedThreadId((current) => {
      if (current && threads.some((thread) => thread.id === current)) {
        return current;
      }
      return String(threads[0]?.id ?? "");
    });
  }, [threadsQuery.data, threadsQuery.isLoading]);

  useEffect(() => {
    if (!selectedThreadId) {
      return undefined;
    }

    setStreamStatus(null);
    const stream = connectOperatorThreadStream(selectedThreadId, {
      onThread(detail) {
        queryClient.setQueryData(detailQueryKey(selectedThreadId), detail);
        void queryClient.invalidateQueries({ queryKey: THREADS_QUERY_KEY });
        void queryClient.invalidateQueries({ queryKey: ACTIONS_QUERY_KEY });
        setStreamStatus(null);
      },
      onError(message) {
        setStreamStatus(message);
      },
    });

    return () => {
      stream.close();
    };
  }, [queryClient, selectedThreadId]);

  const createMissionMutation = useMutation({
    mutationFn: (values: CreateMissionFormValues) =>
      createOperatorThread(buildCreateMissionInput(values)),
    onSuccess(detail) {
      syncDetail(detail, queryClient, setSelectedThreadId);
    },
  });
  const sendMessageMutation = useMutation({
    mutationFn: async (message: string) => {
      if (!selectedThreadId) {
        throw new Error("Select a mission before messaging the orchestrator.");
      }
      return postOperatorThreadMessage(
        selectedThreadId,
        buildSendMessageInput(message),
      );
    },
    onSuccess(detail) {
      syncDetail(detail, queryClient, setSelectedThreadId);
    },
  });
  const resolveActionMutation = useMutation({
    mutationFn: ({ actionId, choice }: { actionId: string; choice: string }) =>
      resolveOperatorAction(actionId, buildResolveActionInput(choice)),
    onSuccess(detail) {
      syncDetail(detail, queryClient, setSelectedThreadId);
    },
  });

  const threads = useMemo(
    () => (Array.isArray(threadsQuery.data) ? threadsQuery.data : []).map(adaptOperatorThreadSummary),
    [threadsQuery.data],
  );
  const threadMap = useMemo(
    () => new Map(threads.map((thread) => [thread.id, thread] as const)),
    [threads],
  );
  const actions = useMemo(
    () =>
      (Array.isArray(actionsQuery.data) ? actionsQuery.data : []).map((action) =>
        adaptOperatorInboxAction(action, threadMap.get(String(action.threadId ?? "")) ?? null),
      ),
    [actionsQuery.data, threadMap],
  );
  const activeThread = useMemo(
    () => (detailQuery.data ? adaptOperatorThreadDetail(detailQuery.data) : null),
    [detailQuery.data],
  );
  const hasCachedMissionState = threads.length > 0 || activeThread !== null;

  const isInitialLoading =
    (threadsQuery.isLoading || actionsQuery.isLoading) &&
    threads.length === 0 &&
    !activeThread;
  const isThreadLoading = Boolean(selectedThreadId) && detailQuery.isLoading && !activeThread;
  const loadError =
    threadsQuery.error ??
    actionsQuery.error ??
    (selectedThreadId ? detailQuery.error : null);
  const blockingLoadError = hasCachedMissionState ? null : loadError;
  const detailErrorMessage =
    selectedThreadId && !activeThread && detailQuery.error && !detailQuery.isLoading
      ? getErrorMessage(detailQuery.error)
      : null;
  const hasLoadedEmpty =
    !isInitialLoading &&
    !blockingLoadError &&
    threadsQuery.isSuccess &&
    actionsQuery.isSuccess &&
    threads.length === 0 &&
    !activeThread;

  return {
    threads,
    actions,
    activeThreadId: selectedThreadId,
    activeThread,
    pendingCount: actions.length,
    isInitialLoading,
    isThreadLoading,
    hasLoadedEmpty,
    detailErrorMessage,
    loadErrorMessage: blockingLoadError ? getErrorMessage(blockingLoadError) : null,
    refreshErrorMessage: loadError && hasCachedMissionState ? getErrorMessage(loadError) : null,
    streamStatus,
    createMissionError: createMissionMutation.error
      ? getErrorMessage(createMissionMutation.error)
      : null,
    sendMessageError: sendMessageMutation.error
      ? getErrorMessage(sendMessageMutation.error)
      : null,
    resolveActionError: resolveActionMutation.error
      ? getErrorMessage(resolveActionMutation.error)
      : null,
    createMissionPending: createMissionMutation.isPending,
    sendMessagePending: sendMessageMutation.isPending,
    resolveActionPending: resolveActionMutation.isPending,
    resolvingActionId: resolveActionMutation.variables?.actionId ?? null,
    setActiveThreadId: setSelectedThreadId,
    retry: async () => {
      await Promise.all([
        threadsQuery.refetch(),
        actionsQuery.refetch(),
        selectedThreadId ? detailQuery.refetch() : Promise.resolve(),
      ]);
    },
    retrySelectedThread: () => detailQuery.refetch(),
    createMission: (values: CreateMissionFormValues) =>
      createMissionMutation.mutateAsync(values),
    sendMessage: (message: string) => sendMessageMutation.mutateAsync(message),
    resolveAction: (actionId: string, choice: string) =>
      resolveActionMutation.mutateAsync({ actionId, choice }),
  };
}

function syncDetail(
  detail: OperatorApiThreadDetail,
  queryClient: ReturnType<typeof useQueryClient>,
  setSelectedThreadId: Dispatch<SetStateAction<string | null>>,
) {
  const nextThreadId = String(detail.id ?? "");
  if (!nextThreadId) {
    return;
  }

  setSelectedThreadId(nextThreadId);
  queryClient.setQueryData(
    THREADS_QUERY_KEY,
    (current: OperatorApiThreadSummary[] | undefined) => {
      const nextSummary: OperatorApiThreadSummary = {
        id: detail.id,
        title: detail.title,
        status: detail.status,
        updatedAt: detail.updatedAt,
        summary: detail.summary,
        pendingActionCount: Array.isArray(detail.pendingActions)
          ? detail.pendingActions.length
          : detail.summary?.pendingActionCount,
      };

      const existing = Array.isArray(current) ? current : [];
      const remaining = existing.filter((thread) => thread.id !== nextThreadId);
      return [nextSummary, ...remaining];
    },
  );
  queryClient.setQueryData(
    ACTIONS_QUERY_KEY,
    (current: OperatorApiAction[] | undefined) => {
      const existing = Array.isArray(current) ? current : [];
      const remaining = existing.filter((action) => action.threadId !== nextThreadId);
      return [...(detail.pendingActions ?? []), ...remaining];
    },
  );
  queryClient.setQueryData(detailQueryKey(nextThreadId), detail);
  void queryClient.invalidateQueries({ queryKey: THREADS_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: ACTIONS_QUERY_KEY });
}
