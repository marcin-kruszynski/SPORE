import assert from "node:assert/strict";
import test from "node:test";

import {
  adaptAgentCockpit,
  buildAgentLaneId,
} from "../src/adapters/agent-cockpit.js";

function makeThreadSummary() {
  return {
    id: "thread-1",
    title: "Mission Alpha",
    status: "active",
    updatedAt: "2026-03-12T10:05:00.000Z",
    summary: {
      objective: "Ship the cockpit home.",
      lastMessageExcerpt: "Validation is running.",
    },
  };
}

function makeThreadDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: "thread-1",
    title: "Mission Alpha",
    status: "active",
    updatedAt: "2026-03-12T10:05:00.000Z",
    summary: {
      objective: "Ship the cockpit home.",
      lastMessageExcerpt: "Validation is running.",
    },
    progress: {
      currentStage: "validation_running",
      currentState: "running",
    },
    metadata: {
      execution: {
        executionId: "exec-1",
      },
    },
    messages: [
      {
        id: "message-1",
        role: "assistant",
        kind: "message",
        content: "Proposal proposal-1 needs validation. I am running the configured validation flow now.",
        createdAt: "2026-03-12T10:05:00.000Z",
        payload: {
          artifacts: [
            {
              itemType: "proposal",
              itemId: "proposal-1",
              title: "Fallback proposal title",
              status: "validation_required",
            },
          ],
        },
      },
    ],
    context: {
      linkedArtifacts: [
        {
          itemType: "proposal",
          itemId: "proposal-1",
          title: "Fallback proposal title",
          status: "validation_required",
        },
      ],
    },
    ...overrides,
  };
}

function makeExecutionDetail(sessionId = "session-1") {
  return {
    execution: {
      id: "exec-1",
      state: "running",
      objective: "Ship the cockpit home.",
      projectRole: "implementer",
    },
    sessions: [
      {
        sessionId,
        session: {
          id: sessionId,
          role: "implementer",
          state: "active",
          updatedAt: "2026-03-12T10:05:00.000Z",
        },
      },
    ],
  };
}

function makeSessionLive(sessionId = "session-1", status = "running") {
  return {
    ok: true,
    session: {
      id: sessionId,
      role: "implementer",
      state: status === "completed" ? "completed" : "active",
      updatedAt: "2026-03-12T10:05:00.000Z",
    },
    diagnostics: {
      status,
      lastEventAt: "2026-03-12T10:05:00.000Z",
    },
  };
}

test("buildAgentLaneId applies identity precedence and never collapses distinct live sessions", () => {
  assert.equal(
    buildAgentLaneId({
      sessionId: "session-1",
      executionId: "exec-1",
      threadId: "thread-1",
      roleLabel: "Implementer",
    }),
    "session:session-1",
  );
  assert.equal(
    buildAgentLaneId({
      executionId: "exec-1",
      threadId: "thread-1",
      roleLabel: "Implementer",
    }),
    "execution:exec-1:role:implementer",
  );
  assert.equal(
    buildAgentLaneId({
      threadId: "thread-1",
      roleLabel: "Implementer",
    }),
    "thread:thread-1:role:implementer",
  );

  const model = adaptAgentCockpit({
    threads: [makeThreadSummary()],
    threadDetails: {
      "thread-1": makeThreadDetail(),
    },
    executionDetails: {
      "exec-1": {
        execution: makeExecutionDetail("session-1").execution,
        sessions: [
          makeExecutionDetail("session-1").sessions[0],
          makeExecutionDetail("session-2").sessions[0],
        ],
      },
    },
    sessionLives: {
      "session-1": makeSessionLive("session-1"),
      "session-2": makeSessionLive("session-2"),
    },
  });

  assert.deepEqual(
    model.lanes.map((lane) => lane.id).sort(),
    ["session:session-1", "session:session-2"],
  );
  assert.ok(model.lanes.every((lane) => lane.detailHref));
});

