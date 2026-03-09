import test from "node:test";
import assert from "node:assert/strict";

import { makeTempPaths } from "../../../packages/orchestrator/test/helpers/scenario-fixtures.js";
import { findFreePort, getJson, postJson, startProcess, waitForHealth } from "./helpers/http-harness.js";

test("scenario, regression, and execution history routes work through orchestrator and web proxy", async (t) => {
  const ORCHESTRATOR_PORT = await findFreePort();
  const WEB_PORT = await findFreePort();
  const { dbPath, sessionDbPath, eventLogPath } = await makeTempPaths("spore-http-scenarios-");

  const orchestrator = startProcess("node", ["services/orchestrator/server.js"], {
    SPORE_ORCHESTRATOR_PORT: String(ORCHESTRATOR_PORT),
    SPORE_ORCHESTRATOR_DB_PATH: dbPath,
    SPORE_SESSION_DB_PATH: sessionDbPath,
    SPORE_EVENT_LOG_PATH: eventLogPath
  });
  const web = startProcess("node", ["apps/web/server.js"], {
    SPORE_WEB_PORT: String(WEB_PORT),
    SPORE_ORCHESTRATOR_ORIGIN: `http://127.0.0.1:${ORCHESTRATOR_PORT}`,
    SPORE_GATEWAY_ORIGIN: "http://127.0.0.1:65535"
  });

  t.after(() => {
    orchestrator.kill("SIGTERM");
    web.kill("SIGTERM");
  });

  await waitForHealth(`http://127.0.0.1:${ORCHESTRATOR_PORT}/health`);
  await waitForHealth(`http://127.0.0.1:${WEB_PORT}/`);

  const scenarios = await getJson(`http://127.0.0.1:${ORCHESTRATOR_PORT}/scenarios`);
  assert.equal(scenarios.status, 200);
  assert.ok(Array.isArray(scenarios.json.scenarios));
  assert.ok(scenarios.json.scenarios.some((item) => item.id === "backend-service-delivery"));

  const runCenter = await getJson(`http://127.0.0.1:${ORCHESTRATOR_PORT}/run-center/summary`);
  assert.equal(runCenter.status, 200);
  assert.ok(Array.isArray(runCenter.json.detail.scenarios));
  assert.ok(Array.isArray(runCenter.json.detail.regressions));
  assert.ok(runCenter.json.detail.counts);

  const scenario = await getJson(`http://127.0.0.1:${ORCHESTRATOR_PORT}/scenarios/cli-verification-pass`);
  assert.equal(scenario.status, 200);
  assert.equal(scenario.json.scenario.id, "cli-verification-pass");

  const scenarioRun = await postJson(`http://127.0.0.1:${ORCHESTRATOR_PORT}/scenarios/cli-verification-pass/run`, {
    stub: true,
    wait: true,
    by: "test-runner",
    timeout: 6000,
    interval: 250,
    stepSoftTimeout: 250,
    stepHardTimeout: 1000
  });
  assert.equal(scenarioRun.status, 200);
  assert.equal(scenarioRun.json.run.scenarioId, "cli-verification-pass");
  assert.ok(
    ["running", "completed", "waiting_review", "waiting_approval", "held", "failed"].includes(scenarioRun.json.run.status)
  );

  const history = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/executions/${scenarioRun.json.execution.execution.id}/history`
  );
  assert.equal(history.status, 200);
  assert.equal(history.json.detail.execution.id, scenarioRun.json.execution.execution.id);
  assert.ok(Array.isArray(history.json.detail.timeline));
  assert.ok(history.json.detail.timeline.length > 0);
  assert.ok(history.json.detail.policyDiff);

  const scenarioRuns = await getJson(`http://127.0.0.1:${WEB_PORT}/api/orchestrator/scenarios/cli-verification-pass/runs`);
  assert.equal(scenarioRuns.status, 200);
  assert.equal(scenarioRuns.json.detail.scenario.id, "cli-verification-pass");
  assert.ok(scenarioRuns.json.detail.runs.length >= 1);
  assert.equal(scenarioRuns.json.detail.runs[0].runId, undefined);
  assert.ok(Array.isArray(scenarioRuns.json.detail.runs[0].executions));

  const scenarioRunDetail = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/scenario-runs/${encodeURIComponent(scenarioRun.json.run.id)}`
  );
  assert.equal(scenarioRunDetail.status, 200);
  assert.equal(scenarioRunDetail.json.detail.run.id, scenarioRun.json.run.id);

  const scenarioArtifacts = await getJson(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/scenario-runs/${encodeURIComponent(scenarioRun.json.run.id)}/artifacts`
  );
  assert.equal(scenarioArtifacts.status, 200);
  assert.equal(scenarioArtifacts.json.detail.run.id, scenarioRun.json.run.id);

  const runCenterProxy = await getJson(`http://127.0.0.1:${WEB_PORT}/api/orchestrator/run-center/summary`);
  assert.equal(runCenterProxy.status, 200);
  assert.ok(Array.isArray(runCenterProxy.json.detail.recentScenarioRuns));

  const scenarioTrends = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/scenarios/cli-verification-pass/trends`
  );
  assert.equal(scenarioTrends.status, 200);
  assert.equal(scenarioTrends.json.detail.scenario.id, "cli-verification-pass");
  assert.ok(typeof scenarioTrends.json.detail.windows.allTime.runCount === "number");

  const scenarioRerun = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/scenario-runs/${encodeURIComponent(scenarioRun.json.run.id)}/rerun`,
    {
      stub: true,
      wait: true,
      by: "test-rerun",
      reason: "HTTP rerun coverage",
      timeout: 6000,
      interval: 250,
      stepSoftTimeout: 250,
      stepHardTimeout: 1000
    }
  );
  assert.equal(scenarioRerun.status, 200);
  assert.equal(scenarioRerun.json.rerunOf, scenarioRun.json.run.id);
  assert.equal(scenarioRerun.json.run.metadata?.rerunOf, scenarioRun.json.run.id);

  const regressions = await getJson(`http://127.0.0.1:${ORCHESTRATOR_PORT}/regressions`);
  assert.equal(regressions.status, 200);
  assert.ok(regressions.json.regressions.some((item) => item.id === "local-fast"));

  const regressionRun = await postJson(`http://127.0.0.1:${ORCHESTRATOR_PORT}/regressions/local-fast/run`, {
    stub: true,
    by: "test-runner",
    timeout: 6000,
    interval: 250,
    stepSoftTimeout: 250,
    stepHardTimeout: 1000
  });
  assert.equal(regressionRun.status, 200);
  assert.equal(regressionRun.json.regression.id, "local-fast");
  assert.ok(["passed", "failed"].includes(regressionRun.json.run.status));
  assert.ok(Array.isArray(regressionRun.json.items));
  assert.ok(regressionRun.json.items.length >= 1);

  const regressionRuns = await getJson(`http://127.0.0.1:${ORCHESTRATOR_PORT}/regressions/local-fast/runs`);
  assert.equal(regressionRuns.status, 200);
  assert.equal(regressionRuns.json.detail.regression.id, "local-fast");
  assert.ok(regressionRuns.json.detail.runs.length >= 1);

  const regressionRunDetail = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/regression-runs/${encodeURIComponent(regressionRun.json.run.id)}`
  );
  assert.equal(regressionRunDetail.status, 200);
  assert.equal(regressionRunDetail.json.detail.run.id, regressionRun.json.run.id);

  const regressionReport = await getJson(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/regression-runs/${encodeURIComponent(regressionRun.json.run.id)}/report`
  );
  assert.equal(regressionReport.status, 200);
  assert.equal(regressionReport.json.detail.run.id, regressionRun.json.run.id);
  assert.ok(regressionReport.json.detail.reports.json);
  assert.ok(regressionReport.json.detail.reports.markdown);

  const regressionTrends = await getJson(`http://127.0.0.1:${ORCHESTRATOR_PORT}/regressions/local-fast/trends`);
  assert.equal(regressionTrends.status, 200);
  assert.equal(regressionTrends.json.detail.regression.id, "local-fast");
  assert.ok(typeof regressionTrends.json.detail.windows.allTime.runCount === "number");

  const regressionRerun = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/regression-runs/${encodeURIComponent(regressionRun.json.run.id)}/rerun`,
    {
      stub: true,
      by: "test-rerun",
      reason: "HTTP regression rerun coverage",
      timeout: 6000,
      interval: 250,
      stepSoftTimeout: 250,
      stepHardTimeout: 1000
    }
  );
  assert.equal(regressionRerun.status, 200);
  assert.equal(regressionRerun.json.rerunOf, regressionRun.json.run.id);
  assert.equal(regressionRerun.json.run.metadata?.rerunOf, regressionRun.json.run.id);
});
