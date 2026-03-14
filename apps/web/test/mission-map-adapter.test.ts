import assert from "node:assert/strict";
import test from "node:test";

import {
  adaptMissionMapMission,
  resolveMissionMapExecutionLink,
} from "../src/adapters/mission-map.js";

function flattenLabels(nodes: Array<{ label: string; children: unknown[] }>) {
  const labels: string[] = [];
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.shift();
    if (!node) {
      continue;
    }
    labels.push(node.label);
    stack.unshift(...(node.children as Array<{ label: string; children: unknown[] }>));
  }
  return labels;
}

test("adapts explicit execution and session live data into a stable mission map view", () => {
  const mission = adaptMissionMapMission({
    threadSummary: {
      id: "thread-1",
      title: "Mission Alpha",
      status: "waiting_operator",
      updatedAt: "2026-03-12T10:00:00.000Z",
      summary: {
        objective: "Ship the mission map with live runtime data.",
      },
    },
    threadDetail: {
      id: "thread-1",
      title: "Mission Alpha",
      status: "waiting_operator",
      summary: {
        objective: "Ship the mission map with live runtime data.",
      },
      hero: {
        phase: "Managed Work",
        statusLine: "Execution is active and waiting on the reviewer branch.",
      },
      metadata: {
        execution: {
          projectId: "spore",
          executionId: "exec-root",
        },
      },
      context: {
        latestRun: {
          id: "run-1",
          status: "running",
        },
      },
    },
    coordinationGroups: [
      {
        groupId: "cg-1",
        executionCount: 2,
        byState: {
          running: 1,
          held: 1,
        },
        executions: [
          {
            id: "exec-root",
            state: "running",
            objective: "Ship the mission map with live runtime data.",
            projectId: "spore",
            coordinationGroupId: "cg-1",
          },
          {
            id: "exec-review",
            state: "held",
            objective: "Review runtime-backed mission topology",
            parentExecutionId: "exec-root",
            projectId: "spore",
            coordinationGroupId: "cg-1",
          },
        ],
      },
    ],
    executionDetail: {
      execution: {
        id: "exec-root",
        state: "running",
        objective: "Ship the mission map with live runtime data.",
        projectId: "spore",
        coordinationGroupId: "cg-1",
        projectRole: "coordinator",
      },
      sessions: [
        {
          sessionId: "session-1",
          session: {
            id: "session-1",
            role: "implementer",
            state: "active",
            runtimeAdapter: "runtime-pi",
          },
        },
        {
          sessionId: "session-2",
          session: {
            id: "session-2",
            role: "reviewer",
            state: "active",
            runtimeAdapter: "runtime-pi",
          },
        },
      ],
    },
    executionTree: {
      selectedExecutionId: "exec-root",
      rootExecutionId: "exec-root",
      coordinationGroupId: "cg-1",
      executionCount: 2,
      root: {
        execution: {
          id: "exec-root",
          state: "running",
          objective: "Ship the mission map with live runtime data.",
          projectRole: "coordinator",
          projectId: "spore",
          coordinationGroupId: "cg-1",
        },
        stepSummary: {
          count: 4,
          byState: {
            completed: 1,
            running: 1,
            pending: 2,
          },
        },
        children: [
          {
            execution: {
              id: "exec-review",
              state: "held",
              objective: "Review runtime-backed mission topology",
              parentExecutionId: "exec-root",
              projectRole: "reviewer",
              projectId: "spore",
              coordinationGroupId: "cg-1",
            },
            stepSummary: {
              count: 2,
              byState: {
                held: 1,
                pending: 1,
              },
            },
            children: [],
          },
        ],
      },
    },
    sessionLives: {
      "session-1": {
        ok: true,
        session: {
          id: "session-1",
          role: "implementer",
          state: "active",
          runtimeAdapter: "runtime-pi",
        },
        diagnostics: {
          status: "active",
          operatorUrgency: "normal",
          staleSession: false,
        },
        workspace: {
          id: "ws-1",
          purpose: "implementation",
        },
      },
    },
    sessionErrors: {
      "session-2": "live route unavailable",
    },
  });

  assert.equal(mission.threadId, "thread-1");
  assert.equal(mission.linkedExecutionId, "exec-root");
  assert.equal(mission.sourceState.thread.status, "ready");
  assert.equal(mission.sourceState.execution.status, "ready");
  assert.equal(mission.sourceState.tree.status, "ready");
  assert.equal(mission.sourceState.sessions.status, "partial");
  assert.match(mission.warnings.join(" "), /live route unavailable/);
  assert.deepEqual(flattenLabels(mission.rootNodes), [
    "Mission Alpha",
    "Mission Alpha execution",
    "implementer session",
    "reviewer session",
    "Review runtime-backed mission topology",
  ]);
});

