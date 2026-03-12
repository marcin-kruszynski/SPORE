import assert from "node:assert/strict";
import test from "node:test";

import {
  getWorkItem,
  openOrchestratorDatabase,
  updateWorkItem,
} from "@spore/orchestrator";
import {
  findFreePort,
  getJson,
  makeTempPaths,
  postJson,
  startProcess,
  waitForHealth,
} from "@spore/test-support";

import { ensureWebRuntimeBuilt } from "./runtime-harness.js";

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

type GroupReadiness = {
  headlineState: string;
  counts: {
    ready: number;
    blocked: number;
    reviewNeeded: number;
  };
  preRunSummary: {
    label: string;
  };
  blockerIds: string[];
};

type DependencyEdge = {
  itemId: string;
  label: string;
  strictness: string;
};

type DependencyAuthoringResponse = {
  ok: boolean;
  detail: {
    id: string;
    dependencyGraph: {
      edges: DependencyEdge[];
    };
    readiness: GroupReadiness;
  };
  impactSummary: {
    strictnessCounts: Record<string, number>;
    readinessCounts: {
      blocked: number;
    };
    blockerIds: string[];
  };
};

type WorkItemGroupDetailResponse = {
  ok: boolean;
  detail: {
    readiness: GroupReadiness;
    dependencyGraph: {
      edges: DependencyEdge[];
    };
  };
};

type WorkItemDetailResponse = {
  detail: {
    dependencyState: {
      state: string;
      blockers: Array<{
        strictness: string;
      }>;
      advisoryWarnings: Array<{
        strictness: string;
      }>;
    };
    blockedReason: string;
    blockerIds: string[];
    nextActionHint: string;
  };
};

type SelfBuildSummaryResponse = {
  detail: {
    groups: Array<{
      id: string;
      readiness: GroupReadiness;
    }>;
    urgentWork: Array<{
      itemId: string;
      reason: string;
      blockerIds: string[];
      nextActionHint: string;
    }>;
  };
};

type RunGroupResponse = {
  ok: boolean;
};

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

