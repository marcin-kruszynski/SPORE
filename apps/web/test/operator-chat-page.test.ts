import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { JSDOM } from "jsdom";

import { useOperatorChat } from "../src/features/operator-chat/use-operator-chat.js";
import ChatPage from "../src/pages/ChatPage.js";
import type { CreateMissionFormValues } from "../src/types/operator-chat.js";

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

  emit(type: string, payload: unknown) {
    const handlers = this.listeners.get(type) ?? [];
    const event = new window.MessageEvent("message", {
      data: JSON.stringify(payload),
    }) as MessageEvent<string>;
    for (const handler of handlers) {
      handler(event);
    }
  }
}

interface FetchCall {
  url: string;
  method: string;
  bodyText: string | null;
}

function installDomGlobals() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://127.0.0.1:8788/",
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

function renderChatPage() {
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
      React.createElement(ChatPage),
    ),
  );
}

function OperatorChatHarness() {
  const chat = useOperatorChat();

  return React.createElement(
    "div",
    null,
    React.createElement("div", { "data-testid": "active-title" }, chat.activeThread?.hero.title ?? "none"),
    React.createElement("div", { "data-testid": "load-error" }, chat.loadErrorMessage ?? ""),
    React.createElement("div", { "data-testid": "refresh-error" }, chat.refreshErrorMessage ?? ""),
    React.createElement("div", { "data-testid": "stream-status" }, chat.streamStatus ?? ""),
    React.createElement(
      "div",
      { "data-testid": "message-content" },
      chat.activeThread?.messages.map((message) => message.content).join(" | ") ?? "",
    ),
    React.createElement(
      "div",
      { "data-testid": "message-action-reason" },
      chat.activeThread?.messages[0]?.pendingAction?.reason ?? "",
    ),
    React.createElement(
      "button",
      {
        type: "button",
        onClick: () => {
          const values: CreateMissionFormValues = {
            objective: "Tighten the operator onboarding copy.",
            projectId: "spore",
            safeMode: true,
            autoValidate: true,
            useStubRuntime: true,
          };
          void chat.createMission(values);
        },
      },
      "create",
    ),
    React.createElement(
      "button",
      {
        type: "button",
        onClick: () => {
          void chat.sendMessage("Keep only web.");
        },
      },
      "send",
    ),
    React.createElement(
      "button",
      {
        type: "button",
        onClick: () => {
          void chat.resolveAction("action-2", "approve");
        },
      },
      "resolve",
    ),
  );
}

function renderOperatorChatHarness() {
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
      React.createElement(OperatorChatHarness),
    ),
  );
}

afterEach(() => {
  cleanup();
  MockEventSource.instances.length = 0;
});

function makeThreadSummary(overrides: Record<string, unknown> = {}) {
  return {
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
    pendingActionCount: 1,
    ...overrides,
  };
}

function makeAction() {
  return {
    id: "action-1",
    threadId: "thread-1",
    status: "pending",
    actionKind: "goal-plan-review",
    summary: "Goal plan is waiting for approval.",
    requestedAt: "2026-03-12T10:00:00.000Z",
    threadSummary: {
      title: "Mission Alpha",
      objective: "Polish the browser operator chat into a guided mission console.",
    },
    inboxSummary: {
      urgency: "normal",
      reason: "Plan approval is waiting before managed work can start.",
      waitingLabel: "Waiting for plan approval",
    },
    decisionGuidance: {
      title: "Review the mission plan",
      why: "I prepared a plan for the approved scope and I need your sign-off.",
      nextIfApproved: "Managed work begins.",
      riskNote: "Approving starts governed execution.",
      primaryAction: "Approve the plan",
      secondaryActions: ["Ask for another option"],
      suggestedReplies: ["Keep only docs"],
    },
    choices: [{ value: "approve", label: "Approve plan", tone: "primary" }],
  };
}

