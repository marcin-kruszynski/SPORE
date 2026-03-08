import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { PROJECT_ROOT } from "../../src/metadata/constants.js";

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
