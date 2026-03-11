import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import {
  getProposalArtifact,
  openOrchestratorDatabase,
  updateProposalArtifact,
} from "@spore/orchestrator";
import {
  findFreePort,
  getJson,
  makeTempPaths,
  postJson,
  sleep,
  startProcess,
  stopProcess,
  waitForHealth,
  withEventLogPath,
} from "@spore/test-support";
import { removeWorkspace } from "@spore/workspace-manager";
import type { HarnessTempPathsWithEventLog } from "./helpers/http-harness.js";

type JsonRecord = Record<string, unknown>;

const OPERATOR_PROGRESS_STAGE_IDS = [
  "mission_received",
  "plan_prepared",
  "plan_approval",
  "managed_work",
  "proposal_review",
  "proposal_approval",
  "validation",
  "promotion",
];

function asObject(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asArray<T = JsonRecord>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function assertThreadUxProjection(
  detail: JsonRecord,
  expectations: {
    currentStage?: string;
    currentState?: string;
    exceptionState?: string | null;
    statusLineIncludes?: RegExp;
    suggestedReplies?: "empty" | "non-empty";
    expectDistinctTitle?: boolean;
  } = {},
) {
  const hero = asObject(detail.hero);
  assert.equal(typeof hero.title, "string");
  assert.equal(typeof hero.statusLine, "string");
  assert.equal(typeof hero.phase, "string");
  assert.ok(asObject(hero.badges));
  const summary = asObject(detail.summary);
  assert.equal(hero.title, detail.title);
  if (expectations.expectDistinctTitle) {
    assert.notEqual(hero.title, summary.objective);
  }

  const progress = asObject(detail.progress);
  const stages = asArray<JsonRecord>(progress.stages);
  assert.deepEqual(
    stages.map((stage) => String(stage.id ?? "")),
    OPERATOR_PROGRESS_STAGE_IDS,
  );
  assert.equal(typeof progress.currentStage, "string");
  assert.equal(typeof progress.currentState, "string");
  if (expectations.currentStage) {
    assert.equal(progress.currentStage, expectations.currentStage);
  }
  if (expectations.currentState) {
    assert.equal(progress.currentState, expectations.currentState);
  }
  if (Object.hasOwn(expectations, "exceptionState")) {
    assert.equal(progress.exceptionState ?? null, expectations.exceptionState);
  }

  const evidenceSummary = asObject(detail.evidenceSummary);
  assert.ok(evidenceSummary);

  const inboxSummary = asObject(detail.inboxSummary);
  assert.equal(typeof inboxSummary.urgency, "string");
  assert.equal(typeof inboxSummary.reason, "string");
  assert.equal(typeof inboxSummary.waitingLabel, "string");

  const decisionGuidance = asObject(detail.decisionGuidance);
  assert.equal(typeof decisionGuidance.title, "string");
  assert.equal(typeof decisionGuidance.primaryAction, "string");
  assert.ok(Array.isArray(decisionGuidance.secondaryActions));
  assert.ok(Array.isArray(decisionGuidance.suggestedReplies));

  if (expectations.statusLineIncludes) {
    assert.match(String(hero.statusLine), expectations.statusLineIncludes);
  }
  if (expectations.suggestedReplies === "non-empty") {
    assert.ok(asArray(decisionGuidance.suggestedReplies).length > 0);
  }
  if (expectations.suggestedReplies === "empty") {
    assert.deepEqual(asArray(decisionGuidance.suggestedReplies), []);
  }
}

function assertInboxActionProjection(
  action: JsonRecord,
  actionKind: string,
  expectations: {
    suggestedReplies?: "empty" | "non-empty";
    threadTitle?: string;
    objective?: string;
  } = {},
) {
  assert.equal(action.actionKind, actionKind);

  const threadSummary = asObject(action.threadSummary);
  assert.equal(typeof threadSummary.title, "string");
  assert.equal(typeof threadSummary.objective, "string");
  if (expectations.threadTitle) {
    assert.equal(threadSummary.title, expectations.threadTitle);
  }
  if (expectations.objective) {
    assert.equal(threadSummary.objective, expectations.objective);
    assert.notEqual(threadSummary.title, threadSummary.objective);
  }

  const inboxSummary = asObject(action.inboxSummary);
  assert.equal(typeof inboxSummary.urgency, "string");
  assert.equal(typeof inboxSummary.reason, "string");
  assert.equal(typeof inboxSummary.waitingLabel, "string");

  const decisionGuidance = asObject(action.decisionGuidance);
  assert.equal(typeof decisionGuidance.title, "string");
  assert.equal(typeof decisionGuidance.why, "string");
  assert.equal(typeof decisionGuidance.nextIfApproved, "string");
  assert.equal(typeof decisionGuidance.primaryAction, "string");
  assert.ok(Array.isArray(decisionGuidance.secondaryActions));
  assert.ok(Array.isArray(decisionGuidance.suggestedReplies));
  assert.ok(Array.isArray(action.choices));

  if (expectations.suggestedReplies === "non-empty") {
    assert.ok(asArray(decisionGuidance.suggestedReplies).length > 0);
  }
  if (expectations.suggestedReplies === "empty") {
    assert.deepEqual(asArray(decisionGuidance.suggestedReplies), []);
  }
}

test("self-build summary and lineage routes expose operator-first visibility", async (t) => {
  const ORCHESTRATOR_PORT = await findFreePort();
  const WEB_PORT = await findFreePort();
  const { dbPath, sessionDbPath, eventLogPath } = withEventLogPath(
    await makeTempPaths("spore-http-self-build-"),
  ) as HarnessTempPathsWithEventLog;
  const worktreeRoot = `${dbPath}.worktrees`;
  const createdWorkspaces = [];

  const orchestrator = startProcess(
    "node",
    ["services/orchestrator/server.js"],
    {
      SPORE_ORCHESTRATOR_PORT: String(ORCHESTRATOR_PORT),
      SPORE_ORCHESTRATOR_DB_PATH: dbPath,
      SPORE_SESSION_DB_PATH: sessionDbPath,
      SPORE_EVENT_LOG_PATH: eventLogPath,
      SPORE_WORKTREE_ROOT: worktreeRoot,
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
  t.after(async () => {
    for (const workspace of createdWorkspaces) {
      try {
        await removeWorkspace({
          worktreePath: workspace.worktreePath,
          branchName: workspace.branchName,
          force: true,
        });
      } catch {
        // best-effort cleanup for test-owned worktrees
      }
    }
    await fs.rm(worktreeRoot, { recursive: true, force: true });
  });

  await waitForHealth(`http://127.0.0.1:${ORCHESTRATOR_PORT}/health`);
  await waitForHealth(`http://127.0.0.1:${WEB_PORT}/`);

  // Test 1: self-build/summary returns operator-first structure
  const summary = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/self-build/summary`,
  );
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
  assert.ok(
    typeof summary.json.detail.counts.waitingReviewProposals === "number",
  );
  assert.ok(
    typeof summary.json.detail.counts.waitingApprovalProposals === "number",
  );
  assert.ok(
    typeof summary.json.detail.counts.pendingValidationRuns === "number",
  );
  assert.ok(typeof summary.json.detail.counts.learningRecords === "number");
  assert.ok(
    typeof summary.json.detail.counts.policyRecommendations === "number",
  );
  assert.ok(
    typeof summary.json.detail.counts.repeatedLearningTrends === "number",
  );
  assert.ok(
    typeof summary.json.detail.counts.protectedScopeBlocks === "number",
  );

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
  assert.ok(Array.isArray(summary.json.detail.learningTrends));
  assert.ok(Array.isArray(summary.json.detail.policyRecommendations));
  assert.ok(typeof summary.json.detail.rolloutTierSummary === "object");

  // Freshness and display metadata
  assert.ok(summary.json.detail.freshness);
  assert.ok(summary.json.detail.freshness.lastRefresh);
  assert.ok(summary.json.detail.freshness.staleAfter);
  assert.ok(summary.json.detail.displayMetadata);
  assert.ok(
    typeof summary.json.detail.displayMetadata.urgentLabel === "string",
  );
  assert.ok(
    typeof summary.json.detail.displayMetadata.followUpLabel === "string",
  );
  assert.ok(
    typeof summary.json.detail.displayMetadata.statusBadge === "string",
  );

  // Recommendations
  assert.ok(Array.isArray(summary.json.detail.recommendations));
  assert.ok(typeof summary.json.detail.queueSummary === "object");
  assert.ok(typeof summary.json.detail.attentionSummary === "object");
  assert.ok(Array.isArray(summary.json.detail.goalPlans));
  assert.ok(typeof summary.json.detail.lifecycle === "object");
  assert.ok(
    typeof summary.json.detail.lifecycle.blockedPromotions === "number",
  );
  assert.ok(
    typeof summary.json.detail.lifecycle.pendingValidations === "number",
  );
  assert.ok(
    typeof summary.json.detail.lifecycle.activeAutonomousRuns === "number",
  );
  assert.ok(typeof summary.json.detail.lifecycle.quarantinedWork === "number");
  assert.ok(
    typeof summary.json.detail.lifecycle.protectedTierOverrides === "number",
  );
  assert.ok(
    typeof summary.json.detail.lifecycle.policyRecommendationQueue === "number",
  );
  assert.ok(Array.isArray(summary.json.detail.protectedTierOverrides));
  assert.ok(Array.isArray(summary.json.detail.policyRecommendationReviews));

  const dashboard = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/self-build/dashboard`,
  );
  assert.equal(dashboard.status, 200);
  assert.ok(dashboard.json.ok);
  assert.ok(dashboard.json.detail.route);
  assert.equal(dashboard.json.detail.route.self, "/self-build/dashboard");
  assert.ok(Array.isArray(dashboard.json.detail.recentWorkItemRuns));
  assert.ok(typeof dashboard.json.detail.attentionSummary === "object");
  assert.ok(typeof dashboard.json.detail.queueSummary === "object");
  assert.ok(typeof dashboard.json.detail.lifecycle === "object");

  // Test 2: work-item templates catalog
  const templates = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-item-templates`,
  );
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
  const goalPlan = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/goals/plan`,
    {
      goal: "Test goal for self-build visibility validation",
      domain: "cli",
      safeMode: true,
      by: "test-runner",
      source: "http-self-build-test",
    },
  );
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
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/goal-plans/${encodeURIComponent(goalPlan.json.detail.id)}`,
  );
  assert.equal(goalPlanDetail.status, 200);
  assert.ok(goalPlanDetail.json.ok);
  assert.equal(goalPlanDetail.json.detail.id, goalPlan.json.detail.id);
  assert.ok(goalPlanDetail.json.detail.links);
  assert.ok(Array.isArray(goalPlanDetail.json.detail.recommendations));

  const goalPlanHistoryBeforeEdit = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/goal-plans/${encodeURIComponent(goalPlan.json.detail.id)}/history`,
  );
  assert.equal(goalPlanHistoryBeforeEdit.status, 200);
  assert.ok(goalPlanHistoryBeforeEdit.json.ok);
  assert.ok(Array.isArray(goalPlanHistoryBeforeEdit.json.detail.history));

  const editedRecommendations = [
    ...(goalPlanDetail.json.detail.recommendations ?? []),
  ].reverse();
  const edited = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/goal-plans/${encodeURIComponent(goalPlan.json.detail.id)}/edit`,
    {
      recommendations: editedRecommendations,
      rationale:
        "Reverse recommendations to exercise editable goal-plan review.",
      by: "test-runner",
      source: "http-self-build-test",
    },
  );
  assert.equal(edited.status, 200);
  assert.ok(edited.json.ok);
  assert.ok(Array.isArray(edited.json.detail.editedRecommendations));
  assert.ok(Array.isArray(edited.json.detail.editHistory));
  assert.equal(
    edited.json.detail.editedRecommendations.length,
    editedRecommendations.length,
  );

  const reviewed = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/goal-plans/${encodeURIComponent(goalPlan.json.detail.id)}/review`,
    {
      status: "reviewed",
      comments: "Materialize after review for operator flow coverage.",
      by: "test-runner",
    },
  );
  assert.equal(reviewed.status, 200);
  assert.ok(reviewed.json.ok);
  assert.equal(reviewed.json.detail.status, "reviewed");
  assert.ok(Array.isArray(reviewed.json.detail.reviewHistory));

  const goalPlanHistoryAfterReview = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/goal-plans/${encodeURIComponent(goalPlan.json.detail.id)}/history`,
  );
  assert.equal(goalPlanHistoryAfterReview.status, 200);
  assert.ok(goalPlanHistoryAfterReview.json.ok);
  assert.ok(
    goalPlanHistoryAfterReview.json.detail.history.some(
      (entry) => entry.type === "reviewed",
    ),
  );

  const createdOverride = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/goal-plans/${encodeURIComponent(goalPlan.json.detail.id)}/protected-override`,
    {
      kind: "protected-tier",
      reason: "Exercise protected-tier override review flow.",
      rationale:
        "Operator override required before autonomous materialization.",
      by: "test-runner",
      source: "http-self-build-test",
    },
  );
  assert.equal(createdOverride.status, 200);
  assert.ok(createdOverride.json.ok);
  assert.equal(createdOverride.json.detail.targetType, "self-build-override");
  assert.equal(createdOverride.json.detail.overrideTargetType, "goal-plan");

  const overrideList = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/self-build/overrides?targetType=goal-plan&targetId=${encodeURIComponent(goalPlan.json.detail.id)}`,
  );
  assert.equal(overrideList.status, 200);
  assert.ok(overrideList.json.ok);
  assert.ok(Array.isArray(overrideList.json.detail));
  const goalPlanOverride = overrideList.json.detail.find(
    (entry) => entry.overrideTargetId === goalPlan.json.detail.id,
  );
  assert.ok(goalPlanOverride);

  const overrideDetail = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/self-build/overrides/${encodeURIComponent(goalPlanOverride.id)}`,
  );
  assert.equal(overrideDetail.status, 200);
  assert.ok(overrideDetail.json.ok);
  assert.equal(overrideDetail.json.detail.id, goalPlanOverride.id);

  const reviewedOverride = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/self-build/overrides/${encodeURIComponent(goalPlanOverride.id)}/review`,
    {
      status: "held",
      comments: "Override held for protected-tier HTTP coverage.",
      by: "test-runner",
    },
  );
  assert.equal(reviewedOverride.status, 200);
  assert.ok(reviewedOverride.json.ok);
  assert.equal(reviewedOverride.json.detail.status, "held");

  const releasedOverride = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/self-build/overrides/${encodeURIComponent(goalPlanOverride.id)}/release`,
    {
      reason: "Release override after HTTP coverage.",
      by: "test-runner",
    },
  );
  assert.equal(releasedOverride.status, 200);
  assert.ok(releasedOverride.json.ok);
  assert.equal(releasedOverride.json.detail.status, "released");

  const policyRecommendations = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/self-build/policy-recommendations`,
  );
  assert.equal(policyRecommendations.status, 200);
  assert.ok(policyRecommendations.json.ok);
  assert.ok(Array.isArray(policyRecommendations.json.detail));

  const policyRecommendationReviews = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/self-build/policy-recommendation-reviews`,
  );
  assert.equal(policyRecommendationReviews.status, 200);
  assert.ok(policyRecommendationReviews.json.ok);
  assert.ok(Array.isArray(policyRecommendationReviews.json.detail));

  const recommendation = policyRecommendations.json.detail[0];
  if (recommendation?.id) {
    const recommendationDetail = await getJson(
      `http://127.0.0.1:${ORCHESTRATOR_PORT}/self-build/policy-recommendations/${encodeURIComponent(recommendation.id)}`,
    );
    assert.equal(recommendationDetail.status, 200);
    assert.ok(recommendationDetail.json.ok);
    assert.equal(recommendationDetail.json.detail.id, recommendation.id);

    const reviewedRecommendation = await postJson(
      `http://127.0.0.1:${ORCHESTRATOR_PORT}/self-build/policy-recommendations/${encodeURIComponent(recommendation.id)}/review`,
      {
        status: "held",
        comments: "Review policy recommendation during HTTP coverage.",
        by: "test-runner",
      },
    );
    assert.equal(reviewedRecommendation.status, 200);
    assert.ok(reviewedRecommendation.json.ok);
    assert.equal(reviewedRecommendation.json.detail.queueStatus, "held");

    const materializedRecommendation = await postJson(
      `http://127.0.0.1:${ORCHESTRATOR_PORT}/self-build/policy-recommendations/${encodeURIComponent(recommendation.id)}/materialize`,
      {
        mode: "intake",
        projectId: "spore",
        domain: recommendation.domainId ?? "docs",
        by: "test-runner",
      },
    );
    assert.equal(materializedRecommendation.status, 200);
    assert.ok(materializedRecommendation.json.ok);
    assert.ok(
      materializedRecommendation.json.detail.materializedIntakeId ||
        materializedRecommendation.json.detail.materializedGoalPlanId ||
        materializedRecommendation.json.detail.links?.goalPlan,
    );
  }

  // Test 5: materialize goal plan into work-item group
  const materialized = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/goal-plans/${encodeURIComponent(goalPlan.json.detail.id)}/materialize`,
    { by: "test-runner" },
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
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-item-groups/${encodeURIComponent(groupId)}`,
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
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-items/${encodeURIComponent(itemId)}`,
  );
  assert.equal(itemDetail.status, 200);
  assert.ok(itemDetail.json.ok);
  assert.equal(itemDetail.json.detail.id, itemId);
  assert.ok(itemDetail.json.detail.workItemGroup);
  assert.equal(itemDetail.json.detail.workItemGroup.id, groupId);
  assert.ok(itemDetail.json.detail.goalPlan);
  assert.equal(itemDetail.json.detail.goalPlan.id, goalPlan.json.detail.id);
  assert.ok(itemDetail.json.detail.runHistory);
  assert.ok(Array.isArray(itemDetail.json.detail.runHistory.runs));

  // Test 8: run a work item and verify proposal creation
  const runResult = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-items/${encodeURIComponent(itemId)}/run`,
    {
      stub: true,
      timeout: 12000,
      interval: 250,
      by: "test-runner",
      source: "http-self-build-test",
    },
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
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-item-runs/${encodeURIComponent(runId)}`,
  );
  assert.equal(runDetail.status, 200);
  assert.ok(runDetail.json.ok);
  assert.ok(runDetail.json.detail.links);
  assert.ok(runDetail.json.detail.validationStatus);

  if (runDetail.json.detail.proposal?.id) {
    const reviewPackage = await getJson(
      `http://127.0.0.1:${ORCHESTRATOR_PORT}/proposal-artifacts/${encodeURIComponent(runDetail.json.detail.proposal.id)}/review-package`,
    );
    assert.equal(reviewPackage.status, 200);
    assert.ok(reviewPackage.json.ok);
    assert.ok(reviewPackage.json.detail.proposal);
    assert.ok(reviewPackage.json.detail.promotion);
    assert.ok(Array.isArray(reviewPackage.json.detail.suggestedActions));

    const reviewedProposal = await postJson(
      `http://127.0.0.1:${ORCHESTRATOR_PORT}/proposal-artifacts/${encodeURIComponent(runDetail.json.detail.proposal.id)}/review`,
      {
        status: "reviewed",
        comments: "Reviewed during HTTP self-build route coverage.",
        by: "test-runner",
      },
    );
    assert.equal(reviewedProposal.status, 200);
    assert.ok(reviewedProposal.json.ok);

    const approvedProposal = await postJson(
      `http://127.0.0.1:${ORCHESTRATOR_PORT}/proposal-artifacts/${encodeURIComponent(runDetail.json.detail.proposal.id)}/approval`,
      {
        status: "approved",
        comments: "Approved to test promotion candidate metadata.",
        by: "test-runner",
        targetBranch: "main",
      },
    );
    assert.equal(approvedProposal.status, 200);
    assert.ok(approvedProposal.json.ok);
    assert.ok(
      ["validation_required", "promotion_ready"].includes(
        String(approvedProposal.json.detail.status),
      ),
    );
    assert.ok(
      ["blocked", "ready", "promotion_candidate"].includes(
        String(approvedProposal.json.detail.promotionStatus),
      ),
    );

    const validationBundle = await postJson(
      `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-item-runs/${encodeURIComponent(runId)}/validate-bundle`,
      {
        bundleIds: ["proposal-ready-fast", "integration-ready-core"],
        stub: true,
        timeout: 12000,
        interval: 250,
        by: "test-runner",
        source: "http-self-build-test",
      },
    );
    assert.equal(validationBundle.status, 200);
    assert.ok(validationBundle.json.ok);
    assert.ok(validationBundle.json.detail.validation);

    const promotionPlan = await postJson(
      `http://127.0.0.1:${ORCHESTRATOR_PORT}/proposal-artifacts/${encodeURIComponent(runDetail.json.detail.proposal.id)}/promotion-plan`,
      {
        targetBranch: "main",
        by: "test-runner",
      },
    );
    assert.equal(promotionPlan.status, 200);
    assert.ok(promotionPlan.json.ok);
    assert.equal(
      promotionPlan.json.detail.proposal.id,
      runDetail.json.detail.proposal.id,
    );
    assert.equal(promotionPlan.json.detail.plan.root.role, "integrator");

    const promotionInvoke = await postJson(
      `http://127.0.0.1:${ORCHESTRATOR_PORT}/proposal-artifacts/${encodeURIComponent(runDetail.json.detail.proposal.id)}/promotion-invoke`,
      {
        targetBranch: "main",
        by: "test-runner",
        wait: true,
        stub: true,
        timeout: 12000,
        interval: 250,
      },
    );
    assert.equal(promotionInvoke.status, 200);
    assert.ok(promotionInvoke.json.ok);
    assert.equal(
      promotionInvoke.json.detail.proposal.id,
      runDetail.json.detail.proposal.id,
    );
    assert.equal(
      promotionInvoke.json.detail.detail.execution.role,
      "integrator",
    );

    const reworkedProposal = await postJson(
      `http://127.0.0.1:${ORCHESTRATOR_PORT}/proposal-artifacts/${encodeURIComponent(runDetail.json.detail.proposal.id)}/rework`,
      {
        by: "test-runner",
        comments:
          "Record proposal rework history for operator follow-up coverage.",
        source: "http-self-build-test",
      },
    );
    assert.equal(reworkedProposal.status, 200);
    assert.ok(reworkedProposal.json.ok);
    assert.ok(Array.isArray(reworkedProposal.json.detail.reworkHistory));
    assert.ok(reworkedProposal.json.detail.reworkHistory.length >= 1);

    const integrationBranches = await getJson(
      `http://127.0.0.1:${ORCHESTRATOR_PORT}/integration-branches`,
    );
    assert.equal(integrationBranches.status, 200);
    assert.ok(integrationBranches.json.ok);
    assert.ok(Array.isArray(integrationBranches.json.detail));
    const integrationBranch = integrationBranches.json.detail.find(
      (entry) =>
        entry.proposalArtifactId === runDetail.json.detail.proposal.id ||
        entry.sourceExecutionId ===
          promotionInvoke.json.detail.detail.execution.id,
    );
    assert.ok(integrationBranch);

    const integrationBranchDetail = await getJson(
      `http://127.0.0.1:${ORCHESTRATOR_PORT}/integration-branches/${encodeURIComponent(integrationBranch.name)}`,
    );
    assert.equal(integrationBranchDetail.status, 200);
    assert.ok(integrationBranchDetail.json.ok);
    assert.equal(
      integrationBranchDetail.json.detail.name,
      integrationBranch.name,
    );
  }

  const goalPlanRun = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/goal-plans/${encodeURIComponent(goalPlan.json.detail.id)}/run`,
    {
      autoValidate: true,
      stub: true,
      timeout: 12000,
      interval: 250,
      by: "test-runner",
      source: "http-self-build-test",
    },
  );
  assert.equal(goalPlanRun.status, 200);
  assert.ok(goalPlanRun.json.ok);
  assert.ok(goalPlanRun.json.detail.goalPlan);
  assert.ok(goalPlanRun.json.detail.group);
  assert.ok(Array.isArray(goalPlanRun.json.detail.results));
  assert.ok(Array.isArray(goalPlanRun.json.detail.validationResults));
  assert.ok(Array.isArray(goalPlanRun.json.detail.recommendations));

  const loopStatus = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/self-build/loop/status`,
  );
  assert.equal(loopStatus.status, 200);
  assert.ok(loopStatus.json.ok);
  assert.ok(loopStatus.json.detail);
  assert.ok(loopStatus.json.detail.status);

  const loopStarted = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/self-build/loop/start`,
    {
      project: "config/projects/spore.yaml",
      stub: true,
      timeout: 12000,
      interval: 250,
      by: "test-runner",
      source: "http-self-build-test",
    },
  );
  assert.equal(loopStarted.status, 200);
  assert.ok(loopStarted.json.ok);
  assert.ok(loopStarted.json.detail);
  assert.ok(loopStarted.json.detail.status);

  const loopStopped = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/self-build/loop/stop`,
    {
      by: "test-runner",
      source: "http-self-build-test",
      reason: "HTTP route coverage complete.",
    },
  );
  assert.equal(loopStopped.status, 200);
  assert.ok(loopStopped.json.ok);
  assert.equal(loopStopped.json.detail.status, "stopped");

  const selfBuildDecisions = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/self-build/decisions`,
  );
  assert.equal(selfBuildDecisions.status, 200);
  assert.ok(selfBuildDecisions.json.ok);
  assert.ok(Array.isArray(selfBuildDecisions.json.detail));
  assert.ok(
    selfBuildDecisions.json.detail.some(
      (entry) => entry.action === "start-loop" || entry.action === "stop-loop",
    ),
  );

  const quarantinedGoalPlan = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/goal-plans/${encodeURIComponent(goalPlan.json.detail.id)}/quarantine`,
    {
      by: "test-runner",
      source: "http-self-build-test",
      reason: "Exercise quarantine and release coverage.",
    },
  );
  assert.equal(quarantinedGoalPlan.status, 200);
  assert.ok(quarantinedGoalPlan.json.ok);
  assert.equal(quarantinedGoalPlan.json.detail.targetType, "goal-plan");

  const quarantinedGroup = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-item-groups/${encodeURIComponent(groupId)}/quarantine`,
    {
      by: "test-runner",
      source: "http-self-build-test",
      reason: "Exercise group quarantine coverage.",
    },
  );
  assert.equal(quarantinedGroup.status, 200);
  assert.ok(quarantinedGroup.json.ok);
  assert.equal(quarantinedGroup.json.detail.targetType, "work-item-group");

  if (runDetail.json.detail.proposal?.id) {
    const quarantinedProposal = await postJson(
      `http://127.0.0.1:${ORCHESTRATOR_PORT}/proposal-artifacts/${encodeURIComponent(runDetail.json.detail.proposal.id)}/quarantine`,
      {
        by: "test-runner",
        source: "http-self-build-test",
        reason: "Exercise proposal quarantine coverage.",
      },
    );
    assert.equal(quarantinedProposal.status, 200);
    assert.ok(quarantinedProposal.json.ok);
    assert.equal(quarantinedProposal.json.detail.targetType, "proposal");
  }

  const selfBuildQuarantine = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/self-build/quarantine`,
  );
  assert.equal(selfBuildQuarantine.status, 200);
  assert.ok(selfBuildQuarantine.json.ok);
  assert.ok(Array.isArray(selfBuildQuarantine.json.detail));
  const goalPlanQuarantine = selfBuildQuarantine.json.detail.find(
    (entry) =>
      entry.targetType === "goal-plan" &&
      entry.targetId === goalPlan.json.detail.id &&
      entry.status === "active",
  );
  assert.ok(goalPlanQuarantine);

  const releasedGoalPlanQuarantine = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/self-build/quarantine/${encodeURIComponent(goalPlanQuarantine.id)}/release`,
    {
      by: "test-runner",
      source: "http-self-build-test",
      reason: "Release goal-plan quarantine after coverage.",
    },
  );
  assert.equal(releasedGoalPlanQuarantine.status, 200);
  assert.ok(releasedGoalPlanQuarantine.json.ok);
  assert.equal(releasedGoalPlanQuarantine.json.detail.status, "released");

  assert.equal(runDetail.json.detail.id, runId);
  assert.ok(runDetail.json.detail.item);
  assert.ok(Array.isArray(runDetail.json.detail.docSuggestions));
  assert.ok(Array.isArray(runDetail.json.detail.learningRecords));
  assert.ok(Array.isArray(runDetail.json.detail.suggestedActions));
  assert.ok(typeof runDetail.json.detail.links.rerun === "string");

  const runHistory = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-items/${encodeURIComponent(itemId)}/runs`,
  );
  assert.equal(runHistory.status, 200);
  assert.ok(runHistory.json.ok);
  assert.ok(runHistory.json.detail.latestRun);
  assert.ok(typeof runHistory.json.detail.runCountsByStatus === "object");
  assert.ok(Array.isArray(runHistory.json.detail.runs));
  assert.ok(runHistory.json.detail.runs[0].links);

  const workspaceDetail = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-item-runs/${encodeURIComponent(runId)}/workspace`,
  );
  if (workspaceDetail.status === 200) {
    assert.ok(workspaceDetail.json.ok);
    assert.ok(workspaceDetail.json.detail);
    assert.ok(workspaceDetail.json.detail.worktreePath);
    createdWorkspaces.push({
      worktreePath: workspaceDetail.json.detail.worktreePath,
      branchName: workspaceDetail.json.detail.branchName,
    });

    const reconciledWorkspace = await postJson(
      `http://127.0.0.1:${ORCHESTRATOR_PORT}/workspaces/${encodeURIComponent(workspaceDetail.json.detail.id)}/reconcile`,
      {
        by: "test-runner",
        source: "http-self-build-test",
      },
    );
    assert.equal(reconciledWorkspace.status, 200);
    assert.ok(reconciledWorkspace.json.ok);
    assert.ok(reconciledWorkspace.json.detail.diagnostics);

    const blockedCleanup = await postJson(
      `http://127.0.0.1:${ORCHESTRATOR_PORT}/workspaces/${encodeURIComponent(workspaceDetail.json.detail.id)}/cleanup`,
      {
        by: "test-runner",
        source: "http-self-build-test",
      },
    );
    assert.equal(blockedCleanup.status, 409);
    assert.equal(blockedCleanup.json.error, "cleanup_blocked");
  } else {
    assert.equal(workspaceDetail.status, 404);
  }

  const workspaceList = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/workspaces`,
  );
  assert.equal(workspaceList.status, 200);
  assert.ok(workspaceList.json.ok);
  assert.ok(Array.isArray(workspaceList.json.detail));
  if (workspaceDetail.status === 200) {
    assert.ok(
      workspaceList.json.detail.some(
        (entry) => entry.id === workspaceDetail.json.detail.id,
      ),
    );
  }

  // Test 10: check if proposal was created for workflow items
  if (runResult.json.detail.proposal) {
    const proposal = await getJson(
      `http://127.0.0.1:${ORCHESTRATOR_PORT}/proposal-artifacts/${encodeURIComponent(runResult.json.detail.proposal.id)}`,
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
    assert.ok(proposal.json.detail.artifacts.patchArtifact);
    assert.ok(
      typeof proposal.json.detail.artifacts.patchArtifact.byteLength ===
        "number",
    );
    assert.ok(proposal.json.detail.artifacts.diffSummary);
    assert.ok(
      typeof proposal.json.detail.artifacts.diffSummary.fileCount === "number",
    );
    assert.ok(
      Array.isArray(proposal.json.detail.artifacts.changedFilesByScope),
    );
  }

  const executionId =
    runDetail.json.detail?.result?.executionId ??
    runResult.json.detail?.run?.result?.executionId ??
    null;
  if (executionId) {
    const executionWorkspaces = await getJson(
      `http://127.0.0.1:${ORCHESTRATOR_PORT}/executions/${encodeURIComponent(executionId)}/workspaces`,
    );
    assert.equal(executionWorkspaces.status, 200);
    assert.ok(executionWorkspaces.json.ok);
    assert.equal(executionWorkspaces.json.detail.executionId, executionId);
    assert.ok(Array.isArray(executionWorkspaces.json.detail.workspaces));
    if (workspaceDetail.status === 200) {
      assert.ok(
        executionWorkspaces.json.detail.workspaces.some(
          (entry) => entry.id === workspaceDetail.json.detail.id,
        ),
      );
    }
  }

  // Test 11: validate work-item run (triggers scenario/regression runs)
  const validation = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-item-runs/${encodeURIComponent(runId)}/validate`,
    {
      stub: true,
      timeout: 12000,
      interval: 250,
      by: "test-runner",
      source: "http-self-build-test",
    },
  );
  assert.equal(validation.status, 200);
  assert.ok(validation.json.ok);
  assert.ok(validation.json.detail);
  assert.ok(validation.json.detail.validation);

  if (runDetail.json.detail.proposal?.id) {
    const promotionBranchList = await getJson(
      `http://127.0.0.1:${ORCHESTRATOR_PORT}/integration-branches`,
    );
    const promotionBranch = promotionBranchList.json.detail.find(
      (entry) => entry.proposalArtifactId === runDetail.json.detail.proposal.id,
    );
    if (promotionBranch) {
      const quarantinedBranch = await postJson(
        `http://127.0.0.1:${ORCHESTRATOR_PORT}/integration-branches/${encodeURIComponent(promotionBranch.name)}/quarantine`,
        {
          by: "test-runner",
          source: "http-self-build-test",
          reason: "Exercise integration-branch quarantine coverage.",
        },
      );
      assert.equal(quarantinedBranch.status, 200);
      assert.ok(quarantinedBranch.json.ok);
      assert.equal(
        quarantinedBranch.json.detail.targetType,
        "integration-branch",
      );

      const rollback = await postJson(
        `http://127.0.0.1:${ORCHESTRATOR_PORT}/integration-branches/${encodeURIComponent(promotionBranch.name)}/rollback`,
        {
          by: "test-runner",
          source: "http-self-build-test",
          reason: "Exercise integration-branch rollback coverage.",
        },
      );
      assert.equal(rollback.status, 200);
      assert.ok(rollback.json.ok);
      assert.ok(rollback.json.detail.rollback);
      assert.equal(
        rollback.json.detail.rollback.targetType,
        "integration-branch",
      );

      const rollbackList = await getJson(
        `http://127.0.0.1:${ORCHESTRATOR_PORT}/self-build/rollback`,
      );
      assert.equal(rollbackList.status, 200);
      assert.ok(rollbackList.json.ok);
      assert.ok(Array.isArray(rollbackList.json.detail));
      assert.ok(
        rollbackList.json.detail.some(
          (entry) =>
            entry.targetType === "integration-branch" &&
            entry.targetId === promotionBranch.name,
        ),
      );
    }
  }

  // Test 12: get doc suggestions for run
  const docSuggestions = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-item-runs/${encodeURIComponent(runId)}/doc-suggestions`,
  );
  assert.equal(docSuggestions.status, 200);
  assert.ok(docSuggestions.json.ok);
  assert.ok(docSuggestions.json.detail);
  assert.equal(docSuggestions.json.detail.runId, runId);
  assert.ok(Array.isArray(docSuggestions.json.detail.suggestions));

  const selfBuildLearnings = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/self-build/learnings`,
  );
  assert.equal(selfBuildLearnings.status, 200);
  assert.ok(selfBuildLearnings.json.ok);
  assert.ok(Array.isArray(selfBuildLearnings.json.detail));

  const selfBuildLearningTrends = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/self-build/learning-trends`,
  );
  assert.equal(selfBuildLearningTrends.status, 200);
  assert.ok(selfBuildLearningTrends.json.ok);
  assert.ok(Array.isArray(selfBuildLearningTrends.json.detail));

  const selfBuildPolicyRecommendations = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/self-build/policy-recommendations`,
  );
  assert.equal(selfBuildPolicyRecommendations.status, 200);
  assert.ok(selfBuildPolicyRecommendations.json.ok);
  assert.ok(Array.isArray(selfBuildPolicyRecommendations.json.detail));

  const selfBuildDocSuggestions = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/self-build/doc-suggestions?runId=${encodeURIComponent(runId)}`,
  );
  assert.equal(selfBuildDocSuggestions.status, 200);
  assert.ok(selfBuildDocSuggestions.json.ok);
  assert.ok(Array.isArray(selfBuildDocSuggestions.json.detail));

  const firstDocSuggestion = selfBuildDocSuggestions.json.detail[0] ?? null;
  if (firstDocSuggestion) {
    const docSuggestionDetail = await getJson(
      `http://127.0.0.1:${ORCHESTRATOR_PORT}/doc-suggestions/${encodeURIComponent(firstDocSuggestion.id)}`,
    );
    assert.equal(docSuggestionDetail.status, 200);
    assert.ok(docSuggestionDetail.json.ok);
    assert.equal(docSuggestionDetail.json.detail.id, firstDocSuggestion.id);

    const reviewedSuggestion = await postJson(
      `http://127.0.0.1:${ORCHESTRATOR_PORT}/doc-suggestions/${encodeURIComponent(firstDocSuggestion.id)}/review`,
      {
        status: "accepted",
        by: "test-runner",
        source: "http-self-build-test",
        comments: "Accept suggestion for intake coverage.",
      },
    );
    assert.equal(reviewedSuggestion.status, 200);
    assert.ok(reviewedSuggestion.json.ok);
    assert.equal(reviewedSuggestion.json.detail.status, "accepted");

    const materializedSuggestion = await postJson(
      `http://127.0.0.1:${ORCHESTRATOR_PORT}/doc-suggestions/${encodeURIComponent(firstDocSuggestion.id)}/materialize`,
      {
        by: "test-runner",
        source: "http-self-build-test",
        safeMode: true,
      },
    );
    assert.equal(materializedSuggestion.status, 200);
    assert.ok(materializedSuggestion.json.ok);
    assert.ok(materializedSuggestion.json.detail);
  }

  const refreshedIntake = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/self-build/intake/refresh`,
    {
      includeAccepted: true,
      projectId: "spore",
      by: "test-runner",
      source: "http-self-build-test",
    },
  );
  assert.equal(refreshedIntake.status, 200);
  assert.ok(refreshedIntake.json.ok);

  const selfBuildIntake = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/self-build/intake?projectId=spore`,
  );
  assert.equal(selfBuildIntake.status, 200);
  assert.ok(selfBuildIntake.json.ok);
  assert.ok(Array.isArray(selfBuildIntake.json.detail));

  const firstIntake = selfBuildIntake.json.detail[0] ?? null;
  if (firstIntake) {
    const intakeDetail = await getJson(
      `http://127.0.0.1:${ORCHESTRATOR_PORT}/self-build/intake/${encodeURIComponent(firstIntake.id)}`,
    );
    assert.equal(intakeDetail.status, 200);
    assert.ok(intakeDetail.json.ok);
    assert.equal(intakeDetail.json.detail.id, firstIntake.id);

    const reviewedIntake = await postJson(
      `http://127.0.0.1:${ORCHESTRATOR_PORT}/self-build/intake/${encodeURIComponent(firstIntake.id)}/review`,
      {
        status: "accepted",
        by: "test-runner",
        source: "http-self-build-test",
        comments: "Accept intake item for materialization coverage.",
      },
    );
    assert.equal(reviewedIntake.status, 200);
    assert.ok(reviewedIntake.json.ok);
    assert.equal(reviewedIntake.json.detail.status, "accepted");

    const materializedIntake = await postJson(
      `http://127.0.0.1:${ORCHESTRATOR_PORT}/self-build/intake/${encodeURIComponent(firstIntake.id)}/materialize`,
      {
        by: "test-runner",
        source: "http-self-build-test",
        projectId: "spore",
      },
    );
    assert.equal(materializedIntake.status, 200);
    assert.ok(materializedIntake.json.ok);
    assert.ok(materializedIntake.json.detail);
  }

  const rerun = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/work-item-runs/${encodeURIComponent(runId)}/rerun`,
    {
      stub: true,
      timeout: 12000,
      interval: 250,
      by: "test-rerun",
      source: "http-self-build-test",
      reason: "coverage",
    },
  );
  assert.equal(rerun.status, 200);
  assert.ok(rerun.json.ok);
  assert.equal(rerun.json.detail.rerunOf, runId);
  assert.ok(rerun.json.detail.run.id);

  // Test 13: verify web proxy routes work
  const webSummary = await getJson(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/self-build/summary`,
  );
  assert.equal(webSummary.status, 200);
  assert.ok(webSummary.json.ok);
  assert.ok(webSummary.json.detail);

  const webDashboard = await getJson(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/self-build/dashboard`,
  );
  assert.equal(webDashboard.status, 200);
  assert.ok(webDashboard.json.ok);
  assert.ok(Array.isArray(webDashboard.json.detail.recentWorkItemRuns));
  assert.ok(typeof webDashboard.json.detail.attentionSummary === "object");

  const webTemplates = await getJson(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/work-item-templates`,
  );
  assert.equal(webTemplates.status, 200);
  assert.ok(webTemplates.json.ok);

  const webGoalPlans = await getJson(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/goal-plans`,
  );
  assert.equal(webGoalPlans.status, 200);
  assert.ok(webGoalPlans.json.ok);

  const webGroups = await getJson(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/work-item-groups`,
  );
  assert.equal(webGroups.status, 200);
  assert.ok(webGroups.json.ok);

  const webItems = await getJson(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/work-items`,
  );
  assert.equal(webItems.status, 200);
  assert.ok(webItems.json.ok);

  const webLoopStatus = await getJson(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/self-build/loop/status`,
  );
  assert.equal(webLoopStatus.status, 200);
  assert.ok(webLoopStatus.json.ok);

  const webDecisions = await getJson(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/self-build/decisions`,
  );
  assert.equal(webDecisions.status, 200);
  assert.ok(webDecisions.json.ok);
  assert.ok(Array.isArray(webDecisions.json.detail));

  const webQuarantine = await getJson(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/self-build/quarantine`,
  );
  assert.equal(webQuarantine.status, 200);
  assert.ok(webQuarantine.json.ok);
  assert.ok(Array.isArray(webQuarantine.json.detail));

  const webRollback = await getJson(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/self-build/rollback`,
  );
  assert.equal(webRollback.status, 200);
  assert.ok(webRollback.json.ok);
  assert.ok(Array.isArray(webRollback.json.detail));

  const webLearnings = await getJson(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/self-build/learnings`,
  );
  assert.equal(webLearnings.status, 200);
  assert.ok(webLearnings.json.ok);
  assert.ok(Array.isArray(webLearnings.json.detail));

  const webLearningTrends = await getJson(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/self-build/learning-trends`,
  );
  assert.equal(webLearningTrends.status, 200);
  assert.ok(webLearningTrends.json.ok);
  assert.ok(Array.isArray(webLearningTrends.json.detail));

  const webPolicyRecommendations = await getJson(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/self-build/policy-recommendations`,
  );
  assert.equal(webPolicyRecommendations.status, 200);
  assert.ok(webPolicyRecommendations.json.ok);
  assert.ok(Array.isArray(webPolicyRecommendations.json.detail));

  const webDocSuggestions = await getJson(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/self-build/doc-suggestions?runId=${encodeURIComponent(runId)}`,
  );
  assert.equal(webDocSuggestions.status, 200);
  assert.ok(webDocSuggestions.json.ok);
  assert.ok(Array.isArray(webDocSuggestions.json.detail));

  const webIntake = await getJson(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/self-build/intake`,
  );
  assert.equal(webIntake.status, 200);
  assert.ok(webIntake.json.ok);
  assert.ok(Array.isArray(webIntake.json.detail));

  const webIntegrationBranches = await getJson(
    `http://127.0.0.1:${WEB_PORT}/api/orchestrator/integration-branches`,
  );
  assert.equal(webIntegrationBranches.status, 200);
  assert.ok(webIntegrationBranches.json.ok);
});

