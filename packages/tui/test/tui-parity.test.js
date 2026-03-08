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
});
