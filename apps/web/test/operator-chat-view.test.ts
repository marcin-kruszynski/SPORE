import assert from "node:assert/strict";
import test from "node:test";

import {
  renderOperatorCurrentDecision,
  renderOperatorInboxRow,
  renderOperatorMissionHero,
  renderOperatorProgress,
  renderOperatorQuickReplies,
} from "../src/operator-chat-view.js";

const detail = {
  hero: {
    title: "Polish operator chat mission console",
    statusLine: "I prepared a plan and need your approval before I start.",
    phase: "Plan Approval",
    primaryCtaHint: "Approve the plan",
    badges: {
      runtime: "Stub runtime",
      safeMode: "Safe mode on",
      autoValidate: "Auto-validate on",
    },
  },
  progress: {
    currentStage: "plan_approval",
    currentState: "plan_approval",
    exceptionState: null,
    stages: [
      { id: "mission_received", title: "Mission received", status: "complete" },
      { id: "plan_prepared", title: "Plan prepared", status: "complete" },
      { id: "plan_approval", title: "Plan approval", status: "current" },
      { id: "managed_work", title: "Managed work running", status: "upcoming" },
    ],
  },
  decisionGuidance: {
    title: "Review the mission plan",
    why: "I prepared a plan for the approved scope and I need your sign-off.",
    nextIfApproved:
      "The orchestrator starts managed work and returns with proposal evidence.",
    riskNote: "Approving starts the governed execution path.",
    primaryAction: "Approve the plan",
    secondaryActions: ["Ask for another option", "Keep only web"],
    suggestedReplies: ["Keep only docs", "Prioritize UI first"],
  },
  pendingActions: [
    {
      id: "action-plan-review",
      choices: [{ value: "approve", label: "Approve plan", tone: "primary" }],
    },
  ],
};

test("renderOperatorMissionHero uses server-authored hero content", () => {
  const html = renderOperatorMissionHero(detail);

  assert.match(html, /operator-mission-hero-card/);
  assert.match(html, /Polish operator chat mission console/);
  assert.match(
    html,
    /I prepared a plan and need your approval before I start\./,
  );
  assert.match(html, /Plan Approval/);
  assert.match(html, /Approve the plan/);
  assert.match(html, /Stub runtime/);
});

test("renderOperatorProgress renders the authored progress strip", () => {
  const html = renderOperatorProgress(detail);

  assert.match(html, /operator-progress-strip-track/);
  assert.match(html, /data-stage-id="plan_approval"/);
  assert.match(html, /Mission received/);
  assert.match(html, /Plan approval/);
  assert.match(html, /current/);
  assert.match(html, /Current state/);
  assert.match(html, /Plan Approval/);
  assert.match(html, /Managed work running/);
});

test("renderOperatorProgress surfaces exception overlays from the real payload", () => {
  const html = renderOperatorProgress({
    ...detail,
    progress: {
      currentStage: "proposal_review",
      currentState: "quarantined",
      exceptionState: "quarantined",
      stages: [
        { id: "proposal_review", title: "Proposal review", status: "current" },
        { id: "proposal_approval", title: "Proposal approval", status: "upcoming" },
      ],
    },
  });

  assert.match(html, /Proposal review/);
  assert.match(html, /Current state/);
  assert.match(html, /quarantined/);
  assert.match(html, /Exception state/);
  assert.match(html, /operator-progress-overlay/);
});

test("renderOperatorProgress falls back to the raw stage id when title is absent", () => {
  const html = renderOperatorProgress({
    ...detail,
    progress: {
      currentStage: "managed_work",
      currentState: "managed_work",
      exceptionState: null,
      stages: [{ id: "managed_work", status: "current" }],
    },
  });

  assert.match(
    html,
    /data-stage-id="managed_work">\s*<span class="operator-progress-stage-status">current<\/span>\s*<strong>managed_work<\/strong>/,
  );
});

test("renderOperatorCurrentDecision renders decision guidance as the lead card", () => {
  const html = renderOperatorCurrentDecision(detail, {
    emphasized: true,
    highlightedActionId: "action-plan-review",
  });

  assert.match(html, /operator-current-decision-card/);
  assert.match(html, /operator-sticky-panel/);
  assert.match(html, /highlighted/);
  assert.match(html, /data-current-decision="true"/);
  assert.match(html, /Review the mission plan/);
  assert.match(html, /The orchestrator starts managed work/);
  assert.match(html, /Approving starts the governed execution path/);
  assert.match(html, /Approve the plan/);
  assert.match(html, /Approve plan/);
  assert.match(html, /Ask for another option/);
});

test("renderOperatorQuickReplies outputs quick-reply chips", () => {
  const html = renderOperatorQuickReplies(detail);

  assert.match(html, /operator-quick-replies-list/);
  assert.match(html, /data-quick-reply="Keep only docs"/);
  assert.match(html, /data-quick-reply="Prioritize UI first"/);
});

test("renderOperatorInboxRow uses thread and inbox projections for core row content", () => {
  const html = renderOperatorInboxRow({
    id: "action-plan-review",
    threadId: "thread-1",
    status: "pending",
    actionKind: "goal-plan-review",
    summary: "fallback summary should not lead the row",
    threadSummary: {
      title: "Mission Alpha",
      objective:
        "Polish the browser operator chat into a guided mission console",
    },
    inboxSummary: {
      urgency: "normal",
      reason: "Plan approval is waiting before managed work can start.",
      waitingLabel: "Waiting for plan approval",
    },
    decisionGuidance: {
      title: "Review the mission plan",
      primaryAction: "Approve the plan",
    },
    choices: [{ value: "approve", label: "Approve plan", tone: "primary" }],
  });

  assert.match(html, /Mission Alpha/);
  assert.match(
    html,
    /Polish the browser operator chat into a guided mission console/,
  );
  assert.match(
    html,
    /Plan approval is waiting before managed work can start\./,
  );
  assert.match(html, /Waiting for plan approval/);
  assert.match(html, /Review the mission plan/);
  assert.doesNotMatch(html, /fallback summary should not lead the row/);
});
