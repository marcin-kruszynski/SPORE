import {
  asArray,
  asRecord,
  humanize,
  toText,
} from "./adapter-utils.js";
import {
  buildEvidenceHref,
  resolveMissionEvidenceTargetFromArtifact,
  resolveMissionEvidenceTargetFromThreadEvidence,
} from "./evidence-links.js";
import type {
  MissionEvidenceAdapterInput,
  MissionEvidenceDetailModel,
  MissionEvidenceKind,
  MissionEvidenceSubject,
  MissionEvidenceTarget,
  SelfBuildApiDashboard,
  SelfBuildApiIntegrationBranchSummary,
  SelfBuildApiProposalQueueEntry,
  SelfBuildApiRecentRunSummary,
  SelfBuildApiSummary,
  SelfBuildApiWorkspaceSummary,
  SelfBuildOverviewModel,
} from "../types/self-build.js";

export {
  buildEvidenceHref,
  resolveMissionEvidenceTargetFromArtifact,
  resolveMissionEvidenceTargetFromThreadEvidence,
} from "./evidence-links.js";

function toCount(value: unknown): number {
  const count = Number(value ?? 0);
  return Number.isFinite(count) ? count : 0;
}

function formatTimestamp(value: unknown): string {
  const text = toText(value, "");
  if (!text) {
    return "Not yet refreshed";
  }

  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) {
    return text;
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(parsed));
}

function formatBoolean(value: unknown, truthy = "Yes", falsy = "No"): string {
  return value === true ? truthy : value === false ? falsy : "-";
}

function joinDefined(values: Array<string | null | undefined>, fallback = "-"): string {
  const parts = values.map((value) => toText(value, "")).filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : fallback;
}

function dedupeById<T extends { id: string }>(entries: T[]): T[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) {
      return false;
    }
    seen.add(entry.id);
    return true;
  });
}

function adaptProposalQueueEntry(
  entry: SelfBuildApiProposalQueueEntry,
  target: MissionEvidenceTarget,
  evidenceLabel: string,
) {
  const id = toText(entry.id, "");
  return {
    id,
    title: toText(entry.title, id || "Proposal"),
    status:
      toText(entry.promotionStatus, "") ||
      toText(entry.status, "pending"),
    summary: toText(entry.summary, "Open the evidence drilldown for full governance context."),
    href: buildEvidenceHref(target),
    evidenceLabel,
  };
}

function resolvePromotionQueueTarget(input: {
  entry: SelfBuildApiProposalQueueEntry;
  integrationBranchesByProposalId: Map<string, string>;
}): MissionEvidenceTarget {
  const proposalId = toText(input.entry.id, "");
  const branchName =
    toText(input.entry.promotion?.integrationBranch, "") ||
    input.integrationBranchesByProposalId.get(proposalId) ||
    "";

  if (branchName) {
    return { kind: "promotion", id: branchName, subject: "branch" };
  }

  return { kind: "proposal", id: proposalId };
}

function adaptRunSummary(run: SelfBuildApiRecentRunSummary) {
  const runId = toText(run.id, "");
  return {
    id: runId,
    title: toText(run.itemTitle, runId || "Validation run"),
    status: toText(run.status, toText(run.terminalKind, "unknown")),
    summary: toText(
      run.comparisonToPrevious?.summary,
      "Open the validation drilldown for proposal, readiness, and report evidence.",
    ),
    meta: joinDefined(
      [
        toText(run.itemKind, "work-item"),
        toText(run.validationStatus, "") ? `validation:${toText(run.validationStatus, "")}` : "",
        run.hasProposal ? "proposal" : "",
        run.hasWorkspace ? "workspace" : "",
      ],
      "work-item",
    ),
    href: buildEvidenceHref({ kind: "validation", id: runId, subject: "run" }),
  };
}

