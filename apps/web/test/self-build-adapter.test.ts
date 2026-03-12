import assert from "node:assert/strict";
import test from "node:test";

import {
  adaptMissionEvidenceDetail,
  adaptSelfBuildOverview,
  buildEvidenceHref,
  resolveMissionEvidenceTargetFromArtifact,
  resolveMissionEvidenceTargetFromThreadEvidence,
} from "../src/adapters/self-build.js";

test("buildEvidenceHref preserves evidence kind and subject context", () => {
  assert.equal(
    buildEvidenceHref({
      kind: "promotion",
      id: "spore/integration/docs",
      subject: "branch",
    }),
    "/evidence/promotion/spore%2Fintegration%2Fdocs?subject=branch",
  );
  assert.equal(
    buildEvidenceHref({ kind: "proposal", id: "proposal-1" }),
    "/evidence/proposal/proposal-1",
  );
});

test("adaptSelfBuildOverview turns real self-build payloads into drilldown-ready dashboard models", () => {
  const overview = adaptSelfBuildOverview({
    summary: {
      overview: {
        urgentCount: 2,
        followUpCount: 3,
        generatedAt: "2026-03-12T10:15:00.000Z",
      },
      freshness: {
        lastRefresh: "2026-03-12T10:15:00.000Z",
      },
      counts: {
        workItems: 6,
        groups: 2,
        pendingDocSuggestions: 1,
        validationRequiredProposals: 2,
        proposalsBlockedForPromotion: 1,
        integrationBranches: 1,
        orphanedWorkspaces: 1,
      },
      waitingReviewProposals: [
        {
          id: "proposal-review-1",
          title: "Proposal waiting review",
          status: "ready_for_review",
          summary: "Operator review is required before validation can begin.",
        },
      ],
      validationRequiredProposals: [
        {
          id: "proposal-validate-1",
          title: "Docs polish proposal",
          status: "validation_required",
          summary: "Validation is required before promotion readiness can be computed.",
        },
      ],
      proposalsBlockedForPromotion: [
        {
          id: "proposal-promote-1",
          title: "Promotion blocked proposal",
          status: "promotion_blocked",
          summary: "Validation blockers are still active.",
          promotionStatus: "blocked",
        },
      ],
      recentWorkItemRuns: [
        {
          id: "run-1",
          itemTitle: "Docs verification",
          status: "completed",
          validationStatus: "passed",
          hasProposal: true,
          hasWorkspace: true,
          comparisonToPrevious: {
            summary: "Stable against the previous run.",
          },
        },
      ],
      workspaces: [
        {
          id: "workspace-1",
          branchName: "spore/docs/polish",
          status: "active",
          workItemId: "item-1",
          worktreePath: "/tmp/spore/docs-publish",
        },
      ],
      integrationBranches: [
        {
          name: "spore/integration/docs-polish",
          status: "blocked",
          targetBranch: "main",
          proposalArtifactId: "proposal-promote-1",
          diagnostics: {
            issues: [{ reason: "Regression report still failing." }],
          },
        },
      ],
      groups: [
        {
          id: "group-1",
          title: "Docs group",
          status: "running",
          readiness: {
            headlineState: "blocked",
            preRunSummary: {
              label: "1 item is blocked on review.",
            },
            counts: {
              ready: 1,
              blocked: 1,
              reviewNeeded: 1,
            },
          },
        },
      ],
      attentionSummary: {
        total: 4,
        byState: {
          blocked: 1,
          validation_required: 2,
        },
      },
      lifecycle: {
        blockedPromotions: 1,
        pendingValidations: 2,
      },
    },
    dashboard: {
      attentionSummary: {
        total: 4,
      },
      queueSummary: {
        total: 5,
      },
      lifecycle: {
        blockedPromotions: 1,
        pendingValidations: 2,
        activeAutonomousRuns: 0,
        quarantinedWork: 0,
        protectedTierOverrides: 0,
        policyRecommendationQueue: 0,
      },
      recentWorkItemRuns: [
        {
          id: "run-1",
          itemTitle: "Docs verification",
          status: "completed",
          validationStatus: "passed",
          hasProposal: true,
          hasWorkspace: true,
        },
      ],
    },
  });

  assert.equal(overview.hero.title, "Self-Build");
  assert.equal(overview.stats[0]?.label, "Work Items");
  assert.equal(overview.proposalQueues[0]?.href, "/evidence/proposal/proposal-review-1");
  assert.equal(
    overview.proposalQueues.find((entry) => entry.id === "proposal-promote-1")?.href,
    "/evidence/promotion/spore%2Fintegration%2Fdocs-polish?subject=branch",
  );
  assert.equal(
    overview.validationRuns[0]?.href,
    "/evidence/validation/run-1?subject=run",
  );
  assert.equal(
    overview.workspaceResources[0]?.href,
    "/evidence/workspace/workspace-1?subject=workspace",
  );
  assert.equal(
    overview.workspaceResources[1]?.href,
    "/evidence/promotion/spore%2Fintegration%2Fdocs-polish?subject=branch",
  );
  assert.match(overview.groups[0]?.summary ?? "", /blocked on review/i);
});