test("keeps the full execution family tree even when thread hero says Managed Work", () => {
  const mission = adaptMissionMapMission({
    threadSummary: {
      id: "thread-family",
      title: "Implement OAuth2 PKCE flow",
      status: "waiting_operator",
      updatedAt: "2026-03-14T10:00:00.000Z",
      summary: {
        objective: "Implement OAuth2 PKCE flow.",
      },
    },
    threadDetail: {
      id: "thread-family",
      title: "Implement OAuth2 PKCE flow",
      status: "waiting_operator",
      summary: {
        objective: "Implement OAuth2 PKCE flow.",
      },
      hero: {
        phase: "Managed Work",
        statusLine: "Managed work is running across architect, implementers, reviewer, and guardians.",
      },
      metadata: {
        execution: {
          projectId: "spore",
          executionId: "exec-architect",
        },
      },
    },
    executionLink: {
      executionId: "exec-architect",
      coordinationGroupId: "cg-pkce",
      strategy: "detail",
      detail: "Linked execution from detail.",
    },
    executionDetail: {
      execution: {
        id: "exec-architect",
        state: "running",
        objective: "Design OAuth2 PKCE authentication module.",
        projectId: "spore",
        coordinationGroupId: "cg-pkce",
        projectRole: "architect",
      },
      steps: [
        { id: "step-arch", role: "architect", state: "running", sessionId: "session-architect" },
        { id: "step-impl-a", role: "implementer", state: "running", sessionId: "session-implementer-a" },
        { id: "step-impl-b", role: "implementer", state: "pending", sessionId: "session-implementer-b" },
        { id: "step-review", role: "reviewer", state: "held", sessionId: "session-reviewer" },
        { id: "step-guardian", role: "guardian", state: "completed", sessionId: "session-guardian-root" },
        { id: "step-guardian-2", role: "guardian", state: "completed", sessionId: "session-guardian-child" },
      ],
      sessions: [
        { sessionId: "session-architect", session: { id: "session-architect", role: "architect", state: "active", runtimeAdapter: "runtime-pi" } },
      ],
      childExecutions: [
        {
          id: "exec-implement-a",
          state: "running",
          objective: "Implement TokenService and AuthCodeStore",
          parentExecutionId: "exec-architect",
          projectId: "spore",
          coordinationGroupId: "cg-pkce",
          projectRole: "implementer",
        },
      ],
    },
    executionDetailsById: {
      "exec-architect": {
        execution: {
          id: "exec-architect",
          state: "running",
          objective: "Design OAuth2 PKCE authentication module.",
          projectId: "spore",
          coordinationGroupId: "cg-pkce",
          projectRole: "architect",
        },
        sessions: [
          { sessionId: "session-architect", session: { id: "session-architect", role: "architect", state: "active", runtimeAdapter: "runtime-pi" } },
        ],
      },
      "exec-implement-a": {
        execution: {
          id: "exec-implement-a",
          state: "running",
          objective: "Implement TokenService and AuthCodeStore",
          projectId: "spore",
          coordinationGroupId: "cg-pkce",
          projectRole: "implementer",
        },
        sessions: [
          { sessionId: "session-implementer-a", session: { id: "session-implementer-a", role: "implementer", state: "active", runtimeAdapter: "runtime-pi" } },
        ],
      },
      "exec-implement-b": {
        execution: {
          id: "exec-implement-b",
          state: "pending",
          objective: "Implement session bridge for backward compatibility",
          projectId: "spore",
          coordinationGroupId: "cg-pkce",
          projectRole: "implementer",
        },
        sessions: [
          { sessionId: "session-implementer-b", session: { id: "session-implementer-b", role: "implementer", state: "pending", runtimeAdapter: "runtime-pi" } },
        ],
      },
      "exec-reviewer": {
        execution: {
          id: "exec-reviewer",
          state: "held",
          objective: "Review auth module refactor PR #247",
          projectId: "spore",
          coordinationGroupId: "cg-pkce",
          projectRole: "reviewer",
        },
        sessions: [
          { sessionId: "session-reviewer", session: { id: "session-reviewer", role: "reviewer", state: "held", runtimeAdapter: "runtime-pi" } },
        ],
      },
      "exec-guardian-root": {
        execution: {
          id: "exec-guardian-root",
          state: "completed",
          objective: "Security scan on auth changes",
          projectId: "spore",
          coordinationGroupId: "cg-pkce",
          projectRole: "guardian",
        },
        sessions: [
          { sessionId: "session-guardian-root", session: { id: "session-guardian-root", role: "guardian", state: "completed", runtimeAdapter: "runtime-pi" } },
        ],
      },
      "exec-guardian-child": {
        execution: {
          id: "exec-guardian-child",
          state: "completed",
          objective: "Dependency audit for new OAuth libraries",
          projectId: "spore",
          coordinationGroupId: "cg-pkce",
          projectRole: "guardian",
        },
        sessions: [
          { sessionId: "session-guardian-child", session: { id: "session-guardian-child", role: "guardian", state: "completed", runtimeAdapter: "runtime-pi" } },
        ],
      },
    },
    executionTree: {
      selectedExecutionId: "exec-architect",
      rootExecutionId: "exec-architect",
      coordinationGroupId: "cg-pkce",
      executionCount: 6,
      root: {
        execution: {
          id: "exec-architect",
          state: "running",
          objective: "Design OAuth2 PKCE authentication module.",
          projectRole: "architect",
          projectId: "spore",
          coordinationGroupId: "cg-pkce",
        },
        stepSummary: { count: 4, byState: { completed: 1, running: 1, pending: 2 } },
        children: [
          {
            execution: {
              id: "exec-implement-a",
              state: "running",
              objective: "Implement TokenService and AuthCodeStore",
              parentExecutionId: "exec-architect",
              projectRole: "implementer",
              projectId: "spore",
              coordinationGroupId: "cg-pkce",
            },
            stepSummary: { count: 5, byState: { completed: 3, running: 1, pending: 1 } },
            children: [
              {
                execution: {
                  id: "exec-implement-b",
                  state: "pending",
                  objective: "Implement session bridge for backward compatibility",
                  parentExecutionId: "exec-implement-a",
                  projectRole: "implementer",
                  projectId: "spore",
                  coordinationGroupId: "cg-pkce",
                },
                stepSummary: { count: 4, byState: { completed: 2, pending: 2 } },
                children: [],
              },
            ],
          },
          {
            execution: {
              id: "exec-reviewer",
              state: "held",
              objective: "Review auth module refactor PR #247",
              parentExecutionId: "exec-architect",
              projectRole: "reviewer",
              projectId: "spore",
              coordinationGroupId: "cg-pkce",
            },
            stepSummary: { count: 1, byState: { held: 1 } },
            children: [],
          },
          {
            execution: {
              id: "exec-guardian-root",
              state: "completed",
              objective: "Security scan on auth changes",
              parentExecutionId: "exec-architect",
              projectRole: "guardian",
              projectId: "spore",
              coordinationGroupId: "cg-pkce",
            },
            stepSummary: { count: 1, byState: { completed: 1 } },
            children: [
              {
                execution: {
                  id: "exec-guardian-child",
                  state: "completed",
                  objective: "Dependency audit for new OAuth libraries",
                  parentExecutionId: "exec-guardian-root",
                  projectRole: "guardian",
                  projectId: "spore",
                  coordinationGroupId: "cg-pkce",
                },
                stepSummary: { count: 1, byState: { completed: 1 } },
                children: [],
              },
            ],
          },
        ],
      },
    },
    sessionLives: {
      "session-architect": { ok: true, session: { id: "session-architect", role: "architect", state: "active", runtimeAdapter: "runtime-pi" }, diagnostics: { status: "active", operatorUrgency: "normal", staleSession: false } },
      "session-implementer-a": { ok: true, session: { id: "session-implementer-a", role: "implementer", state: "active", runtimeAdapter: "runtime-pi" }, diagnostics: { status: "active", operatorUrgency: "normal", staleSession: false } },
      "session-implementer-b": { ok: true, session: { id: "session-implementer-b", role: "implementer", state: "pending", runtimeAdapter: "runtime-pi" }, diagnostics: { status: "waiting_review", operatorUrgency: "normal", staleSession: false } },
      "session-reviewer": { ok: true, session: { id: "session-reviewer", role: "reviewer", state: "held", runtimeAdapter: "runtime-pi" }, diagnostics: { status: "held", operatorUrgency: "high", staleSession: false } },
      "session-guardian-root": { ok: true, session: { id: "session-guardian-root", role: "guardian", state: "completed", runtimeAdapter: "runtime-pi" }, diagnostics: { status: "completed", operatorUrgency: "normal", staleSession: false } },
      "session-guardian-child": { ok: true, session: { id: "session-guardian-child", role: "guardian", state: "completed", runtimeAdapter: "runtime-pi" }, diagnostics: { status: "completed", operatorUrgency: "normal", staleSession: false } },
    },
    sessionErrors: {},
  });

  assert.deepEqual(flattenLabels(mission.rootNodes), [
    "Implement OAuth2 PKCE flow",
    "Implement OAuth2 PKCE flow execution",
    "architect session",
    "Implement TokenService and AuthCodeStore",
    "implementer session",
    "Implement session bridge for backward compatibility",
    "implementer session",
    "Review auth module refactor PR #247",
    "reviewer session",
    "Security scan on auth changes",
    "guardian session",
    "Dependency audit for new OAuth libraries",
    "guardian session",
  ]);
});

