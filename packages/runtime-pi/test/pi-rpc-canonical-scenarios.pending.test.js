import assert from "node:assert/strict";
import test from "node:test";

import {
  assertScenarioCatalogShape,
  CANONICAL_SCENARIO_IDS,
  ensureScenarioOrRegressionSurface
} from "./helpers/scenario-regression-harness.js";

test("canonical scenario helper exposes stable scenario ids", async () => {
  const catalogEntries = await assertScenarioCatalogShape();
  assert.deepEqual(CANONICAL_SCENARIO_IDS, [
    "backend-service-delivery",
    "frontend-ui-pass",
    "docs-adr-pass"
  ]);
  assert.ok(Array.isArray(catalogEntries));
});

test("scenario run harness is ready once /scenarios routes land", async (t) => {
  const surface = await ensureScenarioOrRegressionSurface(t, "/scenarios");
  if (!surface) {
    return;
  }

  assert.equal(surface.probe.ok, true);
});

test("regression run harness is ready once /regressions routes land", async (t) => {
  const surface = await ensureScenarioOrRegressionSurface(t, "/regressions");
  if (!surface) {
    return;
  }

  assert.equal(surface.probe.ok, true);
});
