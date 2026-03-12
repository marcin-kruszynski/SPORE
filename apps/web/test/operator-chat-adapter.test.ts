import assert from "node:assert/strict";
import test from "node:test";

import {
  adaptOperatorInboxAction,
  adaptOperatorThreadDetail,
  adaptOperatorThreadSummary,
} from "../src/adapters/operator-chat.js";

test("adaptOperatorThreadSummary keeps server-authored mission summary fields intact", () => {
  const summary = adaptOperatorThreadSummary({
    id: "thread-1",
    title: "Mission Alpha",
    status: "active",
    updatedAt: "2026-03-12T10:00:00.000Z",
    summary: {
      objective: "Polish the operator chat route and keep the dashboard shell.",
      lastMessageExcerpt: "I prepared a plan and need your approval before I start.",
      pendingActionCount: 1,
      lastMessageAt: "2026-03-12T10:00:00.000Z",
    },
    pendingActionCount: 1,
  });

  assert.equal(summary.id, "thread-1");
  assert.equal(summary.title, "Mission Alpha");
  assert.equal(
    summary.objective,
    "Polish the operator chat route and keep the dashboard shell.",
  );
  assert.equal(
    summary.lastMessageExcerpt,
    "I prepared a plan and need your approval before I start.",
  );
  assert.equal(summary.pendingActionCount, 1);
  assert.equal(summary.status, "active");
});

test("adaptOperatorInboxAction prefers inbox and decision projections over thread fallbacks", () => {
  const action = adaptOperatorInboxAction(
    {
      id: "action-1",
      threadId: "thread-1",
      actionKind: "goal-plan-review",
      status: "pending",
      summary: "fallback summary",
      requestedAt: "2026-03-12T10:00:00.000Z",
      threadSummary: {
        title: "Mission Alpha",
        objective: "Projection objective",
      },
      inboxSummary: {
        urgency: "normal",
        reason: "Plan approval is waiting before managed work can start.",
        waitingLabel: "Waiting for plan approval",
      },
      decisionGuidance: {
        title: "Review the mission plan",
        why: "I prepared a plan for the approved scope.",
        nextIfApproved: "Managed work begins.",
        primaryAction: "Approve the plan",
      },
      choices: [{ value: "approve", label: "Approve plan", tone: "primary" }],
    },
    {
      id: "thread-1",
      title: "Fallback mission",
      objective: "Fallback objective",
      lastMessageExcerpt: "Fallback excerpt",
      pendingActionCount: 0,
      status: "active",
      updatedAtLabel: "10:00 AM",
      updatedAtIso: "2026-03-12T10:00:00.000Z",
    },
  );

  assert.equal(action.title, "Mission Alpha");
  assert.equal(action.objective, "Projection objective");
  assert.equal(
    action.reason,
    "Plan approval is waiting before managed work can start.",
  );
  assert.equal(action.waitingLabel, "Waiting for plan approval");
  assert.equal(action.decisionTitle, "Review the mission plan");
  assert.equal(action.primaryActionLabel, "Approve the plan");
  assert.equal(action.choices[0]?.label, "Approve plan");
});

