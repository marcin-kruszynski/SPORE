import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { JsonObject, JsonValue } from "@spore/config-schema";
import { buildTsxEntrypointArgs, PROJECT_ROOT } from "@spore/core";
import {
  ensureRealPiContext,
  launchRealPiSession,
  readRuntimeArtifacts,
  runNodeScript,
  sleep,
  uniqueSessionId,
  waitFor,
  writeBrief,
} from "@spore/test-support";

type QueryOptions = {
  limit?: number;
  timeoutMs?: number;
  intervalMs?: number;
};

type LaunchGatewaySessionOptions = {
  sessionId?: string;
  runId?: string;
  briefPath?: string;
  extraArgs?: string[];
};

type JsonFetchResult<TJson extends JsonObject = JsonObject> = {
  status: number;
  json: TJson | null;
};

type GatewaySessionSummary = JsonObject & {
  id?: string;
  state?: string;
};

type GatewayControlRequest = JsonObject & {
  id?: string;
  ackStatus?: string;
  status?: string;
};

type GatewayEventPayload = JsonObject & {
  message?: string;
  reason?: string;
};

type GatewayEventRecord = JsonObject & {
  type?: string;
  payload?: GatewayEventPayload;
};

type GatewayLivePayload = JsonObject & {
  ok?: boolean;
  session?: GatewaySessionSummary;
  events?: GatewayEventRecord[];
  launcher?:
    | (JsonObject & {
        runId?: string;
        launcherType?: string;
      })
    | null;
  controlHistory?: GatewayControlRequest[];
  diagnostics?: JsonObject | null;
};

type GatewayActionResponse = JsonObject & {
  ok?: boolean;
  action?: string;
  request?: GatewayControlRequest;
};

type GatewayControlHistoryPayload = JsonObject & {
  controlHistory?: GatewayControlRequest[];
};

type GatewayControlStatusPayload = JsonObject & {
  request?: GatewayControlRequest;
};

type GatewaySessionPayload = JsonObject & {
  session?: GatewaySessionSummary;
};

type GatewayEventsPayload = JsonObject & {
  events?: GatewayEventRecord[];
};

type GatewayArtifactsPayload = JsonObject & {
  ok?: boolean;
  artifact?: string;
  content?: JsonValue;
};

type GatewayArtifactSummaryPayload = JsonObject & {
  ok?: boolean;
  artifacts?: JsonObject;
};

type SessionStatusPayload = JsonObject & {
  byState?: Record<string, number>;
};

function parseJsonValue(raw: string): JsonValue {
  return JSON.parse(raw) as JsonValue;
}

function parseJsonObject(raw: string): JsonObject {
  const value = parseJsonValue(raw);
  if (!isJsonObject(value)) {
    throw new Error("expected JSON object response");
  }
  return value;
}

