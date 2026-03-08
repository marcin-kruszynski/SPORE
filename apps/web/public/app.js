const state = {
  sessions: [],
  selectedSessionId: null,
  detail: null,
  artifacts: null,
  transcript: null,
  piEvents: null,
  executions: [],
  selectedExecutionId: null,
  executionDetail: null,
  executionListError: null,
  executionDetailError: null,
  workflowPreview: null,
  workflowPreviewError: null,
  workflowPreviewDirty: false,
  workflowPreviewSource: null,
  autoRefreshTimer: null,
  eventSource: null,
  executionEventSource: null,
  activeTab: "events"
};

const els = {
  sessionCount: document.getElementById("session-count"),
  eventCount: document.getElementById("event-count"),
  stateSummary: document.getElementById("state-summary"),
  executionCount: document.getElementById("execution-count"),
  coordinationCount: document.getElementById("coordination-count"),
  executionSubtitle: document.getElementById("execution-subtitle"),
  executionList: document.getElementById("execution-list"),
  executionDetailSubtitle: document.getElementById("execution-detail-subtitle"),
  executionDetail: document.getElementById("execution-detail"),
  executionTree: document.getElementById("execution-tree"),
  executionTimeline: document.getElementById("execution-timeline"),
  decisionLog: document.getElementById("decision-log"),
  driveButton: document.getElementById("drive-button"),
  driveGroupButton: document.getElementById("drive-group-button"),
  driveWait: document.getElementById("drive-wait"),
  driveTimeout: document.getElementById("drive-timeout"),
  driveInterval: document.getElementById("drive-interval"),
  pauseButton: document.getElementById("pause-button"),
  holdButton: document.getElementById("hold-button"),
  resumeButton: document.getElementById("resume-button"),
  executionOperatorReason: document.getElementById("execution-operator-reason"),
  executionOperatorComments: document.getElementById("execution-operator-comments"),
  executionGuidance: document.getElementById("execution-guidance"),
  reviewStatus: document.getElementById("review-status"),
  reviewBy: document.getElementById("review-by"),
  reviewComments: document.getElementById("review-comments"),
  reviewButton: document.getElementById("review-button"),
  approvalStatus: document.getElementById("approval-status"),
  approvalBy: document.getElementById("approval-by"),
  approvalComments: document.getElementById("approval-comments"),
  approvalButton: document.getElementById("approval-button"),
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
  tabPanels: Array.from(document.querySelectorAll(".tab-panel"))
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
      .filter((value) => String(value ?? "").trim())
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
  if (execution?.state === "waiting_review" || execution?.state === "waiting_approval") {
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
  const text = value === null || value === undefined || value === "" ? label : `${label}:${value}`;
  const className = tone ? `lineage-pill ${tone}` : "lineage-pill";
  return `<span class="${className}">${escapeHtml(text)}</span>`;
}

function renderExecutionModePills(execution) {
  const pills = [];
  const mode = deriveExecutionMode(execution);
  if (mode === "paused") {
    pills.push(renderMetaPill("paused", execution?.pausedAt ? "operator" : "", "paused"));
  }
  if (mode === "held") {
    pills.push(renderMetaPill("held", execution?.holdReason ?? "operator", "held"));
  }
  if (execution?.reviewStatus) {
    pills.push(renderMetaPill("review", execution.reviewStatus, "governance"));
  }
  if (execution?.approvalStatus) {
    pills.push(renderMetaPill("approval", execution.approvalStatus, "governance"));
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

  const attempts = workflowPolicy.maxAttempts ?? workflowPolicy.defaultMaxAttempts;
  if (hasDisplayValue(attempts)) {
    pills.push(renderMetaPill("attempts", attempts));
  }
  if (hasDisplayValue(workflowPolicy.stepSoftTimeoutMs)) {
    pills.push(renderMetaPill("soft", `${workflowPolicy.stepSoftTimeoutMs}ms`, "paused"));
  }
  if (hasDisplayValue(workflowPolicy.stepHardTimeoutMs)) {
    pills.push(renderMetaPill("hard", `${workflowPolicy.stepHardTimeoutMs}ms`, "held"));
  }
  if (hasDisplayValue(runtimePolicy.sessionMode)) {
    pills.push(renderMetaPill("mode", runtimePolicy.sessionMode));
  } else if (isObject(runtimePolicy.sessionModeByRole) && Object.keys(runtimePolicy.sessionModeByRole).length > 0) {
    pills.push(renderMetaPill("modes", Object.keys(runtimePolicy.sessionModeByRole).length));
  }
  if (hasDisplayValue(docsKbPolicy.resultLimit)) {
    pills.push(renderMetaPill("docs", docsKbPolicy.resultLimit));
  }
  if (hasDisplayValue(governance.reviewRequired)) {
    pills.push(renderMetaPill("review", governance.reviewRequired ? "required" : "optional", "governance"));
  }
  if (hasDisplayValue(governance.approvalRequired)) {
    pills.push(renderMetaPill("approval", governance.approvalRequired ? "required" : "optional", "governance"));
  }

  return pills.join("");
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
            `
          )
          .join("")}
      </div>
    </article>
  `;
}

function renderPolicyPanel({ title, policy, emptyText = "No policy returned.", compact = false } = {}) {
  const panelClass = compact ? "policy-panel compact" : "policy-panel";
  const highlights = renderPolicyHighlights(policy);

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
        ${highlights ? `<div class="lineage-meta">${highlights}</div>` : ""}
      </div>
      <div class="policy-block-list">
        ${blocks || renderPolicyBlock("Policy", policy)}
      </div>
    </section>
  `;
}

function readFirstField(record, keys = []) {
  for (const key of keys) {
    if (hasDisplayValue(record?.[key])) {
      return record[key];
    }
  }
  return null;
}

function collectGuidanceItems(record = {}, policy = null) {
  const items = [];
  const push = (label, value, tone = "") => {
    if (hasDisplayValue(value)) {
      items.push({ label, value, tone });
    }
  };

  push("Hold Owner", readFirstField(record, ["holdOwner", "holdOwnerId", "heldBy", "owner"]));
  push("Ownership Scope", readFirstField(record, ["holdOwnerRole", "ownerRole", "ownerType", "ownerScope"]));
  push("Hold Timeout At", readFirstField(record, ["holdTimeoutAt", "timeoutAt", "deadlineAt", "heldUntil", "resumeBy"]), "paused");
  push("Hold Timeout Ms", readFirstField(record, ["holdTimeoutMs", "timeoutMs", "deadlineMs"]), "paused");
  push(
    "Operator Guidance",
    readFirstField(record, ["operatorGuidance", "holdGuidance", "timeoutGuidance", "guidance", "recoveryGuidance"])
  );

  const workflowPolicy = policy?.workflowPolicy ?? {};
  push("Policy Soft Timeout", hasDisplayValue(workflowPolicy.stepSoftTimeoutMs) ? `${workflowPolicy.stepSoftTimeoutMs} ms` : null, "paused");
  push("Policy Hard Timeout", hasDisplayValue(workflowPolicy.stepHardTimeoutMs) ? `${workflowPolicy.stepHardTimeoutMs} ms` : null, "held");

  return items;
}

function renderGuidancePanel({ id = "", title, record, policy, emptyText = "No hold ownership or timeout guidance returned." } = {}) {
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
            `
          )
          .join("")}
      </div>
    </div>
  `;
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
    maxRoles: roles.length || 1
  };
}

function captureWorkflowPreview(invocation, source) {
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
      executions: []
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
        return leftRank - rightRank || String(left.id).localeCompare(String(right.id));
      })
    }))
    .sort((left, right) => {
      if (left.groupId && !right.groupId) return -1;
      if (!left.groupId && right.groupId) return 1;
      return String(left.groupId ?? left.key).localeCompare(String(right.groupId ?? right.key));
    });

  return orderedGroups;
}

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    headers: {
      "content-type": "application/json"
    },
    ...options
  });

  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }
  if (!response.ok) {
    throw new Error(payload.message || payload.error || `request failed: ${response.status}`);
  }
  return payload;
}

function renderStatus(status) {
  els.sessionCount.textContent = String(status.sessionCount ?? "-");
  els.eventCount.textContent = String(status.eventCount ?? "-");
  const states = Object.entries(status.byState ?? {})
    .map(([key, value]) => `${key}:${value}`)
    .join(" · ");
  els.stateSummary.textContent = states || "-";
  els.executionCount.textContent = String(state.executions.length);
  els.coordinationCount.textContent = String(uniqueCoordinationGroupCount(state.executions));
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
      const rootCount = group.executions.filter((execution) => !execution.parentExecutionId).length;
      const childCount = group.executions.filter((execution) => execution.parentExecutionId).length;
      return `
        <section class="execution-group-card ${group.groupId ? "grouped" : "standalone"}">
          <div class="execution-group-header">
            <div>
              <strong>${escapeHtml(group.groupId ?? "Standalone Execution")}</strong>
              <div class="execution-group-meta">
                <code>${escapeHtml(group.groupId ? `coordination=${group.groupId}` : group.executions[0]?.id ?? "")}</code>
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
                const activeClass = execution.id === state.selectedExecutionId ? "active" : "";
                const modeClass = deriveExecutionMode(execution);
                const parentLabel = execution.parentExecutionId ? `parent=${execution.parentExecutionId}` : "root";
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

  for (const item of els.executionList.querySelectorAll("[data-execution-id]")) {
    item.addEventListener("click", () => {
      state.selectedExecutionId = item.dataset.executionId;
      connectExecutionEventStream();
      refresh().catch((error) => console.error(error));
    });
  }
}