function makeThreadDetail(overrides: Record<string, unknown> = {}) {
  return {
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
    pendingActions: [makeAction()],
    messages: [
      {
        id: "message-1",
        role: "assistant",
        kind: "action-request",
        content: "Goal plan goal-plan-1 is ready for review.",
        createdAt: "2026-03-12T10:00:00.000Z",
        payload: {
          pendingActionId: "action-1",
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
    ...overrides,
  };
}

test("ChatPage loads from real operator APIs and applies live stream updates", async () => {
  const restoreDom = installDomGlobals();
  const calls: FetchCall[] = [];

  globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const bodyText = typeof init?.body === "string" ? init.body : null;
    calls.push({ url, method, bodyText });

    if (url.endsWith("/api/orchestrator/operator/threads") && method === "GET") {
      return jsonResponse({ ok: true, detail: [makeThreadSummary()] });
    }
    if (url.endsWith("/api/orchestrator/operator/actions") && method === "GET") {
      return jsonResponse({ ok: true, detail: [makeAction()] });
    }
    if (url.endsWith("/api/orchestrator/operator/threads/thread-1") && method === "GET") {
      return jsonResponse({ ok: true, detail: makeThreadDetail() });
    }

    throw new Error(`Unexpected request: ${method} ${url}`);
  }) as typeof fetch;

  const view = renderChatPage();

  assert.equal(
    view.getByText("Loading mission control...").textContent,
    "Loading mission control...",
  );

  await view.findByText("Polish operator chat mission console");
  await view.findAllByText("Review the mission plan");
  await view.findByText("Keep only docs");

  assert.ok(
    calls.some((entry) =>
      entry.url.endsWith("/api/orchestrator/operator/threads") && entry.method === "GET",
    ),
  );
  assert.ok(
    calls.some((entry) =>
      entry.url.endsWith("/api/orchestrator/operator/actions") && entry.method === "GET",
    ),
  );
  assert.ok(
    calls.some((entry) =>
      entry.url.endsWith("/api/orchestrator/operator/threads/thread-1") && entry.method === "GET",
    ),
  );
  assert.equal(
    MockEventSource.instances[0]?.url,
    "/api/orchestrator/operator/threads/thread-1/stream",
  );

  await act(async () => {
    MockEventSource.instances[0]?.emit("thread-update", {
      ok: true,
      detail: makeThreadDetail({
        hero: {
          title: "Polish operator chat mission console",
          statusLine: "The proposal has been reviewed and now needs approval.",
          phase: "Proposal Approval",
          primaryCtaHint: "Approve the proposal",
          badges: {
            runtime: "Stub runtime",
            safeMode: "Safe mode on",
            autoValidate: "Auto-validate on",
          },
        },
        decisionGuidance: {
          title: "Approve the reviewed proposal",
          why: "The proposal now needs explicit approval.",
          nextIfApproved: "Validation runs next.",
          riskNote: "Approval advances the change toward promotion.",
          primaryAction: "Approve the proposal",
          secondaryActions: [],
          suggestedReplies: [],
        },
      }),
    });
  });

  await view.findByText("Approve the reviewed proposal");
  await view.findByText(
    "The proposal has been reviewed and now needs approval.",
  );

  restoreDom();
});

test("ChatPage exposes a mobile mission switcher inside the active-thread pane", async () => {
  const restoreDom = installDomGlobals();

  globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (url.endsWith("/api/orchestrator/operator/threads") && method === "GET") {
      return jsonResponse({
        ok: true,
        detail: [makeThreadSummary(), makeThreadSummary({ id: "thread-2", title: "Mission Beta" })],
      });
    }
    if (url.endsWith("/api/orchestrator/operator/actions") && method === "GET") {
      return jsonResponse({ ok: true, detail: [makeAction()] });
    }
    if (url.endsWith("/api/orchestrator/operator/threads/thread-1") && method === "GET") {
      return jsonResponse({ ok: true, detail: makeThreadDetail() });
    }
    if (url.endsWith("/api/orchestrator/operator/threads/thread-2") && method === "GET") {
      return jsonResponse({
        ok: true,
        detail: makeThreadDetail({
          id: "thread-2",
          title: "Mission Beta",
          hero: {
            title: "Mission Beta",
            statusLine: "Mission Beta is waiting on validation evidence.",
            phase: "Validation",
            primaryCtaHint: "Review validation evidence",
            badges: {
              runtime: "Stub runtime",
              safeMode: "Safe mode on",
              autoValidate: "Auto-validate on",
            },
          },
          summary: {
            objective: "Validate the dashboard migration before rollout.",
            pendingActionCount: 0,
            lastMessageExcerpt: "Validation evidence is ready for review.",
          },
          messages: [
            {
              id: "message-2",
              role: "assistant",
              content: "Validation evidence is ready for review.",
              timestampLabel: "10:05 AM",
              tone: "neutral",
              pendingAction: null,
              evidenceLinks: [],
            },
          ],
          pendingActions: [],
        }),
      });
    }

    throw new Error(`Unexpected request: ${method} ${url}`);
  }) as typeof fetch;

  const view = renderChatPage();

  await view.findByText("Polish operator chat mission console");
  const switcher = await view.findByRole("combobox", { name: /active mission/i });
  fireEvent.change(switcher, { target: { value: "thread-2" } });

  await view.findByText("Mission Beta is waiting on validation evidence.");

  restoreDom();
});