test("operator chat routes create governed threads and accept chat-driven approvals", async (t) => {
  const ORCHESTRATOR_PORT = await findFreePort();
  const { dbPath, sessionDbPath, eventLogPath } = withEventLogPath(
    await makeTempPaths("spore-http-operator-chat-"),
  ) as HarnessTempPathsWithEventLog;

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

  const createdThread = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/operator/threads`,
    {
      message:
        "Refresh the self-build onboarding docs and keep the change in safe mode.",
      projectId: "spore",
      safeMode: true,
      stub: true,
      by: "test-runner",
      source: "http-operator-chat-test",
    },
  );
  assert.equal(createdThread.status, 200);
  assert.ok(createdThread.json.ok);
  assert.ok(createdThread.json.detail.id);
  assert.ok(Array.isArray(createdThread.json.detail.messages));
  assert.ok(Array.isArray(createdThread.json.detail.pendingActions));
  assert.ok(
    createdThread.json.detail.pendingActions.some(
      (action) => action.actionKind === "goal-plan-review",
    ),
  );
  assertThreadUxProjection(asObject(createdThread.json.detail), {
    currentStage: "plan_approval",
    currentState: "plan_approval",
    exceptionState: null,
    statusLineIncludes: /approval before i start/i,
    suggestedReplies: "non-empty",
    expectDistinctTitle: true,
  });

  const threadId = createdThread.json.detail.id;

  const streamController = new AbortController();
  const streamResponse = await fetch(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/operator/threads/${encodeURIComponent(threadId)}/stream`,
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
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/operator/threads`,
  );
  assert.equal(threadList.status, 200);
  assert.ok(threadList.json.ok);
  assert.ok(Array.isArray(threadList.json.detail));
  assert.ok(threadList.json.detail.some((entry) => entry.id === threadId));

  const globalPending = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/operator/actions`,
  );
  assert.equal(globalPending.status, 200);
  assert.ok(globalPending.json.ok);
  assert.ok(
    globalPending.json.detail.some((entry) => entry.threadId === threadId),
  );
  const goalPlanReviewAction = globalPending.json.detail.find(
    (entry) =>
      entry.threadId === threadId && entry.actionKind === "goal-plan-review",
  );
  assert.ok(goalPlanReviewAction);
  assertInboxActionProjection(goalPlanReviewAction, "goal-plan-review", {
    suggestedReplies: "non-empty",
    threadTitle: createdThread.json.detail.title,
    objective: createdThread.json.detail.summary.objective,
  });

  const editedThread = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/operator/threads/${encodeURIComponent(threadId)}/messages`,
    {
      message: "keep only docs",
      by: "test-runner",
      source: "http-operator-chat-test",
    },
  );
  assert.equal(editedThread.status, 200);
  assert.ok(editedThread.json.ok);
  assert.equal(
    editedThread.json.detail.context.goalPlan.recommendations.length,
    1,
  );
  assert.equal(
    editedThread.json.detail.context.goalPlan.recommendations[0].metadata
      .templateId,
    "docs-maintenance-pass",
  );

  const statusReply = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/operator/threads/${encodeURIComponent(threadId)}/messages`,
    {
      message: "status",
      by: "test-runner",
      source: "http-operator-chat-test",
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

  const approvedViaChat = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/operator/threads/${encodeURIComponent(threadId)}/messages`,
    {
      message: "approve",
      by: "test-runner",
      source: "http-operator-chat-test",
    },
  );
  assert.equal(approvedViaChat.status, 200);
  assert.ok(approvedViaChat.json.ok);
  assert.ok(
    approvedViaChat.json.detail.actionHistory.some(
      (action) =>
        action.actionKind === "goal-plan-review" &&
        ["resolved", "superseded"].includes(String(action.status)),
    ),
  );
  assert.ok(approvedViaChat.json.detail.context.goalPlan);
  assert.ok(
    [
      "reviewed",
      "materialized",
      "running",
      "completed",
      "blocked",
      "waiting_operator",
    ].includes(String(approvedViaChat.json.detail.status)),
  );

  const pendingActions = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/operator/actions?threadId=${encodeURIComponent(threadId)}`,
  );
  assert.equal(pendingActions.status, 200);
  assert.ok(pendingActions.json.ok);
  assert.ok(Array.isArray(pendingActions.json.detail));
});

