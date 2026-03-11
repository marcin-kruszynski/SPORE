/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import {
  buildInboxActionSubmission,
  buildQuickReplySubmission,
  deriveMissionFocusState,
  shouldRefreshInboxFromThreadEvent,
} from "./operator-chat-controller.js";
import {
  renderOperatorCurrentDecision,
  renderOperatorEvidenceSummary,
  renderOperatorInboxRow,
  renderOperatorMissionHero,
  renderOperatorProgress,
  renderOperatorQuickReplies,
} from "./operator-chat-view.js";

// biome-ignore lint/suspicious/noExplicitAny: the browser app renders heterogeneous operator payloads from many additive backend surfaces.
type AnyRecord = Record<string, any>;

declare global {
  interface Error {
    status?: number;
    payload?: unknown;
  }
}

const state: AnyRecord = {
  sessions: [],
  selectedSessionId: null,
  detail: null,
  sessionLive: null,
  sessionLiveState: "idle",
  sessionLiveError: null,
  artifacts: null,
  transcript: null,
  piEvents: null,
  executions: [],
  selectedExecutionId: null,
  executionDetail: null,
  executionListError: null,
  executionDetailError: null,
  scenarios: [],
  scenarioRouteState: "idle",
  scenarioRouteError: null,
  selectedScenarioId: null,
  scenarioDetail: null,
  scenarioDetailState: "idle",
  scenarioDetailError: null,
  scenarioRuns: [],
  scenarioRunsState: "idle",
  scenarioRunsError: null,
  selectedScenarioRunId: null,
  scenarioRunArtifacts: null,
  scenarioRunArtifactsState: "idle",
  scenarioRunArtifactsError: null,
  scenarioRunDetail: null,
  scenarioRunDetailState: "idle",
  scenarioRunDetailError: null,
  scenarioTrend: null,
  scenarioTrendState: "idle",
  scenarioTrendError: null,
  regressions: [],
  runCenter: null,
  runCenterState: "idle",
  runCenterError: null,
  selectedRegressionId: null,
  regressionRouteState: "idle",
  regressionRouteError: null,
  regressionDetail: null,
  regressionDetailState: "idle",
  regressionDetailError: null,
  regressionRuns: [],
  regressionRunsState: "idle",
  regressionRunsError: null,
  regressionRunDetail: null,
  regressionRunDetailState: "idle",
  regressionRunDetailError: null,
  regressionRunReport: null,
  regressionRunReportState: "idle",
  regressionRunReportError: null,
  regressionTrend: null,
  regressionTrendState: "idle",
  regressionTrendError: null,
  selfBuildSummary: null,
  selfBuildSummaryState: "idle",
  selfBuildSummaryError: null,
  workItemRunDetail: null,
  workItemRunDetailState: "idle",
  workItemRunDetailError: null,
  proposalDetail: null,
  proposalDetailState: "idle",
  proposalDetailError: null,
  selectedRegressionRunId: null,
  selectedRunCenterScenarioRunId: null,
  selectedRunCenterRegressionRunId: null,
  selectedRunCenterWorkItemRunId: null,
  selectedExecutionHistoryRowKey: null,
  workflowPreview: null,
  workflowPreviewError: null,
  workflowPreviewDirty: false,
  workflowPreviewSource: null,
  autoRefreshTimer: null,
  eventSource: null,
  executionEventSource: null,
  operatorThreadEventSource: null,
  activeTab: "events",
  // Self-build dashboard state
  activeView: "run-center",
  selfBuildWorkItems: [],
  selfBuildGroups: [],
  selfBuildDependencyImpact: null,
  operatorThreads: [],
  operatorThreadsState: "idle",
  operatorThreadsError: null,
  selectedOperatorThreadId: null,
  operatorThreadDetail: null,
  operatorThreadDetailState: "idle",
  operatorThreadDetailError: null,
  operatorHighlightedActionId: null,
  operatorMissionFocusSource: null,
  operatorPendingInbox: [],
  operatorPendingInboxState: "idle",
  operatorPendingInboxError: null,
  selfBuildFilters: {
    status: "",
    group: "",
    template: "",
    domain: "",
  },
  selectedWorkItemId: null,
  selectedWorkItemGroupId: null,
  workItemDetail: null,
  workItemDetailState: "idle",
  workItemDetailError: null,
  workItemGroupDetail: null,
  workItemGroupDetailState: "idle",
  workItemGroupDetailError: null,
};

const els: AnyRecord = {
  sessionCount: document.getElementById("session-count"),
  eventCount: document.getElementById("event-count"),
  stateSummary: document.getElementById("state-summary"),
  executionCount: document.getElementById("execution-count"),
  coordinationCount: document.getElementById("coordination-count"),
  scenarioCount: document.getElementById("scenario-count"),
  regressionCount: document.getElementById("regression-count"),
  runCenterState: document.getElementById("run-center-state"),
  runCenterSummary: document.getElementById("run-center-summary"),
  executionSubtitle: document.getElementById("execution-subtitle"),
  executionList: document.getElementById("execution-list"),
  scenarioSubtitle: document.getElementById("scenario-subtitle"),
  scenarioList: document.getElementById("scenario-list"),
  scenarioDetail: document.getElementById("scenario-detail"),
  regressionSubtitle: document.getElementById("regression-subtitle"),
  regressionList: document.getElementById("regression-list"),
  executionDetailSubtitle: document.getElementById("execution-detail-subtitle"),
  executionDetail: document.getElementById("execution-detail"),
  executionTree: document.getElementById("execution-tree"),
  executionTimeline: document.getElementById("execution-timeline"),
  executionHistoryState: document.getElementById("execution-history-state"),
  executionHistory: document.getElementById("execution-history"),
  decisionLog: document.getElementById("decision-log"),
  driveButton: document.getElementById("drive-button"),
  driveGroupButton: document.getElementById("drive-group-button"),
  driveTreeButton: document.getElementById("drive-tree-button"),
  driveWait: document.getElementById("drive-wait"),
  driveTimeout: document.getElementById("drive-timeout"),
  driveInterval: document.getElementById("drive-interval"),
  pauseButton: document.getElementById("pause-button"),
  holdButton: document.getElementById("hold-button"),
  resumeButton: document.getElementById("resume-button"),
  pauseTreeButton: document.getElementById("pause-tree-button"),
  holdTreeButton: document.getElementById("hold-tree-button"),
  resumeTreeButton: document.getElementById("resume-tree-button"),
  executionOperatorReason: document.getElementById("execution-operator-reason"),
  executionOperatorComments: document.getElementById(
    "execution-operator-comments",
  ),
  executionGuidance: document.getElementById("execution-guidance"),
  executionTreeActionSummary: document.getElementById(
    "execution-tree-action-summary",
  ),
  branchSpawnSummary: document.getElementById("branch-spawn-summary"),
  branchDefinitions: document.getElementById("branch-definitions"),
  branchSpawnWait: document.getElementById("branch-spawn-wait"),
  branchTimeout: document.getElementById("branch-timeout"),
  branchInterval: document.getElementById("branch-interval"),
  branchSpawnButton: document.getElementById("branch-spawn-button"),
  reviewStatus: document.getElementById("review-status"),
  reviewBy: document.getElementById("review-by"),
  reviewComments: document.getElementById("review-comments"),
  reviewButton: document.getElementById("review-button"),
  approvalStatus: document.getElementById("approval-status"),
  approvalBy: document.getElementById("approval-by"),
  approvalComments: document.getElementById("approval-comments"),
  approvalButton: document.getElementById("approval-button"),
  familyReviewSummary: document.getElementById("family-review-summary"),
  familyReviewStatus: document.getElementById("family-review-status"),
  familyReviewScope: document.getElementById("family-review-scope"),
  familyReviewBy: document.getElementById("family-review-by"),
  familyReviewComments: document.getElementById("family-review-comments"),
  familyReviewButton: document.getElementById("family-review-button"),
  familyApprovalSummary: document.getElementById("family-approval-summary"),
  familyApprovalStatus: document.getElementById("family-approval-status"),
  familyApprovalScope: document.getElementById("family-approval-scope"),
  familyApprovalBy: document.getElementById("family-approval-by"),
  familyApprovalComments: document.getElementById("family-approval-comments"),
  familyApprovalButton: document.getElementById("family-approval-button"),
  sessionList: document.getElementById("session-list"),
  eventList: document.getElementById("event-list"),
  sessionDetail: document.getElementById("session-detail"),
  detailSubtitle: document.getElementById("detail-subtitle"),
  refreshButton: document.getElementById("refresh-button"),
  autoRefresh: document.getElementById("auto-refresh"),
  stopButton: document.getElementById("stop-button"),
  completeButton: document.getElementById("complete-button"),
  steerButton: document.getElementById("steer-button"),
  steerMessage: document.getElementById("steer-message"),
  controlForm: document.getElementById("control-form"),
  transcriptView: document.getElementById("transcript-view"),
  piEventsView: document.getElementById("pi-events-view"),
  artifactList: document.getElementById("artifact-list"),
  streamState: document.getElementById("stream-state"),
  workflowForm: document.getElementById("workflow-form"),
  workflowDomain: document.getElementById("workflow-domain"),
  workflowRoles: document.getElementById("workflow-roles"),
  workflowObjective: document.getElementById("workflow-objective"),
  workflowPreviewButton: document.getElementById("workflow-preview-button"),
  workflowPreviewState: document.getElementById("workflow-preview-state"),
  workflowPreview: document.getElementById("workflow-preview"),
  workflowButton: document.getElementById("workflow-button"),
  executionStreamState: document.getElementById("execution-stream-state"),
  tabButtons: Array.from(document.querySelectorAll("[data-tab]")),
  tabPanels: Array.from(document.querySelectorAll(".tab-panel")),
  // Self-build dashboard elements
  viewRunCenterButton: document.getElementById("view-run-center"),
  viewSelfBuildButton: document.getElementById("view-self-build"),
  viewOperatorChatButton: document.getElementById("view-operator-chat"),
  runCenterView: document.getElementById("run-center-view"),
  selfBuildView: document.getElementById("self-build-view"),
  operatorChatView: document.getElementById("operator-chat-view"),
  selfBuildOverview: document.getElementById("self-build-overview"),
  selfBuildDashboardState: document.getElementById(
    "self-build-dashboard-state",
  ),
  selfBuildFreshness: document.getElementById("self-build-freshness"),
  selfBuildAttentionCount: document.getElementById(
    "self-build-attention-count",
  ),
  selfBuildAttentionSummary: document.getElementById(
    "self-build-attention-summary",
  ),
  selfBuildFilterForm: document.getElementById("self-build-filter-form"),
  selfBuildStatusFilter: document.getElementById("self-build-status-filter"),
  selfBuildGroupFilter: document.getElementById("self-build-group-filter"),
  selfBuildTemplateFilter: document.getElementById(
    "self-build-template-filter",
  ),
  selfBuildDomainFilter: document.getElementById("self-build-domain-filter"),
  selfBuildFilterReset: document.getElementById("self-build-filter-reset"),
  groupReadinessOverview: document.getElementById("group-readiness-overview"),
  groupReadinessList: document.getElementById("group-readiness-list"),
  groupReadinessCount: document.getElementById("group-readiness-count"),
  urgentWorkQueue: document.getElementById("urgent-work-queue"),
  urgentWorkCount: document.getElementById("urgent-work-count"),
  followUpQueue: document.getElementById("follow-up-queue"),
  followUpCount: document.getElementById("follow-up-count"),
  selfBuildRecentRuns: document.getElementById("self-build-recent-runs"),
  selfBuildRecentRunsCount: document.getElementById(
    "self-build-recent-runs-count",
  ),
  selfBuildWorkspaceHealth: document.getElementById(
    "self-build-workspace-health",
  ),
  selfBuildWorkspaceCount: document.getElementById(
    "self-build-workspace-count",
  ),
  selfBuildDetailOverlay: document.getElementById("self-build-detail-overlay"),
  selfBuildBackButton: document.getElementById("self-build-back-button"),
  selfBuildDetailTitle: document.getElementById("self-build-detail-title"),
  selfBuildDetailContent: document.getElementById("self-build-detail-content"),
  operatorThreadForm: document.getElementById("operator-thread-form"),
  operatorThreadMessage: document.getElementById("operator-thread-message"),
  operatorThreadProject: document.getElementById("operator-thread-project"),
  operatorThreadRuntime: document.getElementById("operator-thread-runtime"),
  operatorThreadSafeMode: document.getElementById("operator-thread-safe-mode"),
  operatorThreadAutoValidate: document.getElementById(
    "operator-thread-auto-validate",
  ),
  operatorThreadFeedback: document.getElementById("operator-thread-feedback"),
  operatorInboxCount: document.getElementById("operator-inbox-count"),
  operatorInboxList: document.getElementById("operator-inbox-list"),
  operatorThreadList: document.getElementById("operator-thread-list"),
  operatorThreadCount: document.getElementById("operator-thread-count"),
  operatorChatTitle: document.getElementById("operator-chat-title"),
  operatorChatSubtitle: document.getElementById("operator-chat-subtitle"),
  operatorChatState: document.getElementById("operator-chat-state"),
  operatorChatEmpty: document.getElementById("operator-chat-empty"),
  operatorChatShell: document.getElementById("operator-chat-shell"),
  operatorMissionHero: document.getElementById("operator-mission-hero"),
  operatorCurrentDecision: document.getElementById("operator-current-decision"),
  operatorProgressStrip: document.getElementById("operator-progress-strip"),
  operatorQuickReplies: document.getElementById("operator-quick-replies"),
  operatorMessageList: document.getElementById("operator-message-list"),
  operatorChatComposer: document.getElementById("operator-chat-composer"),
  operatorChatInput: document.getElementById("operator-chat-input"),
  operatorChatFeedback: document.getElementById("operator-chat-feedback"),
  operatorPendingCount: document.getElementById("operator-pending-count"),
  operatorPendingActions: document.getElementById("operator-pending-actions"),
  operatorArtifactCount: document.getElementById("operator-artifact-count"),
  operatorEvidenceSummary: document.getElementById("operator-evidence-summary"),
  operatorLinkedArtifacts: document.getElementById("operator-linked-artifacts"),
  operatorThreadSettings: document.getElementById("operator-thread-settings"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function stateClass(value) {
  return String(value || "unknown").toLowerCase();
}

function formatObject(value) {
  return `<code>${escapeHtml(JSON.stringify(value ?? null))}</code>`;
}

function normalizeText(value, fallback = "-") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function parsePositiveInt(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseJsonText(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasDisplayValue(value) {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.some((item) => hasDisplayValue(item));
  }
  if (isObject(value)) {
    return Object.values(value).some((item) => hasDisplayValue(item));
  }
  return true;
}

function humanizeKey(value) {
  return String(value ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatPolicyValue(value) {
  if (!hasDisplayValue(value)) {
    return "-";
  }
  if (typeof value === "boolean") {
    return value ? "yes" : "no";
  }
  if (Array.isArray(value)) {
    return value
      .filter((item) => hasDisplayValue(item))
      .map((item) => formatPolicyValue(item))
      .join(", ");
  }
  if (isObject(value)) {
    return Object.entries(value)
      .filter(([, item]) => hasDisplayValue(item))
      .map(([key, item]) => `${key}=${formatPolicyValue(item)}`)
      .join(" · ");
  }
  return String(value);
}

function formatTimestamp(value) {
  return value ? escapeHtml(value) : "-";
}

function parseTimestamp(value) {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDuration(startValue, endValue) {
  const start = parseTimestamp(startValue);
  const end = parseTimestamp(endValue);
  if (start === null || end === null || end < start) {
    return "-";
  }
  const totalSeconds = Math.floor((end - start) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function isTerminalExecutionState(value) {
  return ["completed", "canceled", "failed", "stopped", "rejected"].includes(
    String(value ?? "").toLowerCase(),
  );
}

function summarizeStates(items = []) {
  const counts = new Map();
  for (const item of items) {
    const key = normalizeText(item?.state, "unknown");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([key, value]) => `${key}:${value}`)
    .join(" · ");
}

function uniqueCoordinationGroupCount(executions = []) {
  const ids = new Set(
    executions
      .map((execution) => execution?.coordinationGroupId)
      .filter((value) => String(value ?? "").trim()),
  );
  return ids.size;
}

function deriveExecutionMode(execution) {
  if (execution?.state === "paused" || execution?.pausedAt) {
    return "paused";
  }
  if (execution?.state === "held" || execution?.heldAt) {
    return "held";
  }
  if (
    execution?.state === "waiting_review" ||
    execution?.state === "waiting_approval"
  ) {
    return "governance";
  }
  return "standard";
}

function renderStatePill(value, extraClass = "") {
  const text = normalizeText(value);
  const classes = ["pill", stateClass(value)];
  if (extraClass) {
    classes.push(extraClass);
  }
  return `<span class="${classes.join(" ")}">${escapeHtml(text)}</span>`;
}

function renderMetaPill(label, value, tone = "") {
  const text =
    value === null || value === undefined || value === ""
      ? label
      : `${label}:${value}`;
  const className = tone ? `lineage-pill ${tone}` : "lineage-pill";
  return `<span class="${className}">${escapeHtml(text)}</span>`;
}

function getExecutionMetadataRecord(execution) {
  return isObject(execution?.metadata) ? execution.metadata : {};
}

function getExecutionProjectRole(execution) {
  const role =
    readFirstField(execution, ["projectRole"]) ??
    readFirstField(getExecutionMetadataRecord(execution), ["projectRole"]);
  const normalized = String(role ?? "")
    .trim()
    .toLowerCase();
  return ["coordinator", "integrator"].includes(normalized) ? normalized : null;
}

function getExecutionTopologyKind(execution) {
  const topology = readFirstObjectField(execution, ["topology"]);
  const kind =
    readFirstField(topology, ["kind"]) ??
    readFirstField(getExecutionMetadataRecord(execution), ["topologyKind"]);
  const normalized = String(kind ?? "")
    .trim()
    .toLowerCase();
  return ["project-root", "promotion-lane"].includes(normalized)
    ? normalized
    : null;
}

function getExecutionPromotionRecord(execution) {
  return (
    readFirstObjectField(execution, ["promotion"]) ??
    readFirstObjectField(getExecutionMetadataRecord(execution), ["promotion"])
  );
}

function getExecutionPromotionStatus(execution) {
  const promotion = getExecutionPromotionRecord(execution);
  const status =
    readFirstField(execution, ["promotionStatus"]) ??
    readFirstField(promotion, ["status"]);
  const normalized = String(status ?? "")
    .trim()
    .toLowerCase();
  return normalized || null;
}

function getProjectRoleTone(projectRole) {
  if (projectRole === "coordinator") {
    return "root";
  }
  if (projectRole === "integrator") {
    return "branch";
  }
  return "";
}

function getTopologyKindTone(kind) {
  if (kind === "project-root") {
    return "root";
  }
  if (kind === "promotion-lane") {
    return "branch";
  }
  return "";
}

function getPromotionStatusTone(status) {
  if (
    [
      "merged",
      "promotion_candidate",
      "ready_for_promotion",
      "ready_to_merge",
    ].includes(status)
  ) {
    return "root";
  }
  if (["blocked", "rejected", "changes_requested"].includes(status)) {
    return "held";
  }
  if (["policy_waiting_approval", "waiting_approval"].includes(status)) {
    return "governance";
  }
  if (["running", "in_progress", "collecting_sources"].includes(status)) {
    return "branch";
  }
  return "changed";
}

function renderExecutionProjectMetadataPills(execution) {
  const pills = [];
  const projectRole = getExecutionProjectRole(execution);
  const topologyKind = getExecutionTopologyKind(execution);
  const promotion = getExecutionPromotionRecord(execution);
  const promotionStatus = getExecutionPromotionStatus(execution);

  if (projectRole) {
    pills.push(
      renderMetaPill("project", projectRole, getProjectRoleTone(projectRole)),
    );
  }
  if (topologyKind) {
    pills.push(
      renderMetaPill(
        "topology",
        topologyKind,
        getTopologyKindTone(topologyKind),
      ),
    );
  }
  if (promotionStatus) {
    pills.push(
      renderMetaPill(
        "promotion",
        promotionStatus,
        getPromotionStatusTone(promotionStatus),
      ),
    );
  }
  if (hasDisplayValue(promotion?.targetBranch)) {
    pills.push(renderMetaPill("target", promotion.targetBranch, "branch"));
  }
  if (hasDisplayValue(promotion?.integrationBranch)) {
    pills.push(
      renderMetaPill("integration", promotion.integrationBranch, "branch"),
    );
  }
  if (promotion || promotionStatus) {
    const sourceCount = Number(promotion?.sourceCount ?? 0);
    pills.push(
      renderMetaPill(
        "sources",
        Number.isFinite(sourceCount)
          ? sourceCount
          : normalizeText(promotion?.sourceCount, "0"),
      ),
    );
  }

  return pills.join("");
}

function renderExecutionModePills(execution) {
  const pills = [];
  const mode = deriveExecutionMode(execution);
  if (mode === "paused") {
    pills.push(
      renderMetaPill("paused", execution?.pausedAt ? "operator" : "", "paused"),
    );
  }
  if (mode === "held") {
    pills.push(
      renderMetaPill("held", execution?.holdReason ?? "operator", "held"),
    );
  }
  if (execution?.reviewStatus) {
    pills.push(renderMetaPill("review", execution.reviewStatus, "governance"));
  }
  if (execution?.approvalStatus) {
    pills.push(
      renderMetaPill("approval", execution.approvalStatus, "governance"),
    );
  }
  if (execution?.branchKey) {
    pills.push(renderMetaPill("branch", execution.branchKey, "branch"));
  }
  if (execution?.parentExecutionId) {
    pills.push(renderMetaPill("child", execution.parentExecutionId, "child"));
  } else if (execution?.coordinationGroupId) {
    pills.push(renderMetaPill("root", execution.coordinationGroupId, "root"));
  }
  return pills.join("");
}

function renderPolicyHighlights(policy) {
  if (!hasDisplayValue(policy)) {
    return "";
  }

  const workflowPolicy = policy?.workflowPolicy ?? {};
  const runtimePolicy = policy?.runtimePolicy ?? {};
  const docsKbPolicy = policy?.docsKbPolicy ?? {};
  const governance = policy?.governance ?? {};
  const pills = [];

  const attempts =
    workflowPolicy.maxAttempts ?? workflowPolicy.defaultMaxAttempts;
  if (hasDisplayValue(attempts)) {
    pills.push(renderMetaPill("attempts", attempts));
  }
  if (hasDisplayValue(workflowPolicy.stepSoftTimeoutMs)) {
    pills.push(
      renderMetaPill("soft", `${workflowPolicy.stepSoftTimeoutMs}ms`, "paused"),
    );
  }
  if (hasDisplayValue(workflowPolicy.stepHardTimeoutMs)) {
    pills.push(
      renderMetaPill("hard", `${workflowPolicy.stepHardTimeoutMs}ms`, "held"),
    );
  }
  if (hasDisplayValue(runtimePolicy.sessionMode)) {
    pills.push(renderMetaPill("mode", runtimePolicy.sessionMode));
  } else if (
    isObject(runtimePolicy.sessionModeByRole) &&
    Object.keys(runtimePolicy.sessionModeByRole).length > 0
  ) {
    pills.push(
      renderMetaPill(
        "modes",
        Object.keys(runtimePolicy.sessionModeByRole).length,
      ),
    );
  }
  if (hasDisplayValue(docsKbPolicy.resultLimit)) {
    pills.push(renderMetaPill("docs", docsKbPolicy.resultLimit));
  }
  if (hasDisplayValue(governance.reviewRequired)) {
    pills.push(
      renderMetaPill(
        "review",
        governance.reviewRequired ? "required" : "optional",
        "governance",
      ),
    );
  }
  if (hasDisplayValue(governance.approvalRequired)) {
    pills.push(
      renderMetaPill(
        "approval",
        governance.approvalRequired ? "required" : "optional",
        "governance",
      ),
    );
  }

  return pills.join("");
}

function tokenizePolicyKey(value) {
  return String(value ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s._-]+/)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
}

function classifyPolicyLabelKey(key) {
  const tokens = tokenizePolicyKey(key);
  if (tokens.length === 0) {
    return null;
  }

  if (tokens[0] === "policy") {
    tokens.shift();
  }

  if (!tokens.length) {
    return null;
  }

  const kind = tokens[0];
  if (!["pack", "preset"].includes(kind)) {
    return null;
  }

  if (tokens.length === 1) {
    return kind;
  }

  return ["id", "name", "label"].includes(tokens[1]) ? kind : null;
}

function collectPolicyLabelEntries(...carriers) {
  const items = [];
  const seen = new Set();

  const visit = (value, depth = 0) => {
    if (!isObject(value) || depth > 2) {
      return;
    }

    for (const [key, item] of Object.entries(value)) {
      const labelKind = classifyPolicyLabelKey(key);
      if (
        labelKind &&
        !isObject(item) &&
        !Array.isArray(item) &&
        hasDisplayValue(item)
      ) {
        const dedupeKey = `${labelKind}:${String(item)}`;
        if (!seen.has(dedupeKey)) {
          seen.add(dedupeKey);
          items.push({ kind: labelKind, value: String(item) });
        }
      }

      if (isObject(item)) {
        visit(item, depth + 1);
      }
    }
  };

  for (const carrier of carriers.flat()) {
    visit(carrier);
  }

  return items.sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) ||
      left.value.localeCompare(right.value),
  );
}

function renderPolicyLabelPills(carriers = []) {
  const items = collectPolicyLabelEntries(carriers);
  if (items.length === 0) {
    return "";
  }

  return items
    .map((item) => renderMetaPill(item.kind, item.value, "policy-label"))
    .join("");
}

function normalizePolicyComparable(value) {
  if (Array.isArray(value)) {
    return value
      .filter((item) => hasDisplayValue(item))
      .map((item) => normalizePolicyComparable(item));
  }

  if (isObject(value)) {
    return Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .reduce((accumulator, key) => {
        const item = value[key];
        if (hasDisplayValue(item)) {
          accumulator[key] = normalizePolicyComparable(item);
        }
        return accumulator;
      }, {});
  }

  return value;
}

function policyValueSignature(value) {
  return JSON.stringify(normalizePolicyComparable(value));
}

function flattenPolicyEntries(value, path = [], entries = []) {
  if (!hasDisplayValue(value)) {
    return entries;
  }

  if (Array.isArray(value) || !isObject(value)) {
    entries.push({
      key: path.join("."),
      path,
      value,
    });
    return entries;
  }

  for (const key of Object.keys(value).sort((left, right) =>
    left.localeCompare(right),
  )) {
    const item = value[key];
    if (!hasDisplayValue(item)) {
      continue;
    }

    const nextPath = [...path, key];
    if (isObject(item) && !Array.isArray(item)) {
      flattenPolicyEntries(item, nextPath, entries);
    } else {
      entries.push({
        key: nextPath.join("."),
        path: nextPath,
        value: item,
      });
    }
  }

  return entries;
}

function formatPolicyPath(path = []) {
  if (!Array.isArray(path) || path.length === 0) {
    return "Policy";
  }

  return path.map((segment) => humanizeKey(segment)).join(" / ");
}

function comparePolicies(baseline, candidate) {
  const baselineMap = new Map(
    flattenPolicyEntries(baseline).map((entry) => [entry.key, entry]),
  );
  const candidateMap = new Map(
    flattenPolicyEntries(candidate).map((entry) => [entry.key, entry]),
  );
  const keys = Array.from(
    new Set([...baselineMap.keys(), ...candidateMap.keys()]),
  ).sort((left, right) => left.localeCompare(right));
  const changed = [];
  const candidateOnly = [];
  const baselineOnly = [];
  let unchangedCount = 0;

  for (const key of keys) {
    const baselineEntry = baselineMap.get(key) ?? null;
    const candidateEntry = candidateMap.get(key) ?? null;
    if (baselineEntry && candidateEntry) {
      if (
        policyValueSignature(baselineEntry.value) ===
        policyValueSignature(candidateEntry.value)
      ) {
        unchangedCount += 1;
      } else {
        changed.push({
          key,
          path: candidateEntry.path,
          baseline: baselineEntry.value,
          candidate: candidateEntry.value,
        });
      }
      continue;
    }

    if (candidateEntry) {
      candidateOnly.push({
        key,
        path: candidateEntry.path,
        candidate: candidateEntry.value,
      });
      continue;
    }

    if (baselineEntry) {
      baselineOnly.push({
        key,
        path: baselineEntry.path,
        baseline: baselineEntry.value,
      });
    }
  }

  return {
    changed,
    candidateOnly,
    baselineOnly,
    unchangedCount,
  };
}

function renderPolicyDiffItems(
  items: AnyRecord[],
  {
    tone,
    baselineLabel,
    candidateLabel,
    includeBaseline = true,
    includeCandidate = true,
  }: AnyRecord = {},
) {
  if (!items.length) {
    return "";
  }

  return items
    .map((item) => {
      const pathLabel = formatPolicyPath(item.path);
      return `
        <article class="policy-diff-item ${escapeHtml(tone || "neutral")}">
          <div class="policy-diff-item-header">
            <strong>${escapeHtml(pathLabel)}</strong>
            <span class="lineage-pill ${escapeHtml(tone || "")}">${escapeHtml(humanizeKey(tone || "change"))}</span>
          </div>
          <div class="policy-diff-values">
            ${
              includeBaseline
                ? `<div class="policy-diff-value">
                    <span class="muted">${escapeHtml(baselineLabel)}</span>
                    <code>${escapeHtml(formatPolicyValue(item.baseline))}</code>
                  </div>`
                : ""
            }
            ${
              includeCandidate
                ? `<div class="policy-diff-value">
                    <span class="muted">${escapeHtml(candidateLabel)}</span>
                    <code>${escapeHtml(formatPolicyValue(item.candidate))}</code>
                  </div>`
                : ""
            }
          </div>
        </article>
      `;
    })
    .join("");
}

function renderPolicyDiffPanel({
  title,
  baselineTitle = "Baseline",
  candidateTitle = "Compared",
  baselinePolicy,
  candidatePolicy,
  baselineCarriers = [],
  candidateCarriers = [],
  emptyText = "No policy returned for comparison.",
  compact = false,
  mode = "full",
}: AnyRecord = {}) {
  const panelClass = compact
    ? "policy-panel policy-diff-panel compact"
    : "policy-panel policy-diff-panel";
  const baselineReady = hasDisplayValue(baselinePolicy);
  const candidateReady = hasDisplayValue(candidatePolicy);

  if (!baselineReady || !candidateReady) {
    return `
      <section class="${panelClass}">
        <div class="policy-panel-header">
          <strong>${escapeHtml(title)}</strong>
        </div>
        <div class="policy-empty">${escapeHtml(emptyText)}</div>
      </section>
    `;
  }

  const comparison = comparePolicies(baselinePolicy, candidatePolicy);
  const showBaselineOnlyDetails = mode === "full";
  const hasVisibleDiffs =
    comparison.changed.length > 0 ||
    comparison.candidateOnly.length > 0 ||
    (showBaselineOnlyDetails && comparison.baselineOnly.length > 0);
  const showDeltaNote =
    mode === "delta" && comparison.baselineOnly.length > 0 && hasVisibleDiffs;
  const baselineLabels = renderPolicyLabelPills(baselineCarriers);
  const candidateLabels = renderPolicyLabelPills(candidateCarriers);
  const summary = [
    renderMetaPill(
      "changed",
      comparison.changed.length,
      comparison.changed.length ? "changed" : "",
    ),
    renderMetaPill(
      mode === "delta" ? "step-only" : "added",
      comparison.candidateOnly.length,
      comparison.candidateOnly.length ? "added" : "",
    ),
    renderMetaPill(
      mode === "delta" ? "inherited" : "missing",
      comparison.baselineOnly.length,
      mode === "full" && comparison.baselineOnly.length ? "removed" : "",
    ),
    renderMetaPill("same", comparison.unchangedCount),
  ].join("");

  let emptyMessage = `Policies match across ${comparison.unchangedCount} visible field${comparison.unchangedCount === 1 ? "" : "s"}.`;
  if (
    mode === "delta" &&
    comparison.baselineOnly.length > 0 &&
    comparison.changed.length === 0 &&
    comparison.candidateOnly.length === 0
  ) {
    emptyMessage = `No step-specific deltas. ${comparison.baselineOnly.length} baseline field${comparison.baselineOnly.length === 1 ? "" : "s"} remain inherited or omitted from this step policy.`;
  }

  return `
    <section class="${panelClass}">
      <div class="policy-panel-header">
        <strong>${escapeHtml(title)}</strong>
        <div class="lineage-meta">${summary}</div>
      </div>
      <div class="policy-diff-context">
        <div class="policy-diff-side">
          <span class="muted">Baseline</span>
          <code>${escapeHtml(baselineTitle)}</code>
          ${baselineLabels ? `<div class="lineage-meta">${baselineLabels}</div>` : ""}
        </div>
        <div class="policy-diff-side">
          <span class="muted">Compare</span>
          <code>${escapeHtml(candidateTitle)}</code>
          ${candidateLabels ? `<div class="lineage-meta">${candidateLabels}</div>` : ""}
        </div>
      </div>
      ${
        hasVisibleDiffs
          ? `<div class="policy-diff-list">
              ${
                comparison.changed.length > 0
                  ? `
                    <section class="policy-diff-group">
                      <div class="policy-block-header">
                        <strong>${escapeHtml(mode === "delta" ? "Overrides" : "Changed Fields")}</strong>
                        <span class="muted">${escapeHtml(String(comparison.changed.length))}</span>
                      </div>
                      ${renderPolicyDiffItems(comparison.changed, {
                        tone: "changed",
                        baselineLabel: baselineTitle,
                        candidateLabel: candidateTitle,
                      })}
                    </section>
                  `
                  : ""
              }
              ${
                comparison.candidateOnly.length > 0
                  ? `
                    <section class="policy-diff-group">
                      <div class="policy-block-header">
                        <strong>${escapeHtml(mode === "delta" ? "Step-Specific Fields" : "Added Fields")}</strong>
                        <span class="muted">${escapeHtml(String(comparison.candidateOnly.length))}</span>
                      </div>
                      ${renderPolicyDiffItems(comparison.candidateOnly, {
                        tone: "added",
                        baselineLabel: baselineTitle,
                        candidateLabel: candidateTitle,
                        includeBaseline: false,
                      })}
                    </section>
                  `
                  : ""
              }
              ${
                showBaselineOnlyDetails && comparison.baselineOnly.length > 0
                  ? `
                    <section class="policy-diff-group">
                      <div class="policy-block-header">
                        <strong>Missing Fields</strong>
                        <span class="muted">${escapeHtml(String(comparison.baselineOnly.length))}</span>
                      </div>
                      ${renderPolicyDiffItems(comparison.baselineOnly, {
                        tone: "removed",
                        baselineLabel: baselineTitle,
                        candidateLabel: candidateTitle,
                        includeCandidate: false,
                      })}
                    </section>
                  `
                  : ""
              }
            </div>`
          : `<div class="policy-empty">${escapeHtml(emptyMessage)}</div>`
      }
      ${
        showDeltaNote
          ? `<p class="policy-diff-note">${escapeHtml(
              `${comparison.baselineOnly.length} baseline field${comparison.baselineOnly.length === 1 ? "" : "s"} are inherited or omitted from this step policy.`,
            )}</p>`
          : ""
      }
    </section>
  `;
}

function renderPolicyBlock(title, block) {
  if (!hasDisplayValue(block)) {
    return "";
  }

  const entries = isObject(block)
    ? Object.entries(block).filter(([, value]) => hasDisplayValue(value))
    : [["value", block]];

  if (entries.length === 0) {
    return "";
  }

  return `
    <article class="policy-block">
      <div class="policy-block-header">
        <strong>${escapeHtml(title)}</strong>
        <span class="muted">${escapeHtml(String(entries.length))} field${entries.length === 1 ? "" : "s"}</span>
      </div>
      <div class="policy-grid">
        ${entries
          .map(
            ([key, value]) => `
              <div class="policy-item">
                <span class="muted">${escapeHtml(humanizeKey(key))}</span>
                <code>${escapeHtml(formatPolicyValue(value))}</code>
              </div>
            `,
          )
          .join("")}
      </div>
    </article>
  `;
}

function renderPolicyPanel({
  title,
  policy,
  emptyText = "No policy returned.",
  compact = false,
  labelCarriers = [],
}: AnyRecord = {}) {
  const panelClass = compact ? "policy-panel compact" : "policy-panel";
  const labels = renderPolicyLabelPills(labelCarriers);
  const highlights = renderPolicyHighlights(policy);
  const summary = [labels, highlights].filter(Boolean).join("");

  if (!hasDisplayValue(policy)) {
    return `
      <section class="${panelClass}">
        <div class="policy-panel-header">
          <strong>${escapeHtml(title)}</strong>
        </div>
        <div class="policy-empty">${escapeHtml(emptyText)}</div>
      </section>
    `;
  }

  const blocks = Object.entries(policy)
    .filter(([, value]) => hasDisplayValue(value))
    .map(([key, value]) => renderPolicyBlock(humanizeKey(key), value))
    .join("");

  return `
    <section class="${panelClass}">
      <div class="policy-panel-header">
        <strong>${escapeHtml(title)}</strong>
        ${summary ? `<div class="lineage-meta">${summary}</div>` : ""}
      </div>
      <div class="policy-block-list">
        ${blocks || renderPolicyBlock("Policy", policy)}
      </div>
    </section>
  `;
}

function getPreviewLaunches() {
  return Array.isArray(state.workflowPreview?.launches)
    ? state.workflowPreview.launches
    : [];
}

function findPreviewLaunchForStep(step, sequence = null) {
  const launches = getPreviewLaunches();
  if (!launches.length || !step) {
    return null;
  }

  if (step.sessionId) {
    const bySession = launches.find(
      (launch) => launch?.sessionId && launch.sessionId === step.sessionId,
    );
    if (bySession) {
      return bySession;
    }
  }

  const sequenceIndex = Number.isFinite(sequence)
    ? sequence
    : Number(step.sequence);
  if (Number.isFinite(sequenceIndex)) {
    const byIndex = launches[sequenceIndex];
    if (byIndex && (!step.role || byIndex.role === step.role)) {
      return byIndex;
    }
  }

  const requestedProfile = step.requestedProfileId ?? step.profilePath ?? null;
  if (requestedProfile) {
    const byProfile = launches.find(
      (launch) =>
        launch?.role === step.role &&
        (launch?.requestedProfileId === requestedProfile ||
          launch?.profilePath === requestedProfile),
    );
    if (byProfile) {
      return byProfile;
    }
  }

  return launches.find((launch) => launch?.role === step.role) ?? null;
}

function readFirstField(record, keys = []) {
  for (const key of keys) {
    if (hasDisplayValue(record?.[key])) {
      return record[key];
    }
  }
  return null;
}

function readFirstArrayField(record, keys = []) {
  for (const key of keys) {
    if (Array.isArray(record?.[key])) {
      return record[key];
    }
  }
  return [];
}

function readFirstObjectField(record, keys = []) {
  for (const key of keys) {
    if (isObject(record?.[key])) {
      return record[key];
    }
  }
  return null;
}

function coerceCount(value) {
  if (Array.isArray(value)) {
    return value.length;
  }
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  return null;
}

function inferEventTone(type: unknown, payload: AnyRecord = {}) {
  const text = `${normalizeText(type, "").toLowerCase()} ${normalizeText(payload?.status, "").toLowerCase()}`;
  if (
    text.includes("failed") ||
    text.includes("reject") ||
    text.includes("escalat") ||
    text.includes("error")
  )
    return "failed";
  if (
    text.includes("complete") ||
    text.includes("approved") ||
    text.includes("resolved")
  )
    return "completed";
  if (text.includes("paused") || text.includes("held") || text.includes("hold"))
    return "paused";
  if (
    text.includes("started") ||
    text.includes("pending") ||
    text.includes("running") ||
    text.includes("resume")
  )
    return "running";
  return "neutral";
}

function normalizeRouteArray(payload, keys = []) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!isObject(payload)) {
    return [];
  }
  const preferred = readFirstArrayField(payload, keys);
  if (preferred.length > 0) {
    return preferred;
  }
  const discovered = Object.values(payload).find((value) =>
    Array.isArray(value),
  );
  return Array.isArray(discovered) ? discovered : [];
}

function readNestedValue(source, paths = []) {
  for (const entry of paths) {
    const path = Array.isArray(entry) ? entry : String(entry).split(".");
    let cursor = source;
    let ok = true;
    for (const key of path) {
      if (!isObject(cursor) && !Array.isArray(cursor)) {
        ok = false;
        break;
      }
      cursor = cursor?.[key];
      if (cursor === undefined) {
        ok = false;
        break;
      }
    }
    if (ok && hasDisplayValue(cursor)) {
      return cursor;
    }
  }
  return null;
}

function normalizeRunCenterCollections(payload: AnyRecord = {}) {
  const root = payload?.summary ?? payload?.detail ?? payload ?? {};
  return {
    counts: readFirstObjectField(root, ["counts", "summary", "totals"]) ?? {},
    trendBreakdown:
      readFirstObjectField(root, ["trendBreakdown", "trendSummary"]) ?? {},
    failureBreakdown:
      readFirstObjectField(root, ["failureBreakdown", "failureSummary"]) ?? {},
    flaky: readFirstObjectField(root, ["flaky", "flakySummary"]) ?? {},
    scenarios: normalizeRouteArray(root, [
      "scenarios",
      "scenarioSummaries",
      "scenarioStatus",
      "scenarioItems",
    ]),
    regressions: normalizeRouteArray(root, [
      "regressions",
      "regressionSummaries",
      "regressionStatus",
      "regressionItems",
    ]),
    recentScenarioRuns: normalizeRouteArray(root, [
      "recentScenarioRuns",
      "latestScenarioRuns",
      "scenarioRuns",
    ]),
    recentRegressionRuns: normalizeRouteArray(root, [
      "recentRegressionRuns",
      "latestRegressionRuns",
      "regressionRuns",
    ]),
    selfBuild:
      readFirstObjectField(root, ["selfBuild", "managedWork", "work"]) ?? {},
    latestReports: normalizeRouteArray(root, [
      "latestReports",
      "reportCards",
      "reports",
    ]),
    alerts: readFirstArrayField(root, [
      "alerts",
      "activeAlerts",
      "warnings",
      "issues",
    ]),
    recommendations: readFirstArrayField(root, [
      "recommendations",
      "suggestedActions",
      "operatorRecommendations",
      "guidance",
    ]),
  };
}

function normalizeSuggestedActions(value) {
  const source = Array.isArray(value)
    ? value
    : isObject(value) && Array.isArray(value.actions)
      ? value.actions
      : isObject(value) && Array.isArray(value.items)
        ? value.items
        : hasDisplayValue(value)
          ? [value]
          : [];

  return source
    .map((item) => {
      if (!hasDisplayValue(item)) {
        return null;
      }
      if (typeof item === "string") {
        return {
          action: item,
          reason: "",
          commandHint: "",
          expectedOutcome: "",
          httpHint: "",
        };
      }
      if (!isObject(item)) {
        return {
          action: String(item),
          reason: "",
          commandHint: "",
          expectedOutcome: "",
          httpHint: "",
        };
      }
      return {
        action: normalizeText(
          readFirstField(item, ["action", "label", "title", "name", "command"]),
          "action",
        ),
        reason: normalizeText(
          readFirstField(item, ["reason", "message", "detail", "description"]),
          "",
        ),
        commandHint: normalizeText(
          readFirstField(item, ["commandHint", "command", "hint", "cli"]),
          "",
        ),
        expectedOutcome: normalizeText(
          readFirstField(item, ["expectedOutcome", "expected", "outcome"]),
          "",
        ),
        httpHint: normalizeText(
          readFirstField(item, ["httpHint", "http", "endpoint", "route"]),
          "",
        ),
      };
    })
    .filter((item) => item !== null);
}

function normalizeFailureRecord(value) {
  if (!hasDisplayValue(value)) {
    return null;
  }

  if (!isObject(value)) {
    return {
      classification: "",
      reason: String(value),
      code: "",
      severity: "",
      status: "",
    };
  }

  const classification = normalizeText(
    readFirstField(value, [
      "classification",
      "class",
      "category",
      "type",
      "kind",
      "failureClass",
    ]),
    "",
  );
  const reason = normalizeText(
    readFirstField(value, [
      "reason",
      "message",
      "detail",
      "description",
      "summary",
      "failureReason",
      "error",
    ]),
    "",
  );
  const code = normalizeText(
    readFirstField(value, ["code", "errorCode", "reasonCode", "id"]),
    "",
  );
  const severity = normalizeText(
    readFirstField(value, ["severity", "level", "priority"]),
    "",
  );
  const status = normalizeText(
    readFirstField(value, ["status", "state", "outcome"]),
    "",
  );

  if (!classification && !reason && !code && !severity && !status) {
    return {
      classification: "",
      reason: formatPolicyValue(value),
      code: "",
      severity: "",
      status: "",
    };
  }

  return {
    classification,
    reason,
    code,
    severity,
    status,
  };
}

function pickFailureRecord(...values) {
  for (const value of values) {
    const normalized = normalizeFailureRecord(value);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function summarizeFailureLabel(failure) {
  if (!failure) {
    return "";
  }
  return normalizeText(
    failure.classification || failure.code || failure.reason,
    "",
  );
}

function normalizeAdvisoryEntries(items = [], fallbackType = "advisory") {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item, index) => {
      if (!hasDisplayValue(item)) {
        return null;
      }

      if (typeof item === "string") {
        return {
          id: `${fallbackType}-${index + 1}`,
          type: fallbackType,
          severity: fallbackType === "alert" ? "high" : "",
          title: item,
          detail: "",
          source: "",
          timestamp: "",
        };
      }

      if (!isObject(item)) {
        return {
          id: `${fallbackType}-${index + 1}`,
          type: fallbackType,
          severity: "",
          title: String(item),
          detail: "",
          source: "",
          timestamp: "",
        };
      }

      return {
        id: normalizeText(
          readFirstField(item, ["id", "key", "slug"]),
          `${fallbackType}-${index + 1}`,
        ),
        type: normalizeText(
          readFirstField(item, ["type", "kind"]),
          fallbackType,
        ),
        severity: normalizeText(
          readFirstField(item, ["severity", "level", "priority"]),
          "",
        ),
        title: normalizeText(
          readFirstField(item, ["title", "label", "summary", "name"]),
          `${fallbackType}-${index + 1}`,
        ),
        detail: normalizeText(
          readFirstField(item, ["detail", "message", "reason", "description"]),
          "",
        ),
        source: normalizeText(
          readFirstField(item, ["source", "owner", "area", "scope"]),
          "",
        ),
        timestamp: normalizeText(
          readFirstField(item, ["timestamp", "createdAt", "at", "detectedAt"]),
          "",
        ),
      };
    })
    .filter((item) => item !== null);
}

function renderTrendSnapshotPills(snapshot) {
  if (!isObject(snapshot)) {
    return "";
  }

  const entries = Object.entries(snapshot)
    .filter(([, value]) => hasDisplayValue(value))
    .slice(0, 4);
  return entries
    .map(([key, value]) =>
      renderMetaPill(humanizeKey(key), formatPolicyValue(value)),
    )
    .join("");
}

function renderTrendSnapshotCard(
  snapshot,
  title = "Trend Snapshot",
  emptyText = "No trend snapshot available.",
) {
  if (!hasDisplayValue(snapshot)) {
    return `
      <article class="detail-card compact-empty run-insight-card">
        <div class="event-title"><strong>${escapeHtml(title)}</strong></div>
        <p class="decision-summary">${escapeHtml(emptyText)}</p>
      </article>
    `;
  }

  if (!isObject(snapshot)) {
    return `
      <article class="detail-card compact-empty run-insight-card">
        <div class="event-title"><strong>${escapeHtml(title)}</strong></div>
        <code>${escapeHtml(formatPolicyValue(snapshot))}</code>
      </article>
    `;
  }

  const entries = Object.entries(snapshot).filter(([, value]) =>
    hasDisplayValue(value),
  );
  return `
    <article class="detail-card compact-empty run-insight-card">
      <div class="event-title"><strong>${escapeHtml(title)}</strong></div>
      <div class="trend-grid">
        ${entries
          .slice(0, 10)
          .map(
            ([key, value]) => `
              <div class="trend-item">
                <span class="muted">${escapeHtml(humanizeKey(key))}</span>
                <code>${escapeHtml(formatPolicyValue(value))}</code>
              </div>
            `,
          )
          .join("")}
      </div>
    </article>
  `;
}

function renderFailureCard(
  failure,
  title = "Failure Classification",
  emptyText = "No failure details available.",
) {
  if (!failure) {
    return `
      <article class="detail-card compact-empty run-insight-card">
        <div class="event-title"><strong>${escapeHtml(title)}</strong></div>
        <p class="decision-summary">${escapeHtml(emptyText)}</p>
      </article>
    `;
  }

  return `
    <article class="detail-card compact-empty run-insight-card run-failure-card">
      <div class="event-title">
        <strong>${escapeHtml(title)}</strong>
        ${failure.classification ? renderStatePill(failure.classification, "failed") : ""}
      </div>
      <div class="detail-grid">
        <div><span class="muted">Classification</span><br /><code>${escapeHtml(normalizeText(failure.classification, "-"))}</code></div>
        <div><span class="muted">Code</span><br /><code>${escapeHtml(normalizeText(failure.code, "-"))}</code></div>
        <div><span class="muted">Severity</span><br /><code>${escapeHtml(normalizeText(failure.severity, "-"))}</code></div>
        <div><span class="muted">Status</span><br /><code>${escapeHtml(normalizeText(failure.status, "-"))}</code></div>
      </div>
      <p class="decision-summary">${escapeHtml(normalizeText(failure.reason, "No failure reason provided."))}</p>
    </article>
  `;
}

function renderSuggestedActionsCard(
  actions,
  title = "Suggested Actions",
  emptyText = "No suggested actions available.",
) {
  const normalized = normalizeSuggestedActions(actions);
  if (!normalized.length) {
    return `
      <article class="detail-card compact-empty run-insight-card">
        <div class="event-title"><strong>${escapeHtml(title)}</strong></div>
        <p class="decision-summary">${escapeHtml(emptyText)}</p>
      </article>
    `;
  }

  return `
    <article class="detail-card compact-empty run-insight-card">
      <div class="event-title">
        <strong>${escapeHtml(title)}</strong>
        <span class="muted">${escapeHtml(String(normalized.length))}</span>
      </div>
      <div class="event-list suggested-actions-list">
        ${normalized
          .slice(0, 6)
          .map(
            (item) => `
              <article class="detail-card compact-empty suggested-action-item">
                <div class="event-title">
                  <strong>${escapeHtml(normalizeText(item.action, "action"))}</strong>
                  ${item.commandHint ? `<code>${escapeHtml(item.commandHint)}</code>` : ""}
                </div>
                ${item.reason ? `<p class="decision-summary">${escapeHtml(item.reason)}</p>` : ""}
                ${
                  item.expectedOutcome || item.httpHint
                    ? `<div class="event-meta">
                        ${
                          item.expectedOutcome
                            ? `<code>expected=${escapeHtml(item.expectedOutcome)}</code>`
                            : ""
                        }
                        ${
                          item.httpHint
                            ? `<code>http=${escapeHtml(item.httpHint)}</code>`
                            : ""
                        }
                      </div>`
                    : ""
                }
              </article>
            `,
          )
          .join("")}
      </div>
    </article>
  `;
}

function normalizeRunReportPayload(payload) {
  const root = payload?.detail ?? payload?.summary ?? payload ?? {};
  return {
    topFailureReasons: normalizeRouteArray(root, [
      "topFailureReasons",
      "failureReasons",
      "topFailures",
    ]),
    linkedScenarioRunIds: normalizeRouteArray(root, [
      "linkedScenarioRunIds",
      "scenarioRunIds",
    ]),
    linkedExecutionIds: normalizeRouteArray(root, [
      "linkedExecutionIds",
      "executionIds",
    ]),
    linkedSessionIds: normalizeRouteArray(root, [
      "linkedSessionIds",
      "sessionIds",
    ]),
    artifactSummary:
      readFirstObjectField(root, [
        "artifactSummary",
        "artifacts",
        "artifactCounts",
      ]) ?? {},
    durationSummary:
      readFirstObjectField(root, ["durationSummary", "durations", "timings"]) ??
      {},
    failureSummary:
      readFirstObjectField(root, ["failureSummary", "failure", "summary"]) ??
      {},
    suggestedActions: normalizeSuggestedActions(
      readFirstField(root, [
        "suggestedActions",
        "recommendations",
        "actions",
      ]) ?? root?.suggestedActions,
    ),
    realPiUsed: readFirstField(root, ["realPiUsed", "usesRealPi", "realPi"]),
    reports:
      readFirstObjectField(root, ["reports", "paths", "reportPaths"]) ?? {},
  };
}

function renderSummaryObjectCard(
  value,
  title,
  emptyText = "No structured summary available.",
) {
  if (!hasDisplayValue(value)) {
    return `
      <article class="detail-card compact-empty run-insight-card">
        <div class="event-title"><strong>${escapeHtml(title)}</strong></div>
        <p class="decision-summary">${escapeHtml(emptyText)}</p>
      </article>
    `;
  }

  if (!isObject(value)) {
    return `
      <article class="detail-card compact-empty run-insight-card">
        <div class="event-title"><strong>${escapeHtml(title)}</strong></div>
        <code>${escapeHtml(formatPolicyValue(value))}</code>
      </article>
    `;
  }

  const entries = Object.entries(value)
    .filter(([, item]) => hasDisplayValue(item))
    .slice(0, 10);
  if (entries.length === 0) {
    return `
      <article class="detail-card compact-empty run-insight-card">
        <div class="event-title"><strong>${escapeHtml(title)}</strong></div>
        <p class="decision-summary">${escapeHtml(emptyText)}</p>
      </article>
    `;
  }

  return `
    <article class="detail-card compact-empty run-insight-card">
      <div class="event-title"><strong>${escapeHtml(title)}</strong></div>
      <div class="detail-grid compact-grid">
        ${entries
          .map(
            ([key, item]) => `
              <div>
                <span class="muted">${escapeHtml(humanizeKey(key))}</span><br />
                <code>${escapeHtml(formatPolicyValue(item))}</code>
              </div>
            `,
          )
          .join("")}
      </div>
    </article>
  `;
}

function renderReportSummaryCard(
  reportPayload,
  emptyText = "No regression report payload available.",
) {
  const report = normalizeRunReportPayload(reportPayload);
  const reportPaths = Object.values(report.reports).filter((value) =>
    hasDisplayValue(value),
  );
  const failureRows = report.topFailureReasons
    .map((item) => {
      if (!hasDisplayValue(item)) {
        return null;
      }
      if (typeof item === "string") {
        return {
          label: item,
          severity: "",
          infrastructure: "",
        };
      }
      return {
        label: normalizeText(
          readFirstField(item, ["label", "reason", "classification", "code"]),
          "failure",
        ),
        severity: normalizeText(
          readFirstField(item, ["severity", "level"]),
          "",
        ),
        infrastructure: normalizeText(
          readFirstField(item, ["infrastructure", "infra", "isInfraFailure"]),
          "",
        ),
      };
    })
    .filter((item) => item !== null)
    .slice(0, 6);

  if (
    failureRows.length === 0 &&
    !hasDisplayValue(report.artifactSummary) &&
    !hasDisplayValue(report.durationSummary) &&
    !report.suggestedActions.length &&
    reportPaths.length === 0
  ) {
    return `
      <article class="detail-card compact-empty run-insight-card">
        <div class="event-title"><strong>Regression Report</strong></div>
        <p class="decision-summary">${escapeHtml(emptyText)}</p>
      </article>
    `;
  }

  return `
    <article class="detail-card compact-empty run-insight-card report-summary-card">
      <div class="event-title">
        <strong>Regression Report</strong>
        ${hasDisplayValue(report.realPiUsed) ? renderMetaPill("real-pi", report.realPiUsed ? "yes" : "no", "root") : ""}
      </div>
      ${
        failureRows.length
          ? `<div class="event-list report-failure-list">
              ${failureRows
                .map(
                  (item) => `
                    <div class="report-failure-item">
                      <strong>${escapeHtml(item.label)}</strong>
                      <div class="lineage-meta">
                        ${item.severity ? renderMetaPill("severity", item.severity, "failed") : ""}
                        ${item.infrastructure ? renderMetaPill("infra", item.infrastructure, "paused") : ""}
                      </div>
                    </div>
                  `,
                )
                .join("")}
            </div>`
          : ""
      }
      ${renderSummaryObjectCard(report.durationSummary, "Duration Summary", "No duration summary in the report.")}
      ${renderSummaryObjectCard(report.artifactSummary, "Artifact Summary", "No artifact summary in the report.")}
      ${renderSummaryObjectCard(report.failureSummary, "Failure Summary", "No failure summary in the report.")}
      ${renderSuggestedActionsCard(report.suggestedActions, "Report Recommendations", "No report recommendations returned.")}
      ${renderPathReferenceList(reportPaths, "Report Paths")}
    </article>
  `;
}

function collectGuidanceItems(
  record: AnyRecord = {},
  policy: AnyRecord | null = null,
) {
  const items = [];
  const push = (label, value, tone = "") => {
    if (hasDisplayValue(value)) {
      items.push({ label, value, tone });
    }
  };

  push(
    "Hold Owner",
    readFirstField(record, ["holdOwner", "holdOwnerId", "heldBy", "owner"]),
  );
  push(
    "Ownership Scope",
    readFirstField(record, [
      "holdOwnerRole",
      "ownerRole",
      "ownerType",
      "ownerScope",
    ]),
  );
  push(
    "Hold Timeout At",
    readFirstField(record, [
      "holdTimeoutAt",
      "timeoutAt",
      "deadlineAt",
      "heldUntil",
      "resumeBy",
    ]),
    "paused",
  );
  push(
    "Hold Timeout Ms",
    readFirstField(record, ["holdTimeoutMs", "timeoutMs", "deadlineMs"]),
    "paused",
  );
  push(
    "Operator Guidance",
    readFirstField(record, [
      "operatorGuidance",
      "holdGuidance",
      "timeoutGuidance",
      "guidance",
      "recoveryGuidance",
    ]),
  );

  const workflowPolicy = policy?.workflowPolicy ?? {};
  push(
    "Policy Soft Timeout",
    hasDisplayValue(workflowPolicy.stepSoftTimeoutMs)
      ? `${workflowPolicy.stepSoftTimeoutMs} ms`
      : null,
    "paused",
  );
  push(
    "Policy Hard Timeout",
    hasDisplayValue(workflowPolicy.stepHardTimeoutMs)
      ? `${workflowPolicy.stepHardTimeoutMs} ms`
      : null,
    "held",
  );

  return items;
}

function renderGuidancePanel({
  id = "",
  title,
  record,
  policy,
  emptyText = "No hold ownership or timeout guidance returned.",
}: AnyRecord = {}) {
  const items = collectGuidanceItems(record, policy);
  const idAttr = id ? ` id="${escapeHtml(id)}"` : "";

  if (items.length === 0) {
    return `<div${idAttr} class="operator-guidance empty-state">${escapeHtml(emptyText)}</div>`;
  }

  return `
    <div${idAttr} class="operator-guidance">
      <div class="policy-panel-header">
        <strong>${escapeHtml(title)}</strong>
      </div>
      <div class="guidance-list">
        ${items
          .map(
            (item) => `
              <div class="guidance-item ${escapeHtml(item.tone)}">
                <span class="muted">${escapeHtml(item.label)}</span>
                <code>${escapeHtml(formatPolicyValue(item.value))}</code>
              </div>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function buildDrivePayload({
  wait,
  timeoutInput,
  intervalInput,
}: AnyRecord = {}) {
  return {
    wait: Boolean(wait),
    timeout: parsePositiveInt(timeoutInput?.value) ?? undefined,
    interval: parsePositiveInt(intervalInput?.value) ?? undefined,
  };
}

function getBranchDefinitionsDraft() {
  const text = String(els.branchDefinitions?.value ?? "").trim();
  if (!text) {
    return {
      hasInput: false,
      branches: [],
    };
  }

  const parsed = parseJsonText(text, "Branch specs");
  if (!Array.isArray(parsed)) {
    throw new Error("Branch specs must be a JSON array.");
  }
  if (parsed.length === 0) {
    throw new Error("Branch specs must include at least one branch object.");
  }
  if (!parsed.every((item) => isObject(item))) {
    throw new Error("Each branch spec must be a JSON object.");
  }

  return {
    hasInput: true,
    branches: parsed,
  };
}

function summarizeBranchSpec(branch, index) {
  const tokens = [];
  if (hasDisplayValue(branch?.branchKey)) {
    tokens.push(String(branch.branchKey));
  } else {
    tokens.push(`branch-${index + 1}`);
  }
  if (Array.isArray(branch?.roles) && branch.roles.length > 0) {
    tokens.push(branch.roles.join("+"));
  }
  if (hasDisplayValue(branch?.domainId)) {
    tokens.push(`domain=${branch.domainId}`);
  }
  if (hasDisplayValue(branch?.objective)) {
    tokens.push(String(branch.objective));
  }
  return tokens.join(" · ");
}

function updateBranchSpawnControls() {
  const executionId = state.executionDetail?.execution?.id ?? null;
  if (!executionId) {
    els.branchSpawnSummary.textContent =
      "Provide one or more branch specs to create child executions under the selected execution.";
    els.branchSpawnButton.disabled = true;
    return;
  }

  try {
    const draft = getBranchDefinitionsDraft();
    if (!draft.hasInput) {
      els.branchSpawnSummary.textContent = `Ready to spawn child executions under ${executionId}. Accepted fields include branchKey, roles, objective, domainId, workflowPath, projectPath, invocationId, and maxRoles.`;
      els.branchSpawnButton.disabled = true;
      return;
    }

    const previews = draft.branches
      .slice(0, 2)
      .map((branch, index) => summarizeBranchSpec(branch, index));
    const extraCount = Math.max(draft.branches.length - previews.length, 0);
    els.branchSpawnSummary.textContent = `${draft.branches.length} branch spec${
      draft.branches.length === 1 ? "" : "s"
    } ready for ${executionId}: ${previews.join(" | ")}${extraCount ? ` | +${extraCount} more` : ""}`;
    els.branchSpawnButton.disabled = false;
  } catch (error) {
    els.branchSpawnSummary.textContent = error.message;
    els.branchSpawnButton.disabled = true;
  }
}

function getWorkflowRequestPayload() {
  const domain = els.workflowDomain.value.trim();
  const roles = els.workflowRoles.value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const objective = els.workflowObjective.value.trim();

  return {
    domain,
    roles,
    objective,
    maxRoles: roles.length || 1,
  };
}

function captureWorkflowPreview(invocation: AnyRecord | null, source: string) {
  state.workflowPreview = invocation ?? null;
  state.workflowPreviewError = null;
  state.workflowPreviewDirty = false;
  state.workflowPreviewSource = source ?? null;
}

function markWorkflowPreviewStale() {
  if (state.workflowPreview || state.workflowPreviewError) {
    state.workflowPreviewDirty = true;
    renderWorkflowPreview();
  }
}

function buildExecutionGroups(executions = []) {
  const groups = new Map();
  for (const execution of executions) {
    const groupId = String(execution?.coordinationGroupId ?? "").trim();
    const key = groupId || `standalone:${execution.id}`;
    const existing = groups.get(key) ?? {
      key,
      groupId: groupId || null,
      executions: [],
    };
    existing.executions.push(execution);
    groups.set(key, existing);
  }

  const orderedGroups = Array.from(groups.values())
    .map((group) => ({
      ...group,
      executions: group.executions.sort((left, right) => {
        const leftRank = left.parentExecutionId ? 1 : 0;
        const rightRank = right.parentExecutionId ? 1 : 0;
        return (
          leftRank - rightRank ||
          String(left.id).localeCompare(String(right.id))
        );
      }),
    }))
    .sort((left, right) => {
      if (left.groupId && !right.groupId) return -1;
      if (!left.groupId && right.groupId) return 1;
      return String(left.groupId ?? left.key).localeCompare(
        String(right.groupId ?? right.key),
      );
    });

  return orderedGroups;
}

function isRouteUnavailable(error) {
  const status = Number(error?.status);
  return status === 404 || status === 405 || status === 501;
}

async function optionalApi(path, options = {}) {
  try {
    const payload = await api(path, options);
    return {
      state: "ready",
      payload,
      error: null,
    };
  } catch (error) {
    if (isRouteUnavailable(error)) {
      return {
        state: "unavailable",
        payload: null,
        error: null,
      };
    }
    return {
      state: "error",
      payload: null,
      error: error.message,
    };
  }
}

function getScenarioIdentifier(record, index = 0) {
  return normalizeText(
    readFirstField(record, [
      "id",
      "scenarioId",
      "scenarioKey",
      "slug",
      "name",
      "key",
      "title",
    ]),
    `scenario-${index + 1}`,
  );
}

function _getScenarioStatus(record = {}) {
  return normalizeText(
    readFirstField(record, [
      "status",
      "state",
      "result",
      "latestStatus",
      "lastStatus",
    ]),
    "unknown",
  );
}

function normalizeReferenceValue(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function collectReferenceValues(source, matcher, limit = 16) {
  if (!source || typeof matcher !== "function") {
    return [];
  }

  const queue = [source];
  const seenObjects = new Set();
  const values = [];
  const seenValues = new Set();
  let safety = 0;

  while (queue.length > 0 && values.length < limit && safety < 2000) {
    safety += 1;
    const current = queue.shift();
    if (Array.isArray(current)) {
      for (const item of current) {
        if (isObject(item) || Array.isArray(item)) {
          if (!seenObjects.has(item)) {
            seenObjects.add(item);
            queue.push(item);
          }
        }
      }
      continue;
    }

    if (!isObject(current)) {
      continue;
    }

    for (const [key, rawValue] of Object.entries(current)) {
      const keyLower = String(key).toLowerCase();
      if (matcher(keyLower, rawValue)) {
        if (Array.isArray(rawValue)) {
          for (const item of rawValue) {
            const normalized = normalizeReferenceValue(item);
            if (!normalized || seenValues.has(normalized)) {
              continue;
            }
            seenValues.add(normalized);
            values.push(normalized);
            if (values.length >= limit) {
              break;
            }
          }
        } else {
          const normalized = normalizeReferenceValue(rawValue);
          if (normalized && !seenValues.has(normalized)) {
            seenValues.add(normalized);
            values.push(normalized);
          }
        }
      }

      if (isObject(rawValue) || Array.isArray(rawValue)) {
        if (!seenObjects.has(rawValue)) {
          seenObjects.add(rawValue);
          queue.push(rawValue);
        }
      }
    }
  }

  return values;
}

function extractScenarioRunReferences(source) {
  const scenarioIds = collectReferenceValues(
    source,
    (key) => key === "scenarioid" || key === "scenariokey",
  );
  const runIds = collectReferenceValues(
    source,
    (key) => key === "scenariorunid" || key === "runid",
  );
  const references = [];
  const seen = new Set();

  for (let index = 0; index < runIds.length; index += 1) {
    const runId = runIds[index];
    const scenarioId = scenarioIds[index] ?? scenarioIds[0] ?? null;
    if (!scenarioId || !runId) {
      continue;
    }
    const key = `${scenarioId}::${runId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    references.push({ scenarioId, runId });
  }

  return references;
}

function extractHistoryReferences(payload = {}) {
  const references = {
    executionIds: collectReferenceValues(
      payload,
      (key) =>
        key === "executionid" ||
        key === "targetexecutionid" ||
        key === "parentexecutionid",
    ),
    sessionIds: collectReferenceValues(
      payload,
      (key) =>
        key === "sessionid" ||
        key === "targetsessionid" ||
        key === "parentsessionid",
    ),
    stepIds: collectReferenceValues(
      payload,
      (key) => key === "stepid" || key === "targetstepid",
    ),
    auditIds: collectReferenceValues(payload, (key) => key === "auditid"),
    escalationIds: collectReferenceValues(
      payload,
      (key) => key === "escalationid",
    ),
    regressionRunIds: collectReferenceValues(
      payload,
      (key) => key === "regressionrunid",
    ),
    scenarioRuns: extractScenarioRunReferences(payload),
    artifactPaths: collectReferenceValues(
      payload,
      (key, value) =>
        (key.includes("artifact") ||
          key.endsWith("path") ||
          key === "json" ||
          key === "markdown") &&
        typeof value === "string" &&
        value.includes("/"),
    ),
    reportPaths: collectReferenceValues(
      payload,
      (key, value) =>
        (key.includes("report") || key === "json" || key === "markdown") &&
        typeof value === "string" &&
        value.includes("/"),
    ),
  };

  const dedupePaths = (values = []) => Array.from(new Set(values));
  references.artifactPaths = dedupePaths(references.artifactPaths);
  references.reportPaths = dedupePaths(references.reportPaths);
  return references;
}

function normalizeExecutionHistoryRows(history) {
  const records = normalizeRouteArray(history, [
    "history",
    "entries",
    "events",
    "timeline",
    "items",
    "records",
  ]);
  const rows = [];

  records.forEach((record, index) => {
    const payload = isObject(record) ? record : { value: record };
    const timestamp = readFirstField(payload, [
      "timestamp",
      "createdAt",
      "occurredAt",
      "recordedAt",
      "updatedAt",
      "at",
    ]);
    const parsed = parseTimestamp(timestamp);
    if (parsed === null) {
      return;
    }
    const type =
      readFirstField(payload, [
        "label",
        "type",
        "eventType",
        "action",
        "kind",
        "name",
      ]) ?? "history";
    const kind = normalizeText(
      readFirstField(payload, ["kind", "type", "eventType"]),
      "history",
    );
    const status = readFirstField(payload, [
      "status",
      "state",
      "result",
      "outcome",
    ]);
    const details = [
      readFirstField(payload, ["stepId", "step", "stepKey"]),
      readFirstField(payload, ["sessionId", "session", "sessionKey"]),
      readFirstField(payload, ["executionId", "runId", "invocationId"]),
      status,
    ]
      .filter((value) => hasDisplayValue(value))
      .map((value) => String(value));
    const summaryPayload = readFirstObjectField(payload, [
      "payload",
      "detail",
      "metadata",
      "meta",
      "context",
    ]);
    if (summaryPayload && Object.keys(summaryPayload).length > 0) {
      details.push(JSON.stringify(summaryPayload));
    }
    rows.push({
      key: normalizeText(
        readFirstField(payload, ["id", "eventId"]),
        `${parsed}-${index}`,
      ),
      ts: parsed,
      timestamp,
      title: normalizeText(type, "history"),
      meta: details.join(" · "),
      tone: inferEventTone(type, { status }),
      sortBias: Number(payload?.eventIndex ?? payload?.index ?? index),
      kind,
      status: normalizeText(status, ""),
      raw: payload,
      references: extractHistoryReferences(payload),
    });
  });

  return rows.sort(
    (left, right) => left.ts - right.ts || left.sortBias - right.sortBias,
  );
}

async function api(path: string, options: RequestInit = {}) {
  const response = await fetch(`/api${path}`, {
    headers: {
      "content-type": "application/json",
    },
    ...options,
  });

  const text = await response.text();
  let payload: AnyRecord = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }
  if (!response.ok) {
    const error = new Error(
      payload.message || payload.error || `request failed: ${response.status}`,
    );
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function renderStatus(status) {
  const runCenter = normalizeRunCenterCollections(state.runCenter ?? {});
  const runCenterScenarioCount =
    coerceCount(runCenter.counts?.scenarios) ?? runCenter.scenarios.length;
  const runCenterRegressionCount =
    coerceCount(runCenter.counts?.regressions) ?? runCenter.regressions.length;
  els.sessionCount.textContent = String(status.sessionCount ?? "-");
  els.eventCount.textContent = String(status.eventCount ?? "-");
  const states = Object.entries(status.byState ?? {})
    .map(([key, value]) => `${key}:${value}`)
    .join(" · ");
  els.stateSummary.textContent = states || "-";
  els.executionCount.textContent = String(state.executions.length);
  els.coordinationCount.textContent = String(
    uniqueCoordinationGroupCount(state.executions),
  );
  if (els.scenarioCount) {
    els.scenarioCount.textContent =
      state.runCenterState === "ready"
        ? String(runCenterScenarioCount)
        : state.scenarioRouteState === "ready"
          ? String(state.scenarios.length)
          : state.scenarioRouteState === "unavailable"
            ? "n/a"
            : state.scenarioRouteState === "error"
              ? "err"
              : "-";
  }
  if (els.regressionCount) {
    els.regressionCount.textContent =
      state.runCenterState === "ready"
        ? String(runCenterRegressionCount)
        : state.regressionRouteState === "ready"
          ? String(state.regressions.length)
          : state.regressionRouteState === "unavailable"
            ? "n/a"
            : state.regressionRouteState === "error"
              ? "err"
              : "-";
  }
}

function renderExecutions() {
  if (state.executionListError) {
    els.executionSubtitle.textContent = "Execution API unavailable";
    els.executionList.innerHTML = `<div class="detail-card empty-state">Failed to load executions: ${escapeHtml(state.executionListError)}</div>`;
    return;
  }

  els.executionSubtitle.textContent = `${state.executions.length} execution${state.executions.length === 1 ? "" : "s"}`;

  if (state.executions.length === 0) {
    els.executionList.innerHTML = `<div class="detail-card empty-state">No executions yet.</div>`;
    return;
  }

  const groups = buildExecutionGroups(state.executions);
  els.executionList.innerHTML = groups
    .map((group) => {
      const summary = summarizeStates(group.executions);
      const rootCount = group.executions.filter(
        (execution) => !execution.parentExecutionId,
      ).length;
      const childCount = group.executions.filter(
        (execution) => execution.parentExecutionId,
      ).length;
      return `
        <section class="execution-group-card ${group.groupId ? "grouped" : "standalone"}">
          <div class="execution-group-header">
            <div>
              <strong>${escapeHtml(group.groupId ?? "Standalone Execution")}</strong>
              <div class="execution-group-meta">
                <code>${escapeHtml(group.groupId ? `coordination=${group.groupId}` : (group.executions[0]?.id ?? ""))}</code>
                <span class="muted">${escapeHtml(summary || "no states")}</span>
              </div>
            </div>
            <div class="execution-group-badges">
              ${renderMetaPill("roots", rootCount, "root")}
              ${renderMetaPill("children", childCount, childCount > 0 ? "child" : "")}
              ${renderMetaPill("count", group.executions.length)}
            </div>
          </div>
          <div class="execution-group-list">
            ${group.executions
              .map((execution) => {
                const activeClass =
                  execution.id === state.selectedExecutionId ? "active" : "";
                const modeClass = deriveExecutionMode(execution);
                const parentLabel = execution.parentExecutionId
                  ? `parent=${execution.parentExecutionId}`
                  : "root";
                return `
                  <article class="execution-item session-item ${activeClass} ${modeClass}" data-execution-id="${escapeHtml(execution.id)}">
                    <div class="session-title">
                      <strong>${escapeHtml(execution.id)}</strong>
                      ${renderStatePill(execution.state)}
                    </div>
                    <div class="session-meta">
                      <span class="muted">workflow=${escapeHtml(normalizeText(execution.workflowId))} · domain=${escapeHtml(normalizeText(execution.domainId))}</span>
                      <code>project=${escapeHtml(normalizeText(execution.projectId))}</code>
                      <code>${escapeHtml(parentLabel)}</code>
                      <code>step=${Number(execution.currentStepIndex ?? 0) + 1}</code>
                      ${
                        execution.holdReason
                          ? `<code>hold=${escapeHtml(normalizeText(execution.holdReason))}</code>`
                          : ""
                      }
                    </div>
                    <div class="lineage-meta">
                      ${renderExecutionModePills(execution)}
                      ${renderExecutionProjectMetadataPills(execution)}
                    </div>
                  </article>
                `;
              })
              .join("")}
          </div>
        </section>
      `;
    })
    .join("");

  for (const item of els.executionList.querySelectorAll(
    "[data-execution-id]",
  )) {
    item.addEventListener("click", () => {
      state.selectedExecutionId = item.dataset.executionId;
      connectExecutionEventStream();
      refresh().catch((error) => console.error(error));
    });
  }
}

function renderScenarioStatus(record: AnyRecord = {}) {
  const run = record.latestRun ?? null;
  const status = run?.status ?? "idle";
  return renderStatePill(status);
}

function buildExecutionHref(executionId) {
  return `/api/orchestrator/executions/${encodeURIComponent(executionId)}`;
}

function buildSessionHref(sessionId) {
  return `/api/sessions/${encodeURIComponent(sessionId)}?limit=20`;
}

function buildScenarioRunArtifactsHref(scenarioId, runId) {
  return `/api/orchestrator/scenarios/${encodeURIComponent(scenarioId)}/runs/${encodeURIComponent(runId)}/artifacts`;
}

function buildScenarioRunByIdHref(runId) {
  return `/api/orchestrator/scenario-runs/${encodeURIComponent(runId)}`;
}

function buildScenarioRunArtifactsByIdHref(runId) {
  return `/api/orchestrator/scenario-runs/${encodeURIComponent(runId)}/artifacts`;
}

function buildRegressionRunByIdHref(runId) {
  return `/api/orchestrator/regression-runs/${encodeURIComponent(runId)}`;
}

function buildRegressionReportByRunIdHref(runId) {
  return `/api/orchestrator/regression-runs/${encodeURIComponent(runId)}/report`;
}

function buildScenarioTrendHref(scenarioId) {
  return `/api/orchestrator/scenarios/${encodeURIComponent(scenarioId)}/trends`;
}

function buildRegressionTrendHref(regressionId) {
  return `/api/orchestrator/regressions/${encodeURIComponent(regressionId)}/trends`;
}

function buildRegressionRunsHref(regressionId) {
  return `/api/orchestrator/regressions/${encodeURIComponent(regressionId)}/runs`;
}

function _buildSelfBuildSummaryHref() {
  return "/api/orchestrator/self-build/summary";
}

function buildWorkItemHref(itemId) {
  return `/api/orchestrator/work-items/${encodeURIComponent(itemId)}`;
}

function buildWorkItemRunsHref(itemId) {
  return `/api/orchestrator/work-items/${encodeURIComponent(itemId)}/runs`;
}

function buildWorkItemRunHref(runId) {
  return `/api/orchestrator/work-item-runs/${encodeURIComponent(runId)}`;
}

function buildWorkItemRunProposalHref(runId) {
  return `/api/orchestrator/work-item-runs/${encodeURIComponent(runId)}/proposal`;
}

function buildProposalHref(proposalId) {
  return `/api/orchestrator/proposal-artifacts/${encodeURIComponent(proposalId)}`;
}

function buildSessionArtifactHref(sessionId, artifactName) {
  return `/api/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifactName)}`;
}

function renderPathReferenceList(paths = [], title = "References") {
  if (!Array.isArray(paths) || paths.length === 0) {
    return "";
  }

  return `
    <article class="detail-card compact-empty">
      <div class="event-title">
        <strong>${escapeHtml(title)}</strong>
        <span class="muted">${escapeHtml(String(paths.length))}</span>
      </div>
      <div class="event-meta">
        ${paths
          .map((pathValue) => {
            const target = String(pathValue);
            const href = `/${target.replace(/^\/+/, "")}`;
            return `
              <div class="reference-row">
                <code>${escapeHtml(target)}</code>
                <a class="inline-link" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">open</a>
              </div>
            `;
          })
          .join("")}
      </div>
    </article>
  `;
}

function renderScenarios() {
  if (!els.scenarioList) {
    return;
  }
  if (state.scenarioRouteState === "unavailable") {
    els.scenarioSubtitle.textContent = "Scenario routes unavailable";
    els.scenarioList.innerHTML = `<div class="detail-card empty-state">Scenario routes are not available from the orchestrator service.</div>`;
    return;
  }
  if (state.scenarioRouteState === "error") {
    els.scenarioSubtitle.textContent = "Scenario routes failed";
    els.scenarioList.innerHTML = `<div class="detail-card empty-state">Failed to load scenarios: ${escapeHtml(state.scenarioRouteError)}</div>`;
    return;
  }
  els.scenarioSubtitle.textContent = `${state.scenarios.length} scenario${state.scenarios.length === 1 ? "" : "s"}`;
  if (state.scenarios.length === 0) {
    els.scenarioList.innerHTML = `<div class="detail-card empty-state">No scenarios registered.</div>`;
    return;
  }
  els.scenarioList.innerHTML = state.scenarios
    .map(
      (scenario) => `
    <article class="session-item ${scenario.id === state.selectedScenarioId ? "active" : ""}" data-scenario-id="${escapeHtml(scenario.id)}">
      <div class="session-title">
        <strong>${escapeHtml(scenario.label ?? scenario.id)}</strong>
        ${renderScenarioStatus(scenario)}
      </div>
      <div class="session-meta">
        <code>id=${escapeHtml(scenario.id)}</code>
        <code>domain=${escapeHtml(normalizeText(scenario.domain))}</code>
        <code>workflow=${escapeHtml(normalizeText(scenario.workflow))}</code>
      </div>
      <div class="lineage-meta">
        ${renderMetaPill("roles", Array.isArray(scenario.roles) ? scenario.roles.length : 0)}
        ${scenario.realPiEligible ? renderMetaPill("real-pi", "yes", "root") : renderMetaPill("real-pi", "no")}
      </div>
    </article>
  `,
    )
    .join("");
  for (const item of els.scenarioList.querySelectorAll("[data-scenario-id]")) {
    item.addEventListener("click", () => {
      state.selectedScenarioId = item.dataset.scenarioId;
      refresh().catch((error) => console.error(error));
    });
  }
}

function renderScenarioDetail() {
  if (!els.scenarioDetail) {
    return;
  }
  if (state.scenarioRouteState === "unavailable") {
    els.scenarioDetail.className = "detail-card empty-state";
    els.scenarioDetail.textContent =
      "Scenario detail is unavailable because the orchestrator route is not exposed.";
    return;
  }
  if (state.scenarioDetailState === "error") {
    els.scenarioDetail.className = "detail-card empty-state";
    els.scenarioDetail.textContent = `Failed to load scenario detail: ${state.scenarioDetailError}`;
    return;
  }
  const scenario = state.scenarioDetail?.scenario ?? null;
  if (!scenario) {
    els.scenarioDetail.className = "detail-card empty-state";
    els.scenarioDetail.textContent =
      "Select a scenario to inspect latest run history and launch it through the orchestrator.";
    return;
  }

  const scenarioRuns = Array.isArray(state.scenarioRuns)
    ? state.scenarioRuns
    : [];
  const selectedRun =
    scenarioRuns.find((run) => run.id === state.selectedScenarioRunId) ??
    scenarioRuns[0] ??
    scenario.latestRun ??
    null;
  const latestRun = scenario.latestRun ?? scenarioRuns[0] ?? null;
  const runArtifacts = state.scenarioRunArtifacts?.executions ?? [];
  const runSummary = selectedRun?.assertionSummary ?? {};
  const selectedRunTrendSnapshot =
    readFirstField(selectedRun ?? {}, [
      "trendSnapshot",
      "trend",
      "latestTrend",
      "trendSummary",
    ]) ??
    readFirstField(runSummary ?? {}, [
      "trendSnapshot",
      "trend",
      "latestTrend",
      "trendSummary",
    ]);
  const selectedRunFailure = pickFailureRecord(
    selectedRun?.failure,
    selectedRun?.latestFailure,
    selectedRun?.metadata?.failure,
    runSummary?.failure,
  );
  const selectedRunSuggestedActions = normalizeSuggestedActions(
    readFirstField(selectedRun ?? {}, [
      "suggestedActions",
      "latestSuggestedActions",
      "recommendations",
    ]) ??
      selectedRun?.metadata?.suggestedActions ??
      runSummary?.suggestedActions,
  );
  const runErrorMessage =
    state.scenarioRunsState === "error"
      ? `Failed to load runs: ${state.scenarioRunsError}`
      : null;

  els.scenarioDetail.className = "detail-card";
  els.scenarioDetail.innerHTML = `
    <div class="session-title">
      <strong>${escapeHtml(scenario.label ?? scenario.id)}</strong>
      ${renderScenarioStatus(scenario)}
    </div>
    <div class="detail-grid">
      <div><span class="muted">Scenario ID</span><br /><code>${escapeHtml(scenario.id)}</code></div>
      <div><span class="muted">Domain</span><br /><code>${escapeHtml(normalizeText(scenario.domain))}</code></div>
      <div><span class="muted">Workflow</span><br /><code>${escapeHtml(normalizeText(scenario.workflow))}</code></div>
      <div><span class="muted">Latest Run</span><br /><code>${escapeHtml(normalizeText(latestRun?.id))}</code></div>
    </div>
    <p class="tree-objective">${escapeHtml(normalizeText(scenario.objectiveTemplate, "No objective template."))}</p>
    <div class="control-row">
      <button type="button" id="scenario-run-button" class="primary-button">Run Scenario</button>
      <button type="button" id="scenario-run-stub-button" class="secondary-button">Run Scenario (Stub)</button>
    </div>
    <div class="lineage-meta">
      ${renderMetaPill("roles", Array.isArray(scenario.roles) ? scenario.roles.join(", ") : "-")}
      ${renderMetaPill("runs", scenarioRuns.length)}
      ${selectedRun?.usesRealPi ? renderMetaPill("real-pi", "yes", "root") : renderMetaPill("real-pi", "no")}
    </div>
    ${runErrorMessage ? `<div class="detail-card empty-state compact-empty">${escapeHtml(runErrorMessage)}</div>` : ""}
    <section class="history-stack run-history-list">
      ${
        scenarioRuns
          .slice(0, 8)
          .map(
            (run) => `
        <article class="event-item run-history-item ${run.id === state.selectedScenarioRunId ? "active" : ""}" data-scenario-run-id="${escapeHtml(run.id)}">
          <div class="event-title">
            <strong>${escapeHtml(normalizeText(run.status))}</strong>
            <code>${escapeHtml(normalizeText(run.id))}</code>
          </div>
          <div class="event-meta">
            <code>started=${escapeHtml(normalizeText(run.startedAt))}</code>
            <code>ended=${escapeHtml(normalizeText(run.endedAt))}</code>
            <code>launcher=${escapeHtml(normalizeText(run.launcher))}</code>
            <code>executions=${escapeHtml(String((run.executions ?? []).length))}</code>
            <code>sessions=${escapeHtml(String(run.executions?.reduce((acc, item) => acc + Number(item.sessionCount ?? 0), 0) ?? 0))}</code>
          </div>
          <div class="lineage-meta">
            <a class="inline-link" href="${escapeHtml(buildScenarioRunArtifactsHref(scenario.id, run.id))}" target="_blank" rel="noreferrer">artifacts json</a>
          </div>
        </article>
      `,
          )
          .join("") ||
        `<div class="detail-card empty-state">No scenario runs recorded yet.</div>`
      }
    </section>
    ${
      selectedRun
        ? `
          <section class="run-drilldown-panel">
            <div class="panel-header nested">
              <h3>Scenario Run Drilldown</h3>
              ${renderStatePill(selectedRun.status ?? "unknown")}
            </div>
            <div class="detail-grid">
              <div><span class="muted">Run ID</span><br /><code>${escapeHtml(normalizeText(selectedRun.id))}</code></div>
              <div><span class="muted">Launcher</span><br /><code>${escapeHtml(normalizeText(selectedRun.launcher))}</code></div>
              <div><span class="muted">Started</span><br /><code>${escapeHtml(normalizeText(selectedRun.startedAt))}</code></div>
              <div><span class="muted">Ended</span><br /><code>${escapeHtml(normalizeText(selectedRun.endedAt))}</code></div>
              <div><span class="muted">Requested By</span><br /><code>${escapeHtml(normalizeText(selectedRun.requestedBy))}</code></div>
              <div><span class="muted">Trigger</span><br /><code>${escapeHtml(normalizeText(selectedRun.triggerSource))}</code></div>
            </div>
            <div class="lineage-meta">
              ${renderMetaPill("step-count", runSummary.stepCount ?? 0)}
              ${renderMetaPill("session-count", runSummary.sessionCount ?? 0)}
              ${renderMetaPill("success", runSummary.success ? "yes" : "no", runSummary.success ? "root" : "failed")}
              ${renderMetaPill("governance", runSummary.governanceState ? "yes" : "no", runSummary.governanceState ? "governance" : "")}
              ${renderTrendSnapshotPills(selectedRunTrendSnapshot)}
              ${
                selectedRunFailure
                  ? renderMetaPill(
                      "failure",
                      summarizeFailureLabel(selectedRunFailure),
                      "failed",
                    )
                  : ""
              }
              ${
                selectedRunSuggestedActions.length > 0
                  ? renderMetaPill(
                      "actions",
                      selectedRunSuggestedActions.length,
                      "changed",
                    )
                  : ""
              }
            </div>
            ${renderTrendSnapshotCard(selectedRunTrendSnapshot, "Trend Snapshot", "No trend snapshot recorded for this run.")}
            ${renderFailureCard(selectedRunFailure, "Failure Classification", "No failure classification recorded for this run.")}
            ${renderSuggestedActionsCard(selectedRunSuggestedActions, "Suggested Actions", "No suggested actions recorded for this run.")}
            <div class="event-list">
              ${
                (selectedRun.executions ?? [])
                  .map(
                    (item) => `
                <article class="detail-card compact-empty">
                  <div class="event-title">
                    <strong>${escapeHtml(normalizeText(item.executionId))}</strong>
                    <button type="button" class="secondary-button jump-button" data-jump-execution-id="${escapeHtml(normalizeText(item.executionId))}">open execution</button>
                  </div>
                  <div class="event-meta">
                    <code>sessions=${escapeHtml(String(item.sessionCount ?? 0))}</code>
                    <code>linked-at=${escapeHtml(normalizeText(item.createdAt))}</code>
                  </div>
                </article>
              `,
                  )
                  .join("") ||
                `<div class="detail-card empty-state compact-empty">No execution links recorded for this run.</div>`
              }
            </div>
            <div class="panel-header nested">
              <h3>Run Artifacts</h3>
              <span class="muted">/scenarios/:id/runs/:runId/artifacts</span>
            </div>
            ${
              state.scenarioRunArtifactsState === "unavailable"
                ? `<div class="detail-card empty-state compact-empty">Run artifact route is not available.</div>`
                : state.scenarioRunArtifactsState === "error"
                  ? `<div class="detail-card empty-state compact-empty">Failed to load run artifacts: ${escapeHtml(state.scenarioRunArtifactsError)}</div>`
                  : runArtifacts.length === 0
                    ? `<div class="detail-card empty-state compact-empty">No scenario artifact references returned for this run.</div>`
                    : `
                      <div class="event-list">
                        ${runArtifacts
                          .map(
                            (executionEntry) => `
                              <article class="decision-card run-drilldown-card">
                                <div class="event-title">
                                  <strong>${escapeHtml(normalizeText(executionEntry.executionId))}</strong>
                                  <button type="button" class="secondary-button jump-button" data-jump-execution-id="${escapeHtml(normalizeText(executionEntry.executionId))}">open execution</button>
                                </div>
                                <div class="event-meta">
                                  <code>sessions=${escapeHtml(String(executionEntry.sessionCount ?? 0))}</code>
                                </div>
                                <div class="event-list">
                                  ${(executionEntry.artifacts ?? [])
                                    .map(
                                      (artifactEntry) => `
                                    <article class="detail-card compact-empty">
                                      <div class="event-title">
                                        <strong>${escapeHtml(normalizeText(artifactEntry.sessionId))}</strong>
                                        <button type="button" class="secondary-button jump-button" data-jump-session-id="${escapeHtml(normalizeText(artifactEntry.sessionId))}">open session</button>
                                      </div>
                                      <div class="artifact-meta">
                                        ${(
                                          Object.entries(
                                            artifactEntry.artifacts ?? {},
                                          ) as Array<[string, AnyRecord]>
                                        )
                                          .map(
                                            ([name, item]) => `
                                          <div class="reference-row">
                                            <code>${escapeHtml(name)}=${escapeHtml(normalizeText(item.path))}</code>
                                            ${
                                              item?.exists
                                                ? `<a class="inline-link" href="${escapeHtml(buildSessionArtifactHref(artifactEntry.sessionId, name))}" target="_blank" rel="noreferrer">open</a>`
                                                : `<span class="muted">missing</span>`
                                            }
                                          </div>
                                        `,
                                          )
                                          .join("")}
                                      </div>
                                    </article>
                                  `,
                                    )
                                    .join("")}
                                </div>
                              </article>
                            `,
                          )
                          .join("")}
                      </div>
                    `
            }
          </section>
        `
        : `<div class="detail-card empty-state compact-empty">Select a scenario run to inspect drilldown details.</div>`
    }
  `;
  const runButton = document.getElementById("scenario-run-button");
  const runStubButton = document.getElementById("scenario-run-stub-button");
  runButton?.addEventListener("click", () =>
    runScenario(false).catch((error) => alert(error.message)),
  );
  runStubButton?.addEventListener("click", () =>
    runScenario(true).catch((error) => alert(error.message)),
  );

  for (const item of els.scenarioDetail.querySelectorAll(
    "[data-scenario-run-id]",
  )) {
    item.addEventListener("click", () => {
      state.selectedScenarioRunId = item.dataset.scenarioRunId;
      refresh().catch((error) => console.error(error));
    });
  }

  for (const button of els.scenarioDetail.querySelectorAll(
    "[data-jump-execution-id]",
  )) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const executionId = button.dataset.jumpExecutionId;
      if (!executionId) {
        return;
      }
      state.selectedExecutionId = executionId;
      connectExecutionEventStream();
      refresh().catch((error) => console.error(error));
    });
  }

  for (const button of els.scenarioDetail.querySelectorAll(
    "[data-jump-session-id]",
  )) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const sessionId = button.dataset.jumpSessionId;
      if (!sessionId) {
        return;
      }
      state.selectedSessionId = sessionId;
      connectEventStream();
      refresh().catch((error) => console.error(error));
    });
  }
}

function renderRegressions() {
  if (!els.regressionList) {
    return;
  }
  if (state.regressionRouteState === "unavailable") {
    els.regressionSubtitle.textContent = "Regression routes unavailable";
    els.regressionList.innerHTML = `<div class="detail-card empty-state">Regression routes are not available from the orchestrator service.</div>`;
    return;
  }
  if (state.regressionRouteState === "error") {
    els.regressionSubtitle.textContent = "Regression routes failed";
    els.regressionList.innerHTML = `<div class="detail-card empty-state">Failed to load regressions: ${escapeHtml(state.regressionRouteError)}</div>`;
    return;
  }
  els.regressionSubtitle.textContent = `${state.regressions.length} regression${state.regressions.length === 1 ? "" : "s"}`;
  if (state.regressions.length === 0) {
    els.regressionList.innerHTML = `<div class="detail-card empty-state">No regression profiles registered.</div>`;
    return;
  }

  const selectedRegression =
    state.regressions.find(
      (regression) => regression.id === state.selectedRegressionId,
    ) ??
    state.regressions[0] ??
    null;
  const selectedRegressionRuns = Array.isArray(state.regressionRuns)
    ? state.regressionRuns
    : [];
  const selectedRegressionRun =
    selectedRegressionRuns.find(
      (run) => run.id === state.selectedRegressionRunId,
    ) ??
    selectedRegressionRuns[0] ??
    selectedRegression?.latestRun ??
    null;
  const selectedRegressionTrendSnapshot =
    readFirstField(selectedRegressionRun ?? {}, [
      "trendSnapshot",
      "trend",
      "latestTrend",
      "trendSummary",
    ]) ??
    readFirstField(selectedRegressionRun?.summary ?? {}, [
      "trendSnapshot",
      "trend",
      "latestTrend",
      "trendSummary",
    ]);
  const selectedRegressionFailure = pickFailureRecord(
    selectedRegressionRun?.failure,
    selectedRegressionRun?.latestFailure,
    selectedRegressionRun?.summary?.failure,
    selectedRegressionRun?.metadata?.failure,
  );
  const selectedRegressionSuggestedActions = normalizeSuggestedActions(
    readFirstField(selectedRegressionRun ?? {}, [
      "suggestedActions",
      "latestSuggestedActions",
      "recommendations",
    ]) ??
      selectedRegressionRun?.summary?.suggestedActions ??
      selectedRegressionRun?.metadata?.suggestedActions,
  );
  const reportPaths = Object.values(
    selectedRegressionRun?.metadata?.reports ?? {},
  ).filter((value) => hasDisplayValue(value));

  els.regressionList.innerHTML = `
    ${state.regressions
      .map(
        (regression) => `
        <article class="decision-card run-history-item ${regression.id === state.selectedRegressionId ? "active" : ""}" data-regression-id="${escapeHtml(regression.id)}">
          <div class="event-title">
            <strong>${escapeHtml(regression.label ?? regression.id)}</strong>
            ${renderStatePill(regression.latestRun?.status ?? "idle")}
          </div>
          <div class="event-meta">
            <code>${escapeHtml(regression.id)}</code>
            <code>scenarios=${escapeHtml(String((regression.scenarios ?? []).length))}</code>
            <code>real-pi=${escapeHtml(regression.realPiRequired ? "yes" : "no")}</code>
          </div>
          <div class="lineage-meta">
            ${renderMetaPill("latest", normalizeText(regression.latestRun?.id))}
            ${renderMetaPill("passed", regression.latestRun?.summary?.passCount ?? 0, "root")}
            ${renderMetaPill("failed", regression.latestRun?.summary?.failCount ?? 0, regression.latestRun?.summary?.failCount ? "failed" : "")}
          </div>
          <div class="control-row">
            <button type="button" class="secondary-button regression-run-button" data-run-regression-id="${escapeHtml(regression.id)}">Run</button>
            <button type="button" class="secondary-button regression-run-stub-button" data-run-regression-id="${escapeHtml(regression.id)}">Run (Stub)</button>
          </div>
        </article>
      `,
      )
      .join("")}
    <article class="detail-card run-drilldown-panel">
      <div class="panel-header nested">
        <h3>Regression Run Drilldown</h3>
        ${
          selectedRegression
            ? `<a class="inline-link" href="${escapeHtml(buildRegressionRunsHref(selectedRegression.id))}" target="_blank" rel="noreferrer">runs json</a>`
            : ""
        }
      </div>
      ${
        !selectedRegression
          ? `<div class="detail-card empty-state compact-empty">Select a regression profile to inspect runs.</div>`
          : `
            <div class="detail-grid">
              <div><span class="muted">Regression ID</span><br /><code>${escapeHtml(normalizeText(selectedRegression.id))}</code></div>
              <div><span class="muted">Real PI Required</span><br /><code>${escapeHtml(selectedRegression.realPiRequired ? "yes" : "no")}</code></div>
              <div class="detail-span"><span class="muted">Scenarios</span><br /><code>${escapeHtml((selectedRegression.scenarios ?? []).join(", ") || "-")}</code></div>
            </div>
            ${
              state.regressionRunsState === "error"
                ? `<div class="detail-card empty-state compact-empty">Failed to load regression runs: ${escapeHtml(state.regressionRunsError)}</div>`
                : ""
            }
            <section class="history-stack run-history-list">
              ${
                selectedRegressionRuns
                  .slice(0, 8)
                  .map(
                    (run) => `
                      <article class="event-item run-history-item ${run.id === state.selectedRegressionRunId ? "active" : ""}" data-regression-run-id="${escapeHtml(run.id)}">
                        <div class="event-title">
                          <strong>${escapeHtml(normalizeText(run.status))}</strong>
                          <code>${escapeHtml(normalizeText(run.id))}</code>
                        </div>
                        <div class="event-meta">
                          <code>started=${escapeHtml(normalizeText(run.startedAt))}</code>
                          <code>ended=${escapeHtml(normalizeText(run.endedAt))}</code>
                          <code>pass=${escapeHtml(String(run.summary?.passCount ?? 0))}</code>
                          <code>fail=${escapeHtml(String(run.summary?.failCount ?? 0))}</code>
                          <code>skipped=${escapeHtml(String(run.summary?.skippedCount ?? 0))}</code>
                        </div>
                      </article>
                    `,
                  )
                  .join("") ||
                `<div class="detail-card empty-state compact-empty">No regression runs recorded yet.</div>`
              }
            </section>
            ${
              selectedRegressionRun
                ? `
                  <div class="panel-header nested">
                    <h3>Run ${escapeHtml(normalizeText(selectedRegressionRun.id))}</h3>
                    ${renderStatePill(selectedRegressionRun.status ?? "unknown")}
                  </div>
                  <div class="detail-grid">
                    <div><span class="muted">Requested By</span><br /><code>${escapeHtml(normalizeText(selectedRegressionRun.requestedBy))}</code></div>
                    <div><span class="muted">Trigger Source</span><br /><code>${escapeHtml(normalizeText(selectedRegressionRun.triggerSource))}</code></div>
                    <div><span class="muted">Started</span><br /><code>${escapeHtml(normalizeText(selectedRegressionRun.startedAt))}</code></div>
                    <div><span class="muted">Ended</span><br /><code>${escapeHtml(normalizeText(selectedRegressionRun.endedAt))}</code></div>
                  </div>
                  <div class="lineage-meta">
                    ${renderMetaPill("scenario-count", selectedRegressionRun.summary?.scenarioCount ?? 0)}
                    ${renderMetaPill("pass", selectedRegressionRun.summary?.passCount ?? 0, "root")}
                    ${renderMetaPill("fail", selectedRegressionRun.summary?.failCount ?? 0, (selectedRegressionRun.summary?.failCount ?? 0) > 0 ? "failed" : "")}
                    ${renderMetaPill("skipped", selectedRegressionRun.summary?.skippedCount ?? 0)}
                    ${renderTrendSnapshotPills(selectedRegressionTrendSnapshot)}
                    ${
                      selectedRegressionFailure
                        ? renderMetaPill(
                            "failure",
                            summarizeFailureLabel(selectedRegressionFailure),
                            "failed",
                          )
                        : ""
                    }
                    ${
                      selectedRegressionSuggestedActions.length > 0
                        ? renderMetaPill(
                            "actions",
                            selectedRegressionSuggestedActions.length,
                            "changed",
                          )
                        : ""
                    }
                  </div>
                  ${renderTrendSnapshotCard(selectedRegressionTrendSnapshot, "Trend Snapshot", "No trend snapshot recorded for this regression run.")}
                  ${renderFailureCard(selectedRegressionFailure, "Failure Classification", "No failure classification recorded for this regression run.")}
                  ${renderSuggestedActionsCard(selectedRegressionSuggestedActions, "Suggested Actions", "No suggested actions recorded for this regression run.")}
                  ${renderPathReferenceList(reportPaths, "Run Reports / Artifacts")}
                  <div class="event-list">
                    ${
                      (selectedRegressionRun.items ?? [])
                        .map(
                          (item) => `
                        <article class="decision-card run-drilldown-card">
                          <div class="event-title">
                            <strong>${escapeHtml(normalizeText(item.scenarioId))}</strong>
                            ${renderStatePill(item.status ?? "unknown")}
                          </div>
                          <div class="event-meta">
                            <code>scenario-run=${escapeHtml(normalizeText(item.scenarioRunId))}</code>
                            <code>execution=${escapeHtml(normalizeText(item.metadata?.executionId))}</code>
                            <code>scenario-status=${escapeHtml(normalizeText(item.metadata?.scenarioStatus))}</code>
                          </div>
                          <div class="lineage-meta">
                            ${
                              item.metadata?.executionId
                                ? `<button type="button" class="secondary-button jump-button" data-jump-execution-id="${escapeHtml(normalizeText(item.metadata.executionId))}">open execution</button>`
                                : ""
                            }
                            ${
                              item.scenarioRunId
                                ? `<a class="inline-link" href="${escapeHtml(buildScenarioRunArtifactsHref(item.scenarioId, item.scenarioRunId))}" target="_blank" rel="noreferrer">scenario artifacts</a>`
                                : ""
                            }
                            ${
                              item.scenarioId
                                ? `<button type="button" class="secondary-button jump-button" data-jump-scenario-id="${escapeHtml(normalizeText(item.scenarioId))}">open scenario</button>`
                                : ""
                            }
                          </div>
                        </article>
                      `,
                        )
                        .join("") ||
                      `<div class="detail-card empty-state compact-empty">No per-scenario regression items recorded for this run.</div>`
                    }
                  </div>
                `
                : `<div class="detail-card empty-state compact-empty">Select a regression run to inspect scenario-level outcomes.</div>`
            }
          `
      }
    </article>
  `;

  for (const item of els.regressionList.querySelectorAll(
    "article[data-regression-id]",
  )) {
    item.addEventListener("click", () => {
      state.selectedRegressionId = item.dataset.regressionId;
      refresh().catch((error) => console.error(error));
    });
  }

  for (const button of els.regressionList.querySelectorAll(
    ".regression-run-button",
  )) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      runRegression(button.dataset.runRegressionId, false).catch((error) =>
        alert(error.message),
      );
    });
  }

  for (const button of els.regressionList.querySelectorAll(
    ".regression-run-stub-button",
  )) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      runRegression(button.dataset.runRegressionId, true).catch((error) =>
        alert(error.message),
      );
    });
  }

  for (const item of els.regressionList.querySelectorAll(
    "[data-regression-run-id]",
  )) {
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      state.selectedRegressionRunId = item.dataset.regressionRunId;
      renderRegressions();
    });
  }

  for (const button of els.regressionList.querySelectorAll(
    "[data-jump-execution-id]",
  )) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const executionId = button.dataset.jumpExecutionId;
      if (!executionId) {
        return;
      }
      state.selectedExecutionId = executionId;
      connectExecutionEventStream();
      refresh().catch((error) => console.error(error));
    });
  }

  for (const button of els.regressionList.querySelectorAll(
    "[data-jump-scenario-id]",
  )) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const scenarioId = button.dataset.jumpScenarioId;
      if (!scenarioId) {
        return;
      }
      state.selectedScenarioId = scenarioId;
      refresh().catch((error) => console.error(error));
    });
  }
}

function renderRunCenter() {
  if (!els.runCenterSummary || !els.runCenterState) {
    return;
  }

  if (state.runCenterState === "unavailable") {
    els.runCenterState.textContent = "route: unavailable";
    els.runCenterSummary.className = "detail-card empty-state";
    els.runCenterSummary.textContent =
      "Run center route is not available on this orchestrator.";
    return;
  }

  if (state.runCenterState === "error") {
    els.runCenterState.textContent = "route: error";
    els.runCenterSummary.className = "detail-card empty-state";
    els.runCenterSummary.textContent = `Failed to load run center: ${state.runCenterError ?? "unknown error"}`;
    return;
  }

  const runCenter = normalizeRunCenterCollections(state.runCenter ?? {});
  const alerts = normalizeAdvisoryEntries(runCenter.alerts, "alert");
  const recommendations = normalizeAdvisoryEntries(
    runCenter.recommendations,
    "recommendation",
  );
  const latestReports = runCenter.latestReports.map((item, index) => ({
    id: normalizeText(
      readFirstField(item, ["id", "runId", "reportId"]),
      `report-${index + 1}`,
    ),
    title: normalizeText(
      readFirstField(item, ["title", "label", "name", "regressionId"]),
      `report-${index + 1}`,
    ),
    runId: normalizeText(readFirstField(item, ["runId", "id"]), ""),
    regressionId: normalizeText(
      readFirstField(item, ["regressionId", "profileId", "key"]),
      "",
    ),
    status: normalizeText(
      readFirstField(item, ["status", "state", "result"]),
      "unknown",
    ),
    startedAt: normalizeText(
      readFirstField(item, ["startedAt", "createdAt"]),
      "-",
    ),
    endedAt: normalizeText(readFirstField(item, ["endedAt", "updatedAt"]), "-"),
    reportPaths: Object.values(
      readFirstObjectField(item, ["reports", "paths", "reportPaths"]) ?? {},
    ).filter((value) => hasDisplayValue(value)),
    failure: pickFailureRecord(
      readFirstField(item, ["failure", "latestFailure"]),
      item?.failure,
    ),
    suggestedActions: normalizeSuggestedActions(
      readFirstField(item, [
        "suggestedActions",
        "latestSuggestedActions",
        "recommendations",
      ]),
    ),
  }));
  const scenarioSummaries = runCenter.scenarios.map((item, index) => ({
    id: normalizeText(
      readFirstField(item, ["id", "scenarioId", "key"]),
      `scenario-${index + 1}`,
    ),
    label: normalizeText(
      readFirstField(item, ["label", "name", "scenarioLabel", "title"]),
      getScenarioIdentifier(item, index),
    ),
    latestStatus: normalizeText(
      readFirstField(item, ["latestStatus", "status", "state", "result"]),
      "unknown",
    ),
    latestRunId: normalizeText(
      readFirstField(item, ["latestRunId", "latestRun", "runId"]),
      "-",
    ),
    failCount: Number(
      readFirstField(item, [
        "failCount",
        "failed",
        "latestFailCount",
        "failingCount",
      ]) ?? 0,
    ),
    passRate: readFirstField(item, [
      "passRate",
      "latestPassRate",
      "successRate",
    ]),
    trendSnapshot: readFirstField(item, [
      "trendSnapshot",
      "trend",
      "latestTrend",
      "trendSummary",
    ]),
    latestFailure: pickFailureRecord(
      readFirstField(item, ["latestFailure", "failure"]),
      item?.latestFailure,
      item?.failure,
    ),
    latestSuggestedActions: normalizeSuggestedActions(
      readFirstField(item, [
        "latestSuggestedActions",
        "suggestedActions",
        "recommendations",
      ]),
    ),
  }));
  const regressionSummaries = runCenter.regressions.map((item, index) => ({
    id: normalizeText(
      readFirstField(item, ["id", "regressionId", "key"]),
      `regression-${index + 1}`,
    ),
    label: normalizeText(
      readFirstField(item, ["label", "name", "regressionLabel", "title"]),
      `regression-${index + 1}`,
    ),
    latestStatus: normalizeText(
      readFirstField(item, ["latestStatus", "status", "state", "result"]),
      "unknown",
    ),
    latestRunId: normalizeText(
      readFirstField(item, ["latestRunId", "latestRun", "runId"]),
      "-",
    ),
    failCount: Number(
      readFirstField(item, [
        "failCount",
        "failed",
        "latestFailCount",
        "failingCount",
      ]) ?? 0,
    ),
    passRate: readFirstField(item, [
      "passRate",
      "latestPassRate",
      "successRate",
    ]),
    trendSnapshot: readFirstField(item, [
      "trendSnapshot",
      "trend",
      "latestTrend",
      "trendSummary",
    ]),
    latestFailure: pickFailureRecord(
      readFirstField(item, ["latestFailure", "failure"]),
      item?.latestFailure,
      item?.failure,
    ),
    latestSuggestedActions: normalizeSuggestedActions(
      readFirstField(item, [
        "latestSuggestedActions",
        "suggestedActions",
        "recommendations",
      ]),
    ),
  }));
  const recentScenarioRuns = runCenter.recentScenarioRuns.map(
    (item, index) => ({
      runId: normalizeText(
        readFirstField(item, ["id", "runId"]),
        `scenario-run-${index + 1}`,
      ),
      scenarioId: normalizeText(
        readFirstField(item, ["scenarioId", "id", "scenarioKey"]),
        "",
      ),
      status: normalizeText(
        readFirstField(item, ["status", "state", "result"]),
        "unknown",
      ),
      startedAt: normalizeText(
        readFirstField(item, ["startedAt", "createdAt"]),
        "-",
      ),
      endedAt: normalizeText(
        readFirstField(item, ["endedAt", "updatedAt"]),
        "-",
      ),
      executionId: normalizeText(
        readFirstField(item, [
          "executionId",
          "targetExecutionId",
          "latestExecutionId",
        ]),
        "",
      ),
      launcher: normalizeText(
        readFirstField(item, ["launcher", "launcherType"]),
        "-",
      ),
      trendSnapshot: readFirstField(item, [
        "trendSnapshot",
        "trend",
        "latestTrend",
        "trendSummary",
      ]),
      failure: pickFailureRecord(
        readFirstField(item, ["failure", "latestFailure"]),
        item?.failure,
        item?.latestFailure,
      ),
      suggestedActions: normalizeSuggestedActions(
        readFirstField(item, [
          "suggestedActions",
          "latestSuggestedActions",
          "recommendations",
        ]),
      ),
    }),
  );
  const recentRegressionRuns = runCenter.recentRegressionRuns.map(
    (item, index) => ({
      runId: normalizeText(
        readFirstField(item, ["id", "runId"]),
        `regression-run-${index + 1}`,
      ),
      regressionId: normalizeText(
        readFirstField(item, ["regressionId", "id", "regressionKey"]),
        "",
      ),
      status: normalizeText(
        readFirstField(item, ["status", "state", "result"]),
        "unknown",
      ),
      startedAt: normalizeText(
        readFirstField(item, ["startedAt", "createdAt"]),
        "-",
      ),
      endedAt: normalizeText(
        readFirstField(item, ["endedAt", "updatedAt"]),
        "-",
      ),
      failCount: Number(readFirstField(item, ["failCount", "failed"]) ?? 0),
      passCount: Number(readFirstField(item, ["passCount", "passed"]) ?? 0),
      trendSnapshot: readFirstField(item, [
        "trendSnapshot",
        "trend",
        "latestTrend",
        "trendSummary",
      ]),
      failure: pickFailureRecord(
        readFirstField(item, ["failure", "latestFailure"]),
        item?.failure,
        item?.latestFailure,
      ),
      suggestedActions: normalizeSuggestedActions(
        readFirstField(item, [
          "suggestedActions",
          "latestSuggestedActions",
          "recommendations",
        ]),
      ),
    }),
  );
  const selfBuildRoot = hasDisplayValue(runCenter.selfBuild)
    ? runCenter.selfBuild
    : (state.selfBuildSummary ?? {});
  const selfBuildWorkItems = normalizeRouteArray(selfBuildRoot, [
    "workItems",
    "items",
  ]).map((item, index) => ({
    id: normalizeText(
      readFirstField(item, ["id", "workItemId"]),
      `work-item-${index + 1}`,
    ),
    title: normalizeText(
      readFirstField(item, ["title", "label", "name"]),
      `work-item-${index + 1}`,
    ),
    kind: normalizeText(readFirstField(item, ["kind", "type"]), "work"),
    status: normalizeText(
      readFirstField(item, ["status", "state", "result"]),
      "unknown",
    ),
    priority: normalizeText(readFirstField(item, ["priority"]), "-"),
    lastRunAt: normalizeText(
      readFirstField(item, ["lastRunAt", "updatedAt"]),
      "-",
    ),
    links: readFirstObjectField(item, ["links"]) ?? {},
  }));
  const recentWorkItemRuns = normalizeRouteArray(selfBuildRoot, [
    "recentWorkItemRuns",
    "runs",
  ]).map((item, index) => ({
    runId: normalizeText(
      readFirstField(item, ["runId", "id"]),
      `work-item-run-${index + 1}`,
    ),
    workItemId: normalizeText(readFirstField(item, ["workItemId", "id"]), ""),
    title: normalizeText(
      readFirstField(item, ["title", "label", "name"]),
      `work-item-run-${index + 1}`,
    ),
    kind: normalizeText(readFirstField(item, ["kind", "type"]), "work"),
    status: normalizeText(
      readFirstField(item, ["status", "state", "result"]),
      "unknown",
    ),
    startedAt: normalizeText(
      readFirstField(item, ["startedAt", "createdAt"]),
      "-",
    ),
    endedAt: normalizeText(readFirstField(item, ["endedAt", "updatedAt"]), "-"),
    links: readFirstObjectField(item, ["links"]) ?? {},
    suggestedActions: normalizeSuggestedActions(
      readFirstField(item, [
        "suggestedActions",
        "latestSuggestedActions",
        "recommendations",
      ]),
    ),
  }));
  const proposalSummaries = normalizeRouteArray(selfBuildRoot, [
    "proposals",
    "proposalArtifacts",
  ]).map((item, index) => ({
    id: normalizeText(
      readFirstField(item, ["id", "proposalArtifactId"]),
      `proposal-${index + 1}`,
    ),
    workItemId: normalizeText(readFirstField(item, ["workItemId"]), ""),
    workItemRunId: normalizeText(
      readFirstField(item, ["workItemRunId", "runId"]),
      "",
    ),
    kind: normalizeText(readFirstField(item, ["kind", "type"]), "proposal"),
    status: normalizeText(
      readFirstField(item, ["status", "state", "result"]),
      "unknown",
    ),
    links: readFirstObjectField(item, ["links"]) ?? {},
  }));

  if (
    state.selectedRunCenterScenarioRunId &&
    !recentScenarioRuns.some(
      (item) => item.runId === state.selectedRunCenterScenarioRunId,
    )
  ) {
    state.selectedRunCenterScenarioRunId = null;
  }
  if (!state.selectedRunCenterScenarioRunId && recentScenarioRuns[0]?.runId) {
    state.selectedRunCenterScenarioRunId = recentScenarioRuns[0].runId;
  }
  if (
    state.selectedRunCenterRegressionRunId &&
    !recentRegressionRuns.some(
      (item) => item.runId === state.selectedRunCenterRegressionRunId,
    )
  ) {
    state.selectedRunCenterRegressionRunId = null;
  }
  if (
    !state.selectedRunCenterRegressionRunId &&
    recentRegressionRuns[0]?.runId
  ) {
    state.selectedRunCenterRegressionRunId = recentRegressionRuns[0].runId;
  }
  if (
    state.selectedRunCenterWorkItemRunId &&
    !recentWorkItemRuns.some(
      (item) => item.runId === state.selectedRunCenterWorkItemRunId,
    )
  ) {
    state.selectedRunCenterWorkItemRunId = null;
  }
  if (!state.selectedRunCenterWorkItemRunId && recentWorkItemRuns[0]?.runId) {
    state.selectedRunCenterWorkItemRunId = recentWorkItemRuns[0].runId;
  }

  const selectedScenarioRun =
    recentScenarioRuns.find(
      (item) => item.runId === state.selectedRunCenterScenarioRunId,
    ) ?? null;
  const selectedRegressionRun =
    recentRegressionRuns.find(
      (item) => item.runId === state.selectedRunCenterRegressionRunId,
    ) ?? null;
  const selectedWorkItemRun =
    recentWorkItemRuns.find(
      (item) => item.runId === state.selectedRunCenterWorkItemRunId,
    ) ?? null;
  const selectedScenarioRunCatalog =
    selectedScenarioRun &&
    state.selectedScenarioRunId === selectedScenarioRun.runId
      ? (state.scenarioRuns.find(
          (run) => run.id === selectedScenarioRun.runId,
        ) ?? null)
      : null;
  const selectedRegressionRunCatalog =
    selectedRegressionRun &&
    state.selectedRegressionRunId === selectedRegressionRun.runId
      ? (state.regressionRuns.find(
          (run) => run.id === selectedRegressionRun.runId,
        ) ?? null)
      : null;
  const selectedScenarioRunFailure = pickFailureRecord(
    selectedScenarioRun?.failure,
    selectedScenarioRunCatalog?.failure,
    selectedScenarioRunCatalog?.latestFailure,
    selectedScenarioRunCatalog?.metadata?.failure,
  );
  const selectedScenarioRunSuggestedActions = normalizeSuggestedActions(
    readFirstField(selectedScenarioRun ?? {}, [
      "suggestedActions",
      "latestSuggestedActions",
      "recommendations",
    ]) ??
      selectedScenarioRunCatalog?.suggestedActions ??
      selectedScenarioRunCatalog?.latestSuggestedActions ??
      selectedScenarioRunCatalog?.metadata?.suggestedActions,
  );
  const selectedScenarioRunTrendSnapshot =
    readFirstField(selectedScenarioRun ?? {}, [
      "trendSnapshot",
      "trend",
      "latestTrend",
      "trendSummary",
    ]) ??
    readFirstField(selectedScenarioRunCatalog ?? {}, [
      "trendSnapshot",
      "trend",
      "latestTrend",
      "trendSummary",
    ]);
  const selectedRegressionRunFailure = pickFailureRecord(
    selectedRegressionRun?.failure,
    selectedRegressionRunCatalog?.failure,
    selectedRegressionRunCatalog?.latestFailure,
    selectedRegressionRunCatalog?.metadata?.failure,
  );
  const selectedRegressionRunSuggestedActions = normalizeSuggestedActions(
    readFirstField(selectedRegressionRun ?? {}, [
      "suggestedActions",
      "latestSuggestedActions",
      "recommendations",
    ]) ??
      selectedRegressionRunCatalog?.suggestedActions ??
      selectedRegressionRunCatalog?.latestSuggestedActions ??
      selectedRegressionRunCatalog?.metadata?.suggestedActions,
  );
  const selectedRegressionRunTrendSnapshot =
    readFirstField(selectedRegressionRun ?? {}, [
      "trendSnapshot",
      "trend",
      "latestTrend",
      "trendSummary",
    ]) ??
    readFirstField(selectedRegressionRunCatalog ?? {}, [
      "trendSnapshot",
      "trend",
      "latestTrend",
      "trendSummary",
    ]);
  const selectedScenarioTrendPayload =
    state.scenarioTrend?.trend ??
    state.scenarioTrend?.summary ??
    state.scenarioTrend;
  const selectedRegressionTrendPayload =
    state.regressionTrend?.trend ??
    state.regressionTrend?.summary ??
    state.regressionTrend;
  const selectedRegressionReportPayload =
    state.regressionRunReport?.report ??
    state.regressionRunReport?.detail ??
    state.regressionRunReport;
  const selectedWorkItemRunFailure = pickFailureRecord(
    state.workItemRunDetail?.failure,
    state.workItemRunDetail?.metadata?.failure,
    state.workItemRunDetail?.validation?.failure,
  );
  const selectedWorkItemRunSuggestedActions = normalizeSuggestedActions(
    state.workItemRunDetail?.suggestedActions ??
      selectedWorkItemRun?.suggestedActions ??
      state.selfBuildSummary?.recommendations,
  );

  const scenarioCount =
    coerceCount(runCenter.counts?.scenarios) ?? scenarioSummaries.length;
  const regressionCount =
    coerceCount(runCenter.counts?.regressions) ?? regressionSummaries.length;
  const recentScenarioCount =
    coerceCount(runCenter.counts?.recentScenarioRuns) ??
    recentScenarioRuns.length;
  const recentRegressionCount =
    coerceCount(runCenter.counts?.recentRegressionRuns) ??
    recentRegressionRuns.length;
  const workItemCount =
    coerceCount(runCenter.counts?.workItems) ?? selfBuildWorkItems.length;
  const recentWorkItemCount =
    coerceCount(runCenter.counts?.recentWorkItemRuns) ??
    recentWorkItemRuns.length;
  const pendingProposalCount =
    coerceCount(runCenter.counts?.pendingProposalArtifacts) ??
    proposalSummaries.filter((item) => item.status !== "approved").length;
  const flakyCount =
    coerceCount(runCenter.flaky?.count) ??
    coerceCount(runCenter.flaky?.total) ??
    scenarioSummaries.filter(
      (item) => item.trendSnapshot?.flaky || item.trendSnapshot?.possiblyFlaky,
    ).length;

  els.runCenterState.textContent = `route: ready · scenarios:${scenarioCount} regressions:${regressionCount} work-items:${workItemCount} alerts:${alerts.length} recommendations:${recommendations.length}`;
  els.runCenterSummary.className = "detail-card run-center-card";
  els.runCenterSummary.innerHTML = `
    <div class="run-center-grid">
      <article class="run-center-stat">
        <span class="muted">Scenarios</span>
        <strong>${escapeHtml(String(scenarioCount))}</strong>
      </article>
      <article class="run-center-stat">
        <span class="muted">Regressions</span>
        <strong>${escapeHtml(String(regressionCount))}</strong>
      </article>
      <article class="run-center-stat">
        <span class="muted">Recent Scenario Runs</span>
        <strong>${escapeHtml(String(recentScenarioCount))}</strong>
      </article>
      <article class="run-center-stat">
        <span class="muted">Recent Regression Runs</span>
        <strong>${escapeHtml(String(recentRegressionCount))}</strong>
      </article>
      <article class="run-center-stat">
        <span class="muted">Work Items</span>
        <strong>${escapeHtml(String(workItemCount))}</strong>
      </article>
      <article class="run-center-stat">
        <span class="muted">Recent Work Item Runs</span>
        <strong>${escapeHtml(String(recentWorkItemCount))}</strong>
      </article>
      <article class="run-center-stat">
        <span class="muted">Pending Proposals</span>
        <strong>${escapeHtml(String(pendingProposalCount))}</strong>
      </article>
      <article class="run-center-stat">
        <span class="muted">Operator Signals</span>
        <strong>${escapeHtml(String(alerts.length + recommendations.length))}</strong>
      </article>
      <article class="run-center-stat">
        <span class="muted">Flaky Signals</span>
        <strong>${escapeHtml(String(flakyCount ?? 0))}</strong>
      </article>
    </div>
    <section class="run-center-section">
      <div class="panel-header nested">
        <h3>Trend and Health Overview</h3>
        <span class="muted">aggregate run-center signals</span>
      </div>
      <div class="run-center-breakdown-grid">
        ${renderSummaryObjectCard(runCenter.trendBreakdown, "Trend Breakdown", "No aggregate trend breakdown returned.")}
        ${renderSummaryObjectCard(runCenter.failureBreakdown, "Failure Breakdown", "No aggregate failure breakdown returned.")}
        ${renderSummaryObjectCard(runCenter.flaky, "Flaky Summary", "No flaky summary returned.")}
      </div>
    </section>
    <section class="run-center-section">
      <div class="panel-header nested">
        <h3>Operator Signals</h3>
        <span class="muted">${escapeHtml(`alerts:${alerts.length} recommendations:${recommendations.length}`)}</span>
      </div>
      <div class="run-center-advisory-grid">
        ${alerts
          .slice(0, 4)
          .map(
            (item) => `
                <article class="run-center-advisory-card alert">
                  <div class="event-title">
                    <strong>${escapeHtml(item.title)}</strong>
                    ${renderMetaPill("alert", item.severity || "open", "failed")}
                  </div>
                  ${item.detail ? `<p class="decision-summary">${escapeHtml(item.detail)}</p>` : ""}
                  <div class="event-meta">
                    ${item.source ? `<code>source=${escapeHtml(item.source)}</code>` : ""}
                    ${item.timestamp ? `<code>at=${escapeHtml(item.timestamp)}</code>` : ""}
                    ${item.id ? `<code>id=${escapeHtml(item.id)}</code>` : ""}
                  </div>
                </article>
              `,
          )
          .join("")}
        ${recommendations
          .slice(0, 4)
          .map(
            (item) => `
                <article class="run-center-advisory-card recommendation">
                  <div class="event-title">
                    <strong>${escapeHtml(item.title)}</strong>
                    ${renderMetaPill("recommend", item.severity || item.type || "suggested", "changed")}
                  </div>
                  ${item.detail ? `<p class="decision-summary">${escapeHtml(item.detail)}</p>` : ""}
                  <div class="event-meta">
                    ${item.source ? `<code>source=${escapeHtml(item.source)}</code>` : ""}
                    ${item.timestamp ? `<code>at=${escapeHtml(item.timestamp)}</code>` : ""}
                    ${item.id ? `<code>id=${escapeHtml(item.id)}</code>` : ""}
                  </div>
                </article>
              `,
          )
          .join("")}
        ${
          alerts.length === 0 && recommendations.length === 0
            ? `<div class="detail-card empty-state compact-empty">No operator alerts or recommendations in run-center payload.</div>`
            : ""
        }
      </div>
    </section>
    <section class="run-center-section">
      <div class="panel-header nested">
        <h3>Latest Reports</h3>
        <span class="muted">${escapeHtml(String(latestReports.length))}</span>
      </div>
      <div class="run-center-list">
        ${
          latestReports
            .slice(0, 6)
            .map(
              (item) => `
                <article class="run-center-item">
                  <div class="event-title">
                    <strong>${escapeHtml(item.title)}</strong>
                    ${renderStatePill(item.status)}
                  </div>
                  <div class="event-meta">
                    ${item.regressionId ? `<code>regression=${escapeHtml(item.regressionId)}</code>` : ""}
                    ${item.runId ? `<code>run=${escapeHtml(item.runId)}</code>` : ""}
                    <code>ended=${escapeHtml(item.endedAt)}</code>
                  </div>
                  <div class="lineage-meta">
                    ${item.failure ? renderMetaPill("failure", summarizeFailureLabel(item.failure), "failed") : ""}
                    ${
                      item.suggestedActions.length > 0
                        ? renderMetaPill(
                            "actions",
                            item.suggestedActions.length,
                            "changed",
                          )
                        : ""
                    }
                  </div>
                  ${renderPathReferenceList(item.reportPaths, "Report Paths")}
                </article>
              `,
            )
            .join("") ||
          `<div class="detail-card empty-state compact-empty">No latest report cards returned in run-center payload.</div>`
        }
      </div>
    </section>
    <section class="run-center-section">
      <div class="panel-header nested">
        <h3>Managed Self-Build Work</h3>
        <span class="muted">${escapeHtml(`items:${workItemCount} runs:${recentWorkItemCount} proposals:${pendingProposalCount}`)}</span>
      </div>
      <div class="run-center-list">
        ${
          selfBuildWorkItems
            .slice(0, 8)
            .map(
              (item) => `
                <article class="run-center-item">
                  <div class="event-title">
                    <strong>${escapeHtml(item.title)}</strong>
                    ${renderStatePill(item.status)}
                  </div>
                  <div class="event-meta">
                    <code>id=${escapeHtml(item.id)}</code>
                    <code>kind=${escapeHtml(item.kind)}</code>
                    <code>priority=${escapeHtml(item.priority)}</code>
                    <code>lastRun=${escapeHtml(item.lastRunAt)}</code>
                  </div>
                  <div class="lineage-meta">
                    <a class="inline-link" href="${escapeHtml(item.links.self || buildWorkItemHref(item.id))}" target="_blank" rel="noreferrer">work item json</a>
                    <a class="inline-link" href="${escapeHtml(buildWorkItemRunsHref(item.id))}" target="_blank" rel="noreferrer">runs json</a>
                  </div>
                </article>
              `,
            )
            .join("") ||
          `<div class="detail-card empty-state compact-empty">No managed work items surfaced in run-center payload.</div>`
        }
      </div>
      <div class="run-center-list">
        ${
          recentWorkItemRuns
            .slice(0, 10)
            .map(
              (item) => `
                <article class="run-center-item run-history-item ${item.runId === state.selectedRunCenterWorkItemRunId ? "active" : ""}" data-run-center-work-item-run-id="${escapeHtml(item.runId)}">
                  <div class="event-title">
                    <strong>${escapeHtml(item.title)}</strong>
                    ${renderStatePill(item.status)}
                  </div>
                  <div class="event-meta">
                    <code>run=${escapeHtml(item.runId)}</code>
                    <code>item=${escapeHtml(item.workItemId)}</code>
                    <code>kind=${escapeHtml(item.kind)}</code>
                    <code>started=${escapeHtml(item.startedAt)}</code>
                  </div>
                  <div class="lineage-meta">
                    ${
                      item.suggestedActions.length > 0
                        ? renderMetaPill(
                            "actions",
                            item.suggestedActions.length,
                            "changed",
                          )
                        : ""
                    }
                    ${
                      item.links.proposal
                        ? renderMetaPill("proposal", "ready", "governance")
                        : ""
                    }
                  </div>
                </article>
              `,
            )
            .join("") ||
          `<div class="detail-card empty-state compact-empty">No recent managed work item runs in run-center payload.</div>`
        }
      </div>
      ${
        selectedWorkItemRun
          ? `
            <article class="detail-card run-center-drilldown">
              <div class="event-title">
                <strong>Work Item Run Drilldown</strong>
                ${renderStatePill(selectedWorkItemRun.status)}
              </div>
              <div class="event-meta">
                <code>run=${escapeHtml(selectedWorkItemRun.runId)}</code>
                <code>item=${escapeHtml(selectedWorkItemRun.workItemId || "-")}</code>
                <code>kind=${escapeHtml(selectedWorkItemRun.kind)}</code>
                <code>started=${escapeHtml(selectedWorkItemRun.startedAt)}</code>
                <code>ended=${escapeHtml(selectedWorkItemRun.endedAt)}</code>
              </div>
              <div class="lineage-meta">
                <a class="inline-link" href="${escapeHtml(buildWorkItemRunHref(selectedWorkItemRun.runId))}" target="_blank" rel="noreferrer">run json</a>
                ${
                  selectedWorkItemRun.workItemId
                    ? `<a class="inline-link" href="${escapeHtml(buildWorkItemHref(selectedWorkItemRun.workItemId))}" target="_blank" rel="noreferrer">work item json</a>`
                    : ""
                }
                ${
                  state.workItemRunDetail?.proposal?.id
                    ? `<a class="inline-link" href="${escapeHtml(buildProposalHref(state.workItemRunDetail.proposal.id))}" target="_blank" rel="noreferrer">proposal json</a>`
                    : `<a class="inline-link" href="${escapeHtml(buildWorkItemRunProposalHref(selectedWorkItemRun.runId))}" target="_blank" rel="noreferrer">proposal route</a>`
                }
                ${
                  selectedWorkItemRun.workItemId
                    ? `<a class="inline-link" href="${escapeHtml(buildWorkItemRunsHref(selectedWorkItemRun.workItemId))}" target="_blank" rel="noreferrer">all runs</a>`
                    : ""
                }
                ${
                  state.workItemRunDetail?.validation?.scenarioRunIds?.[0]
                    ? `<a class="inline-link" href="${escapeHtml(buildScenarioRunByIdHref(state.workItemRunDetail.validation.scenarioRunIds[0]))}" target="_blank" rel="noreferrer">scenario validation</a>`
                    : ""
                }
                ${
                  state.workItemRunDetail?.validation?.regressionRunIds?.[0]
                    ? `<a class="inline-link" href="${escapeHtml(buildRegressionRunByIdHref(state.workItemRunDetail.validation.regressionRunIds[0]))}" target="_blank" rel="noreferrer">regression validation</a>`
                    : ""
                }
              </div>
              ${renderFailureCard(selectedWorkItemRunFailure, "Failure Classification", "No failure classification returned for this work-item run.")}
              ${renderSuggestedActionsCard(selectedWorkItemRunSuggestedActions, "Suggested Actions", "No suggested actions returned for this work-item run.")}
              ${renderSummaryObjectCard(state.workItemRunDetail?.validation, "Validation Summary", state.workItemRunDetailState === "error" ? `Failed to load work-item run detail: ${state.workItemRunDetailError}` : "No validation summary returned for this work-item run.")}
              ${renderSummaryObjectCard(state.proposalDetail, "Proposal Detail", state.proposalDetailState === "error" ? `Failed to load proposal detail: ${state.proposalDetailError}` : "No route-backed proposal detail returned.")}
              ${renderSummaryObjectCard(state.workItemRunDetail?.docSuggestions, "Documentation Suggestions", "No documentation suggestions returned for this work-item run.")}
            </article>
          `
          : `<div class="detail-card empty-state compact-empty">Select a recent work-item run to inspect proposal, validation, and suggestion details.</div>`
      }
      <div class="run-center-list">
        ${
          proposalSummaries
            .slice(0, 8)
            .map(
              (item) => `
                <article class="run-center-item">
                  <div class="event-title">
                    <strong>${escapeHtml(item.id)}</strong>
                    ${renderStatePill(item.status)}
                  </div>
                  <div class="event-meta">
                    <code>run=${escapeHtml(item.workItemRunId || "-")}</code>
                    <code>item=${escapeHtml(item.workItemId || "-")}</code>
                    <code>kind=${escapeHtml(item.kind)}</code>
                  </div>
                  <div class="lineage-meta">
                    <a class="inline-link" href="${escapeHtml(item.links.self || buildProposalHref(item.id))}" target="_blank" rel="noreferrer">proposal json</a>
                  </div>
                </article>
              `,
            )
            .join("") ||
          `<div class="detail-card empty-state compact-empty">No proposal artifacts surfaced in run-center payload.</div>`
        }
      </div>
    </section>
    <section class="run-center-section">
      <div class="panel-header nested">
        <h3>Scenario Summaries</h3>
      </div>
      <div class="run-center-list">
        ${
          scenarioSummaries
            .slice(0, 8)
            .map(
              (item) => `
                <article class="run-center-item run-history-item" data-run-center-scenario="${escapeHtml(item.id)}">
                  <div class="event-title">
                    <strong>${escapeHtml(item.label)}</strong>
                    ${renderStatePill(item.latestStatus)}
                  </div>
                  <div class="event-meta">
                    <code>id=${escapeHtml(item.id)}</code>
                    <code>latest=${escapeHtml(item.latestRunId)}</code>
                    <code>fail=${escapeHtml(String(item.failCount))}</code>
                    ${
                      hasDisplayValue(item.passRate)
                        ? `<code>passRate=${escapeHtml(String(item.passRate))}</code>`
                        : ""
                    }
                  </div>
                  <div class="lineage-meta">
                    ${renderTrendSnapshotPills(item.trendSnapshot)}
                    ${
                      item.latestFailure
                        ? renderMetaPill(
                            "failure",
                            summarizeFailureLabel(item.latestFailure),
                            "failed",
                          )
                        : ""
                    }
                    ${
                      item.latestSuggestedActions.length > 0
                        ? renderMetaPill(
                            "actions",
                            item.latestSuggestedActions.length,
                            "changed",
                          )
                        : ""
                    }
                  </div>
                </article>
              `,
            )
            .join("") ||
          `<div class="detail-card empty-state compact-empty">No scenario summaries in run-center payload.</div>`
        }
      </div>
    </section>
    <section class="run-center-section">
      <div class="panel-header nested">
        <h3>Regression Summaries</h3>
      </div>
      <div class="run-center-list">
        ${
          regressionSummaries
            .slice(0, 8)
            .map(
              (item) => `
                <article class="run-center-item run-history-item" data-run-center-regression="${escapeHtml(item.id)}">
                  <div class="event-title">
                    <strong>${escapeHtml(item.label)}</strong>
                    ${renderStatePill(item.latestStatus)}
                  </div>
                  <div class="event-meta">
                    <code>id=${escapeHtml(item.id)}</code>
                    <code>latest=${escapeHtml(item.latestRunId)}</code>
                    <code>fail=${escapeHtml(String(item.failCount))}</code>
                    ${
                      hasDisplayValue(item.passRate)
                        ? `<code>passRate=${escapeHtml(String(item.passRate))}</code>`
                        : ""
                    }
                  </div>
                  <div class="lineage-meta">
                    ${renderTrendSnapshotPills(item.trendSnapshot)}
                    ${
                      item.latestFailure
                        ? renderMetaPill(
                            "failure",
                            summarizeFailureLabel(item.latestFailure),
                            "failed",
                          )
                        : ""
                    }
                    ${
                      item.latestSuggestedActions.length > 0
                        ? renderMetaPill(
                            "actions",
                            item.latestSuggestedActions.length,
                            "changed",
                          )
                        : ""
                    }
                  </div>
                </article>
              `,
            )
            .join("") ||
          `<div class="detail-card empty-state compact-empty">No regression summaries in run-center payload.</div>`
        }
      </div>
    </section>
    <section class="run-center-section">
      <div class="panel-header nested">
        <h3>Recent Scenario Runs</h3>
      </div>
      <div class="run-center-list">
        ${
          recentScenarioRuns
            .slice(0, 10)
            .map(
              (item) => `
                <article class="run-center-item run-history-item ${item.runId === state.selectedRunCenterScenarioRunId ? "active" : ""}" data-run-center-scenario-run-id="${escapeHtml(item.runId)}" data-run-center-scenario-id="${escapeHtml(item.scenarioId)}">
                  <div class="event-title">
                    <strong>${escapeHtml(item.scenarioId || item.runId)}</strong>
                    ${renderStatePill(item.status)}
                  </div>
                  <div class="event-meta">
                    <code>run=${escapeHtml(item.runId)}</code>
                    <code>launcher=${escapeHtml(item.launcher)}</code>
                    <code>started=${escapeHtml(item.startedAt)}</code>
                  </div>
                  <div class="lineage-meta">
                    ${renderTrendSnapshotPills(item.trendSnapshot)}
                    ${item.failure ? renderMetaPill("failure", summarizeFailureLabel(item.failure), "failed") : ""}
                    ${
                      item.suggestedActions.length > 0
                        ? renderMetaPill(
                            "actions",
                            item.suggestedActions.length,
                            "changed",
                          )
                        : ""
                    }
                  </div>
                </article>
              `,
            )
            .join("") ||
          `<div class="detail-card empty-state compact-empty">No recent scenario runs in run-center payload.</div>`
        }
      </div>
      ${
        selectedScenarioRun
          ? `
            <article class="detail-card run-center-drilldown">
              <div class="event-title">
                <strong>Scenario Run Drilldown</strong>
                ${renderStatePill(selectedScenarioRun.status)}
              </div>
              <div class="event-meta">
                <code>run=${escapeHtml(selectedScenarioRun.runId)}</code>
                <code>scenario=${escapeHtml(selectedScenarioRun.scenarioId || "-")}</code>
                <code>started=${escapeHtml(selectedScenarioRun.startedAt)}</code>
                <code>ended=${escapeHtml(selectedScenarioRun.endedAt)}</code>
              </div>
              <div class="lineage-meta">
                <a class="inline-link" href="${escapeHtml(buildScenarioRunByIdHref(selectedScenarioRun.runId))}" target="_blank" rel="noreferrer">run json</a>
                <a class="inline-link" href="${escapeHtml(buildScenarioRunArtifactsByIdHref(selectedScenarioRun.runId))}" target="_blank" rel="noreferrer">artifacts json</a>
                ${
                  selectedScenarioRun.scenarioId
                    ? `<a class="inline-link" href="${escapeHtml(buildScenarioTrendHref(selectedScenarioRun.scenarioId))}" target="_blank" rel="noreferrer">trend json</a>`
                    : ""
                }
                ${
                  selectedScenarioRun.scenarioId
                    ? `<a class="inline-link" href="${escapeHtml(buildScenarioRunArtifactsHref(selectedScenarioRun.scenarioId, selectedScenarioRun.runId))}" target="_blank" rel="noreferrer">scoped artifacts</a>`
                    : ""
                }
                ${
                  selectedScenarioRun.executionId
                    ? `<button type="button" class="secondary-button jump-button" data-jump-execution-id="${escapeHtml(selectedScenarioRun.executionId)}">open execution</button>`
                    : ""
                }
                ${
                  selectedScenarioRun.scenarioId
                    ? `<button type="button" class="secondary-button jump-button" data-jump-scenario-id="${escapeHtml(selectedScenarioRun.scenarioId)}">open scenario</button>`
                    : ""
                }
              </div>
              ${renderTrendSnapshotCard(selectedScenarioRunTrendSnapshot, "Trend Snapshot", "No trend snapshot returned for this scenario run.")}
              ${renderSummaryObjectCard(selectedScenarioTrendPayload, "Scenario Trend Detail", state.scenarioTrendState === "error" ? `Failed to load scenario trend: ${state.scenarioTrendError}` : "No route-backed scenario trend detail returned.")}
              ${renderFailureCard(selectedScenarioRunFailure, "Failure Classification", "No failure classification returned for this scenario run.")}
              ${renderSuggestedActionsCard(selectedScenarioRunSuggestedActions, "Suggested Actions", "No suggested actions returned for this scenario run.")}
              ${
                state.scenarioRunDetailState === "error"
                  ? `<div class="detail-card empty-state compact-empty">Failed to load scenario run detail: ${escapeHtml(state.scenarioRunDetailError)}</div>`
                  : ""
              }
              ${
                selectedScenarioRunCatalog ||
                state.scenarioRunArtifacts ||
                state.scenarioRunDetail
                  ? `<details class="policy-details">
                      <summary>Route-backed Drilldown</summary>
                      <pre class="code-block compact-code">${escapeHtml(
                        JSON.stringify(
                          {
                            catalogRun: selectedScenarioRunCatalog,
                            runDetail: state.scenarioRunDetail,
                            artifacts:
                              state.selectedScenarioRunId ===
                              selectedScenarioRun.runId
                                ? state.scenarioRunArtifacts
                                : null,
                          },
                          null,
                          2,
                        ),
                      )}</pre>
                    </details>`
                  : ""
              }
            </article>
          `
          : `<div class="detail-card empty-state compact-empty">Select a recent scenario run to inspect drilldown links.</div>`
      }
    </section>
    <section class="run-center-section">
      <div class="panel-header nested">
        <h3>Recent Regression Runs</h3>
      </div>
      <div class="run-center-list">
        ${
          recentRegressionRuns
            .slice(0, 10)
            .map(
              (item) => `
                <article class="run-center-item run-history-item ${item.runId === state.selectedRunCenterRegressionRunId ? "active" : ""}" data-run-center-regression-run-id="${escapeHtml(item.runId)}" data-run-center-regression-id="${escapeHtml(item.regressionId)}">
                  <div class="event-title">
                    <strong>${escapeHtml(item.regressionId || item.runId)}</strong>
                    ${renderStatePill(item.status)}
                  </div>
                  <div class="event-meta">
                    <code>run=${escapeHtml(item.runId)}</code>
                    <code>pass=${escapeHtml(String(item.passCount))}</code>
                    <code>fail=${escapeHtml(String(item.failCount))}</code>
                    <code>started=${escapeHtml(item.startedAt)}</code>
                  </div>
                  <div class="lineage-meta">
                    ${renderTrendSnapshotPills(item.trendSnapshot)}
                    ${item.failure ? renderMetaPill("failure", summarizeFailureLabel(item.failure), "failed") : ""}
                    ${
                      item.suggestedActions.length > 0
                        ? renderMetaPill(
                            "actions",
                            item.suggestedActions.length,
                            "changed",
                          )
                        : ""
                    }
                  </div>
                </article>
              `,
            )
            .join("") ||
          `<div class="detail-card empty-state compact-empty">No recent regression runs in run-center payload.</div>`
        }
      </div>
      ${
        selectedRegressionRun
          ? `
            <article class="detail-card run-center-drilldown">
              <div class="event-title">
                <strong>Regression Run Drilldown</strong>
                ${renderStatePill(selectedRegressionRun.status)}
              </div>
              <div class="event-meta">
                <code>run=${escapeHtml(selectedRegressionRun.runId)}</code>
                <code>regression=${escapeHtml(selectedRegressionRun.regressionId || "-")}</code>
                <code>started=${escapeHtml(selectedRegressionRun.startedAt)}</code>
                <code>ended=${escapeHtml(selectedRegressionRun.endedAt)}</code>
              </div>
              <div class="lineage-meta">
                <a class="inline-link" href="${escapeHtml(buildRegressionRunByIdHref(selectedRegressionRun.runId))}" target="_blank" rel="noreferrer">run json</a>
                <a class="inline-link" href="${escapeHtml(buildRegressionReportByRunIdHref(selectedRegressionRun.runId))}" target="_blank" rel="noreferrer">report json</a>
                ${
                  selectedRegressionRun.regressionId
                    ? `<a class="inline-link" href="${escapeHtml(buildRegressionTrendHref(selectedRegressionRun.regressionId))}" target="_blank" rel="noreferrer">trend json</a>`
                    : ""
                }
                ${
                  selectedRegressionRun.regressionId
                    ? `<a class="inline-link" href="${escapeHtml(buildRegressionRunsHref(selectedRegressionRun.regressionId))}" target="_blank" rel="noreferrer">all runs</a>`
                    : ""
                }
                ${
                  selectedRegressionRun.regressionId
                    ? `<button type="button" class="secondary-button jump-button" data-jump-regression-id="${escapeHtml(selectedRegressionRun.regressionId)}">open regression</button>`
                    : ""
                }
              </div>
              ${renderTrendSnapshotCard(selectedRegressionRunTrendSnapshot, "Trend Snapshot", "No trend snapshot returned for this regression run.")}
              ${renderSummaryObjectCard(selectedRegressionTrendPayload, "Regression Trend Detail", state.regressionTrendState === "error" ? `Failed to load regression trend: ${state.regressionTrendError}` : "No route-backed regression trend detail returned.")}
              ${renderFailureCard(selectedRegressionRunFailure, "Failure Classification", "No failure classification returned for this regression run.")}
              ${renderSuggestedActionsCard(selectedRegressionRunSuggestedActions, "Suggested Actions", "No suggested actions returned for this regression run.")}
              ${renderReportSummaryCard(selectedRegressionReportPayload, state.regressionRunReportState === "error" ? `Failed to load regression report: ${state.regressionRunReportError}` : "No route-backed regression report detail returned.")}
              ${
                selectedRegressionRunCatalog ||
                state.regressionRunDetail ||
                state.regressionRunReport
                  ? `<details class="policy-details">
                      <summary>Route-backed Drilldown</summary>
                      <pre class="code-block compact-code">${escapeHtml(
                        JSON.stringify(
                          {
                            catalogRun: selectedRegressionRunCatalog,
                            runDetail: state.regressionRunDetail,
                            report: state.regressionRunReport,
                          },
                          null,
                          2,
                        ),
                      )}</pre>
                    </details>`
                  : ""
              }
            </article>
          `
          : `<div class="detail-card empty-state compact-empty">Select a recent regression run to inspect drilldown links.</div>`
      }
    </section>
  `;

  for (const button of els.runCenterSummary.querySelectorAll(
    "[data-run-center-scenario]",
  )) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const scenarioId = button.dataset.runCenterScenario;
      if (!scenarioId) {
        return;
      }
      state.selectedScenarioId = scenarioId;
      refresh().catch((error) => console.error(error));
    });
  }

  for (const button of els.runCenterSummary.querySelectorAll(
    "[data-run-center-regression]",
  )) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const regressionId = button.dataset.runCenterRegression;
      if (!regressionId) {
        return;
      }
      state.selectedRegressionId = regressionId;
      refresh().catch((error) => console.error(error));
    });
  }

  for (const item of els.runCenterSummary.querySelectorAll(
    "[data-run-center-scenario-run-id]",
  )) {
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      state.selectedRunCenterScenarioRunId =
        item.dataset.runCenterScenarioRunId;
      const scenarioId = item.dataset.runCenterScenarioId;
      if (
        scenarioId &&
        (state.selectedScenarioId !== scenarioId ||
          state.selectedScenarioRunId !== state.selectedRunCenterScenarioRunId)
      ) {
        state.selectedScenarioId = scenarioId;
        state.selectedScenarioRunId = state.selectedRunCenterScenarioRunId;
        refresh().catch((error) => console.error(error));
        return;
      }
      renderRunCenter();
    });
  }

  for (const item of els.runCenterSummary.querySelectorAll(
    "[data-run-center-regression-run-id]",
  )) {
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      state.selectedRunCenterRegressionRunId =
        item.dataset.runCenterRegressionRunId;
      const regressionId = item.dataset.runCenterRegressionId;
      if (
        regressionId &&
        (state.selectedRegressionId !== regressionId ||
          state.selectedRegressionRunId !==
            state.selectedRunCenterRegressionRunId)
      ) {
        state.selectedRegressionId = regressionId;
        state.selectedRegressionRunId = state.selectedRunCenterRegressionRunId;
        refresh().catch((error) => console.error(error));
        return;
      }
      renderRunCenter();
    });
  }

  for (const item of els.runCenterSummary.querySelectorAll(
    "[data-run-center-work-item-run-id]",
  )) {
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      state.selectedRunCenterWorkItemRunId =
        item.dataset.runCenterWorkItemRunId;
      loadWorkItemRunDrilldown()
        .then(() => renderRunCenter())
        .catch((error) => console.error(error));
    });
  }

  for (const button of els.runCenterSummary.querySelectorAll(
    "[data-jump-execution-id]",
  )) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const executionId = button.dataset.jumpExecutionId;
      if (!executionId) {
        return;
      }
      state.selectedExecutionId = executionId;
      connectExecutionEventStream();
      refresh().catch((error) => console.error(error));
    });
  }

  for (const button of els.runCenterSummary.querySelectorAll(
    "[data-jump-scenario-id]",
  )) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const scenarioId = button.dataset.jumpScenarioId;
      if (!scenarioId) {
        return;
      }
      state.selectedScenarioId = scenarioId;
      refresh().catch((error) => console.error(error));
    });
  }

  for (const button of els.runCenterSummary.querySelectorAll(
    "[data-jump-regression-id]",
  )) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const regressionId = button.dataset.jumpRegressionId;
      if (!regressionId) {
        return;
      }
      state.selectedRegressionId = regressionId;
      refresh().catch((error) => console.error(error));
    });
  }
}

function renderExecutionHistoryDrilldown(
  row: AnyRecord | null,
  fallbackExecutionId: string | null = null,
) {
  if (!row) {
    return `<div class="detail-card empty-state compact-empty">Select a history row to inspect references and raw payload.</div>`;
  }

  const references = row.references ?? {};
  const executionIds = references.executionIds ?? [];
  const sessionIds = references.sessionIds ?? [];
  const scenarioRuns = references.scenarioRuns ?? [];
  const regressionRunIds = references.regressionRunIds ?? [];
  const auditIds = references.auditIds ?? [];
  const escalationIds = references.escalationIds ?? [];
  const stepIds = references.stepIds ?? [];
  const referenceExecutionId = executionIds[0] ?? fallbackExecutionId ?? null;

  return `
    <section class="run-drilldown-panel history-drilldown">
      <div class="panel-header nested">
        <h3>History Row Drilldown</h3>
        <span class="muted">${escapeHtml(normalizeText(row.kind, "history"))}</span>
      </div>
      <div class="detail-grid">
        <div><span class="muted">Row Key</span><br /><code>${escapeHtml(normalizeText(row.key))}</code></div>
        <div><span class="muted">Timestamp</span><br /><code>${escapeHtml(normalizeText(row.timestamp))}</code></div>
        <div><span class="muted">Title</span><br /><code>${escapeHtml(normalizeText(row.title))}</code></div>
        <div><span class="muted">Status</span><br /><code>${escapeHtml(normalizeText(row.status, "n/a"))}</code></div>
      </div>
      <div class="lineage-meta">
        ${renderMetaPill("executions", executionIds.length)}
        ${renderMetaPill("sessions", sessionIds.length)}
        ${renderMetaPill("steps", stepIds.length)}
        ${renderMetaPill("scenario-runs", scenarioRuns.length)}
        ${renderMetaPill("regressions", regressionRunIds.length)}
        ${renderMetaPill("audit-ids", auditIds.length)}
        ${renderMetaPill("escalation-ids", escalationIds.length)}
      </div>
      <div class="event-list">
        ${
          referenceExecutionId
            ? `
              <article class="detail-card compact-empty">
                <div class="event-title">
                  <strong>Execution References</strong>
                  <button type="button" class="secondary-button jump-button" data-jump-execution-id="${escapeHtml(referenceExecutionId)}">open selected execution</button>
                </div>
                <div class="lineage-meta">
                  <a class="inline-link" href="${escapeHtml(buildExecutionHref(referenceExecutionId))}" target="_blank" rel="noreferrer">execution json</a>
                  <a class="inline-link" href="/api/orchestrator/executions/${escapeHtml(encodeURIComponent(referenceExecutionId))}/history" target="_blank" rel="noreferrer">history json</a>
                  <a class="inline-link" href="/api/orchestrator/executions/${escapeHtml(encodeURIComponent(referenceExecutionId))}/audit" target="_blank" rel="noreferrer">audit json</a>
                  <a class="inline-link" href="/api/orchestrator/executions/${escapeHtml(encodeURIComponent(referenceExecutionId))}/escalations" target="_blank" rel="noreferrer">escalations json</a>
                </div>
                ${
                  executionIds.length > 1
                    ? `<div class="lineage-meta">${executionIds
                        .slice(1)
                        .map(
                          (executionId) =>
                            `<button type="button" class="secondary-button jump-button" data-jump-execution-id="${escapeHtml(executionId)}">${escapeHtml(executionId)}</button>`,
                        )
                        .join("")}</div>`
                    : ""
                }
              </article>
            `
            : ""
        }
        ${
          sessionIds.length > 0
            ? `
              <article class="detail-card compact-empty">
                <div class="event-title">
                  <strong>Session References</strong>
                  <span class="muted">${escapeHtml(String(sessionIds.length))}</span>
                </div>
                <div class="lineage-meta">
                  ${sessionIds
                    .map(
                      (sessionId) => `
                        <button type="button" class="secondary-button jump-button" data-jump-session-id="${escapeHtml(sessionId)}">${escapeHtml(sessionId)}</button>
                        <a class="inline-link" href="${escapeHtml(buildSessionHref(sessionId))}" target="_blank" rel="noreferrer">json</a>
                      `,
                    )
                    .join("")}
                </div>
              </article>
            `
            : ""
        }
        ${
          scenarioRuns.length > 0
            ? `
              <article class="detail-card compact-empty">
                <div class="event-title">
                  <strong>Scenario Run References</strong>
                  <span class="muted">${escapeHtml(String(scenarioRuns.length))}</span>
                </div>
                <div class="lineage-meta">
                  ${scenarioRuns
                    .map(
                      (reference) =>
                        `<a class="inline-link" href="${escapeHtml(buildScenarioRunArtifactsHref(reference.scenarioId, reference.runId))}" target="_blank" rel="noreferrer">${escapeHtml(reference.scenarioId)} · ${escapeHtml(reference.runId)}</a>`,
                    )
                    .join("")}
                </div>
              </article>
            `
            : ""
        }
        ${
          regressionRunIds.length > 0
            ? `
              <article class="detail-card compact-empty">
                <div class="event-title">
                  <strong>Regression Run References</strong>
                  <span class="muted">${escapeHtml(String(regressionRunIds.length))}</span>
                </div>
                <div class="lineage-meta">
                  ${regressionRunIds.map((runId) => `<code>${escapeHtml(runId)}</code>`).join("")}
                </div>
              </article>
            `
            : ""
        }
        ${
          stepIds.length > 0
            ? `
              <article class="detail-card compact-empty">
                <div class="event-title">
                  <strong>Step References</strong>
                  <span class="muted">${escapeHtml(String(stepIds.length))}</span>
                </div>
                <div class="lineage-meta">
                  ${stepIds.map((stepId) => `<code>${escapeHtml(stepId)}</code>`).join("")}
                </div>
              </article>
            `
            : ""
        }
        ${
          auditIds.length > 0
            ? `
              <article class="detail-card compact-empty">
                <div class="event-title">
                  <strong>Audit IDs</strong>
                </div>
                <div class="lineage-meta">
                  ${auditIds.map((auditId) => `<code>${escapeHtml(auditId)}</code>`).join("")}
                </div>
              </article>
            `
            : ""
        }
        ${
          escalationIds.length > 0
            ? `
              <article class="detail-card compact-empty">
                <div class="event-title">
                  <strong>Escalation IDs</strong>
                </div>
                <div class="lineage-meta">
                  ${escalationIds.map((escalationId) => `<code>${escapeHtml(escalationId)}</code>`).join("")}
                </div>
              </article>
            `
            : ""
        }
        ${renderPathReferenceList(references.reportPaths ?? [], "Report Paths")}
        ${renderPathReferenceList(references.artifactPaths ?? [], "Artifact Paths")}
        <article class="detail-card compact-empty">
          <div class="event-title">
            <strong>Raw Row Payload</strong>
          </div>
          <pre class="code-block compact-code">${escapeHtml(JSON.stringify(row.raw ?? null, null, 2))}</pre>
        </article>
      </div>
    </section>
  `;
}

function renderExecutionHistory(detail: AnyRecord | null) {
  if (!els.executionHistory || !els.executionHistoryState) {
    return;
  }
  const history = detail?.history ?? null;
  if (!detail?.execution) {
    els.executionHistoryState.textContent = "history route: idle";
    els.executionHistory.className = "execution-history empty-state";
    els.executionHistory.textContent =
      "Select an execution to load structured history and policy snapshots.";
    state.selectedExecutionHistoryRowKey = null;
    return;
  }
  if (!history) {
    els.executionHistoryState.textContent = "history route: unavailable";
    els.executionHistory.className = "execution-history empty-state";
    els.executionHistory.textContent =
      "Structured execution history is not available for the selected execution.";
    state.selectedExecutionHistoryRowKey = null;
    return;
  }
  const rows = normalizeExecutionHistoryRows({
    timeline: history.timeline ?? [],
  });
  if (
    state.selectedExecutionHistoryRowKey &&
    !rows.some((row) => row.key === state.selectedExecutionHistoryRowKey)
  ) {
    state.selectedExecutionHistoryRowKey = null;
  }
  if (!state.selectedExecutionHistoryRowKey && rows[0]) {
    state.selectedExecutionHistoryRowKey = rows[0].key;
  }
  const selectedRow =
    rows.find((row) => row.key === state.selectedExecutionHistoryRowKey) ??
    null;

  els.executionHistoryState.textContent = `history route: ready · ${rows.length} row${rows.length === 1 ? "" : "s"}`;
  els.executionHistory.className = "execution-history";
  els.executionHistory.innerHTML = `
    <div class="timeline-summary">
      <code>tree=${escapeHtml(String(history.tree?.executionCount ?? 1))}</code>
      <code>timeline=${escapeHtml(String(rows.length))}</code>
      <code>audit=${escapeHtml(String((history.audit ?? []).length))}</code>
      <code>escalations=${escapeHtml(String((history.escalations ?? []).length))}</code>
    </div>
    ${renderWaveSummaryPanel({
      title: "History Wave Summary",
      stepSummary: history.stepSummary,
      compact: true,
      emptyText: "No wave summary returned.",
    })}
    ${renderPolicyDiffPanel({
      title: "Execution Policy Diff",
      baselineTitle: "Planned Effective Policy",
      candidateTitle: "Persisted Execution Policy",
      baselinePolicy: history.policyDiff?.plannedEffectivePolicy ?? null,
      candidatePolicy: history.policyDiff?.persistedExecutionPolicy ?? null,
      compact: true,
      mode: "full",
      emptyText: "No policy diff returned.",
    })}
    <ol class="timeline-list">
      ${
        rows
          .map(
            (row) => `
        <li class="timeline-item ${escapeHtml(row.tone)} ${row.key === state.selectedExecutionHistoryRowKey ? "active" : ""}" data-history-row-key="${escapeHtml(row.key)}">
          <div class="timeline-dot" aria-hidden="true"></div>
          <div class="timeline-content">
            <div class="timeline-title">
              <strong>${escapeHtml(row.title)}</strong>
              <code>${escapeHtml(row.timestamp)}</code>
            </div>
            ${row.meta ? `<p class="timeline-meta">${escapeHtml(row.meta)}</p>` : ""}
            <div class="lineage-meta">
              ${renderMetaPill("kind", normalizeText(row.kind))}
              ${(row.references?.sessionIds ?? []).length ? renderMetaPill("sessions", row.references.sessionIds.length) : ""}
              ${(row.references?.executionIds ?? []).length ? renderMetaPill("executions", row.references.executionIds.length) : ""}
              ${(row.references?.artifactPaths ?? []).length ? renderMetaPill("artifacts", row.references.artifactPaths.length) : ""}
              ${(row.references?.reportPaths ?? []).length ? renderMetaPill("reports", row.references.reportPaths.length) : ""}
            </div>
          </div>
        </li>
      `,
          )
          .join("") ||
        `<li class="timeline-item neutral"><div class="timeline-content"><p class="timeline-meta">No structured history rows returned.</p></div></li>`
      }
    </ol>
    ${renderExecutionHistoryDrilldown(selectedRow, detail?.execution?.id)}
  `;

  for (const item of els.executionHistory.querySelectorAll(
    "[data-history-row-key]",
  )) {
    item.addEventListener("click", () => {
      state.selectedExecutionHistoryRowKey = item.dataset.historyRowKey;
      renderExecutionHistory(detail);
    });
  }

  for (const button of els.executionHistory.querySelectorAll(
    "[data-jump-execution-id]",
  )) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const executionId = button.dataset.jumpExecutionId;
      if (!executionId) {
        return;
      }
      state.selectedExecutionId = executionId;
      connectExecutionEventStream();
      refresh().catch((error) => console.error(error));
    });
  }

  for (const button of els.executionHistory.querySelectorAll(
    "[data-jump-session-id]",
  )) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const sessionId = button.dataset.jumpSessionId;
      if (!sessionId) {
        return;
      }
      state.selectedSessionId = sessionId;
      connectEventStream();
      refresh().catch((error) => console.error(error));
    });
  }
}

function renderExecutionMiniCard(
  execution: AnyRecord | null,
  { label, selectedId }: AnyRecord = {},
) {
  if (!execution) {
    return "";
  }
  const activeClass = execution.id === selectedId ? "selected" : "";
  return `
    <article class="lineage-card ${activeClass}">
      <div class="lineage-card-header">
        <strong>${escapeHtml(execution.id)}</strong>
        ${renderStatePill(execution.state)}
      </div>
      <div class="lineage-card-meta">
        ${label ? `<span class="muted">${escapeHtml(label)}</span>` : ""}
        <code>domain=${escapeHtml(normalizeText(execution.domainId))}</code>
        <code>workflow=${escapeHtml(normalizeText(execution.workflowId))}</code>
        ${
          execution.parentExecutionId
            ? `<code>parent=${escapeHtml(normalizeText(execution.parentExecutionId))}</code>`
            : `<code>root</code>`
        }
        ${execution.branchKey ? `<code>branch=${escapeHtml(normalizeText(execution.branchKey))}</code>` : ""}
        ${execution.holdReason ? `<code>hold=${escapeHtml(normalizeText(execution.holdReason))}</code>` : ""}
      </div>
      <div class="lineage-meta">
        ${renderExecutionModePills(execution)}
        ${renderExecutionProjectMetadataPills(execution)}
      </div>
    </article>
  `;
}

function formatStateCountsMap(counts: AnyRecord = {}) {
  if (!isObject(counts)) {
    return "";
  }

  return Object.entries(counts)
    .filter(([, value]) => hasDisplayValue(value))
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([key, value]) => `${key}:${value}`)
    .join(" · ");
}

function getSummaryCount(counts: AnyRecord = {}, key: string) {
  const value = Number(counts?.[key] ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function getWaveEntries(stepSummary: AnyRecord = {}) {
  return Array.isArray(stepSummary?.byWave)
    ? stepSummary.byWave.filter((entry) => isObject(entry))
    : [];
}

function formatWaveLabel(value) {
  const wave = Number(value);
  return Number.isFinite(wave) ? `Wave ${wave + 1}` : "Wave";
}

function formatWaveGate(gate) {
  if (!isObject(gate)) {
    return "all";
  }

  const mode = normalizeText(gate.mode, "all");
  const threshold = readFirstField(gate, [
    "count",
    "threshold",
    "minSuccessCount",
    "successCount",
  ]);
  return hasDisplayValue(threshold) ? `${mode}:${threshold}` : mode;
}

function getWaveEntryTone(entry: AnyRecord = {}) {
  const byState = entry.byState ?? {};
  if (entry.satisfied) {
    return "settled";
  }
  if (
    getSummaryCount(byState, "review_pending") > 0 ||
    getSummaryCount(byState, "approval_pending") > 0
  ) {
    return "governance";
  }
  if (
    getSummaryCount(byState, "failed") > 0 ||
    getSummaryCount(byState, "rejected") > 0 ||
    getSummaryCount(byState, "stopped") > 0
  ) {
    return "failed";
  }
  if (getSummaryCount(byState, "active") > 0) {
    return "running";
  }
  return "planned";
}

function renderWaveSummaryPanel({
  title,
  stepSummary,
  emptyText = "No wave progression returned.",
  compact = false,
}: AnyRecord = {}) {
  const waves = getWaveEntries(stepSummary);
  const panelClass = compact
    ? "wave-summary-panel compact"
    : "wave-summary-panel";

  if (waves.length === 0) {
    return `
      <section class="${panelClass}">
        <div class="policy-panel-header">
          <strong>${escapeHtml(title)}</strong>
        </div>
        <div class="policy-empty">${escapeHtml(emptyText)}</div>
      </section>
    `;
  }

  const settledCount = waves.filter((entry) => entry.satisfied).length;
  const openCount = Math.max(waves.length - settledCount, 0);
  const frontier = waves.find((entry) => !entry.satisfied) ?? null;

  return `
    <section class="${panelClass}">
      <div class="policy-panel-header">
        <strong>${escapeHtml(title)}</strong>
        <div class="lineage-meta">
          ${renderMetaPill("waves", waves.length)}
          ${renderMetaPill("settled", settledCount, settledCount > 0 ? "root" : "")}
          ${renderMetaPill("open", openCount, openCount > 0 ? "governance" : "")}
          ${
            frontier
              ? renderMetaPill(
                  "frontier",
                  formatWaveLabel(frontier.wave),
                  getWaveEntryTone(frontier) === "governance"
                    ? "governance"
                    : "inherited",
                )
              : renderMetaPill("frontier", "settled", "root")
          }
        </div>
      </div>
      <div class="wave-summary-grid">
        ${waves
          .map((entry) => {
            const tone = getWaveEntryTone(entry);
            const reviewPending = getSummaryCount(
              entry.byState,
              "review_pending",
            );
            const approvalPending = getSummaryCount(
              entry.byState,
              "approval_pending",
            );
            const stateSummary = formatStateCountsMap(entry.byState);
            const statusLabel =
              tone === "settled"
                ? "settled"
                : tone === "governance"
                  ? "governance"
                  : tone === "failed"
                    ? "blocked"
                    : tone === "running"
                      ? "active"
                      : "planned";
            const pillTone =
              tone === "settled"
                ? "completed"
                : tone === "governance"
                  ? "waiting_review"
                  : tone === "failed"
                    ? "failed"
                    : tone === "running"
                      ? "active"
                      : "";

            return `
              <article class="wave-card ${escapeHtml(tone)}">
                <div class="wave-card-header">
                  <strong>${escapeHtml(formatWaveLabel(entry.wave))}</strong>
                  <span class="pill ${escapeHtml(pillTone)}">${escapeHtml(statusLabel)}</span>
                </div>
                <div class="lineage-meta">
                  ${renderMetaPill("gate", formatWaveGate(entry.gate), tone === "settled" ? "root" : tone === "governance" ? "governance" : "inherited")}
                  ${renderMetaPill("steps", entry.count)}
                  ${reviewPending ? renderMetaPill("review", reviewPending, "governance") : ""}
                  ${approvalPending ? renderMetaPill("approval", approvalPending, "governance") : ""}
                </div>
                ${stateSummary ? `<p class="tree-objective">states: ${escapeHtml(stateSummary)}</p>` : ""}
              </article>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function summarizeWaveProgress(stepSummary = {}) {
  const waves = getWaveEntries(stepSummary);
  if (waves.length === 0) {
    return "";
  }

  return waves
    .map((entry) => {
      const tone = getWaveEntryTone(entry);
      const stateSummary =
        formatStateCountsMap(entry.byState) ||
        `${entry.count} step${entry.count === 1 ? "" : "s"}`;
      const progress =
        tone === "settled" ? "settled" : `gate ${formatWaveGate(entry.gate)}`;
      return `${formatWaveLabel(entry.wave)} ${progress} · ${stateSummary}`;
    })
    .join(" | ");
}

function countTreeGovernanceTargets(treeContext, action) {
  if (!treeContext?.rows?.length) {
    return {
      executionCount: 0,
      stepCount: 0,
    };
  }

  const waitingState =
    action === "approval" ? "waiting_approval" : "waiting_review";
  const pendingState =
    action === "approval" ? "approval_pending" : "review_pending";
  let executionCount = 0;
  let stepCount = 0;

  for (const row of treeContext.rows) {
    const rowPendingSteps = getSummaryCount(
      row.stepSummary?.byState ?? {},
      pendingState,
    );
    if (
      normalizeText(row.execution?.state) === waitingState ||
      rowPendingSteps > 0
    ) {
      executionCount += 1;
    }
    stepCount += rowPendingSteps;
  }

  return {
    executionCount,
    stepCount,
  };
}

function collectExecutionTreeRows(node, rows = [], depth = 0, parent = null) {
  if (!node?.execution) {
    return rows;
  }

  const row = {
    node,
    execution: node.execution,
    stepSummary: node.stepSummary ?? {},
    depth,
    parent,
  };
  rows.push(row);

  for (const child of node.children ?? []) {
    collectExecutionTreeRows(child, rows, depth + 1, row);
  }

  return rows;
}

function deriveExecutionTreeContext(detail) {
  const tree = detail?.tree ?? null;
  const rootNode = tree?.root ?? null;
  if (!rootNode?.execution) {
    return null;
  }

  const rows = collectExecutionTreeRows(rootNode);
  const selectedExecutionId =
    tree?.selectedExecutionId ?? detail?.execution?.id ?? null;
  const selectedRow =
    rows.find((row) => row.execution.id === selectedExecutionId) ??
    rows.find((row) => row.execution.id === detail?.execution?.id) ??
    rows[0] ??
    null;
  const parentRow = selectedRow?.parent ?? null;
  const childRows = rows.filter(
    (row) => row.parent?.execution?.id === selectedRow?.execution?.id,
  );
  const siblingRows = rows.filter(
    (row) =>
      row.parent?.execution?.id === parentRow?.execution?.id &&
      row.execution.id !== selectedRow?.execution?.id,
  );
  const byState = {};
  let heldCount = 0;
  let activeCount = 0;

  for (const row of rows) {
    const state = normalizeText(row.execution?.state, "unknown");
    byState[state] = (byState[state] ?? 0) + 1;
    if (["paused", "held"].includes(state)) {
      heldCount += 1;
    }
    if (
      !["completed", "canceled", "failed", "stopped", "rejected"].includes(
        state,
      )
    ) {
      activeCount += 1;
    }
  }

  return {
    tree,
    rows,
    rootNode,
    rootRow: rows[0] ?? null,
    selectedRow,
    parentRow,
    childRows,
    siblingRows,
    byState,
    heldCount,
    activeCount,
    executionCount: rows.length,
    coordinationGroupId: tree?.coordinationGroupId ?? null,
  };
}

function renderExecutionTreeBranch(node, selectedId, depth = 0) {
  const execution = node?.execution ?? null;
  if (!execution) {
    return "";
  }

  const stepSummary = node.stepSummary ?? {};
  const stateSummary = formatStateCountsMap(stepSummary.byState);
  const waveSummary = summarizeWaveProgress(stepSummary);
  const waveCount = getWaveEntries(stepSummary).length;
  const label =
    depth === 0
      ? "Root execution"
      : execution.branchKey
        ? `Branch ${execution.branchKey}`
        : "Child execution";

  return `
    <li class="execution-branch-node">
      <div class="execution-branch-card depth-${Math.min(depth, 4)}">
        ${renderExecutionMiniCard(execution, {
          label,
          selectedId,
        })}
        <div class="lineage-meta">
          ${hasDisplayValue(stepSummary.count) ? renderMetaPill("steps", stepSummary.count) : ""}
          ${waveCount ? renderMetaPill("waves", waveCount, waveCount > 1 ? "branch" : "") : ""}
          ${Array.isArray(node.children) && node.children.length ? renderMetaPill("children", node.children.length, "child") : ""}
          ${depth > 0 ? renderMetaPill("depth", depth) : ""}
        </div>
        ${stateSummary ? `<p class="tree-objective">step states: ${escapeHtml(stateSummary)}</p>` : ""}
        ${waveSummary ? `<p class="tree-objective">waves: ${escapeHtml(waveSummary)}</p>` : ""}
      </div>
      ${
        Array.isArray(node.children) && node.children.length > 0
          ? `<ul class="execution-branch-children">
              ${node.children.map((child) => renderExecutionTreeBranch(child, selectedId, depth + 1)).join("")}
            </ul>`
          : ""
      }
    </li>
  `;
}

function renderWorkflowLaunchPreview(launch, index) {
  const roleLabel = launch?.role ? `${launch.role}` : `step-${index + 1}`;
  const previewPolicy = state.workflowPreview?.effectivePolicy ?? null;
  return `
    <article class="workflow-launch-card">
      <div class="lineage-card-header">
        <strong>${escapeHtml(roleLabel)}</strong>
        <span class="pill ${stateClass(launch?.sessionMode ?? "planned")}">${escapeHtml(normalizeText(launch?.sessionMode, "planned"))}</span>
      </div>
      <div class="lineage-card-meta">
        <code>session=${escapeHtml(normalizeText(launch?.sessionId))}</code>
        <code>profile=${escapeHtml(normalizeText(launch?.requestedProfileId ?? launch?.profilePath))}</code>
        <code>attempts=${escapeHtml(String(launch?.maxAttempts ?? 1))}</code>
      </div>
      <div class="lineage-meta">
        ${renderPolicyLabelPills([launch, launch?.policy])}
        ${renderPolicyHighlights(launch?.policy)}
      </div>
      ${renderPolicyPanel({
        title: `Step Policy ${index + 1}`,
        policy: launch?.policy,
        labelCarriers: [launch, launch?.policy],
        compact: true,
        emptyText: "No step policy returned.",
      })}
      ${renderPolicyDiffPanel({
        title: "Delta vs Effective Policy",
        baselineTitle: normalizeText(
          state.workflowPreview?.invocationId,
          "Preview Effective Policy",
        ),
        candidateTitle: `${roleLabel} Launch Policy`,
        baselinePolicy: previewPolicy,
        candidatePolicy: launch?.policy,
        baselineCarriers: [
          state.workflowPreview,
          previewPolicy,
          state.workflowPreview?.domain,
          state.workflowPreview?.project,
        ],
        candidateCarriers: [launch, launch?.policy],
        compact: true,
        mode: "delta",
        emptyText: "No preview effective policy returned for comparison.",
      })}
    </article>
  `;
}

function renderExecutionLineageBoard(detail) {
  const execution = detail?.execution;
  if (!execution) {
    return "";
  }

  const treeContext = deriveExecutionTreeContext(detail);
  if (treeContext) {
    const selectedRow = treeContext.selectedRow ?? null;
    const rootRow = treeContext.rootRow ?? null;
    const parentRow = treeContext.parentRow ?? null;
    const childRows = treeContext.childRows ?? [];
    const siblingRows = treeContext.siblingRows ?? [];
    const selectedWaveSummary = selectedRow?.stepSummary ?? null;
    const rootWaveSummary =
      rootRow?.execution?.id !== selectedRow?.execution?.id
        ? (rootRow?.stepSummary ?? null)
        : null;
    const lineageId =
      execution.coordinationGroupId ??
      (treeContext.executionCount > 1
        ? (treeContext.coordinationGroupId ?? rootRow?.execution?.id)
        : "standalone");

    return `
      <section class="lineage-board">
        <div class="lineage-board-header">
          <strong>Coordination &amp; Lineage</strong>
          <span class="muted">${escapeHtml(normalizeText(lineageId, "standalone"))}</span>
        </div>
        <div class="lineage-meta">
          ${renderMetaPill("count", treeContext.executionCount)}
          ${renderMetaPill("roots", 1, "root")}
          ${renderMetaPill("children", Math.max(treeContext.executionCount - 1, 0), "child")}
          ${renderMetaPill("active", treeContext.activeCount)}
          ${renderMetaPill("held", treeContext.heldCount, "held")}
        </div>
        <p class="tree-objective">${escapeHtml(formatStateCountsMap(treeContext.byState) || "No execution states yet.")}</p>
        ${
          selectedWaveSummary
            ? renderWaveSummaryPanel({
                title:
                  selectedRow?.execution?.id === execution.id
                    ? "Selected Execution Waves"
                    : "Current Execution Waves",
                stepSummary: selectedWaveSummary,
                compact: true,
                emptyText:
                  "No wave summary returned for the selected execution.",
              })
            : ""
        }
        ${
          rootWaveSummary
            ? renderWaveSummaryPanel({
                title: "Root Execution Waves",
                stepSummary: rootWaveSummary,
                compact: true,
                emptyText: "No wave summary returned for the root execution.",
              })
            : ""
        }
        <div class="lineage-board-grid">
          ${
            selectedRow
              ? renderExecutionMiniCard(selectedRow.execution, {
                  label: selectedRow.parent
                    ? "Current child execution"
                    : "Current root execution",
                  selectedId: execution.id,
                })
              : ""
          }
          ${
            parentRow
              ? renderExecutionMiniCard(parentRow.execution, {
                  label: "Parent execution",
                  selectedId: execution.id,
                })
              : ""
          }
          ${
            rootRow && rootRow.execution.id !== selectedRow?.execution?.id
              ? renderExecutionMiniCard(rootRow.execution, {
                  label: "Tree root",
                  selectedId: execution.id,
                })
              : ""
          }
        </div>
        ${
          childRows.length > 0
            ? `
              <div class="lineage-cluster">
                <div class="lineage-cluster-header">
                  <strong>Child executions</strong>
                  <span class="muted">${escapeHtml(String(childRows.length))}</span>
                </div>
                <div class="lineage-board-grid">
                  ${childRows
                    .map((row) =>
                      renderExecutionMiniCard(row.execution, {
                        label: row.execution.branchKey
                          ? `Branch ${row.execution.branchKey}`
                          : "Child execution",
                        selectedId: execution.id,
                      }),
                    )
                    .join("")}
                </div>
              </div>
            `
            : ""
        }
        ${
          siblingRows.length > 0
            ? `
              <div class="lineage-cluster">
                <div class="lineage-cluster-header">
                  <strong>Sibling executions</strong>
                  <span class="muted">${escapeHtml(String(siblingRows.length))}</span>
                </div>
                <div class="lineage-board-grid">
                  ${siblingRows
                    .map((row) =>
                      renderExecutionMiniCard(row.execution, {
                        label: row.execution.branchKey
                          ? `Branch ${row.execution.branchKey}`
                          : "Sibling execution",
                        selectedId: execution.id,
                      }),
                    )
                    .join("")}
                </div>
              </div>
            `
            : ""
        }
        <div class="lineage-cluster">
          <div class="lineage-cluster-header">
            <strong>Execution tree</strong>
            <span class="muted">${escapeHtml(String(treeContext.executionCount))} node${treeContext.executionCount === 1 ? "" : "s"}</span>
          </div>
          <ul class="execution-branch-list">
            ${renderExecutionTreeBranch(treeContext.rootNode, execution.id)}
          </ul>
        </div>
      </section>
    `;
  }

  const groupSummary = detail?.coordinationGroupSummary ?? null;
  const groupMembers =
    detail?.coordinationGroup ?? groupSummary?.executions ?? [];
  const children = detail?.childExecutions ?? [];
  const parentExecution =
    execution.parentExecutionId && Array.isArray(groupMembers)
      ? groupMembers.find(
          (candidate) => candidate.id === execution.parentExecutionId,
        )
      : null;
  const siblingExecutions = Array.isArray(groupMembers)
    ? groupMembers.filter(
        (candidate) =>
          candidate.id !== execution.id &&
          candidate.parentExecutionId === execution.parentExecutionId,
      )
    : [];

  if (
    !execution.coordinationGroupId &&
    !execution.parentExecutionId &&
    children.length === 0
  ) {
    return "";
  }

  return `
    <section class="lineage-board">
      <div class="lineage-board-header">
        <strong>Coordination &amp; Lineage</strong>
        <span class="muted">${escapeHtml(groupSummary?.groupId ?? execution.coordinationGroupId ?? "standalone")}</span>
      </div>
      <div class="lineage-board-grid">
        ${renderExecutionMiniCard(execution, {
          label: execution.parentExecutionId
            ? "Current child execution"
            : "Current root execution",
          selectedId: execution.id,
        })}
        ${
          parentExecution
            ? renderExecutionMiniCard(parentExecution, {
                label: "Parent execution",
                selectedId: execution.id,
              })
            : ""
        }
      </div>
      ${
        children.length > 0
          ? `
            <div class="lineage-cluster">
              <div class="lineage-cluster-header">
                <strong>Child executions</strong>
                <span class="muted">${escapeHtml(String(children.length))}</span>
              </div>
              <div class="lineage-board-grid">
                ${children
                  .map((childExecution) =>
                    renderExecutionMiniCard(childExecution, {
                      label: childExecution.branchKey
                        ? `Branch ${childExecution.branchKey}`
                        : "Child execution",
                      selectedId: execution.id,
                    }),
                  )
                  .join("")}
              </div>
            </div>
          `
          : ""
      }
      ${
        siblingExecutions.length > 0
          ? `
            <div class="lineage-cluster">
              <div class="lineage-cluster-header">
                <strong>Sibling executions</strong>
                <span class="muted">${escapeHtml(String(siblingExecutions.length))}</span>
              </div>
              <div class="lineage-board-grid">
                ${siblingExecutions
                  .map((sibling) =>
                    renderExecutionMiniCard(sibling, {
                      label: sibling.branchKey
                        ? `Branch ${sibling.branchKey}`
                        : "Sibling execution",
                      selectedId: execution.id,
                    }),
                  )
                  .join("")}
              </div>
            </div>
          `
          : ""
      }
      ${
        groupSummary
          ? `
            <div class="lineage-cluster">
              <div class="lineage-cluster-header">
                <strong>Group summary</strong>
              </div>
              <div class="lineage-meta">
                ${renderMetaPill("count", groupSummary.executionCount ?? groupMembers.length)}
                ${renderMetaPill("roots", groupSummary.rootExecutionIds?.length ?? 0, "root")}
                ${renderMetaPill("children", groupSummary.childExecutionIds?.length ?? children.length, "child")}
                ${renderMetaPill("active", groupSummary.activeExecutionIds?.length ?? 0)}
                ${renderMetaPill("held", groupSummary.heldExecutionIds?.length ?? 0, "held")}
              </div>
              <p class="tree-objective">${escapeHtml(summarizeStates(groupMembers) || "No group states yet.")}</p>
            </div>
          `
          : ""
      }
    </section>
  `;
}

function renderExecutionTree(detail: AnyRecord) {
  const steps = detail?.steps ?? [];
  const sessionMap = new Map<string, AnyRecord>(
    (detail?.sessions ?? []).map((item: AnyRecord) => [
      item.sessionId,
      item.session as AnyRecord,
    ]),
  );
  const stepBySessionId = new Map<string, AnyRecord>(
    steps
      .filter((step: AnyRecord) => step.sessionId)
      .map((step: AnyRecord) => [step.sessionId, step]),
  );
  const lineageBoard = renderExecutionLineageBoard(detail);

  if (steps.length === 0 && !lineageBoard) {
    els.executionTree.className = "execution-tree empty-state";
    els.executionTree.textContent =
      "No step records returned for this execution.";
    return;
  }

  els.executionTree.className = "execution-tree";
  els.executionTree.innerHTML = `
    ${lineageBoard}
    ${
      steps.length === 0
        ? `<div class="detail-card empty-state compact-empty">No step records returned for this execution.</div>`
        : `<ul class="tree-list">
      ${steps
        .map((step) => {
          const session = step.sessionId
            ? sessionMap.get(step.sessionId)
            : null;
          const parentStep = step.parentSessionId
            ? stepBySessionId.get(step.parentSessionId)
            : null;
          const childCount = step.sessionId
            ? steps.filter(
                (candidate) => candidate.parentSessionId === step.sessionId,
              ).length
            : 0;
          const lineageLabel = step.parentSessionId
            ? parentStep
              ? `inherits from step ${parentStep.sequence + 1}`
              : "inherits from unresolved parent"
            : "root step";
          const objective = String(step.objective ?? "").trim();
          const stepPolicy = step.policy ?? null;
          const previewLaunch = findPreviewLaunchForStep(step, step.sequence);
          return `
            <li class="tree-node">
              <div class="tree-row">
                <span class="tree-branch">Step ${step.sequence + 1}</span>
                <strong>${escapeHtml(step.role)}</strong>
                <span class="pill ${stateClass(step.state)}">${escapeHtml(step.state)}</span>
              </div>
              <div class="tree-meta">
                <code>session=${escapeHtml(normalizeText(step.sessionId))}</code>
                <code>profile=${escapeHtml(normalizeText(step.requestedProfileId ?? step.profilePath))}</code>
                <code>attempt=${escapeHtml(`${step.attemptCount ?? 1}/${step.maxAttempts ?? 1}`)}</code>
                <code>review=${escapeHtml(normalizeText(step.reviewStatus))}</code>
                <code>approval=${escapeHtml(normalizeText(step.approvalStatus))}</code>
                ${step.lastError ? `<code>last_error=${escapeHtml(step.lastError)}</code>` : ""}
              </div>
              <div class="lineage-meta">
                <span class="lineage-pill ${step.parentSessionId ? "inherited" : "root"}">${escapeHtml(lineageLabel)}</span>
                <span class="lineage-pill">${escapeHtml(`children ${childCount}`)}</span>
                <span class="lineage-pill">${escapeHtml(`duration ${formatDuration(step.launchedAt, step.settledAt)}`)}</span>
                ${renderPolicyHighlights(stepPolicy)}
              </div>
              ${objective ? `<p class="tree-objective">${escapeHtml(objective)}</p>` : ""}
              <details class="policy-details">
                <summary>Step Policy</summary>
                ${renderPolicyPanel({
                  title: `Step ${step.sequence + 1} Policy`,
                  policy: stepPolicy,
                  labelCarriers: [step, stepPolicy],
                  compact: true,
                  emptyText: "No per-step policy returned.",
                })}
                ${renderPolicyDiffPanel({
                  title: "Delta vs Execution Policy",
                  baselineTitle: `${normalizeText(detail?.execution?.id, "Execution")} Effective Policy`,
                  candidateTitle: `Step ${step.sequence + 1}`,
                  baselinePolicy: detail?.execution?.policy ?? null,
                  candidatePolicy: stepPolicy,
                  baselineCarriers: [
                    detail?.execution,
                    detail?.execution?.policy,
                  ],
                  candidateCarriers: [step, stepPolicy],
                  compact: true,
                  mode: "delta",
                  emptyText:
                    "No persisted execution policy returned for comparison.",
                })}
                ${renderPolicyDiffPanel({
                  title: "Drift vs Preview Launch",
                  baselineTitle: previewLaunch
                    ? `${normalizeText(previewLaunch?.role, `Preview Step ${step.sequence + 1}`)} Launch Policy`
                    : "Preview Launch Policy",
                  candidateTitle: `Step ${step.sequence + 1}`,
                  baselinePolicy: previewLaunch?.policy ?? null,
                  candidatePolicy: stepPolicy,
                  baselineCarriers: [
                    state.workflowPreview,
                    previewLaunch,
                    previewLaunch?.policy,
                  ],
                  candidateCarriers: [step, stepPolicy],
                  compact: true,
                  mode: "full",
                  emptyText: previewLaunch
                    ? "No preview launch policy returned for comparison."
                    : "Load a workflow preview to compare this step against the planned launch policy.",
                })}
                ${renderGuidancePanel({
                  title: "Hold / Timeout Guidance",
                  record: step,
                  policy: stepPolicy,
                  emptyText:
                    "No step-specific hold ownership or timeout guidance returned.",
                })}
              </details>
              ${
                step.sessionId
                  ? `<div class="tree-session ${session ? "" : "missing"}">
                      <div class="tree-row">
                        <span class="tree-branch">Session</span>
                        <strong>${escapeHtml(step.sessionId)}</strong>
                        <span class="pill ${stateClass(session?.state)}">${escapeHtml(normalizeText(session?.state, "unresolved"))}</span>
                      </div>
                      <div class="tree-meta">
                        <code>run=${escapeHtml(normalizeText(session?.runId))}</code>
                        <code>role=${escapeHtml(normalizeText(session?.role))}</code>
                        <code>parent=${escapeHtml(normalizeText(step.parentSessionId))}</code>
                        <code>lineage=${escapeHtml(normalizeText(parentStep?.sessionId, "none"))}</code>
                        <code>tmux=${escapeHtml(normalizeText(session?.tmuxSession))}</code>
                      </div>
                    </div>`
                  : ""
              }
            </li>
          `;
        })
        .join("")}
    </ul>`
    }
  `;
}

function renderExecutionTimeline(detail) {
  const execution = detail?.execution;
  if (!execution) {
    els.executionTimeline.className = "execution-timeline empty-state";
    els.executionTimeline.textContent =
      "Select an execution to load timeline and history.";
    return;
  }

  const treeContext = deriveExecutionTreeContext(detail);
  const selectedWaveSummary = treeContext?.selectedRow?.stepSummary ?? null;
  const workflowEvents = detail?.events ?? [];
  const rows = [];
  const pushRow = (
    timestamp,
    title,
    meta = "",
    tone = "neutral",
    sortBias = 0,
  ) => {
    const parsed = parseTimestamp(timestamp);
    if (parsed === null) {
      return;
    }
    rows.push({
      ts: parsed,
      timestamp,
      title,
      meta,
      tone,
      sortBias,
    });
  };

  if (workflowEvents.length > 0) {
    const toneForType = (type, payload) => {
      if (
        type.includes("failed") ||
        type.includes("rejected") ||
        type.includes("escalated")
      )
        return "failed";
      if (type.includes("completed") || type.includes("approved"))
        return "completed";
      if (type.includes("paused") || type.includes("held")) return "paused";
      if (type.includes("started") || type.includes("pending"))
        return "running";
      if (type.includes("resumed")) return "running";
      if (payload?.status === "changes_requested") return "failed";
      return "neutral";
    };
    for (const event of workflowEvents) {
      const payload = event.payload ?? {};
      pushRow(
        event.createdAt,
        event.type,
        [
          event.stepId ? `step=${event.stepId}` : null,
          event.sessionId ? `session=${event.sessionId}` : null,
          Object.keys(payload).length > 0 ? JSON.stringify(payload) : null,
        ]
          .filter(Boolean)
          .join(" · "),
        toneForType(event.type, payload),
        Number(event.eventIndex ?? 0),
      );
    }
  } else {
    pushRow(execution.createdAt, "Execution created", execution.id, "neutral");
    pushRow(
      execution.startedAt,
      "Execution started",
      execution.state,
      "running",
    );
    pushRow(
      execution.pausedAt,
      "Execution paused",
      execution.holdReason ?? "operator pause",
      "paused",
    );
    pushRow(
      execution.heldAt,
      "Execution held",
      execution.holdReason ?? "operator hold",
      "paused",
    );
    pushRow(
      execution.resumedAt,
      "Execution resumed",
      execution.heldFromState ?? "resumed",
      "running",
    );

    for (const step of detail?.steps ?? []) {
      pushRow(
        step.launchedAt,
        `Step ${step.sequence + 1} launched`,
        `${step.role} · ${normalizeText(step.sessionId)}`,
        "running",
      );
      pushRow(
        step.settledAt,
        `Step ${step.sequence + 1} settled`,
        `${step.role} · ${step.state}`,
        ["failed", "stopped", "rejected"].includes(step.state)
          ? "failed"
          : "completed",
      );
    }

    for (const review of detail?.reviews ?? []) {
      pushRow(
        review.decidedAt,
        "Review decision",
        `${review.status} · ${normalizeText(review.decidedBy)}`,
        review.status === "approved" ? "completed" : "failed",
      );
    }

    for (const approval of detail?.approvals ?? []) {
      pushRow(
        approval.decidedAt,
        "Approval decision",
        `${approval.status} · ${normalizeText(approval.decidedBy)}`,
        approval.status === "approved" ? "completed" : "failed",
      );
    }

    pushRow(execution.endedAt, "Execution ended", execution.state, "completed");
  }

  rows.sort(
    (left, right) => left.ts - right.ts || left.sortBias - right.sortBias,
  );
  if (rows.length === 0) {
    if (!selectedWaveSummary) {
      els.executionTimeline.className = "execution-timeline empty-state";
      els.executionTimeline.textContent =
        "No timeline events recorded for this execution.";
      return;
    }

    els.executionTimeline.className = "execution-timeline";
    els.executionTimeline.innerHTML = `
      <div class="timeline-summary">
        <code>0 timeline events</code>
        <code>state=${escapeHtml(normalizeText(execution.state))}</code>
        <code>waves=${escapeHtml(String(getWaveEntries(selectedWaveSummary).length))}</code>
      </div>
      ${renderWaveSummaryPanel({
        title: "Wave Progression",
        stepSummary: selectedWaveSummary,
        compact: true,
        emptyText: "No wave progression returned for this execution.",
      })}
      <div class="detail-card empty-state compact-empty">No timeline events recorded for this execution.</div>
    `;
    return;
  }

  const duration = formatDuration(
    execution.startedAt,
    execution.endedAt ?? execution.updatedAt,
  );
  els.executionTimeline.className = "execution-timeline";
  els.executionTimeline.innerHTML = `
    <div class="timeline-summary">
      <code>${escapeHtml(rows.length)} timeline events</code>
      <code>duration=${escapeHtml(duration)}</code>
      <code>state=${escapeHtml(normalizeText(execution.state))}</code>
      ${
        selectedWaveSummary
          ? `<code>waves=${escapeHtml(String(getWaveEntries(selectedWaveSummary).length))}</code>`
          : ""
      }
    </div>
    ${
      selectedWaveSummary
        ? renderWaveSummaryPanel({
            title: "Wave Progression",
            stepSummary: selectedWaveSummary,
            compact: true,
            emptyText: "No wave progression returned for this execution.",
          })
        : ""
    }
    <ol class="timeline-list">
      ${rows
        .map(
          (row) => `
            <li class="timeline-item ${escapeHtml(row.tone)}">
              <div class="timeline-dot" aria-hidden="true"></div>
              <div class="timeline-content">
                <div class="timeline-title">
                  <strong>${escapeHtml(row.title)}</strong>
                  <code>${escapeHtml(row.timestamp)}</code>
                </div>
                ${row.meta ? `<p class="timeline-meta">${escapeHtml(row.meta)}</p>` : ""}
              </div>
            </li>
          `,
        )
        .join("")}
    </ol>
  `;
}

function renderDecisionLog(detail: AnyRecord | null) {
  const reviews = detail?.reviews ?? [];
  const approvals = detail?.approvals ?? [];
  const escalations = detail?.escalations ?? [];
  const audit = detail?.audit ?? [];

  if (
    reviews.length === 0 &&
    approvals.length === 0 &&
    escalations.length === 0 &&
    audit.length === 0
  ) {
    els.decisionLog.innerHTML = `<div class="detail-card empty-state">No review, approval, escalation, or audit records.</div>`;
    return;
  }

  const renderItems = (items) =>
    items
      .map(
        (item) => `
          <article class="event-item decision-item">
            <div class="event-title">
              <strong>${escapeHtml(item.status)}</strong>
              <code>${formatTimestamp(item.decidedAt ?? item.createdAt)}</code>
            </div>
            <div class="event-meta">
              ${item.decidedBy ? `<code>by=${escapeHtml(normalizeText(item.decidedBy))}</code>` : ""}
              ${item.stepId ? `<code>step=${escapeHtml(normalizeText(item.stepId))}</code>` : ""}
              ${item.targetRole ? `<code>target=${escapeHtml(normalizeText(item.targetRole))}</code>` : ""}
              ${item.reason ? `<code>reason=${escapeHtml(normalizeText(item.reason))}</code>` : ""}
              ${item.comments ? `<p class="decision-comments">${escapeHtml(item.comments)}</p>` : ""}
              ${
                item.status === "open" && item.id
                  ? `<div class="control-row decision-actions">
                      <button type="button" class="secondary-button escalation-action" data-escalation-id="${escapeHtml(item.id)}" data-resume="false">Resolve</button>
                      <button type="button" class="primary-button escalation-action" data-escalation-id="${escapeHtml(item.id)}" data-resume="true">Resolve + Resume</button>
                    </div>`
                  : ""
              }
            </div>
          </article>
        `,
      )
      .join("");

  const renderAuditItems = (items) =>
    items
      .map(
        (item) => `
          <article class="event-item decision-item">
            <div class="event-title">
              <strong>${escapeHtml(normalizeText(item.action))}</strong>
              <code>${formatTimestamp(item.createdAt)}</code>
            </div>
            <div class="event-meta">
              ${item.actor ? `<code>actor=${escapeHtml(normalizeText(item.actor))}</code>` : ""}
              ${item.source ? `<code>source=${escapeHtml(normalizeText(item.source))}</code>` : ""}
              ${item.targetType ? `<code>target=${escapeHtml(normalizeText(item.targetType))}</code>` : ""}
              ${item.targetId ? `<code>id=${escapeHtml(normalizeText(item.targetId))}</code>` : ""}
              ${item.result ? `<code>result=${escapeHtml(normalizeText(item.result?.status ?? item.result))}</code>` : ""}
              ${
                item.payload && Object.keys(item.payload).length > 0
                  ? `<pre class="code-block compact-code">${escapeHtml(JSON.stringify(item.payload, null, 2))}</pre>`
                  : ""
              }
            </div>
          </article>
        `,
      )
      .join("");

  els.decisionLog.innerHTML = `
    <div class="decision-grid">
      <article class="decision-card">
        <h3>Reviews</h3>
        <div class="event-list">${reviews.length ? renderItems(reviews) : `<div class="detail-card empty-state">No reviews yet.</div>`}</div>
      </article>
      <article class="decision-card">
        <h3>Approvals</h3>
        <div class="event-list">${approvals.length ? renderItems(approvals) : `<div class="detail-card empty-state">No approvals yet.</div>`}</div>
      </article>
      <article class="decision-card">
        <h3>Escalations</h3>
        <div class="event-list">${escalations.length ? renderItems(escalations) : `<div class="detail-card empty-state">No escalations yet.</div>`}</div>
      </article>
      <article class="decision-card">
        <h3>Audit</h3>
        <div class="event-list">${audit.length ? renderAuditItems(audit) : `<div class="detail-card empty-state">No audit records yet.</div>`}</div>
      </article>
    </div>
  `;

  for (const button of els.decisionLog.querySelectorAll(".escalation-action")) {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await sendEscalationAction(button.dataset.escalationId, {
          by: "operator",
          comments:
            button.dataset.resume === "true"
              ? "Operator resolved escalation and resumed execution."
              : "Operator resolved escalation.",
          resume: button.dataset.resume === "true",
        });
      } catch (error) {
        alert(error.message);
      } finally {
        button.disabled = false;
      }
    });
  }
}

function renderWorkflowPreview() {
  const invocation = state.workflowPreview;
  const launches = invocation?.launches ?? [];
  const previewState = state.workflowPreviewDirty ? "stale" : "ready";

  if (state.workflowPreviewError) {
    els.workflowPreviewState.textContent = `plan preview: error`;
    els.workflowPreview.className = "detail-card empty-state";
    els.workflowPreview.textContent = `Failed to load workflow preview: ${state.workflowPreviewError}`;
    return;
  }

  if (!invocation) {
    els.workflowPreviewState.textContent = `plan preview: idle`;
    els.workflowPreview.className = "detail-card empty-state";
    els.workflowPreview.textContent =
      "Preview a workflow plan to inspect merged policy, readable launch deltas, and compare it against persisted execution policy before or after invocation.";
    return;
  }

  els.workflowPreviewState.textContent = `plan preview: ${previewState}${state.workflowPreviewSource ? ` (${state.workflowPreviewSource})` : ""}`;
  els.workflowPreview.className = "detail-card workflow-preview-card";
  els.workflowPreview.innerHTML = `
    <div class="session-title">
      <strong>${escapeHtml(normalizeText(invocation.invocationId, "preview"))}</strong>
      <span class="pill ${state.workflowPreviewDirty ? "waiting_review" : "active"}">${escapeHtml(previewState)}</span>
    </div>
    <div class="detail-grid">
      <div><span class="muted">Workflow</span><br /><code>${escapeHtml(normalizeText(invocation?.workflow?.id))}</code></div>
      <div><span class="muted">Domain</span><br /><code>${escapeHtml(normalizeText(invocation?.domain?.id))}</code></div>
      <div><span class="muted">Project</span><br /><code>${escapeHtml(normalizeText(invocation?.project?.id))}</code></div>
      <div><span class="muted">Launches</span><br /><code>${escapeHtml(String(launches.length))}</code></div>
      <div><span class="muted">Coordination Group</span><br /><code>${escapeHtml(normalizeText(invocation?.coordination?.groupId))}</code></div>
      <div><span class="muted">Parent Execution</span><br /><code>${escapeHtml(normalizeText(invocation?.coordination?.parentExecutionId))}</code></div>
      <div><span class="muted">Branch Key</span><br /><code>${escapeHtml(normalizeText(invocation?.coordination?.branchKey))}</code></div>
      <div><span class="muted">Source</span><br /><code>${escapeHtml(normalizeText(state.workflowPreviewSource))}</code></div>
      <div class="detail-span"><span class="muted">Objective</span><br /><code>${escapeHtml(normalizeText(invocation?.objective))}</code></div>
    </div>
    ${renderPolicyPanel({
      title: "Effective Policy",
      policy: invocation?.effectivePolicy,
      labelCarriers: [
        invocation,
        invocation?.effectivePolicy,
        invocation?.domain,
        invocation?.project,
      ],
      emptyText: "No merged execution policy returned.",
    })}
    ${renderPolicyDiffPanel({
      title: "Persisted Execution Policy Diff",
      baselineTitle: state.executionDetail?.execution?.id
        ? `${state.executionDetail.execution.id} Persisted Policy`
        : "Select an execution to compare",
      candidateTitle: `${normalizeText(invocation?.invocationId, "Preview")} Effective Policy`,
      baselinePolicy: state.executionDetail?.execution?.policy ?? null,
      candidatePolicy: invocation?.effectivePolicy,
      baselineCarriers: [
        state.executionDetail?.execution,
        state.executionDetail?.execution?.policy,
      ],
      candidateCarriers: [
        invocation,
        invocation?.effectivePolicy,
        invocation?.domain,
        invocation?.project,
      ],
      mode: "full",
      emptyText:
        "Select an execution to compare the current preview against the persisted execution policy.",
    })}
    <section class="workflow-launch-section">
      <div class="policy-panel-header">
        <strong>Launch Policies</strong>
        <span class="muted">${escapeHtml(String(launches.length))} launch${launches.length === 1 ? "" : "es"}</span>
      </div>
      ${
        launches.length > 0
          ? `<div class="workflow-launch-list">${launches
              .map((launch, index) =>
                renderWorkflowLaunchPreview(launch, index),
              )
              .join("")}</div>`
          : `<div class="policy-empty">No launch preview returned.</div>`
      }
    </section>
  `;
}

function renderExecutionWorkspacePanel(workspaceDetail = null) {
  const workspaces = workspaceDetail?.workspaces ?? [];
  if (workspaces.length === 0) {
    return `
      <section class="workflow-launch-section">
        <div class="policy-panel-header">
          <strong>Execution Workspaces</strong>
          <span class="muted">0 workspaces</span>
        </div>
        <div class="detail-card empty-state compact-empty">No workspace allocations are linked to this execution.</div>
      </section>
    `;
  }

  return `
    <section class="workflow-launch-section">
      <div class="policy-panel-header">
        <strong>Execution Workspaces</strong>
        <span class="muted">${escapeHtml(String(workspaces.length))} workspace${workspaces.length === 1 ? "" : "s"}</span>
      </div>
      <div class="session-meta">
        <code>${escapeHtml(formatStateCountsMap(workspaceDetail.byStatus ?? {}))}</code>
        <a class="inline-link" href="/api/orchestrator/executions/${escapeHtml(encodeURIComponent(workspaceDetail.executionId ?? ""))}/workspaces" target="_blank" rel="noreferrer">workspaces json</a>
      </div>
      <div class="workflow-launch-list">${workspaces
        .slice(0, 12)
        .map(
          (workspace) => `
        <article class="workflow-launch-card">
          <div class="session-title">
            <strong>${escapeHtml(workspace.branchName || workspace.id)}</strong>
            ${renderStatePill(workspace.status)}
          </div>
          <div class="session-meta">
            <code>${escapeHtml(workspace.id)}</code>
            ${workspace.stepId ? `<code>step=${escapeHtml(workspace.stepId)}</code>` : ""}
            ${workspace.workItemRunId ? `<code>run=${escapeHtml(workspace.workItemRunId)}</code>` : ""}
          </div>
          <p class="detail-support"><code>${escapeHtml(workspace.worktreePath || "-")}</code></p>
        </article>
      `,
        )
        .join("")}</div>
    </section>
  `;
}

function renderExecutionDetail() {
  const detail = state.executionDetail;
  const execution = detail?.execution;
  const hasSelection = Boolean(execution);
  const treeContext = deriveExecutionTreeContext(detail);
  const groupId = execution?.coordinationGroupId ?? null;
  const isInterrupted =
    execution?.state === "paused" || execution?.state === "held";
  const childExecutionCount =
    treeContext?.childRows?.length ??
    detail?.childExecutions?.length ??
    execution?.childExecutionIds?.length ??
    0;
  const groupSummary = detail?.coordinationGroupSummary ?? null;
  const groupMembers =
    detail?.coordinationGroup ?? groupSummary?.executions ?? [];
  const groupStateSummary =
    formatStateCountsMap(treeContext?.byState) ||
    (groupSummary
      ? Object.entries(groupSummary.byState ?? {})
          .map(([key, value]) => `${key}:${value}`)
          .join(" · ")
      : "");
  const groupMemberCount =
    treeContext?.executionCount ??
    groupSummary?.executionCount ??
    groupMembers.length;
  const effectivePolicy = execution?.policy ?? null;
  const policyDiff = detail?.policyDiff ?? null;
  const treeExecutionCount =
    treeContext?.executionCount ??
    Math.max(groupMemberCount, hasSelection ? 1 : 0);
  const treeInterruptedCount = treeContext
    ? treeContext.rows.filter((row) =>
        ["paused", "held"].includes(normalizeText(row.execution?.state)),
      ).length
    : ["paused", "held"].includes(execution?.state)
      ? 1
      : 0;
  const treeRunnableCount = treeContext
    ? treeContext.rows.filter((row) => {
        const value = normalizeText(row.execution?.state);
        return (
          !isTerminalExecutionState(value) &&
          !["paused", "held"].includes(value)
        );
      }).length
    : execution &&
        !isTerminalExecutionState(execution.state) &&
        !["paused", "held"].includes(execution.state)
      ? 1
      : 0;
  const treeActiveCount = treeContext
    ? treeContext.activeCount
    : execution && !isTerminalExecutionState(execution.state)
      ? 1
      : 0;
  const rootExecutionId =
    treeContext?.rootRow?.execution?.id ?? execution?.id ?? null;
  const fallbackByState = {};
  for (const step of detail?.steps ?? []) {
    fallbackByState[step.state] = (fallbackByState[step.state] ?? 0) + 1;
  }
  const governanceContext =
    treeContext ??
    (execution
      ? {
          rows: [
            {
              execution,
              stepSummary: {
                byState: fallbackByState,
              },
            },
          ],
        }
      : null);
  const familyReviewPending = countTreeGovernanceTargets(
    governanceContext,
    "review",
  );
  const familyApprovalPending = countTreeGovernanceTargets(
    governanceContext,
    "approval",
  );

  els.driveButton.disabled = !hasSelection;
  els.driveGroupButton.disabled = !hasSelection || !groupId;
  els.driveTreeButton.disabled = !hasSelection;
  els.pauseButton.disabled = !hasSelection || isInterrupted;
  els.holdButton.disabled = !hasSelection || execution?.state === "held";
  els.resumeButton.disabled =
    !hasSelection || !["paused", "held"].includes(execution?.state);
  els.pauseTreeButton.disabled = !hasSelection || treeRunnableCount === 0;
  els.holdTreeButton.disabled = !hasSelection || treeRunnableCount === 0;
  els.resumeTreeButton.disabled = !hasSelection || treeInterruptedCount === 0;
  els.reviewButton.disabled = !hasSelection;
  els.approvalButton.disabled = !hasSelection;
  els.familyReviewButton.disabled =
    !hasSelection || familyReviewPending.executionCount === 0;
  els.familyApprovalButton.disabled =
    !hasSelection || familyApprovalPending.executionCount === 0;

  if (!execution) {
    els.executionDetailSubtitle.textContent = "Select an execution";
    els.executionStreamState.textContent = "execution stream: idle";
    els.executionDetail.className = "detail-card empty-state";
    els.executionDetail.textContent = state.executionDetailError
      ? `Failed to load execution detail: ${state.executionDetailError}`
      : "Select an execution to inspect durable orchestration state, policy drift versus preview, step/session lineage, and governance controls.";
    els.executionTree.className = "execution-tree empty-state";
    els.executionTree.textContent =
      "Select an execution to load the orchestrator tree and step records.";
    els.executionTimeline.className = "execution-timeline empty-state";
    els.executionTimeline.textContent =
      "Select an execution to load timeline and history.";
    els.decisionLog.innerHTML = `<div class="detail-card empty-state">Select an execution to load review and approval history.</div>`;
    els.executionGuidance.className = "operator-guidance empty-state";
    els.executionGuidance.textContent =
      "Select an execution to inspect hold ownership and timeout guidance.";
    els.executionTreeActionSummary.textContent =
      "Select an execution to target its rooted execution family over the orchestrator tree routes.";
    els.familyReviewSummary.textContent =
      "Select an execution to review pending governance across its rooted execution tree.";
    els.familyApprovalSummary.textContent =
      "Select an execution to approve pending governance across its rooted execution tree.";
    updateBranchSpawnControls();
    return;
  }

  els.executionTreeActionSummary.textContent = `${treeExecutionCount} execution${
    treeExecutionCount === 1 ? "" : "s"
  } rooted at ${normalizeText(rootExecutionId)} · active ${treeActiveCount} · paused/held ${treeInterruptedCount} · review pending ${
    familyReviewPending.executionCount
  } · approval pending ${familyApprovalPending.executionCount}. Tree actions resolve through /tree/* from the selected execution.`;
  els.familyReviewSummary.textContent =
    familyReviewPending.executionCount > 0
      ? `${familyReviewPending.executionCount} execution${
          familyReviewPending.executionCount === 1 ? "" : "s"
        } are pending review across ${normalizeText(rootExecutionId)} with ${familyReviewPending.stepCount} review-pending step${
          familyReviewPending.stepCount === 1 ? "" : "s"
        }.`
      : `No pending review targets under ${normalizeText(rootExecutionId)}.`;
  els.familyApprovalSummary.textContent =
    familyApprovalPending.executionCount > 0
      ? `${familyApprovalPending.executionCount} execution${
          familyApprovalPending.executionCount === 1 ? "" : "s"
        } are pending approval across ${normalizeText(rootExecutionId)} with ${familyApprovalPending.stepCount} approval-pending step${
          familyApprovalPending.stepCount === 1 ? "" : "s"
        }.`
      : `No pending approval targets under ${normalizeText(rootExecutionId)}.`;

  els.executionDetailSubtitle.textContent = `${execution.id} · ${execution.state}`;
  els.executionDetail.className = "detail-card";
  els.executionDetail.innerHTML = `
    <div class="session-title">
      <strong>${escapeHtml(execution.id)}</strong>
      ${renderStatePill(execution.state)}
    </div>
    <div class="lineage-meta detail-pills">
      ${renderExecutionModePills(execution)}
      ${renderExecutionProjectMetadataPills(execution)}
      ${groupId ? renderMetaPill("group", groupId) : ""}
      ${execution.parentExecutionId ? renderMetaPill("parent", execution.parentExecutionId, "child") : ""}
      ${childExecutionCount ? renderMetaPill("children", childExecutionCount, "child") : ""}
      ${
        execution.heldFromState
          ? renderMetaPill(
              "held-from",
              execution.heldFromState,
              execution.state === "held" ? "held" : "",
            )
          : ""
      }
    </div>
    <div class="detail-grid">
      <div><span class="muted">Workflow</span><br /><code>${escapeHtml(normalizeText(execution.workflowId))}</code></div>
      <div><span class="muted">Project</span><br /><code>${escapeHtml(normalizeText(execution.projectId))}</code></div>
      <div><span class="muted">Domain</span><br /><code>${escapeHtml(normalizeText(execution.domainId))}</code></div>
      <div><span class="muted">Current Step</span><br /><code>${Number(execution.currentStepIndex ?? 0) + 1}</code></div>
      <div><span class="muted">Review</span><br /><code>${escapeHtml(normalizeText(execution.reviewStatus))}</code></div>
      <div><span class="muted">Approval</span><br /><code>${escapeHtml(normalizeText(execution.approvalStatus))}</code></div>
      <div><span class="muted">Created</span><br /><code>${formatTimestamp(execution.createdAt)}</code></div>
      <div><span class="muted">Started</span><br /><code>${formatTimestamp(execution.startedAt)}</code></div>
      <div><span class="muted">Ended</span><br /><code>${formatTimestamp(execution.endedAt)}</code></div>
      <div><span class="muted">Updated</span><br /><code>${formatTimestamp(execution.updatedAt)}</code></div>
      <div><span class="muted">Duration</span><br /><code>${escapeHtml(formatDuration(execution.startedAt, execution.endedAt ?? execution.updatedAt))}</code></div>
      <div><span class="muted">Workflow Events</span><br /><code>${escapeHtml(String(detail?.events?.length ?? 0))}</code></div>
      <div><span class="muted">Escalations</span><br /><code>${escapeHtml(String(detail?.escalations?.length ?? 0))}</code></div>
      <div><span class="muted">Coordination Group</span><br /><code>${escapeHtml(normalizeText(groupId))}</code></div>
      <div><span class="muted">Parent Execution</span><br /><code>${escapeHtml(normalizeText(execution.parentExecutionId))}</code></div>
      <div><span class="muted">Child Executions</span><br /><code>${escapeHtml(String(childExecutionCount))}</code></div>
      <div><span class="muted">Branch Key</span><br /><code>${escapeHtml(normalizeText(execution.branchKey))}</code></div>
      <div><span class="muted">Paused At</span><br /><code>${formatTimestamp(execution.pausedAt)}</code></div>
      <div><span class="muted">Held At</span><br /><code>${formatTimestamp(execution.heldAt)}</code></div>
      <div><span class="muted">Resumed At</span><br /><code>${formatTimestamp(execution.resumedAt)}</code></div>
      <div><span class="muted">Hold Reason</span><br /><code>${escapeHtml(normalizeText(execution.holdReason))}</code></div>
      ${
        groupStateSummary
          ? `<div><span class="muted">Group States</span><br /><code>${escapeHtml(groupStateSummary)}</code></div>`
          : ""
      }
      ${
        groupMemberCount
          ? `<div><span class="muted">Group Members</span><br /><code>${escapeHtml(String(groupMemberCount))}</code></div>`
          : ""
      }
      <div class="detail-span"><span class="muted">Objective</span><br /><code>${escapeHtml(normalizeText(execution.objective))}</code></div>
    </div>
    ${renderExecutionWorkspacePanel(detail?.workspaces ?? null)}
    ${renderPolicyPanel({
      title: "Effective Policy",
      policy: effectivePolicy,
      labelCarriers: [execution, effectivePolicy],
      emptyText: "No execution policy was persisted for this run.",
    })}
    ${renderPolicyDiffPanel({
      title: "Diff vs Current Config Plan",
      baselineTitle: normalizeText(
        state.workflowPreview?.invocationId ?? policyDiff?.executionId,
        "Current Config Plan",
      ),
      candidateTitle: `${execution.id} Persisted Policy`,
      baselinePolicy:
        state.workflowPreview?.effectivePolicy ??
        policyDiff?.plannedEffectivePolicy ??
        null,
      candidatePolicy: effectivePolicy,
      baselineCarriers: [
        state.workflowPreview,
        state.workflowPreview?.effectivePolicy,
        policyDiff,
        policyDiff?.plannedEffectivePolicy,
      ],
      candidateCarriers: [execution, effectivePolicy],
      mode: "full",
      emptyText: "No current-config plan policy available for this execution.",
    })}
    ${
      policyDiff?.steps?.length
        ? `<section class="workflow-launch-section">
            <div class="policy-panel-header">
              <strong>Step Override Summary</strong>
              <span class="muted">${escapeHtml(String(policyDiff.steps.length))} step${policyDiff.steps.length === 1 ? "" : "s"}</span>
            </div>
            <div class="workflow-launch-list">${policyDiff.steps
              .map(
                (step) => `
                <article class="workflow-launch-card">
                  <div class="session-title">
                    <strong>${escapeHtml(step.role)}</strong>
                    <span class="pill active">wave ${escapeHtml(String(step.wave ?? step.sequence ?? 0))}</span>
                  </div>
                  <div class="session-meta">
                    <code>step=${escapeHtml(normalizeText(step.stepId))}</code>
                    <code>execution-diff=${escapeHtml(String(step.diffVsExecution?.length ?? 0))}</code>
                    <code>plan-diff=${escapeHtml(String(step.diffVsPlan?.length ?? 0))}</code>
                  </div>
                </article>
              `,
              )
              .join("")}</div>
          </section>`
        : ""
    }
  `;

  els.executionGuidance.outerHTML = renderGuidancePanel({
    id: "execution-guidance",
    title: "Hold / Timeout Guidance",
    record: execution,
    policy: effectivePolicy,
    emptyText:
      "No hold ownership or timeout guidance returned for this execution.",
  });
  els.executionGuidance = document.getElementById("execution-guidance");

  renderExecutionTree(detail);
  renderExecutionTimeline(detail);
  renderDecisionLog(detail);
  updateBranchSpawnControls();
}

function renderSessions() {
  if (state.sessions.length === 0) {
    els.sessionList.innerHTML = `<div class="detail-card empty-state">No sessions yet.</div>`;
    return;
  }

  els.sessionList.innerHTML = state.sessions
    .map((session) => {
      const activeClass =
        session.id === state.selectedSessionId ? "active" : "";
      return `
        <article class="session-item ${activeClass}" data-session-id="${escapeHtml(session.id)}">
          <div class="session-title">
            <strong>${escapeHtml(session.id)}</strong>
            <span class="pill ${stateClass(session.state)}">${escapeHtml(session.state)}</span>
          </div>
          <div class="session-meta">
            <span class="muted">role=${escapeHtml(normalizeText(session.role))} · profile=${escapeHtml(normalizeText(session.profileId))}</span>
            <code>run=${escapeHtml(normalizeText(session.runId))}</code>
            <code>tmux=${escapeHtml(normalizeText(session.tmuxSession))}</code>
          </div>
        </article>
      `;
    })
    .join("");

  for (const item of els.sessionList.querySelectorAll("[data-session-id]")) {
    item.addEventListener("click", () => {
      state.selectedSessionId = item.dataset.sessionId;
      connectEventStream();
      refresh().catch((error) => console.error(error));
    });
  }
}

function extractLiveEnvelope(payload: AnyRecord = {}) {
  const detail = isObject(payload?.detail) ? payload.detail : null;
  return detail ?? payload;
}

function readLiveValue(
  payload: AnyRecord,
  paths: string[] = [],
  fallback: unknown = null,
) {
  const envelope = extractLiveEnvelope(payload);
  const value = readNestedValue(envelope, paths);
  return hasDisplayValue(value) ? value : fallback;
}

function normalizeLiveControlHistory(payload) {
  const envelope = extractLiveEnvelope(payload);
  const options = [
    envelope?.controlHistory,
    envelope?.controls,
    envelope?.control?.history,
    envelope?.diagnostics?.controlHistory,
  ];
  for (const value of options) {
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
}

function normalizeLiveEvents(payload) {
  const envelope = extractLiveEnvelope(payload);
  const options = [
    envelope?.events,
    envelope?.recentEvents,
    envelope?.diagnostics?.recentEvents,
    payload?.events,
  ];
  for (const value of options) {
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
}

function renderSessionLivePanel(payload) {
  if (!payload) {
    return `<article class="detail-card compact-empty">Session live route is unavailable for this session.</article>`;
  }

  const _diagnostics = readLiveValue(payload, ["diagnostics"], {});
  const launcherMetadata = readLiveValue(payload, ["launcherMetadata"], {});
  const urgency = readLiveValue(payload, [
    "diagnostics.operatorUrgency",
    "diagnostics.urgency",
    "operatorUrgency",
  ]);
  const staleSession = readLiveValue(
    payload,
    ["diagnostics.staleSession", "staleSession"],
    false,
  );
  const settleLagMs = readLiveValue(payload, [
    "diagnostics.settleLagMs",
    "diagnostics.ageMs",
    "settleLagMs",
  ]);
  const liveStatus = readLiveValue(
    payload,
    ["diagnostics.status", "status"],
    "unknown",
  );
  const ackStatus = readLiveValue(payload, [
    "controlAck.ackStatus",
    "controlAck.status",
    "diagnostics.controlAckStatus",
    "lastControlAck.status",
  ]);
  const controlResult = readLiveValue(payload, [
    "controlAck.result",
    "lastControlResult",
    "diagnostics.lastControlResult",
    "controlResult",
  ]);
  const controlAck = readLiveValue(
    payload,
    ["controlAck", "lastControlAck"],
    null,
  );
  const staleReason = readLiveValue(payload, [
    "diagnostics.staleReason",
    "diagnostics.staleHint",
    "staleReason",
  ]);
  const suggestions = readLiveValue(
    payload,
    ["diagnostics.suggestions", "suggestions"],
    [],
  );
  const controlHistory = normalizeLiveControlHistory(payload);
  const latestControl = controlHistory[controlHistory.length - 1] ?? null;

  return `
    <article class="detail-card session-live-v2">
      <div class="event-title">
        <strong>Session Live v2</strong>
        ${renderStatePill(liveStatus)}
      </div>
      <div class="detail-grid">
        <div><span class="muted">Operator Urgency</span><br /><code>${escapeHtml(normalizeText(urgency, "-"))}</code></div>
        <div><span class="muted">Stale Session</span><br /><code>${escapeHtml(staleSession ? "yes" : "no")}</code></div>
        <div><span class="muted">Settle Lag (ms)</span><br /><code>${escapeHtml(normalizeText(settleLagMs, "-"))}</code></div>
        <div><span class="muted">Stale Reason</span><br /><code>${escapeHtml(normalizeText(staleReason, "-"))}</code></div>
        <div><span class="muted">RPC Control</span><br /><code>${escapeHtml(readLiveValue(payload, ["diagnostics.supportsRpcControl", "supportsRpcControl"], false) ? "supported" : "fallback")}</code></div>
        <div><span class="muted">Ack Status</span><br /><code>${escapeHtml(normalizeText(ackStatus, "-"))}</code></div>
        <div><span class="muted">Control Result</span><br /><code>${escapeHtml(normalizeText(typeof controlResult === "string" ? controlResult : formatPolicyValue(controlResult), "-"))}</code></div>
        <div><span class="muted">Last Event</span><br /><code>${escapeHtml(normalizeText(readLiveValue(payload, ["diagnostics.lastEventType", "lastEvent.type"]), "-"))}</code></div>
        <div><span class="muted">Last Event At</span><br /><code>${escapeHtml(normalizeText(readLiveValue(payload, ["diagnostics.lastEventAt", "lastEvent.timestamp"]), "-"))}</code></div>
        <div><span class="muted">Last Control Action</span><br /><code>${escapeHtml(normalizeText(readFirstField(latestControl, ["action", "type", "command"]), "-"))}</code></div>
        <div><span class="muted">Last Control At</span><br /><code>${escapeHtml(normalizeText(readFirstField(latestControl, ["timestamp", "at", "createdAt"]), "-"))}</code></div>
      </div>
      <div class="lineage-meta">
        ${renderMetaPill("control-history", controlHistory.length)}
        ${renderMetaPill("suggestions", Array.isArray(suggestions) ? suggestions.length : 0)}
        ${
          hasDisplayValue(launcherMetadata?.mode)
            ? renderMetaPill("launcher-mode", launcherMetadata.mode)
            : ""
        }
        ${
          hasDisplayValue(launcherMetadata?.runtime)
            ? renderMetaPill("runtime", launcherMetadata.runtime)
            : ""
        }
      </div>
      ${
        isObject(launcherMetadata) && Object.keys(launcherMetadata).length > 0
          ? `<details class="policy-details">
              <summary>Launcher Metadata</summary>
              <pre class="code-block compact-code">${escapeHtml(JSON.stringify(launcherMetadata, null, 2))}</pre>
            </details>`
          : ""
      }
      ${
        isObject(controlAck)
          ? `<details class="policy-details">
              <summary>Control Ack</summary>
              <pre class="code-block compact-code">${escapeHtml(JSON.stringify(controlAck, null, 2))}</pre>
            </details>`
          : ""
      }
      ${
        Array.isArray(suggestions) && suggestions.length > 0
          ? `<div class="event-list">
              ${suggestions
                .slice(0, 4)
                .map((item) => {
                  const expectedOutcome = normalizeText(
                    readFirstField(item, [
                      "expectedOutcome",
                      "expected",
                      "outcome",
                    ]),
                    "",
                  );
                  const httpHint = normalizeText(
                    readFirstField(item, [
                      "httpHint",
                      "http",
                      "endpoint",
                      "route",
                    ]),
                    "",
                  );
                  return `
                    <article class="detail-card compact-empty">
                      <div class="event-title">
                        <strong>${escapeHtml(normalizeText(item?.action, "action"))}</strong>
                        ${item?.commandHint ? `<code>${escapeHtml(normalizeText(item.commandHint))}</code>` : ""}
                      </div>
                      <p class="decision-summary">${escapeHtml(normalizeText(item?.reason, "No reason provided."))}</p>
                      ${
                        expectedOutcome || httpHint
                          ? `<div class="event-meta session-live-suggestion-meta">
                              ${
                                expectedOutcome
                                  ? `<code>expected=${escapeHtml(expectedOutcome)}</code>`
                                  : ""
                              }
                              ${
                                httpHint
                                  ? `<code>http=${escapeHtml(httpHint)}</code>`
                                  : ""
                              }
                            </div>`
                          : ""
                      }
                    </article>
                  `;
                })
                .join("")}
            </div>`
          : ""
      }
    </article>
  `;
}

function renderDetail() {
  const detail = state.detail;
  const session = detail?.session;
  const liveEvents = normalizeLiveEvents(state.sessionLive);
  const events = liveEvents.length > 0 ? liveEvents : (detail?.events ?? []);

  const hasSelection = Boolean(session);
  els.stopButton.disabled = !hasSelection;
  els.completeButton.disabled = !hasSelection;
  els.steerButton.disabled = !hasSelection;

  if (!session) {
    els.detailSubtitle.textContent = "Select a session";
    els.sessionDetail.className = "detail-card empty-state";
    els.sessionDetail.textContent =
      "Select a session to inspect runtime metadata, recent events, and operator controls.";
    els.eventList.innerHTML = "";
    els.transcriptView.textContent =
      "Select a session to load transcript artifacts.";
    els.piEventsView.textContent =
      "Select a session to load PI event artifacts.";
    els.artifactList.innerHTML = "";
    return;
  }

  els.detailSubtitle.textContent = `${session.id} · ${session.state}`;
  els.sessionDetail.className = "detail-card session-detail-stack";
  const liveMarkup =
    state.sessionLiveState === "ready"
      ? renderSessionLivePanel(state.sessionLive)
      : state.sessionLiveState === "unavailable"
        ? `<article class="detail-card compact-empty">Session live route is unavailable for this gateway.</article>`
        : state.sessionLiveState === "error"
          ? `<article class="detail-card compact-empty">Session live route error: ${escapeHtml(normalizeText(state.sessionLiveError, "unknown error"))}</article>`
          : `<article class="detail-card compact-empty">Loading session live diagnostics...</article>`;
  els.sessionDetail.innerHTML = `
    <article class="detail-card">
      <div class="session-title">
        <strong>${escapeHtml(session.id)}</strong>
        <span class="pill ${stateClass(session.state)}">${escapeHtml(session.state)}</span>
      </div>
      <div class="detail-grid">
        <div><span class="muted">Run</span><br /><code>${escapeHtml(normalizeText(session.runId))}</code></div>
        <div><span class="muted">Role</span><br /><code>${escapeHtml(normalizeText(session.role))}</code></div>
        <div><span class="muted">Profile</span><br /><code>${escapeHtml(normalizeText(session.profileId))}</code></div>
        <div><span class="muted">Project</span><br /><code>${escapeHtml(normalizeText(session.projectId))}</code></div>
        <div><span class="muted">Launcher</span><br /><code>${escapeHtml(normalizeText(session.launcherType))}</code></div>
        <div><span class="muted">tmux</span><br /><code>${escapeHtml(normalizeText(session.tmuxSession))}</code></div>
        <div><span class="muted">Started</span><br /><code>${escapeHtml(normalizeText(session.startedAt))}</code></div>
        <div><span class="muted">Ended</span><br /><code>${escapeHtml(normalizeText(session.endedAt))}</code></div>
      </div>
    </article>
    ${liveMarkup}
    <article class="detail-card compact-empty">
      <div class="event-title">
        <strong>Event Source</strong>
        ${renderMetaPill(liveEvents.length > 0 ? "session-live" : "session-detail", events.length)}
      </div>
    </article>
  `;

  els.eventList.innerHTML = events.length
    ? events
        .slice()
        .reverse()
        .map(
          (event) => `
            <article class="event-item">
              <div class="event-title">
                <strong>${escapeHtml(normalizeText(event.type))}</strong>
                <code>${escapeHtml(normalizeText(event.timestamp))}</code>
              </div>
              <div class="event-meta">
                <code>run=${escapeHtml(normalizeText(event.runId))}</code>
                ${event.source ? `<code>source=${escapeHtml(normalizeText(event.source))}</code>` : ""}
                ${formatObject(event.payload)}
              </div>
            </article>
          `,
        )
        .join("")
    : `<div class="detail-card empty-state">No events for this session.</div>`;

  renderArtifacts();
}

function renderArtifacts() {
  const artifacts = state.artifacts as AnyRecord | null;
  if (!artifacts) {
    els.artifactList.innerHTML = `<div class="detail-card empty-state">No artifact metadata loaded.</div>`;
    return;
  }

  els.artifactList.innerHTML = Object.values(artifacts)
    .map(
      (artifact) => `
        <article class="artifact-item ${artifact.exists ? "" : "missing"}">
          <div class="session-title">
            <strong>${escapeHtml(normalizeText(artifact.name))}</strong>
            <span class="pill ${artifact.exists ? "completed" : "failed"}">${artifact.exists ? "present" : "missing"}</span>
          </div>
          <div class="artifact-meta">
            <code>${escapeHtml(normalizeText(artifact.path))}</code>
            <span class="muted">size=${escapeHtml(normalizeText(artifact.size))} updated=${escapeHtml(normalizeText(artifact.updatedAt))}</span>
          </div>
        </article>
      `,
    )
    .join("");

  els.transcriptView.textContent =
    state.transcript ?? "Transcript artifact missing.";
  els.piEventsView.textContent = state.piEvents ?? "PI event artifact missing.";
}

async function loadArtifacts() {
  if (!state.selectedSessionId) {
    state.artifacts = null;
    state.transcript = null;
    state.piEvents = null;
    return;
  }

  const artifactsPayload = await api(
    `/sessions/${encodeURIComponent(state.selectedSessionId)}/artifacts`,
  );
  state.artifacts = artifactsPayload.artifacts;

  const transcriptArtifact = artifactsPayload.artifacts?.transcript;
  if (transcriptArtifact?.exists) {
    const payload = await api(
      `/sessions/${encodeURIComponent(state.selectedSessionId)}/artifacts/transcript`,
    );
    state.transcript = payload.content;
  } else {
    state.transcript = null;
  }

  const piEventsArtifact = artifactsPayload.artifacts?.piEvents;
  if (piEventsArtifact?.exists) {
    const payload = await api(
      `/sessions/${encodeURIComponent(state.selectedSessionId)}/artifacts/piEvents`,
    );
    state.piEvents = JSON.stringify(payload.content, null, 2);
  } else {
    state.piEvents = null;
  }
}

async function loadSessionLive() {
  if (!state.selectedSessionId) {
    state.sessionLive = null;
    state.sessionLiveState = "idle";
    state.sessionLiveError = null;
    return;
  }
  const result = await optionalApi(
    `/sessions/${encodeURIComponent(state.selectedSessionId)}/live`,
  );
  state.sessionLiveState = result.state;
  state.sessionLiveError = result.error;
  state.sessionLive = result.payload ?? null;
}

async function loadExecutionSummaries() {
  try {
    const payload = await api("/orchestrator/executions");
    state.executions = payload.executions ?? [];
    state.executionListError = null;
  } catch (error) {
    state.executions = [];
    state.executionListError = error.message;
  }

  if (
    state.selectedExecutionId &&
    !state.executions.some((item) => item.id === state.selectedExecutionId)
  ) {
    state.selectedExecutionId = null;
  }

  if (!state.selectedExecutionId && state.executions[0]) {
    state.selectedExecutionId = state.executions[0].id;
    connectExecutionEventStream();
  }
}

async function loadExecutionDetail() {
  if (!state.selectedExecutionId) {
    state.executionDetail = null;
    state.executionDetailError = null;
    return;
  }

  try {
    const executionId = encodeURIComponent(state.selectedExecutionId);
    const [
      detailPayload,
      eventsPayload,
      escalationsPayload,
      treePayload,
      auditPayload,
      policyDiffPayload,
      historyPayload,
      workspacesPayload,
    ] = await Promise.all([
      api(`/orchestrator/executions/${executionId}`),
      api(`/orchestrator/executions/${executionId}/events`),
      api(`/orchestrator/executions/${executionId}/escalations`),
      api(`/orchestrator/executions/${executionId}/tree`).catch(() => null),
      api(`/orchestrator/executions/${executionId}/audit`).catch(() => null),
      api(`/orchestrator/executions/${executionId}/policy-diff`).catch(
        () => null,
      ),
      api(`/orchestrator/executions/${executionId}/history`).catch(() => null),
      api(`/orchestrator/executions/${executionId}/workspaces`).catch(
        () => null,
      ),
    ]);
    const detail = detailPayload.detail ?? null;
    if (detail) {
      detail.events = eventsPayload.events ?? detail.events ?? [];
      detail.escalations =
        escalationsPayload.escalations ?? detail.escalations ?? [];
      detail.tree = treePayload?.tree ?? detail.tree ?? null;
      detail.audit = auditPayload?.audit ?? detail.audit ?? [];
      detail.policyDiff = policyDiffPayload?.detail ?? null;
      detail.history = historyPayload?.detail ?? null;
      detail.workspaces = workspacesPayload?.detail ?? null;
    }
    state.executionDetail = detail;
    state.executionDetailError = null;
  } catch (error) {
    state.executionDetail = null;
    state.executionDetailError = error.message;
  }
}

async function loadScenarioCatalog() {
  const result = await optionalApi("/orchestrator/scenarios");
  state.scenarioRouteState = result.state;
  state.scenarioRouteError = result.error;
  state.scenarios = result.payload?.scenarios ?? [];

  if (
    state.selectedScenarioId &&
    !state.scenarios.some((item) => item.id === state.selectedScenarioId)
  ) {
    state.selectedScenarioId = null;
  }
  if (!state.selectedScenarioId && state.scenarios[0]) {
    state.selectedScenarioId = state.scenarios[0].id;
  }
}

async function loadRunCenterSummary() {
  const result = await optionalApi("/orchestrator/run-center/summary");
  state.runCenterState = result.state;
  state.runCenterError = result.error;
  state.runCenter = result.payload ?? null;
  if (result.state === "ready") {
    const summary = normalizeRunCenterCollections(result.payload ?? {});
    const firstWorkItemRun = normalizeRouteArray(summary.selfBuild ?? {}, [
      "recentWorkItemRuns",
      "runs",
    ])[0];
    const nextRunId = normalizeText(
      readFirstField(firstWorkItemRun, ["runId", "id"]),
      "",
    );
    if (nextRunId && !state.selectedRunCenterWorkItemRunId) {
      state.selectedRunCenterWorkItemRunId = nextRunId;
    }
  }
}

async function loadSelfBuildSummary() {
  const result = await optionalApi("/orchestrator/self-build/summary");
  state.selfBuildSummaryState = result.state;
  state.selfBuildSummaryError = result.error;
  state.selfBuildSummary = result.payload?.detail ?? result.payload ?? null;
}

async function loadWorkItemRunDrilldown() {
  if (!state.selectedRunCenterWorkItemRunId) {
    state.workItemRunDetail = null;
    state.workItemRunDetailState = "idle";
    state.workItemRunDetailError = null;
    state.proposalDetail = null;
    state.proposalDetailState = "idle";
    state.proposalDetailError = null;
    return;
  }

  const runResult = await optionalApi(
    `/orchestrator/work-item-runs/${encodeURIComponent(state.selectedRunCenterWorkItemRunId)}`,
  );
  state.workItemRunDetailState = runResult.state;
  state.workItemRunDetailError = runResult.error;
  state.workItemRunDetail =
    runResult.payload?.detail ?? runResult.payload ?? null;

  const proposalId =
    state.workItemRunDetail?.proposal?.id ??
    state.workItemRunDetail?.proposalArtifactId ??
    state.workItemRunDetail?.metadata?.proposalArtifactId ??
    null;

  if (!proposalId) {
    state.proposalDetail = null;
    state.proposalDetailState = "idle";
    state.proposalDetailError = null;
    return;
  }

  const proposalResult = await optionalApi(
    `/orchestrator/proposal-artifacts/${encodeURIComponent(proposalId)}`,
  );
  state.proposalDetailState = proposalResult.state;
  state.proposalDetailError = proposalResult.error;
  state.proposalDetail =
    proposalResult.payload?.detail ?? proposalResult.payload ?? null;
}

async function loadScenarioDetail() {
  if (!state.selectedScenarioId || state.scenarioRouteState !== "ready") {
    state.scenarioDetail = null;
    state.scenarioRuns = [];
    state.scenarioDetailState = "idle";
    state.scenarioRunsState = "idle";
    state.scenarioDetailError = null;
    state.scenarioRunsError = null;
    state.selectedScenarioRunId = null;
    state.scenarioRunArtifacts = null;
    state.scenarioRunArtifactsState = "idle";
    state.scenarioRunArtifactsError = null;
    state.scenarioRunDetail = null;
    state.scenarioRunDetailState = "idle";
    state.scenarioRunDetailError = null;
    state.scenarioTrend = null;
    state.scenarioTrendState = "idle";
    state.scenarioTrendError = null;
    return;
  }

  const scenarioId = encodeURIComponent(state.selectedScenarioId);
  const [detailResult, runsResult] = await Promise.all([
    optionalApi(`/orchestrator/scenarios/${scenarioId}`),
    optionalApi(`/orchestrator/scenarios/${scenarioId}/runs`),
  ]);

  state.scenarioDetailState = detailResult.state;
  state.scenarioDetailError = detailResult.error;
  state.scenarioDetail = detailResult.payload ?? null;

  state.scenarioRunsState = runsResult.state;
  state.scenarioRunsError = runsResult.error;
  state.scenarioRuns = runsResult.payload?.detail?.runs ?? [];

  if (
    state.selectedScenarioRunId &&
    !state.scenarioRuns.some((run) => run.id === state.selectedScenarioRunId)
  ) {
    state.selectedScenarioRunId = null;
  }
  if (!state.selectedScenarioRunId && state.scenarioRuns[0]?.id) {
    state.selectedScenarioRunId = state.scenarioRuns[0].id;
  }

  await loadScenarioRunArtifacts();
  await loadScenarioRunDetailAndTrend();
}

async function loadScenarioRunArtifacts() {
  if (
    !state.selectedScenarioId ||
    !state.selectedScenarioRunId ||
    state.scenarioRunsState !== "ready"
  ) {
    state.scenarioRunArtifacts = null;
    state.scenarioRunArtifactsState = "idle";
    state.scenarioRunArtifactsError = null;
    return;
  }

  const scenarioId = encodeURIComponent(state.selectedScenarioId);
  const runId = encodeURIComponent(state.selectedScenarioRunId);
  const result = await optionalApi(
    `/orchestrator/scenarios/${scenarioId}/runs/${runId}/artifacts`,
  );
  state.scenarioRunArtifactsState = result.state;
  state.scenarioRunArtifactsError = result.error;
  state.scenarioRunArtifacts = result.payload?.detail ?? null;
}

async function loadScenarioRunDetailAndTrend() {
  if (!state.selectedScenarioId || state.scenarioRouteState !== "ready") {
    state.scenarioRunDetail = null;
    state.scenarioRunDetailState = "idle";
    state.scenarioRunDetailError = null;
    state.scenarioTrend = null;
    state.scenarioTrendState = "idle";
    state.scenarioTrendError = null;
    return;
  }

  const calls = [
    optionalApi(
      `/orchestrator/scenarios/${encodeURIComponent(state.selectedScenarioId)}/trends`,
    ),
  ];
  if (state.selectedScenarioRunId) {
    calls.push(
      optionalApi(
        `/orchestrator/scenario-runs/${encodeURIComponent(state.selectedScenarioRunId)}`,
      ),
    );
  } else {
    calls.push(Promise.resolve({ state: "idle", payload: null, error: null }));
  }

  const [trendResult, runDetailResult] = await Promise.all(calls);
  state.scenarioTrendState = trendResult.state;
  state.scenarioTrendError = trendResult.error;
  state.scenarioTrend =
    trendResult.payload?.detail ?? trendResult.payload ?? null;

  state.scenarioRunDetailState = runDetailResult.state;
  state.scenarioRunDetailError = runDetailResult.error;
  state.scenarioRunDetail =
    runDetailResult.payload?.detail ?? runDetailResult.payload ?? null;
}

async function loadRegressionCatalog() {
  const result = await optionalApi("/orchestrator/regressions");
  state.regressionRouteState = result.state;
  state.regressionRouteError = result.error;
  state.regressions = result.payload?.regressions ?? [];

  if (
    state.selectedRegressionId &&
    !state.regressions.some(
      (regression) => regression.id === state.selectedRegressionId,
    )
  ) {
    state.selectedRegressionId = null;
  }
  if (!state.selectedRegressionId && state.regressions[0]?.id) {
    state.selectedRegressionId = state.regressions[0].id;
  }
}

async function loadRegressionDetail() {
  if (!state.selectedRegressionId || state.regressionRouteState !== "ready") {
    state.regressionDetail = null;
    state.regressionDetailState = "idle";
    state.regressionDetailError = null;
    state.regressionRuns = [];
    state.regressionRunsState = "idle";
    state.regressionRunsError = null;
    state.regressionRunDetail = null;
    state.regressionRunDetailState = "idle";
    state.regressionRunDetailError = null;
    state.regressionRunReport = null;
    state.regressionRunReportState = "idle";
    state.regressionRunReportError = null;
    state.regressionTrend = null;
    state.regressionTrendState = "idle";
    state.regressionTrendError = null;
    state.selectedRegressionRunId = null;
    return;
  }

  const regressionId = encodeURIComponent(state.selectedRegressionId);
  const [detailResult, runsResult] = await Promise.all([
    optionalApi(`/orchestrator/regressions/${regressionId}`),
    optionalApi(`/orchestrator/regressions/${regressionId}/runs`),
  ]);

  state.regressionDetailState = detailResult.state;
  state.regressionDetailError = detailResult.error;
  state.regressionDetail = detailResult.payload ?? null;

  state.regressionRunsState = runsResult.state;
  state.regressionRunsError = runsResult.error;
  state.regressionRuns = runsResult.payload?.detail?.runs ?? [];

  if (
    state.selectedRegressionRunId &&
    !state.regressionRuns.some(
      (run) => run.id === state.selectedRegressionRunId,
    )
  ) {
    state.selectedRegressionRunId = null;
  }
  if (!state.selectedRegressionRunId && state.regressionRuns[0]?.id) {
    state.selectedRegressionRunId = state.regressionRuns[0].id;
  }

  await loadRegressionRunDetailAndTrend();
}

async function loadRegressionRunDetailAndTrend() {
  if (!state.selectedRegressionId || state.regressionRouteState !== "ready") {
    state.regressionRunDetail = null;
    state.regressionRunDetailState = "idle";
    state.regressionRunDetailError = null;
    state.regressionRunReport = null;
    state.regressionRunReportState = "idle";
    state.regressionRunReportError = null;
    state.regressionTrend = null;
    state.regressionTrendState = "idle";
    state.regressionTrendError = null;
    return;
  }

  const calls = [
    optionalApi(
      `/orchestrator/regressions/${encodeURIComponent(state.selectedRegressionId)}/trends`,
    ),
  ];
  if (state.selectedRegressionRunId) {
    calls.push(
      optionalApi(
        `/orchestrator/regression-runs/${encodeURIComponent(state.selectedRegressionRunId)}`,
      ),
    );
    calls.push(
      optionalApi(
        `/orchestrator/regression-runs/${encodeURIComponent(state.selectedRegressionRunId)}/report`,
      ),
    );
  } else {
    calls.push(Promise.resolve({ state: "idle", payload: null, error: null }));
    calls.push(Promise.resolve({ state: "idle", payload: null, error: null }));
  }

  const [trendResult, runDetailResult, reportResult] = await Promise.all(calls);
  state.regressionTrendState = trendResult.state;
  state.regressionTrendError = trendResult.error;
  state.regressionTrend =
    trendResult.payload?.detail ?? trendResult.payload ?? null;

  state.regressionRunDetailState = runDetailResult.state;
  state.regressionRunDetailError = runDetailResult.error;
  state.regressionRunDetail =
    runDetailResult.payload?.detail ?? runDetailResult.payload ?? null;

  state.regressionRunReportState = reportResult.state;
  state.regressionRunReportError = reportResult.error;
  state.regressionRunReport =
    reportResult.payload?.detail ?? reportResult.payload ?? null;
}

async function refresh() {
  const [statusPayload, sessionsPayload] = await Promise.all([
    api("/status"),
    api("/sessions"),
  ]);
  state.sessions = sessionsPayload.sessions ?? [];

  if (!state.selectedSessionId && state.sessions[0]) {
    state.selectedSessionId = state.sessions[0].id;
    connectEventStream();
  }

  await loadExecutionSummaries();
  await Promise.all([
    loadRunCenterSummary(),
    loadSelfBuildSummary(),
    loadOperatorThreads(),
    loadOperatorPendingInbox(),
    loadScenarioCatalog(),
    loadRegressionCatalog(),
  ]);

  const detailPromises = [];
  if (state.selectedSessionId) {
    detailPromises.push(
      api(`/sessions/${encodeURIComponent(state.selectedSessionId)}?limit=20`),
    );
    detailPromises.push(loadSessionLive());
    detailPromises.push(loadArtifacts());
  } else {
    state.detail = null;
    state.sessionLive = null;
    state.sessionLiveState = "idle";
    state.sessionLiveError = null;
    state.artifacts = null;
    state.transcript = null;
    state.piEvents = null;
  }

  detailPromises.push(loadExecutionDetail());
  detailPromises.push(loadScenarioDetail());
  detailPromises.push(loadRegressionDetail());
  detailPromises.push(loadWorkItemRunDrilldown());
  detailPromises.push(loadOperatorThreadDetail());
  const results = await Promise.all(detailPromises);
  if (state.selectedSessionId) {
    state.detail = results[0];
  }

  renderStatus(statusPayload.status);
  renderExecutions();
  renderScenarios();
  renderScenarioDetail();
  renderRegressions();
  renderRunCenter();
  renderSessions();
  renderWorkflowPreview();
  renderExecutionDetail();
  renderExecutionHistory(state.executionDetail);
  renderDetail();
  renderOperatorInbox();
  renderOperatorThreads();
  renderOperatorChat();
}

async function runScenario(stub = false) {
  if (!state.selectedScenarioId) {
    return;
  }
  state.selectedScenarioRunId = null;
  await api(
    `/orchestrator/scenarios/${encodeURIComponent(state.selectedScenarioId)}/run`,
    {
      method: "POST",
      body: JSON.stringify({
        stub,
        wait: true,
        by: "web-operator",
        source: "web",
      }),
    },
  );
  await refresh();
}

async function runRegression(regressionId, stub = false) {
  if (!regressionId) {
    return;
  }
  state.selectedRegressionId = regressionId;
  state.selectedRegressionRunId = null;
  await api(
    `/orchestrator/regressions/${encodeURIComponent(regressionId)}/run`,
    {
      method: "POST",
      body: JSON.stringify({
        stub,
        by: "web-operator",
        source: "web",
      }),
    },
  );
  await refresh();
}

async function sendAction(action, payload = {}) {
  if (!state.selectedSessionId) {
    return;
  }
  await api(
    `/sessions/${encodeURIComponent(state.selectedSessionId)}/actions/${action}`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
  await refresh();
}

async function sendExecutionAction(action, payload = {}) {
  if (!state.selectedExecutionId) {
    return;
  }
  await api(
    `/orchestrator/executions/${encodeURIComponent(state.selectedExecutionId)}/${action}`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
  await refresh();
}

async function sendExecutionGroupAction(action, payload = {}) {
  const groupId = state.executionDetail?.execution?.coordinationGroupId;
  if (!groupId) {
    return;
  }
  await api(
    `/orchestrator/coordination-groups/${encodeURIComponent(groupId)}/${action}`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
  await refresh();
}

async function sendExecutionTreeAction(action, payload = {}) {
  if (!state.selectedExecutionId) {
    return;
  }
  await api(
    `/orchestrator/executions/${encodeURIComponent(state.selectedExecutionId)}/tree/${action}`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
  await refresh();
}

async function sendExecutionBranchSpawn(payload = {}) {
  if (!state.selectedExecutionId) {
    return;
  }
  const response = await api(
    `/orchestrator/executions/${encodeURIComponent(state.selectedExecutionId)}/branches`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
  const firstCreated = Array.isArray(response?.created)
    ? response.created[0]
    : null;
  const createdExecutionId =
    firstCreated?.detail?.execution?.id ??
    firstCreated?.created?.execution?.id ??
    firstCreated?.invocation?.invocationId ??
    null;
  if (createdExecutionId) {
    state.selectedExecutionId = createdExecutionId;
    connectExecutionEventStream();
  }
  await refresh();
}

async function sendEscalationAction(escalationId, payload = {}) {
  if (!state.selectedExecutionId || !escalationId) {
    return;
  }
  await api(
    `/orchestrator/executions/${encodeURIComponent(state.selectedExecutionId)}/escalations/${encodeURIComponent(escalationId)}/resolve`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
  await refresh();
}

async function previewWorkflowPlan() {
  els.workflowPreviewButton.disabled = true;
  state.workflowPreviewError = null;
  els.workflowPreviewState.textContent = "plan preview: loading";

  try {
    const payload = await api("/orchestrator/workflows/plan", {
      method: "POST",
      body: JSON.stringify(getWorkflowRequestPayload()),
    });
    captureWorkflowPreview(payload?.invocation ?? null, "plan");
  } catch (error) {
    state.workflowPreview = null;
    state.workflowPreviewError = error.message;
    state.workflowPreviewDirty = false;
    state.workflowPreviewSource = null;
  } finally {
    els.workflowPreviewButton.disabled = false;
    renderWorkflowPreview();
  }
}

function setAutoRefresh(enabled) {
  if (state.autoRefreshTimer) {
    clearInterval(state.autoRefreshTimer);
    state.autoRefreshTimer = null;
  }
  if (enabled) {
    state.autoRefreshTimer = setInterval(() => {
      refresh().catch((error) => {
        console.error(error);
      });
    }, 4000);
  }
}

function connectEventStream() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
  const params = new URLSearchParams();
  if (state.selectedSessionId) {
    params.set("session", state.selectedSessionId);
  }
  const target = `/api/stream/events?${params.toString()}`;
  const source = new EventSource(target);
  state.eventSource = source;
  els.streamState.textContent = `event stream: connecting${state.selectedSessionId ? ` (${state.selectedSessionId})` : ""}`;

  source.addEventListener("ready", () => {
    els.streamState.textContent = `event stream: ready${state.selectedSessionId ? ` (${state.selectedSessionId})` : ""}`;
  });

  source.addEventListener("session-event", () => {
    refresh().catch((error) => console.error(error));
  });

  source.addEventListener("error", () => {
    els.streamState.textContent = "event stream: reconnecting";
  });
}

function connectExecutionEventStream() {
  if (state.executionEventSource) {
    state.executionEventSource.close();
    state.executionEventSource = null;
  }

  if (!state.selectedExecutionId) {
    els.executionStreamState.textContent = "execution stream: idle";
    return;
  }

  const params = new URLSearchParams();
  params.set("execution", state.selectedExecutionId);
  const source = new EventSource(
    `/api/orchestrator/stream/executions?${params.toString()}`,
  );
  state.executionEventSource = source;
  els.executionStreamState.textContent = `execution stream: connecting (${state.selectedExecutionId})`;

  source.addEventListener("ready", () => {
    els.executionStreamState.textContent = `execution stream: ready (${state.selectedExecutionId})`;
  });

  source.addEventListener("workflow-event", () => {
    refresh().catch((error) => console.error(error));
  });

  source.addEventListener("error", () => {
    els.executionStreamState.textContent = `execution stream: reconnecting (${state.selectedExecutionId})`;
  });
}

function setActiveTab(tabName) {
  state.activeTab = tabName;
  for (const button of els.tabButtons) {
    button.classList.toggle("active", button.dataset.tab === tabName);
  }
  for (const panel of els.tabPanels) {
    panel.classList.toggle("active", panel.id === `tab-${tabName}`);
  }
}

els.refreshButton.addEventListener("click", () => {
  refresh().catch((error) => console.error(error));
});

els.autoRefresh.addEventListener("change", () => {
  setAutoRefresh(els.autoRefresh.checked);
});

els.driveButton.addEventListener("click", async () => {
  els.driveButton.disabled = true;
  try {
    await sendExecutionAction(
      "drive",
      buildDrivePayload({
        wait: els.driveWait.checked,
        timeoutInput: els.driveTimeout,
        intervalInput: els.driveInterval,
      }),
    );
  } catch (error) {
    alert(error.message);
  } finally {
    renderExecutionDetail();
  }
});

els.driveGroupButton.addEventListener("click", async () => {
  els.driveGroupButton.disabled = true;
  try {
    await sendExecutionGroupAction(
      "drive",
      buildDrivePayload({
        wait: els.driveWait.checked,
        timeoutInput: els.driveTimeout,
        intervalInput: els.driveInterval,
      }),
    );
  } catch (error) {
    alert(error.message);
  } finally {
    renderExecutionDetail();
  }
});

function buildOperatorStatePayload() {
  return {
    by: "operator",
    reason:
      els.executionOperatorReason.value.trim() || "Operator intervention.",
    comments: els.executionOperatorComments.value.trim(),
  };
}

function buildResumePayload() {
  const payload = buildOperatorStatePayload();
  return {
    by: payload.by,
    comments: payload.comments || payload.reason,
  };
}

els.pauseButton.addEventListener("click", async () => {
  els.pauseButton.disabled = true;
  try {
    await sendExecutionAction("pause", buildOperatorStatePayload());
  } catch (error) {
    alert(error.message);
  } finally {
    renderExecutionDetail();
  }
});

els.holdButton.addEventListener("click", async () => {
  els.holdButton.disabled = true;
  try {
    await sendExecutionAction("hold", buildOperatorStatePayload());
  } catch (error) {
    alert(error.message);
  } finally {
    renderExecutionDetail();
  }
});

els.resumeButton.addEventListener("click", async () => {
  els.resumeButton.disabled = true;
  try {
    await sendExecutionAction("resume", buildResumePayload());
  } catch (error) {
    alert(error.message);
  } finally {
    renderExecutionDetail();
  }
});

els.driveTreeButton.addEventListener("click", async () => {
  els.driveTreeButton.disabled = true;
  try {
    await sendExecutionTreeAction(
      "drive",
      buildDrivePayload({
        wait: els.driveWait.checked,
        timeoutInput: els.driveTimeout,
        intervalInput: els.driveInterval,
      }),
    );
  } catch (error) {
    alert(error.message);
  } finally {
    renderExecutionDetail();
  }
});

els.pauseTreeButton.addEventListener("click", async () => {
  els.pauseTreeButton.disabled = true;
  try {
    await sendExecutionTreeAction("pause", buildOperatorStatePayload());
  } catch (error) {
    alert(error.message);
  } finally {
    renderExecutionDetail();
  }
});

els.holdTreeButton.addEventListener("click", async () => {
  els.holdTreeButton.disabled = true;
  try {
    await sendExecutionTreeAction("hold", buildOperatorStatePayload());
  } catch (error) {
    alert(error.message);
  } finally {
    renderExecutionDetail();
  }
});

els.resumeTreeButton.addEventListener("click", async () => {
  els.resumeTreeButton.disabled = true;
  try {
    await sendExecutionTreeAction("resume", buildResumePayload());
  } catch (error) {
    alert(error.message);
  } finally {
    renderExecutionDetail();
  }
});

els.reviewButton.addEventListener("click", async () => {
  els.reviewButton.disabled = true;
  try {
    await sendExecutionAction("review", {
      status: els.reviewStatus.value,
      by: normalizeText(els.reviewBy.value, "operator"),
      comments: els.reviewComments.value.trim(),
    });
  } catch (error) {
    alert(error.message);
  } finally {
    renderExecutionDetail();
  }
});

els.approvalButton.addEventListener("click", async () => {
  els.approvalButton.disabled = true;
  try {
    await sendExecutionAction("approval", {
      status: els.approvalStatus.value,
      by: normalizeText(els.approvalBy.value, "operator"),
      comments: els.approvalComments.value.trim(),
    });
  } catch (error) {
    alert(error.message);
  } finally {
    renderExecutionDetail();
  }
});

els.familyReviewButton.addEventListener("click", async () => {
  els.familyReviewButton.disabled = true;
  try {
    await sendExecutionTreeAction("review", {
      status: els.familyReviewStatus.value,
      scope: els.familyReviewScope.value,
      by: normalizeText(els.familyReviewBy.value, "operator"),
      comments: els.familyReviewComments.value.trim(),
    });
  } catch (error) {
    alert(error.message);
  } finally {
    renderExecutionDetail();
  }
});

els.familyApprovalButton.addEventListener("click", async () => {
  els.familyApprovalButton.disabled = true;
  try {
    await sendExecutionTreeAction("approval", {
      status: els.familyApprovalStatus.value,
      scope: els.familyApprovalScope.value,
      by: normalizeText(els.familyApprovalBy.value, "operator"),
      comments: els.familyApprovalComments.value.trim(),
    });
  } catch (error) {
    alert(error.message);
  } finally {
    renderExecutionDetail();
  }
});

els.branchSpawnButton.addEventListener("click", async () => {
  els.branchSpawnButton.disabled = true;
  try {
    const draft = getBranchDefinitionsDraft();
    await sendExecutionBranchSpawn({
      branches: draft.branches,
      wait: els.branchSpawnWait.checked,
      timeout: parsePositiveInt(els.branchTimeout.value) ?? undefined,
      interval: parsePositiveInt(els.branchInterval.value) ?? undefined,
    });
  } catch (error) {
    alert(error.message);
  } finally {
    updateBranchSpawnControls();
    renderExecutionDetail();
  }
});

els.stopButton.addEventListener("click", () => {
  sendAction("stop", { reason: "web-operator stop", force: true }).catch(
    (error) => alert(error.message),
  );
});

els.completeButton.addEventListener("click", () => {
  sendAction("mark-complete", { reason: "web-operator complete" }).catch(
    (error) => alert(error.message),
  );
});

els.controlForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = els.steerMessage.value.trim();
  if (!message) {
    return;
  }
  try {
    await sendAction("steer", { message, enter: true });
    els.steerMessage.value = "";
  } catch (error) {
    alert(error.message);
  }
});

els.workflowPreviewButton.addEventListener("click", () => {
  previewWorkflowPlan().catch((error) => {
    state.workflowPreview = null;
    state.workflowPreviewError = error.message;
    state.workflowPreviewDirty = false;
    state.workflowPreviewSource = null;
    renderWorkflowPreview();
  });
});

els.workflowForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const requestPayload = getWorkflowRequestPayload();
  els.workflowButton.disabled = true;
  try {
    const payload = await api("/orchestrator/workflows/invoke", {
      method: "POST",
      body: JSON.stringify({
        ...requestPayload,
        wait: false,
      }),
    });

    captureWorkflowPreview(payload?.invocation ?? null, "invoke");
    const createdExecutionId =
      payload?.created?.execution?.id ??
      payload?.invocation?.invocationId ??
      payload?.detail?.execution?.id ??
      null;
    if (createdExecutionId) {
      state.selectedExecutionId = createdExecutionId;
      connectExecutionEventStream();
    }

    els.workflowObjective.value = "";
    await refresh();
  } catch (error) {
    alert(error.message);
  } finally {
    els.workflowButton.disabled = false;
  }
});

for (const element of [
  els.workflowDomain,
  els.workflowRoles,
  els.workflowObjective,
]) {
  element.addEventListener("input", () => {
    markWorkflowPreviewStale();
  });
}

els.branchDefinitions.addEventListener("input", () => {
  updateBranchSpawnControls();
});

for (const button of els.tabButtons) {
  button.addEventListener("click", () => setActiveTab(button.dataset.tab));
}

setAutoRefresh(true);
connectEventStream();
connectExecutionEventStream();
refresh().catch((error) => {
  console.error(error);
  els.sessionDetail.className = "detail-card empty-state";
  els.sessionDetail.textContent = `Failed to load gateway data: ${error.message}`;
});

// Self-Build Dashboard Functions

function switchView(viewName) {
  state.activeView = viewName;

  // Update view button states
  if (els.viewRunCenterButton) {
    els.viewRunCenterButton.classList.toggle(
      "active",
      viewName === "run-center",
    );
  }
  if (els.viewSelfBuildButton) {
    els.viewSelfBuildButton.classList.toggle(
      "active",
      viewName === "self-build",
    );
  }
  if (els.viewOperatorChatButton) {
    els.viewOperatorChatButton.classList.toggle(
      "active",
      viewName === "operator-chat",
    );
  }

  // Toggle view visibility
  if (els.runCenterView) {
    els.runCenterView.style.display = viewName === "run-center" ? "" : "none";
  }
  if (els.selfBuildView) {
    els.selfBuildView.style.display = viewName === "self-build" ? "" : "none";
  }
  if (els.operatorChatView) {
    els.operatorChatView.style.display =
      viewName === "operator-chat" ? "" : "none";
  }

  // Hide detail overlay when switching views
  if (els.selfBuildDetailOverlay) {
    els.selfBuildDetailOverlay.style.display = "none";
  }

  if (viewName !== "operator-chat" && state.operatorThreadEventSource) {
    state.operatorThreadEventSource.close();
    state.operatorThreadEventSource = null;
  }

  // Refresh data for the active view
  if (viewName === "self-build") {
    refreshSelfBuildDashboard();
  }
  if (viewName === "operator-chat") {
    refreshOperatorChat();
  }
}

async function refreshSelfBuildDashboard() {
  try {
    const query = new URLSearchParams();
    if (state.selfBuildFilters.status)
      query.set("status", state.selfBuildFilters.status);
    if (state.selfBuildFilters.group)
      query.set("group", state.selfBuildFilters.group);
    if (state.selfBuildFilters.template)
      query.set("template", state.selfBuildFilters.template);
    if (state.selfBuildFilters.domain)
      query.set("domain", state.selfBuildFilters.domain);
    const suffix = query.toString() ? `?${query.toString()}` : "";
    const response = await fetch(
      `/api/orchestrator/self-build/dashboard${suffix}`,
    );
    const data = await response.json();

    if (data.ok && data.detail) {
      state.selfBuildSummary = data.detail;
      state.selfBuildSummaryState = "loaded";
      state.selfBuildSummaryError = null;
      renderSelfBuildDashboard();
    } else {
      state.selfBuildSummaryState = "error";
      state.selfBuildSummaryError =
        data.error || "Failed to load self-build summary";
    }
  } catch (error) {
    state.selfBuildSummaryState = "error";
    state.selfBuildSummaryError = error.message;
    console.error("Failed to load self-build summary:", error);
  }
}

async function orchestratorJson(path, options: RequestInit = {}) {
  const response = await fetch(`/api/orchestrator${path}`, {
    headers: {
      "content-type": "application/json",
    },
    ...options,
  });
  const text = await response.text();
  let payload: AnyRecord = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }
  if (!response.ok || !payload.ok) {
    throw new Error(
      payload.message || payload.error || `request failed: ${response.status}`,
    );
  }
  return payload;
}

async function loadOperatorThreads() {
  state.operatorThreadsState = "loading";
  try {
    const payload = await orchestratorJson("/operator/threads");
    state.operatorThreads = Array.isArray(payload.detail) ? payload.detail : [];
    state.operatorThreadsState = "loaded";
    state.operatorThreadsError = null;
    if (
      !state.selectedOperatorThreadId &&
      Array.isArray(state.operatorThreads) &&
      state.operatorThreads[0]?.id
    ) {
      state.selectedOperatorThreadId = state.operatorThreads[0].id;
    }
  } catch (error) {
    state.operatorThreadsState = "error";
    state.operatorThreadsError = error.message;
  }
}

async function loadOperatorPendingInbox() {
  state.operatorPendingInboxState = "loading";
  try {
    const payload = await orchestratorJson(
      "/operator/actions?status=pending&limit=100",
    );
    state.operatorPendingInbox = Array.isArray(payload.detail)
      ? payload.detail
      : [];
    state.operatorPendingInboxState = "loaded";
    state.operatorPendingInboxError = null;
  } catch (error) {
    state.operatorPendingInboxState = "error";
    state.operatorPendingInboxError = error.message;
  }
}

async function loadOperatorThreadDetail() {
  if (!state.selectedOperatorThreadId) {
    state.operatorThreadDetail = null;
    state.operatorThreadDetailState = "idle";
    state.operatorThreadDetailError = null;
    return;
  }
  state.operatorThreadDetailState = "loading";
  try {
    const payload = await orchestratorJson(
      `/operator/threads/${encodeURIComponent(state.selectedOperatorThreadId)}`,
    );
    state.operatorThreadDetail = payload.detail ?? null;
    state.operatorThreadDetailState = "loaded";
    state.operatorThreadDetailError = null;
  } catch (error) {
    state.operatorThreadDetailState = "error";
    state.operatorThreadDetailError = error.message;
  }
}

function connectOperatorThreadEventStream() {
  if (state.operatorThreadEventSource) {
    state.operatorThreadEventSource.close();
    state.operatorThreadEventSource = null;
  }

  if (state.activeView !== "operator-chat" || !state.selectedOperatorThreadId) {
    return;
  }

  const source = new EventSource(
    `/api/orchestrator/operator/threads/${encodeURIComponent(state.selectedOperatorThreadId)}/stream`,
  );
  state.operatorThreadEventSource = source;

  const applyThreadEventPayload = (payload) => {
    if (!payload?.ok) {
      return;
    }
    const previousDetail = state.operatorThreadDetail;
    state.operatorThreadDetail = payload.detail ?? null;
    state.operatorThreadDetailState = "loaded";
    renderOperatorChat();

    const shouldRefreshInbox = shouldRefreshInboxFromThreadEvent(
      previousDetail,
      state.operatorThreadDetail,
    );
    const refreshTasks = [loadOperatorThreads()];
    if (shouldRefreshInbox) {
      refreshTasks.push(loadOperatorPendingInbox());
    }

    Promise.all(refreshTasks)
      .then(() => {
        renderOperatorInbox();
        renderOperatorThreads();
      })
      .catch((error) => console.error(error));
  };

  source.addEventListener("thread-ready", (event) => {
    try {
      applyThreadEventPayload(JSON.parse(event.data));
    } catch (error) {
      console.error(error);
    }
  });

  source.addEventListener("thread-update", (event) => {
    try {
      applyThreadEventPayload(JSON.parse(event.data));
    } catch (error) {
      console.error(error);
    }
  });

  source.addEventListener("error", () => {
    if (els.operatorChatFeedback && state.activeView === "operator-chat") {
      els.operatorChatFeedback.textContent =
        "Operator chat live stream reconnecting...";
    }
  });
}

async function refreshOperatorChat() {
  await loadOperatorThreads();
  await loadOperatorPendingInbox();
  await loadOperatorThreadDetail();
  renderOperatorInbox();
  renderOperatorThreads();
  renderOperatorChat();
  connectOperatorThreadEventStream();
}

function operatorThreadLookup(threadId) {
  return Array.isArray(state.operatorThreads)
    ? state.operatorThreads.find((entry) => entry.id === threadId) || null
    : null;
}

function renderOperatorInbox() {
  if (!els.operatorInboxList) {
    return;
  }
  const actions = Array.isArray(state.operatorPendingInbox)
    ? state.operatorPendingInbox
    : [];
  if (els.operatorInboxCount) {
    els.operatorInboxCount.textContent = `${actions.length} pending`;
  }
  if (actions.length === 0) {
    els.operatorInboxList.className =
      "operator-action-list detail-card empty-state";
    els.operatorInboxList.textContent =
      "No pending decisions across operator threads right now.";
    return;
  }
  els.operatorInboxList.className = "operator-inbox-list";
  els.operatorInboxList.innerHTML = actions
    .map((action) => {
      const active = action.threadId === state.selectedOperatorThreadId;
      return renderOperatorInboxRow(action, {
        active,
        threadFallback: operatorThreadLookup(action.threadId),
      });
    })
    .join("");
}

function renderOperatorThreads() {
  if (!els.operatorThreadList) {
    return;
  }
  const threads = Array.isArray(state.operatorThreads)
    ? state.operatorThreads
    : [];
  if (els.operatorThreadCount) {
    els.operatorThreadCount.textContent = `${threads.length} thread${
      threads.length === 1 ? "" : "s"
    }`;
  }
  if (threads.length === 0) {
    els.operatorThreadList.innerHTML =
      '<div class="detail-card empty-state">No operator threads yet. Start a mission and the orchestrator will handle the flow from here.</div>';
    return;
  }
  els.operatorThreadList.innerHTML = threads
    .map((thread) => {
      const summary = thread.summary || {};
      const goalPlan = summary.goalPlan || {};
      const proposal = summary.proposal || {};
      const pendingCount = Number(summary.pendingActionCount ?? 0);
      const active = thread.id === state.selectedOperatorThreadId;
      return `
        <article class="operator-thread-card ${active ? "active" : ""}" data-thread-id="${escapeHtml(String(thread.id))}">
          <div class="operator-thread-header">
            <div class="operator-thread-title-row">
              <strong>${escapeHtml(String(thread.title || summary.objective || thread.id))}</strong>
              <span class="muted">${escapeHtml(String(summary.objective || "Conversation-first operator flow"))}</span>
            </div>
            ${renderStatusBadge(thread.status || "idle")}
          </div>
          <div class="operator-thread-excerpt">${escapeHtml(String(summary.lastMessageExcerpt || "No messages yet."))}</div>
          <div class="operator-thread-meta">
            ${goalPlan.id ? `<span class="detail-pill">plan:${escapeHtml(String(goalPlan.status || "unknown"))}</span>` : ""}
            ${proposal.id ? `<span class="detail-pill">proposal:${escapeHtml(String(proposal.status || "unknown"))}</span>` : ""}
            ${pendingCount > 0 ? `<span class="detail-pill emphasized">pending:${pendingCount}</span>` : `<span class="detail-pill">pending:0</span>`}
            <span class="muted">${escapeHtml(formatDisplayTimestamp(summary.lastMessageAt || thread.updatedAt))}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderOperatorArtifactButton(artifact) {
  if (!artifact?.itemType || !artifact?.itemId) {
    return "";
  }
  return `
    <button
      type="button"
      class="operator-artifact-button"
      data-open-self-build="true"
      data-open-type="${escapeHtml(String(artifact.itemType))}"
      data-open-id="${escapeHtml(String(artifact.itemId))}"
    >
      ${escapeHtml(String(artifact.title || artifact.itemId))}
    </button>
  `;
}

function renderOperatorActionButton(actionId, action) {
  const tone = action.tone === "primary" ? "primary" : "secondary";
  return `
    <button
      type="button"
      class="operator-action-button ${tone}"
      data-operator-action-id="${escapeHtml(String(actionId))}"
      data-operator-action-choice="${escapeHtml(String(action.value))}"
    >
      ${escapeHtml(String(action.label || action.value))}
    </button>
  `;
}

function renderOperatorMessages(detail) {
  if (!els.operatorMessageList) {
    return;
  }
  const messages = Array.isArray(detail?.messages) ? detail.messages : [];
  els.operatorMessageList.innerHTML =
    messages.length > 0
      ? messages
          .map((message) => {
            const payload = message.payload || {};
            const artifacts = Array.isArray(payload.artifacts)
              ? payload.artifacts
              : [];
            const pendingActionId = payload.pendingActionId || null;
            const pendingAction = Array.isArray(detail.pendingActions)
              ? detail.pendingActions.find(
                  (entry) => entry.id === pendingActionId,
                )
              : null;
            const actionButtons = Array.isArray(pendingAction?.choices)
              ? pendingAction.choices
                  .map((entry) =>
                    renderOperatorActionButton(pendingAction.id, entry),
                  )
                  .join("")
              : "";
            return `
              <article class="operator-message-card" data-role="${escapeHtml(String(message.role || "assistant"))}">
                <div class="operator-message-header">
                  <div>
                    <div class="operator-message-role">${escapeHtml(String(message.role || "assistant"))}</div>
                    <strong>${escapeHtml(String(message.kind || "message"))}</strong>
                  </div>
                  <span class="muted">${escapeHtml(formatDisplayTimestamp(message.createdAt))}</span>
                </div>
                <div class="operator-message-content">${escapeHtml(String(message.content || ""))}</div>
                ${artifacts.length > 0 ? `<div class="operator-message-artifacts">${artifacts.map(renderOperatorArtifactButton).join("")}</div>` : ""}
                ${actionButtons ? `<div class="operator-action-controls">${actionButtons}</div>` : ""}
              </article>
            `;
          })
          .join("")
      : '<div class="detail-card empty-state">Conversation history will appear here.</div>';
}

function renderOperatorPendingActions(detail) {
  if (!els.operatorPendingActions) {
    return;
  }
  const actions = Array.isArray(detail?.pendingActions)
    ? detail.pendingActions
    : [];
  if (els.operatorPendingCount) {
    els.operatorPendingCount.textContent = `${actions.length} pending`;
  }
  if (actions.length === 0) {
    els.operatorPendingActions.className =
      "operator-action-list detail-card empty-state";
    els.operatorPendingActions.textContent =
      "No pending operator decisions. The orchestrator can continue without a manual gate right now.";
    return;
  }
  els.operatorPendingActions.className = "operator-action-list";
  els.operatorPendingActions.innerHTML = actions
    .map((action) => {
      const choices = Array.isArray(action.choices) ? action.choices : [];
      return `
        <article class="operator-action-card">
          <div class="operator-action-header">
            <div>
              <strong>${escapeHtml(String(action.title || action.actionKind || "Decision"))}</strong>
              <div class="muted">${escapeHtml(String(action.targetType || "target"))}:${escapeHtml(String(action.targetId || "-"))}</div>
            </div>
            ${renderStatusBadge(action.status || "pending")}
          </div>
          <div class="operator-action-summary">${escapeHtml(String(action.summary || "Operator decision required."))}</div>
          ${choices.length > 0 ? `<div class="operator-action-controls">${choices.map((entry) => renderOperatorActionButton(action.id, entry)).join("")}</div>` : ""}
        </article>
      `;
    })
    .join("");
}

function renderOperatorLinkedArtifacts(detail) {
  if (!els.operatorLinkedArtifacts) {
    return;
  }
  const artifacts = Array.isArray(detail?.context?.linkedArtifacts)
    ? detail.context.linkedArtifacts.filter(Boolean)
    : [];
  const activeQuarantine = detail?.context?.activeQuarantine || null;
  if (els.operatorArtifactCount) {
    els.operatorArtifactCount.textContent = `${
      artifacts.length + (activeQuarantine ? 1 : 0)
    } links`;
  }
  if (artifacts.length === 0 && !activeQuarantine) {
    els.operatorLinkedArtifacts.className = "detail-card empty-state";
    els.operatorLinkedArtifacts.textContent =
      "No linked artifacts yet. Goal plans, managed work groups, proposals, and integration branches will appear here.";
    return;
  }
  els.operatorLinkedArtifacts.className = "operator-artifact-list";
  const quarantineCard = activeQuarantine
    ? `
        <article class="operator-artifact-card">
          <div class="operator-artifact-header">
            <div>
              <strong>${escapeHtml(String(activeQuarantine.id))}</strong>
              <div class="muted">active quarantine on ${escapeHtml(String(activeQuarantine.targetType || "target"))}</div>
            </div>
            ${renderStatusBadge(activeQuarantine.status || "active")}
          </div>
          <div class="operator-artifact-summary">${escapeHtml(String(activeQuarantine.reason || "Quarantine is active for this mission."))}</div>
        </article>
      `
    : "";
  els.operatorLinkedArtifacts.innerHTML = `${quarantineCard}${artifacts
    .map(
      (artifact) => `
        <article class="operator-artifact-card">
          <div class="operator-artifact-header">
            <div>
              <strong>${escapeHtml(String(artifact.title || artifact.itemId))}</strong>
              <div class="muted">${escapeHtml(String(artifact.itemType || "artifact"))}</div>
            </div>
            ${renderStatusBadge(artifact.status || "linked")}
          </div>
          <div class="operator-artifact-actions">${renderOperatorArtifactButton(artifact)}</div>
        </article>
      `,
    )
    .join("")}`;
}

function renderOperatorThreadSettings(detail) {
  if (!els.operatorThreadSettings) {
    return;
  }
  const execution = detail?.metadata?.execution || {};
  const settings = [
    ["Project", execution.projectId || "spore"],
    ["Runtime", execution.stub === false ? "real PI" : "stub"],
    ["Safe mode", execution.safeMode === false ? "off" : "on"],
    ["Auto validate", execution.autoValidate === false ? "off" : "on"],
    ["Auto run", execution.autoRun === false ? "off" : "on"],
    ["Auto promote", execution.autoPromote === true ? "on" : "manual gate"],
  ];
  els.operatorThreadSettings.className = "detail-card";
  els.operatorThreadSettings.innerHTML = `
    <div class="operator-settings-grid">
      ${settings
        .map(
          ([label, value]) => `
            <div class="operator-setting-row">
              <span class="detail-label">${escapeHtml(String(label))}</span>
              <strong>${escapeHtml(String(value))}</strong>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderOperatorChat() {
  const detail = state.operatorThreadDetail;
  if (els.operatorChatTitle) {
    els.operatorChatTitle.textContent =
      detail?.hero?.title || detail?.title || "Mission Console";
  }
  if (els.operatorChatSubtitle) {
    els.operatorChatSubtitle.textContent =
      detail?.hero?.statusLine ||
      detail?.summary?.objective ||
      "Start a mission to let the orchestrator manage self-build on your behalf.";
  }
  if (els.operatorChatState) {
    els.operatorChatState.textContent = detail
      ? `mission:${detail.progress?.currentState || detail.status || "idle"} · pending:${
          Array.isArray(detail.pendingActions) ? detail.pendingActions.length : 0
        }`
      : `thread:${state.operatorThreadDetailState}`;
  }

  if (!detail) {
    if (els.operatorChatEmpty) els.operatorChatEmpty.style.display = "block";
    if (els.operatorChatShell) els.operatorChatShell.style.display = "none";
    if (els.operatorMissionHero) {
      els.operatorMissionHero.innerHTML = renderOperatorMissionHero(null);
    }
    if (els.operatorProgressStrip) {
      els.operatorProgressStrip.innerHTML = renderOperatorProgress(null);
    }
    if (els.operatorCurrentDecision) {
      els.operatorCurrentDecision.innerHTML = renderOperatorCurrentDecision(null);
    }
    if (els.operatorQuickReplies) {
      els.operatorQuickReplies.innerHTML = renderOperatorQuickReplies(null);
    }
    if (els.operatorEvidenceSummary) {
      els.operatorEvidenceSummary.innerHTML = renderOperatorEvidenceSummary(null);
    }
    renderOperatorPendingActions(null);
    renderOperatorLinkedArtifacts(null);
    renderOperatorThreadSettings({ metadata: { execution: {} } });
    return;
  }

  if (els.operatorChatEmpty) els.operatorChatEmpty.style.display = "none";
  if (els.operatorChatShell) els.operatorChatShell.style.display = "grid";

  if (els.operatorMissionHero) {
    els.operatorMissionHero.innerHTML = renderOperatorMissionHero(detail);
  }
  if (els.operatorProgressStrip) {
    els.operatorProgressStrip.innerHTML = renderOperatorProgress(detail);
  }
  if (els.operatorCurrentDecision) {
    els.operatorCurrentDecision.innerHTML = renderOperatorCurrentDecision(detail, {
      emphasized: state.operatorMissionFocusSource === "inbox",
      highlightedActionId: state.operatorHighlightedActionId,
    });
  }
  if (els.operatorQuickReplies) {
    els.operatorQuickReplies.innerHTML = renderOperatorQuickReplies(detail);
  }
  if (els.operatorEvidenceSummary) {
    els.operatorEvidenceSummary.innerHTML = renderOperatorEvidenceSummary(detail);
  }

  renderOperatorMessages(detail);
  renderOperatorPendingActions(detail);
  renderOperatorLinkedArtifacts(detail);
  renderOperatorThreadSettings(detail);
}

async function createOperatorThreadFromForm() {
  if (!els.operatorThreadMessage) {
    return;
  }
  const message = els.operatorThreadMessage.value?.trim() || "";
  if (!message) {
    if (els.operatorThreadFeedback) {
      els.operatorThreadFeedback.textContent =
        "Describe a mission first so the orchestrator can create a goal plan.";
    }
    return;
  }
  if (els.operatorThreadFeedback) {
    els.operatorThreadFeedback.textContent = "Starting operator thread...";
  }
  try {
    const payload = await orchestratorJson("/operator/threads", {
      method: "POST",
      body: JSON.stringify({
        message,
        projectId: els.operatorThreadProject?.value?.trim() || "spore",
        safeMode: els.operatorThreadSafeMode?.checked !== false,
        autoValidate: els.operatorThreadAutoValidate?.checked !== false,
        stub: els.operatorThreadRuntime?.value !== "real",
        by: "web-operator",
        source: "web-operator-chat",
      }),
    });
    state.selectedOperatorThreadId = payload.detail?.id || null;
    if (els.operatorThreadMessage) {
      els.operatorThreadMessage.value = "";
    }
    if (els.operatorThreadFeedback) {
      els.operatorThreadFeedback.textContent =
        "Thread started. The orchestrator created the first managed step.";
    }
    await refreshOperatorChat();
  } catch (error) {
    if (els.operatorThreadFeedback) {
      els.operatorThreadFeedback.textContent = error.message;
    }
  }
}

async function sendOperatorChatReply(messageOverride = null) {
  if (!state.selectedOperatorThreadId || !els.operatorChatInput) {
    return;
  }
  const message = String(messageOverride ?? els.operatorChatInput.value ?? "").trim();
  if (!message) {
    if (els.operatorChatFeedback) {
      els.operatorChatFeedback.textContent = "Type a reply first.";
    }
    return;
  }
  if (els.operatorChatFeedback) {
    els.operatorChatFeedback.textContent = "Sending to orchestrator...";
  }
  try {
    const submission = buildQuickReplySubmission(
      state.selectedOperatorThreadId,
      message,
    );
    const payload = await orchestratorJson(submission.path, {
      method: submission.method,
      body: JSON.stringify(submission.body),
    });
    state.operatorThreadDetail = payload.detail ?? null;
    state.operatorHighlightedActionId = null;
    state.operatorMissionFocusSource = "composer";
    if (els.operatorChatInput) {
      els.operatorChatInput.value = "";
    }
    if (els.operatorChatFeedback) {
      els.operatorChatFeedback.textContent =
        "Message delivered. The orchestrator updated the mission state.";
    }
    await Promise.all([loadOperatorThreads(), loadOperatorPendingInbox()]);
    renderOperatorInbox();
    renderOperatorThreads();
    renderOperatorChat();
  } catch (error) {
    if (els.operatorChatFeedback) {
      els.operatorChatFeedback.textContent = error.message;
    }
  }
}

async function resolveOperatorChatAction(actionId, choice) {
  if (els.operatorChatFeedback) {
    els.operatorChatFeedback.textContent = "Resolving operator action...";
  }
  try {
    const submission = buildInboxActionSubmission(actionId, choice);
    const payload = await orchestratorJson(submission.path, {
      method: submission.method,
      body: JSON.stringify(submission.body),
    });
    state.operatorThreadDetail = payload.detail ?? null;
    state.selectedOperatorThreadId =
      payload.detail?.id || state.selectedOperatorThreadId;
    state.operatorHighlightedActionId = null;
    state.operatorMissionFocusSource = "action";
    await Promise.all([loadOperatorThreads(), loadOperatorPendingInbox()]);
    renderOperatorInbox();
    renderOperatorThreads();
    renderOperatorChat();
    connectOperatorThreadEventStream();
    if (els.operatorChatFeedback) {
      els.operatorChatFeedback.textContent =
        "Decision recorded. The orchestrator continued the flow.";
    }
  } catch (error) {
    if (els.operatorChatFeedback) {
      els.operatorChatFeedback.textContent = error.message;
    }
  }
}

async function handleOperatorChatClick(event) {
  const target = event.target as HTMLElement | null;
  const actionButton = target?.closest(
    "[data-operator-action-id]",
  ) as HTMLElement | null;
  if (actionButton?.dataset.operatorActionId) {
    await resolveOperatorChatAction(
      actionButton.dataset.operatorActionId,
      actionButton.dataset.operatorActionChoice || "approve",
    );
    return;
  }

  const quickReplyButton = target?.closest(
    "[data-quick-reply]",
  ) as HTMLElement | null;
  if (quickReplyButton?.dataset.quickReply) {
    await sendOperatorChatReply(quickReplyButton.dataset.quickReply);
    return;
  }

  const missionFocusTarget = target?.closest(
    "[data-mission-focus][data-thread-id]",
  ) as HTMLElement | null;
  if (missionFocusTarget?.dataset.threadId) {
    const nextFocus = deriveMissionFocusState(
      {
        selectedThreadId: state.selectedOperatorThreadId,
        highlightedActionId: state.operatorHighlightedActionId,
        missionFocusSource: state.operatorMissionFocusSource,
      },
      {
        id: missionFocusTarget.dataset.actionId,
        threadId: missionFocusTarget.dataset.threadId,
      },
    );
    state.selectedOperatorThreadId = nextFocus.selectedThreadId;
    state.operatorHighlightedActionId = nextFocus.highlightedActionId;
    state.operatorMissionFocusSource = nextFocus.missionFocusSource;
    await loadOperatorThreadDetail();
    connectOperatorThreadEventStream();
    renderOperatorInbox();
    renderOperatorThreads();
    renderOperatorChat();
    return;
  }

  const threadCard = target?.closest("[data-thread-id]") as HTMLElement | null;
  if (threadCard?.dataset.threadId) {
    state.selectedOperatorThreadId = threadCard.dataset.threadId;
    state.operatorHighlightedActionId = null;
    state.operatorMissionFocusSource = "thread-list";
    await loadOperatorThreadDetail();
    connectOperatorThreadEventStream();
    renderOperatorInbox();
    renderOperatorThreads();
    renderOperatorChat();
    return;
  }

  const artifactButton = target?.closest(
    "[data-open-self-build='true']",
  ) as HTMLElement | null;
  if (artifactButton?.dataset.openType && artifactButton?.dataset.openId) {
    switchView("self-build");
    await refreshSelfBuildDashboard();
    await openSelfBuildDetail(
      artifactButton.dataset.openType,
      artifactButton.dataset.openId,
    );
  }
}

function renderSelfBuildDashboard() {
  if (!state.selfBuildSummary) {
    return;
  }

  const summary = state.selfBuildSummary;
  const urgentQueue = [
    ...(summary.urgentWork || []),
    ...(summary.autonomousIntake || []).filter(
      (entry) => entry.status === "accepted" || entry.priority === "high",
    ),
  ];
  const followUpQueue = [
    ...(summary.followUpWork || []),
    ...(summary.docSuggestionQueue || []),
    ...(summary.autonomousIntake || []).filter(
      (entry) => !(entry.status === "accepted" || entry.priority === "high"),
    ),
  ];

  renderSelfBuildOverview(summary);
  renderSelfBuildAttentionSummary(summary);
  renderGroupReadiness(summary.groups || []);
  renderWorkQueue(
    urgentQueue,
    els.urgentWorkQueue,
    els.urgentWorkCount,
    "urgent",
  );
  renderWorkQueue(
    followUpQueue,
    els.followUpQueue,
    els.followUpCount,
    "follow-up",
  );
  renderSelfBuildRecentRuns(summary.recentWorkItemRuns || []);
  renderSelfBuildWorkspaceHealth(
    summary.workspaces || [],
    summary.integrationBranches || [],
  );

  if (els.selfBuildFreshness && summary.freshness) {
    const lastRefresh =
      summary.freshness.lastRefresh || summary.overview?.generatedAt;
    els.selfBuildFreshness.textContent = `Last updated: ${formatDisplayTimestamp(lastRefresh)}`;
  }
  if (els.selfBuildDashboardState) {
    const attentionCount = summary.attentionSummary?.total ?? 0;
    const queueTotal = summary.queueSummary?.total ?? 0;
    const loopState = summary.loopStatus?.state || "idle";
    const loopDecision = summary.loopStatus?.lastDecision?.decision || "none";
    const lifecycle = normalizeSelfBuildLifecycleQueues(summary);
    els.selfBuildDashboardState.textContent = `route: ready · attention:${attentionCount} queue:${queueTotal} quarantines:${lifecycle.counts.quarantinedWork} · lifecycle:promotions:${lifecycle.counts.blockedPromotions} validations:${lifecycle.counts.pendingValidations} · loop:${loopState} · last:${loopDecision}`;
  }
}

function renderSelfBuildOverview(summary) {
  if (!els.selfBuildOverview) return;

  const overview = summary.overview || {};
  const counts = summary.counts || {};
  const lifecycle = normalizeSelfBuildLifecycleQueues(summary);
  const groups = Array.isArray(summary.groups) ? summary.groups : [];
  const groupStates = groups.reduce(
    (accumulator, group) => {
      const headline = group.readiness?.headlineState || "pending";
      accumulator[headline] = (accumulator[headline] ?? 0) + 1;
      accumulator.reviewNeeded += group.readiness?.counts?.reviewNeeded ?? 0;
      accumulator.advisoryWarnings +=
        group.readiness?.counts?.advisoryWarnings ?? 0;
      return accumulator;
    },
    {
      ready: 0,
      blocked: 0,
      failed: 0,
      running: 0,
      completed: 0,
      pending: 0,
      reviewNeeded: 0,
      advisoryWarnings: 0,
    },
  );

  const cards = [
    { label: "Total Work Items", value: counts.workItems || 0 },
    { label: "Groups", value: counts.groups || 0 },
    { label: "Goal Plans", value: counts.goalPlans || 0 },
    {
      label: "Ready Groups",
      value: groupStates.ready || 0,
      highlight: groupStates.ready > 0,
    },
    {
      label: "Blocked Groups",
      value: groupStates.blocked || 0,
      highlight: groupStates.blocked > 0,
    },
    {
      label: "Review Needed",
      value: groupStates.reviewNeeded || 0,
      highlight: groupStates.reviewNeeded > 0,
    },
    {
      label: "Urgent Items",
      value: overview.urgentCount || 0,
      highlight: overview.urgentCount > 0,
    },
    {
      label: "Failed Items",
      value: counts.failedItems || 0,
      highlight: counts.failedItems > 0,
    },
    {
      label: "Needs Validation",
      value: lifecycle.counts.pendingValidations,
      highlight: lifecycle.counts.pendingValidations > 0,
    },
    {
      label: "Promotion Blocked",
      value: lifecycle.counts.blockedPromotions,
      highlight: lifecycle.counts.blockedPromotions > 0,
    },
    {
      label: "Validation Required",
      value: counts.validationRequiredProposals || 0,
      highlight: (counts.validationRequiredProposals || 0) > 0,
    },
    {
      label: "Doc Suggestions",
      value: counts.pendingDocSuggestions || 0,
      highlight: (counts.pendingDocSuggestions || 0) > 0,
    },
    {
      label: "Autonomous Intake",
      value: counts.queuedAutonomousIntake || 0,
      highlight: (counts.queuedAutonomousIntake || 0) > 0,
    },
    {
      label: "Learning Trends",
      value:
        counts.repeatedLearningTrends || summary.learningTrends?.length || 0,
      highlight:
        (counts.repeatedLearningTrends || summary.learningTrends?.length || 0) >
        0,
    },
    {
      label: "Policy Recommendations",
      value: lifecycle.counts.policyRecommendationQueue,
      highlight: lifecycle.counts.policyRecommendationQueue > 0,
    },
    {
      label: "Recommendation Reviews",
      value: lifecycle.counts.policyRecommendationReviews,
      highlight: lifecycle.counts.policyRecommendationReviews > 0,
    },
    {
      label: "Workspace Problems",
      value: counts.orphanedWorkspaces || 0,
      highlight: (counts.orphanedWorkspaces || 0) > 0,
    },
    {
      label: "Integration Branches",
      value: counts.integrationBranches || 0,
      highlight: (counts.integrationBranches || 0) > 0,
    },
    {
      label: "Active Quarantines",
      value: lifecycle.counts.quarantinedWork,
      highlight: lifecycle.counts.quarantinedWork > 0,
    },
    {
      label: "Autonomy Blocked",
      value: counts.autonomousBlockedDecisions || 0,
      highlight: (counts.autonomousBlockedDecisions || 0) > 0,
    },
    {
      label: "Recent Rollbacks",
      value: counts.recentRollbacks || 0,
      highlight: (counts.recentRollbacks || 0) > 0,
    },
    {
      label: "Branch Issues",
      value: counts.integrationBranchIssues || 0,
      highlight: (counts.integrationBranchIssues || 0) > 0,
    },
    {
      label: "Protected Tier Overrides",
      value: lifecycle.counts.protectedTierOverrides,
      highlight: lifecycle.counts.protectedTierOverrides > 0,
    },
    {
      label: "Operator Overrides",
      value: lifecycle.counts.overrides,
      highlight: lifecycle.counts.overrides > 0,
    },
    { label: "Advisory Warnings", value: groupStates.advisoryWarnings || 0 },
  ];

  els.selfBuildOverview.innerHTML = cards
    .map(
      (card) => `
      <div class="overview-card ${card.highlight ? "highlight" : ""}">
        <span class="label">${escapeHtml(card.label)}</span>
        <span class="value">${escapeHtml(String(card.value))}</span>
      </div>
    `,
    )
    .join("");
}

function renderSelfBuildAttentionSummary(summary: AnyRecord) {
  if (!els.selfBuildAttentionSummary) return;
  const attention = summary.attentionSummary || {};
  const loopStatus = summary.loopStatus || {};
  const byState = attention.byState || {};
  const lifecycleQueues = normalizeSelfBuildLifecycleQueues(summary);
  const entries = Object.entries(byState) as Array<[string, number]>;
  if (els.selfBuildAttentionCount) {
    els.selfBuildAttentionCount.textContent = `${attention.total || 0} ${attention.total === 1 ? "item" : "items"}`;
  }
  const cards =
    entries.length === 0
      ? [
          `
      <div class="overview-card"><span class="label">Attention</span><span class="value">0</span></div>
    `,
        ]
      : entries
          .sort((left, right) => left[0].localeCompare(right[0]))
          .map(
            ([key, value]) => `
      <div class="overview-card ${value > 0 ? "highlight" : ""}">
        <span class="label">${escapeHtml(humanizeKey(key))}</span>
        <span class="value">${escapeHtml(String(value))}</span>
      </div>
    `,
          );
  cards.push(`
      <div class="overview-card ${loopStatus.state === "running" ? "highlight" : ""}">
        <span class="label">Loop</span>
        <span class="value">${escapeHtml(String(loopStatus.state || "idle"))}</span>
      </div>
    `);
  cards.push(`
      <div class="overview-card ${lifecycleQueues.counts.blockedPromotions > 0 ? "highlight" : ""}">
        <span class="label">Blocked Promotions</span>
        <span class="value">${escapeHtml(String(lifecycleQueues.counts.blockedPromotions))}</span>
      </div>
    `);
  cards.push(`
      <div class="overview-card ${lifecycleQueues.counts.pendingValidations > 0 ? "highlight" : ""}">
        <span class="label">Pending Validations</span>
        <span class="value">${escapeHtml(String(lifecycleQueues.counts.pendingValidations))}</span>
      </div>
    `);
  cards.push(`
      <div class="overview-card ${lifecycleQueues.counts.activeAutonomousRuns > 0 ? "highlight" : ""}">
        <span class="label">Active Autonomous Runs</span>
        <span class="value">${escapeHtml(String(lifecycleQueues.counts.activeAutonomousRuns))}</span>
      </div>
    `);
  cards.push(`
      <div class="overview-card ${lifecycleQueues.counts.quarantinedWork > 0 ? "highlight" : ""}">
        <span class="label">Quarantined Work</span>
        <span class="value">${escapeHtml(String(lifecycleQueues.counts.quarantinedWork))}</span>
      </div>
    `);
  cards.push(`
      <div class="overview-card ${lifecycleQueues.counts.protectedTierOverrides > 0 ? "highlight" : ""}">
        <span class="label">Protected Tier Overrides</span>
        <span class="value">${escapeHtml(String(lifecycleQueues.counts.protectedTierOverrides))}</span>
      </div>
    `);
  cards.push(`
      <div class="overview-card ${lifecycleQueues.counts.policyRecommendationQueue > 0 ? "highlight" : ""}">
        <span class="label">Recommendation Queue</span>
        <span class="value">${escapeHtml(String(lifecycleQueues.counts.policyRecommendationQueue))}</span>
      </div>
    `);
  cards.push(`
      <div class="overview-card ${lifecycleQueues.counts.overrides > 0 ? "highlight" : ""}">
        <span class="label">Overrides</span>
        <span class="value">${escapeHtml(String(lifecycleQueues.counts.overrides))}</span>
      </div>
    `);
  cards.push(`
      <div class="overview-card ${lifecycleQueues.counts.policyRecommendationReviews > 0 ? "highlight" : ""}">
        <span class="label">Recommendation Reviews</span>
        <span class="value">${escapeHtml(String(lifecycleQueues.counts.policyRecommendationReviews))}</span>
      </div>
    `);
  cards.push(`
      <div class="overview-card ${(summary.counts?.autonomousBlockedDecisions || 0) > 0 ? "highlight" : ""}">
        <span class="label">Autonomy Blocked</span>
        <span class="value">${escapeHtml(String(summary.counts?.autonomousBlockedDecisions || 0))}</span>
      </div>
    `);
  cards.push(`
      <div class="overview-card ${(summary.rolloutTierSummary?.matchedCount || 0) > 0 ? "highlight" : ""}">
        <span class="label">Rollout Tiers</span>
        <span class="value">${escapeHtml(String(summary.rolloutTierSummary?.matchedCount || 0))}</span>
      </div>
    `);
  cards.push(`
    <div class="detail-card compact-empty">
      ${renderSelfBuildOperatorForm({
        endpoint: "/api/orchestrator/self-build/loop/start",
        label: "Start Self-Build Loop",
        help: "Run one autonomous self-build iteration under current policy.",
        fields: [
          {
            type: "checkbox",
            name: "stub",
            label: "Use stub runtime",
            checked: true,
          },
        ],
      })}
      ${renderSelfBuildOperatorForm({
        endpoint: "/api/orchestrator/self-build/loop/stop",
        label: "Stop Self-Build Loop",
        help: "Persist a stop decision for the autonomous loop.",
        fields: [
          {
            type: "text",
            name: "reason",
            label: "Reason",
            placeholder: "Optional stop rationale",
          },
        ],
      })}
    </div>
  `);
  cards.push(renderSelfBuildLifecycleSection(summary, lifecycleQueues));
  els.selfBuildAttentionSummary.innerHTML = cards.join("");
}

function resolveSelfBuildEntryType(item: AnyRecord = {}) {
  if (item.itemType) return item.itemType;
  if (
    item.targetType === "policy-recommendation" ||
    item.targetType === "self-build-policy-recommendation"
  ) {
    return "policy-recommendation";
  }
  if (
    item.targetType === "protected-override" ||
    item.targetType === "self-build-override"
  ) {
    return "protected-override";
  }
  if (item.kind === "quarantine" || hasDisplayValue(item.links?.release)) {
    return "protected-override";
  }
  if (item.targetType === "doc-suggestion") return "doc-suggestion";
  if (item.targetType === "self-build-intake") return "self-build-intake";
  if (
    hasDisplayValue(item.reviewStatus) &&
    (hasDisplayValue(item.materializedTemplateId) ||
      hasDisplayValue(item.recommendationId) ||
      hasDisplayValue(item.policyArea))
  ) {
    return "policy-recommendation";
  }
  if (
    hasDisplayValue(item.overrideScope) ||
    hasDisplayValue(item.overrideTargetType) ||
    hasDisplayValue(item.protectedScope) ||
    hasDisplayValue(item.overrideRequestedAt)
  ) {
    return "protected-override";
  }
  if (item.targetType) return item.targetType;
  if (item.branchName || item.name?.startsWith?.("spore/integration/"))
    return "integration-branch";
  if (item.goalPlanId) return "goal-plan";
  if (item.workspaceId) return "workspace";
  if (item.runId) return "work-item-run";
  if (item.proposalId) return "proposal";
  if (item.groupId) return "work-item-group";
  return "work-item";
}

function resolveSelfBuildEntryId(item: AnyRecord = {}) {
  return (
    item.recommendationId ||
    item.overrideId ||
    item.name ||
    item.id ||
    item.targetId ||
    item.goalPlanId ||
    item.itemId ||
    item.workItemId ||
    item.groupId ||
    item.runId ||
    item.workspaceId ||
    item.proposalId ||
    ""
  );
}

function collectSelfBuildRouteArrays(
  payload: AnyRecord = {},
  keys: string[] = [],
): AnyRecord[] {
  const merged = [];
  const seen = new Set();
  for (const key of keys) {
    const entries = Array.isArray(payload?.[key]) ? payload[key] : [];
    for (const entry of entries) {
      const dedupeKey =
        resolveSelfBuildEntryId(entry) ||
        `${key}:${JSON.stringify(entry ?? null)}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      merged.push(entry);
    }
  }
  return merged;
}

function normalizeSelfBuildLifecycleQueues(summary: AnyRecord = {}) {
  const lifecycle = readFirstObjectField(summary, ["lifecycle"]) || {};
  const recommendationQueue = collectSelfBuildRouteArrays(summary, [
    "policyRecommendationQueue",
    "policyRecommendations",
    "recommendations",
  ]);
  const protectedOverrideQueue = collectSelfBuildRouteArrays(summary, [
    "activeOverrides",
    "protectedTierOverrides",
    "protectedOverrides",
    "overrides",
    "protectedScopeBlocks",
  ]).filter((item) => {
    const status = normalizeText(
      readFirstField(item, [
        "status",
        "state",
        "overrideStatus",
        "decisionStatus",
      ]),
      "active",
    ).toLowerCase();
    return !["released", "resolved", "dismissed", "inactive"].includes(status);
  });
  const validationQueue = collectSelfBuildRouteArrays(summary, [
    "lifecycleValidationQueue",
    "validationRequiredProposals",
    "pendingValidations",
  ]);
  const promotionBlockQueue = collectSelfBuildRouteArrays(summary, [
    "lifecycleBlockedPromotions",
    "proposalsBlockedForPromotion",
    "blockedPromotions",
  ]);
  const quarantineQueue = collectSelfBuildRouteArrays(summary, [
    "activeQuarantines",
    "quarantines",
  ]).filter((item) => {
    const status = normalizeText(
      readFirstField(item, ["status", "state"]),
      "active",
    ).toLowerCase();
    return !["released", "resolved", "inactive"].includes(status);
  });
  const activeAutonomousRuns = collectSelfBuildRouteArrays(summary, [
    "activeAutonomousRuns",
    "autonomousRuns",
    "runningAutonomousRuns",
  ]).filter((item) => {
    const status = normalizeText(
      readFirstField(item, ["status", "state"]),
      "running",
    ).toLowerCase();
    return !["completed", "failed", "stopped", "canceled", "rejected"].includes(
      status,
    );
  });
  const explicitRecommendationReviews = collectSelfBuildRouteArrays(summary, [
    "policyRecommendationReviews",
  ]);

  const recommendationReviewQueue =
    explicitRecommendationReviews.length > 0
      ? explicitRecommendationReviews
      : recommendationQueue.filter((item) => {
          const reviewStatus = normalizeText(
            readFirstField(item, [
              "reviewStatus",
              "status",
              "state",
              "decisionStatus",
              "recommendationStatus",
            ]),
            "pending",
          ).toLowerCase();
          return ![
            "accepted",
            "implemented",
            "materialized",
            "dismissed",
            "rejected",
          ].includes(reviewStatus);
        });

  const counts = {
    blockedPromotions:
      coerceCount(lifecycle.blockedPromotions) ?? promotionBlockQueue.length,
    pendingValidations:
      coerceCount(lifecycle.pendingValidations) ?? validationQueue.length,
    activeAutonomousRuns:
      coerceCount(lifecycle.activeAutonomousRuns) ??
      activeAutonomousRuns.length,
    quarantinedWork:
      coerceCount(lifecycle.quarantinedWork) ?? quarantineQueue.length,
    protectedTierOverrides:
      coerceCount(lifecycle.protectedTierOverrides) ??
      protectedOverrideQueue.length,
    policyRecommendationQueue:
      coerceCount(lifecycle.policyRecommendationQueue) ??
      recommendationQueue.length,
    overrides: coerceCount(summary.overrides) ?? 0,
    policyRecommendationReviews:
      coerceCount(summary.policyRecommendationReviews) ??
      recommendationReviewQueue.length,
  };

  return {
    recommendationReviewQueue,
    protectedOverrideQueue,
    validationQueue,
    promotionBlockQueue,
    quarantineQueue,
    activeAutonomousRuns,
    recommendationQueue,
    counts,
  };
}

function resolveSelfBuildLifecycleTitle(
  item: AnyRecord = {},
  fallbackType: string,
) {
  const recommendation = readFirstObjectField(item, ["recommendation"]) || {};
  return normalizeText(
    readFirstField(item, [
      "title",
      "label",
      "name",
      "summary",
      "goal",
      "id",
      "targetId",
      "recommendationId",
      "overrideId",
    ]) ?? readFirstField(recommendation, ["summary", "goal", "id"]),
    `${fallbackType}-${resolveSelfBuildEntryId(item) || "item"}`,
  );
}

function resolveSelfBuildLifecycleSubtitle(item: AnyRecord = {}) {
  const recommendation = readFirstObjectField(item, ["recommendation"]) || {};
  const blockedScopes = normalizeRouteArray(item, ["blockedScopes"]);
  const fallback =
    blockedScopes.length > 0
      ? `Blocked scopes: ${blockedScopes.join(", ")}`
      : "";
  return normalizeText(
    readFirstField(item, [
      "reason",
      "detail",
      "summary",
      "message",
      "goal",
      "status",
      "reviewStatus",
    ]) ?? readFirstField(recommendation, ["reason", "summary", "goal"]),
    fallback,
  );
}

function resolveSelfBuildLifecycleStatus(item: AnyRecord = {}) {
  const recommendation = readFirstObjectField(item, ["recommendation"]) || {};
  return normalizeText(
    readFirstField(item, [
      "queueStatus",
      "reviewStatus",
      "status",
      "state",
      "decisionStatus",
    ]) ?? readFirstField(recommendation, ["status", "priority", "severity"]),
    "open",
  );
}

function resolveSelfBuildLifecycleMetaBits(item: AnyRecord = {}) {
  const recommendation = readFirstObjectField(item, ["recommendation"]) || {};
  return Array.from(
    new Set(
      [
        readFirstField(item, ["priority", "severity", "overrideKind"]),
        readFirstField(item, ["overrideScope", "protectedScope", "scope"]),
        readFirstField(item, ["policyArea", "targetType", "kind"]),
        readFirstField(recommendation, [
          "priority",
          "severity",
          "sourceType",
          "autonomyImpact",
          "kind",
        ]),
      ]
        .filter((value) => hasDisplayValue(value))
        .map((value) => String(value)),
    ),
  );
}

function renderSelfBuildLifecycleList(
  title: string,
  items: AnyRecord[] = [],
  fallbackType: string,
  emptyMessage: string,
  totalCount = items.length,
  options: AnyRecord = {},
) {
  return `
    <article class="detail-card compact-empty">
      <div class="detail-section-heading">
        <h3>${escapeHtml(title)}</h3>
        <p class="detail-support">${escapeHtml(`${totalCount} ${totalCount === 1 ? "item" : "items"}`)}</p>
      </div>
      ${
        items.length === 0
          ? `<p>${escapeHtml(totalCount > 0 ? `${emptyMessage} Dashboard supplied counts without item-level detail in this payload.` : emptyMessage)}</p>`
          : items
              .slice(0, 5)
              .map((item) => {
                const itemType = options.forceType
                  ? fallbackType
                  : resolveSelfBuildEntryType(item) || fallbackType;
                const itemId = resolveSelfBuildEntryId(item);
                const titleText = resolveSelfBuildLifecycleTitle(
                  item,
                  fallbackType,
                );
                const subtitle = resolveSelfBuildLifecycleSubtitle(item);
                const status = resolveSelfBuildLifecycleStatus(item);
                const metaBits = resolveSelfBuildLifecycleMetaBits(item);
                const openAttrs = itemId
                  ? `data-open-type="${escapeHtml(itemType)}" data-open-id="${escapeHtml(itemId)}"`
                  : "";
                return `
                  <div class="work-item-row" ${openAttrs}>
                    <div class="work-item-status ${stateClass(status)}"></div>
                    <div class="work-item-info">
                      <div class="work-item-title">${escapeHtml(titleText)}</div>
                      <div class="work-item-meta">${escapeHtml(metaBits.join(" • ") || status)}</div>
                      ${
                        subtitle
                          ? `<div class="work-item-reason">${escapeHtml(subtitle)}</div>`
                          : ""
                      }
                    </div>
                    <span class="work-item-badge follow-up">${escapeHtml(status)}</span>
                    <span class="work-item-arrow">→</span>
                  </div>
                `;
              })
              .join("")
      }
    </article>
  `;
}

function renderSelfBuildLifecycleSection(
  summary: AnyRecord = {},
  lifecycle = normalizeSelfBuildLifecycleQueues(summary),
) {
  const trackedTotal =
    lifecycle.counts.blockedPromotions +
    lifecycle.counts.pendingValidations +
    lifecycle.counts.activeAutonomousRuns +
    lifecycle.counts.quarantinedWork +
    lifecycle.counts.policyRecommendationQueue +
    lifecycle.counts.protectedTierOverrides;
  const blockedTotal =
    lifecycle.counts.blockedPromotions +
    lifecycle.counts.pendingValidations +
    lifecycle.counts.quarantinedWork +
    lifecycle.counts.protectedTierOverrides;
  const refreshText = summary.freshness?.lastRefresh
    ? `Updated ${formatDisplayTimestamp(summary.freshness.lastRefresh)}`
    : "Freshness metadata unavailable.";
  const cards = [
    {
      label: "Blocked Promotions",
      value: lifecycle.counts.blockedPromotions,
      highlight: lifecycle.counts.blockedPromotions > 0,
    },
    {
      label: "Pending Validations",
      value: lifecycle.counts.pendingValidations,
      highlight: lifecycle.counts.pendingValidations > 0,
    },
    {
      label: "Active Autonomous Runs",
      value: lifecycle.counts.activeAutonomousRuns,
      highlight: lifecycle.counts.activeAutonomousRuns > 0,
    },
    {
      label: "Quarantined Work",
      value: lifecycle.counts.quarantinedWork,
      highlight: lifecycle.counts.quarantinedWork > 0,
    },
    {
      label: "Recommendation Queue",
      value: lifecycle.counts.policyRecommendationQueue,
      highlight: lifecycle.counts.policyRecommendationQueue > 0,
    },
    {
      label: "Recommendation Reviews",
      value: lifecycle.counts.policyRecommendationReviews,
      highlight: lifecycle.counts.policyRecommendationReviews > 0,
    },
    {
      label: "Active Overrides",
      value: lifecycle.counts.protectedTierOverrides,
      highlight: lifecycle.counts.protectedTierOverrides > 0,
    },
  ];

  return `
    <section class="detail-section">
      <div class="detail-section-heading">
        <h3>Lifecycle Dashboard</h3>
        <p class="detail-support">Blocked promotions, pending validations, active autonomous runs, quarantined work, recommendations, and protected overrides in one operator view.</p>
      </div>
      <article class="detail-card compact-empty">
        <div class="lineage-meta">
          ${renderLineagePill("tracked", trackedTotal, trackedTotal > 0 ? "changed" : "inherited")}
          ${renderLineagePill("blocked", blockedTotal, blockedTotal > 0 ? "changed" : "inherited")}
          ${renderLineagePill("recommendations", lifecycle.counts.policyRecommendationQueue, lifecycle.counts.policyRecommendationQueue > 0 ? "dependency-advisory" : "inherited")}
          ${renderLineagePill("review-queue", lifecycle.counts.policyRecommendationReviews, lifecycle.counts.policyRecommendationReviews > 0 ? "changed" : "inherited")}
          ${renderLineagePill("loop", summary.loopStatus?.state || "idle", summary.loopStatus?.state === "running" ? "root" : "inherited")}
        </div>
        <p class="decision-summary">${escapeHtml(`${refreshText} ${lifecycle.counts.activeAutonomousRuns > 0 ? "Autonomous work is active." : "No autonomous runs are active."} ${lifecycle.counts.quarantinedWork > 0 ? `${lifecycle.counts.quarantinedWork} quarantine ${lifecycle.counts.quarantinedWork === 1 ? "record is" : "records are"} blocking rollout.` : "No active quarantines."}`)}</p>
      </article>
      <div class="readiness-stat-grid">
        ${cards
          .map(
            (card) => `
              <article class="readiness-stat ${card.highlight ? "blocked" : "neutral"}">
                <span class="label">${escapeHtml(card.label)}</span>
                <span class="value">${escapeHtml(String(card.value))}</span>
              </article>
            `,
          )
          .join("")}
      </div>
      <div class="event-list suggested-actions-list">
        ${renderSelfBuildLifecycleList(
          "Blocked Promotions",
          lifecycle.promotionBlockQueue,
          "proposal",
          "No proposals are currently blocked for promotion.",
          lifecycle.counts.blockedPromotions,
        )}
        ${renderSelfBuildLifecycleList(
          "Pending Validations",
          lifecycle.validationQueue,
          "proposal",
          "No validation-required proposals in the current scope.",
          lifecycle.counts.pendingValidations,
        )}
        ${renderSelfBuildLifecycleList(
          "Policy Recommendations",
          lifecycle.recommendationQueue,
          "policy-recommendation",
          "No policy recommendations in the current scope.",
          lifecycle.counts.policyRecommendationQueue,
          { forceType: true },
        )}
        ${renderSelfBuildLifecycleList(
          "Recommendation Reviews",
          lifecycle.recommendationReviewQueue,
          "policy-recommendation",
          "No policy recommendations awaiting review.",
          lifecycle.counts.policyRecommendationReviews,
          { forceType: true },
        )}
        ${renderSelfBuildLifecycleList(
          "Active Overrides",
          lifecycle.protectedOverrideQueue,
          "protected-override",
          "No protected-tier overrides or protected-scope blockers in the current scope.",
          lifecycle.counts.protectedTierOverrides,
          { forceType: true },
        )}
        ${renderSelfBuildLifecycleList(
          "Quarantined Work",
          lifecycle.quarantineQueue,
          "goal-plan",
          "No quarantined self-build work in the current scope.",
          lifecycle.counts.quarantinedWork,
        )}
        ${renderSelfBuildLifecycleList(
          "Active Autonomous Runs",
          lifecycle.activeAutonomousRuns,
          "work-item-group",
          "No autonomous runs are active right now.",
          lifecycle.counts.activeAutonomousRuns,
        )}
      </div>
    </section>
  `;
}

function findSelfBuildLocalDetail(itemType: string, itemId: string) {
  const summary = state.selfBuildSummary ?? {};
  const pools =
    itemType === "policy-recommendation"
      ? [
          ...collectSelfBuildRouteArrays(summary, [
            "policyRecommendationReviews",
            "recommendationReviews",
          ]),
          ...collectSelfBuildRouteArrays(summary, [
            "policyRecommendationQueue",
            "policyRecommendations",
            "recommendations",
          ]),
        ]
      : itemType === "protected-override"
        ? [
            ...collectSelfBuildRouteArrays(summary, [
              "activeOverrides",
              "protectedTierOverrides",
              "protectedOverrides",
              "overrides",
              "protectedScopeBlocks",
              "activeQuarantines",
              "quarantines",
            ]),
          ]
        : [];
  return (
    pools.find((entry) => resolveSelfBuildEntryId(entry) === itemId) ?? null
  );
}

function normalizeOperatorEndpoint(value) {
  const endpoint = normalizeText(value, "");
  if (!endpoint) {
    return "";
  }
  if (endpoint.startsWith("/api/orchestrator")) {
    return endpoint;
  }
  if (endpoint.startsWith("/")) {
    return `/api/orchestrator${endpoint}`;
  }
  return endpoint;
}

function resolveLocalActionConfig(
  detail: AnyRecord = {},
  actionKey: string | string[],
): AnyRecord | null {
  const actions = isObject(detail.actions) ? detail.actions : {};
  const links = isObject(detail.links) ? detail.links : {};
  const keys = Array.isArray(actionKey) ? actionKey : [actionKey];
  let candidate = null;
  for (const key of keys) {
    candidate =
      actions[key] ?? detail[`${key}Action`] ?? links[key] ?? candidate ?? null;
    if (candidate) {
      break;
    }
  }

  if (typeof candidate === "string") {
    const endpoint = normalizeOperatorEndpoint(candidate);
    return endpoint ? { endpoint } : null;
  }
  if (isObject(candidate)) {
    const endpoint = normalizeOperatorEndpoint(
      readFirstField(candidate, [
        "endpoint",
        "route",
        "path",
        "href",
        "url",
        "httpHint",
      ]),
    );
    return endpoint
      ? {
          endpoint,
          method: normalizeText(readFirstField(candidate, ["method"]), "POST"),
          label: readFirstField(candidate, ["label", "title"]),
          help: readFirstField(candidate, ["help", "description"]),
          fields: Array.isArray(candidate.fields) ? candidate.fields : null,
          hidden: isObject(candidate.hidden) ? candidate.hidden : null,
        }
      : null;
  }

  const endpoint = normalizeOperatorEndpoint(
    readFirstField(detail, [
      ...keys.flatMap((key) => [`${key}Endpoint`, `${key}Route`, `${key}Path`]),
    ]),
  );
  return endpoint ? { endpoint } : null;
}

function renderLocalActionForm(config: AnyRecord = {}) {
  const action = resolveLocalActionConfig(config.detail, config.actionKey);
  if (!action?.endpoint) {
    return "";
  }
  return renderSelfBuildOperatorForm({
    endpoint: action.endpoint,
    method: action.method || config.method || "POST",
    refreshType: config.refreshType,
    refreshId: config.refreshId,
    label: action.label || config.label,
    help: action.help || config.help,
    hidden: action.hidden || config.hidden,
    fields:
      Array.isArray(action.fields) && action.fields.length > 0
        ? action.fields
        : config.fields,
  });
}

function renderSelfBuildLocalTarget(detail: AnyRecord = {}) {
  const target = resolveSelfBuildDetailTarget(detail);
  if (!target) {
    return "";
  }
  return `
    <div class="lineage-meta">
      ${renderSelfBuildDetailLink(target.itemType, target.itemId, `Open ${humanizeKey(target.itemType)}`)}
    </div>
  `;
}

function _dependencyTone(value) {
  const state = String(value || "pending").toLowerCase();
  if (["ready", "completed"].includes(state)) return "root";
  if (["blocked", "review_needed", "failed"].includes(state)) return "changed";
  if (state === "advisory") return "dependency-advisory";
  return "inherited";
}

function renderLineagePill(label, value, tone = "") {
  const classes = ["lineage-pill"];
  if (tone) classes.push(tone);
  return `<span class="${classes.join(" ")}">${escapeHtml(value ? `${label}:${value}` : label)}</span>`;
}

function renderStatusBadge(value, extraClass = "") {
  const classes = ["status-badge", stateClass(value)];
  if (extraClass) classes.push(extraClass);
  return `<span class="${classes.join(" ")}">${escapeHtml(normalizeText(value))}</span>`;
}

function groupReadinessPriority(group: AnyRecord = {}) {
  const headline = group.readiness?.headlineState || "pending";
  const order = {
    failed: 0,
    blocked: 1,
    running: 2,
    ready: 3,
    completed: 4,
    pending: 5,
  };
  return order[headline] ?? 6;
}

function renderGroupReadiness(groups = []) {
  if (!els.groupReadinessOverview || !els.groupReadinessList) return;

  if (els.groupReadinessCount) {
    els.groupReadinessCount.textContent = `${groups.length} ${groups.length === 1 ? "group" : "groups"}`;
  }

  if (groups.length === 0) {
    els.groupReadinessOverview.innerHTML = `
      <div class="readiness-stat muted-card">
        <span class="label">No groups</span>
        <span class="value">0</span>
      </div>
    `;
    els.groupReadinessList.innerHTML =
      '<div class="empty-work-queue">Materialize a goal plan to inspect dependency readiness.</div>';
    return;
  }

  const readinessTotals = groups.reduce(
    (accumulator, group) => {
      const counts = group.readiness?.counts || {};
      accumulator.ready += counts.ready || 0;
      accumulator.blocked += counts.blocked || 0;
      accumulator.reviewNeeded += counts.reviewNeeded || 0;
      accumulator.running += counts.running || 0;
      accumulator.completed += counts.completed || 0;
      return accumulator;
    },
    { ready: 0, blocked: 0, reviewNeeded: 0, running: 0, completed: 0 },
  );

  els.groupReadinessOverview.innerHTML = [
    {
      label: "Ready Items",
      value: readinessTotals.ready,
      tone: readinessTotals.ready > 0 ? "ready" : "neutral",
    },
    {
      label: "Blocked Items",
      value: readinessTotals.blocked,
      tone: readinessTotals.blocked > 0 ? "blocked" : "neutral",
    },
    {
      label: "Review Needed",
      value: readinessTotals.reviewNeeded,
      tone: readinessTotals.reviewNeeded > 0 ? "review" : "neutral",
    },
    {
      label: "Completed",
      value: readinessTotals.completed,
      tone: readinessTotals.completed > 0 ? "completed" : "neutral",
    },
  ]
    .map(
      (card) => `
        <article class="readiness-stat ${card.tone}">
          <span class="label">${escapeHtml(card.label)}</span>
          <span class="value">${escapeHtml(String(card.value))}</span>
        </article>
      `,
    )
    .join("");

  const sortedGroups = [...groups].sort((left, right) => {
    const priorityDelta =
      groupReadinessPriority(left) - groupReadinessPriority(right);
    if (priorityDelta !== 0) return priorityDelta;
    return String(left.title || left.id).localeCompare(
      String(right.title || right.id),
    );
  });

  els.groupReadinessList.innerHTML = sortedGroups
    .map((group) => {
      const readiness = group.readiness || {};
      const counts = readiness.counts || {};
      return `
        <article class="group-readiness-row" data-open-type="work-item-group" data-open-id="${escapeHtml(group.id)}">
          <div class="group-readiness-main">
            <div class="group-readiness-title-row">
              <strong>${escapeHtml(group.title || group.id)}</strong>
              ${renderStatusBadge(readiness.headlineState || group.status || "pending")}
            </div>
            <p class="group-readiness-summary">${escapeHtml(readiness.preRunSummary?.label || "No dependency summary available yet.")}</p>
            <div class="lineage-meta">
              ${renderLineagePill("ready", counts.ready ?? 0, "root")}
              ${renderLineagePill("blocked", counts.blocked ?? 0, counts.blocked ? "changed" : "")}
              ${renderLineagePill("review", counts.reviewNeeded ?? 0, counts.reviewNeeded ? "changed" : "")}
              ${renderLineagePill("edges", group.dependencyGraph?.edges?.length ?? 0, "inherited")}
            </div>
          </div>
          <div class="group-readiness-side">
            <span class="muted">Next</span>
            <p>${escapeHtml(readiness.nextActionHint || "Open the group to inspect dependency details.")}</p>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderWorkQueue(items, container, countElement, queueType) {
  if (!container) return;

  if (countElement) {
    countElement.textContent = `${items.length} ${items.length === 1 ? "item" : "items"}`;
  }

  if (items.length === 0) {
    const emptyClass = queueType === "urgent" ? "quiet" : "";
    const emptyMessage =
      queueType === "urgent"
        ? "No urgent work requiring immediate attention."
        : "No follow-up items at this time.";
    container.innerHTML = `<div class="empty-work-queue ${emptyClass}">${emptyMessage}</div>`;
    return;
  }

  container.innerHTML = items
    .map((item) => {
      const itemType = resolveSelfBuildEntryType(item);
      const itemId = resolveSelfBuildEntryId(item);
      const title = item.title || item.label || item.name || itemId;
      const status = item.status || item.state || "unknown";
      const meta = [];
      const reason =
        item.reason || item.blockedReason || item.nextActionHint || "";
      if (item.kind) meta.push(item.kind);
      if (item.priority) meta.push(`priority:${item.priority}`);
      if (item.blockerIds?.[0]) meta.push(`blocker:${item.blockerIds[0]}`);
      if (item.lastRunAt)
        meta.push(`last run:${formatDisplayTimestamp(item.lastRunAt)}`);

      return `
        <div class="work-item-row" data-open-type="${escapeHtml(itemType)}" data-open-id="${escapeHtml(itemId)}">
          <div class="work-item-status ${stateClass(status)}"></div>
          <div class="work-item-info">
            <div class="work-item-title">${escapeHtml(title)}</div>
            <div class="work-item-meta">${escapeHtml(meta.join(" • "))}</div>
            ${reason ? `<div class="work-item-reason">${escapeHtml(reason)}</div>` : ""}
          </div>
          <span class="work-item-badge ${queueType}">${escapeHtml(item.attentionState || status)}</span>
          <span class="work-item-arrow">→</span>
        </div>
      `;
    })
    .join("");
}

function renderSelfBuildRecentRuns(runs = []) {
  if (!els.selfBuildRecentRuns) return;
  if (els.selfBuildRecentRunsCount) {
    els.selfBuildRecentRunsCount.textContent = `${runs.length} ${runs.length === 1 ? "run" : "runs"}`;
  }
  if (runs.length === 0) {
    els.selfBuildRecentRuns.innerHTML =
      '<div class="empty-work-queue">No recent work-item runs in the current dashboard scope.</div>';
    return;
  }
  els.selfBuildRecentRuns.innerHTML = runs
    .map(
      (run) => `
      <div class="work-item-row" data-open-type="work-item-run" data-open-id="${escapeHtml(run.id)}">
        <div class="work-item-status ${stateClass(run.terminalKind || run.status)}"></div>
        <div class="work-item-info">
          <div class="work-item-title">${escapeHtml(run.itemTitle || run.id)}</div>
          <div class="work-item-meta">${escapeHtml([run.itemKind || "work-item", `validation:${run.validationStatus || "-"}`, run.hasProposal ? "proposal" : "", run.hasWorkspace ? "workspace" : ""].filter(Boolean).join(" • "))}</div>
          <div class="work-item-reason">${escapeHtml(run.comparisonToPrevious?.summary || "Open run detail for proposal, validation, and doc suggestion drilldown.")}</div>
        </div>
        <span class="work-item-badge follow-up">${escapeHtml(run.status || run.terminalKind || "unknown")}</span>
        <span class="work-item-arrow">→</span>
      </div>
    `,
    )
    .join("");
}

function renderSelfBuildWorkspaceHealth(
  workspaces = [],
  integrationBranches = [],
) {
  if (!els.selfBuildWorkspaceHealth) return;
  if (els.selfBuildWorkspaceCount) {
    const total = workspaces.length + integrationBranches.length;
    els.selfBuildWorkspaceCount.textContent = `${total} ${total === 1 ? "resource" : "resources"}`;
  }
  if (workspaces.length === 0 && integrationBranches.length === 0) {
    els.selfBuildWorkspaceHealth.innerHTML =
      '<div class="empty-work-queue quiet">No workspace allocations in the current dashboard scope.</div>';
    return;
  }
  els.selfBuildWorkspaceHealth.innerHTML = [
    ...workspaces.slice(0, 12).map(
      (workspace) => `
      <div class="work-item-row" data-open-type="workspace" data-open-id="${escapeHtml(workspace.id)}">
        <div class="work-item-status ${stateClass(workspace.status)}"></div>
        <div class="work-item-info">
          <div class="work-item-title">${escapeHtml(workspace.branchName || workspace.id)}</div>
          <div class="work-item-meta">${escapeHtml([workspace.status || "unknown", workspace.workItemId ? `item:${workspace.workItemId}` : "", workspace.safeMode === true ? "safe-mode" : ""].filter(Boolean).join(" • "))}</div>
          <div class="work-item-reason">${escapeHtml(workspace.worktreePath || "No worktree path available.")}</div>
        </div>
        <span class="work-item-badge ${["orphaned", "failed"].includes(workspace.status) ? "urgent" : "follow-up"}">${escapeHtml(workspace.status || "unknown")}</span>
        <span class="work-item-arrow">→</span>
      </div>
    `,
    ),
    ...integrationBranches.slice(0, 8).map(
      (branch) => `
      <div class="work-item-row" data-open-type="integration-branch" data-open-id="${escapeHtml(branch.name)}">
        <div class="work-item-status ${stateClass(branch.status)}"></div>
          <div class="work-item-info">
            <div class="work-item-title">${escapeHtml(branch.name)}</div>
            <div class="work-item-meta">${escapeHtml([branch.status || "unknown", branch.targetBranch ? `target:${branch.targetBranch}` : "", branch.proposalId ? `proposal:${branch.proposalId}` : ""].filter(Boolean).join(" • "))}</div>
          <div class="work-item-reason">${escapeHtml(
            (branch.diagnostics?.issues || [])
              .slice(0, 2)
              .map((issue) => issue.reason)
              .filter(Boolean)
              .join(" • ") ||
              branch.reason ||
              "Integration branch state for self-build promotion.",
          )}</div>
        </div>
        <span class="work-item-badge ${["blocked", "quarantined", "integration_failed"].includes(branch.status) ? "urgent" : "follow-up"}">${escapeHtml(branch.status || "unknown")}</span>
        <span class="work-item-arrow">→</span>
      </div>
    `,
    ),
  ].join("");
}

function renderDependencyEdges(edges = []) {
  if (!edges.length) {
    return '<div class="empty-work-queue">No dependencies configured yet. Add a prerequisite to see downstream impact.</div>';
  }

  return edges
    .map(
      (edge) => `
        <article class="dependency-edge-card">
          <div class="dependency-edge-title-row">
            <strong>${escapeHtml(edge.itemTitle || edge.itemId)}</strong>
            ${renderLineagePill(edge.strictness, edge.label, edge.strictness === "advisory" ? "dependency-advisory" : "dependency-hard")}
          </div>
          <p class="dependency-edge-path">
            waits on <button type="button" class="inline-detail-button" data-open-type="work-item" data-open-id="${escapeHtml(edge.dependencyItemId)}">${escapeHtml(edge.dependencyTitle || edge.dependencyItemId)}</button>
          </p>
          <div class="lineage-meta">
            ${renderLineagePill("edge", edge.id, "inherited")}
            ${edge.autoRelaxation?.enabled ? renderLineagePill("auto", edge.autoRelaxation.mode || "warn-and-run", "dependency-advisory") : ""}
          </div>
        </article>
      `,
    )
    .join("");
}

function renderGroupDependencyComposer(detail) {
  const items = Array.isArray(detail.items) ? detail.items : [];
  const downstreamOptions = items
    .map(
      (item, index) =>
        `<option value="${escapeHtml(item.id)}" ${index === 0 ? "selected" : ""}>${escapeHtml(item.title || item.id)}</option>`,
    )
    .join("");
  const prerequisiteOptions = items
    .map(
      (item, index) =>
        `<option value="${escapeHtml(item.id)}" ${index === (items.length > 1 ? 1 : 0) ? "selected" : ""}>${escapeHtml(item.title || item.id)}</option>`,
    )
    .join("");

  return `
    <section class="detail-section">
      <div class="detail-section-heading">
        <h3>Prerequisite Picker</h3>
        <p class="detail-support">Route changes through the shared dependency write surface and refresh impact immediately.</p>
      </div>
      <form class="dependency-form" data-dependency-form data-group-id="${escapeHtml(detail.id)}">
        <div class="dependency-form-grid">
          <label>
            <span class="detail-label">Downstream item</span>
            <select name="itemId">${downstreamOptions}</select>
          </label>
          <label>
            <span class="detail-label">Prerequisite item</span>
            <select name="dependencyItemId">${prerequisiteOptions}</select>
          </label>
          <label>
            <span class="detail-label">Strictness</span>
            <select name="strictness">
              <option value="hard">Hard dependency</option>
              <option value="advisory">Advisory dependency</option>
            </select>
          </label>
        </div>
        <div class="dependency-form-actions">
          <button type="submit" class="primary-button">Add prerequisite</button>
          <span class="muted" data-dependency-feedback>Updates run through <code>/work-item-groups/:id/dependencies</code>.</span>
        </div>
      </form>
      <div class="dependency-edge-list">
        ${renderDependencyEdges(detail.dependencyGraph?.edges || [])}
      </div>
    </section>
  `;
}

function renderGroupDependencyItems(detail) {
  const items = Array.isArray(detail.items) ? detail.items : [];
  const focusedItems = items
    .filter(
      (item) =>
        (item.dependencyState?.counts?.total ?? 0) > 0 ||
        (item.blockerIds?.length ?? 0) > 0,
    )
    .sort((left, right) => {
      const leftProblem = ["review_needed", "blocked"].includes(
        left.dependencyState?.state,
      )
        ? 0
        : 1;
      const rightProblem = ["review_needed", "blocked"].includes(
        right.dependencyState?.state,
      )
        ? 0
        : 1;
      if (leftProblem !== rightProblem) return leftProblem - rightProblem;
      return String(left.title || left.id).localeCompare(
        String(right.title || right.id),
      );
    });

  if (!focusedItems.length) {
    return '<div class="empty-work-queue quiet">No dependency-linked items yet. Add a prerequisite to start shaping readiness.</div>';
  }

  return focusedItems
    .map((item) => {
      const dependency = item.dependencyState || {};
      const blocker = dependency.blockers?.[0] || null;
      return `
        <article class="dependency-item-row">
          <div class="dependency-item-header">
            <button type="button" class="inline-detail-button strong-link" data-open-type="work-item" data-open-id="${escapeHtml(item.id)}">${escapeHtml(item.title || item.id)}</button>
            ${renderStatusBadge(dependency.state || item.status || "pending")}
          </div>
          <div class="lineage-meta">
            ${blocker?.id ? renderLineagePill("blocker", blocker.id, "changed") : ""}
            ${blocker?.strictness ? renderLineagePill("strict", blocker.strictness, blocker.strictness === "advisory" ? "dependency-advisory" : "dependency-hard") : ""}
            ${dependency.compactSummary?.advisoryWarningCount ? renderLineagePill("warnings", dependency.compactSummary.advisoryWarningCount, "dependency-advisory") : ""}
          </div>
          <p class="dependency-item-reason">${escapeHtml(dependency.reason || "Ready to run.")}</p>
          <p class="dependency-item-next">${escapeHtml(item.nextActionHint || dependency.nextActionHint || "Open the item for full dependency details.")}</p>
        </article>
      `;
    })
    .join("");
}

function renderTransitionLog(detail) {
  const entries = Array.isArray(detail.dependencyGraph?.transitionLog)
    ? detail.dependencyGraph.transitionLog.slice(0, 6)
    : [];
  if (!entries.length) {
    return '<div class="empty-work-queue">No dependency transitions recorded yet.</div>';
  }

  return entries
    .map(
      (entry) => `
        <article class="transition-row">
          <div class="transition-header">
            <strong>${escapeHtml(humanizeKey(entry.type || "dependency update"))}</strong>
            ${renderStatusBadge(entry.state || "pending")}
          </div>
          <p>${escapeHtml(entry.reason || "Dependency state updated.")}</p>
          <div class="lineage-meta">
            ${entry.blockerId ? renderLineagePill("blocker", entry.blockerId, "changed") : ""}
            ${entry.dependencyItemId ? renderLineagePill("depends", entry.dependencyItemId, "inherited") : ""}
            ${entry.strictness ? renderLineagePill("strict", entry.strictness, entry.strictness === "advisory" ? "dependency-advisory" : "dependency-hard") : ""}
          </div>
        </article>
      `,
    )
    .join("");
}

function renderWorkItemDependencySection(detail) {
  const dependency = detail.dependencyState || {};
  const blockers = Array.isArray(dependency.blockers)
    ? dependency.blockers
    : [];
  const warnings = Array.isArray(dependency.advisoryWarnings)
    ? dependency.advisoryWarnings
    : [];
  const edges = Array.isArray(dependency.incomingEdges)
    ? dependency.incomingEdges
    : [];

  return `
    <section class="detail-section">
      <div class="detail-section-heading">
        <h3>Dependency Detail</h3>
        <p class="detail-support">Plain-language reason first, exact blocker ids and strictness close behind.</p>
      </div>
      <div class="detail-card dependency-summary-card compact-empty">
        <div class="dependency-item-header">
          <strong>${escapeHtml(dependency.reason || "Ready to run.")}</strong>
          ${renderStatusBadge(dependency.state || detail.status || "pending")}
        </div>
        <div class="lineage-meta">
          ${renderLineagePill("incoming", edges.length, "inherited")}
          ${renderLineagePill("blockers", blockers.length, blockers.length ? "changed" : "")}
          ${renderLineagePill("warnings", warnings.length, warnings.length ? "dependency-advisory" : "")}
        </div>
        <p class="dependency-item-next">${escapeHtml(detail.nextActionHint || dependency.nextActionHint || "Ready to run.")}</p>
      </div>
      <div class="dependency-edge-list">
        ${renderDependencyEdges(
          edges.map((edge) => ({
            ...edge,
            itemTitle: detail.title || detail.id,
            dependencyTitle:
              blockers.find(
                (blocker) => blocker.dependencyItemId === edge.dependencyItemId,
              )?.dependencyTitle || edge.dependencyItemId,
          })),
        )}
      </div>
    </section>
  `;
}

function renderGenericDetailRows(detail: AnyRecord = {}) {
  const rows = [
    ["Status", detail.status || detail.state || null],
    ["ID", detail.id || null],
    ["Updated", detail.updatedAt || null],
    ["Created", detail.createdAt || null],
  ].filter(([, value]) => value);

  return rows
    .map(
      ([label, value]) => `
        <div class="detail-row">
          <div class="detail-label">${escapeHtml(label)}</div>
          <div class="detail-value">${label === "Status" ? renderStatusBadge(value) : escapeHtml(String(value))}</div>
        </div>
      `,
    )
    .join("");
}

function renderSelfBuildOperatorForm(config: AnyRecord = {}) {
  const hiddenFields = Object.entries(config.hidden || {})
    .filter(([, value]) => value !== undefined && value !== null)
    .map(
      ([key, value]) =>
        `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(String(value))}">`,
    )
    .join("");
  const fields = Array.isArray(config.fields)
    ? config.fields
        .map((field) => {
          if (field.type === "select") {
            const options = (field.options || [])
              .map(
                (option) =>
                  `<option value="${escapeHtml(String(option.value))}" ${option.value === field.value ? "selected" : ""}>${escapeHtml(String(option.label))}</option>`,
              )
              .join("");
            return `
              <label>
                <span class="detail-label">${escapeHtml(field.label)}</span>
                <select name="${escapeHtml(field.name)}">${options}</select>
              </label>
            `;
          }
          if (field.type === "checkbox") {
            return `
              <label class="checkbox-row">
                <input type="checkbox" name="${escapeHtml(field.name)}" ${
                  field.checked ? "checked" : ""
                }>
                <span>${escapeHtml(field.label)}</span>
              </label>
            `;
          }
          if (field.type === "textarea") {
            return `
              <label class="textarea-row">
                <span class="detail-label">${escapeHtml(field.label)}</span>
                <textarea name="${escapeHtml(field.name)}" ${field.json ? 'data-json="true"' : ""} placeholder="${escapeHtml(String(field.placeholder ?? ""))}">${escapeHtml(String(field.value ?? ""))}</textarea>
              </label>
            `;
          }
          return `
            <label>
              <span class="detail-label">${escapeHtml(field.label)}</span>
              <input type="${escapeHtml(field.type || "text")}" name="${escapeHtml(field.name)}" ${field.json ? 'data-json="true"' : ""} value="${escapeHtml(String(field.value ?? ""))}" placeholder="${escapeHtml(String(field.placeholder ?? ""))}">
            </label>
          `;
        })
        .join("")
    : "";

  return `
    <form class="operator-action-form" data-operator-form data-method="${escapeHtml(config.method || "POST")}" data-endpoint="${escapeHtml(config.endpoint || "#")}" data-refresh-type="${escapeHtml(config.refreshType || "")}" data-refresh-id="${escapeHtml(config.refreshId || "")}">
      ${hiddenFields}
      ${fields ? `<div class="dependency-form-grid">${fields}</div>` : ""}
      <div class="dependency-form-actions">
        <button type="submit" class="primary-button">${escapeHtml(config.label || "Submit")}</button>
        <span class="muted" data-operator-feedback>${escapeHtml(config.help || "")}</span>
      </div>
    </form>
  `;
}

function parseOperatorForm(form: HTMLFormElement) {
  const data = new FormData(form);
  const body: AnyRecord = {};
  for (const [key, value] of data.entries()) {
    if (value === "on") {
      body[key] = true;
      continue;
    }
    const text = String(value);
    body[key] = text;
  }
  form
    .querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >("[data-json='true']")
    .forEach((input) => {
      const raw = String(body[input.name] ?? "").trim();
      body[input.name] = raw ? JSON.parse(raw) : [];
    });
  form
    .querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    .forEach((checkbox) => {
      if (!(checkbox.name in body)) {
        body[checkbox.name] = false;
      }
    });
  return body;
}

async function openSelfBuildDetail(itemType, itemId) {
  if (!els.selfBuildDetailOverlay || !els.selfBuildDetailContent) return;

  state.selfBuildDependencyImpact =
    itemType === "work-item-group" ? state.selfBuildDependencyImpact : null;
  els.selfBuildDetailOverlay.style.display = "block";
  els.selfBuildDetailContent.innerHTML =
    '<div class="loading">Loading detail...</div>';

  try {
    let detailData = null;
    let endpoint = "";
    if (
      itemType === "policy-recommendation" ||
      itemType === "protected-override"
    ) {
      const localDetail = findSelfBuildLocalDetail(itemType, itemId);
      if (localDetail) {
        renderSelfBuildDetailView(itemType, localDetail);
        return;
      }
    }

    if (itemType === "work-item") {
      endpoint = `/api/orchestrator/work-items/${encodeURIComponent(itemId)}`;
      state.selectedWorkItemId = itemId;
    } else if (itemType === "goal-plan") {
      endpoint = `/api/orchestrator/goal-plans/${encodeURIComponent(itemId)}`;
    } else if (itemType === "work-item-group") {
      endpoint = `/api/orchestrator/work-item-groups/${encodeURIComponent(itemId)}`;
      state.selectedWorkItemGroupId = itemId;
    } else if (itemType === "proposal") {
      endpoint = `/api/orchestrator/proposal-artifacts/${encodeURIComponent(itemId)}/review-package`;
    } else if (itemType === "work-item-run") {
      endpoint = `/api/orchestrator/work-item-runs/${encodeURIComponent(itemId)}`;
    } else if (itemType === "doc-suggestion") {
      endpoint = `/api/orchestrator/doc-suggestions/${encodeURIComponent(itemId)}`;
    } else if (itemType === "self-build-intake") {
      endpoint = `/api/orchestrator/self-build/intake/${encodeURIComponent(itemId)}`;
    } else if (itemType === "workspace") {
      endpoint = `/api/orchestrator/workspaces/${encodeURIComponent(itemId)}`;
    } else if (itemType === "integration-branch") {
      endpoint = `/api/orchestrator/integration-branches/${encodeURIComponent(itemId)}`;
    } else {
      throw new Error(`Unknown item type: ${itemType}`);
    }

    const response = await fetch(endpoint);
    const data = await response.json();

    if (data.ok && data.detail) {
      detailData = data.detail;
      renderSelfBuildDetailView(itemType, detailData);
    } else {
      const localDetail =
        itemType === "policy-recommendation" ||
        itemType === "protected-override"
          ? findSelfBuildLocalDetail(itemType, itemId)
          : null;
      if (localDetail) {
        renderSelfBuildDetailView(itemType, localDetail);
      } else {
        els.selfBuildDetailContent.innerHTML = `<div class="error">Failed to load detail: ${escapeHtml(data.error || "Unknown error")}</div>`;
      }
    }
  } catch (error) {
    const localDetail =
      itemType === "policy-recommendation" || itemType === "protected-override"
        ? findSelfBuildLocalDetail(itemType, itemId)
        : null;
    if (localDetail) {
      renderSelfBuildDetailView(itemType, localDetail);
    } else {
      els.selfBuildDetailContent.innerHTML = `<div class="error">Error loading detail: ${escapeHtml(error.message)}</div>`;
      console.error("Failed to load self-build detail:", error);
    }
  }
}

function renderSelfBuildDetailLink(
  itemType: string,
  itemId: string,
  label: string,
) {
  if (!itemType || !itemId) {
    return "";
  }
  return `<button type="button" class="inline-detail-button strong-link" data-open-type="${escapeHtml(itemType)}" data-open-id="${escapeHtml(itemId)}">${escapeHtml(label)}</button>`;
}

function resolveSelfBuildDetailTarget(detail: AnyRecord = {}) {
  const targetType = normalizeText(
    detail.targetType || detail.overrideTargetType || "",
    "",
  );
  const targetId = normalizeText(
    detail.targetId || detail.overrideTargetId || "",
    "",
  );
  if (!targetType || !targetId) {
    return null;
  }
  if (targetType === "proposal-artifact") {
    return { itemType: "proposal", itemId: targetId };
  }
  return { itemType: targetType, itemId: targetId };
}

function renderSelfBuildDetailView(itemType, detail) {
  if (!els.selfBuildDetailContent || !els.selfBuildDetailTitle) return;

  const recommendation = readFirstObjectField(detail, ["recommendation"]) || {};
  const title =
    detail.title ||
    detail.label ||
    detail.name ||
    detail.summary ||
    detail.goal ||
    recommendation.summary ||
    recommendation.goal ||
    detail.recommendationId ||
    detail.overrideId ||
    detail.targetId ||
    detail.proposal?.summary?.title ||
    detail.proposal?.id ||
    detail.id;
  const detailStatus =
    detail.queueStatus ||
    detail.reviewStatus ||
    detail.status ||
    detail.state ||
    recommendation.status ||
    detail.proposal?.status ||
    "unknown";
  const detailId =
    detail.id ||
    detail.recommendationId ||
    detail.overrideId ||
    detail.targetId ||
    detail.proposal?.id ||
    "";
  els.selfBuildDetailTitle.textContent = title || detailId || "Detail";

  let lineageHTML = "";
  if (itemType === "work-item" && detail.goalPlan && detail.workItemGroup) {
    lineageHTML = `
      <div class="lineage-chain">
        <span>Goal: ${escapeHtml(detail.goalPlan.goal || detail.goalPlan.id)}</span>
        <span class="lineage-separator">→</span>
        <span>Group: ${escapeHtml(detail.workItemGroup.label || detail.workItemGroup.id)}</span>
        <span class="lineage-separator">→</span>
        <span>Item: ${escapeHtml(title)}</span>
      </div>
    `;
  } else if (itemType === "work-item-group" && detail.goalPlan) {
    lineageHTML = `
      <div class="lineage-chain">
        <span>Goal: ${escapeHtml(detail.goalPlan.goal || detail.goalPlan.id)}</span>
        <span class="lineage-separator">→</span>
        <span>Group: ${escapeHtml(title)}</span>
      </div>
    `;
  }

  const statusSection = `
    <div class="detail-section">
      <div class="detail-section-heading">
        <h3>Status & Information</h3>
        <p class="detail-support">Lead with readiness, then move into blockers, strictness, and next actions.</p>
      </div>
      <div class="detail-row">
        <div class="detail-label">Status</div>
        <div class="detail-value"><span class="status-badge ${stateClass(detailStatus)}">${escapeHtml(detailStatus)}</span></div>
      </div>
      <div class="detail-row">
        <div class="detail-label">ID</div>
        <div class="detail-value"><code>${escapeHtml(detailId)}</code></div>
      </div>
      ${detail.kind ? `<div class="detail-row"><div class="detail-label">Kind</div><div class="detail-value">${escapeHtml(detail.kind)}</div></div>` : ""}
      ${detail.priority ? `<div class="detail-row"><div class="detail-label">Priority</div><div class="detail-value">${escapeHtml(detail.priority)}</div></div>` : ""}
      ${detail.createdAt ? `<div class="detail-row"><div class="detail-label">Created</div><div class="detail-value">${formatDisplayTimestamp(detail.createdAt)}</div></div>` : ""}
      ${detail.updatedAt ? `<div class="detail-row"><div class="detail-label">Updated</div><div class="detail-value">${formatDisplayTimestamp(detail.updatedAt)}</div></div>` : ""}
    </div>
  `;

  let dependencySection = "";
  let recentActivitySection = "";

  if (itemType === "goal-plan") {
    const recommendations = Array.isArray(detail.recommendations)
      ? detail.recommendations
      : [];
    const materializedGroup = detail.materializedGroup;
    dependencySection = `
      <section class="detail-section">
        <div class="detail-section-heading">
          <h3>Operator Flow</h3>
          <p class="detail-support">Review first, then materialize, then run the managed work group with validation.</p>
        </div>
        ${renderSummaryObjectCard(detail.operatorFlow, "Operator Flow", "No operator flow metadata returned for this goal plan.")}
        <div class="lineage-meta">
          ${detail.materializedGroup?.id ? renderLineagePill("group", detail.materializedGroup.id, "root") : ""}
          ${detail.reviewHistory?.length ? renderLineagePill("reviews", detail.reviewHistory.length, "inherited") : ""}
          ${recommendations.length ? renderLineagePill("recommendations", recommendations.length, "inherited") : ""}
        </div>
        ${renderSelfBuildOperatorForm({
          endpoint: `/api/orchestrator/goal-plans/${encodeURIComponent(detail.id)}/edit`,
          refreshType: "goal-plan",
          refreshId: detail.id,
          label: "Edit Goal Plan",
          help: "Reorder or drop recommended work items before materialization and persist the operator rationale.",
          fields: [
            {
              type: "textarea",
              name: "recommendations",
              label: "Recommendations JSON",
              value: JSON.stringify(
                detail.editedRecommendations?.length
                  ? detail.editedRecommendations
                  : recommendations,
                null,
                2,
              ),
              placeholder: "Edit recommendations as JSON array",
              json: true,
            },
            {
              type: "text",
              name: "rationale",
              label: "Edit Rationale",
              placeholder: "Why are you reordering or dropping items?",
            },
          ],
        })}
        ${renderSelfBuildOperatorForm({
          endpoint: `/api/orchestrator/goal-plans/${encodeURIComponent(detail.id)}/review`,
          refreshType: "goal-plan",
          refreshId: detail.id,
          label: "Review Goal Plan",
          help: "Mark the plan as reviewed or rejected before materialization.",
          fields: [
            {
              type: "select",
              name: "status",
              label: "Decision",
              value: "reviewed",
              options: [
                { value: "reviewed", label: "Reviewed" },
                { value: "rejected", label: "Rejected" },
              ],
            },
            {
              type: "text",
              name: "comments",
              label: "Comments",
              placeholder: "Optional operator notes",
            },
          ],
        })}
        ${renderSelfBuildOperatorForm({
          endpoint: `/api/orchestrator/goal-plans/${encodeURIComponent(detail.id)}/materialize`,
          refreshType: "goal-plan",
          refreshId: detail.id,
          label: "Materialize Goal Plan",
          help: "Create the work-item group and managed items for this plan.",
        })}
        ${renderSelfBuildOperatorForm({
          endpoint: `/api/orchestrator/goal-plans/${encodeURIComponent(detail.id)}/run`,
          refreshType: "goal-plan",
          refreshId: detail.id,
          label: "Run Goal Plan",
          help: "Materialize if needed, run the group in dependency-aware batches, and auto-validate successful runs.",
          fields: [
            {
              type: "checkbox",
              name: "autoValidate",
              label: "Auto validate completed work-item runs",
              checked: true,
            },
            {
              type: "checkbox",
              name: "stub",
              label: "Use stub runtime for this operator flow",
              checked: true,
            },
          ],
        })}
        ${renderSelfBuildOperatorForm({
          endpoint: `/api/orchestrator/goal-plans/${encodeURIComponent(detail.id)}/protected-override`,
          refreshType: "goal-plan",
          refreshId: detail.id,
          label: "Request Protected Override",
          help: "Escalate blocked protected-tier goal-plan work for explicit human review.",
          fields: [
            {
              type: "text",
              name: "overrideScope",
              label: "Scope",
              value:
                detail.protectedScope ||
                detail.riskSummary?.highestScope ||
                detail.domain ||
                "goal-plan",
            },
            {
              type: "text",
              name: "rationale",
              label: "Rationale",
              placeholder: "Why should this protected-tier plan continue?",
            },
            {
              type: "text",
              name: "comments",
              label: "Operator Notes",
              placeholder: "Optional context for the human override reviewer.",
            },
          ],
        })}
      </section>
    `;
    recentActivitySection = `
      <div class="detail-section">
        <div class="detail-section-heading">
          <h3>Recommendations</h3>
          <p class="detail-support">Planned self-build items that will be materialized into a dependency-aware work group.</p>
        </div>
        ${
          recommendations.length === 0
            ? "<p>No recommendations returned for this goal plan.</p>"
            : recommendations
                .map(
                  (recommendation) => `
                  <article class="dependency-item-row compact">
                    <div class="dependency-item-header">
                      <strong>${escapeHtml(recommendation.title || recommendation.id)}</strong>
                      ${renderStatusBadge(recommendation.requiredGovernance || recommendation.kind || "planned")}
                    </div>
                    <div class="lineage-meta">
                      ${renderLineagePill("kind", recommendation.kind || "-", "inherited")}
                      ${renderLineagePill("risk", recommendation.riskLevel || "-", recommendation.riskLevel === "medium" ? "changed" : "inherited")}
                      ${renderLineagePill("order", recommendation.groupOrder ?? "-", "inherited")}
                    </div>
                    <p class="dependency-item-reason">${escapeHtml(recommendation.goal || "No goal summary.")}</p>
                  </article>
                `,
                )
                .join("")
        }
        ${
          materializedGroup
            ? `<article class="detail-card compact-empty">
                <strong>Materialized Group</strong>
                <p>${escapeHtml(materializedGroup.title || materializedGroup.id)}</p>
                <div class="lineage-meta">
                  <button type="button" class="inline-detail-button strong-link" data-open-type="work-item-group" data-open-id="${escapeHtml(materializedGroup.id)}">Open group</button>
                </div>
              </article>`
            : ""
        }
        ${renderSummaryObjectCard(
          {
            reviewRationale: detail.reviewRationale,
            editHistory: detail.editHistory,
            history: detail.history,
          },
          "Plan History",
          "No review or edit history recorded yet.",
        )}
      </div>
    `;
  } else if (itemType === "work-item") {
    dependencySection = renderWorkItemDependencySection(detail);
    const runHistory = detail.runHistory?.runs || detail.runs || [];
    recentActivitySection = `
      <div class="detail-section">
        <div class="detail-section-heading">
          <h3>Run History</h3>
          <p class="detail-support">Compare status, validation, proposal linkage, and doc-suggestion drift across runs.</p>
        </div>
        ${
          detail.runHistory?.trend
            ? `<div class="lineage-meta">
                ${renderLineagePill("health", detail.runHistory.trend.health, detail.runHistory.trend.health === "degraded" ? "changed" : "root")}
                ${renderLineagePill("runs", detail.runHistory.trend.runCount ?? 0, "inherited")}
                ${renderLineagePill("latest", detail.runHistory.trend.latestRunId || "-", "inherited")}
              </div>`
            : ""
        }
        ${runHistory.length === 0 ? "<p>No runs yet.</p>" : ""}
        ${runHistory
          .map(
            (run) => `
          <article class="dependency-item-row compact" data-open-type="work-item-run" data-open-id="${escapeHtml(run.id)}">
            <div class="dependency-item-header">
              <strong>${escapeHtml(formatDisplayTimestamp(run.startedAt || run.createdAt))}</strong>
              ${renderStatusBadge(run.status || run.state || "unknown")}
            </div>
            <div class="lineage-meta">
              ${renderLineagePill("validation", run.validationStatus || "-", "inherited")}
              ${run.hasProposal ? renderLineagePill("proposal", "yes", "root") : ""}
              ${run.hasWorkspace ? renderLineagePill("workspace", "yes", "root") : ""}
              ${run.docSuggestionCount ? renderLineagePill("doc-suggestions", run.docSuggestionCount, "dependency-advisory") : ""}
            </div>
            <p class="dependency-item-reason">${escapeHtml(run.comparisonToPrevious?.summary || "No previous run available for comparison.")}</p>
            <p class="dependency-item-next">${escapeHtml(run.links?.execution ? `Execution: ${run.relationSummary?.executionId}` : run.links?.scenarioRun ? `Scenario: ${run.relationSummary?.scenarioRunId}` : run.links?.regressionRun ? `Regression: ${run.relationSummary?.regressionRunId}` : "Open run detail for proposal, validation, and docs suggestions.")}</p>
            <div class="lineage-meta">
              ${run.links?.scenarioRun ? `<a class="inline-link" href="/api/orchestrator${escapeHtml(run.links.scenarioRun)}" target="_blank" rel="noreferrer">scenario</a>` : ""}
              ${run.links?.regressionRun ? `<a class="inline-link" href="/api/orchestrator${escapeHtml(run.links.regressionRun)}" target="_blank" rel="noreferrer">regression</a>` : ""}
              ${run.links?.execution ? `<a class="inline-link" href="/api/orchestrator${escapeHtml(run.links.execution)}" target="_blank" rel="noreferrer">execution</a>` : ""}
            </div>
          </article>
        `,
          )
          .join("")}
      </div>
    `;
  } else if (itemType === "work-item-group" && Array.isArray(detail.items)) {
    const impactSummary =
      state.selectedWorkItemGroupId === detail.id
        ? state.selfBuildDependencyImpact
        : null;
    const counts = detail.readiness?.counts || {};
    dependencySection = `
      <section class="detail-section">
        <div class="dependency-headline">
          <div>
            <h3>Readiness First</h3>
            <p class="detail-support">${escapeHtml(detail.readiness?.preRunSummary?.label || "No readiness summary available.")}</p>
          </div>
          ${renderStatusBadge(detail.readiness?.headlineState || detail.status || "pending")}
        </div>
        <div class="lineage-meta">
          ${renderLineagePill("ready", counts.ready ?? 0, "root")}
          ${renderLineagePill("blocked", counts.blocked ?? 0, counts.blocked ? "changed" : "")}
          ${renderLineagePill("review", counts.reviewNeeded ?? 0, counts.reviewNeeded ? "changed" : "")}
          ${renderLineagePill("failed", counts.failed ?? 0, counts.failed ? "changed" : "")}
          ${renderLineagePill("edges", detail.dependencyGraph?.edges?.length ?? 0, "inherited")}
        </div>
        <div class="readiness-stat-grid">
          <article class="detail-card compact-empty readiness-note-card">
            <strong>Next action</strong>
            <p>${escapeHtml(detail.readiness?.nextActionHint || "Inspect the dependency graph before running the group.")}</p>
          </article>
          <article class="detail-card compact-empty readiness-note-card">
            <strong>Pre-run summary</strong>
            <p>${escapeHtml(detail.readiness?.preRunSummary?.label || "No pre-run summary available.")}</p>
          </article>
          ${
            impactSummary
              ? `<article class="detail-card compact-empty readiness-note-card impact-card">
                  <strong>Impact updated</strong>
                  <p>${escapeHtml(`Headline: ${impactSummary.headlineState} · blockers: ${impactSummary.blockerIds?.length ?? 0}`)}</p>
                </article>`
              : ""
          }
        </div>
      </section>
      ${renderGroupDependencyComposer(detail)}
      <section class="detail-section">
        <div class="detail-section-heading">
          <h3>Blocked / Review Needed</h3>
          <p class="detail-support">Each row explains the blocker id, strictness, and likely next step.</p>
        </div>
        <div class="dependency-item-list">
          ${renderGroupDependencyItems(detail)}
        </div>
      </section>
      <section class="detail-section">
        <div class="detail-section-heading">
          <h3>Dependency Transition Log</h3>
          <p class="detail-support">Visible state changes for graph edits, skips, relaxations, and review-needed transitions.</p>
        </div>
        <div class="transition-list">
          ${renderTransitionLog(detail)}
        </div>
        ${renderSelfBuildOperatorForm({
          endpoint: `/api/orchestrator/work-item-groups/${encodeURIComponent(detail.id)}/unblock`,
          refreshType: "work-item-group",
          refreshId: detail.id,
          label: "Unblock Group Items",
          help: "Manually unblock dependency-gated items when operator judgement overrides blockers.",
          fields: [
            {
              type: "text",
              name: "items",
              label: "Item IDs (comma separated)",
              placeholder: "leave blank for all blocked items",
            },
            {
              type: "text",
              name: "rationale",
              label: "Rationale",
              placeholder: "Why is manual unblock justified?",
            },
          ],
        })}
        ${renderSelfBuildOperatorForm({
          endpoint: `/api/orchestrator/work-item-groups/${encodeURIComponent(detail.id)}/retry-downstream`,
          refreshType: "work-item-group",
          refreshId: detail.id,
          label: "Retry Downstream",
          help: "Requeue blocked or failed downstream items after a recovery action.",
          fields: [
            {
              type: "text",
              name: "items",
              label: "Item IDs (comma separated)",
              placeholder: "leave blank for targeted downstream items",
            },
            {
              type: "text",
              name: "rationale",
              label: "Rationale",
              placeholder: "Why retry downstream items now?",
            },
          ],
        })}
        ${renderSelfBuildOperatorForm({
          endpoint: `/api/orchestrator/work-item-groups/${encodeURIComponent(detail.id)}/reroute`,
          refreshType: "work-item-group",
          refreshId: detail.id,
          label: "Reroute Item",
          help: "Create a repair lane for one item and repoint downstream dependencies to it.",
          fields: [
            {
              type: "text",
              name: "itemId",
              label: "Item ID",
              placeholder: "item to reroute",
            },
            {
              type: "text",
              name: "title",
              label: "Repair Item Title",
              placeholder: "optional title override",
            },
            {
              type: "text",
              name: "goal",
              label: "Repair Goal",
              placeholder: "optional repair goal",
            },
            {
              type: "text",
              name: "rationale",
              label: "Rationale",
              placeholder: "Why reroute this item?",
            },
          ],
        })}
        ${renderSelfBuildOperatorForm({
          endpoint: `/api/orchestrator/work-item-groups/${encodeURIComponent(detail.id)}/requeue-item`,
          refreshType: "work-item-group",
          refreshId: detail.id,
          label: "Requeue Item",
          help: "Move one item back to pending.",
          fields: [
            {
              type: "text",
              name: "itemId",
              label: "Item ID",
              placeholder: "item id",
            },
            {
              type: "text",
              name: "rationale",
              label: "Rationale",
              placeholder: "Why requeue this item?",
            },
          ],
        })}
        ${renderSelfBuildOperatorForm({
          endpoint: `/api/orchestrator/work-item-groups/${encodeURIComponent(detail.id)}/skip-item`,
          refreshType: "work-item-group",
          refreshId: detail.id,
          label: "Skip Item",
          help: "Mark one item as skipped with explicit rationale.",
          fields: [
            {
              type: "text",
              name: "itemId",
              label: "Item ID",
              placeholder: "item id",
            },
            {
              type: "text",
              name: "rationale",
              label: "Rationale",
              placeholder: "Why skip this item?",
            },
          ],
        })}
        ${renderSelfBuildOperatorForm({
          endpoint: `/api/orchestrator/work-item-groups/${encodeURIComponent(detail.id)}/protected-override`,
          refreshType: "work-item-group",
          refreshId: detail.id,
          label: "Request Protected Override",
          help: "Escalate blocked protected-tier execution for explicit human approval.",
          fields: [
            {
              type: "text",
              name: "overrideScope",
              label: "Scope",
              value:
                detail.protectedScope ||
                detail.readiness?.protectedScope ||
                detail.domain ||
                "work-item-group",
            },
            {
              type: "text",
              name: "rationale",
              label: "Rationale",
              placeholder: "Why should this protected-tier group continue?",
            },
            {
              type: "text",
              name: "comments",
              label: "Operator Notes",
              placeholder: "Optional notes for override review.",
            },
          ],
        })}
        ${renderSelfBuildOperatorForm({
          endpoint: `/api/orchestrator/work-item-groups/${encodeURIComponent(detail.id)}/validate-bundle`,
          refreshType: "work-item-group",
          refreshId: detail.id,
          label: "Validate Bundle",
          help: "Run named validation bundles across the latest runs for this group.",
          fields: [
            {
              type: "text",
              name: "bundleIds",
              label: "Bundle IDs (comma separated)",
              placeholder: "proposal-ready-fast",
            },
            {
              type: "checkbox",
              name: "stub",
              label: "Use stub runtime for validation",
              checked: true,
            },
          ],
        })}
      </section>
    `;
    recentActivitySection = `
      <div class="detail-section">
        <div class="detail-section-heading">
          <h3>Child Items (${detail.items.length})</h3>
          <p class="detail-support">Open any child item to inspect its dependency reasoning and recent runs.</p>
        </div>
        ${detail.items
          .map(
            (item) => `
          <article class="dependency-item-row compact">
            <div class="dependency-item-header">
              <button type="button" class="inline-detail-button strong-link" data-open-type="work-item" data-open-id="${escapeHtml(item.id)}">${escapeHtml(item.title || item.label || item.id)}</button>
              ${renderStatusBadge(item.dependencyState?.state || item.status || item.state || "pending")}
            </div>
            <div class="lineage-meta">
              ${item.blockerIds?.[0] ? renderLineagePill("blocker", item.blockerIds[0], "changed") : ""}
              ${(item.dependencyState?.incomingEdges || []).length ? renderLineagePill("incoming", item.dependencyState.incomingEdges.length, "inherited") : ""}
              ${item.dependencyState?.blockers?.[0]?.strictness ? renderLineagePill("strict", item.dependencyState.blockers[0].strictness, item.dependencyState.blockers[0].strictness === "advisory" ? "dependency-advisory" : "dependency-hard") : ""}
            </div>
            <p class="dependency-item-reason">${escapeHtml(item.dependencyState?.reason || item.blockedReason || "Ready to run.")}</p>
            <p class="dependency-item-next">${escapeHtml(item.nextActionHint || item.dependencyState?.nextActionHint || "Open the item for more detail.")}</p>
          </article>
        `,
          )
          .join("")}
      </div>
    `;
  } else if (itemType === "proposal") {
    const proposal = detail.proposal || detail;
    dependencySection = `
      <section class="detail-section">
        <div class="detail-section-heading">
          <h3>Proposal Review Package</h3>
          <p class="detail-support">Proposal governance is separate from promotion. Approval does not merge to main.</p>
        </div>
        ${renderSummaryObjectCard(proposal, "Proposal Summary", "No proposal summary returned.")}
        ${renderSummaryObjectCard(detail.readiness, "Readiness", "No readiness state returned for this proposal.")}
        ${renderSummaryObjectCard(detail.promotion, "Promotion Context", "No promotion context returned for this proposal.")}
        ${renderSummaryObjectCard(detail.reworkHistory, "Rework History", "No rework history recorded for this proposal.")}
        ${renderSuggestedActionsCard(detail.suggestedActions, "Suggested Actions", "No suggested actions returned for this proposal.")}
        ${renderSelfBuildOperatorForm({
          endpoint: `/api/orchestrator/proposal-artifacts/${encodeURIComponent(proposal.id)}/review`,
          refreshType: "proposal",
          refreshId: proposal.id,
          label: "Review Proposal",
          help: "Record review notes without treating approval as promotion or merge.",
          fields: [
            {
              type: "select",
              name: "status",
              label: "Decision",
              value: "reviewed",
              options: [
                { value: "reviewed", label: "Reviewed" },
                { value: "rejected", label: "Rejected" },
              ],
            },
            {
              type: "text",
              name: "comments",
              label: "Comments",
              placeholder: "Optional review notes",
            },
          ],
        })}
        ${renderSelfBuildOperatorForm({
          endpoint: `/api/orchestrator/proposal-artifacts/${encodeURIComponent(proposal.id)}/approval`,
          refreshType: "proposal",
          refreshId: proposal.id,
          label: "Approve Proposal",
          help: "Approval marks promotion readiness; it still does not merge to the canonical branch.",
          fields: [
            {
              type: "select",
              name: "status",
              label: "Decision",
              value: "approved",
              options: [
                { value: "approved", label: "Approved" },
                { value: "rejected", label: "Rejected" },
              ],
            },
            {
              type: "text",
              name: "targetBranch",
              label: "Target Branch",
              value: detail.promotion?.targetBranch || "main",
            },
            {
              type: "text",
              name: "comments",
              label: "Comments",
              placeholder: "Optional approval notes",
            },
          ],
        })}
        ${renderSelfBuildOperatorForm({
          endpoint: `/api/orchestrator/proposal-artifacts/${encodeURIComponent(proposal.id)}/protected-override`,
          refreshType: "proposal",
          refreshId: proposal.id,
          label: "Request Protected Override",
          help: "Escalate blocked protected-tier promotion for explicit human approval.",
          fields: [
            {
              type: "text",
              name: "overrideScope",
              label: "Scope",
              value:
                detail.promotion?.targetBranch ||
                detail.readiness?.protectedScope ||
                "integration-branch",
            },
            {
              type: "text",
              name: "rationale",
              label: "Rationale",
              placeholder: "Why should this protected-tier promotion proceed?",
            },
            {
              type: "text",
              name: "comments",
              label: "Operator Notes",
              placeholder: "Optional notes for the override reviewer.",
            },
          ],
        })}
        ${renderSelfBuildOperatorForm({
          endpoint: `/api/orchestrator/proposal-artifacts/${encodeURIComponent(proposal.id)}/promotion-plan`,
          refreshType: "proposal",
          refreshId: proposal.id,
          label: "Plan Promotion",
          help: "Build an explicit integrator lane from the durable proposal source artifacts.",
          fields: [
            {
              type: "text",
              name: "targetBranch",
              label: "Target Branch",
              value: detail.promotion?.targetBranch || "main",
            },
          ],
        })}
        ${renderSelfBuildOperatorForm({
          endpoint: `/api/orchestrator/proposal-artifacts/${encodeURIComponent(proposal.id)}/promotion-invoke`,
          refreshType: "proposal",
          refreshId: proposal.id,
          label: "Invoke Promotion",
          help: "Launch the governed integrator lane. The default outcome is a promotion candidate, not a merge.",
          fields: [
            {
              type: "text",
              name: "targetBranch",
              label: "Target Branch",
              value: detail.promotion?.targetBranch || "main",
            },
            {
              type: "checkbox",
              name: "stub",
              label: "Use stub runtime for promotion flow",
              checked: true,
            },
          ],
        })}
      </section>
    `;
    recentActivitySection = `
      <div class="detail-section">
        <div class="detail-section-heading">
          <h3>Durable Sources</h3>
          <p class="detail-support">Integrator lanes may promote only from durable proposal, workspace, and execution artifacts.</p>
        </div>
        ${renderSummaryObjectCard(detail.workItemRun, "Originating Work-Item Run", "No work-item run linked to this proposal.")}
        ${renderSummaryObjectCard(detail.workItem, "Managed Work Item", "No work item linked to this proposal.")}
        ${renderSummaryObjectCard(detail.workspace, "Workspace", "No workspace linked to this proposal.")}
        ${renderSummaryObjectCard(detail.execution, "Execution", "No source execution linked to this proposal.")}
      </div>
    `;
  } else if (itemType === "policy-recommendation") {
    const recommendationRecord = isObject(detail.recommendation)
      ? detail.recommendation
      : detail;
    const recommendationId =
      detail.recommendationId || recommendationRecord.id || detail.id || "";
    const reviewStatus = normalizeText(
      detail.status || detail.queueStatus || detail.reviewStatus,
      "pending_review",
    );
    dependencySection = `
      <section class="detail-section">
        <div class="detail-section-heading">
          <h3>Policy Recommendation</h3>
          <p class="detail-support">Review autonomy tuning candidates before turning them into managed work or policy changes.</p>
        </div>
        <div class="lineage-meta">
          ${renderLineagePill("status", reviewStatus, reviewStatus === "accepted" ? "root" : reviewStatus === "pending_review" ? "changed" : "inherited")}
          ${recommendationRecord.priority ? renderLineagePill("priority", recommendationRecord.priority, recommendationRecord.priority === "high" ? "changed" : "inherited") : ""}
          ${recommendationRecord.sourceType ? renderLineagePill("source", recommendationRecord.sourceType, "inherited") : ""}
          ${recommendationRecord.autonomyImpact ? renderLineagePill("impact", recommendationRecord.autonomyImpact, recommendationRecord.autonomyImpact === "block" ? "changed" : "dependency-advisory") : ""}
        </div>
        ${renderSummaryObjectCard(recommendationRecord, "Recommendation Summary", "No recommendation detail returned.")}
        ${renderSummaryObjectCard(
          Object.fromEntries(
            [
              ["queueStatus", reviewStatus],
              ["reviewedBy", detail.reviewedBy],
              ["reviewedAt", detail.reviewedAt],
              ["materializedAt", detail.materializedAt],
              ["materializedGoalPlanId", detail.materializedGoalPlanId],
              ["materializedIntakeId", detail.materializedIntakeId],
            ].filter(([, value]) => hasDisplayValue(value)),
          ),
          "Lifecycle",
          "No review lifecycle recorded for this recommendation.",
        )}
        ${renderSummaryObjectCard(detail.links, "Available Routes", "No action routes returned for this recommendation.")}
        ${renderSuggestedActionsCard(recommendationRecord.suggestedActions || detail.suggestedActions || detail.recommendations, "Suggested Actions", "No suggested actions returned for this recommendation.")}
        ${renderLocalActionForm({
          detail,
          actionKey: ["review", "accept"],
          refreshType: "policy-recommendation",
          refreshId: recommendationId,
          label: "Review Recommendation",
          help: "Accept, defer, or reject this policy recommendation.",
          fields: [
            {
              type: "select",
              name: "status",
              label: "Decision",
              value: ["accepted", "deferred", "rejected"].includes(reviewStatus)
                ? reviewStatus
                : "accepted",
              options: [
                { value: "accepted", label: "Accepted" },
                { value: "deferred", label: "Deferred" },
                { value: "rejected", label: "Rejected" },
              ],
            },
            {
              type: "text",
              name: "reason",
              label: "Reason",
              placeholder:
                "Why should this recommendation be applied, deferred, or rejected?",
            },
          ],
        })}
        ${renderLocalActionForm({
          detail,
          actionKey: ["materialize", "refresh", "create"],
          refreshType: "policy-recommendation",
          refreshId: recommendationId,
          label: "Materialize Recommendation",
          help: "Convert this recommendation into managed follow-up work.",
          fields: [
            {
              type: "select",
              name: "mode",
              label: "Materialization Mode",
              value:
                detail.metadata?.materializationMode ||
                recommendationRecord.materializationMode ||
                "goal-plan",
              options: [
                { value: "goal-plan", label: "Goal Plan" },
                { value: "intake", label: "Self-Build Intake" },
              ],
            },
            {
              type: "text",
              name: "projectId",
              label: "Project",
              value: detail.projectId || "spore",
            },
            {
              type: "text",
              name: "domain",
              label: "Domain",
              value: recommendationRecord.domainId || "",
              placeholder: "Optional domain override",
            },
            {
              type: "checkbox",
              name: "reviewRequired",
              label: "Require review on materialized goal plan",
              checked: detail.reviewRequired !== false,
            },
            {
              type: "checkbox",
              name: "safeMode",
              label: "Keep materialized work in safe mode",
              checked: detail.safeMode !== false,
            },
            {
              type: "text",
              name: "reason",
              label: "Reason",
              placeholder: "Optional materialization rationale",
            },
          ],
        })}
      </section>
    `;
    recentActivitySection = `
      <div class="detail-section">
        <div class="detail-section-heading">
          <h3>Recommendation Context</h3>
          <p class="detail-support">Use source signals, review state, and materialization hints to decide the next autonomy tuning action.</p>
        </div>
        ${renderSelfBuildLocalTarget(detail)}
        ${renderSummaryObjectCard(detail.source, "Source", "No source detail returned.")}
        ${renderSummaryObjectCard(detail.metadata, "Metadata", "No recommendation metadata returned.")}
        ${renderSummaryObjectCard(
          {
            sourceType: recommendationRecord.sourceType || detail.sourceType,
            sourceIds: recommendationRecord.sourceIds || detail.sourceIds,
            autonomyImpact:
              recommendationRecord.autonomyImpact || detail.autonomyImpact,
            domainId: recommendationRecord.domainId || detail.domainId,
            templateId: recommendationRecord.templateId || detail.templateId,
            reviewStatus: reviewStatus,
            materializedGoalPlanId: detail.materializedGoalPlanId,
            materializedIntakeId: detail.materializedIntakeId,
          },
          "Recommendation Signals",
          "No recommendation signals returned.",
        )}
      </div>
    `;
  } else if (itemType === "protected-override") {
    const overrideId = detail.id || detail.overrideId || "";
    const overrideStatus = normalizeText(
      detail.reviewStatus || detail.status,
      "pending_review",
    );
    dependencySection = `
      <section class="detail-section">
        <div class="detail-section-heading">
          <h3>Protected-Tier Override</h3>
          <p class="detail-support">Protected scope blocks require explicit human-gated approval before autonomous work can continue.</p>
        </div>
        <div class="lineage-meta">
          ${renderLineagePill("status", overrideStatus, overrideStatus === "approved" ? "root" : overrideStatus === "rejected" ? "changed" : "inherited")}
          ${detail.overrideKind ? renderLineagePill("kind", detail.overrideKind, "inherited") : ""}
          ${detail.protectedScope || detail.overrideScope || detail.scope ? renderLineagePill("scope", detail.protectedScope || detail.overrideScope || detail.scope, "changed") : ""}
          ${detail.targetType || detail.overrideTargetType ? renderLineagePill("target", `${detail.targetType || detail.overrideTargetType}:${detail.targetId || detail.overrideTargetId || detail.id || "-"}`, "inherited") : ""}
        </div>
        ${renderSummaryObjectCard(
          Object.fromEntries(
            [
              ["kind", detail.kind || detail.overrideKind],
              ["status", overrideStatus],
              ["targetType", detail.targetType || detail.overrideTargetType],
              ["targetId", detail.targetId || detail.overrideTargetId],
              ["requestedBy", detail.requestedBy],
              ["reason", detail.reason],
              [
                "scope",
                detail.protectedScope || detail.overrideScope || detail.scope,
              ],
            ].filter(([, value]) => hasDisplayValue(value)),
          ),
          "Override Summary",
          "No override detail returned.",
        )}
        ${renderSummaryObjectCard(detail.links, "Available Routes", "No action routes returned for this override record.")}
        ${renderSuggestedActionsCard(detail.suggestedActions || detail.recommendations, "Suggested Actions", "No suggested actions returned for this override.")}
        ${renderLocalActionForm({
          detail,
          actionKey: ["override", "review", "approve"],
          refreshType: "protected-override",
          refreshId: overrideId,
          label: "Review Override",
          help: "Approve or reject the protected-tier override request.",
          fields: [
            {
              type: "select",
              name: "status",
              label: "Decision",
              value: overrideStatus === "rejected" ? "rejected" : "approved",
              options: [
                { value: "approved", label: "Approved" },
                { value: "rejected", label: "Rejected" },
              ],
            },
            {
              type: "text",
              name: "reason",
              label: "Reason",
              placeholder: "Record the human rationale for this override.",
            },
          ],
        })}
        ${renderLocalActionForm({
          detail,
          actionKey: ["release", "releaseOverride"],
          refreshType: "protected-override",
          refreshId: overrideId,
          label: "Release Override",
          help: "Release a protected-tier override or quarantine when the payload exposes a release route.",
          fields: [
            {
              type: "text",
              name: "reason",
              label: "Reason",
              placeholder: "Why is this override safe to release?",
            },
          ],
        })}
      </section>
    `;
    recentActivitySection = `
      <div class="detail-section">
        <div class="detail-section-heading">
          <h3>Override Context</h3>
          <p class="detail-support">Protected overrides stay auditable and tied to the blocked goal plan, group, or proposal.</p>
        </div>
        ${renderSelfBuildLocalTarget(detail)}
        ${renderSummaryObjectCard(detail.blockers, "Blocked Reasons", "No blocker detail returned.")}
        ${renderSummaryObjectCard(detail.metadata, "Metadata", "No override metadata returned.")}
        ${renderSummaryObjectCard(
          {
            targetType:
              detail.overrideTargetType || detail.targetType || detail.kind,
            targetId: detail.overrideTargetId || detail.targetId || detail.id,
            protectedScope: detail.protectedScope || detail.overrideScope,
            reviewStatus: overrideStatus,
            requestedAt: detail.overrideRequestedAt || detail.createdAt,
          },
          "Override Signals",
          "No override signal summary returned.",
        )}
      </div>
    `;
  } else if (itemType === "doc-suggestion") {
    dependencySection = `
      <section class="detail-section">
        <div class="detail-section-heading">
          <h3>Documentation Suggestion</h3>
          <p class="detail-support">Follow-up documentation work generated from a managed run or proposal lifecycle event.</p>
        </div>
        ${renderSummaryObjectCard(detail, "Suggestion Summary", "No suggestion detail returned.")}
        ${renderSuggestedActionsCard(detail.suggestedActions, "Suggested Actions", "No suggested actions returned for this suggestion.")}
        ${renderSelfBuildOperatorForm({
          endpoint: `/api/orchestrator/doc-suggestions/${encodeURIComponent(detail.id)}/review`,
          refreshType: "doc-suggestion",
          refreshId: detail.id,
          label: "Review Suggestion",
          help: "Accept or dismiss this suggestion before turning it into managed work.",
          fields: [
            {
              type: "select",
              name: "status",
              label: "Decision",
              value: "accepted",
              options: [
                { value: "accepted", label: "Accepted" },
                { value: "dismissed", label: "Dismissed" },
              ],
            },
            {
              type: "text",
              name: "comments",
              label: "Comments",
              placeholder: "Optional operator rationale",
            },
          ],
        })}
        ${renderSelfBuildOperatorForm({
          endpoint: `/api/orchestrator/doc-suggestions/${encodeURIComponent(detail.id)}/materialize`,
          refreshType: "doc-suggestion",
          refreshId: detail.id,
          label: "Materialize Suggestion",
          help: "Create a managed work item from this suggestion.",
          fields: [
            {
              type: "text",
              name: "templateId",
              label: "Template Override",
              value: detail.metadata?.templateId || "",
              placeholder: "Optional template id",
            },
            {
              type: "text",
              name: "title",
              label: "Title Override",
              placeholder: "Optional work item title",
            },
          ],
        })}
      </section>
    `;
    recentActivitySection = `
      <div class="detail-section">
        <div class="detail-section-heading">
          <h3>Suggestion Lineage</h3>
          <p class="detail-support">Inspect raw suggestion payload, metadata, and any materialized managed work item.</p>
        </div>
        ${renderSummaryObjectCard(detail.payload, "Suggestion Payload", "No suggestion payload returned.")}
        ${renderSummaryObjectCard(detail.metadata, "Suggestion Metadata", "No suggestion metadata returned.")}
        <div class="lineage-meta">
          ${detail.links?.workItemRun ? `<a class="inline-link" href="/api/orchestrator${escapeHtml(detail.links.workItemRun)}" target="_blank" rel="noreferrer">work-item run</a>` : ""}
          ${detail.links?.proposal ? `<a class="inline-link" href="/api/orchestrator${escapeHtml(detail.links.proposal)}" target="_blank" rel="noreferrer">proposal</a>` : ""}
          ${detail.links?.materializedWorkItem ? `<button type="button" class="inline-detail-button strong-link" data-open-type="work-item" data-open-id="${escapeHtml(detail.links.materializedWorkItem.split("/").pop() || "")}">materialized work item</button>` : ""}
        </div>
      </div>
    `;
  } else if (itemType === "self-build-intake") {
    dependencySection = `
      <section class="detail-section">
        <div class="detail-section-heading">
          <h3>Autonomous Intake</h3>
          <p class="detail-support">Queued autonomous intake is materialized into a goal plan before managed self-work runs.</p>
        </div>
        ${renderSummaryObjectCard(detail, "Intake Summary", "No intake detail returned.")}
        ${renderSuggestedActionsCard(detail.suggestedActions, "Suggested Actions", "No suggested actions returned for this intake record.")}
        ${renderSelfBuildOperatorForm({
          endpoint: `/api/orchestrator/self-build/intake/${encodeURIComponent(detail.id)}/review`,
          refreshType: "self-build-intake",
          refreshId: detail.id,
          label: "Review Intake",
          help: "Accept or dismiss this intake candidate before materialization.",
          fields: [
            {
              type: "select",
              name: "status",
              label: "Decision",
              value: "accepted",
              options: [
                { value: "accepted", label: "Accepted" },
                { value: "dismissed", label: "Dismissed" },
              ],
            },
            {
              type: "text",
              name: "comments",
              label: "Comments",
              placeholder: "Optional operator notes",
            },
          ],
        })}
        ${renderSelfBuildOperatorForm({
          endpoint: `/api/orchestrator/self-build/intake/${encodeURIComponent(detail.id)}/materialize`,
          refreshType: "self-build-intake",
          refreshId: detail.id,
          label: "Materialize Intake",
          help: "Create a goal plan from this queued autonomous intake.",
          fields: [
            {
              type: "text",
              name: "projectId",
              label: "Project",
              value: detail.projectId || "spore",
            },
          ],
        })}
      </section>
    `;
    recentActivitySection = `
      <div class="detail-section">
        <div class="detail-section-heading">
          <h3>Intake Lineage</h3>
          <p class="detail-support">Track the intake source and any goal plan produced from it.</p>
        </div>
        ${renderSummaryObjectCard(detail.metadata, "Intake Metadata", "No intake metadata returned.")}
        <div class="lineage-meta">
          ${detail.sourceType ? renderLineagePill("source", detail.sourceType, "inherited") : ""}
          ${detail.kind ? renderLineagePill("kind", detail.kind, "inherited") : ""}
          ${detail.links?.goalPlan ? `<button type="button" class="inline-detail-button strong-link" data-open-type="goal-plan" data-open-id="${escapeHtml(detail.links.goalPlan.split("/").pop() || "")}">goal plan</button>` : ""}
        </div>
      </div>
    `;
  } else if (itemType === "integration-branch") {
    recentActivitySection = `
      <div class="detail-section">
        <div class="detail-section-heading">
          <h3>Integration Branch</h3>
          <p class="detail-support">Promotion candidates land here first. This is not the canonical main branch.</p>
        </div>
        ${renderSummaryObjectCard(detail, "Integration Branch Summary", "No integration branch summary returned.")}
        ${renderSummaryObjectCard(detail.diagnostics, "Diagnostics", "No integration diagnostics returned.")}
      </div>
    `;
  } else if (itemType === "work-item-run") {
    recentActivitySection = `
      <div class="detail-section">
        <div class="detail-section-heading">
          <h3>Run Detail</h3>
          <p class="detail-support">This view is route-backed and ties one run to proposal, validation, workspace, and suggestions.</p>
        </div>
        <div class="lineage-meta">
          ${detail.comparisonToPrevious?.previousRunId ? renderLineagePill("previous", detail.comparisonToPrevious.previousRunId, "inherited") : ""}
          ${detail.validationStatus ? renderLineagePill("validation", detail.validationStatus, "inherited") : ""}
          ${detail.workspace?.id ? renderLineagePill("workspace", detail.workspace.id, "root") : ""}
          ${detail.proposal?.id ? renderLineagePill("proposal", detail.proposal.id, "root") : ""}
        </div>
        <article class="detail-card compact-empty">
          <strong>Comparison to previous run</strong>
          <p>${escapeHtml(detail.comparisonToPrevious?.summary || "No previous run available for comparison.")}</p>
        </article>
        ${renderFailureCard(detail.failure, "Failure Classification", "No failure classification returned for this run.")}
        ${renderSuggestedActionsCard(detail.suggestedActions, "Suggested Actions", "No suggested actions returned for this run.")}
        ${renderSummaryObjectCard(detail.validation, "Validation Summary", "No validation summary returned for this run.")}
        ${renderSummaryObjectCard(detail.proposal, "Proposal Summary", "No proposal summary returned for this run.")}
        ${renderSummaryObjectCard(detail.workspace, "Workspace Summary", "No workspace summary returned for this run.")}
        ${renderSummaryObjectCard(detail.docSuggestions, "Documentation Suggestions", "No documentation suggestions returned for this run.")}
        <div class="lineage-meta">
          ${detail.links?.scenarioRun ? `<a class="inline-link" href="/api/orchestrator${escapeHtml(detail.links.scenarioRun)}" target="_blank" rel="noreferrer">scenario run</a>` : ""}
          ${detail.links?.regressionRun ? `<a class="inline-link" href="/api/orchestrator${escapeHtml(detail.links.regressionRun)}" target="_blank" rel="noreferrer">regression run</a>` : ""}
          ${detail.links?.execution ? `<a class="inline-link" href="/api/orchestrator${escapeHtml(detail.links.execution)}" target="_blank" rel="noreferrer">execution</a>` : ""}
        </div>
      </div>
    `;
  } else if (itemType === "workspace") {
    recentActivitySection = `
      <div class="detail-section">
        <div class="detail-section-heading">
          <h3>Workspace Detail</h3>
          <p class="detail-support">Workspace health, branch metadata, and owner linkage for mutating self-work.</p>
        </div>
        <article class="detail-card compact-empty">
          <strong>Path</strong>
          <p><code>${escapeHtml(detail.worktreePath || "-")}</code></p>
        </article>
        <div class="lineage-meta">
          ${detail.branchName ? renderLineagePill("branch", detail.branchName, "root") : ""}
          ${detail.baseRef ? renderLineagePill("base", detail.baseRef, "inherited") : ""}
          ${detail.workItemId ? renderLineagePill("item", detail.workItemId, "inherited") : ""}
          ${detail.workItemRunId ? renderLineagePill("run", detail.workItemRunId, "inherited") : ""}
        </div>
      </div>
    `;
  } else {
    recentActivitySection = `
      <div class="detail-section">
        <h3>Detail Snapshot</h3>
        ${renderGenericDetailRows(detail)}
      </div>
    `;
  }

  els.selfBuildDetailContent.innerHTML =
    lineageHTML + statusSection + dependencySection + recentActivitySection;
}

function handleSelfBuildClick(event) {
  const trigger = event.target.closest("[data-open-type][data-open-id]");
  if (!trigger) return;
  event.preventDefault();
  openSelfBuildDetail(trigger.dataset.openType, trigger.dataset.openId);
}

async function handleDependencyFormSubmit(event) {
  const form = event.target.closest("[data-dependency-form]");
  if (!form) return;
  event.preventDefault();

  const feedback = form.querySelector("[data-dependency-feedback]");
  const groupId = form.dataset.groupId;
  const itemId = form.elements.namedItem("itemId")?.value;
  const dependencyItemId = form.elements.namedItem("dependencyItemId")?.value;
  const strictness = form.elements.namedItem("strictness")?.value || "hard";

  if (!groupId || !itemId || !dependencyItemId) {
    if (feedback)
      feedback.textContent = "Select both items before saving a dependency.";
    return;
  }
  if (itemId === dependencyItemId) {
    if (feedback) feedback.textContent = "A work item cannot depend on itself.";
    return;
  }

  if (feedback) feedback.textContent = "Updating dependency impact...";

  try {
    const response = await fetch(
      `/api/orchestrator/work-item-groups/${encodeURIComponent(groupId)}/dependencies`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          replace: false,
          edges: [
            {
              itemId,
              dependencyItemId,
              strictness,
              autoRelaxation:
                strictness === "advisory"
                  ? {
                      enabled: true,
                      reason:
                        "Advisory dependencies stay visible without blocking group progress.",
                    }
                  : false,
            },
          ],
        }),
      },
    );
    const data = await response.json();
    if (!response.ok || !data.ok || !data.detail) {
      throw new Error(
        data.message || data.error || "Failed to update dependencies.",
      );
    }

    state.selfBuildDependencyImpact = data.impactSummary || null;
    state.selectedWorkItemGroupId = groupId;
    await refreshSelfBuildDashboard();
    renderSelfBuildDetailView("work-item-group", data.detail);
  } catch (error) {
    if (feedback) feedback.textContent = error.message;
  }
}

async function handleOperatorFormSubmit(event) {
  const form = event.target.closest("[data-operator-form]");
  if (!form) return;
  event.preventDefault();

  const feedback = form.querySelector("[data-operator-feedback]");
  const endpoint = form.dataset.endpoint;
  const method = form.dataset.method || "POST";
  const refreshType = form.dataset.refreshType || "";
  const refreshId = form.dataset.refreshId || "";

  if (!endpoint) {
    if (feedback) feedback.textContent = "Missing operator route.";
    return;
  }

  if (feedback) feedback.textContent = "Submitting operator action...";

  try {
    const response = await fetch(endpoint, {
      method,
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(parseOperatorForm(form)),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || data.error || "Operator action failed.");
    }
    if (feedback) feedback.textContent = "Action completed.";
    await refreshSelfBuildDashboard();
    if (refreshType && refreshId) {
      await openSelfBuildDetail(refreshType, refreshId);
    }
  } catch (error) {
    if (feedback) feedback.textContent = error.message;
  }
}

function formatDisplayTimestamp(timestamp) {
  if (!timestamp) return "-";
  try {
    const date = new Date(timestamp);
    return date.toLocaleString();
  } catch {
    return timestamp;
  }
}

// Wire up view navigation
if (els.viewRunCenterButton) {
  els.viewRunCenterButton.addEventListener("click", () =>
    switchView("run-center"),
  );
}

if (els.viewSelfBuildButton) {
  els.viewSelfBuildButton.addEventListener("click", () =>
    switchView("self-build"),
  );
}

if (els.viewOperatorChatButton) {
  els.viewOperatorChatButton.addEventListener("click", () =>
    switchView("operator-chat"),
  );
}

if (els.selfBuildBackButton) {
  els.selfBuildBackButton.addEventListener("click", () => {
    if (els.selfBuildDetailOverlay) {
      els.selfBuildDetailOverlay.style.display = "none";
    }
  });
}

if (els.selfBuildFilterForm) {
  els.selfBuildFilterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    state.selfBuildFilters = {
      status: els.selfBuildStatusFilter?.value?.trim() || "",
      group: els.selfBuildGroupFilter?.value?.trim() || "",
      template: els.selfBuildTemplateFilter?.value?.trim() || "",
      domain: els.selfBuildDomainFilter?.value?.trim() || "",
    };
    refreshSelfBuildDashboard();
  });
}

if (els.selfBuildFilterReset) {
  els.selfBuildFilterReset.addEventListener("click", () => {
    state.selfBuildFilters = {
      status: "",
      group: "",
      template: "",
      domain: "",
    };
    if (els.selfBuildStatusFilter) els.selfBuildStatusFilter.value = "";
    if (els.selfBuildGroupFilter) els.selfBuildGroupFilter.value = "";
    if (els.selfBuildTemplateFilter) els.selfBuildTemplateFilter.value = "";
    if (els.selfBuildDomainFilter) els.selfBuildDomainFilter.value = "";
    refreshSelfBuildDashboard();
  });
}

if (els.operatorThreadForm) {
  els.operatorThreadForm.addEventListener("submit", (event) => {
    event.preventDefault();
    createOperatorThreadFromForm();
  });
}

if (els.operatorChatComposer) {
  els.operatorChatComposer.addEventListener("submit", (event) => {
    event.preventDefault();
    sendOperatorChatReply();
  });
}

[
  els.groupReadinessList,
  els.urgentWorkQueue,
  els.followUpQueue,
  els.selfBuildDetailContent,
].forEach((element) => {
  if (element) {
    element.addEventListener("click", handleSelfBuildClick);
  }
});

[els.selfBuildRecentRuns, els.selfBuildWorkspaceHealth].forEach((element) => {
  if (element) {
    element.addEventListener("click", handleSelfBuildClick);
  }
});

[
  els.operatorThreadList,
  els.operatorInboxList,
  els.operatorCurrentDecision,
  els.operatorQuickReplies,
  els.operatorMessageList,
  els.operatorPendingActions,
  els.operatorLinkedArtifacts,
].forEach((element) => {
  if (element) {
    element.addEventListener("click", (event) => {
      handleOperatorChatClick(event);
    });
  }
});

if (els.selfBuildDetailContent) {
  els.selfBuildDetailContent.addEventListener(
    "submit",
    handleDependencyFormSubmit,
  );
  els.selfBuildDetailContent.addEventListener(
    "submit",
    handleOperatorFormSubmit,
  );
}

[els.selfBuildAttentionSummary, els.selfBuildOverview].forEach((element) => {
  if (element) {
    element.addEventListener("submit", handleOperatorFormSubmit);
  }
});

// Initialize view (default to run-center)
switchView("run-center");