test("resolveMissionEvidenceTarget helpers translate operator evidence into drilldowns", () => {
  assert.deepEqual(
    resolveMissionEvidenceTargetFromArtifact({
      itemType: "integration-branch",
      itemId: "spore/integration/docs-polish",
    }),
    {
      kind: "promotion",
      id: "spore/integration/docs-polish",
      subject: "branch",
    },
  );

  assert.deepEqual(
    resolveMissionEvidenceTargetFromThreadEvidence("validation", {
      id: "validation-1",
      targetType: "work-item-run",
      targetId: "run-1",
      status: "pending",
    }),
    {
      kind: "validation",
      id: "run-1",
      subject: "run",
    },
  );
});

test("adaptMissionEvidenceDetail preserves proposal, validation, promotion, and workspace context", () => {
  const detail = adaptMissionEvidenceDetail({
    kind: "validation",
    id: "run-1",
    subject: "run",
    run: {
      id: "run-1",
      status: "completed",
      validationStatus: "passed",
      comparisonToPrevious: {
        summary: "No regressions compared with the previous run.",
      },
      proposal: {
        id: "proposal-1",
        title: "Docs proposal",
        status: "validation_required",
      },
      workspace: {
        id: "workspace-1",
        branchName: "spore/docs/polish",
        status: "active",
      },
      validation: {
        status: "passed",
        summary: "proposal-ready-fast and integration-ready-core passed",
        scenarioRunIds: ["scenario-1"],
        regressionRunIds: ["regression-1"],
      },
      docSuggestions: [{ id: "doc-1", title: "Update roadmap note" }],
      failure: null,
      suggestedActions: [{ action: "promote", reason: "Validation is green." }],
      links: {
        scenarioRun: "/scenario-runs/scenario-1",
        regressionRun: "/regression-runs/regression-1",
      },
      relationSummary: {
        scenarioRunId: "scenario-1",
        regressionRunId: "regression-1",
      },
    },
    proposalReviewPackage: {
      proposal: {
        id: "proposal-1",
        status: "validation_required",
      },
      readiness: {
        ready: false,
        blockers: [{ code: "validation_required" }],
      },
      promotion: {
        integrationBranch: "spore/integration/docs-polish",
        status: "blocked",
      },
    },
    workspace: {
      id: "workspace-1",
      status: "active",
      branchName: "spore/docs/polish",
      worktreePath: "/tmp/spore/docs-publish",
    },
    scenarioRun: {
      run: {
        id: "scenario-1",
        status: "passed",
      },
    },
    regressionRun: {
      run: {
        id: "regression-1",
        status: "passed",
      },
    },
    regressionReport: {
      report: {
        summary: "All regressions passed.",
      },
    },
  });

  assert.equal(detail.kind, "validation");
  assert.equal(detail.title, "Validation Evidence");
  assert.equal(detail.status, "passed");
  assert.ok(detail.relatedLinks.some((link) => link.href === "/evidence/proposal/proposal-1"));
  assert.ok(
    detail.relatedLinks.some(
      (link) => link.href === "/evidence/workspace/workspace-1?subject=workspace",
    ),
  );
  assert.ok(
    detail.relatedLinks.some(
      (link) =>
        link.href === "/evidence/promotion/spore%2Fintegration%2Fdocs-polish?subject=branch",
    ),
  );
  assert.ok(detail.sections.some((section) => section.title === "Validation Summary"));
  assert.ok(detail.sections.some((section) => section.title === "Workspace Context"));
  assert.ok(detail.sections.some((section) => section.title === "Promotion Context"));
  assert.ok(detail.sections.some((section) => section.title === "Regression Evidence"));
});

