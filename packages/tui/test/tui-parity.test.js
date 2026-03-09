import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

import { createFamilyScenario, makeTempPaths, setReviewerPending } from '../../orchestrator/test/helpers/scenario-fixtures.js';
import { startProcess, waitForHealth } from '../../../services/orchestrator/test/helpers/http-harness.js';

const ORCHESTRATOR_PORT = 8800;

function runCli(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['packages/tui/src/cli/spore-ops.js', ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...env
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr || stdout || `cli failed: ${args.join(' ')}`));
    });
  });
}

test('tui execution and family commands consume orchestrator HTTP surfaces', async (t) => {
  const { dbPath, sessionDbPath } = await makeTempPaths('spore-tui-');
  const executionId = `tui-family-${Date.now()}`;
  const { branched } = await createFamilyScenario({
    rootRoles: ['builder', 'tester', 'reviewer'],
    childBranches: [
      { roles: ['builder', 'reviewer'], invocationId: `${executionId}-child-a` },
      { roles: ['tester', 'reviewer'], invocationId: `${executionId}-child-b` }
    ],
    domainId: 'frontend',
    invocationId: executionId,
    objective: 'TUI parity test.',
    dbPath,
    sessionDbPath
  });

  for (const child of branched.created) {
    setReviewerPending(child.invocation.invocationId, { dbPath, sessionDbPath });
  }

  const orchestrator = startProcess('node', ['services/orchestrator/server.js'], {
    SPORE_ORCHESTRATOR_PORT: String(ORCHESTRATOR_PORT),
    SPORE_ORCHESTRATOR_DB_PATH: dbPath,
    SPORE_SESSION_DB_PATH: sessionDbPath
  });
  t.after(() => orchestrator.kill('SIGTERM'));

  await waitForHealth(`http://127.0.0.1:${ORCHESTRATOR_PORT}/health`);

  const executionOutput = await runCli(['execution', '--execution', executionId, '--api', `http://127.0.0.1:${ORCHESTRATOR_PORT}`]);
  const executionPayload = JSON.parse(executionOutput.stdout);
  assert.equal(executionPayload.execution.id, executionId);
  assert.ok(executionPayload.tree.rootExecutionId === executionId);

  const familyOutput = await runCli(['family', '--execution', executionId, '--api', `http://127.0.0.1:${ORCHESTRATOR_PORT}`]);
  const familyPayload = JSON.parse(familyOutput.stdout);
  assert.equal(familyPayload.executionCount, 3);

  const historyOutput = await runCli(['history', '--execution', executionId, '--api', `http://127.0.0.1:${ORCHESTRATOR_PORT}`]);
  const historyPayload = JSON.parse(historyOutput.stdout);
  assert.equal(historyPayload.detail.execution.id, executionId);
  assert.ok(Array.isArray(historyPayload.detail.timeline));

  const scenarioListOutput = await runCli(['scenario-list', '--api', `http://127.0.0.1:${ORCHESTRATOR_PORT}`]);
  const scenarioListPayload = JSON.parse(scenarioListOutput.stdout);
  assert.ok(Array.isArray(scenarioListPayload.scenarios));
  assert.ok(scenarioListPayload.scenarios.some((item) => item.id === 'backend-service-delivery'));

  const runCenterOutput = await runCli(['run-center', '--api', `http://127.0.0.1:${ORCHESTRATOR_PORT}`]);
  const runCenterPayload = JSON.parse(runCenterOutput.stdout);
  assert.ok(Array.isArray(runCenterPayload.detail.scenarios));
  assert.ok(Array.isArray(runCenterPayload.detail.regressions));
  assert.ok(Array.isArray(runCenterPayload.detail.alerts));
  assert.ok(Array.isArray(runCenterPayload.detail.recommendations));
  assert.ok(Array.isArray(runCenterPayload.detail.latestReports));
  if (runCenterPayload.detail.recentScenarioRuns[0]) {
    assert.ok('trendHealth' in runCenterPayload.detail.recentScenarioRuns[0]);
    assert.ok('links' in runCenterPayload.detail.recentScenarioRuns[0]);
  }

  const scenarioRunOutput = await runCli([
    'scenario-run',
    '--scenario', 'cli-verification-pass',
    '--api', `http://127.0.0.1:${ORCHESTRATOR_PORT}`,
    '--stub'
  ]);
  const scenarioRunPayload = JSON.parse(scenarioRunOutput.stdout);
  assert.equal(scenarioRunPayload.run.scenarioId, 'cli-verification-pass');

  const scenarioRunShowOutput = await runCli([
    'scenario-run-show',
    '--run', scenarioRunPayload.run.id,
    '--api', `http://127.0.0.1:${ORCHESTRATOR_PORT}`
  ]);
  const scenarioRunShowPayload = JSON.parse(scenarioRunShowOutput.stdout);
  assert.equal(scenarioRunShowPayload.detail.run.id, scenarioRunPayload.run.id);
  assert.ok(Array.isArray(scenarioRunShowPayload.detail.suggestedActions));

  const scenarioTrendsOutput = await runCli([
    'scenario-trends',
    '--scenario', 'cli-verification-pass',
    '--api', `http://127.0.0.1:${ORCHESTRATOR_PORT}`
  ]);
  const scenarioTrendsPayload = JSON.parse(scenarioTrendsOutput.stdout);
  assert.ok(typeof scenarioTrendsPayload.detail.windows.allTime.runCount === 'number');
  assert.ok(typeof scenarioTrendsPayload.detail.windows.allTime.health === 'string');

  const reviewedOutput = await runCli([
    'family',
    '--execution', executionId,
    '--api', `http://127.0.0.1:${ORCHESTRATOR_PORT}`,
    '--review', 'approved',
    '--comments', 'Approve pending family reviews.'
  ]);
  const reviewedPayload = JSON.parse(reviewedOutput.stdout);
  assert.equal(reviewedPayload.ok, true);
  assert.equal(reviewedPayload.changedExecutionIds.length, 2);

  const regressionListOutput = await runCli(['regression-list', '--api', `http://127.0.0.1:${ORCHESTRATOR_PORT}`]);
  const regressionListPayload = JSON.parse(regressionListOutput.stdout);
  assert.ok(Array.isArray(regressionListPayload.regressions));
  assert.ok(regressionListPayload.regressions.some((item) => item.id === 'local-fast'));

  const regressionRunOutput = await runCli([
    'regression-run',
    '--regression', 'local-fast',
    '--api', `http://127.0.0.1:${ORCHESTRATOR_PORT}`,
    '--stub'
  ]);
  const regressionRunPayload = JSON.parse(regressionRunOutput.stdout);
  assert.equal(regressionRunPayload.regression.id, 'local-fast');

  const regressionRunShowOutput = await runCli([
    'regression-run-show',
    '--run', regressionRunPayload.run.id,
    '--api', `http://127.0.0.1:${ORCHESTRATOR_PORT}`
  ]);
  const regressionRunShowPayload = JSON.parse(regressionRunShowOutput.stdout);
  assert.equal(regressionRunShowPayload.detail.run.id, regressionRunPayload.run.id);
  assert.ok(Array.isArray(regressionRunShowPayload.detail.suggestedActions));

  const regressionTrendsOutput = await runCli([
    'regression-trends',
    '--regression', 'local-fast',
    '--api', `http://127.0.0.1:${ORCHESTRATOR_PORT}`
  ]);
  const regressionTrendsPayload = JSON.parse(regressionTrendsOutput.stdout);
  assert.ok(typeof regressionTrendsPayload.detail.windows.allTime.runCount === 'number');
  assert.ok(typeof regressionTrendsPayload.detail.windows.allTime.health === 'string');
  assert.ok(typeof regressionTrendsPayload.detail.flaky === 'object');
  assert.ok(typeof regressionTrendsPayload.detail.scheduleStatus === 'object');

  const regressionLatestReportOutput = await runCli([
    'regression-latest-report',
    '--regression', 'local-fast',
    '--api', `http://127.0.0.1:${ORCHESTRATOR_PORT}`
  ]);
  const regressionLatestReportPayload = JSON.parse(regressionLatestReportOutput.stdout);
  assert.equal(regressionLatestReportPayload.detail.run.regressionId, 'local-fast');
  assert.ok(typeof regressionLatestReportPayload.detail.durationSummary === 'object');
  assert.ok(typeof regressionLatestReportPayload.detail.trendSnapshot === 'object');
  assert.ok(typeof regressionLatestReportPayload.detail.links === 'object');

  const regressionSchedulerOutput = await runCli([
    'regression-scheduler',
    '--regression', 'local-fast',
    '--api', `http://127.0.0.1:${ORCHESTRATOR_PORT}`,
    '--dry-run'
  ]);
  const regressionSchedulerPayload = JSON.parse(regressionSchedulerOutput.stdout);
  assert.equal(regressionSchedulerPayload.detail.dryRun, true);
  assert.ok(Array.isArray(regressionSchedulerPayload.detail.candidates));

  const regressionSchedulerStatusOutput = await runCli([
    'regression-scheduler-status',
    '--api', `http://127.0.0.1:${ORCHESTRATOR_PORT}`
  ]);
  const regressionSchedulerStatusPayload = JSON.parse(regressionSchedulerStatusOutput.stdout);
  assert.ok(Array.isArray(regressionSchedulerStatusPayload.detail.profiles));
  assert.ok(Array.isArray(regressionSchedulerStatusPayload.detail.evaluations));
  assert.ok(regressionSchedulerStatusPayload.detail.profiles.some((item) => item.id === 'local-fast' && item.links));

  const selfBuildSummaryOutput = await runCli([
    'self-build-summary',
    '--api', `http://127.0.0.1:${ORCHESTRATOR_PORT}`
  ]);
  const selfBuildSummaryPayload = JSON.parse(selfBuildSummaryOutput.stdout);
  assert.ok(typeof selfBuildSummaryPayload.detail.counts === 'object');

  const workItemCreateOutput = await runCli([
    'work-item-create',
    '--title', 'CLI work item',
    '--kind', 'scenario',
    '--scenario', 'cli-verification-pass',
    '--api', `http://127.0.0.1:${ORCHESTRATOR_PORT}`
  ]);
  const workItemCreatePayload = JSON.parse(workItemCreateOutput.stdout);
  assert.equal(workItemCreatePayload.detail.kind, 'scenario');

  const workItemListOutput = await runCli(['work-item-list', '--api', `http://127.0.0.1:${ORCHESTRATOR_PORT}`]);
  const workItemListPayload = JSON.parse(workItemListOutput.stdout);
  assert.ok(Array.isArray(workItemListPayload.detail));
  assert.ok(workItemListPayload.detail.some((item) => item.id === workItemCreatePayload.detail.id));

  const workItemRunOutput = await runCli([
    'work-item-run',
    '--item', workItemCreatePayload.detail.id,
    '--api', `http://127.0.0.1:${ORCHESTRATOR_PORT}`,
    '--stub'
  ]);
  const workItemRunPayload = JSON.parse(workItemRunOutput.stdout);
  assert.equal(workItemRunPayload.detail.item.id, workItemCreatePayload.detail.id);

  const workItemShowOutput = await runCli([
    'work-item-show',
    '--item', workItemCreatePayload.detail.id,
    '--api', `http://127.0.0.1:${ORCHESTRATOR_PORT}`
  ]);
  const workItemShowPayload = JSON.parse(workItemShowOutput.stdout);
  assert.equal(workItemShowPayload.detail.id, workItemCreatePayload.detail.id);
  assert.ok(Array.isArray(workItemShowPayload.detail.runs));

  const workItemRunsOutput = await runCli([
    'work-item-runs',
    '--item', workItemCreatePayload.detail.id,
    '--api', `http://127.0.0.1:${ORCHESTRATOR_PORT}`
  ]);
  const workItemRunsPayload = JSON.parse(workItemRunsOutput.stdout);
  assert.ok(Array.isArray(workItemRunsPayload.detail.runs));

  const workItemRunShowOutput = await runCli([
    'work-item-run-show',
    '--run', workItemRunPayload.detail.run.id,
    '--api', `http://127.0.0.1:${ORCHESTRATOR_PORT}`
  ]);
  const workItemRunShowPayload = JSON.parse(workItemRunShowOutput.stdout);
  assert.equal(workItemRunShowPayload.detail.workItemId, workItemCreatePayload.detail.id);

  const workItemTemplateListOutput = await runCli([
    'work-item-template-list',
    '--api', `http://127.0.0.1:${ORCHESTRATOR_PORT}`
  ]);
  const workItemTemplateListPayload = JSON.parse(workItemTemplateListOutput.stdout);
  assert.ok(Array.isArray(workItemTemplateListPayload.detail));
  assert.ok(workItemTemplateListPayload.detail.some((item) => item.id === 'operator-ui-pass'));

  const goalPlanCreateOutput = await runCli([
    'goal-plan-create',
    '--goal', 'Improve operator dashboard docs and config surfaces.',
    '--api', `http://127.0.0.1:${ORCHESTRATOR_PORT}`
  ]);
  const goalPlanCreatePayload = JSON.parse(goalPlanCreateOutput.stdout);
  assert.ok(goalPlanCreatePayload.detail.id);

  const goalPlanMaterializeOutput = await runCli([
    'goal-plan-materialize',
    '--plan', goalPlanCreatePayload.detail.id,
    '--api', `http://127.0.0.1:${ORCHESTRATOR_PORT}`
  ]);
  const goalPlanMaterializePayload = JSON.parse(goalPlanMaterializeOutput.stdout);
  assert.equal(goalPlanMaterializePayload.detail.status, 'materialized');

  const groupShowOutput = await runCli([
    'work-item-group-show',
    '--group', goalPlanMaterializePayload.detail.materializedGroup.id,
    '--api', `http://127.0.0.1:${ORCHESTRATOR_PORT}`
  ]);
  const groupShowPayload = JSON.parse(groupShowOutput.stdout);
  assert.ok(Array.isArray(groupShowPayload.detail.items));

  const proposalWorkItemCreateOutput = await runCli([
    'work-item-create',
    '--template', 'operator-ui-pass',
    '--title', 'Proposal work item',
    '--api', `http://127.0.0.1:${ORCHESTRATOR_PORT}`
  ]);
  const proposalWorkItemCreatePayload = JSON.parse(proposalWorkItemCreateOutput.stdout);
  const proposalWorkItemRunOutput = await runCli([
    'work-item-run',
    '--item', proposalWorkItemCreatePayload.detail.id,
    '--api', `http://127.0.0.1:${ORCHESTRATOR_PORT}`,
    '--stub'
  ]);
  const proposalWorkItemRunPayload = JSON.parse(proposalWorkItemRunOutput.stdout);
  assert.ok(proposalWorkItemRunPayload.detail.proposal?.id);

  const proposalShowOutput = await runCli([
    'proposal-show',
    '--proposal', proposalWorkItemRunPayload.detail.proposal.id,
    '--api', `http://127.0.0.1:${ORCHESTRATOR_PORT}`
  ]);
  const proposalShowPayload = JSON.parse(proposalShowOutput.stdout);
  assert.equal(proposalShowPayload.detail.id, proposalWorkItemRunPayload.detail.proposal.id);

  const proposalApproveOutput = await runCli([
    'proposal-approve',
    '--proposal', proposalWorkItemRunPayload.detail.proposal.id,
    '--status', 'approved',
    '--api', `http://127.0.0.1:${ORCHESTRATOR_PORT}`
  ]);
  const proposalApprovePayload = JSON.parse(proposalApproveOutput.stdout);
  assert.equal(proposalApprovePayload.detail.status, 'approved');
});