test("derives a mission topology from coordination groups when the thread has no explicit execution link", () => {
  const mission = adaptMissionMapMission({
    threadSummary: {
      id: "thread-2",
      title: "Mission Beta",
      status: "running",
      summary: {
        objective: "Prepare the runtime-backed mission topology review.",
      },
    },
    threadDetail: {
      id: "thread-2",
      title: "Mission Beta",
      status: "running",
      summary: {
        objective: "Prepare the runtime-backed mission topology review.",
      },
      metadata: {
        execution: {
          projectId: "spore",
        },
      },
    },
    coordinationGroups: [
      {
        groupId: "cg-ignored",
        executionCount: 1,
        byState: {
          completed: 1,
        },
        executions: [
          {
            id: "exec-unrelated",
            state: "completed",
            objective: "Ship unrelated work",
            projectId: "other-project",
          },
        ],
      },
      {
        groupId: "cg-derived",
        executionCount: 2,
        byState: {
          running: 1,
          pending: 1,
        },
        executions: [
          {
            id: "exec-derived-root",
            state: "running",
            objective: "Prepare the runtime-backed mission topology review.",
            projectId: "spore",
            coordinationGroupId: "cg-derived",
          },
          {
            id: "exec-derived-child",
            state: "pending",
            objective: "Review the topology warnings",
            parentExecutionId: "exec-derived-root",
            projectId: "spore",
            coordinationGroupId: "cg-derived",
          },
        ],
      },
    ],
  });

  assert.equal(mission.linkedExecutionId, "exec-derived-root");
  assert.equal(mission.sourceState.coordination.status, "ready");
  assert.equal(mission.sourceState.execution.status, "partial");
  assert.match(mission.warnings.join(" "), /derived execution link/i);
  assert.deepEqual(flattenLabels(mission.rootNodes), [
    "Mission Beta",
    "Prepare the runtime-backed mission topology review.",
    "Review the topology warnings",
  ]);
});