test("adaptOperatorThreadDetail maps mission projections, pending actions, messages, and evidence for React consumers", () => {
  const detail = adaptOperatorThreadDetail({
    id: "thread-1",
    title: "Mission Alpha",
    status: "active",
    updatedAt: "2026-03-12T10:00:00.000Z",
    summary: {
      objective: "Polish the browser operator chat into a guided mission console.",
      lastMessageExcerpt: "I prepared a plan and need your approval before I start.",
      pendingActionCount: 1,
      lastMessageAt: "2026-03-12T10:00:00.000Z",
    },
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
      ],
    },
    decisionGuidance: {
      title: "Review the mission plan",
      why: "I prepared a plan for the approved scope and I need your sign-off.",
      nextIfApproved:
        "The orchestrator starts managed work and returns with proposal evidence.",
      riskNote: "Approving starts the governed execution path.",
      primaryAction: "Approve the plan",
      secondaryActions: ["Ask for another option"],
      suggestedReplies: ["Keep only docs", "Prioritize UI first"],
    },
    pendingActions: [
      {
        id: "action-1",
        threadId: "thread-1",
        status: "pending",
        actionKind: "goal-plan-review",
        summary: "Pending plan review",
        requestedAt: "2026-03-12T10:00:00.000Z",
        decisionGuidance: {
          title: "Review the mission plan",
          why: "I prepared a plan for the approved scope and I need your sign-off.",
          nextIfApproved: "Managed work begins.",
          riskNote: "Approving starts governed execution.",
          primaryAction: "Approve the plan",
          secondaryActions: ["Ask for another option"],
          suggestedReplies: ["Keep only docs"],
        },
        inboxSummary: {
          urgency: "normal",
          reason: "Plan approval is waiting before managed work can start.",
          waitingLabel: "Waiting for plan approval",
        },
        choices: [{ value: "approve", label: "Approve plan", tone: "primary" }],
      },
    ],
    messages: [
      {
        id: "message-1",
        role: "operator",
        kind: "message",
        content: "Keep only web.",
        createdAt: "2026-03-12T09:58:00.000Z",
        payload: {},
      },
      {
        id: "message-2",
        role: "assistant",
        kind: "action-request",
        content: "Goal plan operator-action-1 is ready for review.",
        createdAt: "2026-03-12T10:00:00.000Z",
        payload: {
          pendingActionId: "action-1",
          artifacts: [
            {
              itemType: "goal-plan",
              itemId: "goal-plan-1",
              title: "Goal plan 1",
              status: "planned",
            },
          ],
        },
      },
    ],
    context: {
      linkedArtifacts: [
        {
          itemType: "goal-plan",
          itemId: "goal-plan-1",
          title: "Goal plan 1",
          status: "planned",
        },
      ],
      activeQuarantine: null,
    },
    evidenceSummary: {
      goalPlan: {
        id: "goal-plan-1",
        title: "Goal plan 1",
        status: "planned",
      },
      proposal: {
        id: "proposal-1",
        title: "Proposal 1",
        status: "ready_for_review",
      },
    },
    metadata: {
      execution: {
        projectId: "spore",
        safeMode: true,
        autoValidate: true,
        stub: true,
      },
    },
  });

  assert.equal(detail.id, "thread-1");
  assert.equal(detail.hero.title, "Polish operator chat mission console");
  assert.equal(detail.progress.stages[2]?.title, "Plan approval");
  assert.equal(detail.pendingActions[0]?.decisionTitle, "Review the mission plan");
  assert.equal(detail.pendingActions[0]?.choices[0]?.value, "approve");
  assert.equal(detail.quickReplies[0], "Keep only docs");
  assert.equal(detail.messages[0]?.role, "operator");
  assert.equal(detail.messages[1]?.pendingAction?.id, "action-1");
  assert.equal(detail.messages[1]?.artifacts[0]?.label, "Goal plan 1");
  assert.equal(detail.evidenceItems[0]?.label, "Goal plan 1");
  assert.equal(detail.context.projectId, "spore");
  assert.equal(detail.context.safeModeLabel, "Safe mode on");
});

test("adaptOperatorThreadDetail preserves resolved action history for message context after approval", () => {
  const detail = adaptOperatorThreadDetail({
    id: "thread-2",
    title: "Mission Beta",
    status: "active",
    updatedAt: "2026-03-12T10:10:00.000Z",
    summary: {
      objective: "Keep mission control real-backed after approval.",
      lastMessageExcerpt: "Goal plan goal-plan-2 was approved.",
      pendingActionCount: 0,
      lastMessageAt: "2026-03-12T10:10:00.000Z",
    },
    decisionGuidance: {
      title: "No operator decision is pending",
      why: "The orchestrator is continuing the flow.",
      nextIfApproved: "No approval is waiting right now.",
      riskNote: null,
      primaryAction: "Ask for status",
      secondaryActions: [],
      suggestedReplies: [],
    },
    pendingActions: [],
    actionHistory: [
      {
        id: "action-2",
        threadId: "thread-2",
        status: "resolved",
        actionKind: "goal-plan-review",
        summary: "Resolved plan review",
        requestedAt: "2026-03-12T10:00:00.000Z",
        decisionGuidance: {
          title: "Review the mission plan",
          why: "I prepared a plan for the approved scope and need your sign-off.",
          nextIfApproved: "Managed work begins.",
          riskNote: "Approving starts governed execution.",
          primaryAction: "Approve the plan",
          secondaryActions: [],
          suggestedReplies: [],
        },
        inboxSummary: {
          urgency: "normal",
          reason: "Plan approval was waiting before managed work could start.",
          waitingLabel: "Waiting for plan approval",
        },
        choices: [{ value: "approve", label: "Approve plan", tone: "primary" }],
      },
    ],
    messages: [
      {
        id: "message-approval",
        role: "assistant",
        kind: "action-result",
        content: "Goal plan goal-plan-2 was approved. I will continue the managed self-build flow now.",
        createdAt: "2026-03-12T10:10:00.000Z",
        payload: {
          pendingActionId: "action-2",
        },
      },
    ],
    context: {
      linkedArtifacts: [],
      activeQuarantine: null,
    },
    evidenceSummary: {},
    metadata: {
      execution: {
        projectId: "spore",
        safeMode: true,
        autoValidate: true,
        stub: true,
      },
    },
  });

  const actionHistory = (detail as { actionHistory?: Array<{ status?: string }> })
    .actionHistory;

  assert.equal(detail.pendingActions.length, 0);
  assert.equal(actionHistory?.length, 1);
  assert.equal(actionHistory?.[0]?.status, "resolved");
  assert.equal(detail.messages[0]?.pendingAction?.id, "action-2");
  assert.equal(detail.messages[0]?.pendingAction?.status, "resolved");
  assert.equal(
    detail.messages[0]?.pendingAction?.reason,
    "Plan approval was waiting before managed work could start.",
  );
});
