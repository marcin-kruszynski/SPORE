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
