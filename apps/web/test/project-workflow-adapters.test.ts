import assert from "node:assert/strict";
import test from "node:test";

import {
  adaptProjectCatalog,
  adaptProjectDetail,
} from "../src/adapters/projects.js";
import {
  adaptWorkflowCatalog,
  adaptWorkflowDetail,
} from "../src/adapters/workflows.js";

function makeExecutions() {
  return [
    {
      id: "exec-1",
      state: "running",
      objective: "Polish the docs workflow surfaces.",
      projectId: "spore",
      projectName: "SPORE Ops",
      projectPath: "config/projects/spore.yaml",
      workflowId: "wf-docs",
      workflowName: "Docs ADR Pass",
      workflowPath: "config/workflows/docs-adr-pass.yaml",
      coordinationGroupId: "cg-1",
      branchKey: "lead",
      updatedAt: "2026-03-12T10:05:00.000Z",
      projectRole: "lead",
      topology: {
        kind: "project-root",
      },
    },
    {
      id: "exec-2",
      state: "waiting_review",
      objective: "Review the docs workflow surfaces.",
      parentExecutionId: "exec-1",
      projectId: "spore",
      projectName: "SPORE Ops",
      projectPath: "config/projects/spore.yaml",
      workflowId: "wf-docs",
      workflowName: "Docs ADR Pass",
      workflowPath: "config/workflows/docs-adr-pass.yaml",
      coordinationGroupId: "cg-1",
      branchKey: "reviewer",
      updatedAt: "2026-03-12T10:06:00.000Z",
      projectRole: "reviewer",
      topology: {
        kind: "child-workflow",
      },
    },
    {
      id: "exec-3",
      state: "completed",
      objective: "Ship the frontend UI workflow cleanup.",
      projectPath: "config/projects/docs.yaml",
      projectName: "Docs Project",
      workflowPath: "config/workflows/frontend-ui-pass.yaml",
      workflowName: "Frontend UI Pass",
      coordinationGroupId: "cg-2",
      branchKey: "integrator",
      updatedAt: "2026-03-12T09:00:00.000Z",
      projectRole: "integrator",
      topology: {
        kind: "standalone",
      },
    },
    {
      id: "exec-4",
      state: "completed",
      objective: "Backfill docs alias execution.",
      projectPath: "config/projects/spore.yaml",
      projectName: "SPORE Ops",
      workflowPath: "config/workflows/docs-adr-pass.yaml",
      workflowName: "Docs ADR Pass",
      coordinationGroupId: "cg-3",
      branchKey: "integrator",
      updatedAt: "2026-03-12T08:55:00.000Z",
      projectRole: "integrator",
      topology: {
        kind: "standalone",
      },
    },
  ];
}

function makeCoordinationGroups() {
  return [
    {
      groupId: "cg-1",
      executions: makeExecutions().slice(0, 2),
    },
    {
      groupId: "cg-2",
      executions: [makeExecutions()[2]],
    },
    {
      groupId: "cg-3",
      executions: [makeExecutions()[3]],
    },
  ];
}

function makeThreadDetails() {
  return [
    {
      id: "thread-1",
      title: "Docs polish mission",
      status: "waiting_approval",
      updatedAt: "2026-03-12T10:07:00.000Z",
      summary: {
        objective: "Polish the docs workflow surfaces.",
        pendingActionCount: 1,
        lastMessageExcerpt: "Approval is still pending.",
      },
      pendingActions: [{ id: "action-1" }],
      metadata: {
        execution: {
          projectId: "spore",
          executionId: "exec-1",
        },
      },
      context: {
        linkedArtifacts: [
          {
            itemType: "proposal",
            itemId: "proposal-1",
            title: "Docs proposal",
            status: "ready_for_review",
          },
        ],
      },
    },
    {
      id: "thread-2",
      title: "Frontend cleanup mission",
      status: "running",
      updatedAt: "2026-03-12T09:05:00.000Z",
      summary: {
        objective: "Ship the frontend UI workflow cleanup.",
        pendingActionCount: 0,
        lastMessageExcerpt: "Cleanup landed successfully.",
      },
      pendingActions: [],
      metadata: {
        execution: {
          projectId: "docs",
        },
      },
      context: {
        linkedArtifacts: [
          {
            itemType: "workspace",
            itemId: "workspace-9",
            title: "docs/frontend-ui-cleanup",
            status: "active",
          },
        ],
      },
    },
    {
      id: "thread-3",
      title: "Docs alias mission",
      status: "running",
      updatedAt: "2026-03-12T09:20:00.000Z",
      summary: {
        objective: "Unmatched docs alias mission.",
        pendingActionCount: 0,
        lastMessageExcerpt: "Still deriving the right project from aliases.",
      },
      pendingActions: [],
      metadata: {
        execution: {
          projectId: "docs",
        },
      },
      context: {
        linkedArtifacts: [],
      },
    },
  ];
}

