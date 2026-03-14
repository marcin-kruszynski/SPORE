import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { JSDOM } from "jsdom";

import MissionMapPage from "../src/pages/MissionMapPage.js";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}

class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>();
  readonly url: string;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(listener);
    this.listeners.set(type, handlers);
  }

  removeEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    const handlers = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      handlers.filter((entry) => entry !== listener),
    );
  }

  close() {
    this.closed = true;
  }

  emit(type: string, payload: unknown = { ok: true }) {
    const handlers = this.listeners.get(type) ?? [];
    const event = new window.MessageEvent("message", {
      data: JSON.stringify(payload),
    }) as MessageEvent<string>;
    for (const handler of handlers) {
      handler(event);
    }
  }
}

function installDomGlobals() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://127.0.0.1:8788/mission-map",
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
  globalThis.MessageEvent = dom.window.MessageEvent;
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

function renderMissionMapPage(options?: {
  queryClient?: QueryClient;
  defaultOptions?: ConstructorParameters<typeof QueryClient>[0]["defaultOptions"];
}) {
  const queryClient =
    options?.queryClient ??
    new QueryClient({
      defaultOptions: options?.defaultOptions ?? {
        queries: {
          retry: false,
        },
        mutations: {
          retry: false,
        },
      },
    });

  const view = render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(MissionMapPage),
    ),
  );

  return {
    ...view,
    queryClient,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

function nextTick() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

afterEach(() => {
  cleanup();
  MockEventSource.instances.length = 0;
});

function makeThreadSummary() {
  return {
    id: "thread-1",
    title: "Mission Alpha",
    status: "waiting_operator",
    updatedAt: "2026-03-12T10:00:00.000Z",
    summary: {
      objective: "Ship the mission map with live runtime data.",
      pendingActionCount: 1,
      lastMessageExcerpt: "The reviewer branch is still waiting.",
    },
  };
}

function makeThreadDetail() {
  return {
    id: "thread-1",
    title: "Mission Alpha",
    status: "waiting_operator",
    updatedAt: "2026-03-12T10:00:00.000Z",
    summary: {
      objective: "Ship the mission map with live runtime data.",
      pendingActionCount: 1,
      lastMessageExcerpt: "The reviewer branch is still waiting.",
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
  };
}

function makeCoordinationGroups() {
  return [
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
  ];
}

function makeExecutionDetail() {
  return {
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
    ],
  };
}

function makeExecutionTree(stepCounts: { completed: number; running: number; pending: number }) {
  return {
    selectedExecutionId: "exec-root",
    rootExecutionId: "exec-root",
    coordinationGroupId: "cg-1",
    executionCount: 2,
    root: {
      execution: {
        id: "exec-root",
        state: stepCounts.pending === 0 ? "completed" : "running",
        objective: "Ship the mission map with live runtime data.",
        projectRole: "coordinator",
        projectId: "spore",
        coordinationGroupId: "cg-1",
      },
      stepSummary: {
        count: 4,
        byState: stepCounts,
      },
      children: [
        {
          execution: {
            id: "exec-review",
            state: stepCounts.pending === 0 ? "completed" : "held",
            objective: "Review runtime-backed mission topology",
            parentExecutionId: "exec-root",
            projectRole: "reviewer",
            projectId: "spore",
            coordinationGroupId: "cg-1",
          },
          stepSummary: {
            count: 1,
            byState: {
              completed: stepCounts.pending === 0 ? 1 : 0,
              held: stepCounts.pending === 0 ? 0 : 1,
            },
          },
          children: [],
        },
      ],
    },
  };
}

function makeFamilyExecutionTree() {
  return {
    selectedExecutionId: "exec-architect",
    rootExecutionId: "exec-architect",
    coordinationGroupId: "cg-pkce",
    executionCount: 5,
    root: {
      execution: {
        id: "exec-architect",
        state: "running",
        objective: "Design OAuth2 PKCE authentication module.",
        projectRole: "architect",
        projectId: "spore",
        coordinationGroupId: "cg-pkce",
      },
      stepSummary: {
        count: 4,
        byState: { completed: 1, running: 1, pending: 2 },
      },
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
  };
}

function makeFamilyThreadSummary() {
  return {
    id: "thread-family",
    title: "Implement OAuth2 PKCE flow",
    status: "waiting_operator",
    updatedAt: "2026-03-14T10:00:00.000Z",
    summary: {
      objective: "Implement OAuth2 PKCE flow.",
      pendingActionCount: 1,
      lastMessageExcerpt: "Waiting for review and security confirmation.",
    },
  };
}

function makeFamilyThreadDetail() {
  return {
    id: "thread-family",
    title: "Implement OAuth2 PKCE flow",
    status: "waiting_operator",
    summary: {
      objective: "Implement OAuth2 PKCE flow.",
      pendingActionCount: 1,
      lastMessageExcerpt: "Waiting for review and security confirmation.",
    },
    hero: {
      phase: "Managed Work",
      statusLine: "Managed work is running across the full PKCE family tree.",
    },
    metadata: {
      execution: {
        projectId: "spore",
        executionId: "exec-architect",
      },
    },
  };
}

function makeFamilyExecutionDetail(executionId: string) {
  const details: Record<string, unknown> = {
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
        {
          sessionId: "session-architect",
          session: {
            id: "session-architect",
            role: "architect",
            state: "active",
            runtimeAdapter: "runtime-pi",
          },
        },
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
        {
          sessionId: "session-implementer-a",
          session: {
            id: "session-implementer-a",
            role: "implementer",
            state: "active",
            runtimeAdapter: "runtime-pi",
          },
        },
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
        {
          sessionId: "session-implementer-b",
          session: {
            id: "session-implementer-b",
            role: "implementer",
            state: "pending",
            runtimeAdapter: "runtime-pi",
          },
        },
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
        {
          sessionId: "session-reviewer",
          session: {
            id: "session-reviewer",
            role: "reviewer",
            state: "held",
            runtimeAdapter: "runtime-pi",
          },
        },
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
        {
          sessionId: "session-guardian-root",
          session: {
            id: "session-guardian-root",
            role: "guardian",
            state: "completed",
            runtimeAdapter: "runtime-pi",
          },
        },
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
        {
          sessionId: "session-guardian-child",
          session: {
            id: "session-guardian-child",
            role: "guardian",
            state: "completed",
            runtimeAdapter: "runtime-pi",
          },
        },
      ],
    },
  };
  return details[executionId];
}

