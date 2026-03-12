import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import ProjectDetailPage from "../src/pages/ProjectDetailPage.js";
import ProjectsPage from "../src/pages/ProjectsPage.js";
import WorkflowDetailPage from "../src/pages/WorkflowDetailPage.js";
import WorkflowsPage from "../src/pages/WorkflowsPage.js";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}

function installDomGlobals(pathname: string) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: `http://127.0.0.1:8788${pathname}`,
  });

  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Element = dom.window.Element;
  globalThis.Node = dom.window.Node;
  globalThis.SVGElement = dom.window.SVGElement;
  globalThis.Event = dom.window.Event;
  globalThis.MouseEvent = dom.window.MouseEvent;
  globalThis.KeyboardEvent = dom.window.KeyboardEvent;
  globalThis.FocusEvent = dom.window.FocusEvent;
  globalThis.DocumentFragment = dom.window.DocumentFragment;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  Object.defineProperty(globalThis.window, "matchMedia", {
    writable: true,
    value: () => ({
      matches: false,
      media: "",
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    }),
  });

  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  globalThis.ResizeObserver = ResizeObserver as unknown as typeof globalThis.ResizeObserver;
  globalThis.window.HTMLElement.prototype.scrollIntoView = () => {};

  return () => {
    dom.window.close();
  };
}

function renderRoute(element: React.ReactElement, initialEntry: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });

  return render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(MemoryRouter, { initialEntries: [initialEntry] }, element),
    ),
  );
}

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
  ];
}

function makeThreadSummary(threadId: string) {
  if (threadId === "thread-1") {
    return {
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
    };
  }

  return {
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
  };
}

function makeThreadDetail(threadId: string) {
  if (threadId === "thread-1") {
    return {
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
    };
  }

  return {
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
  };
}

function installSuccessfulFetchMocks() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.endsWith("/api/orchestrator/executions")) {
      return jsonResponse({
        ok: true,
        executions: makeExecutions(),
      });
    }

    if (url.endsWith("/api/orchestrator/operator/threads")) {
      return jsonResponse({
        ok: true,
        detail: [makeThreadSummary("thread-1"), makeThreadSummary("thread-2")],
      });
    }

    if (url.endsWith("/api/orchestrator/operator/actions")) {
      return jsonResponse({
        ok: true,
        detail: [
          {
            id: "action-1",
            threadId: "thread-1",
            status: "pending",
            actionKind: "proposal-approval",
            summary: "Docs proposal approval is waiting.",
          },
        ],
      });
    }

    if (url.endsWith("/api/orchestrator/coordination-groups")) {
      return jsonResponse({
        ok: true,
        groups: [
          {
            groupId: "cg-1",
            executions: makeExecutions().slice(0, 2),
          },
          {
            groupId: "cg-2",
            executions: [makeExecutions()[2]],
          },
        ],
      });
    }

    if (url.endsWith("/api/orchestrator/operator/threads/thread-1")) {
      return jsonResponse({ ok: true, detail: makeThreadDetail("thread-1") });
    }

    if (url.endsWith("/api/orchestrator/operator/threads/thread-2")) {
      return jsonResponse({ ok: true, detail: makeThreadDetail("thread-2") });
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
}

afterEach(() => {
  cleanup();
});

test("ProjectsPage renders derived real-backed projects and removes unsupported create affordances", async () => {
  const restoreDom = installDomGlobals("/projects");
  installSuccessfulFetchMocks();

  const view = renderRoute(React.createElement(ProjectsPage), "/projects");

  await view.findByText("SPORE Ops");
  await view.findByText("Docs Project");
  assert.equal(view.queryByRole("button", { name: /add project/i }), null);
  assert.equal(
    view.getByRole("link", { name: /spore ops/i }).getAttribute("href"),
    "/projects/spore",
  );

  restoreDom();
});

test("ProjectDetailPage renders workflow links, mission context, and evidence links from real payloads", async () => {
  const restoreDom = installDomGlobals("/projects/spore");
  installSuccessfulFetchMocks();

  const view = renderRoute(
    React.createElement(
      Routes,
      null,
      React.createElement(Route, {
        path: "/projects/:id",
        element: React.createElement(ProjectDetailPage),
      }),
    ),
    "/projects/spore",
  );

  await view.findByText("Docs polish mission");
  await view.findByRole("link", { name: /docs adr pass/i });
  assert.equal(
    view.getByRole("link", { name: /docs adr pass/i }).getAttribute("href"),
    "/workflows/wf-docs",
  );
  const proposalLinks = view.getAllByRole("link", { name: /docs proposal/i });
  assert.equal(
    proposalLinks[0]?.getAttribute("href"),
    "/evidence/proposal/proposal-1",
  );

  restoreDom();
});