function makeThreadSummaries() {
  return [
    {
      id: "thread-1",
      title: "Docs polish mission",
      status: "waiting_approval",
      updatedAt: "2026-03-12T10:07:00.000Z",
      summary: {
        objective: "Polish the docs workflow surfaces.",
        pendingActionCount: 1,
        lastMessageExcerpt: "Approval is still pending.",
      },
      pendingActionCount: 1,
    },
    {
      id: "thread-2",
      title: "Frontend cleanup mission",
      status: "running",
      updatedAt: "2026-03-12T09:05:00.000Z",
      summary: {
        objective: "Ship the frontend UI workflow cleanup.",
        pendingActionCount: 0,
        lastMessageExcerpt: "Cleanup landed successfully.",
      },
      pendingActionCount: 0,
    },
    {
      id: "thread-3",
      title: "Docs alias mission",
      status: "running",
      updatedAt: "2026-03-12T09:20:00.000Z",
      summary: {
        objective: "Unmatched docs alias mission.",
        pendingActionCount: 0,
        lastMessageExcerpt: "Still deriving the right project from aliases.",
      },
      pendingActionCount: 0,
    },
  ];
}

function makeActions() {
  return [
    {
      id: "action-1",
      threadId: "thread-1",
      status: "pending",
      actionKind: "proposal-approval",
      summary: "Docs proposal approval is waiting.",
    },
  ];
}

test("adaptProjectCatalog derives real-backed projects with identity precedence and mission context", () => {
  const catalog = adaptProjectCatalog({
    executions: makeExecutions(),
    threadSummaries: makeThreadSummaries(),
    threadDetails: makeThreadDetails(),
    actions: makeActions(),
    coordinationGroups: makeCoordinationGroups(),
  });

  assert.equal(catalog.projects.length, 2);
  assert.equal(catalog.projects[0]?.id, "spore");
  assert.equal(catalog.projects[0]?.name, "SPORE Ops");
  assert.equal(catalog.projects[0]?.workflowCount, 1);
  assert.equal(catalog.projects[0]?.missionCount, 1);
  assert.equal(catalog.projects[0]?.executionCount, 3);
  assert.equal(catalog.projects[0]?.pendingActionCount, 1);
  assert.equal(catalog.projects[0]?.href, "/projects/spore");
  assert.equal(catalog.projects[1]?.id, "config/projects/docs.yaml");
  assert.equal(catalog.projects[1]?.missionCount, 2);
  assert.equal(
    catalog.projects[1]?.href,
    "/projects/config%2Fprojects%2Fdocs.yaml",
  );
  assert.match(catalog.projects[0]?.latestActivityLabel ?? "", /Mar/);
  assert.equal(catalog.stats.totalProjects, 2);
  assert.equal(catalog.stats.pendingActions, 1);
});

test("adaptProjectDetail keeps workflows, missions, and evidence links grounded in real SPORE payloads", () => {
  const detail = adaptProjectDetail(
    { id: "spore" },
    {
      executions: makeExecutions(),
      threadSummaries: makeThreadSummaries(),
      threadDetails: makeThreadDetails(),
      actions: makeActions(),
      coordinationGroups: makeCoordinationGroups(),
    },
  );

  assert.ok(detail);
  assert.equal(detail?.id, "spore");
  assert.equal(detail?.workflows[0]?.href, "/workflows/wf-docs");
  assert.equal(detail?.missions[0]?.title, "Docs polish mission");
  assert.equal(
    detail?.evidenceLinks[0]?.href,
    "/evidence/proposal/proposal-1",
  );
  assert.equal(detail?.executions[0]?.id, "exec-2");
});

