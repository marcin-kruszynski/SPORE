import {
  resolveInboxRowContent,
  type OperatorActionProjection,
  type OperatorThreadFallback,
} from "./operator-chat-controller.js";

interface OperatorThreadDetail {
  title?: string;
  hero?: {
    title?: string;
    statusLine?: string;
    phase?: string;
    primaryCtaHint?: string | null;
    badges?: Record<string, string>;
  } | null;
  progress?: {
    currentStage?: string;
    currentState?: string;
    exceptionState?: string | null;
    stages?: Array<{
      id?: string;
      label?: string;
      status?: string;
    }>;
  } | null;
  decisionGuidance?: {
    title?: string;
    why?: string;
    nextIfApproved?: string;
    riskNote?: string | null;
    primaryAction?: string;
    secondaryActions?: string[];
    suggestedReplies?: string[];
  } | null;
  evidenceSummary?: Record<string, unknown> | null;
  pendingActions?: Array<{
    id?: string;
    choices?: Array<{
      value?: string;
      label?: string;
      tone?: string;
    }>;
  }>;
}

interface RenderCurrentDecisionOptions {
  emphasized?: boolean;
  highlightedActionId?: string | null;
}

interface RenderInboxRowOptions {
  active?: boolean;
  threadFallback?: OperatorThreadFallback | null;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toText(value: unknown, fallback = ""): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function stateClass(value: unknown): string {
  return toText(value, "unknown").toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
}

function renderStatusBadge(value: unknown, extraClass = ""): string {
  const classes = ["status-badge", stateClass(value)];
  if (extraClass) {
    classes.push(extraClass);
  }
  return `<span class="${classes.join(" ")}">${escapeHtml(toText(value, "pending"))}</span>`;
}

function renderActionButtons(detail: OperatorThreadDetail): string {
  const action = Array.isArray(detail.pendingActions) ? detail.pendingActions[0] : null;
  const choices = Array.isArray(action?.choices) ? action.choices : [];
  if (!action?.id || choices.length === 0) {
    return "";
  }

  return `
    <div class="operator-action-controls operator-current-decision-actions">
      ${choices
        .map((choice) => {
          const tone = choice.tone === "primary" ? "primary" : "secondary";
          return `
            <button
              type="button"
              class="operator-action-button ${tone}"
              data-operator-action-id="${escapeHtml(String(action.id))}"
              data-operator-action-choice="${escapeHtml(toText(choice.value, "approve"))}"
            >
              ${escapeHtml(toText(choice.label, toText(choice.value, "Action")))}
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}

export function renderOperatorMissionHero(detail: OperatorThreadDetail | null): string {
  const hero = detail?.hero ?? null;
  if (!hero) {
    return '<article class="operator-mission-hero-card empty-state">Select a mission to load the operator-authored mission brief.</article>';
  }

  const badges = Object.values(hero.badges ?? {}).filter(Boolean);
  return `
    <article class="panel operator-mission-hero-card">
      <div class="operator-mission-hero-copy">
        <p class="eyebrow">Guided mission</p>
        <h3>${escapeHtml(toText(hero.title, detail?.title ?? "Mission"))}</h3>
        <p class="operator-mission-status">${escapeHtml(toText(hero.statusLine, "Mission update pending."))}</p>
      </div>
      <div class="operator-mission-hero-meta">
        ${renderStatusBadge(hero.phase ?? "Mission", "phase")}
        ${hero.primaryCtaHint ? `<span class="detail-pill emphasized">${escapeHtml(hero.primaryCtaHint)}</span>` : ""}
        <div class="operator-mission-badges">
          ${badges
            .map((badge) => `<span class="detail-pill">${escapeHtml(String(badge))}</span>`)
            .join("")}
        </div>
      </div>
    </article>
  `;
}

export function renderOperatorProgress(detail: OperatorThreadDetail | null): string {
  const stages = Array.isArray(detail?.progress?.stages) ? detail?.progress?.stages : [];
  if (stages.length === 0) {
    return '<article class="panel operator-progress-strip-track empty-state">Mission progress will appear here.</article>';
  }

  return `
    <article class="panel operator-progress-strip-track">
      ${stages
        .map((stage) => `
          <div class="operator-progress-stage ${escapeHtml(stateClass(stage.status))}" data-stage-id="${escapeHtml(toText(stage.id, "stage"))}">
            <span class="operator-progress-stage-status">${escapeHtml(toText(stage.status, "upcoming"))}</span>
            <strong>${escapeHtml(toText(stage.label, stage.id ?? "Stage"))}</strong>
          </div>
        `)
        .join("")}
    </article>
  `;
}

export function renderOperatorCurrentDecision(
  detail: OperatorThreadDetail | null,
  options: RenderCurrentDecisionOptions = {},
): string {
  const guidance = detail?.decisionGuidance ?? null;
  if (!guidance) {
    return '<article class="panel operator-current-decision-card empty-state" data-current-decision="true">No current decision is waiting.</article>';
  }

  const classes = ["panel", "operator-current-decision-card"];
  if (options.emphasized) {
    classes.push("emphasized");
  }

  const secondaryActions = Array.isArray(guidance.secondaryActions)
    ? guidance.secondaryActions.filter(Boolean)
    : [];

  return `
    <article
      class="${classes.join(" ")}"
      data-current-decision="true"
      tabindex="-1"
      data-highlighted-action-id="${escapeHtml(options.highlightedActionId ?? "")}" 
    >
      <div class="operator-current-decision-header">
        <div>
          <p class="eyebrow">Current decision</p>
          <h3>${escapeHtml(toText(guidance.title, "Operator decision"))}</h3>
        </div>
        ${guidance.primaryAction ? `<span class="detail-pill emphasized">${escapeHtml(guidance.primaryAction)}</span>` : ""}
      </div>
      <p class="operator-current-decision-why">${escapeHtml(toText(guidance.why, "Operator guidance is waiting."))}</p>
      <div class="operator-current-decision-grid">
        <div class="operator-current-decision-block">
          <span class="muted">Next if approved</span>
          <strong>${escapeHtml(toText(guidance.nextIfApproved, "No follow-up projection available."))}</strong>
        </div>
        <div class="operator-current-decision-block">
          <span class="muted">Risk note</span>
          <strong>${escapeHtml(toText(guidance.riskNote, "No extra risk note."))}</strong>
        </div>
      </div>
      ${secondaryActions.length > 0 ? `<div class="operator-current-decision-secondary">${secondaryActions.map((label) => `<span class="detail-pill">${escapeHtml(label)}</span>`).join("")}</div>` : ""}
      ${renderActionButtons(detail)}
    </article>
  `;
}

export function renderOperatorQuickReplies(detail: OperatorThreadDetail | null): string {
  const suggestedReplies = Array.isArray(detail?.decisionGuidance?.suggestedReplies)
    ? detail?.decisionGuidance?.suggestedReplies.filter(Boolean)
    : [];

  return `
    <article class="panel operator-quick-replies-card">
      <div class="panel-header nested operator-quick-replies-header">
        <div>
          <h3>Quick Replies</h3>
          <p class="section-note">Use the orchestrator-authored replies when you want to steer the mission without writing a longer message.</p>
        </div>
      </div>
      <div class="operator-quick-replies-list">
        ${
          suggestedReplies.length > 0
            ? suggestedReplies
                .map(
                  (reply) => `
                    <button
                      type="button"
                      class="operator-quick-reply-chip"
                      data-quick-reply="${escapeHtml(reply)}"
                    >
                      ${escapeHtml(reply)}
                    </button>
                  `,
                )
                .join("")
            : '<p class="operator-quick-replies-empty muted">No quick replies are suggested for this stage.</p>'
        }
      </div>
    </article>
  `;
}

export function renderOperatorEvidenceSummary(detail: OperatorThreadDetail | null): string {
  const evidence = detail?.evidenceSummary ?? null;
  if (!evidence || typeof evidence !== "object") {
    return '<div class="detail-card empty-state">Evidence summaries will appear here when a mission is selected.</div>';
  }

  const entries = Object.entries(evidence).filter(([, value]) => value && typeof value === "object");
  if (entries.length === 0) {
    return '<div class="detail-card empty-state">No evidence summary is available for this mission yet.</div>';
  }

  return `
    <div class="operator-evidence-grid">
      ${entries
        .map(([key, value]) => {
          const record = value as Record<string, unknown>;
          const headline =
            toText(record.title, "") ||
            toText(record.status, "") ||
            toText(record.integrationBranch, "") ||
            toText(record.reason, "") ||
            toText(record.id, "No detail yet");
          return `
            <article class="detail-card operator-evidence-card ${escapeHtml(stateClass(record.status ?? key))}">
              <div class="operator-evidence-card-header">
                <strong>${escapeHtml(toText(key, "evidence"))}</strong>
                ${renderStatusBadge(record.status ?? "linked")}
              </div>
              <p class="operator-evidence-card-copy">${escapeHtml(headline)}</p>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

export function renderOperatorInboxRow(
  action: OperatorActionProjection,
  options: RenderInboxRowOptions = {},
): string {
  const content = resolveInboxRowContent(action, options.threadFallback ?? null);
  const choices = Array.isArray(action.choices) ? action.choices : [];
  const classes = ["operator-action-card", "operator-inbox-row"];
  if (options.active) {
    classes.push("active");
  }

  return `
    <article
      class="${classes.join(" ")}"
      data-mission-focus="inbox-row"
      data-thread-id="${escapeHtml(toText(action.threadId, ""))}"
      data-action-id="${escapeHtml(toText(action.id, ""))}"
    >
      <div class="operator-action-header">
        <div>
          <strong>${escapeHtml(content.title)}</strong>
          <div class="muted">${escapeHtml(content.waitingLabel)}</div>
        </div>
        ${renderStatusBadge(content.urgency, "urgency")}
      </div>
      <div class="operator-inbox-decision-title">${escapeHtml(content.decisionTitle)}</div>
      <div class="operator-action-summary">${escapeHtml(content.reason)}</div>
      <div class="operator-inbox-thread">${escapeHtml(content.objective)}</div>
      ${content.primaryAction ? `<div class="operator-inbox-primary-action detail-pill emphasized">${escapeHtml(content.primaryAction)}</div>` : ""}
      ${
        choices.length > 0
          ? `<div class="operator-action-controls">${choices
              .map((choice) => {
                const tone = choice.tone === "primary" ? "primary" : "secondary";
                return `
                  <button
                    type="button"
                    class="operator-action-button ${tone}"
                    data-operator-action-id="${escapeHtml(toText(action.id, ""))}"
                    data-operator-action-choice="${escapeHtml(toText(choice.value, "approve"))}"
                  >
                    ${escapeHtml(toText(choice.label, toText(choice.value, "Action")))}
                  </button>
                `;
              })
              .join("")}</div>`
          : ""
      }
    </article>
  `;
}