function isJsonObject(value: JsonValue | unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function findFreePort(): Promise<number> {
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

export async function startGatewayServer(
  t: {
    after: (fn: () => Promise<void>) => void;
    skip: (reason: string) => void;
  },
  envOverrides: NodeJS.ProcessEnv = {},
) {
  const context = await ensureRealPiContext(t, {
    prefix: "gateway-pi-control",
    env: envOverrides,
  });
  if (!context) {
    return null;
  }

  const port = await findFreePort();
  const env = {
    ...context.env,
    SPORE_GATEWAY_HOST: "127.0.0.1",
    SPORE_GATEWAY_PORT: String(port),
  };

  const child = spawn(
    process.execPath,
    buildTsxEntrypointArgs("services/session-gateway/server.ts"),
    {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stderr = "";
  if (child.stderr) {
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
  }

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitFor(
    async () => {
      const response = await fetch(`${baseUrl}/health`);
      if (!response.ok) {
        throw new Error(`gateway health returned ${response.status}`);
      }
      return true;
    },
    { timeoutMs: 15000, intervalMs: 200 },
  );

  t.after(async () => {
    if (!child.killed) {
      child.kill("SIGTERM");
      await sleep(250);
    }
    if (!child.killed) {
      child.kill("SIGKILL");
    }
  });

  return {
    ...context,
    env,
    port,
    baseUrl,
    process: child,
    stderr,
  };
}

export async function getJson<TJson extends JsonObject = JsonObject>(
  baseUrl: string,
  routePath: string,
) {
  const response = await fetch(new URL(routePath, `${baseUrl}/`));
  const text = await response.text();
  return {
    status: response.status,
    json: text ? (parseJsonObject(text) as TJson) : null,
  } satisfies JsonFetchResult<TJson>;
}

export async function postJson<
  TJson extends JsonObject = GatewayActionResponse,
>(
  baseUrl: string,
  routePath: string,
  payload: unknown,
  headers: Record<string, string> = {},
) {
  const response = await fetch(new URL(routePath, `${baseUrl}/`), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  return {
    status: response.status,
    json: text ? (parseJsonObject(text) as TJson) : null,
  } satisfies JsonFetchResult<TJson>;
}

export async function getControlHistory(
  baseUrl: string,
  sessionId: string,
  options: QueryOptions = {},
) {
  const query = new URLSearchParams();
  if (options.limit) {
    query.set("limit", String(options.limit));
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return getJson<GatewayControlHistoryPayload>(
    baseUrl,
    `/sessions/${encodeURIComponent(sessionId)}/control-history${suffix}`,
  );
}

export async function getControlStatus(
  baseUrl: string,
  sessionId: string,
  requestId: string,
) {
  return getJson<GatewayControlStatusPayload>(
    baseUrl,
    `/sessions/${encodeURIComponent(sessionId)}/control-status/${encodeURIComponent(requestId)}`,
  );
}

export async function waitForGatewaySessionState(
  baseUrl: string,
  sessionId: string,
  acceptedStates: string[],
  options: QueryOptions = {},
) {
  const states = new Set(acceptedStates);
  return waitFor(async () => {
    const result = await getJson<GatewaySessionPayload>(
      baseUrl,
      `/sessions/${encodeURIComponent(sessionId)}`,
    );
    if (result.status !== 200 || !result.json?.session) {
      return null;
    }
    const state = result.json.session.state;
    if (typeof state === "string" && states.has(state)) {
      return result.json;
    }
    return null;
  }, options);
}

export async function getLiveSession(
  baseUrl: string,
  sessionId: string,
  options: QueryOptions = {},
) {
  const query = new URLSearchParams();
  if (options.limit) {
    query.set("limit", String(options.limit));
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return getJson<GatewayLivePayload>(
    baseUrl,
    `/sessions/${encodeURIComponent(sessionId)}/live${suffix}`,
  );
}

export async function waitForLiveControlHistory(
  baseUrl: string,
  sessionId: string,
  predicate: (entry: JsonObject) => boolean,
  options: QueryOptions = {},
) {
  return waitFor(async () => {
    const result = await getLiveSession(baseUrl, sessionId, {
      limit: options.limit ?? 50,
    });
    if (result.status !== 200 || !Array.isArray(result.json?.controlHistory)) {
      return null;
    }
    const match = result.json.controlHistory.find(predicate);
    return match ? result.json : null;
  }, options);
}

export async function waitForGatewayEvent(
  baseUrl: string,
  query: Record<string, string>,
  predicate: (event: GatewayEventRecord) => boolean,
  options: QueryOptions = {},
) {
  const route = `/events?${new URLSearchParams(query).toString()}`;
  return waitFor(async () => {
    const result = await getJson<GatewayEventsPayload>(baseUrl, route);
    if (result.status !== 200 || !Array.isArray(result.json?.events)) {
      return null;
    }
    const match = result.json.events.find(predicate);
    return match ?? null;
  }, options);
}

export async function launchGatewayControlledSession(
  harness: { env: NodeJS.ProcessEnv; root: string },
  options: LaunchGatewaySessionOptions = {},
) {
  assert.ok(
    harness?.env?.SPORE_PI_BIN,
    "launchGatewayControlledSession requires a gateway harness",
  );

  const sessionId = options.sessionId ?? uniqueSessionId("gateway-pi");
  const runId = options.runId ?? `${sessionId}-run`;
  const briefPath =
    options.briefPath ??
    (await writeBrief(harness.root, `${sessionId}.brief.md`, [
      "# SPORE gateway control E2E",
      "",
      "- Start with exactly one short acknowledgement sentence.",
      "- Include the token `SPORE_GATEWAY_CONTROL_READY`.",
      "- Wait for a follow-up steering instruction before you finish if the runtime allows it.",
    ]));

  const launch = await launchRealPiSession({
    env: harness.env,
    sessionId,
    runId,
    briefPath,
    extraArgs: options.extraArgs ?? [],
  });

  return {
    sessionId,
    runId,
    briefPath,
    launch,
  };
}

export async function readGatewayArtifacts(
  baseUrl: string,
  sessionId: string,
  artifactName: "control",
): Promise<(GatewayArtifactsPayload & { content?: JsonObject[] }) | null>;
export async function readGatewayArtifacts(
  baseUrl: string,
  sessionId: string,
  artifactName: string,
): Promise<(GatewayArtifactsPayload & { content?: JsonObject }) | null>;
export async function readGatewayArtifacts(
  baseUrl: string,
  sessionId: string,
  artifactName: string,
) {
  const result = await getJson<GatewayArtifactsPayload>(
    baseUrl,
    `/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifactName)}`,
  );
  if (result.status !== 200) {
    return null;
  }
  return result.json as
    | (GatewayArtifactsPayload & { content?: JsonObject[] })
    | (GatewayArtifactsPayload & { content?: JsonObject });
}

export async function readGatewayArtifactSummary(
  baseUrl: string,
  sessionId: string,
) {
  const result = await getJson<GatewayArtifactSummaryPayload>(
    baseUrl,
    `/sessions/${encodeURIComponent(sessionId)}/artifacts`,
  );
  if (result.status !== 200) {
    return null;
  }
  return result.json;
}

export async function waitForControlArtifact(
  sessionId: string,
  options: QueryOptions = {},
) {
  return waitFor(async () => {
    const artifacts = await readRuntimeArtifacts(sessionId);
    return artifacts.control;
  }, options);
}

export async function getSessionStatusFromCli(env: NodeJS.ProcessEnv) {
  const result = await runNodeScript(
    "packages/session-manager/src/cli/session-manager.ts",
    ["status"],
    { env },
  );
  return parseJsonObject(result.stdout) as SessionStatusPayload;
}