function renderExecutionMiniCard(execution, { label, selectedId } = {}) {
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
      </div>
    </article>
  `;
}

function renderWorkflowLaunchPreview(launch, index) {
  const roleLabel = launch?.role ? `${launch.role}` : `step-${index + 1}`;
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
        ${renderPolicyHighlights(launch?.policy)}
      </div>
      ${renderPolicyPanel({
        title: `Step Policy ${index + 1}`,
        policy: launch?.policy,
        compact: true,
        emptyText: "No step policy returned."
      })}
    </article>
  `;
}

function renderExecutionLineageBoard(detail) {
  const execution = detail?.execution;
  if (!execution) {
    return "";
  }

  const groupSummary = detail?.coordinationGroupSummary ?? null;
  const groupMembers = detail?.coordinationGroup ?? groupSummary?.executions ?? [];
  const children = detail?.childExecutions ?? [];
  const parentExecution =
    execution.parentExecutionId && Array.isArray(groupMembers)
      ? groupMembers.find((candidate) => candidate.id === execution.parentExecutionId)
      : null;
  const siblingExecutions = Array.isArray(groupMembers)
    ? groupMembers.filter((candidate) => candidate.id !== execution.id && candidate.parentExecutionId === execution.parentExecutionId)
    : [];

  if (!execution.coordinationGroupId && !execution.parentExecutionId && children.length === 0) {
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
          label: execution.parentExecutionId ? "Current child execution" : "Current root execution",
          selectedId: execution.id
        })}
        ${
          parentExecution
            ? renderExecutionMiniCard(parentExecution, { label: "Parent execution", selectedId: execution.id })
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
                      label: childExecution.branchKey ? `Branch ${childExecution.branchKey}` : "Child execution",
                      selectedId: execution.id
                    })
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
                      label: sibling.branchKey ? `Branch ${sibling.branchKey}` : "Sibling execution",
                      selectedId: execution.id
                    })
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