test("adaptAgentCockpit keeps duplicate execution fallback lane ids stable across reordering", () => {
  const firstSessions = [
    {
      sessionId: null,
      session: {
        id: null,
        role: null,
        state: "active",
        startedAt: "2026-03-12T09:55:00.000Z",
        updatedAt: "2026-03-12T10:05:00.000Z",
        launcherType: "tmux",
      },
    },
    {
      sessionId: null,
      session: {
        id: null,
        role: null,
        state: "active",
        startedAt: "2026-03-12T09:56:00.000Z",
        updatedAt: "2026-03-12T10:06:00.000Z",
        launcherType: "subprocess",
      },
    },
  ];

  const firstModel = adaptAgentCockpit({
    threads: [makeThreadSummary()],
    threadDetails: {
      "thread-1": makeThreadDetail(),
    },
    executionDetails: {
      "exec-1": {
        execution: {
          id: "exec-1",
          state: "running",
          projectRole: "implementer",
        },
        sessions: firstSessions,
      },
    },
  });

  const secondModel = adaptAgentCockpit({
    threads: [makeThreadSummary()],
    threadDetails: {
      "thread-1": makeThreadDetail(),
    },
    executionDetails: {
      "exec-1": {
        execution: {
          id: "exec-1",
          state: "running",
          projectRole: "implementer",
        },
        sessions: [...firstSessions].reverse(),
      },
    },
  });

  const firstIds = firstModel.lanes.map((lane) => lane.id).sort();
  const secondIds = secondModel.lanes.map((lane) => lane.id).sort();

  assert.equal(firstModel.lanes.length, 2);
  assert.equal(new Set(firstIds).size, 2);
  assert.deepEqual(firstIds, secondIds);
  assert.match(firstIds[0] ?? "", /^execution:exec-1:role:implementer:lane:/);
  assert.match(firstIds[1] ?? "", /^execution:exec-1:role:implementer:lane:/);
  assert.ok(firstModel.lanes.every((lane) => lane.detailHref));
  assert.ok(secondModel.lanes.every((lane) => lane.detailHref));
});

test("adaptAgentCockpit keeps identical sparse anonymous fallback lanes visible but non-drillable across reordering", () => {
  const identicalSessions = [
    {
      sessionId: null,
      session: {
        id: null,
        role: null,
        state: "active",
        updatedAt: null,
      },
    },
    {
      sessionId: null,
      session: {
        id: null,
        role: null,
        state: "active",
        updatedAt: null,
      },
    },
  ];

  const firstModel = adaptAgentCockpit({
    threads: [makeThreadSummary()],
    threadDetails: {
      "thread-1": makeThreadDetail(),
    },
    executionDetails: {
      "exec-1": {
        execution: {
          id: "exec-1",
          state: "running",
          projectRole: "implementer",
        },
        sessions: identicalSessions,
      },
    },
  });

  const secondModel = adaptAgentCockpit({
    threads: [makeThreadSummary()],
    threadDetails: {
      "thread-1": makeThreadDetail(),
    },
    executionDetails: {
      "exec-1": {
        execution: {
          id: "exec-1",
          state: "running",
          projectRole: "implementer",
        },
        sessions: [...identicalSessions].reverse(),
      },
    },
  });

  const firstIds = firstModel.lanes.map((lane) => lane.id).sort();
  const secondIds = secondModel.lanes.map((lane) => lane.id).sort();

  assert.equal(firstIds.length, 2);
  assert.equal(new Set(firstIds).size, 2);
  assert.deepEqual(firstIds, secondIds);
  assert.ok(firstModel.lanes.every((lane) => lane.detailHref === null));
  assert.ok(secondModel.lanes.every((lane) => lane.detailHref === null));
  assert.ok(firstModel.lanes.every((lane) => lane.inspectionLimited));
  assert.ok(secondModel.lanes.every((lane) => lane.inspectionLimited));
});

