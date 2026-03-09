import assert from "node:assert/strict";
import test from "node:test";

import {
  assertRelativeFileExists,
  assertScenarioCatalogShape,
  CANONICAL_SCENARIO_IDS,
  ensureScenarioOrRegressionSurface,
  getJson,
  probeOptionalJson,
  runStubRegression,
  runStubScenario,
  startStubOrchestrator
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

test("stub scenario run exposes durable history, artifacts, and optional next-wave probes", async (t) => {
  const harness = await startStubOrchestrator(t, "scenario-probe");
  const result = await runStubScenario(harness.baseUrl, "docs-adr-pass", {
    source: "scenario-probe"
  });

  const runId = result.run?.id;
  const executionId = result.execution?.execution?.id;
  assert.ok(runId);
  assert.ok(executionId);

  const scenarioSummary = await getJson(harness.baseUrl, "/scenarios/docs-adr-pass");
  assert.equal(scenarioSummary.status, 200);
  assert.equal(scenarioSummary.json?.scenario?.id, "docs-adr-pass");

  const scenarioRuns = await getJson(harness.baseUrl, "/scenarios/docs-adr-pass/runs?limit=5");
  assert.equal(scenarioRuns.status, 200);
  assert.ok(
    scenarioRuns.json?.detail?.runs?.some((item) => item.id === runId),
    "scenario runs should include the new run"
  );

  const artifacts = await getJson(
    harness.baseUrl,
    `/scenarios/docs-adr-pass/runs/${encodeURIComponent(runId)}/artifacts`
  );
  assert.equal(artifacts.status, 200);
  assert.ok(Array.isArray(artifacts.json?.detail?.executions));

  const history = await getJson(harness.baseUrl, `/executions/${encodeURIComponent(executionId)}/history`);
  assert.equal(history.status, 200);
  assert.equal(history.json?.detail?.execution?.id, executionId);

  const scenarioRunDetail = await probeOptionalJson(
    harness.baseUrl,
    `/scenario-runs/${encodeURIComponent(runId)}`
  );
  assert.ok([200, 404].includes(scenarioRunDetail.status));
  if (scenarioRunDetail.status === 200) {
    assert.equal(scenarioRunDetail.json?.detail?.run?.id, runId);
  }

  const scenarioTrend = await probeOptionalJson(
    harness.baseUrl,
    "/scenarios/docs-adr-pass/trends"
  );
  assert.ok([200, 404].includes(scenarioTrend.status));

  const scenarioRerun = await probeOptionalJson(
    harness.baseUrl,
    `/scenario-runs/${encodeURIComponent(runId)}/rerun`,
    {
      method: "POST",
      payload: {
        stub: true,
        by: "scenario-probe",
        source: "scenario-probe"
      }
    }
  );
  assert.ok([200, 404].includes(scenarioRerun.status));
  if (scenarioRerun.status === 200) {
    assert.notEqual(scenarioRerun.json?.run?.id, runId);
  }
});

test("stub regression run exposes durable reports and optional run/trend probes", async (t) => {
  const harness = await startStubOrchestrator(t, "regression-probe");
  const result = await runStubRegression(harness.baseUrl, "local-fast", {
    source: "regression-probe"
  });

  const runId = result.run?.id;
  assert.ok(runId);
  assert.equal(result.run?.regressionId, "local-fast");
  assert.ok(["passed", "failed"].includes(result.run?.status));
  assert.ok(result.run?.metadata?.reports?.json);
  assert.ok(result.run?.metadata?.reports?.markdown);
  await assertRelativeFileExists(result.run.metadata.reports.json);
  await assertRelativeFileExists(result.run.metadata.reports.markdown);

  const regressionSummary = await getJson(harness.baseUrl, "/regressions/local-fast");
  assert.equal(regressionSummary.status, 200);
  assert.equal(regressionSummary.json?.regression?.id, "local-fast");

  const regressionRuns = await getJson(harness.baseUrl, "/regressions/local-fast/runs?limit=5");
  assert.equal(regressionRuns.status, 200);
  assert.ok(
    regressionRuns.json?.detail?.runs?.some((item) => item.id === runId),
    "regression runs should include the new run"
  );

  const regressionRunDetail = await probeOptionalJson(
    harness.baseUrl,
    `/regression-runs/${encodeURIComponent(runId)}`
  );
  assert.ok([200, 404].includes(regressionRunDetail.status));
  if (regressionRunDetail.status === 200) {
    assert.equal(regressionRunDetail.json?.detail?.run?.id, runId);
  }

  const regressionRunReport = await probeOptionalJson(
    harness.baseUrl,
    `/regression-runs/${encodeURIComponent(runId)}/report`
  );
  assert.ok([200, 404].includes(regressionRunReport.status));

  const regressionTrend = await probeOptionalJson(
    harness.baseUrl,
    "/regressions/local-fast/trends"
  );
  assert.ok([200, 404].includes(regressionTrend.status));

  const regressionRerun = await probeOptionalJson(
    harness.baseUrl,
    `/regression-runs/${encodeURIComponent(runId)}/rerun`,
    {
      method: "POST",
      payload: {
        stub: true,
        by: "regression-probe",
        source: "regression-probe"
      }
    }
  );
  assert.ok([200, 404].includes(regressionRerun.status));
  if (regressionRerun.status === 200) {
    assert.notEqual(regressionRerun.json?.run?.id, runId);
  }
});