function renderExecutionTree(detail) {
  const steps = detail?.steps ?? [];
  const sessionMap = new Map((detail?.sessions ?? []).map((item) => [item.sessionId, item.session]));
  const stepBySessionId = new Map(
    steps.filter((step) => step.sessionId).map((step) => [step.sessionId, step])
  );
  const lineageBoard = renderExecutionLineageBoard(detail);

  if (steps.length === 0 && !lineageBoard) {
    els.executionTree.className = "execution-tree empty-state";
    els.executionTree.textContent = "No step records returned for this execution.";
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
          const session = step.sessionId ? sessionMap.get(step.sessionId) : null;
          const parentStep = step.parentSessionId ? stepBySessionId.get(step.parentSessionId) : null;
          const childCount = step.sessionId
            ? steps.filter((candidate) => candidate.parentSessionId === step.sessionId).length
            : 0;
          const lineageLabel = step.parentSessionId
            ? parentStep
              ? `inherits from step ${parentStep.sequence + 1}`
              : "inherits from unresolved parent"
            : "root step";
          const objective = String(step.objective ?? "").trim();
          const stepPolicy = step.policy ?? null;
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
                  compact: true,
                  emptyText: "No per-step policy returned."
                })}
                ${renderGuidancePanel({
                  title: "Hold / Timeout Guidance",
                  record: step,
                  policy: stepPolicy,
                  emptyText: "No step-specific hold ownership or timeout guidance returned."
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
    els.executionTimeline.textContent = "Select an execution to load timeline and history.";
    return;
  }

  const workflowEvents = detail?.events ?? [];
  const rows = [];
  const pushRow = (timestamp, title, meta = "", tone = "neutral", sortBias = 0) => {
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
      sortBias
    });
  }

  if (workflowEvents.length > 0) {
    const toneForType = (type, payload) => {
      if (type.includes("failed") || type.includes("rejected") || type.includes("escalated")) return "failed";
      if (type.includes("completed") || type.includes("approved")) return "completed";
      if (type.includes("paused") || type.includes("held")) return "paused";
      if (type.includes("started") || type.includes("pending")) return "running";
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
          Object.keys(payload).length > 0 ? JSON.stringify(payload) : null
        ].filter(Boolean).join(" · "),
        toneForType(event.type, payload),
        Number(event.eventIndex ?? 0)
      );
    }
  } else {
    pushRow(execution.createdAt, "Execution created", execution.id, "neutral");
    pushRow(execution.startedAt, "Execution started", execution.state, "running");
    pushRow(execution.pausedAt, "Execution paused", execution.holdReason ?? "operator pause", "paused");
    pushRow(execution.heldAt, "Execution held", execution.holdReason ?? "operator hold", "paused");
    pushRow(execution.resumedAt, "Execution resumed", execution.heldFromState ?? "resumed", "running");

    for (const step of detail?.steps ?? []) {
      pushRow(
        step.launchedAt,
        `Step ${step.sequence + 1} launched`,
        `${step.role} · ${normalizeText(step.sessionId)}`,
        "running"
      );
      pushRow(
        step.settledAt,
        `Step ${step.sequence + 1} settled`,
        `${step.role} · ${step.state}`,
        ["failed", "stopped", "rejected"].includes(step.state) ? "failed" : "completed"
      );
    }

    for (const review of detail?.reviews ?? []) {
      pushRow(
        review.decidedAt,
        "Review decision",
        `${review.status} · ${normalizeText(review.decidedBy)}`,
        review.status === "approved" ? "completed" : "failed"
      );
    }

    for (const approval of detail?.approvals ?? []) {
      pushRow(
        approval.decidedAt,
        "Approval decision",
        `${approval.status} · ${normalizeText(approval.decidedBy)}`,
        approval.status === "approved" ? "completed" : "failed"
      );
    }

    pushRow(execution.endedAt, "Execution ended", execution.state, "completed");
  }

  rows.sort((left, right) => (left.ts - right.ts) || (left.sortBias - right.sortBias));
  if (rows.length === 0) {
    els.executionTimeline.className = "execution-timeline empty-state";
    els.executionTimeline.textContent = "No timeline events recorded for this execution.";
    return;
  }

  const duration = formatDuration(execution.startedAt, execution.endedAt ?? execution.updatedAt);
  els.executionTimeline.className = "execution-timeline";
  els.executionTimeline.innerHTML = `
    <div class="timeline-summary">
      <code>${escapeHtml(rows.length)} timeline events</code>
      <code>duration=${escapeHtml(duration)}</code>
      <code>state=${escapeHtml(normalizeText(execution.state))}</code>
    </div>
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
          `
        )
        .join("")}
    </ol>
  `;
}

function renderDecisionLog(detail) {
  const reviews = detail?.reviews ?? [];
  const approvals = detail?.approvals ?? [];
  const escalations = detail?.escalations ?? [];

  if (reviews.length === 0 && approvals.length === 0 && escalations.length === 0) {
    els.decisionLog.innerHTML = `<div class="detail-card empty-state">No review, approval, or escalation records.</div>`;
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
        `
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
    </div>
  `;

  for (const button of els.decisionLog.querySelectorAll(".escalation-action")) {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await sendEscalationAction(button.dataset.escalationId, {
          by: "operator",
          comments: button.dataset.resume === "true"
            ? "Operator resolved escalation and resumed execution."
            : "Operator resolved escalation.",
          resume: button.dataset.resume === "true"
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
      "Preview a workflow plan to inspect merged policy, launch defaults, and per-step governance before invocation.";
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
      emptyText: "No merged execution policy returned."
    })}
    <section class="workflow-launch-section">
      <div class="policy-panel-header">
        <strong>Launch Policies</strong>
        <span class="muted">${escapeHtml(String(launches.length))} launch${launches.length === 1 ? "" : "es"}</span>
      </div>
      ${
        launches.length > 0
          ? `<div class="workflow-launch-list">${launches
              .map((launch, index) => renderWorkflowLaunchPreview(launch, index))
              .join("")}</div>`
          : `<div class="policy-empty">No launch preview returned.</div>`
      }
    </section>
  `;
}