test("adaptAgentCockpit keeps same-fingerprint fallback lanes visible but non-drillable when they differ only by mutable state", () => {
  const firstSessions = [
    {
      sessionId: null,
      session: {
        id: null,
        role: null,
        state: "completed",
        updatedAt: null,
      },
    },
    {
      sessionId: null,
      session: {
        id: null,
        role: null,
        state: "active",
        updatedAt: null,
      },
    },
  ];

  const firstModel = adaptAgentCockpit({
    threads: [makeThreadSummary()],
    threadDetails: {
      "thread-1": makeThreadDetail(),
    },
    executionDetails: {
      "exec-1": {
        execution: {
          id: "exec-1",
          state: "running",
          projectRole: "implementer",
        },
        sessions: firstSessions,
      },
    },
  });

  const secondModel = adaptAgentCockpit({
    threads: [makeThreadSummary()],
    threadDetails: {
      "thread-1": makeThreadDetail(),
    },
    executionDetails: {
      "exec-1": {
        execution: {
          id: "exec-1",
          state: "running",
          projectRole: "implementer",
        },
        sessions: [...firstSessions].reverse(),
      },
    },
  });

  const firstIdsByState = new Map(firstModel.lanes.map((lane) => [lane.state, lane.id] as const));
  const secondIdsByState = new Map(secondModel.lanes.map((lane) => [lane.state, lane.id] as const));
  const firstDetailByState = new Map(firstModel.lanes.map((lane) => [lane.state, lane.detailHref] as const));
  const secondDetailByState = new Map(secondModel.lanes.map((lane) => [lane.state, lane.detailHref] as const));

  assert.equal(firstIdsByState.size, 2);
  assert.notEqual(firstIdsByState.get("completed"), firstIdsByState.get("running"));
  assert.equal(firstDetailByState.get("completed"), null);
  assert.equal(firstDetailByState.get("running"), null);
  assert.equal(secondDetailByState.get("completed"), null);
  assert.equal(secondDetailByState.get("running"), null);
  assert.ok(firstModel.lanes.every((lane) => lane.inspectionLimited));
  assert.ok(secondModel.lanes.every((lane) => lane.inspectionLimited));
});

test("adaptAgentCockpit keeps fallback lane identity stable when arbitrary stage text changes", () => {
  const baseThread = {
    ...makeThreadSummary(),
    summary: {
      objective: "Ship the cockpit home.",
      lastMessageExcerpt: "Validation is running.",
    },
  };

  const firstModel = adaptAgentCockpit({
    threads: [baseThread],
    threadDetails: {
      "thread-1": makeThreadDetail({
        progress: {
          currentStage: "phase_seven_delta",
          currentState: "running",
        },
        metadata: {
          execution: {},
        },
      }),
    },
  });

  const secondModel = adaptAgentCockpit({
    threads: [
      {
        ...baseThread,
        summary: {
          objective: "Ship the cockpit home.",
          lastMessageExcerpt: "Waiting for review.",
        },
      },
    ],
    threadDetails: {
      "thread-1": makeThreadDetail({
        progress: {
          currentStage: "handoff_packet_compiled",
          currentState: "waiting_review",
        },
        metadata: {
          execution: {},
        },
      }),
    },
  });

  assert.equal(firstModel.lanes.length, 1);
  assert.equal(secondModel.lanes.length, 1);
  assert.equal(firstModel.lanes[0]?.id, "thread:thread-1:role:agent");
  assert.equal(secondModel.lanes[0]?.id, "thread:thread-1:role:agent");
  assert.notEqual(firstModel.lanes[0]?.stageLabel, secondModel.lanes[0]?.stageLabel);
});

