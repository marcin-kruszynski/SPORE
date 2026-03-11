import assert from "node:assert/strict";
import test from "node:test";
import {
  findFreePort,
  getJson,
  makeTempPaths,
  postJson,
  startProcess,
  stopProcess,
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
    validationRequiredProposals?: unknown[];
    proposalsBlockedForPromotion?: unknown[];
    activeQuarantines?: unknown[];
    protectedScopeBlocks?: unknown[];
    autonomousIntake?: unknown[];
    displayMetadata: Record<string, unknown>;
    freshness: {
      lastRefresh?: string;
    };
    counts: {
      workItems: number;
      groups: number;
      pendingDocSuggestions: number;
      queuedAutonomousIntake: number;
      policyRecommendations: number;
      protectedScopeBlocks: number;
      activeQuarantines?: number;
      proposalsBlockedForPromotion?: number;
      validationRequiredProposals?: number;
    };
    learningTrends: unknown[];
    policyRecommendations: unknown[];
  };
};

type DashboardRouteResponse = {
  ok: boolean;
  detail: {
    route?: {
      self?: string;
    };
    recentWorkItemRuns: unknown[];
    attentionSummary: Record<string, unknown>;
    queueSummary: Record<string, unknown>;
    lifecycle?: {
      blockedPromotions?: number;
      pendingValidations?: number;
      activeAutonomousRuns?: number;
      quarantinedWork?: number;
      protectedTierOverrides?: number;
      policyRecommendationQueue?: number;
    };
    overrides?: unknown[];
    policyRecommendationReviews?: unknown[];
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

  t.after(async () => {
    await Promise.all([stopProcess(orchestrator), stopProcess(web)]);
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

  const learningTrendsViaWeb = await getJson(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/self-build/learning-trends`,
  );
  assert.equal(learningTrendsViaWeb.status, 200);
  assert.ok(Array.isArray(learningTrendsViaWeb.json.detail));

  const policyRecommendationsViaWeb = await getJson(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/self-build/policy-recommendations`,
  );
  assert.equal(policyRecommendationsViaWeb.status, 200);
  assert.ok(Array.isArray(policyRecommendationsViaWeb.json.detail));
  const firstRecommendation = policyRecommendationsViaWeb.json.detail[0] as
    | Record<string, unknown>
    | undefined;
  if (firstRecommendation) {
    assert.ok(
      Boolean(
        firstRecommendation.recommendationId ??
          firstRecommendation.id ??
          firstRecommendation.recommendation,
      ),
      "Policy recommendation payloads should expose a stable recommendation identity",
    );
    if ("links" in firstRecommendation && firstRecommendation.links) {
      assert.equal(
        typeof firstRecommendation.links,
        "object",
        "Policy recommendation links should be structured when present",
      );
    }
  }

  // Test 2: Verify self-build summary and dashboard APIs are accessible through web proxy
  const summaryViaWeb = await getJson<DashboardSummaryResponse>(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/self-build/summary`,
  );
  assert.equal(summaryViaWeb.status, 200);
  assert.ok(summaryViaWeb.json.ok);
  assert.ok(summaryViaWeb.json.detail);

  const dashboardViaWeb = await getJson<DashboardRouteResponse>(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/self-build/dashboard`,
  );
  assert.equal(dashboardViaWeb.status, 200);
  assert.ok(dashboardViaWeb.json.ok);
  assert.ok(dashboardViaWeb.json.detail);
  assert.equal(
    dashboardViaWeb.json.detail.route?.self,
    "/self-build/dashboard",
  );
  assert.ok(Array.isArray(dashboardViaWeb.json.detail.recentWorkItemRuns));
  assert.ok(
    typeof dashboardViaWeb.json.detail.attentionSummary === "object",
    "Dashboard should expose attention summary",
  );
  assert.ok(
    typeof dashboardViaWeb.json.detail.queueSummary === "object",
    "Dashboard should expose queue summary",
  );

  const lifecycle = dashboardViaWeb.json.detail.lifecycle;
  if (lifecycle) {
    assert.equal(typeof lifecycle, "object");
    for (const field of [
      "blockedPromotions",
      "pendingValidations",
      "activeAutonomousRuns",
      "quarantinedWork",
      "protectedTierOverrides",
      "policyRecommendationQueue",
    ] as const) {
      if (lifecycle[field] !== undefined) {
        assert.equal(
          typeof lifecycle[field],
          "number",
          `Lifecycle field ${field} should be numeric when present`,
        );
      }
    }
  }
  if ("overrides" in dashboardViaWeb.json.detail) {
    assert.ok(
      Array.isArray(dashboardViaWeb.json.detail.overrides),
      "Dashboard overrides should be an array when present",
    );
  }
  if ("policyRecommendationReviews" in dashboardViaWeb.json.detail) {
    assert.ok(
      Array.isArray(dashboardViaWeb.json.detail.policyRecommendationReviews),
      "Dashboard recommendation reviews should be an array when present",
    );
  }

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
  assert.ok(
    typeof summaryViaWeb.json.detail.counts.policyRecommendations === "number",
    "Summary should expose policy recommendation count",
  );
  assert.ok(
    typeof summaryViaWeb.json.detail.counts.protectedScopeBlocks === "number",
    "Summary should expose protected-scope block count",
  );
  assert.ok(
    Array.isArray(summaryViaWeb.json.detail.learningTrends),
    "Summary should expose learning trends",
  );
  assert.ok(
    Array.isArray(summaryViaWeb.json.detail.policyRecommendations),
    "Summary should expose policy recommendations",
  );
  assert.ok(
    Array.isArray(summaryViaWeb.json.detail.validationRequiredProposals ?? []),
    "Summary should expose validation-required proposal queue",
  );
  assert.ok(
    Array.isArray(summaryViaWeb.json.detail.proposalsBlockedForPromotion ?? []),
    "Summary should expose blocked-promotion queue",
  );
  assert.ok(
    Array.isArray(summaryViaWeb.json.detail.activeQuarantines ?? []),
    "Summary should expose quarantine queue",
  );
  assert.ok(
    Array.isArray(summaryViaWeb.json.detail.autonomousIntake ?? []),
    "Summary should expose autonomous intake queue",
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
  assert.ok(
    typeof refreshedSummary.json.detail.counts.pendingDocSuggestions ===
      "number",
  );
  assert.ok(
    typeof refreshedSummary.json.detail.counts.queuedAutonomousIntake ===
      "number",
  );
  assert.ok(
    typeof (refreshedSummary.json.detail.counts.activeQuarantines ?? 0) ===
      "number",
  );
  assert.ok(
    typeof (
      refreshedSummary.json.detail.counts.proposalsBlockedForPromotion ?? 0
    ) === "number",
  );
  assert.ok(
    typeof (
      refreshedSummary.json.detail.counts.validationRequiredProposals ?? 0
    ) === "number",
  );

  const docSuggestionsViaWeb = await getJson(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/self-build/doc-suggestions`,
  );
  assert.equal(docSuggestionsViaWeb.status, 200);
  assert.ok(docSuggestionsViaWeb.json.ok);
  assert.ok(Array.isArray(docSuggestionsViaWeb.json.detail));

  const intakeRefreshViaWeb = await postJson(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/self-build/intake/refresh`,
    {
      includeAccepted: true,
      projectId: "spore",
      by: "web-test-runner",
      source: "web-self-build-dashboard-test",
    },
  );
  assert.equal(intakeRefreshViaWeb.status, 200);
  assert.ok(intakeRefreshViaWeb.json.ok);

  const intakeViaWeb = await getJson(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/self-build/intake?projectId=spore`,
  );
  assert.equal(intakeViaWeb.status, 200);
  assert.ok(intakeViaWeb.json.ok);
  assert.ok(Array.isArray(intakeViaWeb.json.detail));
});

test("web proxy exposes operator chat routes and operator chat shell", async (t) => {
  const ORCHESTRATOR_PORT = await findFreePort();
  const WEB_PORT = await findFreePort();
  const { dbPath, sessionDbPath, eventLogPath } = (await makeTempPaths(
    "spore-web-operator-chat-",
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

  t.after(async () => {
    await Promise.all([stopProcess(orchestrator), stopProcess(web)]);
  });

  const webOrigin = `http://127.0.0.1:${WEB_PORT}`;
  await waitForHealth(`http://127.0.0.1:${ORCHESTRATOR_PORT}/health`);
  await waitForHealth(`${webOrigin}/`);

  const htmlResponse = await fetch(`${webOrigin}/`);
  assert.equal(htmlResponse.status, 200);
  const html = await htmlResponse.text();
  assert.ok(html.includes("Operator Chat"));
  assert.ok(html.includes("operator-chat-view"));
  assert.ok(html.includes("operator-mission-hero"));
  assert.ok(html.includes("operator-current-decision"));
  assert.ok(html.includes("operator-progress-strip"));
  assert.ok(html.includes("operator-quick-replies"));
  assert.ok(html.includes("operator-inbox-list"));
  assert.ok(html.includes("data-mission-focus"));
  assert.ok(html.includes("data-current-decision"));
  assert.ok(html.includes("data-quick-reply"));

  const stylesResponse = await fetch(`${webOrigin}/styles.css`);
  assert.equal(stylesResponse.status, 200);
  const styles = await stylesResponse.text();
  assert.match(styles, /\.operator-current-decision-card\s*\{/);
  assert.match(styles, /position:\s*sticky/);

  const createdThread = await postJson(
    `${webOrigin}/api/orchestrator/operator/threads`,
    {
      message:
        "Tighten the operator chat onboarding copy and keep the mission in safe mode.",
      projectId: "spore",
      safeMode: true,
      stub: true,
      by: "web-test-runner",
      source: "web-operator-chat-test",
    },
  );
  assert.equal(createdThread.status, 200);
  assert.ok(createdThread.json.ok);
  assert.ok(createdThread.json.detail.id);
  assert.ok(Array.isArray(createdThread.json.detail.pendingActions));

  const threadId = createdThread.json.detail.id;
  const streamController = new AbortController();
  const streamResponse = await fetch(
    `${webOrigin}/api/orchestrator/operator/threads/${encodeURIComponent(threadId)}/stream`,
    { signal: streamController.signal },
  );
  assert.equal(streamResponse.status, 200);
  assert.match(
    streamResponse.headers.get("content-type") ?? "",
    /text\/event-stream/,
  );
  const reader = streamResponse.body?.getReader();
  let streamChunk = "";
  if (reader) {
    while (!streamChunk.includes("event: thread-ready")) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      streamChunk += new TextDecoder().decode(value);
    }
  }
  streamController.abort();
  await reader?.cancel().catch(() => {});
  assert.ok(streamChunk.includes("event: thread-ready"));

  const threadList = await getJson(
    `${webOrigin}/api/orchestrator/operator/threads`,
  );
  assert.equal(threadList.status, 200);
  assert.ok(threadList.json.ok);
  assert.ok(threadList.json.detail.some((entry) => entry.id === threadId));

  const globalPending = await getJson(
    `${webOrigin}/api/orchestrator/operator/actions`,
  );
  assert.equal(globalPending.status, 200);
  assert.ok(globalPending.json.ok);
  assert.ok(
    globalPending.json.detail.some((entry) => entry.threadId === threadId),
  );

  const statusReply = await postJson(
    `${webOrigin}/api/orchestrator/operator/threads/${encodeURIComponent(threadId)}/messages`,
    {
      message: "status",
      by: "web-test-runner",
      source: "web-operator-chat-test",
    },
  );
  assert.equal(statusReply.status, 200);
  assert.ok(statusReply.json.ok);
  assert.ok(
    statusReply.json.detail.messages.some(
      (message) =>
        message.role === "assistant" &&
        String(message.content).includes("Thread status:"),
    ),
  );
});