test("keeps session nodes in the coordination-group fallback when tree data is missing", () => {
  const mission = adaptMissionMapMission({
    threadSummary: {
      id: "thread-3",
      title: "Mission Gamma",
      status: "running",
      summary: {
        objective: "Recover the mission topology from coordination data.",
      },
    },
    threadDetail: {
      id: "thread-3",
      title: "Mission Gamma",
      status: "running",
      summary: {
        objective: "Recover the mission topology from coordination data.",
      },
      metadata: {
        execution: {
          projectId: "spore",
          executionId: "exec-gamma-root",
        },
      },
    },
    coordinationGroups: [
      {
        groupId: "cg-gamma",
        executionCount: 2,
        byState: {
          running: 1,
          pending: 1,
        },
        executions: [
          {
            id: "exec-gamma-root",
            state: "running",
            objective: "Recover the mission topology from coordination data.",
            projectId: "spore",
            coordinationGroupId: "cg-gamma",
          },
          {
            id: "exec-gamma-child",
            state: "pending",
            objective: "Review the fallback mission map",
            parentExecutionId: "exec-gamma-root",
            projectId: "spore",
            coordinationGroupId: "cg-gamma",
          },
        ],
      },
    ],
    executionDetail: {
      execution: {
        id: "exec-gamma-root",
        state: "running",
        objective: "Recover the mission topology from coordination data.",
        projectId: "spore",
        coordinationGroupId: "cg-gamma",
        projectRole: "coordinator",
      },
      sessions: [
        {
          sessionId: "session-gamma-1",
          session: {
            id: "session-gamma-1",
            role: "implementer",
            state: "active",
            runtimeAdapter: "runtime-pi",
          },
        },
      ],
    },
    treeError: "execution tree unavailable",
    sessionLives: {
      "session-gamma-1": {
        ok: true,
        session: {
          id: "session-gamma-1",
          role: "implementer",
          state: "active",
          runtimeAdapter: "runtime-pi",
        },
        diagnostics: {
          status: "active",
          operatorUrgency: "normal",
          staleSession: false,
        },
      },
    },
  });

  assert.equal(mission.sourceState.tree.status, "partial");
  assert.equal(mission.sourceState.sessions.status, "ready");
  assert.deepEqual(flattenLabels(mission.rootNodes), [
    "Mission Gamma",
    "Recover the mission topology from coordination data.",
    "implementer session",
    "Review the fallback mission map",
  ]);
});