test("operator chat supports proposal rework and quarantine release flows", async (t) => {
  const ORCHESTRATOR_PORT = await findFreePort();
  const { dbPath, sessionDbPath, eventLogPath } = withEventLogPath(
    await makeTempPaths("spore-http-operator-chat-advanced-"),
  ) as HarnessTempPathsWithEventLog;

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

  async function waitForThread(threadId, predicate) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const payload = await getJson(
        `http://127.0.0.1:${ORCHESTRATOR_PORT}/operator/threads/${encodeURIComponent(threadId)}`,
      );
      assert.equal(payload.status, 200);
      if (predicate(payload.json.detail)) {
        return payload.json.detail;
      }
      await sleep(200);
    }
    throw new Error(`thread ${threadId} did not reach expected state in time`);
  }

  function setProposalPromotionReady(proposalId) {
    const db = openOrchestratorDatabase(dbPath);
    try {
      const proposal = getProposalArtifact(db, proposalId);
      assert.ok(proposal);
      const updatedAt = new Date().toISOString();
      const promotion = asObject(asObject(proposal.metadata).promotion);
      const validation = asObject(asObject(proposal.metadata).validation);
      updateProposalArtifact(db, {
        ...proposal,
        status: "promotion_ready",
        updatedAt,
        metadata: {
          ...asObject(proposal.metadata),
          validation: {
            ...validation,
            status: "completed",
            summary: "Validation bundles succeeded for operator chat coverage.",
          },
          promotion: {
            ...promotion,
            status: "promotion_ready",
            blockers: [],
            sourceExecutionId:
              String(promotion.sourceExecutionId ?? "").trim() ||
              "execution:operator-chat-test",
            integrationBranch:
              String(promotion.integrationBranch ?? "").trim() ||
              "spore/test/operator-chat-promotion",
            updatedAt,
          },
        },
      });
    } finally {
      db.close();
    }
  }

  function setProposalPromotionCandidate(proposalId) {
    const db = openOrchestratorDatabase(dbPath);
    try {
      const proposal = getProposalArtifact(db, proposalId);
      assert.ok(proposal);
      const updatedAt = new Date().toISOString();
      const promotion = asObject(asObject(proposal.metadata).promotion);
      updateProposalArtifact(db, {
        ...proposal,
        status: "promotion_candidate",
        updatedAt,
        metadata: {
          ...asObject(proposal.metadata),
          promotion: {
            ...promotion,
            status: "promotion_candidate",
            blockers: [],
            updatedAt,
          },
        },
      });
    } finally {
      db.close();
    }
  }

  const reworkThread = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/operator/threads`,
    {
      message:
        "Improve the operator web dashboard for self-build review and keep the work in safe mode.",
      projectId: "spore",
      safeMode: true,
      stub: true,
      by: "test-runner",
      source: "http-operator-chat-test",
    },
  );
  assert.equal(reworkThread.status, 200);
  const reworkThreadId = reworkThread.json.detail.id;

  await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/operator/threads/${encodeURIComponent(reworkThreadId)}/messages`,
    {
      message: "approve",
      by: "test-runner",
      source: "http-operator-chat-test",
    },
  );

  const reviewPending = await waitForThread(
    reworkThreadId,
    (detail) =>
      Array.isArray(detail.pendingActions) &&
      detail.pendingActions.some(
        (action) => action.actionKind === "proposal-review",
      ),
  );
  assert.ok(
    reviewPending.pendingActions.some(
      (action) => action.actionKind === "proposal-review",
    ),
  );
  assertThreadUxProjection(asObject(reviewPending), {
    currentStage: "proposal_review",
    currentState: "proposal_review",
    exceptionState: null,
    statusLineIncludes: /proposal review/i,
    suggestedReplies: "empty",
    expectDistinctTitle: true,
  });
  const reviewPendingInbox = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/operator/actions?threadId=${encodeURIComponent(reworkThreadId)}`,
  );
  assert.equal(reviewPendingInbox.status, 200);
  const proposalReviewAction = reviewPendingInbox.json.detail.find(
    (action) => action.actionKind === "proposal-review",
  );
  assert.ok(proposalReviewAction);
  assertInboxActionProjection(proposalReviewAction, "proposal-review", {
    suggestedReplies: "empty",
    threadTitle: reviewPending.title,
    objective: asObject(reviewPending.summary).objective as string,
  });

  await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/operator/threads/${encodeURIComponent(reworkThreadId)}/messages`,
    {
      message: "reject",
      by: "test-runner",
      source: "http-operator-chat-test",
    },
  );

  const reworkPending = await waitForThread(
    reworkThreadId,
    (detail) =>
      Array.isArray(detail.pendingActions) &&
      detail.pendingActions.some(
        (action) => action.actionKind === "proposal-rework",
      ),
  );
  assert.ok(
    reworkPending.pendingActions.some(
      (action) => action.actionKind === "proposal-rework",
    ),
  );
  assertThreadUxProjection(asObject(reworkPending), {
    currentStage: "proposal_review",
    currentState: "rework",
    exceptionState: "rework",
    statusLineIncludes: /rework/i,
    suggestedReplies: "empty",
    expectDistinctTitle: true,
  });
  const reworkPendingInbox = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/operator/actions?threadId=${encodeURIComponent(reworkThreadId)}`,
  );
  assert.equal(reworkPendingInbox.status, 200);
  const proposalReworkAction = reworkPendingInbox.json.detail.find(
    (action) => action.actionKind === "proposal-rework",
  );
  assert.ok(proposalReworkAction);
  assertInboxActionProjection(proposalReworkAction, "proposal-rework", {
    suggestedReplies: "empty",
    threadTitle: reworkPending.title,
    objective: asObject(reworkPending.summary).objective as string,
  });

  const reworked = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/operator/threads/${encodeURIComponent(reworkThreadId)}/messages`,
    {
      message: "rework",
      by: "test-runner",
      source: "http-operator-chat-test",
    },
  );
  assert.equal(reworked.status, 200);
  assert.ok(reworked.json.ok);
  assert.ok(
    reworked.json.detail.messages.some((message) =>
      String(message.content).includes("Created rework item"),
    ),
  );

  const quarantineThread = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/operator/threads`,
    {
      message:
        "Improve the operator web dashboard for integration promotion review and keep the work in safe mode.",
      projectId: "spore",
      safeMode: true,
      stub: true,
      by: "test-runner",
      source: "http-operator-chat-test",
    },
  );
  assert.equal(quarantineThread.status, 200);
  const quarantineThreadId = quarantineThread.json.detail.id;

  await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/operator/threads/${encodeURIComponent(quarantineThreadId)}/messages`,
    {
      message: "approve",
      by: "test-runner",
      source: "http-operator-chat-test",
    },
  );

  await waitForThread(
    quarantineThreadId,
    (detail) =>
      Array.isArray(detail.pendingActions) &&
      detail.pendingActions.some(
        (action) => action.actionKind === "proposal-review",
      ),
  );

  await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/operator/threads/${encodeURIComponent(quarantineThreadId)}/messages`,
    {
      message: "reject",
      by: "test-runner",
      source: "http-operator-chat-test",
    },
  );

  await waitForThread(
    quarantineThreadId,
    (detail) =>
      Array.isArray(detail.pendingActions) &&
      detail.pendingActions.some(
        (action) => action.actionKind === "proposal-rework",
      ),
  );

  await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/operator/threads/${encodeURIComponent(quarantineThreadId)}/messages`,
    {
      message: "quarantine",
      by: "test-runner",
      source: "http-operator-chat-test",
    },
  );

  const releasePending = await waitForThread(
    quarantineThreadId,
    (detail) =>
      Array.isArray(detail.pendingActions) &&
      detail.pendingActions.some(
        (action) => action.actionKind === "quarantine-release",
      ),
  );
  assert.ok(releasePending.context.activeQuarantine);
  assertThreadUxProjection(asObject(releasePending), {
    currentStage: "proposal_review",
    currentState: "quarantined",
    exceptionState: "quarantined",
    statusLineIncludes: /quarantined/i,
    suggestedReplies: "empty",
    expectDistinctTitle: true,
  });
  const quarantinePendingInbox = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/operator/actions?threadId=${encodeURIComponent(quarantineThreadId)}`,
  );
  assert.equal(quarantinePendingInbox.status, 200);
  const quarantineReleaseAction = quarantinePendingInbox.json.detail.find(
    (action) => action.actionKind === "quarantine-release",
  );
  assert.ok(quarantineReleaseAction);
  assertInboxActionProjection(quarantineReleaseAction, "quarantine-release", {
    suggestedReplies: "empty",
    threadTitle: releasePending.title,
    objective: asObject(releasePending.summary).objective as string,
  });

  const released = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/operator/threads/${encodeURIComponent(quarantineThreadId)}/messages`,
    {
      message: "release",
      by: "test-runner",
      source: "http-operator-chat-test",
    },
  );
  assert.equal(released.status, 200);
  assert.ok(released.json.ok);
  assert.equal(released.json.detail.context.activeQuarantine, null);

  const promotionThread = await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/operator/threads`,
    {
      message:
        "Improve the operator web dashboard for proposal promotion readiness and keep the work in safe mode.",
      projectId: "spore",
      safeMode: true,
      stub: true,
      by: "test-runner",
      source: "http-operator-chat-test",
    },
  );
  assert.equal(promotionThread.status, 200);
  const promotionThreadId = promotionThread.json.detail.id;

  await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/operator/threads/${encodeURIComponent(promotionThreadId)}/messages`,
    {
      message: "approve",
      by: "test-runner",
      source: "http-operator-chat-test",
    },
  );

  await waitForThread(
    promotionThreadId,
    (detail) =>
      Array.isArray(detail.pendingActions) &&
      detail.pendingActions.some(
        (action) => action.actionKind === "proposal-review",
      ),
  );

  await postJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/operator/threads/${encodeURIComponent(promotionThreadId)}/messages`,
    {
      message: "reviewed",
      by: "test-runner",
      source: "http-operator-chat-test",
    },
  );

  const approvalPending = await waitForThread(
    promotionThreadId,
    (detail) =>
      Array.isArray(detail.pendingActions) &&
      detail.pendingActions.some(
        (action) => action.actionKind === "proposal-approval",
      ),
  );
  assertThreadUxProjection(asObject(approvalPending), {
    currentStage: "proposal_approval",
    currentState: "proposal_approval",
    exceptionState: null,
    statusLineIncludes: /needs approval/i,
    suggestedReplies: "empty",
    expectDistinctTitle: true,
  });
  const approvalPendingInbox = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/operator/actions?threadId=${encodeURIComponent(promotionThreadId)}`,
  );
  assert.equal(approvalPendingInbox.status, 200);
  const proposalApprovalAction = approvalPendingInbox.json.detail.find(
    (action) => action.actionKind === "proposal-approval",
  );
  assert.ok(proposalApprovalAction);
  assertInboxActionProjection(proposalApprovalAction, "proposal-approval", {
    suggestedReplies: "empty",
    threadTitle: approvalPending.title,
    objective: asObject(approvalPending.summary).objective as string,
  });

  const promotionProposalId = String(
    asObject(approvalPending.context).proposal
      ? asObject(asObject(approvalPending.context).proposal).id
      : "",
  );
  assert.ok(promotionProposalId);
  setProposalPromotionReady(promotionProposalId);

  const promotionPending = await waitForThread(
    promotionThreadId,
    (detail) =>
      Array.isArray(detail.pendingActions) &&
      detail.pendingActions.some(
        (action) => action.actionKind === "proposal-promotion",
      ),
  );
  assertThreadUxProjection(asObject(promotionPending), {
    currentStage: "promotion",
    currentState: "promotion",
    exceptionState: null,
    statusLineIncludes: /promot/i,
    suggestedReplies: "empty",
    expectDistinctTitle: true,
  });
  const promotionPendingInbox = await getJson(
    `http://127.0.0.1:${ORCHESTRATOR_PORT}/operator/actions?threadId=${encodeURIComponent(promotionThreadId)}`,
  );
  assert.equal(promotionPendingInbox.status, 200);
  const proposalPromotionAction = promotionPendingInbox.json.detail.find(
    (action) => action.actionKind === "proposal-promotion",
  );
  assert.ok(proposalPromotionAction);
  assertInboxActionProjection(proposalPromotionAction, "proposal-promotion", {
    suggestedReplies: "empty",
    threadTitle: promotionPending.title,
    objective: asObject(promotionPending.summary).objective as string,
  });

  setProposalPromotionCandidate(promotionProposalId);

  const completedThread = await waitForThread(
    promotionThreadId,
    (detail) => asObject(detail.progress).exceptionState === "completed",
  );
  assertThreadUxProjection(asObject(completedThread), {
    currentStage: "promotion",
    currentState: "completed",
    exceptionState: "completed",
    statusLineIncludes: /completed|promotion launched/i,
    suggestedReplies: "empty",
    expectDistinctTitle: true,
  });
});