function makeFamilySessionLive(sessionId: string) {
  const map: Record<string, unknown> = {
    "session-architect": { ok: true, session: { id: "session-architect", role: "architect", state: "active", runtimeAdapter: "runtime-pi" }, diagnostics: { status: "active", operatorUrgency: "normal", staleSession: false } },
    "session-implementer-a": { ok: true, session: { id: "session-implementer-a", role: "implementer", state: "active", runtimeAdapter: "runtime-pi" }, diagnostics: { status: "active", operatorUrgency: "normal", staleSession: false } },
    "session-implementer-b": { ok: true, session: { id: "session-implementer-b", role: "implementer", state: "pending", runtimeAdapter: "runtime-pi" }, diagnostics: { status: "waiting_review", operatorUrgency: "normal", staleSession: false } },
    "session-reviewer": { ok: true, session: { id: "session-reviewer", role: "reviewer", state: "held", runtimeAdapter: "runtime-pi" }, diagnostics: { status: "held", operatorUrgency: "high", staleSession: false } },
    "session-guardian-root": { ok: true, session: { id: "session-guardian-root", role: "guardian", state: "completed", runtimeAdapter: "runtime-pi" }, diagnostics: { status: "completed", operatorUrgency: "normal", staleSession: false } },
    "session-guardian-child": { ok: true, session: { id: "session-guardian-child", role: "guardian", state: "completed", runtimeAdapter: "runtime-pi" }, diagnostics: { status: "completed", operatorUrgency: "normal", staleSession: false } },
  };
  return map[sessionId];
}

