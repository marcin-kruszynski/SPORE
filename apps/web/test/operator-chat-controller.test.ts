import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInboxActionSubmission,
  buildQuickReplySubmission,
  deriveMissionFocusState,
  focusCurrentDecisionCard,
  resolveInboxRowContent,
  shouldRefreshInboxFromThreadEvent,
} from "../src/operator-chat-controller.js";

test("buildQuickReplySubmission shapes a chat reply request", () => {
  assert.deepEqual(
    buildQuickReplySubmission("thread-7", "Keep only docs"),
    {
      path: "/operator/threads/thread-7/messages",
      method: "POST",
      body: {
        message: "Keep only docs",
        by: "web-operator",
        source: "web-operator-chat",
      },
    },
  );
});

test("buildInboxActionSubmission shapes a direct inbox resolution request", () => {
  assert.deepEqual(
    buildInboxActionSubmission("action-9", "approve"),
    {
      path: "/operator/actions/action-9/resolve",
      method: "POST",
      body: {
        choice: "approve",
        by: "web-operator",
        source: "web-operator-chat",
      },
    },
  );
});

test("deriveMissionFocusState focuses the owning mission and highlights the decision", () => {
  assert.deepEqual(
    deriveMissionFocusState(
      {
        selectedThreadId: "thread-1",
        highlightedActionId: null,
        missionFocusSource: "thread-list",
      },
      {
        id: "action-2",
        threadId: "thread-3",
      },
    ),
    {
      selectedThreadId: "thread-3",
      highlightedActionId: "action-2",
      missionFocusSource: "inbox",
    },
  );
});

test("focusCurrentDecisionCard scrolls and focuses the current decision card", () => {
  const calls: string[] = [];
  const target = {
    scrollIntoView(options?: unknown) {
      calls.push(JSON.stringify(options));
    },
    focus(options?: unknown) {
      calls.push(`focus:${JSON.stringify(options)}`);
    },
  };

  assert.equal(focusCurrentDecisionCard(target), true);
  assert.deepEqual(calls, [
    JSON.stringify({ behavior: "smooth", block: "start", inline: "nearest" }),
    "focus:{\"preventScroll\":true}",
  ]);
});

test("resolveInboxRowContent prefers action projections over thread-list fallbacks", () => {
  assert.deepEqual(
    resolveInboxRowContent(
      {
        threadId: "thread-4",
        actionKind: "goal-plan-review",
        summary: "fallback summary",
        threadSummary: {
          title: "Mission from projection",
          objective: "Projection objective",
        },
        inboxSummary: {
          urgency: "high",
          reason: "Projection reason",
          waitingLabel: "Waiting from projection",
        },
        decisionGuidance: {
          title: "Decision from projection",
          primaryAction: "Approve",
        },
      },
      {
        title: "Fallback thread title",
        summary: {
          objective: "Fallback objective",
        },
      },
    ),
    {
      title: "Mission from projection",
      objective: "Projection objective",
      reason: "Projection reason",
      waitingLabel: "Waiting from projection",
      urgency: "high",
      decisionTitle: "Decision from projection",
      primaryAction: "Approve",
    },
  );
});

test("shouldRefreshInboxFromThreadEvent returns true when decision state changes", () => {
  const previous = {
    id: "thread-5",
    status: "waiting_review",
    progress: {
      currentStage: "plan_approval",
      currentState: "plan_approval",
      exceptionState: null,
    },
    inboxSummary: {
      reason: "Plan approval waiting",
      waitingLabel: "Waiting for plan approval",
    },
    pendingActions: [{ id: "action-plan-review", status: "pending" }],
  };

  const next = {
    ...previous,
    progress: {
      currentStage: "managed_work",
      currentState: "managed_work",
      exceptionState: null,
    },
    inboxSummary: {
      reason: "Managed work is running now",
      waitingLabel: "No pending operator action",
    },
    pendingActions: [],
  };

  assert.equal(shouldRefreshInboxFromThreadEvent(previous, next), true);
});

test("shouldRefreshInboxFromThreadEvent returns true even when the inbox projection is unchanged", () => {
  const previous = {
    id: "thread-5",
    status: "waiting_review",
    progress: {
      currentStage: "plan_approval",
      currentState: "plan_approval",
      exceptionState: null,
    },
    inboxSummary: {
      reason: "Plan approval waiting",
      waitingLabel: "Waiting for plan approval",
    },
    pendingActions: [{ id: "action-plan-review", status: "pending" }],
  };

  const next = {
    ...previous,
    pendingActions: [{ id: "action-plan-review", status: "pending" }],
  };

  assert.equal(shouldRefreshInboxFromThreadEvent(previous, next), true);
});