test("attaches fallback session nodes to the linked child execution when the linked execution is not a root", () => {
  const mission = adaptMissionMapMission({
    threadSummary: {
      id: "thread-4",
      title: "Mission Delta",
      status: "running",
      summary: {
        objective: "Link session nodes to the child execution.",
      },
    },
    threadDetail: {
      id: "thread-4",
      title: "Mission Delta",
      status: "running",
      summary: {
        objective: "Link session nodes to the child execution.",
      },
      metadata: {
        execution: {
          projectId: "spore",
          executionId: "exec-delta-child",
        },
      },
    },
    coordinationGroups: [
      {
        groupId: "cg-delta",
        executionCount: 3,
        byState: {
          running: 2,
          pending: 1,
        },
        executions: [
          {
            id: "exec-delta-root",
            state: "running",
            objective: "Coordinate the fallback tree",
            projectId: "spore",
            coordinationGroupId: "cg-delta",
          },
          {
            id: "exec-delta-child",
            state: "running",
            objective: "Link session nodes to the child execution.",
            parentExecutionId: "exec-delta-root",
            projectId: "spore",
            coordinationGroupId: "cg-delta",
          },
          {
            id: "exec-delta-sibling",
            state: "pending",
            objective: "Sibling review lane",
            parentExecutionId: "exec-delta-root",
            projectId: "spore",
            coordinationGroupId: "cg-delta",
          },
        ],
      },
    ],
    executionDetail: {
      execution: {
        id: "exec-delta-child",
        state: "running",
        objective: "Link session nodes to the child execution.",
        projectId: "spore",
        coordinationGroupId: "cg-delta",
        projectRole: "implementer",
      },
      sessions: [
        {
          sessionId: "session-delta-1",
          session: {
            id: "session-delta-1",
            role: "implementer",
            state: "active",
            runtimeAdapter: "runtime-pi",
          },
        },
      ],
    },
    treeError: "execution tree unavailable",
    sessionLives: {
      "session-delta-1": {
        ok: true,
        session: {
          id: "session-delta-1",
          role: "implementer",
          state: "active",
          runtimeAdapter: "runtime-pi",
        },
        diagnostics: {
          status: "active",
          operatorUrgency: "normal",
          staleSession: false,
        },
      },
    },
  });

  assert.deepEqual(flattenLabels(mission.rootNodes), [
    "Mission Delta",
    "Coordinate the fallback tree",
    "Link session nodes to the child execution.",
    "implementer session",
    "Sibling review lane",
  ]);
  assert.equal(mission.rootNodes[0]?.children[0]?.label, "Coordinate the fallback tree");
  assert.equal(
    mission.rootNodes[0]?.children[0]?.children[0]?.label,
    "Link session nodes to the child execution.",
  );
  assert.equal(
    mission.rootNodes[0]?.children[0]?.children[0]?.children[0]?.label,
    "implementer session",
  );
});