function adaptWorkspaceResource(workspace: SelfBuildApiWorkspaceSummary) {
  const workspaceId = toText(workspace.id, "");
  return {
    id: workspaceId,
    title: toText(workspace.branchName, workspaceId || "Workspace"),
    status: toText(workspace.status, "unknown"),
    summary: toText(workspace.worktreePath, "No worktree path is available for this workspace yet."),
    meta: joinDefined(
      [
        toText(workspace.status, "unknown"),
        toText(workspace.workItemId, "") ? `item:${toText(workspace.workItemId, "")}` : "",
        workspace.safeMode === true ? "safe-mode" : "",
      ],
      toText(workspace.status, "unknown"),
    ),
    href: buildEvidenceHref({
      kind: "workspace",
      id: workspaceId,
      subject: "workspace",
    }),
  };
}

function adaptIntegrationBranchResource(branch: SelfBuildApiIntegrationBranchSummary) {
  const branchName = toText(branch.name, "");
  return {
    id: branchName,
    title: branchName || "Integration branch",
    status: toText(branch.status, "unknown"),
    summary: toText(
      asArray(branch.diagnostics?.issues)
        .map((issue) => toText(issue.reason, ""))
        .filter(Boolean)
        .join(" · "),
      toText(branch.reason, "Integration branch promotion evidence is available."),
    ),
    meta: joinDefined(
      [
        toText(branch.status, "unknown"),
        toText(branch.targetBranch, "") ? `target:${toText(branch.targetBranch, "")}` : "",
        toText(branch.proposalArtifactId, "")
          ? `proposal:${toText(branch.proposalArtifactId, "")}`
          : "",
      ],
      toText(branch.status, "unknown"),
    ),
    href: buildEvidenceHref({ kind: "promotion", id: branchName, subject: "branch" }),
  };
}