test("adaptAgentCockpit keeps drillable duplicate fallback lane ids stable when only anonymous session updatedAt changes", () => {
  const firstModel = adaptAgentCockpit({
    threads: [makeThreadSummary()],
    threadDetails: {
      "thread-1": makeThreadDetail(),
    },
    executionDetails: {
      "exec-1": {
        execution: {
          id: "exec-1",
          state: "running",
          projectRole: "implementer",
        },
        sessions: [
          {
            sessionId: null,
            session: {
              id: null,
              role: null,
              state: "active",
              startedAt: "2026-03-12T09:55:00.000Z",
              updatedAt: "2026-03-12T10:05:00.000Z",
              launcherType: "tmux",
            },
          },
          {
            sessionId: null,
            session: {
              id: null,
              role: null,
              state: "active",
              startedAt: "2026-03-12T09:56:00.000Z",
              updatedAt: "2026-03-12T10:06:00.000Z",
              launcherType: "subprocess",
            },
          },
        ],
      },
    },
  });

  const secondModel = adaptAgentCockpit({
    threads: [makeThreadSummary()],
    threadDetails: {
      "thread-1": makeThreadDetail(),
    },
    executionDetails: {
      "exec-1": {
        execution: {
          id: "exec-1",
          state: "running",
          projectRole: "implementer",
        },
        sessions: [
          {
            sessionId: null,
            session: {
              id: null,
              role: null,
              state: "active",
              startedAt: "2026-03-12T09:55:00.000Z",
              updatedAt: "2026-03-12T10:15:00.000Z",
              launcherType: "tmux",
            },
          },
          {
            sessionId: null,
            session: {
              id: null,
              role: null,
              state: "active",
              startedAt: "2026-03-12T09:56:00.000Z",
              updatedAt: "2026-03-12T10:16:00.000Z",
              launcherType: "subprocess",
            },
          },
        ],
      },
    },
  });

  assert.deepEqual(
    firstModel.lanes.map((lane) => lane.id).sort(),
    secondModel.lanes.map((lane) => lane.id).sort(),
  );
});

test("adaptAgentCockpit uses thread metadata sessionIds when execution detail omits sessions", () => {
  const model = adaptAgentCockpit({
    threads: [makeThreadSummary()],
    threadDetails: {
      "thread-1": makeThreadDetail({
        metadata: {
          execution: {
            executionId: "exec-1",
            sessionIds: ["session-1"],
          },
        },
      }),
    },
    executionDetails: {
      "exec-1": {
        execution: {
          id: "exec-1",
          state: "running",
          projectRole: "implementer",
        },
        sessions: [],
      },
    },
    sessionLives: {
      "session-1": makeSessionLive("session-1"),
    },
  });

  assert.equal(model.lanes.length, 1);
  assert.equal(model.lanes[0]?.sessionId, "session-1");
  assert.equal(model.lanes[0]?.detailHref, "/cockpit/agents/session%3Asession-1");
});

test("adaptAgentCockpit deduplicates repeated workflow updates into one lane state and one attention item", () => {
  const repeatedDetail = makeThreadDetail({
    messages: [
      {
        id: "message-1",
        role: "assistant",
        kind: "message",
        content: "Proposal proposal-1 needs validation. I am running the configured validation flow now.",
        createdAt: "2026-03-12T10:01:00.000Z",
        payload: {
          artifacts: [{ itemType: "proposal", itemId: "proposal-1", title: "Fallback proposal title" }],
        },
      },
      {
        id: "message-2",
        role: "assistant",
        kind: "message",
        content: "Proposal proposal-1 needs validation. I am running the configured validation flow now.",
        createdAt: "2026-03-12T10:05:00.000Z",
        payload: {
          artifacts: [{ itemType: "proposal", itemId: "proposal-1", title: "Fallback proposal title" }],
        },
      },
    ],
  });

  const model = adaptAgentCockpit({
    threads: [makeThreadSummary()],
    threadDetails: { "thread-1": repeatedDetail },
    executionDetails: { "exec-1": makeExecutionDetail() },
    sessionLives: { "session-1": makeSessionLive() },
  });

  assert.equal(model.lanes.length, 1);
  assert.equal(model.attention.length, 1);
  assert.match(model.lanes[0]?.latestSummary ?? "", /needs validation/i);
  assert.equal(model.attention[0]?.repeatCount, 2);
});

