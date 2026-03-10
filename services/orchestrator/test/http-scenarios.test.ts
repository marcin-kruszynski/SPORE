import assert from "node:assert/strict";
import test from "node:test";

import { makeTempPaths } from "@spore/test-support";
import {
  findFreePort,
  getJson,
  postJson,
  startProcess,
  stopProcess,
  waitForHealth,
  withEventLogPath,
} from "./helpers/http-harness.js";

test("scenario, regression, and execution history routes work through orchestrator and web proxy", async (t) => {
  const ORCHESTRATOR_PORT = await findFreePort();
  const WEB_PORT = await findFreePort();
  const { dbPath, sessionDbPath, eventLogPath } = withEventLogPath(
    await makeTempPaths("spore-http-scenarios-"),
  );

  const orchestrator = startProcess(
    "node",
    ["services/orchestrator/server.js"],
    {
      SPORE_ORCHESTRATOR_PORT: String(ORCHESTRATOR_PORT),
      SPORE_ORCHESTRATOR_DB_PATH: dbPath,
      SPORE_SESSION_DB_PATH: sessionDbPath,
      SPORE_EVENT_LOG_PATH: eventLogPath,
    },
  );
  const web = startProcess("node", ["apps/web/server.js"], {
    SPORE_WEB_PORT: String(WEB_PORT),
    SPORE_ORCHESTRATOR_ORIGIN: `http://127.0.0.1:${ORCHESTRATOR_PORT}`,
    SPORE_GATEWAY_ORIGIN: "http://127.0.0.1:65535",
  });

  t.after(async () => {
    await Promise.all([stopProcess(orchestrator), stopProcess(web)]);
  });

  await waitForHealth(`http://127.0.0.1:${ORCHESTRATOR_PORT}/health`);
  await waitForHealth(`http://127.0.0.1:${WEB_PORT}/`);

  const scenarios = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/scenarios`,
  );
  assert.equal(scenarios.status, 200);
  assert.ok(Array.isArray(scenarios.json.scenarios));
  assert.ok(
    scenarios.json.scenarios.some(
      (item) => item.id === "backend-service-delivery",
    ),
  );

  const runCenter = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/run-center/summary`,
  );
  assert.equal(runCenter.status, 200);
  assert.ok(Array.isArray(runCenter.json.detail.scenarios));
  assert.ok(Array.isArray(runCenter.json.detail.regressions));
  assert.ok(runCenter.json.detail.counts);
  assert.ok(Array.isArray(runCenter.json.detail.alerts));
  assert.ok(Array.isArray(runCenter.json.detail.recommendations));
  assert.ok(Array.isArray(runCenter.json.detail.latestReports));
  if (runCenter.json.detail.latestReports[0]) {
    assert.ok(typeof runCenter.json.detail.latestReports[0].links === "object");
  }

  const scenario = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/scenarios/cli-verification-pass`,
  );
  assert.equal(scenario.status, 200);
  assert.equal(scenario.json.scenario.id, "cli-verification-pass");

  const scenarioRun = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/scenarios/cli-verification-pass/run`,
    {
      stub: true,
      wait: true,
      by: "test-runner",
      timeout: 12000,
      interval: 250,
      stepSoftTimeout: 250,
      stepHardTimeout: 1000,
    },
  );
  assert.equal(scenarioRun.status, 200);
  assert.equal(scenarioRun.json.run.scenarioId, "cli-verification-pass");
  assert.ok(
    [
      "running",
      "completed",
      "waiting_review",
      "waiting_approval",
      "held",
      "failed",
    ].includes(scenarioRun.json.run.status),
  );

  const history = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/executions/${scenarioRun.json.execution.execution.id}/history`,
  );
  assert.equal(history.status, 200);
  assert.equal(
    history.json.detail.execution.id,
    scenarioRun.json.execution.execution.id,
  );
  assert.ok(Array.isArray(history.json.detail.timeline));
  assert.ok(history.json.detail.timeline.length > 0);
  assert.ok(history.json.detail.policyDiff);

  const scenarioRuns = await getJson(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/scenarios/cli-verification-pass/runs`,
  );
  assert.equal(scenarioRuns.status, 200);
  assert.equal(scenarioRuns.json.detail.scenario.id, "cli-verification-pass");
  assert.ok(scenarioRuns.json.detail.runs.length >= 1);
  assert.equal(scenarioRuns.json.detail.runs[0].runId, undefined);
  assert.ok(Array.isArray(scenarioRuns.json.detail.runs[0].executions));

  const scenarioRunDetail = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/scenario-runs/${encodeURIComponent(scenarioRun.json.run.id)}`,
  );
  assert.equal(scenarioRunDetail.status, 200);
  assert.equal(scenarioRunDetail.json.detail.run.id, scenarioRun.json.run.id);
  assert.ok(Array.isArray(scenarioRunDetail.json.detail.suggestedActions));
  if (scenarioRunDetail.json.detail.failure) {
    assert.ok(typeof scenarioRunDetail.json.detail.failure.code === "string");
    assert.ok(typeof scenarioRunDetail.json.detail.failure.label === "string");
  }

  const scenarioArtifacts = await getJson(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/scenario-runs/${encodeURIComponent(scenarioRun.json.run.id)}/artifacts`,
  );
  assert.equal(scenarioArtifacts.status, 200);
  assert.equal(scenarioArtifacts.json.detail.run.id, scenarioRun.json.run.id);

  const runCenterProxy = await getJson(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/run-center/summary`,
  );
  assert.equal(runCenterProxy.status, 200);
  assert.ok(Array.isArray(runCenterProxy.json.detail.recentScenarioRuns));
  assert.ok(Array.isArray(runCenterProxy.json.detail.alerts));
  assert.ok(Array.isArray(runCenterProxy.json.detail.recommendations));
  assert.ok(typeof runCenterProxy.json.detail.selfBuild === "object");
  assert.ok(Array.isArray(runCenterProxy.json.detail.selfBuild.workItems));
  if (runCenterProxy.json.detail.recentScenarioRuns[0]) {
    assert.ok(
      "trendHealth" in runCenterProxy.json.detail.recentScenarioRuns[0],
    );
    assert.ok(
      "suggestedActions" in runCenterProxy.json.detail.recentScenarioRuns[0],
    );
  }

  const scenarioTrends = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/scenarios/cli-verification-pass/trends`,
  );
  assert.equal(scenarioTrends.status, 200);
  assert.equal(scenarioTrends.json.detail.scenario.id, "cli-verification-pass");
  assert.ok(
    typeof scenarioTrends.json.detail.windows.allTime.runCount === "number",
  );
  assert.ok(
    typeof scenarioTrends.json.detail.windows.allTime.health === "string",
  );

  const scenarioRerun = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/scenario-runs/${encodeURIComponent(scenarioRun.json.run.id)}/rerun`,
    {
      stub: true,
      wait: true,
      by: "test-rerun",
      reason: "HTTP rerun coverage",
      timeout: 12000,
      interval: 250,
      stepSoftTimeout: 250,
      stepHardTimeout: 1000,
    },
  );
  assert.equal(scenarioRerun.status, 200);
  assert.equal(scenarioRerun.json.rerunOf, scenarioRun.json.run.id);
  assert.equal(
    scenarioRerun.json.run.metadata?.rerunOf,
    scenarioRun.json.run.id,
  );

  const regressions = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/regressions`,
  );
  assert.equal(regressions.status, 200);
  assert.ok(
    regressions.json.regressions.some((item) => item.id === "local-fast"),
  );

  const regressionRun = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/regressions/local-fast/run`,
    {
      stub: true,
      by: "test-runner",
      timeout: 12000,
      interval: 250,
      stepSoftTimeout: 250,
      stepHardTimeout: 1000,
    },
  );
  assert.equal(regressionRun.status, 200);
  assert.equal(regressionRun.json.regression.id, "local-fast");
  assert.ok(["passed", "failed"].includes(regressionRun.json.run.status));
  assert.ok(Array.isArray(regressionRun.json.items));
  assert.ok(regressionRun.json.items.length >= 1);

  const regressionRuns = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/regressions/local-fast/runs`,
  );
  assert.equal(regressionRuns.status, 200);
  assert.equal(regressionRuns.json.detail.regression.id, "local-fast");
  assert.ok(regressionRuns.json.detail.runs.length >= 1);

  const regressionRunDetail = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/regression-runs/${encodeURIComponent(regressionRun.json.run.id)}`,
  );
  assert.equal(regressionRunDetail.status, 200);
  assert.equal(
    regressionRunDetail.json.detail.run.id,
    regressionRun.json.run.id,
  );
  assert.ok(Array.isArray(regressionRunDetail.json.detail.suggestedActions));
  if (regressionRunDetail.json.detail.failure) {
    assert.ok(typeof regressionRunDetail.json.detail.failure.code === "string");
  }

  const regressionReport = await getJson(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/regression-runs/${encodeURIComponent(regressionRun.json.run.id)}/report`,
  );
  assert.equal(regressionReport.status, 200);
  assert.equal(regressionReport.json.detail.run.id, regressionRun.json.run.id);
  assert.ok(regressionReport.json.detail.reports.json);
  assert.ok(regressionReport.json.detail.reports.markdown);
  assert.ok(Array.isArray(regressionReport.json.detail.suggestedActions));

  const regressionLatestReport = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/regressions/local-fast/latest-report`,
  );
  assert.equal(regressionLatestReport.status, 200);
  assert.equal(
    regressionLatestReport.json.detail.run.regressionId,
    "local-fast",
  );
  assert.ok(regressionLatestReport.json.detail.reports.json);
  assert.ok(regressionReport.json.detail.durationSummary);
  assert.ok(regressionReport.json.detail.artifactSummary);
  assert.ok(typeof regressionLatestReport.json.detail.links === "object");
  assert.ok(
    typeof regressionLatestReport.json.detail.trendSnapshot === "object",
  );

  const regressionTrends = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/regressions/local-fast/trends`,
  );
  assert.equal(regressionTrends.status, 200);
  assert.equal(regressionTrends.json.detail.regression.id, "local-fast");
  assert.ok(
    typeof regressionTrends.json.detail.windows.allTime.runCount === "number",
  );
  assert.ok(
    typeof regressionTrends.json.detail.windows.allTime.health === "string",
  );
  assert.ok(typeof regressionTrends.json.detail.flaky === "object");
  assert.ok(typeof regressionTrends.json.detail.scheduleStatus === "object");
  assert.ok(Array.isArray(regressionTrends.json.detail.recentRuns));
  assert.ok(typeof regressionTrends.json.detail.failureBreakdown === "object");

  const schedulerStatus = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/regressions/scheduler/status`,
  );
  assert.equal(schedulerStatus.status, 200);
  assert.ok(Array.isArray(schedulerStatus.json.detail.profiles));
  assert.ok(Array.isArray(schedulerStatus.json.detail.evaluations));
  assert.ok(
    schedulerStatus.json.detail.profiles.some(
      (item) => item.id === "local-fast" && item.scheduleStatus,
    ),
  );

  const latestRegressionReport = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/regressions/local-fast/latest-report`,
  );
  assert.equal(latestRegressionReport.status, 200);
  assert.equal(
    latestRegressionReport.json.detail.run.regressionId,
    "local-fast",
  );
  assert.ok(
    typeof latestRegressionReport.json.detail.durationSummary === "object",
  );

  const schedulerDryRun = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/regressions/scheduler/run`,
    {
      regression: "local-fast",
      dryRun: true,
    },
  );
  assert.equal(schedulerDryRun.status, 200);
  assert.ok(Array.isArray(schedulerDryRun.json.detail.candidates));
  assert.equal(schedulerDryRun.json.detail.dryRun, true);

  const regressionRerun = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/regression-runs/${encodeURIComponent(regressionRun.json.run.id)}/rerun`,
    {
      stub: true,
      by: "test-rerun",
      reason: "HTTP regression rerun coverage",
      timeout: 12000,
      interval: 250,
      stepSoftTimeout: 250,
      stepHardTimeout: 1000,
    },
  );
  assert.equal(regressionRerun.status, 200);
  assert.equal(regressionRerun.json.rerunOf, regressionRun.json.run.id);
  assert.equal(
    regressionRerun.json.run.metadata?.rerunOf,
    regressionRun.json.run.id,
  );

  const schedulerAllDryRun = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/regressions/scheduler/run`,
    {
      dryRun: true,
      all: true,
      stub: true,
      by: "test-scheduler",
    },
  );
  assert.equal(schedulerAllDryRun.status, 200);
  assert.equal(schedulerAllDryRun.json.detail.dryRun, true);
  assert.ok(Array.isArray(schedulerDryRun.json.detail.candidates));
  assert.ok(
    schedulerAllDryRun.json.detail.candidates.some(
      (item) => item.regressionId === "local-fast" && item.scheduleStatus,
    ),
  );

  const workItem = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-items`,
    {
      title: "Validate CLI scenario path",
      kind: "scenario",
      goal: "Run the CLI verification scenario through the managed work-item path.",
      relatedScenarios: ["cli-verification-pass"],
      metadata: {
        scenarioId: "cli-verification-pass",
        projectPath: "config/projects/example-project.yaml",
      },
    },
  );
  assert.equal(workItem.status, 200);
  assert.equal(workItem.json.detail.kind, "scenario");

  const workItems = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-items`,
  );
  assert.equal(workItems.status, 200);
  assert.ok(Array.isArray(workItems.json.detail));
  assert.ok(
    workItems.json.detail.some((item) => item.id === workItem.json.detail.id),
  );

  const workItemRun = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-items/${encodeURIComponent(workItem.json.detail.id)}/run`,
    {
      stub: true,
      wait: true,
      by: "test-work-item",
      timeout: 12000,
      interval: 250,
    },
  );
  assert.equal(workItemRun.status, 200);
  assert.equal(workItemRun.json.detail.item.id, workItem.json.detail.id);
  assert.ok(workItemRun.json.detail.run.id);

  const workItemDetail = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-items/${encodeURIComponent(workItem.json.detail.id)}`,
  );
  assert.equal(workItemDetail.status, 200);
  assert.equal(workItemDetail.json.detail.id, workItem.json.detail.id);
  assert.ok(Array.isArray(workItemDetail.json.detail.runs));

  const workItemRunDetail = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-item-runs/${encodeURIComponent(workItemRun.json.detail.run.id)}`,
  );
  assert.equal(workItemRunDetail.status, 200);
  assert.equal(
    workItemRunDetail.json.detail.workItemId,
    workItem.json.detail.id,
  );

  const workItemRuns = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-items/${encodeURIComponent(workItem.json.detail.id)}/runs`,
  );
  assert.equal(workItemRuns.status, 200);
  assert.equal(workItemRuns.json.detail.item.id, workItem.json.detail.id);
  assert.ok(Array.isArray(workItemRuns.json.detail.runs));

  const workItemTemplates = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-item-templates`,
  );
  assert.equal(workItemTemplates.status, 200);
  assert.ok(Array.isArray(workItemTemplates.json.detail));
  assert.ok(
    workItemTemplates.json.detail.some(
      (item) => item.id === "operator-ui-pass",
    ),
  );

  const goalPlan = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/goals/plan`,
    {
      goal: "Improve the operator dashboard docs and config surfaces.",
      projectId: "spore",
      domainId: "docs",
      safeMode: true,
    },
  );
  assert.equal(goalPlan.status, 200);
  assert.equal(goalPlan.json.detail.projectId, "spore");
  assert.ok(Array.isArray(goalPlan.json.detail.recommendedWorkItems));

  const goalPlanShow = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/goal-plans/${encodeURIComponent(goalPlan.json.detail.id)}`,
  );
  assert.equal(goalPlanShow.status, 200);
  assert.equal(goalPlanShow.json.detail.id, goalPlan.json.detail.id);

  const materializedPlan = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/goal-plans/${encodeURIComponent(goalPlan.json.detail.id)}/materialize`,
    {},
  );
  assert.equal(materializedPlan.status, 200);
  assert.equal(materializedPlan.json.detail.status, "materialized");
  assert.ok(materializedPlan.json.detail.materializedGroup);
  assert.ok(materializedPlan.json.detail.materializedItems.length >= 1);

  const workItemGroups = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-item-groups`,
  );
  assert.equal(workItemGroups.status, 200);
  assert.ok(Array.isArray(workItemGroups.json.detail));
  assert.ok(
    workItemGroups.json.detail.some(
      (item) => item.id === materializedPlan.json.detail.materializedGroup.id,
    ),
  );

  const templateWorkItem = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-items`,
    {
      templateId: "operator-ui-pass",
      title: "Operator UI self-work",
      goal: "Tighten the operator web surface.",
      metadata: {
        projectPath: "config/projects/spore.yaml",
      },
    },
  );
  assert.equal(templateWorkItem.status, 200);
  assert.equal(templateWorkItem.json.detail.kind, "workflow");

  const templateWorkItemRun = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-items/${encodeURIComponent(templateWorkItem.json.detail.id)}/run`,
    {
      stub: true,
      wait: true,
      by: "test-self-build",
      timeout: 12000,
      interval: 250,
    },
  );
  assert.equal(templateWorkItemRun.status, 200);
  assert.equal(
    templateWorkItemRun.json.detail.item.id,
    templateWorkItem.json.detail.id,
  );
  assert.ok(templateWorkItemRun.json.detail.proposal?.id);

  const proposal = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-item-runs/${encodeURIComponent(templateWorkItemRun.json.detail.run.id)}/proposal`,
  );
  assert.equal(proposal.status, 200);
  assert.equal(
    proposal.json.detail.workItemRunId,
    templateWorkItemRun.json.detail.run.id,
  );

  const proposalReviewed = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/proposal-artifacts/${encodeURIComponent(proposal.json.detail.id)}/review`,
    {
      status: "reviewed",
      by: "test-reviewer",
      comments: "Looks coherent.",
    },
  );
  assert.equal(proposalReviewed.status, 200);
  assert.equal(proposalReviewed.json.detail.status, "reviewed");

  const proposalApproved = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/proposal-artifacts/${encodeURIComponent(proposal.json.detail.id)}/approval`,
    {
      status: "approved",
      by: "test-approver",
      comments: "Approved.",
    },
  );
  assert.equal(proposalApproved.status, 200);
  assert.equal(proposalApproved.json.detail.status, "approved");

  const validation = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-item-runs/${encodeURIComponent(templateWorkItemRun.json.detail.run.id)}/validate`,
    {
      stub: true,
      by: "test-validator",
      timeout: 12000,
      interval: 250,
    },
  );
  assert.equal(validation.status, 200);
  assert.ok(validation.json.detail.validation);

  const docSuggestions = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-item-runs/${encodeURIComponent(templateWorkItemRun.json.detail.run.id)}/doc-suggestions`,
  );
  assert.equal(docSuggestions.status, 200);
  assert.ok(Array.isArray(docSuggestions.json.detail.suggestions));

  const selfBuildSummary = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/self-build/summary`,
  );
  assert.equal(selfBuildSummary.status, 200);
  assert.ok(Array.isArray(selfBuildSummary.json.detail.workItems));
  assert.ok(Array.isArray(selfBuildSummary.json.detail.proposals));
  assert.ok(Array.isArray(selfBuildSummary.json.detail.learningRecords));

  const selfBuildSummaryProxy = await getJson(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/self-build/summary`,
  );
  assert.equal(selfBuildSummaryProxy.status, 200);
  assert.ok(Array.isArray(selfBuildSummaryProxy.json.detail.workItems));

  const workItemRunProxy = await getJson(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/work-item-runs/${encodeURIComponent(templateWorkItemRun.json.detail.run.id)}`,
  );
  assert.equal(workItemRunProxy.status, 200);
  assert.equal(
    workItemRunProxy.json.detail.id,
    templateWorkItemRun.json.detail.run.id,
  );

  const proposalProxy = await getJson(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/proposal-artifacts/${encodeURIComponent(proposal.json.detail.id)}`,
  );
  assert.equal(proposalProxy.status, 200);
  assert.equal(proposalProxy.json.detail.id, proposal.json.detail.id);
});