function makeSessionLive(status: string) {
  return {
    ok: true,
    session: {
      id: "session-1",
      role: "implementer",
      state: status === "completed" ? "completed" : "active",
      runtimeAdapter: "runtime-pi",
    },
    diagnostics: {
      status,
      operatorUrgency: status === "completed" ? "normal" : "high",
      staleSession: false,
    },
    workspace: {
      id: "ws-1",
      purpose: "implementation",
    },
  };
}

function makeChildLinkedThreadDetail() {
  return {
    ...makeThreadDetail(),
    metadata: {
      execution: {
        projectId: "spore",
        executionId: "exec-child",
      },
    },
  };
}

function makeChildLinkedCoordinationGroups() {
  return [
    {
      groupId: "cg-child",
      executionCount: 3,
      byState: {
        running: 2,
        pending: 1,
      },
      executions: [
        {
          id: "exec-root",
          state: "running",
          objective: "Coordinate the fallback tree",
          projectId: "spore",
          coordinationGroupId: "cg-child",
        },
        {
          id: "exec-child",
          state: "running",
          objective: "Child implementation lane",
          parentExecutionId: "exec-root",
          projectId: "spore",
          coordinationGroupId: "cg-child",
        },
        {
          id: "exec-sibling",
          state: "pending",
          objective: "Sibling review lane",
          parentExecutionId: "exec-root",
          projectId: "spore",
          coordinationGroupId: "cg-child",
        },
      ],
    },
  ];
}

function makeChildExecutionDetail() {
  return {
    execution: {
      id: "exec-child",
      state: "running",
      objective: "Child implementation lane",
      projectId: "spore",
      coordinationGroupId: "cg-child",
      projectRole: "implementer",
    },
    sessions: [
      {
        sessionId: "session-child-1",
        session: {
          id: "session-child-1",
          role: "implementer",
          state: "active",
          runtimeAdapter: "runtime-pi",
        },
      },
    ],
  };
}

function makeChildSessionLive(status: string) {
  return {
    ok: true,
    session: {
      id: "session-child-1",
      role: "implementer",
      state: status === "completed" ? "completed" : "active",
      runtimeAdapter: "runtime-pi",
    },
    diagnostics: {
      status,
      operatorUrgency: "normal",
      staleSession: false,
    },
    workspace: {
      id: "ws-child-1",
      purpose: "implementation",
    },
  };
}

test("MissionMapPage renders real-backed mission graphs and refreshes from the execution stream", async () => {
  const restoreDom = installDomGlobals();
  const calls: string[] = [];
  let streamRefreshCount = 0;

  globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);

    if (url.endsWith("/api/orchestrator/operator/threads")) {
      return jsonResponse({ ok: true, detail: [makeThreadSummary()] });
    }
    if (url.endsWith("/api/orchestrator/operator/threads/thread-1")) {
      return jsonResponse({ ok: true, detail: makeThreadDetail() });
    }
    if (url.endsWith("/api/orchestrator/coordination-groups")) {
      return jsonResponse({ ok: true, groups: makeCoordinationGroups() });
    }
    if (url.endsWith("/api/orchestrator/executions/exec-root")) {
      return jsonResponse({ ok: true, detail: makeExecutionDetail() });
    }
    if (url.endsWith("/api/orchestrator/executions/exec-root/tree")) {
      streamRefreshCount += 1;
      return jsonResponse({
        ok: true,
        tree:
          streamRefreshCount > 1
            ? makeExecutionTree({ completed: 4, running: 0, pending: 0 })
            : makeExecutionTree({ completed: 1, running: 1, pending: 2 }),
      });
    }
    if (url.endsWith("/api/sessions/session-1/live")) {
      return jsonResponse(
        streamRefreshCount > 1 ? makeSessionLive("completed") : makeSessionLive("active"),
      );
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const view = renderMissionMapPage();

  await view.findByText("Mission Alpha");
  await view.findByText("thread ready");
  await view.findByText("execution ready");
  await view.findByText("tree ready");
  await view.findByText("sessions ready");

  fireEvent.click(view.getByRole("button", { name: /mission alpha execution/i }));
  const inspectorClose = await view.findByRole("button", { name: "x" });
  const inspector = inspectorClose.closest("div")?.parentElement;
  assert.ok(inspector);
  assert.match(inspector.textContent ?? "", /1\/4 steps complete/);

  assert.ok(calls.some((url) => url.endsWith("/api/orchestrator/operator/threads")));
  assert.ok(calls.some((url) => url.endsWith("/api/orchestrator/executions/exec-root/tree")));
  assert.equal(
    MockEventSource.instances[0]?.url,
    "/api/orchestrator/stream/executions?execution=exec-root",
  );

  await act(async () => {
    MockEventSource.instances[0]?.emit("workflow-event");
  });

  await waitFor(() => {
    assert.match(inspector?.textContent ?? "", /4\/4 steps complete/);
  });

  restoreDom();
});

