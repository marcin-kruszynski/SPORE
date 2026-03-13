import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { cleanup, render } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";

import App from "../src/App.js";
import { AppSidebar } from "../src/components/dashboard/AppSidebar.js";
import { SidebarProvider } from "../src/components/ui/sidebar.js";
import {
  cleanupCockpitTestResources,
  installDomGlobals,
  jsonResponse,
} from "./agent-cockpit-test-utils.js";

afterEach(() => {
  cleanup();
  cleanupCockpitTestResources();
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
      return jsonResponse({ ok: true, detail: [{ id: "thread-1", title: "Mission Alpha", status: "active", updatedAt: "2026-03-12T10:05:00.000Z", summary: { objective: "Ship the cockpit home.", lastMessageExcerpt: "Validation is running." } }] });
    }
    if (url.endsWith("/api/orchestrator/operator/actions")) {
      return jsonResponse({ ok: true, detail: [] });
    }
    if (url.endsWith("/api/orchestrator/operator/threads/thread-1")) {
      return jsonResponse({ ok: true, detail: { id: "thread-1", title: "Mission Alpha", status: "active", updatedAt: "2026-03-12T10:05:00.000Z", summary: { objective: "Ship the cockpit home.", lastMessageExcerpt: "Validation is running." }, progress: { currentStage: "validation_running", currentState: "running" }, metadata: { execution: { executionId: "exec-1" } }, messages: [], context: { linkedArtifacts: [] } } });
    }
    if (url.endsWith("/api/orchestrator/executions/exec-1")) {
      return jsonResponse({ ok: true, detail: { execution: { id: "exec-1", state: "running", objective: "Ship the cockpit home.", projectRole: "implementer" }, sessions: [{ sessionId: "session-1", session: { id: "session-1", role: "implementer", state: "active", updatedAt: "2026-03-12T10:05:00.000Z", tmuxSession: "session-1-tmux" } }] } });
    }
    if (url.endsWith("/api/sessions/session-1/live")) {
      return jsonResponse({ ok: true, session: { id: "session-1", role: "implementer", state: "active", updatedAt: "2026-03-12T10:05:00.000Z", tmuxSession: "session-1-tmux" }, diagnostics: { status: "running", lastEventAt: "2026-03-12T10:05:00.000Z" } });
    }
    if (url.endsWith("/api/orchestrator/self-build/summary")) {
      return jsonResponse({ ok: true, detail: { waitingApprovalProposals: [], recentWorkItemRuns: [], workspaces: [], integrationBranches: [] } });
    }
    if (url.endsWith("/api/orchestrator/self-build/dashboard")) {
      return jsonResponse({ ok: true, detail: { recentWorkItemRuns: [] } });
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const restoreCockpitDom = installDomGlobals("/cockpit");
  const cockpitView = render(React.createElement(App));
  await cockpitView.findAllByRole("heading", { name: "Agent Cockpit" });
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
    if (url.endsWith("/api/orchestrator/operator/threads")) return jsonResponse({ ok: true, detail: [{ id: "thread-1", title: "Mission Alpha", status: "active", updatedAt: "2026-03-12T10:05:00.000Z", summary: { objective: "Ship the cockpit home.", lastMessageExcerpt: "Validation is running." } }] });
    if (url.endsWith("/api/orchestrator/operator/actions")) return jsonResponse({ ok: true, detail: [] });
    if (url.endsWith("/api/orchestrator/operator/threads/thread-1")) return jsonResponse({ ok: true, detail: { id: "thread-1", title: "Mission Alpha", status: "active", updatedAt: "2026-03-12T10:05:00.000Z", summary: { objective: "Ship the cockpit home.", lastMessageExcerpt: "Validation is running." }, progress: { currentStage: "validation_running", currentState: "running" }, metadata: { execution: { executionId: "exec-1" } }, messages: [], context: { linkedArtifacts: [] } } });
    if (url.endsWith("/api/orchestrator/executions/exec-1")) return jsonResponse({ ok: true, detail: { execution: { id: "exec-1", state: "running", objective: "Ship the cockpit home.", projectRole: "implementer" }, sessions: [{ sessionId: "session-1", session: { id: "session-1", role: "implementer", state: "active", updatedAt: "2026-03-12T10:05:00.000Z" } }] } });
    if (url.endsWith("/api/sessions/session-1/live")) return jsonResponse({ ok: true, session: { id: "session-1", role: "implementer", state: "active", updatedAt: "2026-03-12T10:05:00.000Z" }, diagnostics: { status: "running", lastEventAt: "2026-03-12T10:05:00.000Z" } });
    if (url.endsWith("/api/orchestrator/self-build/summary")) return jsonResponse({ ok: true, detail: { waitingApprovalProposals: [], recentWorkItemRuns: [], workspaces: [], integrationBranches: [] } });
    if (url.endsWith("/api/orchestrator/self-build/dashboard")) return jsonResponse({ ok: true, detail: { recentWorkItemRuns: [] } });
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;

  const restoreHomeDom = installDomGlobals("/");
  const homeView = render(React.createElement(App));
  await homeView.findAllByRole("heading", { name: "Agent Cockpit" });
  homeView.unmount();
  restoreHomeDom();

  const restoreChatDom = installDomGlobals("/chat");
  const chatView = render(React.createElement(App));
  await chatView.findAllByRole("heading", { name: "Chat" });
  chatView.unmount();
  restoreChatDom();
});