function renderExecutionDetail() {
  const detail = state.executionDetail;
  const execution = detail?.execution;
  const hasSelection = Boolean(execution);
  const groupId = execution?.coordinationGroupId ?? null;
  const isInterrupted = execution?.state === "paused" || execution?.state === "held";
  const childExecutions = detail?.childExecutions ?? [];
  const groupSummary = detail?.coordinationGroupSummary ?? null;
  const groupMembers = detail?.coordinationGroup ?? groupSummary?.executions ?? [];
  const effectivePolicy = execution?.policy ?? null;

  els.driveButton.disabled = !hasSelection;
  els.driveGroupButton.disabled = !hasSelection || !groupId;
  els.pauseButton.disabled = !hasSelection || isInterrupted;
  els.holdButton.disabled = !hasSelection || execution?.state === "held";
  els.resumeButton.disabled = !hasSelection || !["paused", "held"].includes(execution?.state);
  els.reviewButton.disabled = !hasSelection;
  els.approvalButton.disabled = !hasSelection;

  if (!execution) {
    els.executionDetailSubtitle.textContent = "Select an execution";
    els.executionStreamState.textContent = "execution stream: idle";
    els.executionDetail.className = "detail-card empty-state";
    els.executionDetail.textContent = state.executionDetailError
      ? `Failed to load execution detail: ${state.executionDetailError}`
      : "Select an execution to inspect durable orchestration state, step/session lineage, and governance controls.";
    els.executionTree.className = "execution-tree empty-state";
    els.executionTree.textContent = "Select an execution to load steps.";
    els.executionTimeline.className = "execution-timeline empty-state";
    els.executionTimeline.textContent = "Select an execution to load timeline and history.";
    els.decisionLog.innerHTML = `<div class="detail-card empty-state">Select an execution to load review and approval history.</div>`;
    els.executionGuidance.className = "operator-guidance empty-state";
    els.executionGuidance.textContent = "Select an execution to inspect hold ownership and timeout guidance.";
    return;
  }

  els.executionDetailSubtitle.textContent = `${execution.id} · ${execution.state}`;
  els.executionDetail.className = "detail-card";
  els.executionDetail.innerHTML = `
    <div class="session-title">
      <strong>${escapeHtml(execution.id)}</strong>
      ${renderStatePill(execution.state)}
    </div>
    <div class="lineage-meta detail-pills">
      ${renderExecutionModePills(execution)}
      ${groupId ? renderMetaPill("group", groupId) : ""}
      ${execution.parentExecutionId ? renderMetaPill("parent", execution.parentExecutionId, "child") : ""}
      ${childExecutions.length ? renderMetaPill("children", childExecutions.length, "child") : ""}
      ${
        execution.heldFromState
          ? renderMetaPill("held-from", execution.heldFromState, execution.state === "held" ? "held" : "")
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
      <div><span class="muted">Child Executions</span><br /><code>${escapeHtml(String(childExecutions.length || execution.childExecutionIds?.length || 0))}</code></div>
      <div><span class="muted">Branch Key</span><br /><code>${escapeHtml(normalizeText(execution.branchKey))}</code></div>
      <div><span class="muted">Paused At</span><br /><code>${formatTimestamp(execution.pausedAt)}</code></div>
      <div><span class="muted">Held At</span><br /><code>${formatTimestamp(execution.heldAt)}</code></div>
      <div><span class="muted">Resumed At</span><br /><code>${formatTimestamp(execution.resumedAt)}</code></div>
      <div><span class="muted">Hold Reason</span><br /><code>${escapeHtml(normalizeText(execution.holdReason))}</code></div>
      ${
        groupSummary
          ? `<div><span class="muted">Group States</span><br /><code>${escapeHtml(
              Object.entries(groupSummary.byState ?? {})
                .map(([key, value]) => `${key}:${value}`)
                .join(" · ")
            )}</code></div>`
          : ""
      }
      ${
        groupSummary
          ? `<div><span class="muted">Group Members</span><br /><code>${escapeHtml(String(groupSummary.executionCount ?? groupMembers.length))}</code></div>`
          : ""
      }
      <div class="detail-span"><span class="muted">Objective</span><br /><code>${escapeHtml(normalizeText(execution.objective))}</code></div>
    </div>
    ${renderPolicyPanel({
      title: "Effective Policy",
      policy: effectivePolicy,
      emptyText: "No execution policy was persisted for this run."
    })}
  `;

  els.executionGuidance.outerHTML = renderGuidancePanel({
    id: "execution-guidance",
    title: "Hold / Timeout Guidance",
    record: execution,
    policy: effectivePolicy,
    emptyText: "No hold ownership or timeout guidance returned for this execution."
  });
  els.executionGuidance = document.getElementById("execution-guidance");

  renderExecutionTree(detail);
  renderExecutionTimeline(detail);
  renderDecisionLog(detail);
}