export function adaptSelfBuildOverview(input: {
  summary: SelfBuildApiSummary;
  dashboard: SelfBuildApiDashboard;
}): SelfBuildOverviewModel {
  const { summary, dashboard } = input;
  const counts = summary.counts ?? {};
  const lifecycle = summary.lifecycle ?? dashboard.lifecycle ?? {};
  const attention = summary.attentionSummary ?? dashboard.attentionSummary ?? {};
  const queue = summary.queueSummary ?? dashboard.queueSummary ?? {};
  const integrationBranchesByProposalId = new Map(
    asArray(summary.integrationBranches)
      .map((branch) => {
        const proposalId = toText(branch.proposalArtifactId, "");
        const branchName = toText(branch.name, "");
        return proposalId && branchName ? ([proposalId, branchName] as const) : null;
      })
      .filter((entry): entry is readonly [string, string] => Boolean(entry)),
  );

  const proposalQueues = dedupeById([
    ...asArray(summary.waitingReviewProposals).map((entry) =>
      adaptProposalQueueEntry(entry, { kind: "proposal", id: toText(entry.id, "") }, "Proposal evidence"),
    ),
    ...asArray(summary.waitingApprovalProposals).map((entry) =>
      adaptProposalQueueEntry(entry, { kind: "proposal", id: toText(entry.id, "") }, "Proposal evidence"),
    ),
    ...asArray(summary.validationRequiredProposals).map((entry) =>
      adaptProposalQueueEntry(entry, { kind: "proposal", id: toText(entry.id, "") }, "Proposal evidence"),
    ),
    ...asArray(summary.proposalsBlockedForPromotion).map((entry) => {
      const target = resolvePromotionQueueTarget({
        entry,
        integrationBranchesByProposalId,
      });
      return adaptProposalQueueEntry(
        entry,
        target,
        target.kind === "promotion" ? "Promotion evidence" : "Proposal evidence",
      );
    }),
  ].filter((entry) => entry.id));

  const validationRuns = asArray(
    dashboard.recentWorkItemRuns ?? summary.recentWorkItemRuns,
  )
    .map(adaptRunSummary)
    .filter((entry) => entry.id);

  const workspaceResources = [
    ...asArray(summary.workspaces).map(adaptWorkspaceResource),
    ...asArray(summary.integrationBranches).map(adaptIntegrationBranchResource),
  ].filter((entry) => entry.id);

  const groups = asArray(summary.groups)
    .map((group) => {
      const groupId = toText(group.id, "");
      const readiness = group.readiness ?? {};
      const readinessCounts = readiness.counts ?? {};
      return {
        id: groupId,
        title: toText(group.title, groupId || "Managed work group"),
        status: toText(readiness.headlineState, toText(group.status, "pending")),
        summary: toText(
          readiness.preRunSummary?.label,
          "No readiness summary is available for this group yet.",
        ),
        meta: joinDefined(
          [
            `ready:${toCount(readinessCounts.ready)}`,
            `blocked:${toCount(readinessCounts.blocked)}`,
            `review:${toCount(readinessCounts.reviewNeeded)}`,
          ],
          "No readiness counts available",
        ),
      };
    })
    .filter((entry) => entry.id);

  return {
    hero: {
      title: "Self-Build",
      subtitle: "Real-backed governance, validation, promotion, and workspace evidence.",
      freshnessLabel: `Last updated ${formatTimestamp(
        summary.freshness?.lastRefresh ?? summary.overview?.generatedAt,
      )}`,
      routeStateLabel: `Attention ${toCount(attention.total)} · Queue ${toCount(queue.total)}`,
    },
    stats: [
      { label: "Work Items", value: String(toCount(counts.workItems)), highlight: false },
      { label: "Groups", value: String(toCount(counts.groups)), highlight: false },
      {
        label: "Blocked Promotions",
        value: String(toCount(lifecycle.blockedPromotions)),
        highlight: toCount(lifecycle.blockedPromotions) > 0,
      },
      {
        label: "Pending Validations",
        value: String(toCount(lifecycle.pendingValidations)),
        highlight: toCount(lifecycle.pendingValidations) > 0,
      },
      {
        label: "Workspace Problems",
        value: String(toCount(counts.orphanedWorkspaces)),
        highlight: toCount(counts.orphanedWorkspaces) > 0,
      },
      {
        label: "Integration Branches",
        value: String(toCount(counts.integrationBranches)),
        highlight: toCount(counts.integrationBranches) > 0,
      },
    ],
    attentionCards: [
      {
        label: "Urgent",
        value: String(toCount(summary.overview?.urgentCount)),
        highlight: toCount(summary.overview?.urgentCount) > 0,
      },
      {
        label: "Follow Up",
        value: String(toCount(summary.overview?.followUpCount)),
        highlight: toCount(summary.overview?.followUpCount) > 0,
      },
      {
        label: "Validation Required",
        value: String(toCount(counts.validationRequiredProposals)),
        highlight: toCount(counts.validationRequiredProposals) > 0,
      },
      {
        label: "Doc Suggestions",
        value: String(toCount(counts.pendingDocSuggestions)),
        highlight: toCount(counts.pendingDocSuggestions) > 0,
      },
    ],
    proposalQueues,
    validationRuns,
    workspaceResources,
    groups,
  };
}

function createFields(entries: Array<[string, unknown]>) {
  return entries
    .map(([label, value]) => ({ label, value: typeof value === "string" ? value : toText(value, "-") }))
    .filter((entry) => entry.value !== "");
}

function createRelatedLink(
  label: string,
  kind: MissionEvidenceKind,
  id: string | null | undefined,
  subject?: MissionEvidenceSubject,
) {
  const normalizedId = toText(id, "");
  if (!normalizedId) {
    return null;
  }

  return {
    label,
    href: buildEvidenceHref({ kind, id: normalizedId, subject }),
  };
}

function dedupeLinks(entries: Array<{ label: string; href: string } | null>) {
  const seen = new Set<string>();
  return entries.filter((entry): entry is { label: string; href: string } => {
    if (!entry || seen.has(entry.href)) {
      return false;
    }
    seen.add(entry.href);
    return true;
  });
}