test("adaptMissionEvidenceDetail keeps validation and workspace context on proposal drilldowns", () => {
  const detail = adaptMissionEvidenceDetail({
    kind: "proposal",
    id: "proposal-1",
    proposal: {
      id: "proposal-1",
      title: "Docs proposal",
      status: "validation_required",
    },
    run: {
      id: "run-1",
      status: "completed",
      validationStatus: "passed",
      comparisonToPrevious: {
        summary: "No regressions compared with the previous run.",
      },
      workspace: {
        id: "workspace-1",
        branchName: "spore/docs/polish",
        status: "active",
      },
      validation: {
        status: "passed",
        summary: "proposal-ready-fast passed",
      },
    },
    proposalReviewPackage: {
      proposal: {
        id: "proposal-1",
        title: "Docs proposal",
        status: "validation_required",
      },
      readiness: {
        ready: false,
        blockers: [{ code: "validation_required" }],
      },
      promotion: {
        integrationBranch: "spore/integration/docs-polish",
        status: "blocked",
      },
    },
    workspace: {
      id: "workspace-1",
      status: "active",
      branchName: "spore/docs/polish",
      worktreePath: "/tmp/spore/docs-publish",
    },
    integrationBranch: {
      name: "spore/integration/docs-polish",
      status: "blocked",
      targetBranch: "main",
    },
  });

  assert.ok(detail.relatedLinks.some((link) => link.href === "/evidence/proposal/proposal-1"));
  assert.ok(
    detail.relatedLinks.some(
      (link) => link.href === "/evidence/workspace/workspace-1?subject=workspace",
    ),
  );
  assert.ok(
    detail.relatedLinks.some(
      (link) =>
        link.href === "/evidence/promotion/spore%2Fintegration%2Fdocs-polish?subject=branch",
    ),
  );
  assert.ok(detail.sections.some((section) => section.title === "Validation Context"));
  assert.ok(detail.sections.some((section) => section.title === "Workspace Context"));
});

test("adaptMissionEvidenceDetail keeps proposal and promotion context on workspace drilldowns", () => {
  const detail = adaptMissionEvidenceDetail({
    kind: "workspace",
    id: "workspace-1",
    subject: "workspace",
    workspace: {
      id: "workspace-1",
      status: "active",
      branchName: "spore/docs/polish",
      worktreePath: "/tmp/spore/docs-publish",
      workItemRunId: "run-1",
      proposalArtifactId: "proposal-1",
      trace: {
        allocation: {
          decision: "created",
          summary: "Created a safe-mode workspace for the run.",
          reasons: ["safe mode", "proposal artifacts available"],
        },
      },
    },
    run: {
      id: "run-1",
      status: "completed",
      validationStatus: "passed",
      proposal: {
        id: "proposal-1",
        title: "Docs proposal",
        status: "validation_required",
      },
    },
    proposal: {
      id: "proposal-1",
      title: "Docs proposal",
      status: "validation_required",
    },
    proposalReviewPackage: {
      proposal: {
        id: "proposal-1",
        title: "Docs proposal",
        status: "validation_required",
      },
      readiness: {
        ready: false,
        blockers: [{ code: "validation_required" }],
      },
      promotion: {
        integrationBranch: "spore/integration/docs-polish",
        status: "blocked",
      },
    },
    integrationBranch: {
      name: "spore/integration/docs-polish",
      status: "blocked",
      targetBranch: "main",
      proposalArtifactId: "proposal-1",
    },
  });

  assert.ok(detail.relatedLinks.some((link) => link.href === "/evidence/proposal/proposal-1"));
  assert.ok(
    detail.relatedLinks.some(
      (link) =>
        link.href === "/evidence/promotion/spore%2Fintegration%2Fdocs-polish?subject=branch",
    ),
  );
  assert.ok(detail.sections.some((section) => section.title === "Proposal Context"));
  assert.ok(detail.sections.some((section) => section.title === "Promotion Context"));
});