test("adaptAgentCockpit applies attention precedence so approval and blocked states outrank informational updates", () => {
  const model = adaptAgentCockpit({
    threads: [makeThreadSummary()],
    threadDetails: {
      "thread-1": makeThreadDetail({
        messages: [
          {
            id: "message-1",
            role: "assistant",
            kind: "message",
            content: "Proposal proposal-1 is promotion-ready and can move forward.",
            createdAt: "2026-03-12T10:04:00.000Z",
            payload: {
              artifacts: [{ itemType: "proposal", itemId: "proposal-1", title: "Proposal One" }],
            },
          },
          {
            id: "message-2",
            role: "assistant",
            kind: "message",
            content: "Implementation lane is waiting on a routine update.",
            createdAt: "2026-03-12T10:05:00.000Z",
            payload: {},
          },
        ],
      }),
    },
    actions: [
      {
        id: "action-1",
        threadId: "thread-1",
        status: "pending",
        actionKind: "proposal-approval",
        targetType: "proposal",
        targetId: "proposal-1",
        summary: "Proposal proposal-1 is waiting for approval.",
        requestedAt: "2026-03-12T10:06:00.000Z",
      },
    ],
    executionDetails: { "exec-1": makeExecutionDetail() },
    sessionLives: {
      "session-1": makeSessionLive("session-1", "blocked"),
    },
  });

  const proposalAttention = model.attention.find((item) => item.targetKey === "proposal:proposal-1");
  assert.equal(proposalAttention?.kind, "approval");

  const laneAttention = model.attention.find((item) => item.kind === "lane-blocked");
  assert.ok(laneAttention);
  assert.equal(
    model.attention.filter((item) => item.targetKey === laneAttention?.targetKey).length,
    1,
  );
});

test("adaptAgentCockpit deduplicates artifacts by type and id, keeps the freshest timestamp, and preserves artifact shells", () => {
  const model = adaptAgentCockpit({
    threads: [makeThreadSummary()],
    threadDetails: {
      "thread-1": makeThreadDetail({
        updatedAt: "2026-03-12T10:02:00.000Z",
        messages: [
          {
            id: "message-1",
            role: "assistant",
            kind: "message",
            content: "Draft proposal is ready.",
            createdAt: "2026-03-12T10:02:00.000Z",
            payload: {
              artifacts: [
                {
                  itemType: "proposal",
                  itemId: "proposal-1",
                  title: "Fallback proposal title",
                  status: "ready_for_review",
                },
                {
                  itemType: "workspace",
                  itemId: "workspace-1",
                  title: null,
                  status: null,
                },
              ],
            },
          },
        ],
      }),
    },
    executionDetails: { "exec-1": makeExecutionDetail() },
    sessionLives: { "session-1": makeSessionLive() },
    selfBuildSummary: {
      waitingApprovalProposals: [
        {
          id: "proposal-1",
          title: "Backend-authored proposal label",
          status: "ready_for_review",
        },
      ],
      workspaces: [],
      integrationBranches: [],
      recentWorkItemRuns: [],
    },
  });

  const proposalArtifact = model.recentArtifacts.find((artifact) => artifact.type === "proposal");
  assert.equal(proposalArtifact?.id, "proposal-1");
  assert.equal(proposalArtifact?.label, "Backend-authored proposal label");
  assert.equal(proposalArtifact?.lastSeenAt, "2026-03-12T10:05:00.000Z");

  const workspaceArtifact = model.recentArtifacts.find((artifact) => artifact.type === "workspace");
  assert.equal(workspaceArtifact?.id, "workspace-1");
  assert.equal(workspaceArtifact?.label, "Workspace workspace-1");
  assert.equal(workspaceArtifact?.degraded, true);
});

test("adaptAgentCockpit only marks affected lanes degraded when enrichment failures are lane-specific", () => {
  const model = adaptAgentCockpit({
    threads: [
      makeThreadSummary(),
      {
        id: "thread-2",
        title: "Mission Beta",
        status: "active",
        updatedAt: "2026-03-12T10:06:00.000Z",
        summary: {
          objective: "Keep lane health precise.",
          lastMessageExcerpt: "Implementer is active.",
        },
      },
    ],
    threadDetails: {
      "thread-1": makeThreadDetail(),
      "thread-2": {
        ...makeThreadDetail({
          id: "thread-2",
          title: "Mission Beta",
          metadata: {
            execution: {
              executionId: "exec-2",
            },
          },
        }),
        id: "thread-2",
        title: "Mission Beta",
      },
    },
    executionDetails: {
      "exec-1": makeExecutionDetail("session-1"),
      "exec-2": makeExecutionDetail("session-2"),
    },
    sessionLives: {
      "session-1": makeSessionLive("session-1"),
      "session-2": makeSessionLive("session-2"),
    },
    degradedReasons: ["Actions: unavailable"],
    degradedExecutionIds: ["exec-2"],
  });

  assert.equal(model.isDegraded, true);
  const laneByExecutionId = new Map(model.lanes.map((lane) => [lane.executionId, lane] as const));
  assert.equal(laneByExecutionId.get("exec-1")?.degraded, false);
  assert.equal(laneByExecutionId.get("exec-2")?.degraded, true);
});