test("adaptProjectCatalog keeps ambiguous mission matches detached from a concrete execution", () => {
  const input = {
    executions: [
      {
        id: "exec-a",
        state: "running",
        objective: "Stabilize the docs workflow surfaces.",
        projectId: "spore",
        projectName: "SPORE Ops",
        projectPath: "config/projects/spore.yaml",
        updatedAt: "2026-03-12T10:00:00.000Z",
      },
      {
        id: "exec-b",
        state: "running",
        objective: "Stabilize the docs workflow surfaces.",
        projectId: "spore",
        projectName: "SPORE Ops",
        projectPath: "config/projects/spore.yaml",
        updatedAt: "2026-03-12T10:00:00.000Z",
      },
    ],
    threadSummaries: [
      {
        id: "thread-ambiguous",
        title: "Ambiguous docs mission",
        status: "running",
        updatedAt: "2026-03-12T10:05:00.000Z",
        summary: {
          objective: "Stabilize the docs workflow surfaces.",
          pendingActionCount: 0,
        },
      },
    ],
    threadDetails: [
      {
        id: "thread-ambiguous",
        title: "Ambiguous docs mission",
        status: "running",
        updatedAt: "2026-03-12T10:05:00.000Z",
        summary: {
          objective: "Stabilize the docs workflow surfaces.",
          pendingActionCount: 0,
        },
        metadata: {
          execution: {
            projectId: "spore",
          },
        },
      },
    ],
    actions: [],
    coordinationGroups: [],
  };
  const catalog = adaptProjectCatalog(input);
  const detail = adaptProjectDetail({ id: "spore" }, input);

  assert.equal(catalog.projects.length, 1);
  assert.equal(catalog.projects[0]?.missionCount, 1);
  assert.equal(detail?.missions[0]?.executionId, null);
});

test("adaptWorkflowCatalog derives workflows from execution-backed data and mission links", () => {
  const catalog = adaptWorkflowCatalog({
    executions: makeExecutions(),
    threadSummaries: makeThreadSummaries(),
    threadDetails: makeThreadDetails(),
    actions: makeActions(),
    coordinationGroups: makeCoordinationGroups(),
  });

  assert.equal(catalog.workflows.length, 2);
  assert.equal(catalog.workflows[0]?.id, "wf-docs");
  assert.equal(catalog.workflows[0]?.name, "Docs ADR Pass");
  assert.equal(catalog.workflows[0]?.projectCount, 1);
  assert.equal(catalog.workflows[0]?.missionCount, 1);
  assert.equal(catalog.workflows[0]?.executionCount, 3);
  assert.equal(catalog.workflows[0]?.href, "/workflows/wf-docs");
  assert.equal(
    catalog.workflows[1]?.href,
    "/workflows/config%2Fworkflows%2Ffrontend-ui-pass.yaml",
  );
  assert.match(catalog.workflows[0]?.latestActivityLabel ?? "", /Mar/);
  assert.equal(catalog.stats.totalWorkflows, 2);
});

test("adaptWorkflowDetail preserves linked projects, derived mission context, and evidence links", () => {
  const detail = adaptWorkflowDetail(
    { id: "config/workflows/frontend-ui-pass.yaml" },
    {
      executions: makeExecutions(),
      threadSummaries: makeThreadSummaries(),
      threadDetails: makeThreadDetails(),
      actions: makeActions(),
      coordinationGroups: makeCoordinationGroups(),
    },
  );

  assert.ok(detail);
  assert.equal(detail?.name, "Frontend UI Pass");
  assert.equal(
    detail?.projects[0]?.href,
    "/projects/config%2Fprojects%2Fdocs.yaml",
  );
  assert.equal(detail?.missions[0]?.title, "Frontend cleanup mission");
  assert.equal(
    detail?.evidenceLinks[0]?.href,
    "/evidence/workspace/workspace-9?subject=workspace",
  );
});