test("MissionMapPage renders the full execution family tree instead of collapsing to Managed Work", async () => {
  const restoreDom = installDomGlobals();
  const calls: string[] = [];

  globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);

    if (url.endsWith("/api/orchestrator/operator/threads")) {
      return jsonResponse({ ok: true, detail: [makeFamilyThreadSummary()] });
    }
    if (url.endsWith("/api/orchestrator/operator/threads/thread-family")) {
      return jsonResponse({ ok: true, detail: makeFamilyThreadDetail() });
    }
    if (url.endsWith("/api/orchestrator/coordination-groups")) {
      return jsonResponse({ ok: true, groups: [] });
    }
    if (url.endsWith("/api/orchestrator/executions/exec-architect")) {
      return jsonResponse({ ok: true, detail: makeFamilyExecutionDetail("exec-architect") });
    }
    if (url.endsWith("/api/orchestrator/executions/exec-architect/tree")) {
      return jsonResponse({ ok: true, tree: makeFamilyExecutionTree() });
    }
    if (url.endsWith("/api/orchestrator/executions/exec-implement-a")) {
      return jsonResponse({ ok: true, detail: makeFamilyExecutionDetail("exec-implement-a") });
    }
    if (url.endsWith("/api/orchestrator/executions/exec-implement-b")) {
      return jsonResponse({ ok: true, detail: makeFamilyExecutionDetail("exec-implement-b") });
    }
    if (url.endsWith("/api/orchestrator/executions/exec-reviewer")) {
      return jsonResponse({ ok: true, detail: makeFamilyExecutionDetail("exec-reviewer") });
    }
    if (url.endsWith("/api/orchestrator/executions/exec-guardian-root")) {
      return jsonResponse({ ok: true, detail: makeFamilyExecutionDetail("exec-guardian-root") });
    }
    if (url.endsWith("/api/orchestrator/executions/exec-guardian-child")) {
      return jsonResponse({ ok: true, detail: makeFamilyExecutionDetail("exec-guardian-child") });
    }
    for (const sessionId of [
      "session-architect",
      "session-implementer-a",
      "session-implementer-b",
      "session-reviewer",
      "session-guardian-root",
      "session-guardian-child",
    ]) {
      if (url.endsWith(`/api/sessions/${sessionId}/live`)) {
        return jsonResponse(makeFamilySessionLive(sessionId));
      }
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const view = renderMissionMapPage();

  await view.findByText("Implement OAuth2 PKCE flow execution");
  assert.ok((await view.findAllByText("architect")).length >= 1);
  await view.findByText("Implement TokenService and AuthCodeStore");
  await view.findByText("Implement session bridge for backward compatibility");
  assert.ok((await view.findAllByText("reviewer")).length >= 1);
  const guardianSessions = await view.findAllByText("guardian");
  assert.ok(guardianSessions.length >= 2);
  await view.findByText("Dependency audit for new OAuth libraries");
  assert.equal(
    calls.some((url) => url.endsWith("/api/sessions/session-guardian-root/live")),
    false,
  );
  assert.equal(
    calls.some((url) => url.endsWith("/api/sessions/session-tester/live")),
    false,
  );
  assert.equal(
    calls.some((url) => url.endsWith("/api/sessions/invoke-1773524933229-frontend-tester-5/live")),
    false,
  );

  restoreDom();
});