test("adaptAgentCockpit tolerates null artifacts in thread messages and linked artifact arrays", () => {
  const model = adaptAgentCockpit({
    threads: [makeThreadSummary()],
    threadDetails: {
      "thread-1": makeThreadDetail({
        messages: [
          {
            id: "message-1",
            role: "assistant",
            kind: "message",
            content: "Proposal proposal-1 needs validation. I am running the configured validation flow now.",
            createdAt: "2026-03-12T10:05:00.000Z",
            payload: {
              artifacts: [
                null,
                {
                  itemType: "proposal",
                  itemId: "proposal-1",
                  title: "Fallback proposal title",
                  status: "validation_required",
                },
              ],
            },
          },
        ],
        context: {
          linkedArtifacts: [
            null,
            {
              itemType: "proposal",
              itemId: "proposal-1",
              title: "Fallback proposal title",
              status: "validation_required",
            },
          ],
        },
      }),
    },
    executionDetails: {
      "exec-1": makeExecutionDetail(),
    },
    sessionLives: {
      "session-1": makeSessionLive("session-1"),
    },
  });

  assert.equal(model.lanes.length, 1);
  assert.equal(model.attention.length, 1);
  assert.equal(model.recentArtifacts.length, 1);
});

test("adaptAgentCockpit prefers lane-specific step state and wave labels over thread-level promotion status", () => {
  const model = adaptAgentCockpit({
    threads: [makeThreadSummary()],
    threadDetails: {
      "thread-1": makeThreadDetail({
        progress: {
          currentStage: "promotion_launched",
          currentState: "completed",
        },
      }),
    },
    executionDetails: {
      "exec-1": {
        execution: {
          id: "exec-1",
          state: "held",
          workflowId: "feature-delivery",
        },
        steps: [
          {
            sessionId: "builder-session",
            role: "builder",
            waveName: "ui-build",
            state: "completed",
          },
          {
            sessionId: "reviewer-session",
            role: "reviewer",
            waveName: "ui-review",
            state: "review_pending",
          },
        ],
        sessions: [
          {
            sessionId: "builder-session",
            session: {
              id: "builder-session",
              role: "builder",
              state: "completed",
            },
          },
          {
            sessionId: "reviewer-session",
            session: {
              id: "reviewer-session",
              role: "reviewer",
              state: "completed",
            },
          },
        ],
      },
    },
    sessionLives: {
      "builder-session": makeSessionLive("builder-session", "completed"),
      "reviewer-session": makeSessionLive("reviewer-session", "completed"),
    },
  });

  const laneByRole = new Map(model.lanes.map((lane) => [lane.roleLabel, lane] as const));
  assert.equal(laneByRole.get("Builder")?.stageLabel, "Ui Build");
  assert.equal(laneByRole.get("Builder")?.state, "completed");
  assert.equal(laneByRole.get("Reviewer")?.stageLabel, "Ui Review");
  assert.equal(laneByRole.get("Reviewer")?.state, "waiting");
});

