import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import { makeTempPaths } from "../../../packages/orchestrator/test/helpers/scenario-fixtures.js";
import { removeWorkspace } from "../../../packages/workspace-manager/src/manager.js";
import { findFreePort, getJson, postJson, startProcess, waitForHealth } from "./helpers/http-harness.js";

test("self-build summary and lineage routes expose operator-first visibility", async (t) => {
  const ORCHESTRATOR_PORT = await findFreePort();
  const WEB_PORT = await findFreePort();
  const { dbPath, sessionDbPath, eventLogPath } = await makeTempPaths("spore-http-self-build-");
  const worktreeRoot = `${dbPath}.worktrees`;
  const createdWorkspaces = [];

  const orchestrator = startProcess("node", ["services/orchestrator/server.js"], {
    SPORE_ORCHESTRATOR_PORT: String(ORCHESTRATOR_PORT),
    SPORE_ORCHESTRATOR_DB_PATH: dbPath,
    SPORE_SESSION_DB_PATH: sessionDbPath,
    SPORE_EVENT_LOG_PATH: eventLogPath,
    SPORE_WORKTREE_ROOT: worktreeRoot
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
  t.after(async () => {
    for (const workspace of createdWorkspaces) {
      try {
        await removeWorkspace({ worktreePath: workspace.worktreePath, branchName: workspace.branchName, force: true });
      } catch {
        // best-effort cleanup for test-owned worktrees
      }
    }
    await fs.rm(worktreeRoot, { recursive: true, force: true });
  });

  await waitForHealth(`http://127.0.0.1:${ORCHESTRATOR_PORT}/health`);
  await waitForHealth(`http://127.0.0.1:${WEB_PORT}/`);

  // Test 1: self-build/summary returns operator-first structure
  const summary = await getJson(`http://127.0.0.1:${ORCHESTRATOR_PORT}/self-build/summary`);
  assert.equal(summary.status, 200);
  assert.ok(summary.json.ok);
  assert.ok(summary.json.detail);
  
  // Overview section
  assert.ok(summary.json.detail.overview);
  assert.ok(typeof summary.json.detail.overview.totalWorkItems === "number");
  assert.ok(typeof summary.json.detail.overview.totalGroups === "number");
  assert.ok(typeof summary.json.detail.overview.totalProposals === "number");
  assert.ok(typeof summary.json.detail.overview.urgentCount === "number");
  assert.ok(typeof summary.json.detail.overview.followUpCount === "number");
  assert.ok(summary.json.detail.overview.generatedAt);
  
  // Counts section
  assert.ok(summary.json.detail.counts);
  assert.ok(typeof summary.json.detail.counts.workItems === "number");
  assert.ok(typeof summary.json.detail.counts.groups === "number");
  assert.ok(typeof summary.json.detail.counts.blockedItems === "number");
  assert.ok(typeof summary.json.detail.counts.failedItems === "number");
  assert.ok(typeof summary.json.detail.counts.proposals === "number");
  assert.ok(typeof summary.json.detail.counts.waitingReviewProposals === "number");
  assert.ok(typeof summary.json.detail.counts.waitingApprovalProposals === "number");
  assert.ok(typeof summary.json.detail.counts.pendingValidationRuns === "number");
  assert.ok(typeof summary.json.detail.counts.learningRecords === "number");
  
  // Urgent and follow-up queues
  assert.ok(Array.isArray(summary.json.detail.urgentWork));
  assert.ok(Array.isArray(summary.json.detail.followUpWork));
  
  // Legacy arrays
  assert.ok(Array.isArray(summary.json.detail.workItems));
  assert.ok(Array.isArray(summary.json.detail.groups));
  assert.ok(Array.isArray(summary.json.detail.blockedItems));
  assert.ok(Array.isArray(summary.json.detail.failedItems));
  assert.ok(Array.isArray(summary.json.detail.proposals));
  assert.ok(Array.isArray(summary.json.detail.waitingReviewProposals));
  assert.ok(Array.isArray(summary.json.detail.waitingApprovalProposals));
  assert.ok(Array.isArray(summary.json.detail.learningRecords));
  
  // Freshness and display metadata
  assert.ok(summary.json.detail.freshness);
  assert.ok(summary.json.detail.freshness.lastRefresh);
  assert.ok(summary.json.detail.freshness.staleAfter);
  assert.ok(summary.json.detail.displayMetadata);
  assert.ok(typeof summary.json.detail.displayMetadata.urgentLabel === "string");
  assert.ok(typeof summary.json.detail.displayMetadata.followUpLabel === "string");
  assert.ok(typeof summary.json.detail.displayMetadata.statusBadge === "string");
  
  // Recommendations
  assert.ok(Array.isArray(summary.json.detail.recommendations));

  // Test 2: work-item templates catalog
  const templates = await getJson(`http://127.0.0.1:${ORCHESTRATOR_PORT}/work-item-templates`);
  assert.equal(templates.status, 200);
  assert.ok(templates.json.ok);
  assert.ok(Array.isArray(templates.json.detail));
  if (templates.json.detail.length > 0) {
    const template = templates.json.detail[0];
    assert.ok(template.id);
    assert.ok(template.links);
    assert.ok(template.links.self);
  }

  // Test 3: create goal plan and verify links
  const goalPlan = await postJson(`http://127.0.0.1:${ORCHESTRATOR_PORT}/goals/plan`, {
    goal: "Test goal for self-build visibility validation",
    domain: "cli",
    safeMode: true,
    by: "test-runner",
    source: "http-self-build-test"
  });
  assert.equal(goalPlan.status, 200);
  assert.ok(goalPlan.json.ok);
  assert.ok(goalPlan.json.detail);
  assert.ok(goalPlan.json.detail.id);
  assert.ok(goalPlan.json.detail.links);
  assert.ok(goalPlan.json.detail.links.self);
  assert.ok(goalPlan.json.detail.links.materialize);
  assert.ok(Array.isArray(goalPlan.json.detail.recommendations));

  // Test 4: get goal plan detail
  const goalPlanDetail = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/goal-plans/${encodeURIComponent(goalPlan.json.detail.id)}`
  );
  assert.equal(goalPlanDetail.status, 200);
  assert.ok(goalPlanDetail.json.ok);
  assert.equal(goalPlanDetail.json.detail.id, goalPlan.json.detail.id);
  assert.ok(goalPlanDetail.json.detail.links);
  assert.ok(Array.isArray(goalPlanDetail.json.detail.recommendations));

  // Test 5: materialize goal plan into work-item group
  const materialized = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/goal-plans/${encodeURIComponent(goalPlan.json.detail.id)}/materialize`,
    { by: "test-runner" }
  );
  assert.equal(materialized.status, 200);
  assert.ok(materialized.json.ok);
  assert.ok(materialized.json.detail);
  assert.ok(materialized.json.detail.materializedGroup);
  assert.ok(materialized.json.detail.materializedGroup.id);
  assert.ok(materialized.json.detail.materializedGroup.links);
  assert.ok(materialized.json.detail.materializedGroup.links.self);
  assert.ok(materialized.json.detail.materializedGroup.links.run);
  assert.ok(Array.isArray(materialized.json.detail.materializedItems));
  assert.ok(materialized.json.detail.materializedItems.length > 0);

  const groupId = materialized.json.detail.materializedGroup.id;
  const itemId = materialized.json.detail.materializedItems[0].id;

  // Test 6: get work-item group detail with lineage
  const groupDetail = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-item-groups/${encodeURIComponent(groupId)}`
  );
  assert.equal(groupDetail.status, 200);
  assert.ok(groupDetail.json.ok);
  assert.equal(groupDetail.json.detail.id, groupId);
  assert.ok(groupDetail.json.detail.links);
  assert.ok(Array.isArray(groupDetail.json.detail.items));
  assert.ok(Array.isArray(groupDetail.json.detail.recentRuns));
  assert.ok(typeof groupDetail.json.detail.itemCount === "number");

  // Test 7: get work-item detail with lineage back to goal plan and group
  const itemDetail = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-items/${encodeURIComponent(itemId)}`
  );
  assert.equal(itemDetail.status, 200);
  assert.ok(itemDetail.json.ok);
  assert.equal(itemDetail.json.detail.id, itemId);
  assert.ok(itemDetail.json.detail.workItemGroup);
  assert.equal(itemDetail.json.detail.workItemGroup.id, groupId);
  assert.ok(itemDetail.json.detail.goalPlan);
  assert.equal(itemDetail.json.detail.goalPlan.id, goalPlan.json.detail.id);

  // Test 8: run a work item and verify proposal creation
  const runResult = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-items/${encodeURIComponent(itemId)}/run`,
    {
      stub: true,
      timeout: 12000,
      interval: 250,
      by: "test-runner",
      source: "http-self-build-test"
    }
  );
  assert.equal(runResult.status, 200);
  assert.ok(runResult.json.ok);
  assert.ok(runResult.json.detail);
  assert.ok(runResult.json.detail.item);
  assert.ok(runResult.json.detail.run);
  assert.ok(runResult.json.detail.run.id);

  const runId = runResult.json.detail.run.id;

  // Test 9: get work-item run detail with validation and doc suggestions
  const runDetail = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-item-runs/${encodeURIComponent(runId)}`
  );
  assert.equal(runDetail.status, 200);
  assert.ok(runDetail.json.ok);
  assert.equal(runDetail.json.detail.id, runId);
  assert.ok(runDetail.json.detail.item);
  assert.ok(Array.isArray(runDetail.json.detail.docSuggestions));
  assert.ok(Array.isArray(runDetail.json.detail.learningRecords));
  assert.ok(runDetail.json.detail.workspace);

  const workspaceDetail = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-item-runs/${encodeURIComponent(runId)}/workspace`
  );
  assert.equal(workspaceDetail.status, 200);
  assert.ok(workspaceDetail.json.ok);
  assert.ok(workspaceDetail.json.detail);
  assert.ok(workspaceDetail.json.detail.worktreePath);
  createdWorkspaces.push({
    worktreePath: workspaceDetail.json.detail.worktreePath,
    branchName: workspaceDetail.json.detail.branchName
  });

  const workspaceList = await getJson(`http://127.0.0.1:${ORCHESTRATOR_PORT}/workspaces`);
  assert.equal(workspaceList.status, 200);
  assert.ok(workspaceList.json.ok);
  assert.ok(Array.isArray(workspaceList.json.detail));
  assert.ok(workspaceList.json.detail.some((entry) => entry.id === workspaceDetail.json.detail.id));

  // Test 10: check if proposal was created for workflow items
  if (runResult.json.detail.proposal) {
    const proposal = await getJson(
      `http://127.0.0.1:${ORCHESTRATOR_PORT}/proposal-artifacts/${encodeURIComponent(runResult.json.detail.proposal.id)}`
    );
    assert.equal(proposal.status, 200);
    assert.ok(proposal.json.ok);
    assert.ok(proposal.json.detail);
    assert.ok(proposal.json.detail.links);
    assert.ok(proposal.json.detail.links.self);
    assert.ok(proposal.json.detail.links.review);
    assert.ok(proposal.json.detail.links.approval);
    assert.ok(proposal.json.detail.artifacts);
    assert.ok(proposal.json.detail.artifacts.workspace);
  }

  // Test 11: validate work-item run (triggers scenario/regression runs)
  const validation = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-item-runs/${encodeURIComponent(runId)}/validate`,
    {
      stub: true,
      timeout: 12000,
      interval: 250,
      by: "test-runner",
      source: "http-self-build-test"
    }
  );
  assert.equal(validation.status, 200);
  assert.ok(validation.json.ok);
  assert.ok(validation.json.detail);
  assert.ok(validation.json.detail.validation);

  // Test 12: get doc suggestions for run
  const docSuggestions = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-item-runs/${encodeURIComponent(runId)}/doc-suggestions`
  );
  assert.equal(docSuggestions.status, 200);
  assert.ok(docSuggestions.json.ok);
  assert.ok(docSuggestions.json.detail);
  assert.equal(docSuggestions.json.detail.runId, runId);
  assert.ok(Array.isArray(docSuggestions.json.detail.suggestions));

  // Test 13: verify web proxy routes work
  const webSummary = await getJson(`http://127.0.0.1:${WEB_PORT}/api/orchestrator/self-build/summary`);
  assert.equal(webSummary.status, 200);
  assert.ok(webSummary.json.ok);
  assert.ok(webSummary.json.detail);

  const webTemplates = await getJson(`http://127.0.0.1:${WEB_PORT}/api/orchestrator/work-item-templates`);
  assert.equal(webTemplates.status, 200);
  assert.ok(webTemplates.json.ok);

  const webGoalPlans = await getJson(`http://127.0.0.1:${WEB_PORT}/api/orchestrator/goal-plans`);
  assert.equal(webGoalPlans.status, 200);
  assert.ok(webGoalPlans.json.ok);

  const webGroups = await getJson(`http://127.0.0.1:${WEB_PORT}/api/orchestrator/work-item-groups`);
  assert.equal(webGroups.status, 200);
  assert.ok(webGroups.json.ok);

  const webItems = await getJson(`http://127.0.0.1:${WEB_PORT}/api/orchestrator/work-items`);
  assert.equal(webItems.status, 200);
  assert.ok(webItems.json.ok);
});