function renderSessions() {
  if (state.sessions.length === 0) {
    els.sessionList.innerHTML = `<div class="detail-card empty-state">No sessions yet.</div>`;
    return;
  }

  els.sessionList.innerHTML = state.sessions
    .map((session) => {
      const activeClass = session.id === state.selectedSessionId ? "active" : "";
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

function renderDetail() {
  const detail = state.detail;
  const session = detail?.session;
  const events = detail?.events ?? [];

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
    els.transcriptView.textContent = "Select a session to load transcript artifacts.";
    els.piEventsView.textContent = "Select a session to load PI event artifacts.";
    els.artifactList.innerHTML = "";
    return;
  }

  els.detailSubtitle.textContent = `${session.id} · ${session.state}`;
  els.sessionDetail.className = "detail-card";
  els.sessionDetail.innerHTML = `
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
                ${formatObject(event.payload)}
              </div>
            </article>
          `
        )
        .join("")
    : `<div class="detail-card empty-state">No events for this session.</div>`;

  renderArtifacts();
}

function renderArtifacts() {
  const artifacts = state.artifacts;
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
      `
    )
    .join("");

  els.transcriptView.textContent = state.transcript ?? "Transcript artifact missing.";
  els.piEventsView.textContent = state.piEvents ?? "PI event artifact missing.";
}

async function loadArtifacts() {
  if (!state.selectedSessionId) {
    state.artifacts = null;
    state.transcript = null;
    state.piEvents = null;
    return;
  }

  const artifactsPayload = await api(`/sessions/${encodeURIComponent(state.selectedSessionId)}/artifacts`);
  state.artifacts = artifactsPayload.artifacts;

  const transcriptArtifact = artifactsPayload.artifacts?.transcript;
  if (transcriptArtifact?.exists) {
    const payload = await api(`/sessions/${encodeURIComponent(state.selectedSessionId)}/artifacts/transcript`);
    state.transcript = payload.content;
  } else {
    state.transcript = null;
  }

  const piEventsArtifact = artifactsPayload.artifacts?.piEvents;
  if (piEventsArtifact?.exists) {
    const payload = await api(`/sessions/${encodeURIComponent(state.selectedSessionId)}/artifacts/piEvents`);
    state.piEvents = JSON.stringify(payload.content, null, 2);
  } else {
    state.piEvents = null;
  }
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

  if (state.selectedExecutionId && !state.executions.some((item) => item.id === state.selectedExecutionId)) {
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
    const [detailPayload, eventsPayload, escalationsPayload] = await Promise.all([
      api(`/orchestrator/executions/${executionId}`),
      api(`/orchestrator/executions/${executionId}/events`),
      api(`/orchestrator/executions/${executionId}/escalations`)
    ]);
    const detail = detailPayload.detail ?? null;
    if (detail) {
      detail.events = eventsPayload.events ?? detail.events ?? [];
      detail.escalations = escalationsPayload.escalations ?? detail.escalations ?? [];
      const followUps = [];
      followUps.push(
        api(`/orchestrator/executions/${executionId}/children`).catch(() => null)
      );
      if (detail.execution?.coordinationGroupId) {
        followUps.push(
          api(`/orchestrator/coordination-groups/${encodeURIComponent(detail.execution.coordinationGroupId)}`).catch(() => null)
        );
      } else {
        followUps.push(Promise.resolve(null));
      }

      const [childrenPayload, groupPayload] = await Promise.all(followUps);
      if (childrenPayload?.children) {
        detail.childExecutions = childrenPayload.children;
      }
      if (groupPayload?.detail?.summary) {
        detail.coordinationGroupSummary = groupPayload.detail.summary;
        detail.coordinationGroup = groupPayload.detail.summary.executions ?? detail.coordinationGroup ?? [];
      }
    }
    state.executionDetail = detail;
    state.executionDetailError = null;
  } catch (error) {
    state.executionDetail = null;
    state.executionDetailError = error.message;
  }
}

async function refresh() {
  const [statusPayload, sessionsPayload] = await Promise.all([api("/status"), api("/sessions")]);
  state.sessions = sessionsPayload.sessions ?? [];

  if (!state.selectedSessionId && state.sessions[0]) {
    state.selectedSessionId = state.sessions[0].id;
    connectEventStream();
  }

  await loadExecutionSummaries();

  const detailPromises = [];
  if (state.selectedSessionId) {
    detailPromises.push(api(`/sessions/${encodeURIComponent(state.selectedSessionId)}?limit=20`));
    detailPromises.push(loadArtifacts());
  } else {
    state.detail = null;
    state.artifacts = null;
    state.transcript = null;
    state.piEvents = null;
  }

  detailPromises.push(loadExecutionDetail());
  const results = await Promise.all(detailPromises);
  if (state.selectedSessionId) {
    state.detail = results[0];
  }

  renderStatus(statusPayload.status);
  renderExecutions();
  renderSessions();
  renderWorkflowPreview();
  renderExecutionDetail();
  renderDetail();
}

async function sendAction(action, payload = {}) {
  if (!state.selectedSessionId) {
    return;
  }
  await api(`/sessions/${encodeURIComponent(state.selectedSessionId)}/actions/${action}`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  await refresh();
}

async function sendExecutionAction(action, payload = {}) {
  if (!state.selectedExecutionId) {
    return;
  }
  await api(`/orchestrator/executions/${encodeURIComponent(state.selectedExecutionId)}/${action}`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  await refresh();
}

async function sendExecutionGroupAction(action, payload = {}) {
  const groupId = state.executionDetail?.execution?.coordinationGroupId;
  if (!groupId) {
    return;
  }
  await api(`/orchestrator/coordination-groups/${encodeURIComponent(groupId)}/${action}`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
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
      body: JSON.stringify(payload)
    }
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
      body: JSON.stringify(getWorkflowRequestPayload())
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
  const source = new EventSource(`/api/orchestrator/stream/executions?${params.toString()}`);
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
    await sendExecutionAction("drive", {
      wait: els.driveWait.checked,
      timeout: parsePositiveInt(els.driveTimeout.value) ?? undefined,
      interval: parsePositiveInt(els.driveInterval.value) ?? undefined
    });
  } catch (error) {
    alert(error.message);
  } finally {
    renderExecutionDetail();
  }
});

els.driveGroupButton.addEventListener("click", async () => {
  els.driveGroupButton.disabled = true;
  try {
    await sendExecutionGroupAction("drive", {
      wait: els.driveWait.checked,
      timeout: parsePositiveInt(els.driveTimeout.value) ?? undefined,
      interval: parsePositiveInt(els.driveInterval.value) ?? undefined
    });
  } catch (error) {
    alert(error.message);
  } finally {
    renderExecutionDetail();
  }
});

function buildOperatorStatePayload() {
  return {
    by: "operator",
    reason: els.executionOperatorReason.value.trim() || "Operator intervention.",
    comments: els.executionOperatorComments.value.trim()
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
    const payload = buildOperatorStatePayload();
    await sendExecutionAction("resume", {
      by: payload.by,
      comments: payload.comments || payload.reason
    });
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
      comments: els.reviewComments.value.trim()
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
      comments: els.approvalComments.value.trim()
    });
  } catch (error) {
    alert(error.message);
  } finally {
    renderExecutionDetail();
  }
});

els.stopButton.addEventListener("click", () => {
  sendAction("stop", { reason: "web-operator stop", force: true }).catch((error) => alert(error.message));
});

els.completeButton.addEventListener("click", () => {
  sendAction("mark-complete", { reason: "web-operator complete" }).catch((error) => alert(error.message));
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
        wait: false
      })
    });

    captureWorkflowPreview(payload?.invocation ?? null, "invoke");
    const createdExecutionId =
      payload?.created?.execution?.id ?? payload?.invocation?.invocationId ?? payload?.detail?.execution?.id ?? null;
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

for (const element of [els.workflowDomain, els.workflowRoles, els.workflowObjective]) {
  element.addEventListener("input", () => {
    markWorkflowPreviewStale();
  });
}

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