test("ChatPage shows a real-backed error state with retry", async () => {
  const restoreDom = installDomGlobals();
  let attempt = 0;

  globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    attempt += 1;

    if (attempt === 1 && url.endsWith("/api/orchestrator/operator/threads")) {
      return jsonResponse({ ok: false, message: "operator unavailable" }, { status: 503 });
    }
    if (url.endsWith("/api/orchestrator/operator/threads")) {
      return jsonResponse({ ok: true, detail: [makeThreadSummary()] });
    }
    if (url.endsWith("/api/orchestrator/operator/actions")) {
      return jsonResponse({ ok: true, detail: [makeAction()] });
    }
    if (url.endsWith("/api/orchestrator/operator/threads/thread-1")) {
      return jsonResponse({ ok: true, detail: makeThreadDetail() });
    }

    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const view = renderChatPage();

  await view.findByText("Mission Control is unavailable");
  fireEvent.click(view.getByRole("button", { name: /retry/i }));

  await view.findByText("Polish operator chat mission console");

  restoreDom();
});

test("operator chat cache sync keeps loaded mission state visible across create, send, and resolve failures", async () => {
  const restoreDom = installDomGlobals();
  const calls: FetchCall[] = [];
  let createCount = 0;
  let listFailureMode = false;
  let resolved = false;

  globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const bodyText = typeof init?.body === "string" ? init.body : null;
    calls.push({ url, method, bodyText });

    if (url.endsWith("/api/orchestrator/operator/threads") && method === "GET") {
      if (listFailureMode) {
        return jsonResponse({ ok: false, message: "threads refresh failed" }, { status: 503 });
      }
      return jsonResponse({ ok: true, detail: createCount === 0 ? [] : [] });
    }
    if (url.endsWith("/api/orchestrator/operator/actions") && method === "GET") {
      if (listFailureMode) {
        return jsonResponse({ ok: false, message: "actions refresh failed" }, { status: 503 });
      }
      return jsonResponse({ ok: true, detail: [] });
    }
    if (url.endsWith("/api/orchestrator/operator/threads/thread-2") && method === "GET") {
      return jsonResponse({
        ok: true,
        detail: makeThreadDetail({
          id: "thread-2",
          title: "Mission Beta",
          hero: {
            title: "Mission Beta",
            statusLine: "I prepared a plan and need your approval before I start.",
            phase: resolved ? "Managed Work" : "Plan Approval",
            primaryCtaHint: resolved ? "Ask for status" : "Approve the plan",
            badges: {
              runtime: "Stub runtime",
              safeMode: "Safe mode on",
              autoValidate: "Auto-validate on",
            },
          },
          decisionGuidance: resolved
            ? {
                title: "No operator decision is pending",
                why: "The orchestrator is continuing the flow.",
                nextIfApproved: "No approval is waiting right now.",
                riskNote: null,
                primaryAction: "Ask for status",
                secondaryActions: [],
                suggestedReplies: [],
              }
            : makeThreadDetail().decisionGuidance,
          pendingActions: resolved
            ? []
            : [
                {
                  ...makeAction(),
                  id: "action-2",
                  threadId: "thread-2",
                },
              ],
          actionHistory: resolved
            ? [
                {
                  ...makeAction(),
                  id: "action-2",
                  threadId: "thread-2",
                  status: "resolved",
                  inboxSummary: {
                    urgency: "normal",
                    reason: "Plan approval was waiting before managed work could start.",
                    waitingLabel: "Waiting for plan approval",
                  },
                },
              ]
            : [],
          messages: resolved
            ? [
                {
                  id: "message-resolve",
                  role: "assistant",
                  kind: "action-result",
                  content: "Goal plan goal-plan-2 was approved. I will continue the managed self-build flow now.",
                  createdAt: "2026-03-12T10:10:00.000Z",
                  payload: {
                    pendingActionId: "action-2",
                  },
                },
              ]
            : [],
        }),
      });
    }
    if (url.endsWith("/api/orchestrator/operator/threads") && method === "POST") {
      createCount += 1;
      listFailureMode = true;
      return jsonResponse({
        ok: true,
        detail: makeThreadDetail({
          id: "thread-2",
          title: "Mission Beta",
          hero: {
            title: "Mission Beta",
            statusLine: "I prepared a plan and need your approval before I start.",
            phase: "Plan Approval",
            primaryCtaHint: "Approve the plan",
            badges: {
              runtime: "Stub runtime",
              safeMode: "Safe mode on",
              autoValidate: "Auto-validate on",
            },
          },
          pendingActions: [
            {
              ...makeAction(),
              id: "action-2",
              threadId: "thread-2",
            },
          ],
          messages: [
            {
              id: "message-create",
              role: "assistant",
              kind: "action-request",
              content: "Goal plan goal-plan-2 is ready for review.",
              createdAt: "2026-03-12T10:05:00.000Z",
              payload: {
                pendingActionId: "action-2",
              },
            },
          ],
        }),
      });
    }
    if (url.endsWith("/api/orchestrator/operator/threads/thread-2/messages") && method === "POST") {
      return jsonResponse({
        ok: true,
        detail: makeThreadDetail({
          id: "thread-2",
          title: "Mission Beta",
          hero: {
            title: "Mission Beta",
            statusLine: "I prepared a plan and need your approval before I start.",
            phase: "Plan Approval",
            primaryCtaHint: "Approve the plan",
            badges: {
              runtime: "Stub runtime",
              safeMode: "Safe mode on",
              autoValidate: "Auto-validate on",
            },
          },
          pendingActions: [
            {
              ...makeAction(),
              id: "action-2",
              threadId: "thread-2",
            },
          ],
          messages: [
            {
              id: "message-operator",
              role: "operator",
              kind: "message",
              content: "Keep only web.",
              createdAt: "2026-03-12T10:06:00.000Z",
              payload: {},
            },
            {
              id: "message-create",
              role: "assistant",
              kind: "action-request",
              content: "Goal plan goal-plan-2 is ready for review.",
              createdAt: "2026-03-12T10:05:00.000Z",
              payload: {
                pendingActionId: "action-2",
              },
            },
          ],
        }),
      });
    }
    if (url.endsWith("/api/orchestrator/operator/actions/action-2/resolve") && method === "POST") {
      return jsonResponse({
        ok: true,
        detail: makeThreadDetail({
          id: "thread-2",
          title: "Mission Beta",
          hero: {
            title: "Mission Beta",
            statusLine: "The orchestrator is continuing the flow.",
            phase: "Managed Work",
            primaryCtaHint: "Ask for status",
            badges: {
              runtime: "Stub runtime",
              safeMode: "Safe mode on",
              autoValidate: "Auto-validate on",
            },
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
              ...makeAction(),
              id: "action-2",
              threadId: "thread-2",
              status: "resolved",
              inboxSummary: {
                urgency: "normal",
                reason: "Plan approval was waiting before managed work could start.",
                waitingLabel: "Waiting for plan approval",
              },
            },
          ],
          messages: [
            {
              id: "message-resolve",
              role: "assistant",
              kind: "action-result",
              content: "Goal plan goal-plan-2 was approved. I will continue the managed self-build flow now.",
              createdAt: "2026-03-12T10:10:00.000Z",
              payload: {
                pendingActionId: "action-2",
              },
            },
          ],
        }),
      });
    }

    throw new Error(`Unexpected request: ${method} ${url}`);
  }) as typeof fetch;

  const view = renderOperatorChatHarness();

  fireEvent.click(view.getByRole("button", { name: "create" }));
  await view.findByText("Mission Beta");
  assert.equal(view.getByTestId("load-error").textContent, "");
  assert.equal(view.getByTestId("active-title").textContent, "Mission Beta");
  assert.match(view.getByTestId("refresh-error").textContent ?? "", /refresh failed/);

  fireEvent.click(view.getByRole("button", { name: "send" }));
  await view.findByText(/Keep only web\./);
  assert.equal(view.getByTestId("load-error").textContent, "");
  assert.equal(view.getByTestId("active-title").textContent, "Mission Beta");

  fireEvent.click(view.getByRole("button", { name: "resolve" }));

  await view.findByText(
    "Goal plan goal-plan-2 was approved. I will continue the managed self-build flow now.",
  );
  assert.equal(
    view.getByTestId("message-action-reason").textContent,
    "Plan approval was waiting before managed work could start.",
  );
  assert.equal(view.getByTestId("load-error").textContent, "");

  const createCall = calls.find(
    (entry) =>
      entry.url.endsWith("/api/orchestrator/operator/threads") && entry.method === "POST",
  );
  const replyCall = calls.find(
    (entry) =>
      entry.url.endsWith("/api/orchestrator/operator/threads/thread-2/messages") &&
      entry.method === "POST",
  );
  const resolveCall = calls.find(
    (entry) =>
      entry.url.endsWith("/api/orchestrator/operator/actions/action-2/resolve") &&
      entry.method === "POST",
  );

  assert.ok(createCall);
  assert.match(createCall.bodyText ?? "", /"message":"Tighten the operator onboarding copy\."/);
  assert.ok(replyCall);
  assert.match(replyCall.bodyText ?? "", /"message":"Keep only web\."/);
  assert.ok(resolveCall);
  assert.match(resolveCall.bodyText ?? "", /"choice":"approve"/);

  restoreDom();
});