test("MissionMapPage recovers automatically when coordination groups arrive after the initial degraded render", async () => {
  const restoreDom = installDomGlobals();
  const coordinationDeferred = createDeferred<Response>();

  globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.endsWith("/api/orchestrator/operator/threads")) {
      return jsonResponse({ ok: true, detail: [makeThreadSummary()] });
    }
    if (url.endsWith("/api/orchestrator/operator/threads/thread-1")) {
      return jsonResponse({ ok: true, detail: makeThreadDetail() });
    }
    if (url.endsWith("/api/orchestrator/coordination-groups")) {
      return coordinationDeferred.promise;
    }
    if (url.endsWith("/api/orchestrator/executions/exec-root")) {
      return jsonResponse({ ok: true, detail: makeExecutionDetail() });
    }
    if (url.endsWith("/api/orchestrator/executions/exec-root/tree")) {
      return jsonResponse({ ok: true, tree: makeExecutionTree({ completed: 1, running: 1, pending: 2 }) });
    }
    if (url.endsWith("/api/sessions/session-1/live")) {
      return jsonResponse(makeSessionLive("active"));
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const view = renderMissionMapPage();

  await view.findByText("Mission Alpha");

  await act(async () => {
    coordinationDeferred.resolve(jsonResponse({ ok: true, groups: makeCoordinationGroups() }));
    await nextTick();
  });

  await view.findByText("execution ready");
  await view.findByText("tree ready");

  restoreDom();
});

test("MissionMapPage recovers when coordination-group retry succeeds after an initial failure", async () => {
  const restoreDom = installDomGlobals();
  let coordinationRequestCount = 0;

  globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.endsWith("/api/orchestrator/operator/threads")) {
      return jsonResponse({ ok: true, detail: [makeThreadSummary()] });
    }
    if (url.endsWith("/api/orchestrator/operator/threads/thread-1")) {
      return jsonResponse({ ok: true, detail: makeThreadDetail() });
    }
    if (url.endsWith("/api/orchestrator/coordination-groups")) {
      coordinationRequestCount += 1;
      if (coordinationRequestCount === 1) {
        return jsonResponse({ ok: false, message: "coordination unavailable" }, { status: 503 });
      }
      return jsonResponse({ ok: true, groups: makeCoordinationGroups() });
    }
    if (url.endsWith("/api/orchestrator/executions/exec-root")) {
      return jsonResponse({ ok: true, detail: makeExecutionDetail() });
    }
    if (url.endsWith("/api/orchestrator/executions/exec-root/tree")) {
      return jsonResponse({ ok: true, tree: makeExecutionTree({ completed: 1, running: 1, pending: 2 }) });
    }
    if (url.endsWith("/api/sessions/session-1/live")) {
      return jsonResponse(makeSessionLive("active"));
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const view = renderMissionMapPage({
    defaultOptions: {
      queries: {
        retry: 1,
        retryDelay: () => 0,
      },
      mutations: {
        retry: false,
      },
    },
  });

  await view.findByText("Mission Alpha");
  await view.findByText("execution ready");
  assert.equal(coordinationRequestCount, 2);

  restoreDom();
});

