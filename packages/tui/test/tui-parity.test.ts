import assert from "node:assert/strict";
import test from "node:test";

import {
  getWorkItem,
  openOrchestratorDatabase,
  updateWorkItem,
} from "@spore/orchestrator";
import {
  createFamilyScenario,
  findFreePort,
  makeTempPaths,
  postJson,
  runCliScript,
  setReviewerPending,
  startProcess,
  stopProcess,
  waitForHealth,
} from "@spore/test-support";

type TempPaths = {
  dbPath: string;
  sessionDbPath: string;
  eventLogPath?: string;
};

type MutableJsonRecord = Record<string, unknown>;
type MutableWorkItem = MutableJsonRecord & {
  metadata?: MutableJsonRecord;
};

type GoalPlanResponse = {
  ok: boolean;
  detail: {
    id: string;
  };
};

type MaterializedGoalPlanResponse = {
  ok: boolean;
  detail: {
    materializedGroup: {
      id: string;
    };
    materializedItems: Array<{
      id: string;
    }>;
  };
};

type DependencyAuthoringResponse = {
  ok: boolean;
};

type RunGroupResponse = {
  ok: boolean;
};

function runCli(args: string[], env: NodeJS.ProcessEnv = {}) {
  return runCliScript("packages/tui/src/cli/spore-ops.ts", args, {
    env,
    timeoutMs: 180_000,
  });
}

function mutateWorkItem(
  dbPath: string,
  itemId: string,
  mutate: (item: MutableWorkItem) => MutableWorkItem,
) {
  const db = openOrchestratorDatabase(dbPath);
  try {
    const item = getWorkItem(db, itemId) as MutableWorkItem;
    const next = mutate(item);
    updateWorkItem(db, next);
  } finally {
    db.close();
  }
}