test("ChatPage surfaces structured SSE error payloads without replacing loaded mission state", async () => {
  const restoreDom = installDomGlobals();

  globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (url.endsWith("/api/orchestrator/operator/threads") && method === "GET") {
      return jsonResponse({ ok: true, detail: [makeThreadSummary()] });
    }
    if (url.endsWith("/api/orchestrator/operator/actions") && method === "GET") {
      return jsonResponse({ ok: true, detail: [makeAction()] });
    }
    if (url.endsWith("/api/orchestrator/operator/threads/thread-1") && method === "GET") {
      return jsonResponse({ ok: true, detail: makeThreadDetail() });
    }

    throw new Error(`Unexpected request: ${method} ${url}`);
  }) as typeof fetch;

  const view = renderChatPage();
  await view.findByText("Polish operator chat mission console");

  await act(async () => {
    MockEventSource.instances[0]?.emit("error", {
      ok: false,
      message: "operator thread not found: thread-1",
    });
  });

  await view.findByText("operator thread not found: thread-1");
  assert.equal(view.queryByText("Mission Control is unavailable"), null);
  assert.ok(view.getByText("Polish operator chat mission console"));

  restoreDom();
});

test("ChatPage shows a detail error with retry when thread summaries load but selected detail fails", async () => {
  const restoreDom = installDomGlobals();
  let detailAttempts = 0;

  globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (url.endsWith("/api/orchestrator/operator/threads") && method === "GET") {
      return jsonResponse({ ok: true, detail: [makeThreadSummary()] });
    }
    if (url.endsWith("/api/orchestrator/operator/actions") && method === "GET") {
      return jsonResponse({ ok: true, detail: [makeAction()] });
    }
    if (url.endsWith("/api/orchestrator/operator/threads/thread-1") && method === "GET") {
      detailAttempts += 1;
      if (detailAttempts === 1) {
        return jsonResponse({ ok: false, message: "detail unavailable" }, { status: 503 });
      }
      return jsonResponse({ ok: true, detail: makeThreadDetail() });
    }

    throw new Error(`Unexpected request: ${method} ${url}`);
  }) as typeof fetch;

  const view = renderChatPage();

  await view.findByText("Mission details are unavailable");
  fireEvent.click(view.getByRole("button", { name: /retry mission/i }));
  await view.findByText("Polish operator chat mission console");

  restoreDom();
});

