import assert from "node:assert/strict";
import test from "node:test";
import {
  findFreePort,
  getJson,
  makeTempPaths,
  postJson,
  startProcess,
  waitForHealth,
} from "@spore/test-support";

type TempPaths = {
  dbPath: string;
  sessionDbPath: string;
  eventLogPath?: string;
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

type DashboardSummaryResponse = {
  ok: boolean;
  detail: {
    overview: {
      urgentCount: number;
      followUpCount: number;
    };
    urgentWork: unknown[];
    followUpWork: unknown[];
    displayMetadata: Record<string, unknown>;
    freshness: {
      lastRefresh?: string;
    };
    counts: {
      workItems: number;
      groups: number;
    };
  };
};

type WorkItemListResponse = {
  ok: boolean;
  detail: Array<{
    id: string;
    links?: {
      self?: string;
    };
  }>;
};

type WorkItemGroupListResponse = {
  ok: boolean;
  detail: Array<{
    id: string;
    links?: Record<string, unknown>;
  }>;
};

type WorkItemDetailResponse = {
  ok: boolean;
  detail: {
    id: string;
    workItemGroup?: {
      id: string;
    };
    goalPlan?: Record<string, unknown>;
    links?: Record<string, unknown>;
  };
};

type WorkItemGroupDetailResponse = {
  ok: boolean;
  detail: {
    id: string;
    links?: Record<string, unknown>;
    items: unknown[];
  };
};

test("self-build dashboard exposes dedicated operator-first surface with overview, urgent queue, and drilldown navigation", async (t) => {
  const ORCHESTRATOR_PORT = await findFreePort();
  const WEB_PORT = await findFreePort();
  const { dbPath, sessionDbPath, eventLogPath } = (await makeTempPaths(
    "spore-web-self-build-dashboard-",
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

  await waitForHealth(`http://127.0.0.1:${ORCHESTRATOR_PORT}/health`);
  await waitForHealth(`http://127.0.0.1:${WEB_PORT}/`);

  // Test 1: Fetch the main operator page HTML and verify basic shell is present
  const htmlResponse = await fetch(`http://127.0.0.1:${WEB_PORT}/`);
  assert.equal(htmlResponse.status, 200);
  const html = await htmlResponse.text();

  // Verify basic operator page structure loads
  assert.ok(
    html.includes("SPORE") || html.includes("Operator"),
    "HTML should contain operator page content",
  );
  assert.ok(html.includes("main.js"), "HTML should load main.js");
  assert.ok(html.includes("styles.css"), "HTML should load styles.css");

  // Test 2: Verify self-build/summary API is accessible through web proxy
  const summaryViaWeb = await getJson<DashboardSummaryResponse>(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/self-build/summary`,
  );
  assert.equal(summaryViaWeb.status, 200);
  assert.ok(summaryViaWeb.json.ok);
  assert.ok(summaryViaWeb.json.detail);

  // Verify overview-first structure exists
  assert.ok(summaryViaWeb.json.detail.overview);
  assert.ok(
    typeof summaryViaWeb.json.detail.overview.urgentCount === "number",
    "Overview should have urgentCount",
  );
  assert.ok(
    typeof summaryViaWeb.json.detail.overview.followUpCount === "number",
    "Overview should have followUpCount",
  );

  // Verify urgent and follow-up queues exist
  assert.ok(
    Array.isArray(summaryViaWeb.json.detail.urgentWork),
    "Urgent work queue should be an array",
  );
  assert.ok(
    Array.isArray(summaryViaWeb.json.detail.followUpWork),
    "Follow-up work queue should be an array",
  );

  // Verify display metadata and freshness cues
  assert.ok(
    summaryViaWeb.json.detail.displayMetadata,
    "Display metadata should exist",
  );
  assert.ok(summaryViaWeb.json.detail.freshness, "Freshness cues should exist");
  assert.ok(
    summaryViaWeb.json.detail.freshness.lastRefresh,
    "Last refresh timestamp should exist",
  );

  // Test 3: Create representative self-build data for navigation testing
  const goalPlan = await postJson<GoalPlanResponse>(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/goals/plan`,
    {
      goal: "Test self-build dashboard navigation flow",
      domain: "cli",
      safeMode: true,
      by: "web-test-runner",
      source: "web-self-build-dashboard-test",
    },
  );
  assert.equal(goalPlan.status, 200);
  assert.ok(goalPlan.json.ok);
  assert.ok(goalPlan.json.detail.id);

  const reviewed = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/goal-plans/${encodeURIComponent(goalPlan.json.detail.id)}/review`,
    {
      status: "reviewed",
      comments: "Review before materialization in dashboard proxy test.",
      by: "web-test-runner",
    },
  );
  assert.equal(reviewed.status, 200);
  assert.ok(reviewed.json.ok);

  // Materialize into work-item group
  const materialized = await postJson<MaterializedGoalPlanResponse>(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/goal-plans/${encodeURIComponent(goalPlan.json.detail.id)}/materialize`,
    { by: "web-test-runner" },
  );
  assert.equal(materialized.status, 200);
  assert.ok(materialized.json.ok);
  assert.ok(materialized.json.detail.materializedGroup);
  assert.ok(materialized.json.detail.materializedItems.length > 0);

  const groupId = materialized.json.detail.materializedGroup.id;
  const itemId = materialized.json.detail.materializedItems[0].id;

  // Test 4: Verify work-items list is accessible through web proxy (drilldown target)
  const workItemsViaWeb = await getJson<WorkItemListResponse>(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/work-items`,
  );
  assert.equal(workItemsViaWeb.status, 200);
  assert.ok(workItemsViaWeb.json.ok);
  assert.ok(Array.isArray(workItemsViaWeb.json.detail));

  // Verify the created item appears in the list
  const foundItem = workItemsViaWeb.json.detail.find(
    (item) => item.id === itemId,
  );
  assert.ok(foundItem, "Created work item should appear in the list");
  assert.ok(foundItem.links, "Work item should have navigation links");
  assert.ok(
    foundItem.links.self,
    "Work item should have self link for detail drilldown",
  );

  // Test 5: Verify work-item-groups list is accessible through web proxy
  const groupsViaWeb = await getJson<WorkItemGroupListResponse>(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/work-item-groups`,
  );
  assert.equal(groupsViaWeb.status, 200);
  assert.ok(groupsViaWeb.json.ok);
  assert.ok(Array.isArray(groupsViaWeb.json.detail));

  const foundGroup = groupsViaWeb.json.detail.find(
    (group) => group.id === groupId,
  );
  assert.ok(foundGroup, "Created work-item group should appear in the list");
  assert.ok(foundGroup.links, "Group should have navigation links");

  // Test 6: Verify work-item detail is accessible through web proxy (detail view target)
  const itemDetailViaWeb = await getJson<WorkItemDetailResponse>(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/work-items/${encodeURIComponent(itemId)}`,
  );
  assert.equal(itemDetailViaWeb.status, 200);
  assert.ok(itemDetailViaWeb.json.ok);
  assert.equal(itemDetailViaWeb.json.detail.id, itemId);

  // Verify lineage chain and navigation context are present
  assert.ok(
    itemDetailViaWeb.json.detail.workItemGroup,
    "Work item detail should include group linkage",
  );
  assert.equal(itemDetailViaWeb.json.detail.workItemGroup.id, groupId);
  assert.ok(
    itemDetailViaWeb.json.detail.goalPlan,
    "Work item detail should include goal plan linkage",
  );
  assert.ok(
    itemDetailViaWeb.json.detail.links,
    "Work item detail should include navigation links",
  );

  // Test 7: Verify work-item-group detail is accessible through web proxy
  const groupDetailViaWeb = await getJson<WorkItemGroupDetailResponse>(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/work-item-groups/${encodeURIComponent(groupId)}`,
  );
  assert.equal(groupDetailViaWeb.status, 200);
  assert.ok(groupDetailViaWeb.json.ok);
  assert.equal(groupDetailViaWeb.json.detail.id, groupId);
  assert.ok(groupDetailViaWeb.json.detail.links);
  assert.ok(
    Array.isArray(groupDetailViaWeb.json.detail.items),
    "Group detail should list items",
  );

  // Test 8: Refresh self-build summary and verify updated state
  const refreshedSummary = await getJson<DashboardSummaryResponse>(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/self-build/summary`,
  );
  assert.equal(refreshedSummary.status, 200);
  assert.ok(refreshedSummary.json.ok);

  // After seeding data, counts should reflect the new items
  assert.ok(
    refreshedSummary.json.detail.counts.workItems >= 1,
    "Summary should reflect at least one work item",
  );
  assert.ok(
    refreshedSummary.json.detail.counts.groups >= 1,
    "Summary should reflect at least one group",
  );
});