test("self-build web proxy exposes dependency authoring, impact summary, and readiness detail", async (t) => {
  await ensureWebRuntimeBuilt();

  const ORCHESTRATOR_PORT = await findFreePort();
  const WEB_PORT = await findFreePort();
  const { dbPath, sessionDbPath, eventLogPath } = (await makeTempPaths(
    "spore-web-self-build-dependency-graph-",
  )) as TempPaths;

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

  t.after(() => {
    orchestrator.kill("SIGTERM");
    web.kill("SIGTERM");
  });

  const webOrigin = `http://127.0.0.1:${WEB_PORT}`;

  await waitForHealth(`http://127.0.0.1:${ORCHESTRATOR_PORT}/health`);
  await waitForHealth(`${webOrigin}/`);

  const htmlResponse = await fetch(`${webOrigin}/`);
  assert.equal(htmlResponse.status, 200);
  const html = await htmlResponse.text();
  assert.ok(html.includes('<div id="root"></div>'));
  assert.ok(!html.includes("self-build-view"));

  const goalPlan = await postJson<GoalPlanResponse>(
    `${webOrigin}/api/orchestrator/goals/plan`,
    {
      goal: "docs config dashboard runtime dependency graph validation",
      safeMode: true,
      by: "web-test-runner",
      source: "web-self-build-dependency-graph-test",
    },
  );
  assert.equal(goalPlan.status, 200);
  assert.ok(goalPlan.json.ok);

  const reviewed = await postJson(
    `${webOrigin}/api/orchestrator/goal-plans/${encodeURIComponent(goalPlan.json.detail.id)}/review`,
    {
      status: "reviewed",
      comments: "Review before dependency-graph materialization.",
      by: "web-test-runner",
    },
  );
  assert.equal(reviewed.status, 200);
  assert.ok(reviewed.json.ok);

  const materialized = await postJson<MaterializedGoalPlanResponse>(
    `${webOrigin}/api/orchestrator/goal-plans/${encodeURIComponent(goalPlan.json.detail.id)}/materialize`,
    { by: "web-test-runner" },
  );
  assert.equal(materialized.status, 200);
  assert.ok(materialized.json.ok);

  const groupId = materialized.json.detail.materializedGroup.id;
  const items = [...materialized.json.detail.materializedItems];
  while (items.length < 4) {
    const supplementalItem = await postJson(
      `${webOrigin}/api/orchestrator/work-items`,
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
    `${webOrigin}/api/orchestrator/work-item-groups/${encodeURIComponent(groupId)}/dependencies`,
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
  assert.equal(authored.json.impactSummary.readinessCounts.blocked, 1);
  assert.ok(authored.json.impactSummary.blockerIds.length >= 1);
  assert.ok(authored.json.detail.readiness.preRunSummary.label);

  const groupDetail = await getJson<WorkItemGroupDetailResponse>(
    `${webOrigin}/api/orchestrator/work-item-groups/${encodeURIComponent(groupId)}`,
  );
  assert.equal(groupDetail.status, 200);
  assert.ok(groupDetail.json.ok);
  assert.equal(groupDetail.json.detail.readiness.headlineState, "ready");
  assert.ok(groupDetail.json.detail.readiness.counts.ready >= 3);
  assert.equal(groupDetail.json.detail.readiness.counts.blocked, 1);
  assert.ok(
    groupDetail.json.detail.readiness.preRunSummary.label.includes("ready"),
  );
  const hardEdge = groupDetail.json.detail.dependencyGraph.edges.find(
    (edge) => edge.itemId === hardBlockedItemId,
  );
  const advisoryEdge = groupDetail.json.detail.dependencyGraph.edges.find(
    (edge) => edge.itemId === advisoryItemId,
  );
  assert.equal(hardEdge.label, "hard dependency");
  assert.equal(advisoryEdge.label, "advisory dependency");

  const blockedItem = await getJson<WorkItemDetailResponse>(
    `${webOrigin}/api/orchestrator/work-items/${encodeURIComponent(hardBlockedItemId)}`,
  );
  assert.equal(blockedItem.status, 200);
  assert.equal(blockedItem.json.detail.dependencyState.state, "blocked");
  assert.ok(
    blockedItem.json.detail.blockedReason.includes("Dependency root fails"),
  );
  assert.ok(blockedItem.json.detail.blockerIds[0]);
  assert.equal(
    blockedItem.json.detail.dependencyState.blockers[0].strictness,
    "hard",
  );
  assert.ok(
    blockedItem.json.detail.nextActionHint.includes(
      "Complete Dependency root fails",
    ),
  );

  const advisoryItem = await getJson<WorkItemDetailResponse>(
    `${webOrigin}/api/orchestrator/work-items/${encodeURIComponent(advisoryItemId)}`,
  );
  assert.equal(advisoryItem.status, 200);
  assert.equal(advisoryItem.json.detail.dependencyState.state, "ready");
  assert.equal(
    advisoryItem.json.detail.dependencyState.advisoryWarnings[0].strictness,
    "advisory",
  );

  const preRunSummary = await getJson<SelfBuildSummaryResponse>(
    `${webOrigin}/api/orchestrator/self-build/summary`,
  );
  assert.equal(preRunSummary.status, 200);
  const seededGroup = preRunSummary.json.detail.groups.find(
    (group) => group.id === groupId,
  );
  assert.ok(seededGroup);
  assert.equal(seededGroup.readiness.counts.blocked, 1);
  assert.ok(seededGroup.readiness.preRunSummary.label);

  const runGroup = await postJson<RunGroupResponse>(
    `${webOrigin}/api/orchestrator/work-item-groups/${encodeURIComponent(groupId)}/run`,
    {
      stub: true,
      timeout: 12000,
      interval: 250,
      by: "web-test-runner",
      source: "web-self-build-dependency-graph-test",
    },
  );
  assert.equal(runGroup.status, 200);
  assert.ok(runGroup.json.ok);

  const refreshedSummary = await getJson<SelfBuildSummaryResponse>(
    `${webOrigin}/api/orchestrator/self-build/summary`,
  );
  assert.equal(refreshedSummary.status, 200);
  const blockedUrgent = refreshedSummary.json.detail.urgentWork.find(
    (entry) => entry.itemId === hardBlockedItemId,
  );
  assert.ok(blockedUrgent);
  assert.ok(blockedUrgent.reason.includes("failed"));
  assert.ok(Array.isArray(blockedUrgent.blockerIds));
  assert.ok(blockedUrgent.nextActionHint.includes("Retry or resolve"));

  const postRunGroup = refreshedSummary.json.detail.groups.find(
    (group) => group.id === groupId,
  );
  assert.ok(postRunGroup);
  assert.equal(postRunGroup.readiness.counts.reviewNeeded, 1);
  assert.ok(postRunGroup.readiness.preRunSummary.label);
});