async function waitForStartedOrchestrator(
  child: ReturnType<typeof startProcess>,
  port: number,
) {
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  try {
    await waitForHealth(`http://127.0.0.1:${port}/health`);
  } catch (error) {
    throw new Error(
      `health check failed: http://127.0.0.1:${port}/health\nstdout:\n${stdout}\nstderr:\n${stderr}\n${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

test("tui execution and family commands consume orchestrator HTTP surfaces", {
  concurrency: false,
}, async (t) => {
  const orchestratorPort = await findFreePort();
  const { dbPath, sessionDbPath } = (await makeTempPaths(
    "spore-tui-",
  )) as TempPaths;
  const executionId = `tui-family-${Date.now()}`;
  const { branched } = await createFamilyScenario({
    rootRoles: ["builder", "tester", "reviewer"],
    childBranches: [
      {
        roles: ["builder", "reviewer"],
        invocationId: `${executionId}-child-a`,
      },
      { roles: ["tester", "reviewer"], invocationId: `${executionId}-child-b` },
    ],
    domainId: "frontend",
    invocationId: executionId,
    objective: "TUI parity test.",
    dbPath,
    sessionDbPath,
  });

  for (const child of branched.created) {
    setReviewerPending(child.invocation.invocationId, {
      dbPath,
      sessionDbPath,
    });
  }

  const orchestrator = startProcess(
    "node",
    ["services/orchestrator/server.js"],
    {
      SPORE_ORCHESTRATOR_PORT: String(orchestratorPort),
      SPORE_ORCHESTRATOR_DB_PATH: dbPath,
      SPORE_SESSION_DB_PATH: sessionDbPath,
    },
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  t.after(async () => {
    await stopProcess(orchestrator);
  });

  await waitForStartedOrchestrator(orchestrator, orchestratorPort);

  const executionOutput = await runCli([
    "execution",
    "--execution",
    executionId,
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const executionPayload = JSON.parse(executionOutput.stdout);
  assert.equal(executionPayload.execution.id, executionId);
  assert.ok(executionPayload.tree.rootExecutionId === executionId);

  const familyOutput = await runCli([
    "family",
    "--execution",
    executionId,
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const familyPayload = JSON.parse(familyOutput.stdout);
  assert.equal(familyPayload.executionCount, 3);

  const historyOutput = await runCli([
    "history",
    "--execution",
    executionId,
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const historyPayload = JSON.parse(historyOutput.stdout);
  assert.equal(historyPayload.detail.execution.id, executionId);
  assert.ok(Array.isArray(historyPayload.detail.timeline));

  const scenarioListOutput = await runCli([
    "scenario-list",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const scenarioListPayload = JSON.parse(scenarioListOutput.stdout);
  assert.ok(Array.isArray(scenarioListPayload.scenarios));
  assert.ok(
    scenarioListPayload.scenarios.some(
      (item) => item.id === "backend-service-delivery",
    ),
  );

  const runCenterOutput = await runCli([
    "run-center",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const runCenterPayload = JSON.parse(runCenterOutput.stdout);
  assert.ok(Array.isArray(runCenterPayload.detail.scenarios));
  assert.ok(Array.isArray(runCenterPayload.detail.regressions));
  assert.ok(Array.isArray(runCenterPayload.detail.alerts));
  assert.ok(Array.isArray(runCenterPayload.detail.recommendations));
  assert.ok(Array.isArray(runCenterPayload.detail.latestReports));
  if (runCenterPayload.detail.recentScenarioRuns[0]) {
    assert.ok("trendHealth" in runCenterPayload.detail.recentScenarioRuns[0]);
    assert.ok("links" in runCenterPayload.detail.recentScenarioRuns[0]);
  }

  const learningTrendsOutput = await runCli([
    "self-build-learning-trends",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const learningTrendsPayload = JSON.parse(learningTrendsOutput.stdout);
  assert.ok(Array.isArray(learningTrendsPayload.detail));

  const policyRecommendationsOutput = await runCli([
    "self-build-policy-recommendations",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const policyRecommendationsPayload = JSON.parse(
    policyRecommendationsOutput.stdout,
  );
  assert.ok(Array.isArray(policyRecommendationsPayload.detail));

  const policyRecommendationReviewsOutput = await runCli([
    "self-build-policy-recommendation-reviews",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const policyRecommendationReviewsPayload = JSON.parse(
    policyRecommendationReviewsOutput.stdout,
  );
  assert.ok(Array.isArray(policyRecommendationReviewsPayload.detail));

  const firstPolicyRecommendation = policyRecommendationsPayload.detail[0];
  if (firstPolicyRecommendation?.id) {
    const policyRecommendationShowOutput = await runCli([
      "self-build-policy-recommendation-show",
      "--recommendation",
      firstPolicyRecommendation.id,
      "--api",
      `http://127.0.0.1:${orchestratorPort}`,
    ]);
    const policyRecommendationShowPayload = JSON.parse(
      policyRecommendationShowOutput.stdout,
    );
    assert.equal(
      policyRecommendationShowPayload.detail.id,
      firstPolicyRecommendation.id,
    );

    const policyRecommendationReviewOutput = await runCli([
      "self-build-policy-recommendation-review",
      "--recommendation",
      firstPolicyRecommendation.id,
      "--status",
      "held",
      "--api",
      `http://127.0.0.1:${orchestratorPort}`,
    ]);
    const policyRecommendationReviewPayload = JSON.parse(
      policyRecommendationReviewOutput.stdout,
    );
    assert.equal(policyRecommendationReviewPayload.detail.queueStatus, "held");
  }

  const projectPlanOutput = await runCli([
    "project-plan",
    "--project",
    "config/projects/example-project.yaml",
    "--domains",
    "backend,frontend",
    "--objective",
    "Coordinate backend and frontend work for one project.",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const projectPlanPayload = JSON.parse(projectPlanOutput.stdout);
  assert.equal(
    projectPlanPayload.detail.rootInvocation.metadata.invocationMetadata
      .projectRole,
    "coordinator",
  );
  assert.equal(projectPlanPayload.detail.childInvocations.length, 2);

  const projectInvokeOutput = await runCli([
    "project-invoke",
    "--project",
    "config/projects/example-project.yaml",
    "--domains",
    "backend,frontend",
    "--objective",
    "Coordinate backend and frontend work for one project.",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
    "--wait",
    "--stub",
    "--timeout",
    "20000",
    "--interval",
    "250",
  ]);
  const projectInvokePayload = JSON.parse(projectInvokeOutput.stdout);
  const coordinatorExecutionId =
    projectInvokePayload.detail?.created?.root?.execution?.id ??
    projectInvokePayload.detail?.plan?.rootInvocation?.invocationId;
  assert.ok(coordinatorExecutionId);

  const coordinatorExecutionOutput = await runCli([
    "execution",
    "--execution",
    coordinatorExecutionId,
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const coordinatorExecutionPayload = JSON.parse(
    coordinatorExecutionOutput.stdout,
  );
  assert.equal(
    coordinatorExecutionPayload.execution.projectRole,
    "coordinator",
  );
  assert.equal(
    coordinatorExecutionPayload.execution.topology?.kind,
    "project-root",
  );

  const coordinatorReviewOutput = await runCli([
    "family",
    "--execution",
    coordinatorExecutionId,
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
    "--review",
    "approved",
    "--comments",
    "Approve project lanes for promotion.",
  ]);
  const coordinatorReviewPayload = JSON.parse(coordinatorReviewOutput.stdout);
  assert.equal(coordinatorReviewPayload.ok, true);

  const coordinatorApprovalOutput = await runCli([
    "family",
    "--execution",
    coordinatorExecutionId,
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
    "--approve",
    "approved",
    "--comments",
    "Approve project lanes for promotion.",
  ]);
  const coordinatorApprovalPayload = JSON.parse(
    coordinatorApprovalOutput.stdout,
  );
  assert.equal(coordinatorApprovalPayload.ok, true);

  const promotionPlanOutput = await runCli([
    "promotion-plan",
    "--execution",
    coordinatorExecutionId,
    "--target-branch",
    "main",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const promotionPlanPayload = JSON.parse(promotionPlanOutput.stdout);
  assert.equal(
    promotionPlanPayload.detail.invocation.metadata.invocationMetadata
      .projectRole,
    "integrator",
  );
  assert.equal(
    promotionPlanPayload.detail.invocation.metadata.invocationMetadata.promotion
      .targetBranch,
    "main",
  );

  const promotionInvokeOutput = await runCli([
    "promotion-invoke",
    "--execution",
    coordinatorExecutionId,
    "--target-branch",
    "main",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
    "--wait",
    "--stub",
    "--timeout",
    "20000",
    "--interval",
    "250",
  ]);
  const promotionInvokePayload = JSON.parse(promotionInvokeOutput.stdout);
  const integratorExecutionId =
    promotionInvokePayload.detail?.created?.execution?.id ??
    promotionInvokePayload.detail?.plan?.invocation?.invocationId;
  assert.ok(integratorExecutionId);

  const integratorExecutionOutput = await runCli([
    "execution",
    "--execution",
    integratorExecutionId,
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const integratorExecutionPayload = JSON.parse(
    integratorExecutionOutput.stdout,
  );
  assert.equal(integratorExecutionPayload.execution.projectRole, "integrator");
  assert.equal(
    integratorExecutionPayload.execution.topology?.kind,
    "promotion-lane",
  );
  assert.ok(
    ["running", "promotion_candidate", "completed"].includes(
      integratorExecutionPayload.execution.promotionStatus,
    ),
  );

  const scenarioRunOutput = await runCli([
    "scenario-run",
    "--scenario",
    "cli-verification-pass",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
    "--timeout",
    "12000",
    "--interval",
    "250",
    "--stub",
  ]);
  const scenarioRunPayload = JSON.parse(scenarioRunOutput.stdout);
  assert.equal(scenarioRunPayload.run.scenarioId, "cli-verification-pass");

  const scenarioRunShowOutput = await runCli([
    "scenario-run-show",
    "--run",
    scenarioRunPayload.run.id,
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const scenarioRunShowPayload = JSON.parse(scenarioRunShowOutput.stdout);
  assert.equal(scenarioRunShowPayload.detail.run.id, scenarioRunPayload.run.id);
  assert.ok(Array.isArray(scenarioRunShowPayload.detail.suggestedActions));

  const scenarioTrendsOutput = await runCli([
    "scenario-trends",
    "--scenario",
    "cli-verification-pass",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const scenarioTrendsPayload = JSON.parse(scenarioTrendsOutput.stdout);
  assert.ok(
    typeof scenarioTrendsPayload.detail.windows.allTime.runCount === "number",
  );
  assert.ok(
    typeof scenarioTrendsPayload.detail.windows.allTime.health === "string",
  );

  const reviewedOutput = await runCli([
    "family",
    "--execution",
    executionId,
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
    "--review",
    "approved",
    "--comments",
    "Approve pending family reviews.",
  ]);
  const reviewedPayload = JSON.parse(reviewedOutput.stdout);
  assert.equal(reviewedPayload.ok, true);
  assert.equal(reviewedPayload.changedExecutionIds.length, 2);

  const regressionListOutput = await runCli([
    "regression-list",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const regressionListPayload = JSON.parse(regressionListOutput.stdout);
  assert.ok(Array.isArray(regressionListPayload.regressions));
  assert.ok(
    regressionListPayload.regressions.some((item) => item.id === "local-fast"),
  );

  const regressionRunOutput = await runCli([
    "regression-run",
    "--regression",
    "local-fast",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
    "--timeout",
    "12000",
    "--interval",
    "250",
    "--stub",
  ]);
  const regressionRunPayload = JSON.parse(regressionRunOutput.stdout);
  assert.equal(regressionRunPayload.regression.id, "local-fast");

  const regressionRunShowOutput = await runCli([
    "regression-run-show",
    "--run",
    regressionRunPayload.run.id,
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const regressionRunShowPayload = JSON.parse(regressionRunShowOutput.stdout);
  assert.equal(
    regressionRunShowPayload.detail.run.id,
    regressionRunPayload.run.id,
  );
  assert.ok(Array.isArray(regressionRunShowPayload.detail.suggestedActions));

  const regressionTrendsOutput = await runCli([
    "regression-trends",
    "--regression",
    "local-fast",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const regressionTrendsPayload = JSON.parse(regressionTrendsOutput.stdout);
  assert.ok(
    typeof regressionTrendsPayload.detail.windows.allTime.runCount === "number",
  );
  assert.ok(
    typeof regressionTrendsPayload.detail.windows.allTime.health === "string",
  );
  assert.ok(typeof regressionTrendsPayload.detail.flaky === "object");
  assert.ok(typeof regressionTrendsPayload.detail.scheduleStatus === "object");

  const regressionLatestReportOutput = await runCli([
    "regression-latest-report",
    "--regression",
    "local-fast",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const regressionLatestReportPayload = JSON.parse(
    regressionLatestReportOutput.stdout,
  );
  assert.equal(
    regressionLatestReportPayload.detail.run.regressionId,
    "local-fast",
  );
  assert.ok(
    typeof regressionLatestReportPayload.detail.durationSummary === "object",
  );
  assert.ok(
    typeof regressionLatestReportPayload.detail.trendSnapshot === "object",
  );
  assert.ok(typeof regressionLatestReportPayload.detail.links === "object");

  const regressionSchedulerOutput = await runCli([
    "regression-scheduler",
    "--regression",
    "local-fast",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
    "--dry-run",
  ]);
  const regressionSchedulerPayload = JSON.parse(
    regressionSchedulerOutput.stdout,
  );
  assert.equal(regressionSchedulerPayload.detail.dryRun, true);
  assert.ok(Array.isArray(regressionSchedulerPayload.detail.candidates));

  const regressionSchedulerStatusOutput = await runCli([
    "regression-scheduler-status",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const regressionSchedulerStatusPayload = JSON.parse(
    regressionSchedulerStatusOutput.stdout,
  );
  assert.ok(Array.isArray(regressionSchedulerStatusPayload.detail.profiles));
  assert.ok(Array.isArray(regressionSchedulerStatusPayload.detail.evaluations));
  assert.ok(
    regressionSchedulerStatusPayload.detail.profiles.some(
      (item) => item.id === "local-fast" && item.links,
    ),
  );

  const selfBuildSummaryOutput = await runCli([
    "self-build-summary",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const selfBuildSummaryPayload = JSON.parse(selfBuildSummaryOutput.stdout);
  assert.ok(typeof selfBuildSummaryPayload.detail.counts === "object");

  // Test self-build triage command (formatted output)
  const selfBuildTriageOutput = await runCli([
    "self-build",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  assert.ok(selfBuildTriageOutput.stdout.includes("SPORE Self-Build Triage"));
  assert.ok(selfBuildTriageOutput.stdout.includes("OVERVIEW"));
  assert.ok(selfBuildTriageOutput.stdout.includes("URGENT WORK"));
  assert.ok(selfBuildTriageOutput.stdout.includes("FOLLOW-UP WORK"));
  assert.ok(selfBuildTriageOutput.stdout.includes("NEXT ACTIONS"));

  // Test self-build with --json flag (JSON output)
  const selfBuildJsonOutput = await runCli([
    "self-build",
    "--json",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const selfBuildJsonPayload = JSON.parse(selfBuildJsonOutput.stdout);
  assert.ok(typeof selfBuildJsonPayload.detail.counts === "object");
  assert.ok(Array.isArray(selfBuildJsonPayload.detail.urgentWork));
  assert.ok(Array.isArray(selfBuildJsonPayload.detail.followUpWork));

  const workItemCreateOutput = await runCli([
    "work-item-create",
    "--title",
    "CLI work item",
    "--kind",
    "scenario",
    "--scenario",
    "cli-verification-pass",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const workItemCreatePayload = JSON.parse(workItemCreateOutput.stdout);
  assert.equal(workItemCreatePayload.detail.kind, "scenario");

  const workItemListOutput = await runCli([
    "work-item-list",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const workItemListPayload = JSON.parse(workItemListOutput.stdout);
  assert.ok(Array.isArray(workItemListPayload.detail));
  assert.ok(
    workItemListPayload.detail.some(
      (item) => item.id === workItemCreatePayload.detail.id,
    ),
  );

  const workItemRunOutput = await runCli([
    "work-item-run",
    "--item",
    workItemCreatePayload.detail.id,
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
    "--timeout",
    "12000",
    "--interval",
    "250",
    "--stub",
  ]);
  const workItemRunPayload = JSON.parse(workItemRunOutput.stdout);
  assert.equal(
    workItemRunPayload.detail.item.id,
    workItemCreatePayload.detail.id,
  );

  const workItemShowOutput = await runCli([
    "work-item-show",
    "--item",
    workItemCreatePayload.detail.id,
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const workItemShowPayload = JSON.parse(workItemShowOutput.stdout);
  assert.equal(workItemShowPayload.detail.id, workItemCreatePayload.detail.id);
  assert.ok(Array.isArray(workItemShowPayload.detail.runs));

  const workItemRunsOutput = await runCli([
    "work-item-runs",
    "--item",
    workItemCreatePayload.detail.id,
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const workItemRunsPayload = JSON.parse(workItemRunsOutput.stdout);
  assert.ok(Array.isArray(workItemRunsPayload.detail.runs));

  const workItemRunShowOutput = await runCli([
    "work-item-run-show",
    "--run",
    workItemRunPayload.detail.run.id,
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const workItemRunShowPayload = JSON.parse(workItemRunShowOutput.stdout);
  assert.equal(
    workItemRunShowPayload.detail.workItemId,
    workItemCreatePayload.detail.id,
  );

  const workItemDocSuggestionsOutput = await runCli([
    "work-item-doc-suggestions",
    "--run",
    workItemRunPayload.detail.run.id,
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const workItemDocSuggestionsPayload = JSON.parse(
    workItemDocSuggestionsOutput.stdout,
  );
  assert.equal(
    workItemDocSuggestionsPayload.detail.runId,
    workItemRunPayload.detail.run.id,
  );
  assert.ok(Array.isArray(workItemDocSuggestionsPayload.detail.suggestions));

  const selfBuildLearningsOutput = await runCli([
    "self-build-learnings",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const selfBuildLearningsPayload = JSON.parse(selfBuildLearningsOutput.stdout);
  assert.ok(Array.isArray(selfBuildLearningsPayload.detail));

  const selfBuildDocSuggestionsOutput = await runCli([
    "self-build-doc-suggestions",
    "--run",
    workItemRunPayload.detail.run.id,
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const selfBuildDocSuggestionsPayload = JSON.parse(
    selfBuildDocSuggestionsOutput.stdout,
  );
  assert.ok(Array.isArray(selfBuildDocSuggestionsPayload.detail));

  const firstDocSuggestion = selfBuildDocSuggestionsPayload.detail[0] ?? null;
  if (firstDocSuggestion) {
    const docSuggestionShowOutput = await runCli([
      "doc-suggestion-show",
      "--suggestion",
      firstDocSuggestion.id,
      "--api",
      `http://127.0.0.1:${orchestratorPort}`,
    ]);
    const docSuggestionShowPayload = JSON.parse(docSuggestionShowOutput.stdout);
    assert.equal(docSuggestionShowPayload.detail.id, firstDocSuggestion.id);

    const docSuggestionReviewOutput = await runCli([
      "doc-suggestion-review",
      "--suggestion",
      firstDocSuggestion.id,
      "--status",
      "accepted",
      "--api",
      `http://127.0.0.1:${orchestratorPort}`,
    ]);
    const docSuggestionReviewPayload = JSON.parse(
      docSuggestionReviewOutput.stdout,
    );
    assert.equal(docSuggestionReviewPayload.detail.status, "accepted");
  }

  const selfBuildIntakeRefreshOutput = await runCli([
    "self-build-intake-refresh",
    "--include-accepted",
    "--project",
    "spore",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const selfBuildIntakeRefreshPayload = JSON.parse(
    selfBuildIntakeRefreshOutput.stdout,
  );
  assert.ok(Array.isArray(selfBuildIntakeRefreshPayload.detail));

  const selfBuildIntakeOutput = await runCli([
    "self-build-intake",
    "--project",
    "spore",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const selfBuildIntakePayload = JSON.parse(selfBuildIntakeOutput.stdout);
  assert.ok(Array.isArray(selfBuildIntakePayload.detail));

  const firstIntake = selfBuildIntakePayload.detail[0] ?? null;
  if (firstIntake) {
    const selfBuildIntakeShowOutput = await runCli([
      "self-build-intake-show",
      "--intake",
      firstIntake.id,
      "--api",
      `http://127.0.0.1:${orchestratorPort}`,
    ]);
    const selfBuildIntakeShowPayload = JSON.parse(
      selfBuildIntakeShowOutput.stdout,
    );
    assert.equal(selfBuildIntakeShowPayload.detail.id, firstIntake.id);

    const selfBuildIntakeReviewOutput = await runCli([
      "self-build-intake-review",
      "--intake",
      firstIntake.id,
      "--status",
      "accepted",
      "--api",
      `http://127.0.0.1:${orchestratorPort}`,
    ]);
    const selfBuildIntakeReviewPayload = JSON.parse(
      selfBuildIntakeReviewOutput.stdout,
    );
    assert.equal(selfBuildIntakeReviewPayload.detail.status, "accepted");
  }

  const workItemTemplateListOutput = await runCli([
    "work-item-template-list",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const workItemTemplateListPayload = JSON.parse(
    workItemTemplateListOutput.stdout,
  );
  assert.ok(Array.isArray(workItemTemplateListPayload.detail));
  assert.ok(
    workItemTemplateListPayload.detail.some(
      (item) => item.id === "operator-ui-pass",
    ),
  );

  const goalPlanCreateOutput = await runCli([
    "goal-plan-create",
    "--goal",
    "Improve operator dashboard docs and config surfaces.",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const goalPlanCreatePayload = JSON.parse(goalPlanCreateOutput.stdout);
  assert.ok(goalPlanCreatePayload.detail.id);

  const selfBuildOverrideCreateOutput = await runCli([
    "self-build-override-create",
    "--target-type",
    "goal-plan",
    "--target-id",
    goalPlanCreatePayload.detail.id,
    "--reason",
    "Exercise protected-tier override flow in TUI parity.",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const selfBuildOverrideCreatePayload = JSON.parse(
    selfBuildOverrideCreateOutput.stdout,
  );
  assert.ok(
    ["self-build-override", "goal-plan"].includes(
      String(selfBuildOverrideCreatePayload.detail.targetType),
    ),
  );
  assert.ok(
    [
      selfBuildOverrideCreatePayload.detail.overrideTargetType,
      selfBuildOverrideCreatePayload.detail.targetType,
    ].includes("goal-plan"),
  );
  assert.equal(
    selfBuildOverrideCreatePayload.detail.overrideTargetId,
    goalPlanCreatePayload.detail.id,
  );

  const selfBuildOverridesOutput = await runCli([
    "self-build-overrides",
    "--target-type",
    "goal-plan",
    "--target-id",
    goalPlanCreatePayload.detail.id,
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const selfBuildOverridesPayload = JSON.parse(selfBuildOverridesOutput.stdout);
  assert.ok(Array.isArray(selfBuildOverridesPayload.detail));
  const createdOverride = selfBuildOverridesPayload.detail.find(
    (entry) => entry.overrideTargetId === goalPlanCreatePayload.detail.id,
  );
  assert.ok(createdOverride);

  const selfBuildOverrideShowOutput = await runCli([
    "self-build-override-show",
    "--override",
    createdOverride.id,
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const selfBuildOverrideShowPayload = JSON.parse(
    selfBuildOverrideShowOutput.stdout,
  );
  assert.equal(selfBuildOverrideShowPayload.detail.id, createdOverride.id);

  const selfBuildOverrideReviewOutput = await runCli([
    "self-build-override-review",
    "--override",
    createdOverride.id,
    "--status",
    "held",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const selfBuildOverrideReviewPayload = JSON.parse(
    selfBuildOverrideReviewOutput.stdout,
  );
  assert.equal(selfBuildOverrideReviewPayload.detail.status, "held");

  const selfBuildOverrideReleaseOutput = await runCli([
    "self-build-override-release",
    "--override",
    createdOverride.id,
    "--reason",
    "Release override after parity coverage.",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const selfBuildOverrideReleasePayload = JSON.parse(
    selfBuildOverrideReleaseOutput.stdout,
  );
  assert.equal(selfBuildOverrideReleasePayload.detail.status, "released");

  const goalPlanHistoryOutput = await runCli([
    "goal-plan-history",
    "--plan",
    goalPlanCreatePayload.detail.id,
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const goalPlanHistoryPayload = JSON.parse(goalPlanHistoryOutput.stdout);
  assert.ok(Array.isArray(goalPlanHistoryPayload.detail.history));

  const reversedRecommendations = [
    ...(goalPlanCreatePayload.detail.recommendations ?? []),
  ].reverse();
  const goalPlanEditOutput = await runCli([
    "goal-plan-edit",
    "--plan",
    goalPlanCreatePayload.detail.id,
    "--recommendations-json",
    JSON.stringify(reversedRecommendations),
    "--rationale",
    "Exercise editable goal-plan review through TUI parity.",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const goalPlanEditPayload = JSON.parse(goalPlanEditOutput.stdout);
  assert.ok(Array.isArray(goalPlanEditPayload.detail.editedRecommendations));

  const goalPlanReviewOutput = await runCli([
    "goal-plan-review",
    "--plan",
    goalPlanCreatePayload.detail.id,
    "--status",
    "reviewed",
    "--comments",
    "Review before materialization in TUI parity coverage.",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const goalPlanReviewPayload = JSON.parse(goalPlanReviewOutput.stdout);
  assert.equal(goalPlanReviewPayload.detail.status, "reviewed");

  const goalPlanMaterializeOutput = await runCli([
    "goal-plan-materialize",
    "--plan",
    goalPlanCreatePayload.detail.id,
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const goalPlanMaterializePayload = JSON.parse(
    goalPlanMaterializeOutput.stdout,
  );
  assert.equal(goalPlanMaterializePayload.detail.status, "materialized");

  const groupShowOutput = await runCli([
    "work-item-group-show",
    "--group",
    goalPlanMaterializePayload.detail.materializedGroup.id,
    "--json",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const groupShowPayload = JSON.parse(groupShowOutput.stdout);
  assert.ok(Array.isArray(groupShowPayload.detail.items));

  const proposalWorkItemCreateOutput = await runCli([
    "work-item-create",
    "--template",
    "operator-ui-pass",
    "--title",
    "Proposal work item",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const proposalWorkItemCreatePayload = JSON.parse(
    proposalWorkItemCreateOutput.stdout,
  );
  const proposalWorkItemRunOutput = await runCli([
    "work-item-run",
    "--item",
    proposalWorkItemCreatePayload.detail.id,
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
    "--timeout",
    "12000",
    "--interval",
    "250",
    "--stub",
  ]);
  const proposalWorkItemRunPayload = JSON.parse(
    proposalWorkItemRunOutput.stdout,
  );
  assert.ok(proposalWorkItemRunPayload.detail.proposal?.id);

  const proposalShowOutput = await runCli([
    "proposal-show",
    "--proposal",
    proposalWorkItemRunPayload.detail.proposal.id,
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const proposalShowPayload = JSON.parse(proposalShowOutput.stdout);
  assert.equal(
    proposalShowPayload.detail.id,
    proposalWorkItemRunPayload.detail.proposal.id,
  );

  const proposalApproveOutput = await runCli([
    "proposal-approve",
    "--proposal",
    proposalWorkItemRunPayload.detail.proposal.id,
    "--status",
    "approved",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const proposalApprovePayload = JSON.parse(proposalApproveOutput.stdout);
  assert.ok(
    ["validation_required", "promotion_ready"].includes(
      proposalApprovePayload.detail.status,
    ),
  );

  const proposalReviewPackageOutput = await runCli([
    "proposal-review-package",
    "--proposal",
    proposalWorkItemRunPayload.detail.proposal.id,
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const proposalReviewPackagePayload = JSON.parse(
    proposalReviewPackageOutput.stdout,
  );
  assert.equal(
    proposalReviewPackagePayload.detail.proposal.id,
    proposalWorkItemRunPayload.detail.proposal.id,
  );
  assert.ok(
    Array.isArray(proposalReviewPackagePayload.detail.suggestedActions),
  );

  const integrationBranchListOutput = await runCli([
    "integration-branch-list",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const integrationBranchListPayload = JSON.parse(
    integrationBranchListOutput.stdout,
  );
  assert.ok(Array.isArray(integrationBranchListPayload.detail));

  const selfBuildLoopStatusOutput = await runCli([
    "self-build-loop-status",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const selfBuildLoopStatusPayload = JSON.parse(
    selfBuildLoopStatusOutput.stdout,
  );
  assert.ok(selfBuildLoopStatusPayload.detail);
  assert.ok(selfBuildLoopStatusPayload.detail.status);

  const selfBuildLoopStartOutput = await runCli([
    "self-build-loop-start",
    "--stub",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const selfBuildLoopStartPayload = JSON.parse(selfBuildLoopStartOutput.stdout);
  assert.ok(selfBuildLoopStartPayload.detail);
  assert.ok(selfBuildLoopStartPayload.detail.status);

  const selfBuildLoopStopOutput = await runCli([
    "self-build-loop-stop",
    "--reason",
    "TUI parity coverage complete.",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const selfBuildLoopStopPayload = JSON.parse(selfBuildLoopStopOutput.stdout);
  assert.equal(selfBuildLoopStopPayload.detail.status, "stopped");

  const selfBuildDecisionsOutput = await runCli([
    "self-build-decisions",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const selfBuildDecisionsPayload = JSON.parse(selfBuildDecisionsOutput.stdout);
  assert.ok(Array.isArray(selfBuildDecisionsPayload.detail));
  assert.ok(
    selfBuildDecisionsPayload.detail.some(
      (entry) => entry.action === "start-loop" || entry.action === "stop-loop",
    ),
  );

  const goalPlanQuarantineOutput = await runCli([
    "goal-plan-quarantine",
    "--plan",
    goalPlanCreatePayload.detail.id,
    "--reason",
    "Exercise TUI quarantine controls.",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const goalPlanQuarantinePayload = JSON.parse(goalPlanQuarantineOutput.stdout);
  assert.equal(goalPlanQuarantinePayload.detail.targetType, "goal-plan");

  const selfBuildQuarantineOutput = await runCli([
    "self-build-quarantine",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const selfBuildQuarantinePayload = JSON.parse(
    selfBuildQuarantineOutput.stdout,
  );
  assert.ok(Array.isArray(selfBuildQuarantinePayload.detail));
  const goalPlanQuarantineRecord = selfBuildQuarantinePayload.detail.find(
    (entry) =>
      entry.targetType === "goal-plan" &&
      entry.targetId === goalPlanCreatePayload.detail.id &&
      entry.status === "active",
  );
  assert.ok(goalPlanQuarantineRecord);

  const goalPlanQuarantineReleaseOutput = await runCli([
    "self-build-quarantine-release",
    "--quarantine",
    goalPlanQuarantineRecord.id,
    "--reason",
    "Release quarantine after CLI parity coverage.",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const goalPlanQuarantineReleasePayload = JSON.parse(
    goalPlanQuarantineReleaseOutput.stdout,
  );
  assert.equal(goalPlanQuarantineReleasePayload.detail.status, "released");

  const integrationBranchName = integrationBranchListPayload.detail[0]?.name;
  if (integrationBranchName) {
    const integrationBranchQuarantineOutput = await runCli([
      "integration-branch-quarantine",
      "--name",
      integrationBranchName,
      "--reason",
      "Exercise integration branch quarantine coverage.",
      "--api",
      `http://127.0.0.1:${orchestratorPort}`,
    ]);
    const integrationBranchQuarantinePayload = JSON.parse(
      integrationBranchQuarantineOutput.stdout,
    );
    assert.equal(
      integrationBranchQuarantinePayload.detail.targetType,
      "integration-branch",
    );

    const integrationBranchRollbackOutput = await runCli([
      "integration-branch-rollback",
      "--name",
      integrationBranchName,
      "--reason",
      "Exercise integration branch rollback coverage.",
      "--api",
      `http://127.0.0.1:${orchestratorPort}`,
    ]);
    const integrationBranchRollbackPayload = JSON.parse(
      integrationBranchRollbackOutput.stdout,
    );
    assert.equal(
      integrationBranchRollbackPayload.detail.rollback.targetType,
      "integration-branch",
    );

    const selfBuildRollbackOutput = await runCli([
      "self-build-rollback",
      "--api",
      `http://127.0.0.1:${orchestratorPort}`,
    ]);
    const selfBuildRollbackPayload = JSON.parse(selfBuildRollbackOutput.stdout);
    assert.ok(Array.isArray(selfBuildRollbackPayload.detail));
    assert.ok(
      selfBuildRollbackPayload.detail.some(
        (entry) =>
          entry.targetType === "integration-branch" &&
          entry.targetId === integrationBranchName,
      ),
    );
  }

  // Test self-build drilldown commands use orchestrator HTTP surfaces
  const selfBuildItemOutput = await runCli([
    "self-build",
    "--item",
    workItemCreatePayload.detail.id,
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const selfBuildItemPayload = JSON.parse(selfBuildItemOutput.stdout);
  assert.equal(selfBuildItemPayload.detail.id, workItemCreatePayload.detail.id);
  assert.ok(Array.isArray(selfBuildItemPayload.detail.runs));
  assert.ok(selfBuildItemPayload.detail.links);

  const selfBuildProposalOutput = await runCli([
    "self-build",
    "--proposal",
    proposalWorkItemRunPayload.detail.proposal.id,
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const selfBuildProposalPayload = JSON.parse(selfBuildProposalOutput.stdout);
  assert.equal(
    selfBuildProposalPayload.detail.id,
    proposalWorkItemRunPayload.detail.proposal.id,
  );
  assert.ok(selfBuildProposalPayload.detail.links);

  const selfBuildGroupOutput = await runCli([
    "self-build",
    "--group",
    goalPlanMaterializePayload.detail.materializedGroup.id,
    "--json",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const selfBuildGroupPayload = JSON.parse(selfBuildGroupOutput.stdout);
  assert.equal(
    selfBuildGroupPayload.detail.id,
    goalPlanMaterializePayload.detail.materializedGroup.id,
  );
  assert.ok(Array.isArray(selfBuildGroupPayload.detail.items));
  assert.ok(selfBuildGroupPayload.detail.links);

  const selfBuildRunOutput = await runCli([
    "self-build",
    "--run",
    workItemRunPayload.detail.run.id,
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const selfBuildRunPayload = JSON.parse(selfBuildRunOutput.stdout);
  assert.equal(selfBuildRunPayload.detail.id, workItemRunPayload.detail.run.id);
  assert.ok(selfBuildRunPayload.detail.workItemId);

  const selfBuildPlanOutput = await runCli([
    "self-build",
    "--plan",
    goalPlanCreatePayload.detail.id,
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const selfBuildPlanPayload = JSON.parse(selfBuildPlanOutput.stdout);
  assert.equal(selfBuildPlanPayload.detail.id, goalPlanCreatePayload.detail.id);
  assert.ok(selfBuildPlanPayload.detail.links);
});

test("tui self-build group and summary commands surface dependency-aware readiness over HTTP routes", {
  concurrency: false,
}, async (t) => {
  const orchestratorPort = await findFreePort();
  const { dbPath, sessionDbPath, eventLogPath } = (await makeTempPaths(
    "spore-tui-dependency-",
  )) as TempPaths;

  const orchestrator = startProcess(
    "node",
    ["services/orchestrator/server.js"],
    {
      SPORE_ORCHESTRATOR_PORT: String(orchestratorPort),
      SPORE_ORCHESTRATOR_DB_PATH: dbPath,
      SPORE_SESSION_DB_PATH: sessionDbPath,
      SPORE_EVENT_LOG_PATH: eventLogPath,
    },
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  t.after(async () => {
    await stopProcess(orchestrator);
  });

  await waitForStartedOrchestrator(orchestrator, orchestratorPort);

  const goalPlan = await postJson<GoalPlanResponse>(
    `http://127.0.0.1:${orchestratorPort}/goals/plan`,
    {
      goal: "docs config dashboard runtime dependency graph validation",
      safeMode: true,
      by: "tui-test-runner",
      source: "tui-dependency-parity-test",
    },
  );
  assert.equal(goalPlan.status, 200);
  assert.ok(goalPlan.json.ok);

  const reviewed = await postJson(
    `http://127.0.0.1:${orchestratorPort}/goal-plans/${encodeURIComponent(goalPlan.json.detail.id)}/review`,
    {
      status: "reviewed",
      comments:
        "Dependencies test requires reviewed goal plan before materialization.",
      by: "tui-test-runner",
    },
  );
  assert.equal(reviewed.status, 200);
  assert.ok(reviewed.json.ok);

  const materialized = await postJson<MaterializedGoalPlanResponse>(
    `http://127.0.0.1:${orchestratorPort}/goal-plans/${encodeURIComponent(goalPlan.json.detail.id)}/materialize`,
    { by: "tui-test-runner" },
  );
  assert.equal(materialized.status, 200);
  assert.ok(materialized.json.ok);

  const groupId = materialized.json.detail.materializedGroup.id;
  const items = [...materialized.json.detail.materializedItems];
  while (items.length < 4) {
    const supplementalItem = await postJson(
      `http://127.0.0.1:${orchestratorPort}/work-items`,
      {
        title: `Supplemental dependency item ${items.length + 1}`,
        goal: "Pad dependency graph coverage items.",
        kind: "scenario",
        metadata: {
          groupId,
          goalPlanId: goalPlan.json.detail.id,
          projectPath: "config/projects/spore.yaml",
          groupOrder: items.length,
        },
      },
    );
    assert.equal(supplementalItem.status, 200);
    assert.ok(supplementalItem.json.ok);
    items.push(supplementalItem.json.detail);
  }
  assert.ok(items.length >= 4);

  const [successItemId, failingItemId, hardBlockedItemId, advisoryItemId] =
    items.slice(0, 4).map((item) => item.id);
  const updatedAt = new Date().toISOString();

  mutateWorkItem(dbPath, successItemId, (item) => ({
    ...item,
    title: "Dependency root succeeds",
    kind: "scenario",
    status: "pending",
    updatedAt,
    metadata: {
      ...item.metadata,
      scenarioId: "cli-verification-pass",
      projectPath: "config/projects/spore.yaml",
      groupOrder: 0,
      dependsOn: [],
      dependencies: [],
    },
  }));
  mutateWorkItem(dbPath, failingItemId, (item) => ({
    ...item,
    title: "Dependency root fails",
    kind: "scenario",
    status: "pending",
    updatedAt,
    metadata: {
      ...item.metadata,
      scenarioId: "missing-scenario-id",
      projectPath: "config/projects/spore.yaml",
      groupOrder: 1,
      dependsOn: [],
      dependencies: [],
    },
  }));
  mutateWorkItem(dbPath, hardBlockedItemId, (item) => ({
    ...item,
    title: "Hard dependent waits",
    kind: "scenario",
    status: "pending",
    updatedAt,
    metadata: {
      ...item.metadata,
      scenarioId: "cli-verification-pass",
      projectPath: "config/projects/spore.yaml",
      groupOrder: 2,
      dependsOn: [],
      dependencies: [],
    },
  }));
  mutateWorkItem(dbPath, advisoryItemId, (item) => ({
    ...item,
    title: "Advisory dependent keeps moving",
    kind: "scenario",
    status: "pending",
    updatedAt,
    metadata: {
      ...item.metadata,
      scenarioId: "cli-verification-pass",
      projectPath: "config/projects/spore.yaml",
      groupOrder: 3,
      dependsOn: [],
      dependencies: [],
    },
  }));

  const authored = await postJson<DependencyAuthoringResponse>(
    `http://127.0.0.1:${orchestratorPort}/work-item-groups/${encodeURIComponent(groupId)}/dependencies`,
    {
      edges: [
        {
          itemId: hardBlockedItemId,
          dependencyItemId: failingItemId,
          strictness: "hard",
          autoRelaxation: false,
        },
        {
          itemId: advisoryItemId,
          dependencyItemId: failingItemId,
          strictness: "advisory",
          autoRelaxation: {
            enabled: true,
            reason: "Advisory work can continue with a visible warning.",
          },
        },
      ],
    },
  );
  assert.equal(authored.status, 200);
  assert.ok(authored.json.ok);

  const groupShowOutput = await runCli([
    "work-item-group-show",
    "--group",
    groupId,
    "--json",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const groupShowPayload = JSON.parse(groupShowOutput.stdout);
  assert.equal(groupShowPayload.detail.id, groupId);
  assert.equal(groupShowPayload.detail.readiness.headlineState, "ready");
  assert.equal(groupShowPayload.detail.readiness.counts.blocked, 1);
  assert.ok(groupShowPayload.detail.readiness.preRunSummary.label);
  assert.ok(groupShowPayload.detail.readiness.blockerIds.length >= 1);
  assert.ok(
    groupShowPayload.detail.dependencyGraph.edges.some(
      (edge) => edge.strictness === "hard",
    ),
  );
  assert.ok(
    groupShowPayload.detail.dependencyGraph.edges.some(
      (edge) => edge.strictness === "advisory",
    ),
  );

  const selfBuildGroupOutput = await runCli([
    "self-build",
    "--group",
    groupId,
    "--json",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const selfBuildGroupPayload = JSON.parse(selfBuildGroupOutput.stdout);
  assert.equal(selfBuildGroupPayload.detail.id, groupId);
  assert.equal(selfBuildGroupPayload.detail.readiness.counts.blocked, 1);
  assert.ok(
    selfBuildGroupPayload.detail.items.some((item) => item.blockerIds?.length),
  );

  const formattedGroupOutput = await runCli([
    "work-item-group-show",
    "--group",
    groupId,
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  assert.ok(formattedGroupOutput.stdout.includes("SPORE Work-Item Group"));
  assert.ok(formattedGroupOutput.stdout.includes("DEPENDENCIES"));
  assert.ok(formattedGroupOutput.stdout.includes("strictness: hard"));
  assert.ok(formattedGroupOutput.stdout.includes("ATTENTION"));

  const formattedSelfBuildGroupOutput = await runCli([
    "self-build",
    "--group",
    groupId,
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  assert.ok(
    formattedSelfBuildGroupOutput.stdout.includes("SPORE Work-Item Group"),
  );
  assert.ok(formattedSelfBuildGroupOutput.stdout.includes("Blockers:"));

  const runGroup = await postJson<RunGroupResponse>(
    `http://127.0.0.1:${orchestratorPort}/work-item-groups/${encodeURIComponent(groupId)}/run`,
    {
      stub: true,
      timeout: 12000,
      interval: 250,
      by: "tui-test-runner",
      source: "tui-dependency-parity-test",
    },
  );
  assert.equal(runGroup.status, 200);
  assert.ok(runGroup.json.ok);

  const selfBuildJsonOutput = await runCli([
    "self-build",
    "--json",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  const selfBuildJsonPayload = JSON.parse(selfBuildJsonOutput.stdout);
  const blockedUrgent = selfBuildJsonPayload.detail.urgentWork.find(
    (entry) => entry.itemId === hardBlockedItemId,
  );
  assert.ok(blockedUrgent);
  assert.ok(blockedUrgent.reason.includes("failed"));
  assert.ok(Array.isArray(blockedUrgent.blockerIds));
  assert.ok(blockedUrgent.nextActionHint.includes("Retry or resolve"));

  const triageOutput = await runCli([
    "self-build",
    "--api",
    `http://127.0.0.1:${orchestratorPort}`,
  ]);
  assert.ok(triageOutput.stdout.includes("GROUP READINESS"));
  assert.ok(triageOutput.stdout.includes("review-needed"));
  assert.ok(triageOutput.stdout.includes("blockers:"));
});