test("ChatPage does not render live action buttons for resolved action-result history", async () => {
  const restoreDom = installDomGlobals();

  globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (url.endsWith("/api/orchestrator/operator/threads") && method === "GET") {
      return jsonResponse({ ok: true, detail: [makeThreadSummary()] });
    }
    if (url.endsWith("/api/orchestrator/operator/actions") && method === "GET") {
      return jsonResponse({ ok: true, detail: [] });
    }
    if (url.endsWith("/api/orchestrator/operator/threads/thread-1") && method === "GET") {
      return jsonResponse({
        ok: true,
        detail: makeThreadDetail({
          pendingActions: [],
          actionHistory: [
            {
              ...makeAction(),
              status: "resolved",
              inboxSummary: {
                urgency: "normal",
                reason: "Plan approval was waiting before managed work could start.",
                waitingLabel: "Waiting for plan approval",
              },
            },
          ],
          messages: [
            {
              id: "message-result",
              role: "assistant",
              kind: "action-result",
              content: "Goal plan goal-plan-1 was approved. I will continue the managed self-build flow now.",
              createdAt: "2026-03-12T10:10:00.000Z",
              payload: {
                pendingActionId: "action-1",
              },
            },
          ],
        }),
      });
    }

    throw new Error(`Unexpected request: ${method} ${url}`);
  }) as typeof fetch;

  const view = renderChatPage();

  await view.findByText(
    "Goal plan goal-plan-1 was approved. I will continue the managed self-build flow now.",
  );
  assert.equal(view.queryByRole("button", { name: "Approve plan" }), null);
  assert.ok(view.getByText("resolved"));

  restoreDom();
});
