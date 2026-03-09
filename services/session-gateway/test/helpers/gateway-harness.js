import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";

import {
  ensureRealPiContext,
  launchRealPiSession,
  readRuntimeArtifacts,
  runNodeScript,
  sleep,
  uniqueSessionId,
  waitFor,
  writeBrief
} from "../../../../packages/runtime-pi/test/helpers/e2e-harness.js";
import { PROJECT_ROOT } from "../../../../packages/runtime-pi/src/metadata/constants.js";

async function findFreePort() {
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

export async function startGatewayServer(t, envOverrides = {}) {
  const context = await ensureRealPiContext(t, {
    prefix: "gateway-pi-control",
    env: envOverrides
  });
  if (!context) {
    return null;
  }

  const port = await findFreePort();
  const env = {
    ...context.env,
    SPORE_GATEWAY_HOST: "127.0.0.1",
    SPORE_GATEWAY_PORT: String(port)
  };

  const child = spawn(process.execPath, ["services/session-gateway/server.js"], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stderr = "";
  if (child.stderr) {
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
  }

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitFor(async () => {
    const response = await fetch(`${baseUrl}/health`);
    if (!response.ok) {
      throw new Error(`gateway health returned ${response.status}`);
    }
    return true;
  }, { timeoutMs: 15000, intervalMs: 200 });

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
    stderr
  };
}

export async function getJson(baseUrl, routePath) {
  const response = await fetch(new URL(routePath, `${baseUrl}/`));
  const text = await response.text();
  return {
    status: response.status,
    json: text ? JSON.parse(text) : null
  };
}

export async function postJson(baseUrl, routePath, payload) {
  const response = await fetch(new URL(routePath, `${baseUrl}/`), {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  return {
    status: response.status,
    json: text ? JSON.parse(text) : null
  };
}

export async function waitForGatewaySessionState(baseUrl, sessionId, acceptedStates, options = {}) {
  const states = new Set(acceptedStates);
  return waitFor(async () => {
    const result = await getJson(baseUrl, `/sessions/${encodeURIComponent(sessionId)}`);
    if (result.status !== 200 || !result.json?.session) {
      return null;
    }
    const state = result.json.session.state;
    if (states.has(state)) {
      return result.json;
    }
    return null;
  }, options);
}

export async function getLiveSession(baseUrl, sessionId, options = {}) {
  const query = new URLSearchParams();
  if (options.limit) {
    query.set("limit", String(options.limit));
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return getJson(baseUrl, `/sessions/${encodeURIComponent(sessionId)}/live${suffix}`);
}

export async function waitForLiveControlHistory(baseUrl, sessionId, predicate, options = {}) {
  return waitFor(async () => {
    const result = await getLiveSession(baseUrl, sessionId, {
      limit: options.limit ?? 50
    });
    if (result.status !== 200 || !Array.isArray(result.json?.controlHistory)) {
      return null;
    }
    const match = result.json.controlHistory.find(predicate);
    return match ? result.json : null;
  }, options);
}

export async function waitForGatewayEvent(baseUrl, query, predicate, options = {}) {
  const route = `/events?${new URLSearchParams(query).toString()}`;
  return waitFor(async () => {
    const result = await getJson(baseUrl, route);
    if (result.status !== 200 || !Array.isArray(result.json?.events)) {
      return null;
    }
    const match = result.json.events.find(predicate);
    return match ?? null;
  }, options);
}

export async function launchGatewayControlledSession(harness, options = {}) {
  assert.ok(harness?.env?.SPORE_PI_BIN, "launchGatewayControlledSession requires a gateway harness");

  const sessionId = options.sessionId ?? uniqueSessionId("gateway-pi");
  const runId = options.runId ?? `${sessionId}-run`;
  const briefPath =
    options.briefPath ??
    (await writeBrief(harness.root, `${sessionId}.brief.md`, [
      "# SPORE gateway control E2E",
      "",
      "- Start with exactly one short acknowledgement sentence.",
      "- Include the token `SPORE_GATEWAY_CONTROL_READY`.",
      "- Wait for a follow-up steering instruction before you finish if the runtime allows it."
    ]));

  const launch = await launchRealPiSession({
    env: harness.env,
    sessionId,
    runId,
    briefPath,
    extraArgs: options.extraArgs ?? []
  });

  return {
    sessionId,
    runId,
    briefPath,
    launch
  };
}

export async function readGatewayArtifacts(baseUrl, sessionId, artifactName) {
  const result = await getJson(
    baseUrl,
    `/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifactName)}`
  );
  if (result.status !== 200) {
    return null;
  }
  return result.json;
}

export async function readGatewayArtifactSummary(baseUrl, sessionId) {
  const result = await getJson(baseUrl, `/sessions/${encodeURIComponent(sessionId)}/artifacts`);
  if (result.status !== 200) {
    return null;
  }
  return result.json;
}

export async function waitForControlArtifact(sessionId, options = {}) {
  return waitFor(async () => {
    const artifacts = await readRuntimeArtifacts(sessionId);
    return artifacts.control;
  }, options);
}

export async function getSessionStatusFromCli(env) {
  const result = await runNodeScript(
    "packages/session-manager/src/cli/session-manager.js",
    ["status"],
    { env }
  );
  return JSON.parse(result.stdout);
}