test("MissionMapPage keeps rendering thread-backed data when execution sources are unavailable", async () => {
  const restoreDom = installDomGlobals();

  globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.endsWith("/api/orchestrator/operator/threads")) {
      return jsonResponse({ ok: true, detail: [makeThreadSummary()] });
    }
    if (url.endsWith("/api/orchestrator/operator/threads/thread-1")) {
      return jsonResponse({
        ok: true,
        detail: {
          ...makeThreadDetail(),
          metadata: {
            execution: {
              projectId: "spore",
            },
          },
        },
      });
    }
    if (url.endsWith("/api/orchestrator/coordination-groups")) {
      return jsonResponse({ ok: false, message: "coordination unavailable" }, { status: 503 });
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const view = renderMissionMapPage();

  await view.findByText("Mission Alpha");
  await view.findByText("execution missing");
  await view.findByText(/No linked execution was found for this mission/i);
  assert.equal(view.queryByText("Mission Map is unavailable"), null);

  restoreDom();
});

test("MissionMapPage keeps session nodes visible when tree data is missing but execution detail is loaded", async () => {
  const restoreDom = installDomGlobals();

  globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.endsWith("/api/orchestrator/operator/threads")) {
      return jsonResponse({ ok: true, detail: [makeThreadSummary()] });
    }
    if (url.endsWith("/api/orchestrator/operator/threads/thread-1")) {
      return jsonResponse({ ok: true, detail: makeThreadDetail() });
    }
    if (url.endsWith("/api/orchestrator/coordination-groups")) {
      return jsonResponse({ ok: true, groups: makeCoordinationGroups() });
    }
    if (url.endsWith("/api/orchestrator/executions/exec-root")) {
      return jsonResponse({ ok: true, detail: makeExecutionDetail() });
    }
    if (url.endsWith("/api/orchestrator/executions/exec-root/tree")) {
      return jsonResponse({ ok: false, message: "tree unavailable" }, { status: 503 });
    }
    if (url.endsWith("/api/sessions/session-1/live")) {
      return jsonResponse(makeSessionLive("active"));
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const view = renderMissionMapPage();

  await view.findByText("tree partial: tree unavailable");
  await view.findByText("sessions ready");

  fireEvent.click(view.getAllByRole("button", { name: /tree/i })[0]);

  await view.findByText("implementer");
  await view.findByText("session-1");

  restoreDom();
});

test("MissionMapPage attaches fallback session nodes under the linked child execution", async () => {
  const restoreDom = installDomGlobals();

  globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.endsWith("/api/orchestrator/operator/threads")) {
      return jsonResponse({ ok: true, detail: [makeThreadSummary()] });
    }
    if (url.endsWith("/api/orchestrator/operator/threads/thread-1")) {
      return jsonResponse({ ok: true, detail: makeChildLinkedThreadDetail() });
    }
    if (url.endsWith("/api/orchestrator/coordination-groups")) {
      return jsonResponse({ ok: true, groups: makeChildLinkedCoordinationGroups() });
    }
    if (url.endsWith("/api/orchestrator/executions/exec-child")) {
      return jsonResponse({ ok: true, detail: makeChildExecutionDetail() });
    }
    if (url.endsWith("/api/orchestrator/executions/exec-child/tree")) {
      return jsonResponse({ ok: false, message: "tree unavailable" }, { status: 503 });
    }
    if (url.endsWith("/api/sessions/session-child-1/live")) {
      return jsonResponse(makeChildSessionLive("active"));
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const view = renderMissionMapPage();

  await view.findByText("tree partial: tree unavailable");
  fireEvent.click(view.getAllByRole("button", { name: /tree/i })[0]);

  const childLane = await view.findByText("Child implementation lane");
  const sessionNode = await view.findByText("implementer");
  const siblingLane = await view.findByText("Sibling review lane");

  assert.ok(childLane.compareDocumentPosition(sessionNode) & Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(sessionNode.compareDocumentPosition(siblingLane) & Node.DOCUMENT_POSITION_FOLLOWING);

  restoreDom();
});
