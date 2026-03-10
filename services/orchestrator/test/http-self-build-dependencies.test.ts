import assert from "node:assert/strict";
import test from "node:test";

import {
  getWorkItem,
  openOrchestratorDatabase,
  updateWorkItem,
} from "@spore/orchestrator";
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
  const { dbPath, sessionDbPath, eventLogPath } = withEventLogPath(
    await makeTempPaths("spore-http-self-build-dependencies-"),
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

  t.after(async () => {
    await stopProcess(orchestrator);
  });

  await waitForHealth(`http://127.0.0.1:${ORCHESTRATOR_PORT}/health`);

  const goalPlan = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/goals/plan`,
    {
      goal: "docs config dashboard runtime dependency graph validation",
      safeMode: true,
      by: "test-runner",
      source: "http-self-build-dependencies-test",
    },
  );
  assert.equal(goalPlan.status, 200);
  assert.ok(goalPlan.json.ok);

  const reviewed = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/goal-plans/${encodeURIComponent(goalPlan.json.detail.id)}/review`,
    {
      status: "reviewed",
      comments:
        "Dependencies test requires reviewed goal plan before materialization.",
      by: "test-runner",
    },
  );
  assert.equal(reviewed.status, 200);
  assert.ok(reviewed.json.ok);

  const materialized = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/goal-plans/${encodeURIComponent(goalPlan.json.detail.id)}/materialize`,
    { by: "test-runner" },
  );
  assert.equal(materialized.status, 200);
  assert.ok(materialized.json.ok);

  const groupId = materialized.json.detail.materializedGroup.id;
  const items = [...materialized.json.detail.materializedItems];
  while (items.length < 4) {
    const supplementalItem = await postJson(
      `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-items`,
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

  const authored = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-item-groups/${encodeURIComponent(groupId)}/dependencies`,
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
  assert.equal(authored.json.detail.id, groupId);
  assert.equal(authored.json.detail.dependencyGraph.edges.length, 2);
  assert.deepEqual(authored.json.impactSummary.strictnessCounts, {
    hard: 1,
    advisory: 1,
  });
  assert.equal(authored.json.detail.readiness.headlineState, "ready");
  assert.ok(authored.json.detail.readiness.counts.ready >= 3);
  assert.equal(authored.json.detail.readiness.counts.blocked, 1);
  assert.ok(authored.json.detail.readiness.blockerIds.length >= 1);
  assert.ok(
    authored.json.detail.dependencyGraph.transitionLog.some(
      (entry) => entry.type === "dependency_graph_updated",
    ),
  );

  const groupDetail = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-item-groups/${encodeURIComponent(groupId)}`,
  );
  assert.equal(groupDetail.status, 200);
  assert.ok(groupDetail.json.ok);
  assert.equal(groupDetail.json.detail.dependencyGraph.edges.length, 2);
  assert.equal(
    groupDetail.json.detail.dependencyGraph.edges[0].dependencyItemId,
    failingItemId,
  );
  assert.ok(groupDetail.json.detail.readiness.preRunSummary.label);

  const hardBlockedDetail = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-items/${encodeURIComponent(hardBlockedItemId)}`,
  );
  assert.equal(hardBlockedDetail.status, 200);
  assert.equal(hardBlockedDetail.json.detail.dependencyState.state, "blocked");
  assert.equal(
    hardBlockedDetail.json.detail.dependencyState.incomingEdges[0].strictness,
    "hard",
  );
  assert.ok(
    hardBlockedDetail.json.detail.blockedReason.includes(
      "Dependency root fails",
    ),
  );
  assert.ok(
    hardBlockedDetail.json.detail.nextActionHint.includes(
      "Complete Dependency root fails",
    ),
  );

  const advisoryDetail = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-items/${encodeURIComponent(advisoryItemId)}`,
  );
  assert.equal(advisoryDetail.status, 200);
  assert.equal(advisoryDetail.json.detail.dependencyState.state, "ready");
  assert.equal(
    advisoryDetail.json.detail.dependencyState.advisoryWarnings.length,
    1,
  );
  assert.equal(
    advisoryDetail.json.detail.dependencyState.incomingEdges[0].strictness,
    "advisory",
  );

  const groupRun = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-item-groups/${encodeURIComponent(groupId)}/run`,
    {
      stub: true,
      timeout: 12000,
      interval: 250,
      by: "test-runner",
      source: "http-self-build-dependencies-test",
    },
  );
  assert.equal(groupRun.status, 200);
  assert.ok(groupRun.json.ok);
  assert.equal(groupRun.json.detail.group.id, groupId);
  assert.equal(groupRun.json.detail.group.readiness.headlineState, "failed");
  assert.ok(
    groupRun.json.detail.results.some(
      (entry) =>
        entry.item?.id === failingItemId && entry.run?.status === "failed",
    ),
  );
  assert.ok(
    groupRun.json.detail.results.some(
      (entry) =>
        entry.itemId === hardBlockedItemId && entry.status === "blocked",
    ),
  );

  const reviewNeededDetail = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-items/${encodeURIComponent(hardBlockedItemId)}`,
  );
  assert.equal(reviewNeededDetail.status, 200);
  assert.equal(reviewNeededDetail.json.detail.status, "blocked");
  assert.equal(
    reviewNeededDetail.json.detail.dependencyState.state,
    "review_needed",
  );
  assert.ok(reviewNeededDetail.json.detail.blockerIds.length >= 1);
  assert.ok(reviewNeededDetail.json.detail.blockedReason.includes("failed"));
  assert.ok(
    reviewNeededDetail.json.detail.nextActionHint.includes("Retry or resolve"),
  );

  const relaxedDetail = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-items/${encodeURIComponent(advisoryItemId)}`,
  );
  assert.equal(relaxedDetail.status, 200);
  assert.notEqual(relaxedDetail.json.detail.status, "blocked");
  assert.notEqual(
    relaxedDetail.json.detail.dependencyState.state,
    "review_needed",
  );
  assert.ok(
    relaxedDetail.json.detail.dependencyState.advisoryWarnings.length >= 1,
  );

  const postRunGroup = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-item-groups/${encodeURIComponent(groupId)}`,
  );
  assert.equal(postRunGroup.status, 200);
  assert.ok(postRunGroup.json.detail.readiness.counts.failed >= 1);
  assert.equal(postRunGroup.json.detail.readiness.counts.reviewNeeded, 1);
  assert.ok(
    Array.isArray(postRunGroup.json.detail.dependencyGraph.transitionLog),
  );
  assert.ok(
    postRunGroup.json.detail.dependencyGraph.transitionLog.some((entry) =>
      String(entry?.type).startsWith("dependency_"),
    ),
  );
  assert.ok(postRunGroup.json.detail.dependencyGraph.transitionLog.length >= 1);

  const unblock = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-item-groups/${encodeURIComponent(groupId)}/unblock`,
    {
      itemIds: [hardBlockedItemId],
      rationale: "Unblock the hard dependent for recovery coverage.",
      by: "test-runner",
      source: "http-self-build-dependencies-test",
    },
  );
  assert.equal(unblock.status, 200);
  assert.ok(unblock.json.ok);
  assert.ok(
    unblock.json.detail.metadata.recoveryHistory.some(
      (entry) => entry.type === "unblock",
    ),
  );

  const requeue = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-item-groups/${encodeURIComponent(groupId)}/requeue-item`,
    {
      itemId: failingItemId,
      rationale: "Requeue the failing dependency root for recovery coverage.",
      by: "test-runner",
      source: "http-self-build-dependencies-test",
    },
  );
  assert.equal(requeue.status, 200);
  assert.ok(requeue.json.ok);

  const skip = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-item-groups/${encodeURIComponent(groupId)}/skip-item`,
    {
      itemId: advisoryItemId,
      rationale: "Skip advisory lane to verify explicit skip recovery.",
      by: "test-runner",
      source: "http-self-build-dependencies-test",
    },
  );
  assert.equal(skip.status, 200);
  assert.ok(skip.json.ok);

  const reroute = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-item-groups/${encodeURIComponent(groupId)}/reroute`,
    {
      itemId: failingItemId,
      rationale: "Create a repair lane for the failed dependency root.",
      title: "Repair dependency root failure",
      goal: "Repair the failed dependency root so downstream work can continue.",
      by: "test-runner",
      source: "http-self-build-dependencies-test",
    },
  );
  assert.equal(reroute.status, 200);
  assert.ok(reroute.json.ok);
  assert.ok(
    reroute.json.detail.items.some(
      (item) => item.metadata?.rerouteOf === failingItemId,
    ),
  );

  const retryDownstream = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-item-groups/${encodeURIComponent(groupId)}/retry-downstream`,
    {
      itemIds: [hardBlockedItemId],
      rationale: "Retry downstream work after reroute.",
      by: "test-runner",
      source: "http-self-build-dependencies-test",
    },
  );
  assert.equal(retryDownstream.status, 200);
  assert.ok(retryDownstream.json.ok);

  const validateBundle = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-item-groups/${encodeURIComponent(groupId)}/validate-bundle`,
    {
      stub: true,
      timeout: 12000,
      interval: 250,
      by: "test-runner",
      source: "http-self-build-dependencies-test",
    },
  );
  assert.equal(validateBundle.status, 200);
  assert.ok(validateBundle.json.ok);
  assert.ok(Array.isArray(validateBundle.json.detail.validationResults));

  const summary = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/self-build/summary`,
  );
  assert.equal(summary.status, 200);
  const dependencyAttention = [
    ...summary.json.detail.urgentWork,
    ...summary.json.detail.followUpWork,
  ].find((entry) => entry.itemId === hardBlockedItemId);
  assert.ok(dependencyAttention);
  assert.ok(Array.isArray(dependencyAttention.blockerIds));
  assert.ok(typeof dependencyAttention.nextActionHint === "string");

  mutateWorkItem(dbPath, failingItemId, (item) => ({
    ...item,
    status: "running",
    updatedAt: new Date().toISOString(),
    metadata: {
      ...item.metadata,
      dependency: {
        ...(item.metadata?.dependency ?? {}),
        state: "running",
        updatedAt: new Date().toISOString(),
      },
    },
  }));

  const retryWaitDetail = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-items/${encodeURIComponent(hardBlockedItemId)}`,
  );
  assert.equal(retryWaitDetail.status, 200);
  assert.equal(retryWaitDetail.json.detail.dependencyState.state, "blocked");
  assert.ok(typeof retryWaitDetail.json.detail.blockedReason === "string");
  assert.ok(typeof retryWaitDetail.json.detail.nextActionHint === "string");
});
