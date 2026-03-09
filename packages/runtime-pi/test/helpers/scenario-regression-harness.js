import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { PROJECT_ROOT } from "../../src/metadata/constants.js";
import { buildIsolatedStateEnv, makeTestRoot, sleep } from "./e2e-harness.js";
import {
  getJson as getHttpJson,
  postJson as postHttpJson,
  waitForHealth
} from "../../../../services/orchestrator/test/helpers/http-harness.js";

export const CANONICAL_SCENARIO_IDS = [
  "backend-service-delivery",
  "frontend-ui-pass",
  "docs-adr-pass"
];

export function scenarioCatalogPath() {
  return path.join(PROJECT_ROOT, "config", "scenarios");
}

export async function listScenarioCatalogEntries() {
  const root = scenarioCatalogPath();
  try {
    const entries = await fs.readdir(root);
    return entries.filter((entry) => entry.endsWith(".yaml")).sort();
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function probeJsonRoute(baseUrl, routePath) {
  try {
    const response = await fetch(new URL(routePath, baseUrl));
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      json: text ? JSON.parse(text) : null
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error.message
    };
  }
}

export async function ensureScenarioOrRegressionSurface(t, routePath) {
  const baseUrl = process.env.SPORE_SCENARIO_BASE_URL ?? null;
  if (!baseUrl) {
    t.skip(`set SPORE_SCENARIO_BASE_URL to probe ${routePath}`);
    return null;
  }

  const probe = await probeJsonRoute(baseUrl, routePath);
  if (!probe.ok) {
    t.skip(`route ${routePath} not available yet (status=${probe.status})`);
    return null;
  }
  return {
    baseUrl,
    probe
  };
}

export async function assertScenarioCatalogShape() {
  const entries = await listScenarioCatalogEntries();
  assert.ok(Array.isArray(entries));
  return entries;
}

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

export async function startStubOrchestrator(t, prefix = "scenario-stub") {
  const root = await makeTestRoot(prefix);
  const port = await findFreePort();
  const env = buildIsolatedStateEnv(root, {
    SPORE_ORCHESTRATOR_PORT: String(port)
  });
  await fs.mkdir(path.dirname(env.SPORE_ORCHESTRATOR_DB_PATH), { recursive: true });
  await fs.mkdir(path.dirname(env.SPORE_SESSION_DB_PATH), { recursive: true });
  await fs.mkdir(path.dirname(env.SPORE_EVENT_LOG_PATH), { recursive: true });

  const child = spawn(process.execPath, ["services/orchestrator/server.js"], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  await waitForHealth(`http://127.0.0.1:${port}/health`);

  t.after(async () => {
    if (!child.killed) {
      child.kill("SIGTERM");
      await sleep(250);
    }
    if (!child.killed) {
      child.kill("SIGKILL");
    }
    await fs.rm(root, { recursive: true, force: true });
  });

  return {
    root,
    env,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    process: child
  };
}

export async function getJson(baseUrl, routePath) {
  return getHttpJson(new URL(routePath, `${baseUrl}/`).toString());
}

export async function postJson(baseUrl, routePath, payload) {
  return postHttpJson(new URL(routePath, `${baseUrl}/`).toString(), payload);
}

export async function probeOptionalJson(baseUrl, routePath, options = {}) {
  const method = options.method ?? "GET";
  const response = await fetch(new URL(routePath, `${baseUrl}/`), {
    method,
    headers:
      method === "POST"
        ? {
            "content-type": "application/json"
          }
        : undefined,
    body: method === "POST" ? JSON.stringify(options.payload ?? {}) : undefined
  });
  const text = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    json: text ? JSON.parse(text) : null
  };
}

export async function runStubScenario(baseUrl, scenarioId, options = {}) {
  const result = await postJson(baseUrl, `/scenarios/${scenarioId}/run`, {
    stub: true,
    launcher: options.launcher ?? "stub",
    wait: true,
    by: options.by ?? "test",
    source: options.source ?? "test",
    objective: options.objective ?? undefined
  });
  assert.equal(result.status, 200);
  return result.json;
}

export async function runStubRegression(baseUrl, regressionId, options = {}) {
  const result = await postJson(baseUrl, `/regressions/${regressionId}/run`, {
    stub: true,
    launcher: options.launcher ?? "stub",
    by: options.by ?? "test",
    source: options.source ?? "test"
  });
  assert.equal(result.status, 200);
  return result.json;
}

export async function assertRelativeFileExists(relativePath) {
  const fullPath = path.join(PROJECT_ROOT, relativePath);
  const stats = await fs.stat(fullPath);
  assert.ok(stats.isFile(), `expected file to exist: ${relativePath}`);
  return fullPath;
}
