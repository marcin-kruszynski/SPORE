import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const ORCHESTRATOR_PORT = 8791;
const WEB_PORT = 8792;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(url, attempts = 40) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // ignore during bootstrap
    }
    await sleep(100);
  }
  throw new Error(`health check failed: ${url}`);
}

function startProcess(command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env
    },
    stdio: 'ignore'
  });
  return child;
}

test('orchestrator HTTP and web proxy expose policy-aware plan preview', async (t) => {
  const orchestrator = startProcess('node', ['services/orchestrator/server.js'], {
    SPORE_ORCHESTRATOR_PORT: String(ORCHESTRATOR_PORT)
  });
  const web = startProcess('node', ['apps/web/server.js'], {
    SPORE_WEB_PORT: String(WEB_PORT),
    SPORE_ORCHESTRATOR_ORIGIN: `http://127.0.0.1:${ORCHESTRATOR_PORT}`,
    SPORE_GATEWAY_ORIGIN: 'http://127.0.0.1:65535'
  });

  t.after(() => {
    orchestrator.kill('SIGTERM');
    web.kill('SIGTERM');
  });

  await waitForHealth(`http://127.0.0.1:${ORCHESTRATOR_PORT}/health`);
  await waitForHealth(`http://127.0.0.1:${WEB_PORT}/`);

  const payload = {
    project: 'config/projects/example-project.yaml',
    domain: 'frontend',
    roles: ['builder', 'tester', 'reviewer'],
    objective: 'HTTP policy preview test'
  };

  const orchestratorResponse = await fetch(`http://127.0.0.1:${ORCHESTRATOR_PORT}/workflows/plan`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  assert.equal(orchestratorResponse.status, 200);
  const orchestratorPlan = await orchestratorResponse.json();
  assert.equal(orchestratorPlan.invocation.effectivePolicy.workflowPolicy.reworkStrategy, 'branch');
  assert.deepEqual(orchestratorPlan.invocation.effectivePolicy.policyPackIds, ['ui-core']);
  assert.equal(orchestratorPlan.invocation.launches[0].policy.runtimePolicy.sessionMode, 'ephemeral');

  const webResponse = await fetch(`http://127.0.0.1:${WEB_PORT}/api/orchestrator/workflows/plan`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  assert.equal(webResponse.status, 200);
  const webPlan = await webResponse.json();
  assert.equal(webPlan.invocation.effectivePolicy.workflowPolicy.reworkStrategy, 'branch');
  assert.deepEqual(webPlan.invocation.metadata.policyPacks.map((pack) => pack.id), ['ui-core']);
  assert.equal(webPlan.invocation.launches[2].policy.governance.approvalRequired, true);
});
