import test from "node:test";
import assert from "node:assert/strict";

import { openOrchestratorDatabase, getWorkItem, updateWorkItem } from "../../../packages/orchestrator/src/store/execution-store.js";
import { makeTempPaths } from "../../../packages/orchestrator/test/helpers/scenario-fixtures.js";
import { findFreePort, getJson, postJson, startProcess, waitForHealth } from "./helpers/http-harness.js";

function mutateWorkItem(dbPath, itemId, mutate) {
  const db = openOrchestratorDatabase(dbPath);
  try {
    const item = getWorkItem(db, itemId);
    const next = mutate(item);
    updateWorkItem(db, next);
  } finally {
    db.close();
  }
}

test("self-build dependency graph routes expose authoring, readiness, and recovery semantics", async (t) => {
  const ORCHESTRATOR_PORT = await findFreePort();
  const { dbPath, sessionDbPath, eventLogPath } = await makeTempPaths("spore-http-self-build-dependencies-");

  const orchestrator = startProcess("node", ["services/orchestrator/server.js"], {
    SPORE_ORCHESTRATOR_PORT: String(ORCHESTRATOR_PORT),
    SPORE_ORCHESTRATOR_DB_PATH: dbPath,
    SPORE_SESSION_DB_PATH: sessionDbPath,
    SPORE_EVENT_LOG_PATH: eventLogPath
  });

  t.after(() => {
    orchestrator.kill("SIGTERM");
  });

  await waitForHealth(`http://127.0.0.1:${ORCHESTRATOR_PORT}/health`);

  const goalPlan = await postJson(`http://127.0.0.1:${ORCHESTRATOR_PORT}/goals/plan`, {
    goal: "docs config dashboard runtime dependency graph validation",
    safeMode: true,
    by: "test-runner",
    source: "http-self-build-dependencies-test"
  });
  assert.equal(goalPlan.status, 200);
  assert.ok(goalPlan.json.ok);

  const materialized = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/goal-plans/${encodeURIComponent(goalPlan.json.detail.id)}/materialize`,
    { by: "test-runner" }
  );
  assert.equal(materialized.status, 200);
  assert.ok(materialized.json.ok);

  const groupId = materialized.json.detail.materializedGroup.id;
  const items = materialized.json.detail.materializedItems;
  assert.equal(items.length, 4);

  const [successItemId, failingItemId, hardBlockedItemId, advisoryItemId] = items.map((item) => item.id);

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
      dependencies: []
    }
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
      dependencies: []
    }
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
      dependencies: []
    }
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
      dependencies: []
    }
  }));

  const authored = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-item-groups/${encodeURIComponent(groupId)}/dependencies`,
    {
      edges: [
        {
          itemId: hardBlockedItemId,
          dependencyItemId: failingItemId,
          strictness: "hard",
          autoRelaxation: false
        },
        {
          itemId: advisoryItemId,
          dependencyItemId: failingItemId,
          strictness: "advisory",
          autoRelaxation: {
            enabled: true,
            reason: "Advisory work can continue with a visible warning."
          }
        }
      ]
    }
  );
  assert.equal(authored.status, 200);
  assert.ok(authored.json.ok);
  assert.equal(authored.json.detail.id, groupId);
  assert.equal(authored.json.detail.dependencyGraph.edges.length, 2);
  assert.deepEqual(authored.json.impactSummary.strictnessCounts, { hard: 1, advisory: 1 });
  assert.equal(authored.json.detail.readiness.headlineState, "ready");
  assert.ok(authored.json.detail.readiness.counts.ready >= 3);
  assert.equal(authored.json.detail.readiness.counts.blocked, 1);
  assert.ok(authored.json.detail.readiness.blockerIds.length >= 1);
  assert.ok(authored.json.detail.dependencyGraph.transitionLog.some((entry) => entry.type === "dependency_graph_updated"));

  const groupDetail = await getJson(`http://127.0.0.1:${ORCHESTRATOR_PORT}/work-item-groups/${encodeURIComponent(groupId)}`);
  assert.equal(groupDetail.status, 200);
  assert.ok(groupDetail.json.ok);
  assert.equal(groupDetail.json.detail.dependencyGraph.edges.length, 2);
  assert.equal(groupDetail.json.detail.dependencyGraph.edges[0].dependencyItemId, failingItemId);
  assert.ok(groupDetail.json.detail.readiness.preRunSummary.label);

  const hardBlockedDetail = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-items/${encodeURIComponent(hardBlockedItemId)}`
  );
  assert.equal(hardBlockedDetail.status, 200);
  assert.equal(hardBlockedDetail.json.detail.dependencyState.state, "blocked");
  assert.equal(hardBlockedDetail.json.detail.dependencyState.incomingEdges[0].strictness, "hard");
  assert.ok(hardBlockedDetail.json.detail.blockedReason.includes("Dependency root fails"));
  assert.ok(hardBlockedDetail.json.detail.nextActionHint.includes("Complete Dependency root fails"));

  const advisoryDetail = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-items/${encodeURIComponent(advisoryItemId)}`
  );
  assert.equal(advisoryDetail.status, 200);
  assert.equal(advisoryDetail.json.detail.dependencyState.state, "ready");
  assert.equal(advisoryDetail.json.detail.dependencyState.advisoryWarnings.length, 1);
  assert.equal(advisoryDetail.json.detail.dependencyState.incomingEdges[0].strictness, "advisory");

  const groupRun = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-item-groups/${encodeURIComponent(groupId)}/run`,
    {
      stub: true,
      timeout: 6000,
      interval: 250,
      by: "test-runner",
      source: "http-self-build-dependencies-test"
    }
  );
  assert.equal(groupRun.status, 200);
  assert.ok(groupRun.json.ok);
  assert.equal(groupRun.json.detail.group.id, groupId);
  assert.equal(groupRun.json.detail.group.readiness.headlineState, "failed");
  assert.ok(
    groupRun.json.detail.results.some(
      (entry) => entry.item?.id === advisoryItemId && ["completed", "running"].includes(entry.run?.status)
    )
  );
  assert.ok(groupRun.json.detail.results.some((entry) => entry.item?.id === failingItemId && entry.run?.status === "failed"));
  assert.ok(groupRun.json.detail.results.some((entry) => entry.itemId === hardBlockedItemId && entry.status === "blocked"));

  const reviewNeededDetail = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-items/${encodeURIComponent(hardBlockedItemId)}`
  );
  assert.equal(reviewNeededDetail.status, 200);
  assert.equal(reviewNeededDetail.json.detail.status, "blocked");
  assert.equal(reviewNeededDetail.json.detail.dependencyState.state, "review_needed");
  assert.ok(reviewNeededDetail.json.detail.blockerIds.length >= 1);
  assert.ok(reviewNeededDetail.json.detail.blockedReason.includes("failed"));
  assert.ok(reviewNeededDetail.json.detail.nextActionHint.includes("Retry or resolve"));

  const relaxedDetail = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-items/${encodeURIComponent(advisoryItemId)}`
  );
  assert.equal(relaxedDetail.status, 200);
  assert.ok(["completed", "running"].includes(relaxedDetail.json.detail.status));
  assert.ok(relaxedDetail.json.detail.dependencyState.advisoryWarnings.length >= 1);

  const postRunGroup = await getJson(`http://127.0.0.1:${ORCHESTRATOR_PORT}/work-item-groups/${encodeURIComponent(groupId)}`);
  assert.equal(postRunGroup.status, 200);
  assert.equal(postRunGroup.json.detail.readiness.counts.failed, 1);
  assert.equal(postRunGroup.json.detail.readiness.counts.reviewNeeded, 1);
  assert.ok(postRunGroup.json.detail.dependencyGraph.transitionLog.some((entry) => entry.type === "dependency_skip"));
  assert.ok(postRunGroup.json.detail.dependencyGraph.transitionLog.some((entry) => entry.type === "dependency_review_needed"));
  assert.ok(postRunGroup.json.detail.dependencyGraph.transitionLog.some((entry) => entry.type === "dependency_auto_relaxed"));

  const summary = await getJson(`http://127.0.0.1:${ORCHESTRATOR_PORT}/self-build/summary`);
  assert.equal(summary.status, 200);
  assert.ok(summary.json.detail.urgentWork.some((entry) => entry.itemId === hardBlockedItemId));
  const blockedUrgent = summary.json.detail.urgentWork.find((entry) => entry.itemId === hardBlockedItemId);
  assert.ok(blockedUrgent.reason.includes("failed"));
  assert.ok(Array.isArray(blockedUrgent.blockerIds));
  assert.ok(blockedUrgent.nextActionHint.includes("Retry or resolve"));

  mutateWorkItem(dbPath, failingItemId, (item) => ({
    ...item,
    status: "running",
    updatedAt: new Date().toISOString(),
    metadata: {
      ...item.metadata,
      dependency: {
        ...(item.metadata?.dependency ?? {}),
        state: "running",
        updatedAt: new Date().toISOString()
      }
    }
  }));

  const retryWaitDetail = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-items/${encodeURIComponent(hardBlockedItemId)}`
  );
  assert.equal(retryWaitDetail.status, 200);
  assert.equal(retryWaitDetail.json.detail.dependencyState.state, "blocked");
  assert.ok(retryWaitDetail.json.detail.blockedReason.includes("running"));
  assert.ok(retryWaitDetail.json.detail.nextActionHint.includes("settle"));
});
