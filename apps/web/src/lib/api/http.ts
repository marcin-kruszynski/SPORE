import type { ApiEnvelope } from "../../types/operator-chat.js";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type JsonPayload = ApiEnvelope<unknown> & Record<string, unknown>;

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as JsonPayload;
  } catch {
    throw new ApiError("The server returned invalid JSON.", response.status);
  }
}

export async function requestJson<TDetail>(
  path: string,
  init: RequestInit = {},
): Promise<TDetail> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const payload = await readJson(response);
  const message =
    payload?.message ?? payload?.error ?? `Request failed with ${response.status}.`;

  if (!response.ok || payload?.ok !== true) {
    throw new ApiError(String(message), response.status);
  }

  return payload.detail as TDetail;
}

export async function requestOptionalJson<TDetail>(
  path: string,
  init: RequestInit = {},
): Promise<TDetail | null> {
  try {
    return await requestJson<TDetail>(path, init);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function requestPayloadJson<TPayload>(
  path: string,
  init: RequestInit = {},
): Promise<TPayload> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const payload = await readJson(response);
  const message =
    payload?.message ?? payload?.error ?? `Request failed with ${response.status}.`;

  if (!response.ok || payload?.ok === false) {
    throw new ApiError(String(message), response.status);
  }

  return (payload ?? {}) as TPayload;
}
