import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router-dom";

import AgentCockpitPage from "../src/pages/AgentCockpitPage.js";
import AgentLaneDetailPage from "../src/pages/AgentLaneDetailPage.js";
import App from "../src/App.js";
import { AppSidebar } from "../src/components/dashboard/AppSidebar.js";
import { SidebarProvider } from "../src/components/ui/sidebar.js";

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

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

function renderCockpit(initialEntry = "/cockpit", queryClient = createTestQueryClient()) {
  const router = createMemoryRouter(
    [
      {
        path: "/cockpit",
        element: React.createElement(AgentCockpitPage),
      },
      {
        path: "/cockpit/agents/:laneId",
        element: React.createElement(AgentLaneDetailPage),
      },
    ],
    {
      initialEntries: [initialEntry],
    },
  );

  return {
    router,
    ...render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(RouterProvider, { router }),
      ),
    ),
  };
}

afterEach(() => {
  cleanup();
});

test("AgentCockpitPage renders active lanes, attention, recent artifacts, and click-through links from real-derived data", async () => {
  const restoreDom = installDomGlobals("/cockpit");

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.endsWith("/api/orchestrator/operator/threads")) {
      return jsonResponse({
        ok: true,
        detail: [
          {
            id: "thread-1",
            title: "Mission Alpha",
            status: "active",
            updatedAt: "2026-03-12T10:05:00.000Z",
            summary: {
              objective: "Ship the cockpit home.",
              lastMessageExcerpt: "Validation is running.",
            },
          },
        ],
      });
    }

    if (url.endsWith("/api/orchestrator/operator/actions")) {
      return jsonResponse({ ok: true, detail: [] });
    }

    if (url.endsWith("/api/orchestrator/operator/threads/thread-1")) {
      return jsonResponse({
        ok: true,
        detail: {
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
        },
      });
    }

    if (url.endsWith("/api/orchestrator/executions/exec-1")) {
      return jsonResponse({
        ok: true,
        detail: {
          execution: {
            id: "exec-1",
            state: "running",
            objective: "Ship the cockpit home.",
            projectRole: "implementer",
          },
          sessions: [
            {
              sessionId: "session-1",
              session: {
                id: "session-1",
                role: "implementer",
                state: "active",
                updatedAt: "2026-03-12T10:05:00.000Z",
              },
            },
          ],
        },
      });
    }

    if (url.endsWith("/api/sessions/session-1/live")) {
      return jsonResponse({
        ok: true,
        session: {
          id: "session-1",
          role: "implementer",
          state: "active",
          updatedAt: "2026-03-12T10:05:00.000Z",
        },
        diagnostics: {
          status: "running",
          lastEventAt: "2026-03-12T10:05:00.000Z",
        },
      });
    }

    if (url.endsWith("/api/orchestrator/self-build/summary")) {
      return jsonResponse({
        ok: true,
        detail: {
          waitingApprovalProposals: [
            {
              id: "proposal-1",
              title: "Backend-authored proposal label",
              status: "ready_for_review",
            },
          ],
          recentWorkItemRuns: [],
          workspaces: [],
          integrationBranches: [],
        },
      });
    }

    if (url.endsWith("/api/orchestrator/self-build/dashboard")) {
      return jsonResponse({
        ok: true,
        detail: {
          recentWorkItemRuns: [],
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const view = renderCockpit();

  await view.findByRole("heading", { name: "Agent Cockpit" });
  await view.findByText("Implementer");
  await view.findByText("Validation Running");
  await view.findByText(/needs validation/i);
  assert.ok((await view.findAllByText("Backend-authored proposal label")).length >= 1);

  const laneLink = view.getByRole("link", { name: /open implementer lane/i });
  assert.equal(laneLink.getAttribute("href"), "/cockpit/agents/session%3Asession-1");
  assert.equal(
    view.getByRole("link", { name: /open session/i }).getAttribute("href"),
    "/api/sessions/session-1/live",
  );
  assert.equal(
    view.getByRole("link", { name: /open mission map/i }).getAttribute("href"),
    "/mission-map",
  );
  assert.equal(
    view.getByRole("link", { name: /open newest artifact/i }).getAttribute("href"),
    "/evidence/proposal/proposal-1",
  );

  fireEvent.click(laneLink);
  await view.findByRole("heading", { name: "Implementer" });
  await view.findByRole("link", { name: /open live session payload/i });

  restoreDom();
});

test("AgentCockpitPage shows explicit empty and degraded states while preserving last-known lanes", async () => {
  const restoreDom = installDomGlobals("/cockpit");
  let mode: "empty" | "loaded" | "fail" = "empty";

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);

    if (mode === "fail") {
      if (
        url.endsWith("/api/orchestrator/operator/threads") ||
        url.endsWith("/api/orchestrator/operator/actions") ||
        url.endsWith("/api/orchestrator/operator/threads/thread-1")
      ) {
        return jsonResponse({ ok: false, message: "operator unavailable" }, { status: 503 });
      }
    }

    if (url.endsWith("/api/orchestrator/operator/threads")) {
      return jsonResponse({
        ok: true,
        detail: mode === "loaded" || mode === "fail"
          ? [
              {
                id: "thread-1",
                title: "Mission Alpha",
                status: "active",
                updatedAt: "2026-03-12T10:05:00.000Z",
                summary: {
                  objective: "Ship the cockpit home.",
                  lastMessageExcerpt: "Validation is running.",
                },
              },
            ]
          : [],
      });
    }

    if (url.endsWith("/api/orchestrator/operator/actions")) {
      return jsonResponse({ ok: true, detail: [] });
    }

    if (url.endsWith("/api/orchestrator/self-build/summary")) {
      return jsonResponse({ ok: true, detail: { recentWorkItemRuns: [], workspaces: [], integrationBranches: [] } });
    }

    if (url.endsWith("/api/orchestrator/self-build/dashboard")) {
      return jsonResponse({ ok: true, detail: { recentWorkItemRuns: [] } });
    }

    if (url.endsWith("/api/orchestrator/operator/threads/thread-1")) {
      return jsonResponse({
        ok: true,
        detail: {
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
        },
      });
    }

    if (url.endsWith("/api/orchestrator/executions/exec-1")) {
      return jsonResponse({
        ok: true,
        detail: {
          execution: {
            id: "exec-1",
            state: "running",
            projectRole: "implementer",
          },
          sessions: [
            {
              sessionId: "session-1",
              session: {
                id: "session-1",
                role: "implementer",
                state: "active",
              },
            },
          ],
        },
      });
    }

    if (url.endsWith("/api/sessions/session-1/live")) {
      return jsonResponse({
        ok: true,
        session: {
          id: "session-1",
          role: "implementer",
          state: "active",
        },
        diagnostics: {
          status: "running",
          lastEventAt: "2026-03-12T10:05:00.000Z",
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const emptyView = renderCockpit();
  await emptyView.findByText("No active agents yet");
  assert.equal(emptyView.getByRole("link", { name: /open chat/i }).getAttribute("href"), "/chat");
  assert.equal(
    emptyView.getByRole("link", { name: /open mission map/i }).getAttribute("href"),
    "/mission-map",
  );
  emptyView.unmount();

  mode = "loaded";
  const degradedView = renderCockpit();
  await degradedView.findByText("Implementer");

  mode = "fail";
  fireEvent.click(degradedView.getByRole("button", { name: /refresh cockpit/i }));

  await waitFor(() => {
    assert.ok(degradedView.getByText(/showing last-known lane state/i));
  });
  await degradedView.findByText("Implementer");
  await degradedView.findByText(/live reads are degraded for this lane/i);

  restoreDom();
});

test("AgentCockpitPage keeps rendering lanes when top-level enrichment sources fail without degrading unaffected lane cards", async () => {
  const restoreDom = installDomGlobals("/cockpit");

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.endsWith("/api/orchestrator/operator/threads")) {
      return jsonResponse({
        ok: true,
        detail: [
          {
            id: "thread-1",
            title: "Mission Alpha",
            status: "active",
            updatedAt: "2026-03-12T10:05:00.000Z",
            summary: {
              objective: "Ship the cockpit home.",
              lastMessageExcerpt: "Validation is running.",
            },
          },
        ],
      });
    }

    if (url.endsWith("/api/orchestrator/operator/actions")) {
      return jsonResponse({ ok: false, message: "actions unavailable" }, { status: 503 });
    }

    if (url.endsWith("/api/orchestrator/self-build/summary")) {
      return jsonResponse({ ok: false, message: "self-build unavailable" }, { status: 503 });
    }

    if (url.endsWith("/api/orchestrator/self-build/dashboard")) {
      return jsonResponse({ ok: true, detail: { recentWorkItemRuns: [] } });
    }

    if (url.endsWith("/api/orchestrator/operator/threads/thread-1")) {
      return jsonResponse({
        ok: true,
        detail: {
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
        },
      });
    }

    if (url.endsWith("/api/orchestrator/executions/exec-1")) {
      return jsonResponse({
        ok: true,
        detail: {
          execution: {
            id: "exec-1",
            state: "running",
            projectRole: "implementer",
          },
          sessions: [
            {
              sessionId: "session-1",
              session: {
                id: "session-1",
                role: "implementer",
                state: "active",
              },
            },
          ],
        },
      });
    }

    if (url.endsWith("/api/sessions/session-1/live")) {
      return jsonResponse({
        ok: true,
        session: {
          id: "session-1",
          role: "implementer",
          state: "active",
        },
        diagnostics: {
          status: "running",
          lastEventAt: "2026-03-12T10:05:00.000Z",
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const view = renderCockpit();

  await view.findByText("Implementer");
  await view.findByText(/cockpit is in degraded mode/i);
  assert.equal(view.queryByText(/live reads are degraded for this lane/i), null);

  restoreDom();
});

test("AgentCockpitPage keeps ambiguous anonymous duplicate lanes visible without advertising broken drill-in", async () => {
  const restoreDom = installDomGlobals("/cockpit");

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.endsWith("/api/orchestrator/operator/threads")) {
      return jsonResponse({
        ok: true,
        detail: [
          {
            id: "thread-1",
            title: "Mission Alpha",
            status: "active",
            updatedAt: "2026-03-12T10:05:00.000Z",
            summary: {
              objective: "Ship the cockpit home.",
              lastMessageExcerpt: "Validation is running.",
            },
          },
        ],
      });
    }

    if (url.endsWith("/api/orchestrator/operator/actions")) {
      return jsonResponse({ ok: true, detail: [] });
    }

    if (url.endsWith("/api/orchestrator/operator/threads/thread-1")) {
      return jsonResponse({
        ok: true,
        detail: {
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
        },
      });
    }

    if (url.endsWith("/api/orchestrator/executions/exec-1")) {
      return jsonResponse({
        ok: true,
        detail: {
          execution: {
            id: "exec-1",
            state: "running",
            objective: "Ship the cockpit home.",
            projectRole: "implementer",
          },
          sessions: [
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
          ],
        },
      });
    }

    if (url.endsWith("/api/orchestrator/self-build/summary")) {
      return jsonResponse({ ok: true, detail: { recentWorkItemRuns: [], workspaces: [], integrationBranches: [] } });
    }

    if (url.endsWith("/api/orchestrator/self-build/dashboard")) {
      return jsonResponse({ ok: true, detail: { recentWorkItemRuns: [] } });
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const view = renderCockpit();

  assert.equal((await view.findAllByText("Implementer")).length >= 2, true);
  assert.equal(view.queryAllByRole("link", { name: /open implementer lane/i }).length, 0);
  assert.equal((await view.findAllByText(/lane inspection is limited/i)).length, 2);

  restoreDom();
});

test("AgentCockpitPage does not reuse lane-detail bootstrap cache as the full cockpit home model", async () => {
  const restoreDom = installDomGlobals("/cockpit/agents/session%3Asession-1");
  const requests: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);

    if (url.endsWith("/api/orchestrator/operator/threads")) {
      return jsonResponse({
        ok: true,
        detail: [
          {
            id: "thread-1",
            title: "Mission Alpha",
            status: "active",
            updatedAt: "2026-03-12T10:05:00.000Z",
            summary: {
              objective: "Ship the cockpit home.",
              lastMessageExcerpt: "Validation is running.",
            },
          },
        ],
      });
    }

    if (url.endsWith("/api/orchestrator/operator/actions")) {
      return jsonResponse({
        ok: true,
        detail: [
          {
            id: "action-1",
            threadId: "thread-1",
            targetType: "proposal",
            targetId: "proposal-1",
            kind: "approval",
            status: "pending",
            summary: {
              title: "Approve proposal-1",
              reason: "Operator approval is required.",
            },
          },
        ],
      });
    }

    if (url.endsWith("/api/orchestrator/operator/threads/thread-1")) {
      return jsonResponse({
        ok: true,
        detail: {
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
          messages: [],
          context: {
            linkedArtifacts: [],
          },
        },
      });
    }

    if (url.endsWith("/api/orchestrator/executions/exec-1")) {
      return jsonResponse({
        ok: true,
        detail: {
          execution: {
            id: "exec-1",
            state: "running",
            objective: "Ship the cockpit home.",
            projectRole: "implementer",
          },
          sessions: [
            {
              sessionId: "session-1",
              session: {
                id: "session-1",
                role: "implementer",
                state: "active",
                updatedAt: "2026-03-12T10:05:00.000Z",
              },
            },
          ],
        },
      });
    }

    if (url.endsWith("/api/sessions/session-1/live")) {
      return jsonResponse({
        ok: true,
        session: {
          id: "session-1",
          role: "implementer",
          state: "active",
          updatedAt: "2026-03-12T10:05:00.000Z",
        },
        diagnostics: {
          status: "running",
          lastEventAt: "2026-03-12T10:05:00.000Z",
        },
      });
    }

    if (url.endsWith("/api/orchestrator/self-build/summary")) {
      return jsonResponse({
        ok: true,
        detail: {
          waitingApprovalProposals: [
            {
              id: "proposal-1",
              title: "Backend-authored proposal label",
              status: "ready_for_review",
            },
          ],
          recentWorkItemRuns: [],
          workspaces: [],
          integrationBranches: [],
        },
      });
    }

    if (url.endsWith("/api/orchestrator/self-build/dashboard")) {
      return jsonResponse({
        ok: true,
        detail: {
          recentWorkItemRuns: [],
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const queryClient = createTestQueryClient();
  const view = renderCockpit("/cockpit/agents/session%3Asession-1", queryClient);

  await view.findByRole("heading", { name: "Implementer" });
  assert.ok(
    !requests.some((request) => request.endsWith("/api/orchestrator/self-build/summary")),
  );

  await act(async () => {
    await view.router.navigate("/cockpit");
  });

  await view.findByRole("heading", { name: "Agent Cockpit" });
  await view.findByText("Backend-authored proposal label");
  assert.ok(requests.some((request) => request.endsWith("/api/orchestrator/self-build/summary")));
  assert.ok(requests.some((request) => request.endsWith("/api/orchestrator/operator/actions")));

  restoreDom();
});

test("AppSidebar exposes Agent Cockpit separately from the mock Agents catalog", () => {
  const restoreDom = installDomGlobals("/cockpit");

  const view = render(
    React.createElement(
      MemoryRouter,
      { initialEntries: ["/cockpit"] },
      React.createElement(SidebarProvider, null, React.createElement(AppSidebar)),
    ),
  );

  const cockpitLink = view.getByRole("link", { name: /agent cockpit/i });
  const catalogAgentsLink = view.getByRole("link", { name: /^agents$/i });

  assert.equal(cockpitLink.getAttribute("href"), "/cockpit");
  assert.equal(catalogAgentsLink.getAttribute("href"), "/agents");

  restoreDom();
});

test("App routes /cockpit and /cockpit/agents/:laneId through the real router without hydrating into NotFound", async () => {
  const requests: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);

    if (url.endsWith("/api/orchestrator/operator/threads")) {
      return jsonResponse({
        ok: true,
        detail: [
          {
            id: "thread-1",
            title: "Mission Alpha",
            status: "active",
            updatedAt: "2026-03-12T10:05:00.000Z",
            summary: {
              objective: "Ship the cockpit home.",
              lastMessageExcerpt: "Validation is running.",
            },
          },
        ],
      });
    }

    if (url.endsWith("/api/orchestrator/operator/actions")) {
      return jsonResponse({ ok: true, detail: [] });
    }

    if (url.endsWith("/api/orchestrator/operator/threads/thread-1")) {
      return jsonResponse({
        ok: true,
        detail: {
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
          messages: [],
          context: {
            linkedArtifacts: [],
          },
        },
      });
    }

    if (url.endsWith("/api/orchestrator/executions/exec-1")) {
      return jsonResponse({
        ok: true,
        detail: {
          execution: {
            id: "exec-1",
            state: "running",
            objective: "Ship the cockpit home.",
            projectRole: "implementer",
          },
          sessions: [
            {
              sessionId: "session-1",
              session: {
                id: "session-1",
                role: "implementer",
                state: "active",
                updatedAt: "2026-03-12T10:05:00.000Z",
                tmuxSession: "session-1-tmux",
              },
            },
          ],
        },
      });
    }

    if (url.endsWith("/api/sessions/session-1/live")) {
      return jsonResponse({
        ok: true,
        session: {
          id: "session-1",
          role: "implementer",
          state: "active",
          updatedAt: "2026-03-12T10:05:00.000Z",
          tmuxSession: "session-1-tmux",
        },
        diagnostics: {
          status: "running",
          lastEventAt: "2026-03-12T10:05:00.000Z",
        },
      });
    }

    if (url.endsWith("/api/orchestrator/self-build/summary")) {
      return jsonResponse({
        ok: true,
        detail: {
          waitingApprovalProposals: [],
          recentWorkItemRuns: [],
          workspaces: [],
          integrationBranches: [],
        },
      });
    }

    if (url.endsWith("/api/orchestrator/self-build/dashboard")) {
      return jsonResponse({
        ok: true,
        detail: {
          recentWorkItemRuns: [],
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const restoreCockpitDom = installDomGlobals("/cockpit");
  const cockpitView = render(React.createElement(App));

  await cockpitView.findByRole("heading", { name: "Agent Cockpit" });
  assert.equal(cockpitView.queryByText("Page not found"), null);
  cockpitView.unmount();
  restoreCockpitDom();

  const restoreDetailDom = installDomGlobals("/cockpit/agents/session%3Asession-1");
  const detailView = render(React.createElement(App));

  await detailView.findByRole("heading", { name: "Agent Detail" });
  assert.equal(detailView.queryByText("Page not found"), null);

  const cockpitLink = detailView.getByRole("link", { name: /agent cockpit/i });
  const agentsLink = detailView.getByRole("link", { name: /^agents$/i });
  assert.equal(cockpitLink.getAttribute("aria-current"), "page");
  assert.notEqual(agentsLink.getAttribute("aria-current"), "page");

  detailView.unmount();
  restoreDetailDom();
});

test("App promotes the cockpit to the default home while keeping chat on /chat", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.endsWith("/api/orchestrator/operator/threads")) {
      return jsonResponse({
        ok: true,
        detail: [
          {
            id: "thread-1",
            title: "Mission Alpha",
            status: "active",
            updatedAt: "2026-03-12T10:05:00.000Z",
            summary: {
              objective: "Ship the cockpit home.",
              lastMessageExcerpt: "Validation is running.",
            },
          },
        ],
      });
    }

    if (url.endsWith("/api/orchestrator/operator/actions")) {
      return jsonResponse({ ok: true, detail: [] });
    }

    if (url.endsWith("/api/orchestrator/operator/threads/thread-1")) {
      return jsonResponse({
        ok: true,
        detail: {
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
          messages: [],
          context: {
            linkedArtifacts: [],
          },
        },
      });
    }

    if (url.endsWith("/api/orchestrator/executions/exec-1")) {
      return jsonResponse({
        ok: true,
        detail: {
          execution: {
            id: "exec-1",
            state: "running",
            objective: "Ship the cockpit home.",
            projectRole: "implementer",
          },
          sessions: [
            {
              sessionId: "session-1",
              session: {
                id: "session-1",
                role: "implementer",
                state: "active",
                updatedAt: "2026-03-12T10:05:00.000Z",
              },
            },
          ],
        },
      });
    }

    if (url.endsWith("/api/sessions/session-1/live")) {
      return jsonResponse({
        ok: true,
        session: {
          id: "session-1",
          role: "implementer",
          state: "active",
          updatedAt: "2026-03-12T10:05:00.000Z",
        },
        diagnostics: {
          status: "running",
          lastEventAt: "2026-03-12T10:05:00.000Z",
        },
      });
    }

    if (url.endsWith("/api/orchestrator/self-build/summary")) {
      return jsonResponse({
        ok: true,
        detail: {
          waitingApprovalProposals: [],
          recentWorkItemRuns: [],
          workspaces: [],
          integrationBranches: [],
        },
      });
    }

    if (url.endsWith("/api/orchestrator/self-build/dashboard")) {
      return jsonResponse({
        ok: true,
        detail: {
          recentWorkItemRuns: [],
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const restoreHomeDom = installDomGlobals("/");
  const homeView = render(React.createElement(App));
  await homeView.findAllByRole("heading", { name: "Agent Cockpit" });
  assert.equal(homeView.queryByText("Page not found"), null);
  homeView.unmount();
  restoreHomeDom();

  const restoreChatDom = installDomGlobals("/chat");
  const chatView = render(React.createElement(App));
  await chatView.findAllByRole("heading", { name: "Chat" });
  assert.equal(chatView.queryByText("Page not found"), null);
  chatView.unmount();
  restoreChatDom();
});