test("adaptAgentCockpit treats handoff validation blocked lanes as blocked even when the session settled", () => {
  const model = adaptAgentCockpit({
    threads: [
      {
        id: "thread-1",
        title: "Frontend mission",
        status: "running",
        updatedAt: "2026-03-14T22:00:00.000Z",
        summary: {
          objective: "Remove the day/night mode label.",
          lastMessageExcerpt: "Builder lane is blocked on structured handoff validation.",
        },
      },
    ],
    threadDetails: {
      "thread-1": makeThreadDetail({
        title: "Frontend mission",
        status: "running",
        metadata: {
          execution: {
            executionId: "exec-root",
          },
        },
      }),
    },
    executionDetails: {
      "exec-root": {
        execution: {
          id: "exec-root",
          state: "held",
          workflowId: "feature-delivery",
        },
        steps: [
          {
            sessionId: "builder-session",
            role: "builder",
            waveName: "wave-4",
            state: "review_pending",
            lastError: "handoff_validation_blocked",
          },
        ],
        sessions: [
          {
            sessionId: "builder-session",
            session: {
              id: "builder-session",
              role: "builder",
              state: "completed",
            },
          },
        ],
      },
    },
    sessionLives: {
      "builder-session": makeSessionLive("builder-session", "settled"),
    },
  });

  const builderLane = model.lanes.find((lane) => lane.roleLabel === "Builder");
  assert.equal(builderLane?.state, "blocked");
});

test("adaptAgentCockpit derives real lanes from active work-item runs and child promotion executions", () => {
  const model = adaptAgentCockpit({
    threads: [
      {
        id: "thread-1",
        title: "Day/night toggle mission",
        status: "completed",
        updatedAt: "2026-03-12T10:05:00.000Z",
        summary: {
          objective: "Add button to switch between day/night mode in spore mission control dashboard",
          lastMessageExcerpt: "Promotion launched for proposal proposal-1.",
        },
      },
    ],
    threadDetails: {
      "thread-1": makeThreadDetail({
        title: "Day/night toggle mission",
        status: "completed",
        progress: {
          currentStage: "promotion_launched",
          currentState: "completed",
        },
        metadata: {
          linkage: {
            activeRunId: "run-1",
          },
        },
      }),
    },
    workItemRuns: {
      "run-1": {
        id: "run-1",
        status: "blocked",
        result: {
          executionId: "exec-root",
        },
        relationSummary: {
          executionId: "exec-root",
        },
      },
    },
    executionDetails: {
      "exec-root": {
        execution: {
          id: "exec-root",
          state: "held",
          workflowId: "feature-delivery",
        },
        steps: [
          {
            sessionId: "lead-session",
            role: "lead",
            waveName: "wave-2",
            state: "completed",
          },
          {
            sessionId: "scout-session",
            role: "scout",
            waveName: "wave-3",
            state: "completed",
          },
        ],
        sessions: [
          {
            sessionId: "lead-session",
            session: {
              id: "lead-session",
              role: "lead",
              state: "completed",
            },
          },
          {
            sessionId: "scout-session",
            session: {
              id: "scout-session",
              role: "scout",
              state: "completed",
            },
          },
        ],
      },
      "promotion-exec": {
        execution: {
          id: "promotion-exec",
          state: "completed",
          workflowId: "feature-promotion",
          projectRole: "integrator",
        },
        steps: [
          {
            sessionId: "integrator-session",
            role: "integrator",
            waveName: "promotion-framing",
            state: "completed",
          },
        ],
        sessions: [
          {
            sessionId: "integrator-session",
            session: {
              id: "integrator-session",
              role: "integrator",
              state: "completed",
            },
          },
        ],
      },
    },
    executionTrees: {
      "exec-root": {
        selectedExecutionId: "exec-root",
        rootExecutionId: "exec-root",
        root: {
          execution: {
            id: "exec-root",
            state: "held",
          },
          children: [
            {
              execution: {
                id: "promotion-exec",
                parentExecutionId: "exec-root",
                state: "completed",
                workflowId: "feature-promotion",
                projectRole: "integrator",
              },
              children: [],
            },
          ],
        },
      },
    },
    sessionLives: {
      "lead-session": makeSessionLive("lead-session", "completed"),
      "scout-session": makeSessionLive("scout-session", "completed"),
      "integrator-session": makeSessionLive("integrator-session", "completed"),
    },
  });

  const laneByRole = new Map(model.lanes.map((lane) => [lane.roleLabel, lane] as const));
  assert.equal(model.lanes.length, 3);
  assert.equal(laneByRole.get("Lead")?.detailHref, "/cockpit/agents/session%3Alead-session");
  assert.equal(laneByRole.get("Scout")?.detailHref, "/cockpit/agents/session%3Ascout-session");
  assert.equal(
    laneByRole.get("Integrator")?.detailHref,
    "/cockpit/agents/session%3Aintegrator-session",
  );
  assert.equal(laneByRole.get("Lead")?.stageLabel, "Wave 2");
  assert.equal(laneByRole.get("Scout")?.stageLabel, "Wave 3");
  assert.equal(laneByRole.get("Integrator")?.stageLabel, "Promotion Framing");
});

