import { requestJson } from "./http.js";
import type {
  CreateOperatorMissionInput,
  OperatorApiAction,
  OperatorApiThreadDetail,
  OperatorApiThreadSummary,
  ResolveOperatorActionInput,
  SendOperatorMessageInput,
} from "../../types/operator-chat.js";

const API_PREFIX = "/api/orchestrator/operator";

export function listOperatorThreads() {
  return requestJson<OperatorApiThreadSummary[]>(`${API_PREFIX}/threads`);
}

export function createOperatorThread(input: CreateOperatorMissionInput) {
  return requestJson<OperatorApiThreadDetail>(`${API_PREFIX}/threads`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listOperatorActions() {
  return requestJson<OperatorApiAction[]>(`${API_PREFIX}/actions`);
}

export function getOperatorThreadDetail(threadId: string) {
  return requestJson<OperatorApiThreadDetail>(
    `${API_PREFIX}/threads/${encodeURIComponent(threadId)}`,
  );
}

export function postOperatorThreadMessage(
  threadId: string,
  input: SendOperatorMessageInput,
) {
  return requestJson<OperatorApiThreadDetail>(
    `${API_PREFIX}/threads/${encodeURIComponent(threadId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export function resolveOperatorAction(
  actionId: string,
  input: ResolveOperatorActionInput,
) {
  return requestJson<OperatorApiThreadDetail>(
    `${API_PREFIX}/actions/${encodeURIComponent(actionId)}/resolve`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}
