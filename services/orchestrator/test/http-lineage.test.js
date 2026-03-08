import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

import { createExecution } from "../../../packages/orchestrator/src/execution/workflow-execution.js";
import { planWorkflowInvocation } from "../../../packages/orchestrator/src/invocation/plan-workflow-invocation.js";

const ORCHESTRATOR_PORT = 8793;
const WEB_PORT = 8794;

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
      // service still booting
    }
    await sleep(100);
  }
  throw new Error(`health check failed: ${url}`);
}

function startProcess(command, args, env = {}) {
  return spawn(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env
    },
    stdio: "ignore"
  });
}

test("orchestrator tree and branch APIs expose lineage-aware execution graphs", async (t) => {
  const executionId = `http-tree-root-${Date.now()}`;
  const invocation = await planWorkflowInvocation({
    projectPath: "config/projects/example-project.yaml",
    domainId: "frontend",
    roles: ["builder", "tester", "reviewer"],
    invocationId: executionId,
    objective: "HTTP lineage graph test"
  });
  createExecution(invocation);

  const orchestrator = startProcess("node", ["services/orchestrator/server.js"], {
    SPORE_ORCHESTRATOR_PORT: String(ORCHESTRATOR_PORT)
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

  const branchPayload = {
    branches: [
      {
        roles: ["builder", "tester"],
        objective: "Spawned child branch A"
      },
      {
        roles: ["scout", "reviewer"],
        objective: "Spawned child branch B"
      }
    ]
  };

  const spawnResponse = await fetch(`http://127.0.0.1:${ORCHESTRATOR_PORT}/executions/${executionId}/branches`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(branchPayload)
  });
  assert.equal(spawnResponse.status, 200);
  const spawned = await spawnResponse.json();
  assert.equal(spawned.created.length, 2);
  assert.equal(spawned.tree.rootExecutionId, executionId);
  assert.equal(spawned.tree.root.execution.id, executionId);
  assert.equal(spawned.tree.root.children.length, 2);

  const orchestratorTreeResponse = await fetch(`http://127.0.0.1:${ORCHESTRATOR_PORT}/executions/${executionId}/tree`);
  assert.equal(orchestratorTreeResponse.status, 200);
  const orchestratorTree = await orchestratorTreeResponse.json();
  assert.equal(orchestratorTree.tree.executionCount, 3);
  assert.equal(orchestratorTree.tree.root.children[0].execution.parentExecutionId, executionId);
  assert.equal(orchestratorTree.tree.root.children[1].execution.parentExecutionId, executionId);
  assert.ok(orchestratorTree.tree.root.stepSummary.count >= 3);

  const webTreeResponse = await fetch(`http://127.0.0.1:${WEB_PORT}/api/orchestrator/executions/${executionId}/tree`);
  assert.equal(webTreeResponse.status, 200);
  const webTree = await webTreeResponse.json();
  assert.equal(webTree.tree.rootExecutionId, executionId);
  assert.equal(webTree.tree.root.children.length, 2);

  const holdResponse = await fetch(`http://127.0.0.1:${ORCHESTRATOR_PORT}/executions/${executionId}/tree/hold`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      reason: "Family hold for operator review",
      owner: "operator",
      guidance: "Resume after graph inspection"
    })
  });
  assert.equal(holdResponse.status, 200);
  const heldTree = await holdResponse.json();
  assert.deepEqual(heldTree.changedExecutionIds.sort(), [executionId, ...spawned.created.map((item) => item.invocation.invocationId)].sort());

  const resumeResponse = await fetch(`http://127.0.0.1:${WEB_PORT}/api/orchestrator/executions/${executionId}/tree/resume`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      comments: "Resume family after inspection"
    })
  });
  assert.equal(resumeResponse.status, 200);
  const resumedTree = await resumeResponse.json();
  assert.equal(resumedTree.tree.rootExecutionId, executionId);
});