test("adaptAgentCockpit derives execution lineage from active work-item run workspace details when the run payload omits executionId", () => {
  const model = adaptAgentCockpit({
    threads: [makeThreadSummary()],
    threadDetails: {
      "thread-1": makeThreadDetail({
        metadata: {
          linkage: {
            activeRunId: "run-1",
          },
        },
      }),
    },
    workItemRuns: {
      "run-1": {
        id: "run-1",
        status: "running",
        result: {},
        relationSummary: {},
      },
    },
    runWorkspaces: {
      "run-1": {
        id: "workspace-1",
        executionId: "exec-root",
        workItemRunId: "run-1",
      },
    },
    executionDetails: {
      "exec-root": {
        execution: {
          id: "exec-root",
          state: "running",
          workflowId: "feature-delivery",
        },
        steps: [
          {
            sessionId: "builder-session",
            role: "builder",
            waveName: "wave-4",
            state: "running",
          },
        ],
        sessions: [
          {
            sessionId: "builder-session",
            session: {
              id: "builder-session",
              role: "builder",
              state: "active",
            },
          },
        ],
      },
    },
    sessionLives: {
      "builder-session": makeSessionLive("builder-session", "running"),
    },
  });

  assert.equal(model.lanes.length, 1);
  assert.equal(model.lanes[0]?.roleLabel, "Builder");
  assert.equal(model.lanes[0]?.executionId, "exec-root");
  assert.equal(model.lanes[0]?.detailHref, "/cockpit/agents/session%3Abuilder-session");
});

test("adaptAgentCockpit derives early in-flight lanes from workspace metadata and gateway session list when execution sessions lag", () => {
  const model = adaptAgentCockpit({
    threads: [makeThreadSummary()],
    threadDetails: {
      "thread-1": makeThreadDetail({
        metadata: {
          linkage: {
            activeRunId: "run-1",
          },
        },
      }),
    },
    workItemRuns: {
      "run-1": {
        id: "run-1",
        status: "running",
        result: {},
        relationSummary: {},
      },
    },
    runWorkspaces: {
      "run-1": {
        id: "workspace-root",
        executionId: "exec-root",
        workItemRunId: "run-1",
      },
    },
    workspaces: [
      {
        id: "workspace-step-2",
        executionId: "exec-root",
        workItemRunId: "run-1",
        metadata: {
          sessionId: "lead-session",
          sourceStepId: "exec-root:step:2",
        },
      },
    ],
    executionDetails: {
      "exec-root": {
        execution: {
          id: "exec-root",
          state: "running",
          workflowId: "feature-delivery",
        },
        steps: [
          {
            sessionId: "lead-session",
            role: "lead",
            waveName: "wave-2",
            state: "active",
          },
        ],
        sessions: [],
      },
    },
    sessionList: [
      {
        id: "exec-root-frontend-orchestrator-1",
        role: "orchestrator",
        state: "completed",
        workflowId: "feature-delivery",
        updatedAt: "2026-03-12T10:04:00.000Z",
      },
      {
        id: "lead-session",
        role: "lead",
        state: "active",
        workflowId: "feature-delivery",
        updatedAt: "2026-03-12T10:05:00.000Z",
      },
    ],
    sessionLives: {
      "lead-session": makeSessionLive("lead-session", "running"),
      "exec-root-frontend-orchestrator-1": makeSessionLive(
        "exec-root-frontend-orchestrator-1",
        "completed",
      ),
    },
  });

  const laneByRole = new Map(model.lanes.map((lane) => [lane.roleLabel, lane] as const));
  assert.equal(laneByRole.get("Lead")?.sessionId, "lead-session");
  assert.equal(
    laneByRole.get("Orchestrator")?.sessionId,
    "exec-root-frontend-orchestrator-1",
  );
});