test("WorkflowsPage renders real-derived workflows instead of mock stage maps", async () => {
  const restoreDom = installDomGlobals("/workflows");
  installSuccessfulFetchMocks();

  const view = renderRoute(React.createElement(WorkflowsPage), "/workflows");

  await view.findByText("Docs ADR Pass");
  await view.findByText("Frontend UI Pass");
  assert.equal(
    view.getByRole("link", { name: /frontend ui pass/i }).getAttribute("href"),
    "/workflows/config%2Fworkflows%2Ffrontend-ui-pass.yaml",
  );

  restoreDom();
});

test("WorkflowDetailPage keeps linked projects, mission context, and evidence links visible", async () => {
  const restoreDom = installDomGlobals("/workflows/config%2Fworkflows%2Ffrontend-ui-pass.yaml");
  installSuccessfulFetchMocks();

  const view = renderRoute(
    React.createElement(
      Routes,
      null,
      React.createElement(Route, {
        path: "/workflows/:id",
        element: React.createElement(WorkflowDetailPage),
      }),
    ),
    "/workflows/config%2Fworkflows%2Ffrontend-ui-pass.yaml",
  );

  await view.findByText("Frontend cleanup mission");
  const projectLinks = view.getAllByRole("link", { name: /docs project/i });
  assert.equal(
    projectLinks[0]?.getAttribute("href"),
    "/projects/config%2Fprojects%2Fdocs.yaml",
  );
  const workspaceLinks = view.getAllByRole("link", {
    name: /docs\/frontend-ui-cleanup/i,
  });
  assert.equal(
    workspaceLinks[0]?.getAttribute("href"),
    "/evidence/workspace/workspace-9?subject=workspace",
  );

  restoreDom();
});

test("ProjectsPage exposes a real error state with retry", async () => {
  const restoreDom = installDomGlobals("/projects");
  let attempts = 0;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/orchestrator/executions")) {
      attempts += 1;
      if (attempts === 1) {
        return jsonResponse({ ok: false, message: "executions unavailable" }, { status: 503 });
      }
      return jsonResponse({ ok: true, executions: makeExecutions() });
    }

    if (url.endsWith("/api/orchestrator/operator/threads")) {
      return jsonResponse({ ok: true, detail: [makeThreadSummary("thread-1")] });
    }

    if (url.endsWith("/api/orchestrator/operator/actions")) {
      return jsonResponse({ ok: true, detail: [] });
    }

    if (url.endsWith("/api/orchestrator/coordination-groups")) {
      return jsonResponse({ ok: true, groups: [] });
    }

    if (url.endsWith("/api/orchestrator/operator/threads/thread-1")) {
      return jsonResponse({ ok: true, detail: makeThreadDetail("thread-1") });
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const view = renderRoute(React.createElement(ProjectsPage), "/projects");

  await view.findByText("Projects are unavailable");
  fireEvent.click(view.getByRole("button", { name: /retry/i }));
  await view.findByText("SPORE Ops");

  restoreDom();
});

test("ProjectsPage keeps derived data visible when a thread detail fetch degrades and surfaces the degradation", async () => {
  const restoreDom = installDomGlobals("/projects");

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.endsWith("/api/orchestrator/executions")) {
      return jsonResponse({ ok: true, executions: makeExecutions() });
    }

    if (url.endsWith("/api/orchestrator/operator/threads")) {
      return jsonResponse({
        ok: true,
        detail: [makeThreadSummary("thread-1"), makeThreadSummary("thread-2")],
      });
    }

    if (url.endsWith("/api/orchestrator/operator/actions")) {
      return jsonResponse({ ok: true, detail: [] });
    }

    if (url.endsWith("/api/orchestrator/coordination-groups")) {
      return jsonResponse({
        ok: true,
        groups: [
          {
            groupId: "cg-1",
            executions: makeExecutions().slice(0, 2),
          },
          {
            groupId: "cg-2",
            executions: [makeExecutions()[2]],
          },
        ],
      });
    }

    if (url.endsWith("/api/orchestrator/operator/threads/thread-1")) {
      return jsonResponse({ ok: true, detail: makeThreadDetail("thread-1") });
    }

    if (url.endsWith("/api/orchestrator/operator/threads/thread-2")) {
      return jsonResponse(
        { ok: false, message: "detail unavailable" },
        { status: 503 },
      );
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const view = renderRoute(React.createElement(ProjectsPage), "/projects");

  await view.findByText("SPORE Ops");
  await view.findByText(/thread detail degraded/i);
  await view.findByText(/frontend cleanup mission/i);

  restoreDom();
});