test("derives execution links deterministically when candidates tie on score", () => {
  const link = resolveMissionMapExecutionLink({
    threadSummary: {
      id: "thread-5",
      title: "Mission Epsilon",
      status: "running",
      summary: {
        objective: "Stabilize the derived execution link.",
      },
    },
    threadDetail: {
      id: "thread-5",
      title: "Mission Epsilon",
      status: "running",
      summary: {
        objective: "Stabilize the derived execution link.",
      },
      metadata: {
        execution: {
          projectId: "spore",
        },
      },
    },
    coordinationGroups: [
      {
        groupId: "cg-epsilon",
        executionCount: 2,
        byState: {
          running: 2,
        },
        executions: [
          {
            id: "exec-epsilon-older",
            state: "running",
            objective: "Stabilize the derived execution link.",
            projectId: "spore",
            coordinationGroupId: "cg-epsilon",
            updatedAt: "2026-03-12T09:00:00.000Z",
          },
          {
            id: "exec-epsilon-newer",
            state: "running",
            objective: "Stabilize the derived execution link.",
            projectId: "spore",
            coordinationGroupId: "cg-epsilon",
            updatedAt: "2026-03-12T10:00:00.000Z",
          },
        ],
      },
    ],
  });

  assert.equal(link.strategy, "derived");
  assert.equal(link.executionId, "exec-epsilon-newer");
});

test("refuses to derive an execution link when multiple candidates remain ambiguous", () => {
  const link = resolveMissionMapExecutionLink({
    threadSummary: {
      id: "thread-6",
      title: "Mission Zeta",
      status: "running",
      summary: {
        objective: "Avoid ambiguous fallback links.",
      },
    },
    threadDetail: {
      id: "thread-6",
      title: "Mission Zeta",
      status: "running",
      summary: {
        objective: "Avoid ambiguous fallback links.",
      },
      metadata: {
        execution: {
          projectId: "spore",
        },
      },
    },
    coordinationGroups: [
      {
        groupId: "cg-zeta-a",
        executionCount: 1,
        byState: {
          running: 1,
        },
        executions: [
          {
            id: "exec-zeta-a",
            state: "running",
            objective: "Avoid ambiguous fallback links.",
            projectId: "spore",
            coordinationGroupId: "cg-zeta-a",
            updatedAt: "2026-03-12T10:00:00.000Z",
          },
        ],
      },
      {
        groupId: "cg-zeta-b",
        executionCount: 1,
        byState: {
          running: 1,
        },
        executions: [
          {
            id: "exec-zeta-b",
            state: "running",
            objective: "Avoid ambiguous fallback links.",
            projectId: "spore",
            coordinationGroupId: "cg-zeta-b",
            updatedAt: "2026-03-12T10:00:00.000Z",
          },
        ],
      },
    ],
  });

  assert.equal(link.strategy, "none");
  assert.equal(link.executionId, null);
  assert.match(link.detail, /multiple execution candidates/i);
});