export function adaptMissionEvidenceDetail(
  input: MissionEvidenceAdapterInput,
): MissionEvidenceDetailModel {
  const proposalReviewPackage = input.proposalReviewPackage ?? null;
  const reviewPackageRun = asRecord(proposalReviewPackage?.workItemRun);
  const reviewPackageWorkspace = asRecord(proposalReviewPackage?.workspace);
  const proposal = input.proposal ?? proposalReviewPackage?.proposal ?? input.run?.proposal ?? null;
  const workspace = input.workspace ?? null;
  const integrationBranch = input.integrationBranch ?? null;
  const run = input.run ?? null;

  const proposalId = toText(proposal?.id, "");
  const runId = toText(run?.id, toText(reviewPackageRun.id, ""));
  const workspaceId = toText(
    workspace?.id,
    toText(run?.workspace?.id, toText(reviewPackageWorkspace.id, "")),
  );
  const workspaceBranchName = toText(
    workspace?.branchName,
    toText(run?.workspace?.branchName, toText(reviewPackageWorkspace.branchName, "")),
  );
  const workspaceStatus = toText(
    workspace?.status,
    toText(run?.workspace?.status, toText(reviewPackageWorkspace.status, "unknown")),
  );
  const promotionBranchName =
    toText(integrationBranch?.name, "") ||
    toText(proposalReviewPackage?.promotion?.integrationBranch, "");

  const relatedLinks = dedupeLinks([
    createRelatedLink(
      toText(proposal?.title, toText(run?.proposal?.title, toText(proposalId, "Proposal"))),
      "proposal",
      proposalId,
    ),
    createRelatedLink(
      toText(runId, "") ? `Validation run ${runId}` : "Validation Evidence",
      "validation",
      runId,
      "run",
    ),
    createRelatedLink(
      toText(workspaceBranchName, toText(workspaceId, "Workspace")),
      "workspace",
      workspaceId,
      "workspace",
    ),
    createRelatedLink(
      toText(promotionBranchName, "Promotion evidence"),
      "promotion",
      promotionBranchName,
      "branch",
    ),
  ]);

  if (input.kind === "validation") {
    const validationStatus =
      toText(run?.validation?.status, "") ||
      toText(run?.validationStatus, "") ||
      toText(run?.status, "unknown");
    return {
      kind: "validation",
      title: "Validation Evidence",
      status: validationStatus,
      subtitle: toText(
        run?.comparisonToPrevious?.summary,
        "Validation, proposal readiness, and runtime evidence for one managed run.",
      ),
      breadcrumbs: [
        { label: "Self-Build", href: "/self-build" },
        { label: "Validation Evidence" },
      ],
      summaryCards: createFields([
        ["Run", toText(run?.id, input.id)],
        ["Status", validationStatus],
        ["Proposal", proposalId || "-"],
        ["Workspace", workspaceId || "-"],
      ]),
      relatedLinks,
      sections: [
        {
          title: "Run Summary",
          description: "Current run state and the delta versus the previous attempt.",
          entries: createFields([
            ["Run ID", toText(run?.id, input.id)],
            ["Run Status", toText(run?.status, "unknown")],
            ["Validation Status", validationStatus],
          ]),
          body: toText(run?.comparisonToPrevious?.summary, "No comparison summary is available."),
        },
        {
          title: "Validation Summary",
          description: "Bundle-level evidence and readiness cues returned by the orchestrator.",
          entries: createFields([
            ["Validation Status", validationStatus],
            ["Scenario Runs", String(asArray(run?.validation?.scenarioRunIds).length)],
            ["Regression Runs", String(asArray(run?.validation?.regressionRunIds).length)],
            ["Doc Suggestions", String(asArray(run?.docSuggestions).length)],
          ]),
          body: toText(run?.validation?.summary, "No validation summary was returned."),
        },
        {
          title: "Workspace Context",
          description: "Workspace evidence for the mutable self-build environment tied to this run.",
          entries: createFields([
            ["Workspace", workspaceId || toText(run?.workspace?.id, "-")],
            ["Branch", toText(workspace?.branchName, toText(run?.workspace?.branchName, "-"))],
            ["Status", toText(workspace?.status, toText(run?.workspace?.status, "-"))],
          ]),
          body: toText(workspace?.worktreePath, "No workspace path was returned."),
        },
        {
          title: "Promotion Context",
          description: "Proposal readiness and promotion blockers that gate the integrator lane.",
          entries: createFields([
            ["Proposal", proposalId || "-"],
            ["Promotion Status", toText(proposalReviewPackage?.promotion?.status, "-")],
            ["Ready", formatBoolean(proposalReviewPackage?.readiness?.ready)],
            [
              "Blockers",
              String(asArray(proposalReviewPackage?.readiness?.blockers).length),
            ],
          ]),
          body: toText(
            proposalReviewPackage?.trace?.promotion?.summary,
            "No promotion trace summary was returned.",
          ),
        },
        {
          title: "Regression Evidence",
          description: "Scenario and regression traces linked to the validation run.",
          entries: createFields([
            ["Scenario Run", toText(input.scenarioRun?.run?.id, toText(run?.relationSummary?.scenarioRunId, "-"))],
            ["Scenario Status", toText(input.scenarioRun?.run?.status, "-")],
            ["Regression Run", toText(input.regressionRun?.run?.id, toText(run?.relationSummary?.regressionRunId, "-"))],
            ["Regression Status", toText(input.regressionRun?.run?.status, "-")],
          ]),
          body: toText(
            input.regressionReport?.report?.summary,
            "No regression report summary was returned.",
          ),
        },
      ],
    };
  }

  if (input.kind === "proposal") {
    const proposalStatus = toText(proposal?.status, "unknown");
    return {
      kind: "proposal",
      title: "Proposal Evidence",
      status: proposalStatus,
      subtitle: toText(
        proposal?.title,
        toText(proposalId, "Governance, readiness, and promotion evidence for one proposal."),
      ),
      breadcrumbs: [
        { label: "Self-Build", href: "/self-build" },
        { label: "Proposal Evidence" },
      ],
      summaryCards: createFields([
        ["Proposal", proposalId || input.id],
        ["Status", proposalStatus],
        ["Ready", formatBoolean(proposalReviewPackage?.readiness?.ready)],
        ["Promotion", toText(proposalReviewPackage?.promotion?.status, "-")],
      ]),
      relatedLinks,
      sections: [
        {
          title: "Proposal Summary",
          description: "Operator-facing proposal status and current governance state.",
          entries: createFields([
            ["Proposal ID", proposalId || input.id],
            ["Status", proposalStatus],
            ["Protected Scope", toText(proposalReviewPackage?.readiness?.protectedScope, "-")],
          ]),
          body: toText(
            proposalReviewPackage?.proposal?.summary?.title,
            toText(proposal?.title, "No proposal summary returned."),
          ),
        },
        {
          title: "Readiness",
          description: "Readiness cues that explain why review, validation, or promotion is still blocked.",
          entries: createFields([
            ["Ready", formatBoolean(proposalReviewPackage?.readiness?.ready)],
            ["Blockers", String(asArray(proposalReviewPackage?.readiness?.blockers).length)],
            ["Promotion Status", toText(proposalReviewPackage?.promotion?.status, "-")],
          ]),
          body: toText(
            proposalReviewPackage?.trace?.promotion?.summary,
            "No readiness trace summary was returned.",
          ),
        },
        {
          title: "Promotion Context",
          description: "The integrator-facing promotion envelope for this proposal.",
          entries: createFields([
            ["Integration Branch", promotionBranchName || "-"],
            ["Target Branch", toText(proposalReviewPackage?.promotion?.targetBranch, "-")],
            ["Source Execution", toText(proposalReviewPackage?.promotion?.sourceExecutionId, "-")],
          ]),
          body: null,
        },
        {
          title: "Validation Context",
          description: "Linked run evidence stays visible so readiness is not isolated from validation state.",
          entries: createFields([
            ["Run", runId || "-"],
            ["Run Status", toText(run?.status, toText(reviewPackageRun.status, "-"))],
            [
              "Validation Status",
              toText(run?.validationStatus, toText(asRecord(reviewPackageRun.validation).status, "-")),
            ],
          ]),
          body: toText(
            run?.validation?.summary,
            toText(
              asRecord(reviewPackageRun.validation).summary,
              toText(run?.comparisonToPrevious?.summary, "No linked validation summary was returned."),
            ),
          ),
        },
        {
          title: "Workspace Context",
          description: "Workspace evidence remains attached so operators can inspect mutable state next to readiness and promotion gates.",
          entries: createFields([
            ["Workspace", workspaceId || "-"],
            ["Branch", workspaceBranchName || "-"],
            ["Status", workspaceStatus],
          ]),
          body: toText(
            workspace?.worktreePath,
            toText(reviewPackageWorkspace.worktreePath, "No linked workspace path was returned."),
          ),
        },
      ],
    };
  }

  if (input.kind === "promotion") {
    const promotionStatus =
      toText(integrationBranch?.status, "") ||
      toText(proposalReviewPackage?.promotion?.status, "") ||
      "unknown";
    const branchLabel = toText(integrationBranch?.name, promotionBranchName || input.id);

    return {
      kind: "promotion",
      title: "Promotion Evidence",
      status: promotionStatus,
      subtitle: toText(
        branchLabel,
        "Promotion candidates land in an integration branch before canonical branch updates.",
      ),
      breadcrumbs: [
        { label: "Self-Build", href: "/self-build" },
        { label: "Promotion Evidence" },
      ],
      summaryCards: createFields([
        ["Branch", branchLabel],
        ["Status", promotionStatus],
        ["Target Branch", toText(integrationBranch?.targetBranch, toText(proposalReviewPackage?.promotion?.targetBranch, "-"))],
        ["Proposal", proposalId || toText(integrationBranch?.proposalArtifactId, "-")],
      ]),
      relatedLinks,
      sections: [
        {
          title: "Promotion Summary",
          description: "Current promotion lane state and the proposal driving it.",
          entries: createFields([
            ["Integration Branch", branchLabel],
            ["Status", promotionStatus],
            ["Source Execution", toText(integrationBranch?.sourceExecutionId, toText(proposalReviewPackage?.promotion?.sourceExecutionId, "-"))],
          ]),
          body: null,
        },
        {
          title: "Proposal Context",
          description: "Proposal readiness stays visible because promotion is governed, not implicit.",
          entries: createFields([
            ["Proposal", proposalId || toText(integrationBranch?.proposalArtifactId, "-")],
            ["Ready", formatBoolean(proposalReviewPackage?.readiness?.ready)],
            ["Blockers", String(asArray(proposalReviewPackage?.readiness?.blockers).length)],
          ]),
          body: toText(
            proposalReviewPackage?.trace?.promotion?.summary,
            "No promotion trace summary was returned.",
          ),
        },
        {
          title: "Validation Context",
          description: "Promotion keeps the originating validation state visible to explain why a branch is blocked or ready.",
          entries: createFields([
            ["Run", runId || "-"],
            ["Run Status", toText(run?.status, toText(reviewPackageRun.status, "-"))],
            [
              "Validation Status",
              toText(run?.validationStatus, toText(asRecord(reviewPackageRun.validation).status, "-")),
            ],
          ]),
          body: toText(
            run?.validation?.summary,
            toText(
              asRecord(reviewPackageRun.validation).summary,
              toText(run?.comparisonToPrevious?.summary, "No linked validation summary was returned."),
            ),
          ),
        },
        {
          title: "Workspace Context",
          description: "Workspace state remains visible because promotion candidates still derive from mutable self-build artifacts.",
          entries: createFields([
            ["Workspace", workspaceId || "-"],
            ["Branch", workspaceBranchName || "-"],
            ["Status", workspaceStatus],
          ]),
          body: toText(
            workspace?.worktreePath,
            toText(reviewPackageWorkspace.worktreePath, "No linked workspace path was returned."),
          ),
        },
      ],
    };
  }

  return {
    kind: "workspace",
    title: "Workspace Evidence",
    status: workspaceStatus,
    subtitle: toText(
      workspace?.branchName,
      "Workspace allocation and safe-mode context for mutating self-build work.",
    ),
    breadcrumbs: [
      { label: "Self-Build", href: "/self-build" },
      { label: "Workspace Evidence" },
    ],
    summaryCards: createFields([
      ["Workspace", workspaceId || input.id],
      ["Status", workspaceStatus],
      ["Branch", toText(workspace?.branchName, "-")],
      ["Run", toText(workspace?.workItemRunId, "-")],
    ]),
    relatedLinks,
    sections: [
      {
        title: "Workspace Context",
        description: "Allocation status, branch identity, and worktree path.",
        entries: createFields([
          ["Workspace ID", workspaceId || input.id],
          ["Status", workspaceStatus],
          ["Branch", toText(workspace?.branchName, "-")],
          ["Base Ref", toText(workspace?.baseRef, "-")],
        ]),
        body: toText(workspace?.worktreePath, "No worktree path was returned."),
      },
        {
          title: "Allocation Trace",
          description: "Why this workspace exists and how it was selected.",
        entries: createFields([
          ["Decision", toText(workspace?.trace?.allocation?.decision, "-")],
          ["Reasons", String(asArray(workspace?.trace?.allocation?.reasons).length)],
        ]),
          body: toText(
            workspace?.trace?.allocation?.summary,
            "No workspace allocation trace summary was returned.",
          ),
        },
        {
          title: "Proposal Context",
          description: "Workspace drilldowns keep the linked proposal and readiness state visible when reachable by run or proposal id.",
          entries: createFields([
            ["Proposal", proposalId || "-"],
            ["Proposal Status", toText(proposal?.status, toText(proposalReviewPackage?.proposal?.status, "-"))],
            ["Ready", formatBoolean(proposalReviewPackage?.readiness?.ready)],
            ["Blockers", String(asArray(proposalReviewPackage?.readiness?.blockers).length)],
          ]),
          body: toText(
            proposalReviewPackage?.trace?.promotion?.summary,
            toText(proposal?.title, "No linked proposal context was returned."),
          ),
        },
        {
          title: "Validation Context",
          description: "Run evidence remains attached so workspace state is interpretable in the broader validation flow.",
          entries: createFields([
            ["Run", runId || "-"],
            ["Run Status", toText(run?.status, "-")],
            ["Validation Status", toText(run?.validationStatus, "-")],
          ]),
          body: toText(
            run?.validation?.summary,
            toText(run?.comparisonToPrevious?.summary, "No linked validation summary was returned."),
          ),
        },
        {
          title: "Promotion Context",
          description: "Promotion evidence stays visible when the workspace can still reach its linked proposal and integration branch.",
          entries: createFields([
            ["Integration Branch", promotionBranchName || "-"],
            ["Promotion Status", toText(integrationBranch?.status, toText(proposalReviewPackage?.promotion?.status, "-"))],
            ["Target Branch", toText(integrationBranch?.targetBranch, toText(proposalReviewPackage?.promotion?.targetBranch, "-"))],
          ]),
          body: null,
        },
      ],
    };
}
