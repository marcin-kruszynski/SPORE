import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { createMemoryRouter, RouterProvider } from "react-router-dom";

import AgentLaneDetailPage from "../src/pages/AgentLaneDetailPage.js";

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

function renderLaneDetail(initialEntry = "/cockpit/agents/session%3Asession-1") {
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
  const router = createMemoryRouter(
    [
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

type FetchMode = "ready" | "missing-lane" | "session-live-failed" | "session-live-unavailable";

function installLaneDetailFetch(modeRef: { current: FetchMode }, requests: string[]) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);

    if (url.endsWith("/api/orchestrator/operator/threads")) {
      return jsonResponse({
        ok: true,
        detail:
          modeRef.current === "missing-lane"
            ? []
            : [
                {
                  id: "thread-1",
                  title: "Mission Alpha",
                  status: "active",
                  updatedAt: "2026-03-12T10:05:00.000Z",
                  summary: {
                    objective: "Ship the cockpit detail route.",
                    lastMessageExcerpt: "Direct bootstrap is wired.",
                  },
                },
              ],
      });
    }

    if (url.endsWith("/api/orchestrator/operator/actions")) {
      return jsonResponse({ ok: true, detail: [] });
    }

    if (url.endsWith("/api/orchestrator/self-build/summary")) {
      return jsonResponse({
        ok: true,
        detail: {
          waitingApprovalProposals: [],
          waitingReviewProposals: [],
          validationRequiredProposals: [],
          proposalsBlockedForPromotion: [],
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

    if (url.endsWith("/api/orchestrator/workspaces")) {
      return jsonResponse({ ok: true, detail: [] });
    }

    if (url.endsWith("/api/sessions")) {
      return jsonResponse({
        ok: true,
        sessions: [
          {
            id: "session-1",
            role: "implementer",
            state: "active",
            workflowId: "feature-delivery",
            updatedAt: "2026-03-12T10:05:00.000Z",
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
            objective: "Ship the cockpit detail route.",
            lastMessageExcerpt: "Direct bootstrap is wired.",
          },
          progress: {
            currentStage: "lane_detail",
            currentState: "running",
          },
          messages: [
            {
              id: "message-2",
              role: "assistant",
              kind: "message",
              content: "Completed route bootstrap handshake.",
              createdAt: "2026-03-12T10:05:00.000Z",
            },
            {
              id: "message-1",
              role: "assistant",
              kind: "message",
              content: "Captured the last visible summary for the lane.",
              createdAt: "2026-03-12T10:04:00.000Z",
              payload: {
                artifacts: [
                  {
                    itemType: "proposal",
                    itemId: "proposal-1",
                    title: "Proposal 1",
                    status: "ready_for_review",
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
                title: "Proposal 1",
                status: "ready_for_review",
              },
            ],
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
            objective: "Ship the cockpit detail route.",
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
                transcriptPath: "tmp/sessions/session-1.transcript.md",
                launchCommand: "tmp/sessions/session-1.launch.sh",
                tmuxSession: "session-1-tmux",
              },
            },
          ],
        },
      });
    }

    if (url.endsWith("/api/sessions/session-1/live")) {
      if (modeRef.current === "session-live-failed") {
        return jsonResponse({ ok: false, message: "session live unavailable" }, { status: 503 });
      }

      if (modeRef.current === "session-live-unavailable") {
        return jsonResponse({ ok: false, message: "session missing" }, { status: 404 });
      }

      return jsonResponse({
        ok: true,
        session: {
          id: "session-1",
          role: "implementer",
          state: "active",
          updatedAt: "2026-03-12T10:05:00.000Z",
          transcriptPath: "tmp/sessions/session-1.transcript.md",
          launchCommand: "tmp/sessions/session-1.launch.sh",
          tmuxSession: "session-1-tmux",
        },
        events: [
          {
            id: "event-1",
            type: "session.active",
            timestamp: "2026-03-12T10:05:00.000Z",
            createdAt: "2026-03-12T10:05:00.000Z",
            payload: {
              summary: "Completed route bootstrap handshake.",
            },
          },
        ],
        diagnostics: {
          status: "active",
          lastEventType: "session.active",
          lastEventAt: "2026-03-12T10:05:00.000Z",
        },
        workspace: {
          id: "ws-1",
          purpose: "Lane drill-in validation",
        },
        launchContext: {
          cwd: ".spore/worktrees/ws-1",
          workspaceId: "ws-1",
          branchName: "spore/exec-1/implementer",
        },
        launcherMetadata: {
          launcherType: "pi-rpc",
          runtimeAdapter: "runtime-pi",
          transportMode: "tmux",
          cwd: ".spore/worktrees/ws-1",
        },
        handoff: {
          primary: {
            kind: "implementation_summary",
            validation: {
              valid: true,
              issues: [],
            },
            payload: {
              summary: "Implemented the requested dashboard change.",
              changed_paths: ["apps/web/src/pages/ChatPage.tsx"],
              tests_run: ["npm run test:web"],
            },
          },
        },
        artifacts: {
          transcript: {
            name: "transcript",
            path: "tmp/sessions/session-1.transcript.md",
            exists: true,
            size: 42,
            updatedAt: "2026-03-12T10:05:00.000Z",
          },
          handoff: {
            name: "handoff",
            path: "tmp/sessions/session-1.handoff.json",
            exists: true,
            size: 42,
            updatedAt: "2026-03-12T10:05:00.000Z",
          },
          context: {
            name: "context",
            path: "tmp/sessions/session-1.context.json",
            exists: true,
            size: 42,
            updatedAt: "2026-03-12T10:05:00.000Z",
          },
        },
      });
    }

    if (url.endsWith("/api/sessions/session-1/artifacts/transcript")) {
      return jsonResponse({
        ok: true,
        artifact: "transcript",
        path: "tmp/sessions/session-1.transcript.md",
        content: "builder transcript\nline 2\nline 3",
      });
    }

    if (url.endsWith("/api/sessions/session-1/artifacts/context")) {
      return jsonResponse({
        ok: true,
        artifact: "context",
        path: "tmp/sessions/session-1.context.json",
        content: {
          session: {
            role: "implementer",
          },
          handoffs: {
            inbound: [
              {
                sourceRole: "lead",
                summary: {
                  title: "Lead request",
                  outcome: "Add the day/night mode switch in the dashboard shell.",
                },
              },
            ],
            expected: {
              kind: "implementation_summary",
            },
          },
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
}

afterEach(() => {
  cleanup();
});

test("AgentLaneDetailPage opens a lane detail route with session status, linkage, artifacts, and recent updates", async () => {
  const restoreDom = installDomGlobals("/cockpit/agents/session%3Asession-1");
  const modeRef = { current: "ready" as FetchMode };
  installLaneDetailFetch(modeRef, []);

  const view = renderLaneDetail();

  await view.findByRole("heading", { name: "Implementer" });
  assert.ok((await view.findAllByText("Completed route bootstrap handshake.")).length >= 1);
  await view.findByText("Mission Alpha");
  await view.findByText("Proposal 1");
  await view.findByText("session-1-tmux");
  await view.findByText("Input sent to Implementer");
  await view.findByText("Latest visible session output");
  await view.findByText("Returned implementation_summary");
  await view.findByText("Live session feed");
  await view.findByText("Transcript preview");
  assert.ok((await view.findAllByText(/builder transcript/)).length >= 1);
  assert.equal(
    view.getByRole("link", { name: /open live session payload/i }).getAttribute("href"),
    "/api/sessions/session-1/live",
  );

  restoreDom();
});

test("AgentLaneDetailPage bootstraps directly without requiring a warmed cockpit cache", async () => {
  const restoreDom = installDomGlobals("/cockpit/agents/session%3Asession-1");
  const requests: string[] = [];
  const modeRef = { current: "ready" as FetchMode };
  installLaneDetailFetch(modeRef, requests);

  const view = renderLaneDetail();

  await view.findByRole("heading", { name: "Implementer" });
  assert.ok(requests.some((request) => request.endsWith("/api/orchestrator/operator/threads")));
  assert.ok(requests.some((request) => request.endsWith("/api/sessions/session-1/live")));
  assert.ok(
    !requests.some((request) => request.endsWith("/api/orchestrator/self-build/summary")),
  );
  assert.ok(
    !requests.some((request) => request.endsWith("/api/orchestrator/self-build/dashboard")),
  );

  restoreDom();
});

test("AgentLaneDetailPage shows a recoverable lane unavailable state with the route param and last-known linkage", async () => {
  const restoreDom = installDomGlobals("/cockpit/agents/session%3Asession-1");
  const modeRef = { current: "ready" as FetchMode };
  installLaneDetailFetch(modeRef, []);

  const view = renderLaneDetail();

  await view.findByRole("heading", { name: "Implementer" });
  modeRef.current = "missing-lane";

  fireEvent.click(view.getByRole("button", { name: /retry lane detail/i }));

  await view.findByText(/lane unavailable/i);
  await view.findByText("Route param");
  await view.findByText("session:session-1");
  await view.findByText(/mission alpha/i);
  assert.ok((await view.findAllByText(/session-1/i)).length >= 1);
  assert.equal(
    view.getByRole("link", { name: /back to cockpit/i }).getAttribute("href"),
    "/cockpit",
  );

  restoreDom();
});

test("AgentLaneDetailPage preserves the last visible lane snapshot and shows reconnecting or unavailable session states", async () => {
  const restoreDom = installDomGlobals("/cockpit/agents/session%3Asession-1");
  const modeRef = { current: "ready" as FetchMode };
  installLaneDetailFetch(modeRef, []);

  const view = renderLaneDetail();

  await view.findByRole("heading", { name: "Implementer" });
  assert.ok((await view.findAllByText("Completed route bootstrap handshake.")).length >= 1);

  modeRef.current = "session-live-failed";
  fireEvent.click(view.getByRole("button", { name: /retry lane detail/i }));

  assert.ok((await view.findAllByText(/reconnecting to live session/i)).length >= 1);
  assert.ok((await view.findAllByText("Completed route bootstrap handshake.")).length >= 1);

  modeRef.current = "session-live-unavailable";
  fireEvent.click(view.getByRole("button", { name: /retry lane detail/i }));

  assert.ok((await view.findAllByText(/session unavailable/i)).length >= 1);
  assert.ok((await view.findAllByText("Captured the last visible summary for the lane.")).length >= 1);

  restoreDom();
});

test("AgentLaneDetailPage does not leak lane A fallback context into a stale lane B route", async () => {
  const restoreDom = installDomGlobals("/cockpit/agents/session%3Asession-1");
  const modeRef = { current: "ready" as FetchMode };
  installLaneDetailFetch(modeRef, []);

  const view = renderLaneDetail();

  await view.findByRole("heading", { name: "Implementer" });
  await view.findByText("Mission Alpha");
  assert.ok((await view.findAllByText("Captured the last visible summary for the lane.")).length >= 1);

  await act(async () => {
    await view.router.navigate("/cockpit/agents/session%3Asession-2");
  });

  await view.findByText(/lane unavailable/i);
  await view.findByText("session:session-2");
  assert.equal(view.queryByText("Mission Alpha"), null);
  assert.equal(view.queryByText("Captured the last visible summary for the lane."), null);
  assert.equal(view.queryByText("session-1-tmux"), null);

  restoreDom();
});