test("adaptProjectCatalog keeps same-basename path-only projects distinct", () => {
  const catalog = adaptProjectCatalog({
    executions: [
      {
        id: "exec-docs-root",
        state: "running",
        objective: "Update live docs.",
        projectPath: "config/projects/docs.yaml",
        projectName: "Docs",
        workflowPath: "config/workflows/docs.yaml",
        workflowName: "Docs Flow",
        updatedAt: "2026-03-12T10:00:00.000Z",
      },
      {
        id: "exec-docs-archive",
        state: "completed",
        objective: "Archive docs snapshot.",
        projectPath: "config/projects/archive/docs.yaml",
        projectName: "Archive Docs",
        workflowPath: "config/workflows/archive/docs.yaml",
        workflowName: "Archive Flow",
        updatedAt: "2026-03-12T09:00:00.000Z",
      },
    ],
    threadSummaries: [],
    threadDetails: [],
    actions: [],
    coordinationGroups: [],
  });

  assert.equal(catalog.projects.length, 2);
  assert.ok(
    catalog.projects.some((project) => project.id === "config/projects/docs.yaml"),
  );
  assert.ok(
    catalog.projects.some(
      (project) => project.id === "config/projects/archive/docs.yaml",
    ),
  );
});

test("adaptWorkflowCatalog keeps same-basename path-only workflows distinct", () => {
  const catalog = adaptWorkflowCatalog({
    executions: [
      {
        id: "exec-wf-root",
        state: "running",
        objective: "Update live docs.",
        projectPath: "config/projects/docs.yaml",
        projectName: "Docs",
        workflowPath: "config/workflows/docs.yaml",
        workflowName: "Docs Flow",
        updatedAt: "2026-03-12T10:00:00.000Z",
      },
      {
        id: "exec-wf-archive",
        state: "completed",
        objective: "Archive docs snapshot.",
        projectPath: "config/projects/archive/docs.yaml",
        projectName: "Archive Docs",
        workflowPath: "config/workflows/archive/docs.yaml",
        workflowName: "Archive Flow",
        updatedAt: "2026-03-12T09:00:00.000Z",
      },
    ],
    threadSummaries: [],
    threadDetails: [],
    actions: [],
    coordinationGroups: [],
  });

  assert.equal(catalog.workflows.length, 2);
  assert.ok(
    catalog.workflows.some(
      (workflow) => workflow.id === "config/workflows/docs.yaml",
    ),
  );
  assert.ok(
    catalog.workflows.some(
      (workflow) => workflow.id === "config/workflows/archive/docs.yaml",
    ),
  );
});

test("adaptProjectDetail links exact short-objective matches when unambiguous", () => {
  const input = {
    executions: [
      {
        id: "exec-short",
        state: "running",
        objective: "Fix UI bug",
        projectId: "spore",
        projectName: "SPORE Ops",
        projectPath: "config/projects/spore.yaml",
        workflowId: "wf-ui",
        workflowName: "UI Fix Flow",
        workflowPath: "config/workflows/ui-fix.yaml",
        updatedAt: "2026-03-12T10:00:00.000Z",
      },
    ],
    threadSummaries: [
      {
        id: "thread-short",
        title: "UI fix mission",
        status: "running",
        updatedAt: "2026-03-12T10:05:00.000Z",
        summary: {
          objective: "Fix UI bug",
          pendingActionCount: 0,
        },
      },
    ],
    threadDetails: [
      {
        id: "thread-short",
        title: "UI fix mission",
        status: "running",
        updatedAt: "2026-03-12T10:05:00.000Z",
        summary: {
          objective: "Fix UI bug",
          pendingActionCount: 0,
        },
        metadata: {
          execution: {
            projectId: "spore",
          },
        },
      },
    ],
    actions: [],
    coordinationGroups: [],
  };

  const detail = adaptProjectDetail({ id: "spore" }, input);

  assert.equal(detail?.missions[0]?.executionId, "exec-short");
});
